import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import {
  PUBLIC_LAYER_IDS,
  mergeLayerAvailability,
  normalizeLayerAvailabilityStatus,
} from '../src/data/layerAvailability.js';

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;
const BODY_LIMIT = 16 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVITY_TYPES = new Set([
  'page_view', 'search', 'ui_action', 'filter_change', 'scanner_interest',
]);
const PUBLIC_LAYER_ID_SET = new Set(PUBLIC_LAYER_IDS);
const SITE_MODES = Object.freeze({
  online: {
    label: 'Systems Online',
    message: 'Satellite link established. Public command access is available.',
  },
  maintenance: {
    label: 'Maintenance Mode',
    message: 'ThunderLink is undergoing scheduled maintenance. Please check back shortly.',
  },
  feed_disconnected: {
    label: 'Feed Disconnected',
    message: 'The satellite intelligence feed is temporarily disconnected by command authority.',
  },
  restricted: {
    label: 'Restricted Mode',
    message: 'Public access has been restricted while a security review is in progress.',
  },
});

function normalizeSiteMode(value) {
  return Object.hasOwn(SITE_MODES, value) ? value : 'online';
}

function publicSiteMode(mode) {
  const normalized = normalizeSiteMode(mode);
  return { mode: normalized, ...SITE_MODES[normalized] };
}

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

function secretMatches(value, expected) {
  if (!expected) return false;
  const left = Buffer.from(tokenDigest(String(value || '')), 'hex');
  const right = Buffer.from(tokenDigest(String(expected)), 'hex');
  return crypto.timingSafeEqual(left, right);
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
  const ownerPassword = String(env.OWNER_PASSWORD || '');
  const ownerVariableLoginEnabled = Boolean(ownerEmail && ownerPassword.length >= 12 && ownerPassword.length <= 256);
  const ownerSetupToken = String(env.OWNER_SETUP_TOKEN || '');
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
        approval_status TEXT NOT NULL DEFAULT 'pending',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS security_locked BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS security_lock_reason TEXT;
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS security_locked_at TIMESTAMPTZ;
      UPDATE gev_users SET approval_status = 'approved', approved_at = COALESCE(approved_at, email_verified_at)
        WHERE email_verified_at IS NOT NULL AND approval_status = 'pending';
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
      CREATE TABLE IF NOT EXISTS gev_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO gev_settings (key, value) VALUES ('registration_autopilot', 'false')
        ON CONFLICT (key) DO NOTHING;
      INSERT INTO gev_settings (key, value) VALUES ('site_operating_mode', 'online')
        ON CONFLICT (key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS gev_layer_availability (
        layer_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'live'
          CHECK (status IN ('live', 'coming_soon', 'maintenance', 'disabled')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT REFERENCES gev_users(id) ON DELETE SET NULL
      );
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
        AND u.approval_status = 'approved' AND COALESCE(u.security_locked, FALSE) = FALSE
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

  const isAutopilotEnabled = async () => {
    const result = await pool.query("SELECT value FROM gev_settings WHERE key = 'registration_autopilot'");
    return result.rows[0]?.value === 'true';
  };

  const getSiteMode = async () => {
    const result = await pool.query("SELECT value FROM gev_settings WHERE key = 'site_operating_mode'");
    return publicSiteMode(result.rows[0]?.value);
  };

  const getLayerAvailability = async () => {
    const result = await pool.query(`
      SELECT layer_id AS "layerId", status
      FROM gev_layer_availability
      ORDER BY layer_id
    `);
    return mergeLayerAvailability(result.rows);
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
          approval: 'owner',
          ownerConfigured: Boolean(ownerEmail),
          ownerLoginConfigured: ownerVariableLoginEnabled,
          ownerSetupConfigured: Boolean(ownerEmail && ownerSetupToken),
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
          const existing = await pool.query('SELECT id, approval_status FROM gev_users WHERE email = $1', [email]);
          if (existing.rows[0]?.approval_status === 'approved') return json(res, 409, { error: 'Owner account is already configured' });
          const digest = await passwordDigest(password);
          const result = existing.rows[0]
            ? await pool.query("UPDATE gev_users SET password_digest = $1, email_verified_at = NOW(), approval_status = 'approved', approved_at = NOW() WHERE id = $2 RETURNING id, email", [digest, existing.rows[0].id])
            : await pool.query("INSERT INTO gev_users (email, password_digest, email_verified_at, approval_status, approved_at) VALUES ($1, $2, NOW(), 'approved', NOW()) RETURNING id, email", [email, digest]);
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
        const digest = await passwordDigest(password);
        const existing = await pool.query('SELECT id, approval_status FROM gev_users WHERE email = $1', [email]);
        if (existing.rows[0]?.approval_status === 'approved') return json(res, 409, { error: 'Account already exists. Sign in instead.' });
        if (existing.rows[0]?.approval_status === 'rejected') return json(res, 403, { error: 'This access request was not approved.' });
        const autopilot = await isAutopilotEnabled();
        const approvalStatus = autopilot ? 'approved' : 'pending';
        const result = existing.rows[0]
          ? await pool.query(`UPDATE gev_users SET password_digest = $1, approval_status = $2,
              email_verified_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE NULL END,
              approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE NULL END
            WHERE id = $3 RETURNING id, email`, [digest, approvalStatus, existing.rows[0].id])
          : await pool.query(`INSERT INTO gev_users
              (email, password_digest, email_verified_at, approval_status, approved_at)
            VALUES ($1, $2, CASE WHEN $3 = 'approved' THEN NOW() ELSE NULL END, $3,
              CASE WHEN $3 = 'approved' THEN NOW() ELSE NULL END)
            RETURNING id, email`, [email, digest, approvalStatus]);
        const row = result.rows[0];
        const registeringUser = { id: String(row.id), email: row.email };
        await record(req, 'account_register', { approval: approvalStatus, emailDomain: email.split('@')[1] }, registeringUser);
        if (!autopilot) return json(res, 202, { ok: true, status: 'pending', message: 'Access request submitted for owner approval.' });
        const rawSession = crypto.randomBytes(32).toString('base64url');
        await pool.query(`INSERT INTO gev_sessions (user_id, token_digest, expires_at)
          VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`, [row.id, tokenDigest(rawSession)]);
        const user = { id: String(row.id), email: row.email, verified: true, role: 'user' };
        return json(res, 201, { ok: true, status: 'approved', user, message: 'Account approved by Autopilot.' }, {
          'Set-Cookie': cookie('gev_session', rawSession, req, SESSION_DAYS * 86400),
        });
      }

      if (url.pathname === '/api/account/login' && req.method === 'POST') {
        if (!authLimit(`login:${remoteKey}`)) return json(res, 429, { error: 'Try again later' });
        const body = await readJson(req);
        const email = cleanEmail(body.email);
        const password = String(body.password || '');
        if (ownerVariableLoginEnabled && email === ownerEmail) {
          if (!secretMatches(password, ownerPassword)) return json(res, 401, { error: 'Invalid email or password' });
          const digest = await passwordDigest(password);
          const ownerResult = await pool.query(`
            INSERT INTO gev_users (email, password_digest, email_verified_at, approval_status, approved_at)
            VALUES ($1, $2, NOW(), 'approved', NOW())
            ON CONFLICT (email) DO UPDATE SET
              password_digest = EXCLUDED.password_digest,
              email_verified_at = COALESCE(gev_users.email_verified_at, NOW()),
              approval_status = 'approved',
              approved_at = COALESCE(gev_users.approved_at, NOW()),
              security_locked = FALSE,
              security_lock_reason = NULL,
              security_locked_at = NULL
            RETURNING id, email
          `, [email, digest]);
          const owner = ownerResult.rows[0];
          const rawSession = crypto.randomBytes(32).toString('base64url');
          await pool.query(`INSERT INTO gev_sessions (user_id, token_digest, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`, [owner.id, tokenDigest(rawSession)]);
          const user = { id: String(owner.id), email: owner.email, verified: true, role: 'owner' };
          await record(req, 'account_login', { ownerVariable: true }, user);
          return json(res, 200, { user }, { 'Set-Cookie': cookie('gev_session', rawSession, req, SESSION_DAYS * 86400) });
        }
        const result = await pool.query('SELECT id, email, password_digest, email_verified_at, approval_status, security_locked FROM gev_users WHERE email = $1', [email]);
        const row = result.rows[0];
        if (!row || !(await passwordMatches(password, row.password_digest))) {
          return json(res, 401, { error: 'Invalid email or password' });
        }
        if (row.approval_status === 'pending') return json(res, 403, { error: 'Your access request is awaiting owner approval.' });
        if (row.approval_status === 'rejected') return json(res, 403, { error: 'Your access request was not approved.' });
        if (row.approval_status !== 'approved') return json(res, 403, { error: 'Account access is not active.' });
        if (row.security_locked) return json(res, 423, { error: 'Account locked for security review. Contact the owner.' });
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
        const [user, siteMode] = await Promise.all([currentUser(req), getSiteMode()]);
        return json(res, 200, { user, siteMode });
      }

      if (url.pathname === '/api/account/layers' && req.method === 'GET') {
        const user = await currentUser(req);
        if (!user) return json(res, 401, { error: 'Sign in required' });
        return json(res, 200, { layers: await getLayerAvailability() });
      }

      if (url.pathname === '/api/account/admin' && req.method === 'GET') {
        const user = await currentUser(req);
        if (user?.role !== 'owner') return json(res, 403, { error: 'Owner access required' });
        const [autopilot, siteMode, accounts, layers] = await Promise.all([
          isAutopilotEnabled(),
          getSiteMode(),
          pool.query(`
            SELECT id, email, approval_status AS status, created_at AS "createdAt", approved_at AS "approvedAt",
              security_locked AS locked, security_lock_reason AS "lockReason", security_locked_at AS "lockedAt"
            FROM gev_users
            WHERE email <> $1
            ORDER BY CASE approval_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              created_at DESC
            LIMIT 250
          `, [ownerEmail]),
          getLayerAvailability(),
        ]);
        return json(res, 200, {
          autopilot,
          siteMode,
          accounts: accounts.rows.map((account) => ({ ...account, id: String(account.id) })),
          layers,
        });
      }

      if (url.pathname === '/api/account/admin/layers' && req.method === 'POST') {
        const user = await currentUser(req);
        if (user?.role !== 'owner') return json(res, 403, { error: 'Owner access required' });
        const body = await readJson(req);
        const layerId = safeText(body.layerId, 80);
        const status = normalizeLayerAvailabilityStatus(body.status);
        if (!PUBLIC_LAYER_ID_SET.has(layerId)) return json(res, 400, { error: 'Choose a valid layer' });
        if (status !== body.status) return json(res, 400, { error: 'Choose a valid layer state' });
        await pool.query(`
          INSERT INTO gev_layer_availability (layer_id, status, updated_at, updated_by)
          VALUES ($1, $2, NOW(), $3)
          ON CONFLICT (layer_id) DO UPDATE SET
            status = EXCLUDED.status, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        `, [layerId, status, user.id]);
        await record(req, 'ui_action', { action: 'layer_availability', layerId, status }, user);
        return json(res, 200, { ok: true, layers: await getLayerAvailability() });
      }

      if (url.pathname === '/api/account/admin/autopilot' && req.method === 'POST') {
        const user = await currentUser(req);
        if (user?.role !== 'owner') return json(res, 403, { error: 'Owner access required' });
        const body = await readJson(req);
        if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'Autopilot state must be true or false' });
        await pool.query(`
          INSERT INTO gev_settings (key, value, updated_at) VALUES ('registration_autopilot', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, [String(body.enabled)]);
        await record(req, 'ui_action', { action: 'registration_autopilot', enabled: body.enabled }, user);
        return json(res, 200, { ok: true, autopilot: body.enabled });
      }

      if (url.pathname === '/api/account/admin/system-mode' && req.method === 'POST') {
        const user = await currentUser(req);
        if (user?.role !== 'owner') return json(res, 403, { error: 'Owner access required' });
        const body = await readJson(req);
        const mode = normalizeSiteMode(body.mode);
        if (mode !== body.mode) return json(res, 400, { error: 'Choose a valid operating mode' });
        await pool.query(`
          INSERT INTO gev_settings (key, value, updated_at) VALUES ('site_operating_mode', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, [mode]);
        await record(req, 'ui_action', { action: 'site_operating_mode', mode }, user);
        return json(res, 200, { ok: true, siteMode: publicSiteMode(mode) });
      }

      if (url.pathname === '/api/account/admin/users' && req.method === 'POST') {
        const user = await currentUser(req);
        if (user?.role !== 'owner') return json(res, 403, { error: 'Owner access required' });
        const body = await readJson(req);
        const targetId = String(body.userId || '');
        const accountState = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : '';
        const securityAction = body.action === 'lock' || body.action === 'unlock' ? body.action : '';
        if (!/^\d+$/.test(targetId) || (!accountState && !securityAction)) return json(res, 400, { error: 'Choose a valid account action' });
        if (securityAction) {
          const locked = securityAction === 'lock';
          const reason = locked ? safeText(body.reason, 180) || 'Suspicious activity review' : null;
          const result = await pool.query(`
            UPDATE gev_users SET security_locked = $1, security_lock_reason = $2,
              security_locked_at = CASE WHEN $1 THEN NOW() ELSE NULL END
            WHERE id = $3 AND email <> $4
            RETURNING id, email, approval_status AS status, created_at AS "createdAt", approved_at AS "approvedAt",
              security_locked AS locked, security_lock_reason AS "lockReason", security_locked_at AS "lockedAt"
          `, [locked, reason, targetId, ownerEmail]);
          const account = result.rows[0];
          if (!account) return json(res, 404, { error: 'Account not found' });
          if (locked) await pool.query('DELETE FROM gev_sessions WHERE user_id = $1', [account.id]);
          await record(req, 'ui_action', { action: `account_${securityAction}`, accountId: String(account.id), reason }, user);
          return json(res, 200, { ok: true, account: { ...account, id: String(account.id) } });
        }
        const result = await pool.query(`
          UPDATE gev_users SET approval_status = $1,
            email_verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END,
            approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END
          WHERE id = $2 AND email <> $3
          RETURNING id, email, approval_status AS status, created_at AS "createdAt", approved_at AS "approvedAt",
            security_locked AS locked, security_lock_reason AS "lockReason", security_locked_at AS "lockedAt"
        `, [accountState, targetId, ownerEmail]);
        const account = result.rows[0];
        if (!account) return json(res, 404, { error: 'Account not found' });
        if (accountState === 'rejected') await pool.query('DELETE FROM gev_sessions WHERE user_id = $1', [account.id]);
        await record(req, 'ui_action', { action: `account_${accountState}`, accountId: String(account.id) }, user);
        return json(res, 200, { ok: true, account: { ...account, id: String(account.id) } });
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

export const accountSecurity = { sanitizeActivityMetadata, cleanEmail, secretMatches, normalizeSiteMode, publicSiteMode };
