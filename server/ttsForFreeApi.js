const CREATE_URL = 'https://api.ttsforfree.com/api/TTS/CreateBy';
const STATUS_URL = 'https://api.ttsforfree.com/api/TTS/Status/';
const DEFAULT_VOICE = 'v1:7Tx6oHH_My9uf3fG_Z6p4VVt-WSKo7jwEaH6emE8fDSMgTzVS3lclGo6QywL';
const MAX_TEXT_LENGTH = 180;
const MAX_BODY_BYTES = 2_048;
const CACHE_MS = 24 * 60 * 60_000;
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 5_000;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    const requestHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function clientAddress(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function cleanText(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function safeAudioUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'ttsforfree.com' && !host.endsWith('.ttsforfree.com'))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function resultAudio(payload) {
  return safeAudioUrl(payload?.Data || payload?.data || payload?.ExpectUrl || payload?.expectUrl);
}

function resultStatus(payload) {
  return String(payload?.Status || payload?.status || '').trim().toUpperCase();
}

function resultId(payload) {
  const id = Number(payload?.Id ?? payload?.id ?? payload?.JobId ?? payload?.jobId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createLimiter(limit = 20, windowMs = 5 * 60_000) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length <= limit;
  };
}

async function providerJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerReason = String(
      payload?.message
      || payload?.Message
      || payload?.error?.message
      || payload?.error
      || '',
    ).toLowerCase();
    const quotaLimited = response.status === 429
      && /credit|quota|balance|insufficient|exhaust|allowance/.test(providerReason);
    const error = new Error(
      quotaLimited
        ? 'TTSForFree account credits are unavailable'
        : response.status === 429
          ? 'TTSForFree is rate limiting voice requests'
          : 'TTS provider request failed',
    );
    error.status = response.status === 429 ? 429 : 502;
    error.code = quotaLimited ? 'tts_quota_limited' : response.status === 429 ? 'tts_rate_limited' : 'tts_provider_failed';
    throw error;
  }
  return payload;
}

export function ttsForFreeApiPlugin(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleep = options.sleep || ((duration) => new Promise((resolve) => setTimeout(resolve, duration)));
  const allowed = createLimiter();
  const cache = new Map();
  const inFlight = new Map();

  const synthesize = async (text) => {
    const key = String(env.TTSFORFREE_API_KEY || '').trim();
    if (!key) throw Object.assign(new Error('Natural voice is not configured'), { status: 503, code: 'not_configured' });
    const cached = cache.get(text);
    if (cached && Date.now() - cached.createdAt < CACHE_MS) return { audioUrl: cached.audioUrl, cached: true };
    if (inFlight.has(text)) return inFlight.get(text);

    const task = (async () => {
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': key };
      let payload = await providerJson(fetchImpl, CREATE_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          Texts: text,
          Voice: String(env.TTSFORFREE_VOICE_ID || DEFAULT_VOICE).trim(),
          Pitch: 0,
          CallbackUrl: '',
        }),
      });
      let audioUrl = resultAudio(payload);
      const jobId = resultId(payload);
      for (let attempt = 0; !audioUrl && jobId && attempt < POLL_ATTEMPTS; attempt += 1) {
        if (['SUCCESS', 'FAILED', 'ERROR', 'CANCELLED'].includes(resultStatus(payload))) break;
        await sleep(POLL_INTERVAL_MS);
        payload = await providerJson(fetchImpl, `${STATUS_URL}${encodeURIComponent(jobId)}`, {
          method: 'GET',
          headers: { Accept: 'application/json', 'X-API-Key': key },
        });
        audioUrl = resultAudio(payload);
      }
      if (!audioUrl) throw Object.assign(new Error('Natural voice generation did not complete'), { status: 504 });
      cache.set(text, { audioUrl, createdAt: Date.now() });
      while (cache.size > 250) cache.delete(cache.keys().next().value);
      return { audioUrl, cached: false };
    })().finally(() => inFlight.delete(text));
    inFlight.set(text, task);
    return task;
  };

  function install(middlewares) {
    middlewares.use('/api/tts/speak', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request refused' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return sendJson(res, 415, { error: 'Content-Type must be application/json' });
      }
      if (!allowed(clientAddress(req))) return sendJson(res, 429, { error: 'Natural voice request limit reached' });
      try {
        const body = await readJson(req);
        const text = cleanText(body.text);
        if (!text) return sendJson(res, 400, { error: 'Text is required' });
        const result = await synthesize(text);
        return sendJson(res, 200, { ...result, provider: 'ttsforfree' });
      } catch (error) {
        return sendJson(res, error?.status || 502, {
          error: error?.message || 'Natural voice is temporarily unavailable',
          code: error?.code || 'tts_unavailable',
        });
      }
    });
  }

  return {
    name: 'ttsforfree-api',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}
