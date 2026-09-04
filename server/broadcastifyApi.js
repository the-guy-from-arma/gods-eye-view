import { normalizeBroadcastifyCatalog } from '../src/data/broadcastifyCatalog.js';

const CACHE_MS = 5 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
const UPSTREAM_URL = 'https://api.broadcastify.com/audio/';

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

export function broadcastifyApiPlugin(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let cache = null;
  let inFlight = null;

  const refresh = async () => {
    const key = String(env.BROADCASTIFY_API_KEY || '').trim();
    if (!key) {
      const error = new Error('Broadcastify is not configured');
      error.status = 503;
      throw error;
    }
    const url = new URL(UPSTREAM_URL);
    url.search = new URLSearchParams({ a: 'feeds', type: 'json', genre: '1', key }).toString();
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': "ThunderLink-Gods-Eye/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const error = new Error(`Broadcastify catalog returned HTTP ${response.status}`);
      error.status = response.status === 401 || response.status === 403 ? 502 : response.status;
      throw error;
    }
    const payload = await response.json();
    const feeds = normalizeBroadcastifyCatalog(payload);
    if (!feeds.length) throw new Error('Broadcastify returned no usable law-enforcement feeds');
    cache = Object.freeze({ feeds, updatedAt: new Date().toISOString(), cachedAt: Date.now() });
    return cache;
  };

  const getCatalog = async () => {
    if (cache && Date.now() - cache.cachedAt < CACHE_MS) return { ...cache, stale: false };
    if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
    try {
      return { ...(await inFlight), stale: false };
    } catch (error) {
      if (cache && Date.now() - cache.cachedAt < STALE_MS) return { ...cache, stale: true };
      throw error;
    }
  };

  return {
    name: 'broadcastify-catalog-proxy',
    configureServer(server) {
      server.middlewares.use('/api/broadcastify/feeds', async (req, res) => {
        if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
        try {
          const catalog = await getCatalog();
          return respond(res, 200, {
            feeds: catalog.feeds,
            updatedAt: catalog.updatedAt,
            stale: catalog.stale,
            provider: 'Broadcastify',
            playbackMode: 'provider-link',
          });
        } catch (error) {
          return respond(res, error?.status || 502, {
            error: error?.status === 503
              ? 'Broadcastify key is not configured'
              : 'Broadcastify catalog is temporarily unavailable',
          });
        }
      });
    },
  };
}
