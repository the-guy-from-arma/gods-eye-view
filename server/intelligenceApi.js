import crypto from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import net from 'node:net';
import pg from 'pg';
import {
  INTELLIGENCE_MODULES,
  INTELLIGENCE_MODULE_BY_ID,
  intelligenceAccessAllows,
  normalizeIntelligenceAccess,
} from '../src/data/intelligenceModules.js';

const { Pool } = pg;
const BODY_LIMIT = 32 * 1024;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map();

function createLimiter(limit, windowMs) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const i = part.indexOf('=');
    return i < 0 ? ['', ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1))];
  }).filter(([name]) => name));
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanText(value, max = 240) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanDomain(value) {
  const domain = cleanText(value, 253).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '').replace(/\.$/, '');
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ? domain : '';
}

function cleanUsername(value) {
  const username = cleanText(value, 64);
  return /^[a-z0-9_.-]{1,64}$/i.test(username) ? username : '';
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

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > BODY_LIMIT) throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

async function fetchJson(url, options = {}) {
  const key = `${options.method || 'GET'}:${url}:${options.body || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (options.ttlMs ?? CACHE_TTL_MS)) return hit.value;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ThunderLink-Oblivion/0.3.13 (+public-intelligence-console)',
      ...(options.headers || {}),
    },
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 12_000),
    redirect: 'error',
  });
  if (!response.ok) throw Object.assign(new Error(`Upstream returned ${response.status}`), { status: 502 });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT) throw Object.assign(new Error('Upstream response exceeded limit'), { status: 502 });
  const text = await response.text();
  if (Buffer.byteLength(text) > RESPONSE_LIMIT) throw Object.assign(new Error('Upstream response exceeded limit'), { status: 502 });
  const value = JSON.parse(text);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 250) cache.delete(cache.keys().next().value);
  return value;
}

function publicUser(row, ownerEmail) {
  const owner = ownerEmail && row.email === ownerEmail;
  const access = owner ? 'owner' : normalizeIntelligenceAccess(row.intelligence_access);
  return {
    id: String(row.id),
    email: row.email,
    role: owner ? 'owner' : 'user',
    access,
    verificationStatus: owner ? 'verified' : row.identity_verification_status,
  };
}

function moduleCatalog(user, availability = new Map()) {
  return INTELLIGENCE_MODULES.map(([id, name, group, access, description]) => {
    const status = availability.get(`intel-${id}`) || 'live';
    return {
      id, name, group, access, description, status,
      allowed: status === 'live' && intelligenceAccessAllows(user.access, access),
    };
  });
}

async function queryDns(domain) {
  const types = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME'];
  const rows = await Promise.all(types.map(async (type) => {
    try {
      const data = await fetchJson(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`, { ttlMs: 60_000 });
      return { type, answers: (data.Answer || []).map((item) => item.data).slice(0, 40) };
    } catch { return { type, answers: [] }; }
  }));
  return { domain, records: rows.filter((row) => row.answers.length), source: 'Google Public DNS' };
}

async function runPassiveQuery(moduleId, query, user, env) {
  if (moduleId === 'dns') {
    const domain = cleanDomain(query);
    if (!domain) throw Object.assign(new Error('Enter a valid domain'), { status: 400 });
    return queryDns(domain);
  }
  if (moduleId === 'whois') {
    const domain = cleanDomain(query);
    if (!domain) throw Object.assign(new Error('Enter a valid domain'), { status: 400 });
    const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    return { domain, handle: data.handle, status: data.status || [], nameservers: (data.nameservers || []).map((n) => n.ldhName), events: data.events || [], entities: data.entities || [], source: 'RDAP' };
  }
  if (moduleId === 'certificates') {
    const domain = cleanDomain(query);
    if (!domain) throw Object.assign(new Error('Enter a valid domain'), { status: 400 });
    const data = await fetchJson(`https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`, { ttlMs: 15 * 60_000 });
    return { domain, certificates: (Array.isArray(data) ? data : []).slice(0, 250), source: 'crt.sh certificate transparency' };
  }
  if (moduleId === 'cve') {
    const cve = cleanText(query, 24).toUpperCase();
    if (!/^CVE-\d{4}-\d{4,}$/.test(cve)) throw Object.assign(new Error('Enter a CVE identifier'), { status: 400 });
    return { cve, record: await fetchJson(`https://cveawg.mitre.org/api/cve/${encodeURIComponent(cve)}`), source: 'MITRE CVE' };
  }
  if (moduleId === 'github') {
    const username = cleanUsername(query);
    if (!username) throw Object.assign(new Error('Enter a valid GitHub username'), { status: 400 });
    const [profile, repos] = await Promise.all([
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`, { ttlMs: 60_000 }),
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=updated&per_page=10`, { ttlMs: 60_000 }),
    ]);
    return { profile, repositories: repos, source: 'GitHub public API' };
  }
  if (moduleId === 'shodan') {
    const ip = cleanText(query, 64);
    if (!net.isIP(ip)) throw Object.assign(new Error('Enter a valid public IP address'), { status: 400 });
    return { record: await fetchJson(`https://internetdb.shodan.io/${encodeURIComponent(ip)}`, { ttlMs: 10 * 60_000 }), source: 'Shodan InternetDB' };
  }
  if (moduleId === 'ip-intel') {
    const ip = cleanText(query, 64);
    if (!net.isIP(ip)) throw Object.assign(new Error('Enter a valid IP address'), { status: 400 });
    return { record: await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, { ttlMs: 10 * 60_000 }), source: 'ipwho.is' };
  }
  if (moduleId === 'bgp') {
    const value = cleanText(query, 64).toUpperCase();
    const resource = /^AS\d+$/.test(value) || net.isIP(value) ? value : '';
    if (!resource) throw Object.assign(new Error('Enter an IP address or ASN such as AS13335'), { status: 400 });
    return { record: await fetchJson(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(resource)}`, { ttlMs: 10 * 60_000 }), source: 'RIPEstat' };
  }
  if (moduleId === 'mac') {
    const mac = cleanText(query, 32).replace(/[^a-f0-9]/gi, '').toUpperCase();
    if (mac.length < 6 || mac.length > 12) throw Object.assign(new Error('Enter a valid MAC address or OUI'), { status: 400 });
    return { record: await fetchJson(`https://api.maclookup.app/v2/macs/${encodeURIComponent(mac)}`, { ttlMs: 24 * 60 * 60_000 }), source: 'MACLookup' };
  }
  if (moduleId === 'breaches') {
    const email = cleanText(query, 254).toLowerCase();
    if (user.role !== 'owner' && email !== user.email) throw Object.assign(new Error('You may check only your signed-in email address'), { status: 403 });
    return { email, record: await fetchJson(`https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`, { ttlMs: 15 * 60_000 }), source: 'XposedOrNot' };
  }
  if (moduleId === 'username') {
    const username = cleanUsername(query);
    if (!username) throw Object.assign(new Error('Enter a valid username'), { status: 400 });
    return {
      username,
      publicProfiles: [
        ['GitHub', `https://github.com/${encodeURIComponent(username)}`],
        ['GitLab', `https://gitlab.com/${encodeURIComponent(username)}`],
        ['Reddit', `https://www.reddit.com/user/${encodeURIComponent(username)}`],
        ['Keybase', `https://keybase.io/${encodeURIComponent(username)}`],
      ].map(([provider, url]) => ({ provider, url, status: 'unverified' })),
      source: 'Public profile links; presence is not asserted',
    };
  }
  if (moduleId === 'infostealer') {
    const value = cleanText(query, 254);
    const type = value.includes('@') ? 'email' : cleanDomain(value) ? 'domain' : 'username';
    const data = await fetchJson(`https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-${type}?${type}=${encodeURIComponent(value)}`, { ttlMs: 15 * 60_000 });
    return { queryType: type, record: data, source: 'Hudson Rock Cavalier' };
  }
  if (moduleId === 'wallet-intel') {
    const address = cleanText(query, 128);
    if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(address)) {
      return { chain: 'bitcoin', record: await fetchJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}`, { ttlMs: 60_000 }), source: 'Blockstream Esplora' };
    }
    if (/^0x[a-f0-9]{40}$/i.test(address)) {
      return { chain: 'ethereum', record: await fetchJson(`https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}`, { ttlMs: 60_000 }), source: 'Blockscout' };
    }
    throw Object.assign(new Error('Enter a valid Bitcoin or Ethereum address'), { status: 400 });
  }
  if (moduleId === 'phone') {
    if (!env.PHONE_INTEL_API_URL || !env.PHONE_INTEL_API_KEY) return { configured: false, message: 'Phone metadata provider is not configured.' };
    const phone = cleanText(query, 32).replace(/[^+\d]/g, '');
    if (!/^\+\d{7,15}$/.test(phone)) throw Object.assign(new Error('Enter a phone number in international format'), { status: 400 });
    const base = new URL(env.PHONE_INTEL_API_URL);
    if (base.protocol !== 'https:') throw Object.assign(new Error('Phone provider must use HTTPS'), { status: 503 });
    base.searchParams.set('number', phone);
    const data = await fetchJson(base.toString(), { headers: { Authorization: `Bearer ${env.PHONE_INTEL_API_KEY}` }, ttlMs: 15 * 60_000 });
    return { record: data, source: base.hostname };
  }
  throw Object.assign(new Error('This module uses its dedicated workspace or live-feed view'), { status: 409 });
}

async function feedSnapshot(feedId, env) {
  if (feedId === 'severe-weather') {
    const [alerts, naturalEvents] = await Promise.all([
      fetchJson('https://api.weather.gov/alerts/active?status=actual', {
        headers: { Accept: 'application/geo+json' }, ttlMs: 2 * 60_000,
      }),
      fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100', { ttlMs: 5 * 60_000 }),
    ]);
    return {
      feedId,
      weatherAlerts: (alerts.features || []).slice(0, 100),
      naturalEvents: (naturalEvents.events || []).slice(0, 100),
      source: 'NOAA/NWS and NASA EONET',
    };
  }
  if (feedId === 'space-weather') {
    const [kp, alerts, flares] = await Promise.all([
      fetchJson('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { ttlMs: 60_000 }),
      fetchJson('https://services.swpc.noaa.gov/json/alerts.json', { ttlMs: 60_000 }),
      fetchJson('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', { ttlMs: 60_000 }),
    ]);
    return { feedId, kp: kp.slice(-24), alerts: alerts.slice(0, 20), flares: flares.slice(0, 20), source: 'NOAA SWPC' };
  }
  if (feedId === 'cyber-threats') {
    const data = await fetchJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { ttlMs: 30 * 60_000 });
    return { feedId, catalogVersion: data.catalogVersion, vulnerabilities: (data.vulnerabilities || []).slice(-50).reverse(), source: 'CISA KEV' };
  }
  if (feedId === 'malware-live') {
    const data = await fetchJson('https://urlhaus-api.abuse.ch/v1/urls/recent/limit/100/', { ttlMs: 60_000 });
    return { feedId, threats: data.urls || [], source: 'abuse.ch URLhaus' };
  }
  if (feedId === 'internet-outages') {
    const until = Math.floor(Date.now() / 1000);
    const from = until - 24 * 60 * 60;
    const data = await fetchJson(`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${from}&until=${until}&entityType=country&limit=200`, { ttlMs: 5 * 60_000 });
    return { feedId, events: data.data || [], source: 'Georgia Tech IODA' };
  }
  if (feedId === 'market-watch') {
    const symbols = ['%5EGSPC', '%5EIXIC', '%5EVIX', 'GC%3DF', 'CL%3DF', 'BTC-USD'];
    const quotes = await Promise.all(symbols.map(async (symbol) => {
      try {
        const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`, { ttlMs: 5 * 60_000 });
        return data.chart?.result?.[0] || null;
      } catch { return null; }
    }));
    return { feedId, quotes: quotes.filter(Boolean), source: 'Yahoo Finance public chart endpoint' };
  }
  if (feedId === 'air-quality') {
    if (!env.OPENAQ_API_KEY) return { feedId, configured: false, message: 'Set OPENAQ_API_KEY to enable OpenAQ v3.' };
    const data = await fetchJson('https://api.openaq.org/v3/locations?limit=100', { headers: { 'X-API-Key': env.OPENAQ_API_KEY }, ttlMs: 10 * 60_000 });
    return { feedId, locations: data.results || [], source: 'OpenAQ' };
  }
  if (feedId === 'cloudflare-radar') {
    if (!env.CLOUDFLARE_API_TOKEN) return { feedId, configured: false, message: 'Set CLOUDFLARE_API_TOKEN to enable Cloudflare Radar.' };
    const data = await fetchJson('https://api.cloudflare.com/client/v4/radar/annotations/outages?limit=100', { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, ttlMs: 5 * 60_000 });
    return { feedId, record: data.result || data, source: 'Cloudflare Radar' };
  }
  return { feedId, delegated: true, message: 'This capability is available through the connected God’s Eye map or its dedicated module.' };
}

export function createIntelligenceApi(options = {}) {
  const env = options.env || process.env;
  const ownerEmail = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  const pool = options.pool || (env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL }) : null);
  const queryLimit = createLimiter(120, 60_000);
  const scanLimit = createLimiter(10, 60 * 60_000);
  let schemaPromise;

  const ensureSchema = async () => {
    if (!pool) throw Object.assign(new Error('Railway PostgreSQL is not configured'), { status: 503 });
    if (!schemaPromise) schemaPromise = pool.query(`
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS identity_verification_status TEXT NOT NULL DEFAULT 'unverified';
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;
      ALTER TABLE gev_users ADD COLUMN IF NOT EXISTS intelligence_access TEXT NOT NULL DEFAULT 'registered';
      CREATE TABLE IF NOT EXISTS gev_layer_availability (
        layer_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'live'
          CHECK (status IN ('live', 'coming_soon', 'maintenance', 'disabled')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT REFERENCES gev_users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS gev_verified_targets (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES gev_users(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        verification_method TEXT NOT NULL DEFAULT 'dns_txt',
        verification_token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, target)
      );
      CREATE TABLE IF NOT EXISTS gev_intelligence_cases (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES gev_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).catch((error) => { schemaPromise = null; throw error; });
    return schemaPromise;
  };

  const currentUser = async (req) => {
    const raw = parseCookies(req).gev_session;
    if (!raw || !pool) return null;
    const result = await pool.query(`
      SELECT u.id, u.email, u.identity_verification_status, u.intelligence_access
      FROM gev_sessions s JOIN gev_users u ON u.id = s.user_id
      WHERE s.token_digest = $1 AND s.expires_at > NOW()
        AND u.approval_status = 'approved' AND COALESCE(u.security_locked, FALSE) = FALSE
    `, [digest(raw)]);
    return result.rows[0] ? publicUser(result.rows[0], ownerEmail) : null;
  };

  const audit = async (req, user, moduleId, action, target = '') => {
    const targetHash = target ? digest(target).slice(0, 16) : '';
    await pool.query(
      'INSERT INTO gev_activity_events (user_id, event_type, metadata) VALUES ($1, $2, $3::jsonb)',
      [user.id, 'ui_action', JSON.stringify({ action, moduleId, targetHash })],
    );
  };

  return async function intelligenceMiddleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://local');
    if (!url.pathname.startsWith('/api/intelligence')) return next();
    try {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request blocked' });
      await ensureSchema();
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Sign in to open the Intelligence Console' });
      if (!queryLimit(user.id)) return json(res, 429, { error: 'Intelligence request limit reached. Try again shortly.' });

      const availabilityRows = await pool.query("SELECT layer_id, status FROM gev_layer_availability WHERE layer_id LIKE 'intel-%'");
      const availability = new Map(availabilityRows.rows.map((row) => [row.layer_id, row.status]));

      if (url.pathname === '/api/intelligence/catalog' && req.method === 'GET') {
        return json(res, 200, { user, modules: moduleCatalog(user, availability) });
      }

      if (url.pathname === '/api/intelligence/overview' && req.method === 'GET') {
        const requested = ['space-weather', 'cyber-threats', 'internet-outages', 'market-watch'];
        const results = await Promise.allSettled(requested.map((id) => feedSnapshot(id, env)));
        const feeds = Object.fromEntries(results.map((result, i) => [requested[i], result.status === 'fulfilled' ? result.value : { error: 'unavailable' }]));
        await audit(req, user, 'overview', 'intelligence_overview');
        return json(res, 200, { generatedAt: new Date().toISOString(), feeds });
      }

      if (url.pathname.startsWith('/api/intelligence/feed/') && req.method === 'GET') {
        const moduleId = cleanText(decodeURIComponent(url.pathname.slice('/api/intelligence/feed/'.length)), 80);
        const definition = INTELLIGENCE_MODULE_BY_ID.get(moduleId);
        if (!definition) return json(res, 404, { error: 'Unknown module' });
        if (availability.get(`intel-${moduleId}`) && availability.get(`intel-${moduleId}`) !== 'live') return json(res, 423, { error: 'Module unavailable by owner policy' });
        if (!intelligenceAccessAllows(user.access, definition.access)) return json(res, 403, { error: `${definition.access} access required` });
        const data = await feedSnapshot(moduleId, env);
        await audit(req, user, moduleId, 'intelligence_feed');
        return json(res, 200, data);
      }

      if (url.pathname === '/api/intelligence/query' && req.method === 'GET') {
        const moduleId = cleanText(url.searchParams.get('module'), 80);
        const query = cleanText(url.searchParams.get('q'), 300);
        const definition = INTELLIGENCE_MODULE_BY_ID.get(moduleId);
        if (!definition) return json(res, 404, { error: 'Unknown module' });
        if (availability.get(`intel-${moduleId}`) && availability.get(`intel-${moduleId}`) !== 'live') return json(res, 423, { error: 'Module unavailable by owner policy' });
        if (!intelligenceAccessAllows(user.access, definition.access)) return json(res, 403, { error: `${definition.access} access required` });
        if (!query) return json(res, 400, { error: 'Enter a query' });
        const result = await runPassiveQuery(moduleId, query, user, env);
        await audit(req, user, moduleId, 'intelligence_query', query);
        return json(res, 200, { moduleId, generatedAt: new Date().toISOString(), result });
      }

      if (url.pathname === '/api/intelligence/targets' && req.method === 'GET') {
        const result = await pool.query(`SELECT id, target, verification_method AS method, verification_token AS token, status, verified_at AS "verifiedAt", created_at AS "createdAt"
          FROM gev_verified_targets WHERE user_id = $1 ORDER BY created_at DESC`, [user.id]);
        return json(res, 200, { targets: result.rows.map((row) => ({ ...row, id: String(row.id) })) });
      }

      if (url.pathname === '/api/intelligence/targets' && req.method === 'POST') {
        if (!intelligenceAccessAllows(user.access, 'verified')) return json(res, 403, { error: 'Verified account required' });
        const body = await readJson(req);
        const target = cleanDomain(body.target);
        if (!target) return json(res, 400, { error: 'Enter a valid domain you control' });
        const token = `thunderlink-verify=${crypto.randomBytes(18).toString('base64url')}`;
        const result = await pool.query(`INSERT INTO gev_verified_targets (user_id, target, verification_token)
          VALUES ($1, $2, $3) ON CONFLICT (user_id, target) DO UPDATE SET verification_token = EXCLUDED.verification_token,
          status = 'pending', verified_at = NULL RETURNING id, target, verification_token AS token, status`, [user.id, target, token]);
        await audit(req, user, 'asset-verification', 'target_registered', target);
        return json(res, 201, { target: { ...result.rows[0], id: String(result.rows[0].id) }, instructions: `Create a DNS TXT record at _thunderlink.${target} with the exact value shown.` });
      }

      if (url.pathname === '/api/intelligence/targets/verify' && req.method === 'POST') {
        const body = await readJson(req);
        const target = cleanDomain(body.target);
        const pending = await pool.query('SELECT id, verification_token FROM gev_verified_targets WHERE user_id = $1 AND target = $2', [user.id, target]);
        if (!pending.rows[0]) return json(res, 404, { error: 'Register the target first' });
        const records = await resolveTxt(`_thunderlink.${target}`).catch(() => []);
        const matched = records.some((parts) => parts.join('') === pending.rows[0].verification_token);
        if (!matched) return json(res, 409, { error: 'Verification record was not found yet' });
        await pool.query("UPDATE gev_verified_targets SET status = 'verified', verified_at = NOW() WHERE id = $1", [pending.rows[0].id]);
        await audit(req, user, 'asset-verification', 'target_verified', target);
        return json(res, 200, { ok: true, target, status: 'verified' });
      }

      if (url.pathname === '/api/intelligence/scan' && req.method === 'POST') {
        if (!intelligenceAccessAllows(user.access, 'analyst')) return json(res, 403, { error: 'Analyst access required' });
        if (!scanLimit(user.id)) return json(res, 429, { error: 'Authorized scanner hourly limit reached' });
        if (!env.SCANNER_URL || !env.SCANNER_KEY) return json(res, 503, { error: 'Authorized scanner backend is not configured' });
        const body = await readJson(req);
        const target = cleanDomain(body.target);
        const scanType = cleanText(body.scanType, 40);
        const allowed = new Set(['quick', 'ssl', 'headers', 'subdomains', 'tech', 'vuln']);
        if (!target || !allowed.has(scanType)) return json(res, 400, { error: 'Choose a valid verified target and scan type' });
        const verified = await pool.query("SELECT 1 FROM gev_verified_targets WHERE user_id = $1 AND target = $2 AND status = 'verified'", [user.id, target]);
        if (!verified.rows[0] && user.role !== 'owner') return json(res, 403, { error: 'Verify ownership of this target before scanning' });
        const base = new URL(env.SCANNER_URL);
        if (base.protocol !== 'https:' && base.hostname !== 'localhost') return json(res, 503, { error: 'Scanner backend must use HTTPS' });
        base.pathname = `${base.pathname.replace(/\/$/, '')}/scan/${scanType}`;
        base.searchParams.set('target', target);
        const data = await fetchJson(base.toString(), { headers: { 'X-API-Key': env.SCANNER_KEY }, ttlMs: 0, timeoutMs: scanType === 'vuln' ? 90_000 : 20_000 });
        await audit(req, user, `scan-${scanType}`, 'authorized_scan', target);
        return json(res, 200, { target, scanType, result: data });
      }

      return json(res, 404, { error: 'Intelligence endpoint not found' });
    } catch (error) {
      console.warn('[Intelligence]', error?.message || error);
      return json(res, Number(error?.status) || 500, { error: Number(error?.status) >= 500 ? 'Intelligence request failed' : error.message });
    }
  };
}

export function intelligenceApiPlugin(options = {}) {
  return {
    name: 'thunderlink-intelligence-api',
    configureServer(server) {
      server.middlewares.use(createIntelligenceApi(options));
    },
  };
}

export const intelligenceApiInternals = { cleanDomain, cleanUsername, moduleCatalog };
