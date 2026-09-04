import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;
const BODY_LIMIT = 16 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVITY_TYPES = new Set([
  'page_view', 'search', 'ui_action', 'filter_change', 'scanner_interest',
]);

function json(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([name]) => name));
}

function cookie(name, value, req, maxAge) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function tokenDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function passwordDigest(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(key).toString('hex')}`;
}

async function passwordMatches(password, stored) {
  const [, salt, expectedHex] = String(stored || '').split(':');
  if (!salt || !expectedHex) return false;
  const key = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > BODY_LIMIT) {
      const error = new Error('Request too large');
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 254);
}

function safeText(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function sanitizeActivityMetadata(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const [key, raw] of Object.entries(source).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) continue;
    if (/password|secret|token|key|audio|microphone/i.test(key)) continue;
    if (typeof raw === 'boolean' || Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === 'string') out[key] = safeText(raw, 240);
  }
  return out;
}

function requestBaseUrl(req, configuredUrl) {
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
  const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${protocol}://${host}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  } catch {
    return false;
  }
}

function createLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= limit;
  };
}

export function createAccountApi(options = {}) {
  const env = options.env || process.env;
  const connectionString = env.DATABASE_URL;
  const ownerEmail = cleanEmail(env.OWNER_EMAIL);
  const ownerSetupToken = String(env.OWNER_SETUP_TOKEN || '');
  const resendKey = env.RESEND_API_KEY || '';
  const emailFrom = env.EMAIL_FROM || '';
  const pool = options.pool || (connectionString ? new Pool({ connectionString }) : null);
  const authLimit = createLimiter(12, 15 * 60_000);
  const activityLimit = createLimiter(180, 60_000);
  let schemaPromise;

  const ensureSchema = () => {
    if (!pool) return Promise.reject(Object.assign(new Error('Database not configured'), { code: 'NO_DATABASE' }));
    if (!schemaPromise) schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS gev_users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_digest TEXT NOT NULL,
        email_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS gev_email_verifications (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES gev_users(id) ON DELETE CASCADE,
        token_digest TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS gev_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES gev_users(id) ON DELETE CASCADE,
        token_digest TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS gev_activity_events (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES gev_users(id) ON DELETE SET NULL,
        anonymous_id TEXT,
        event_type TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gev_activity_created_idx ON gev_activity_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS gev_activity_user_idx ON gev_activity_events(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS gev_public_safety_sources (
        id BIGSERIAL PRIMARY KEY,
        country_code TEXT NOT NULL,
        country_name TEXT NOT NULL,
        region_name TEXT,
        county_name TEXT,
        city_name TEXT,
        agency_name TEXT NOT NULL,
        service_type TEXT NOT NULL,
        feed_name TEXT,
        provider_name TEXT,
        official_page_url TEXT,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS gev_public_safety_jurisdiction_idx
        ON gev_public_safety_sources(country_code, region_name, county_name, city_name, agency_name);
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
    return schemaPromise;
  };

  const currentUser = async (req) => {
    const raw = parseCookies(req).gev_session;
    if (!raw) return null;
    const result = await pool.query(`
      SELECT u.id, u.email, u.email_verified_at
      FROM gev_sessions s JOIN gev_users u ON u.id = s.user_id
      WHERE s.token_digest = $1 AND s.expires_at > NOW()
    `, [tokenDigest(raw)]);
    const user = result.rows[0];
    if (!user) return null;
    return {
      id: String(user.id),
      email: user.email,
      verified: Boolean(user.email_verified_at),
      role: ownerEmail && user.email === ownerEmail ? 'owner' : 'user',
    };
  };

  const sendVerification = async (req, email, rawToken) => {
    const verificationUrl = `${requestBaseUrl(req, env.PUBLIC_APP_URL)}/api/account/verify?token=${encodeURIComponent(rawToken)}`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: emailFrom,
        to: [email],
        subject: "Verify your ThunderLink God's Eye account",
        html: `<p>Confirm your ThunderLink God's Eye account:</p><p><a href="${verificationUrl}">Verify email</a></p><p>This link expires in 30 minutes.</p>`,
      }),
    });
    if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
  };

  const record = async (req, eventType, metadata = {}, user = null) => {
    const cookies = parseCookies(req);
    const anonymousId = safeText(cookies.gev_anon, 80) || null;
    await pool.query(
      'INSERT INTO gev_activity_events (user_id, anonymous_id, event_type, metadata) VALUES ($1, $2, $3, $4::jsonb)',
      [user?.id || null, anonymousId, eventType, JSON.stringify(sanitizeActivityMetadata(metadata))],
    );
  };

  return async function accountMiddleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://local');
    if (!url.pathname.startsWith('/api/account') && url.pathname !== '/api/activity' && url.pathname !== '/api/public-safety/jurisdictions') return next();
    try {
      if (url.pathname === '/api/account/status' && req.method === 'GET') {
        return json(res, 200, {
          database: Boolean(pool),
          email: Boolean(resendKey && emailFrom),
          ownerConfigured: Boolean(ownerEmail),
        });
      }
      await ensureSchema();
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request blocked' });
      const remoteKey = String(req.socket?.remoteAddress || 'unknown');

      if (url.pathname === '/api/public-safety/jurisdictions' && req.method === 'GET') {
        const requested = {
          country: safeText(url.searchParams.get('country'), 2).toUpperCase(),
          region: safeText(url.searchParams.get('region'), 100),
          county: safeText(url.searchParams.get('county'), 100),
          city: safeText(url.searchParams.get('city'), 100),
          agency: safeText(url.searchParams.get('agency'), 160),
          service: safeText(url.searchParams.get('service'), 40).toLowerCase(),
        };
        const values = [];
        const where = [];
        const columnByKey = { country: 'country_code', region: 'region_name', county: 'county_name', city: 'city_name', agency: 'agency_name', service: 'service_type' };
        for (const [key, value] of Object.entries(requested)) {
          if (!value) continue;
          values.push(value);
          where.push(`${columnByKey[key]} = $${values.length}`);
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const result = await pool.query(`
          SELECT country_code AS "countryCode", country_name AS "countryName",
            region_name AS region, county_name AS county, city_name AS city,
            agency_name AS agency, service_type AS service, feed_name AS "feedName",
            provider_name AS provider, official_page_url AS "officialPageUrl", enabled
          FROM gev_public_safety_sources ${clause}
          ORDER BY country_name, region_name NULLS FIRST, county_name NULLS FIRST,
            city_name NULLS FIRST, agency_name LIMIT 1000
        `, values);
        return json(res, 200, { sources: result.rows, playbackEnabled: false });
      }

      if (url.pathname === '/api/account/register' && req.method === 'POST') {
        if (!authLimit(`register:${remoteKey}`)) return json(res, 429, { error: 'Try again later' });
        const body = await readJson(req);
        const email = cleanEmail(body.email);
        const password = String(body.password || '');
        if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'Enter a valid email address' });
        if (password.length < 12 || password.length > 256) return json(res, 400, { error: 'Password must be 12–256 characters' });
        const suppliedSetupDigest = tokenDigest(String(body.ownerSetupToken || ''));
        const expectedSetupDigest = tokenDigest(ownerSetupToken);
        const ownerClaim = Boolean(
          ownerEmail
          && ownerSetupToken
          && email === ownerEmail
          && crypto.timingSafeEqual(Buffer.from(suppliedSetupDigest), Buffer.from(expectedSetupDigest))
        );
        if (ownerClaim) {
          const existing = await pool.query('SELECT id, email_verified_at FROM gev_users WHERE email = $1', [email]);
          if (existing.rows[0]?.email_verified_at) return json(res, 409, { error: 'Owner account is already configured' });
          const digest = await passwordDigest(password);
          const result = existing.rows[0]
            ? await pool.query('UPDATE gev_users SET password_digest = $1, email_verified_at = NOW() WHERE id = $2 RETURNING id, email', [digest, existing.rows[0].id])
            : await pool.query('INSERT INTO gev_users (email, password_digest, email_verified_at) VALUES ($1, $2, NOW()) RETURNING id, email', [email, digest]);
          const row = result.rows[0];
          const rawSession = crypto.randomBytes(32).toString('base64url');
          await pool.query(`INSERT INTO gev_sessions (user_id, token_digest, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`, [row.id, tokenDigest(rawSession)]);
          const user = { id: String(row.id), email: row.email, verified: true, role: 'owner' };
          await record(req, 'account_register', { ownerSetup: true }, user);
          return json(res, 201, { ok: true, user, message: 'Owner account secured.' }, {
            'Set-Cookie': cookie('gev_session', rawSession, req, SESSION_DAYS * 86400),
          });
        }
        if (!resendKey || !emailFrom) return json(res, 503, { error: 'Email verification is not configured yet. The owner can use the one-time setup code.' });
        const digest = await passwordDigest(password);
        const client = await pool.connect();
        let rawToken;
        try {
          await client.query('BEGIN');
          const existing = await client.query('SELECT id, email_verified_at FROM gev_users WHERE email = $1', [email]);
          if (existing.rows[0]?.email_verified_at) {
            await client.query('ROLLBACK');
            return json(res, 202, { ok: true, message: 'If eligible, a verification email has been sent.' });
          }
          const userResult = existing.rows[0]
            ? await client.query('UPDATE gev_users SET password_digest = $1 WHERE id = $2 RETURNING id', [digest, existing.rows[0].id])
            : await client.query('INSERT INTO gev_users (email, password_digest) VALUES ($1, $2) RETURNING id', [email, digest]);
          const userId = userResult.rows[0].id;
          rawToken = crypto.randomBytes(32).toString('base64url');
          await client.query('DELETE FROM gev_email_verifications WHERE user_id = $1 AND consumed_at IS NULL', [userId]);
          await client.query(`INSERT INTO gev_email_verifications (user_id, token_digest, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`, [userId, tokenDigest(rawToken)]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        await sendVerification(req, email, rawToken);
        await record(req, 'account_register', { emailDomain: email.split('@')[1] });
        return json(res, 201, { ok: true, message: 'Check your email to verify your account.' });
      }

      if (url.pathname === '/api/account/verify' && req.method === 'GET') {
        const rawToken = safeText(url.searchParams.get('token'), 128);
        const result = await pool.query(`
          UPDATE gev_users u SET email_verified_at = COALESCE(u.email_verified_at, NOW())
          FROM gev_email_verifications v
          WHERE v.user_id = u.id AND v.token_digest = $1 AND v.consumed_at IS NULL AND v.expires_at > NOW()
          RETURNING u.id
        `, [tokenDigest(rawToken)]);
        if (!result.rows[0]) return json(res, 400, { error: 'Verification link is invalid or expired' });
        await pool.query('UPDATE gev_email_verifications SET consumed_at = NOW() WHERE token_digest = $1', [tokenDigest(rawToken)]);
        res.statusCode = 302;
        res.setHeader('Location', '/?verified=1');
        res.end();
        return;
      }

      if (url.pathname === '/api/account/login' && req.method === 'POST') {
        if (!authLimit(`login:${remoteKey}`)) return json(res, 429, { error: 'Try again later' });
        const body = await readJson(req);
        const email = cleanEmail(body.email);
        const result = await pool.query('SELECT id, email, password_digest, email_verified_at FROM gev_users WHERE email = $1', [email]);
        const row = result.rows[0];
        if (!row || !(await passwordMatches(String(body.password || ''), row.password_digest))) {
          return json(res, 401, { error: 'Invalid email or password' });
        }
        if (!row.email_verified_at) return json(res, 403, { error: 'Verify your email before signing in' });
        const rawToken = crypto.randomBytes(32).toString('base64url');
        await pool.query(`INSERT INTO gev_sessions (user_id, token_digest, expires_at)
          VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`, [row.id, tokenDigest(rawToken)]);
        const user = { id: String(row.id), email: row.email, verified: true, role: ownerEmail && row.email === ownerEmail ? 'owner' : 'user' };
        await record(req, 'account_login', {}, user);
        return json(res, 200, { user }, { 'Set-Cookie': cookie('gev_session', rawToken, req, SESSION_DAYS * 86400) });
      }

      if (url.pathname === '/api/account/logout' && req.method === 'POST') {
        const raw = parseCookies(req).gev_session;
        if (raw) await pool.query('DELETE FROM gev_sessions WHERE token_digest = $1', [tokenDigest(raw)]);
        return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('gev_session', '', req, 0) });
      }

      if (url.pathname === '/api/account/session' && req.method === 'GET') {
        return json(res, 200, { user: await currentUser(req) });
      }

      if (url.pathname === '/api/account/activity' && req.method === 'GET') {
        const user = await currentUser(req);
        if (user?.role !== 'owner') return json(res, 403, { error: 'Owner access required' });
        const limit = Math.min(250, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const result = await pool.query(`
          SELECT a.id, a.event_type, a.metadata, a.created_at, u.email
          FROM gev_activity_events a LEFT JOIN gev_users u ON u.id = a.user_id
          ORDER BY a.created_at DESC LIMIT $1
        `, [limit]);
        return json(res, 200, { events: result.rows });
      }

      if (url.pathname === '/api/activity' && req.method === 'POST') {
        if (!activityLimit(remoteKey)) return json(res, 202, { ok: true });
        const body = await readJson(req);
        const eventType = safeText(body.type, 40);
        if (!ACTIVITY_TYPES.has(eventType)) return json(res, 400, { error: 'Unsupported activity type' });
        let anonymousId = parseCookies(req).gev_anon;
        const headers = {};
        if (!anonymousId) {
          anonymousId = crypto.randomBytes(18).toString('base64url');
          headers['Set-Cookie'] = cookie('gev_anon', anonymousId, req, 365 * 86400);
          req.headers.cookie = `${req.headers.cookie || ''}; gev_anon=${anonymousId}`;
        }
        await record(req, eventType, body.metadata, await currentUser(req));
        return json(res, 202, { ok: true }, headers);
      }

      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error?.code === 'NO_DATABASE') return json(res, 503, { error: 'Database not configured' });
      console.error('[Accounts]', error?.message || error);
      return json(res, error?.status || 500, { error: error?.status ? error.message : 'Account service unavailable' });
    }
  };
}

export function accountApiPlugin(options = {}) {
  return {
    name: 'thunderlink-account-api',
    configureServer(server) {
      server.middlewares.use(createAccountApi(options));
    },
  };
}

export const accountSecurity = { sanitizeActivityMetadata, cleanEmail };
