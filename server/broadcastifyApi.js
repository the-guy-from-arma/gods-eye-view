import { normalizeBroadcastifyCatalog } from '../src/data/broadcastifyCatalog.js';

const CACHE_MS = 5 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
const UPSTREAM_URL = 'https://api.broadcastify.com/audio/';
const CATALOG_REQUESTS = Object.freeze([
  Object.freeze({ genreId: 1, params: { genre: '1' } }),
  Object.freeze({ genreId: 7, params: { genre: '7' } }),
  Object.freeze({ genreId: 8, params: { genre: '8' } }),
  Object.freeze({ genreId: 1, top: true, params: { genre: '1', top: '50' } }),
]);

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
    const catalogs = await Promise.all(CATALOG_REQUESTS.map(async (request) => {
      const url = new URL(UPSTREAM_URL);
      url.search = new URLSearchParams({ a: 'feeds', type: 'json', ...request.params, key }).toString();
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': "ThunderLink-Gods-Eye/1.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const error = new Error(`Broadcastify catalog returned HTTP ${response.status}`);
        error.status = response.status === 401 || response.status === 403 ? 502 : response.status;
        throw error;
      }
      return normalizeBroadcastifyCatalog(await response.json(), undefined, request);
    }));
    const byFeedId = new Map();
    for (const feed of catalogs.flat()) {
      const previous = byFeedId.get(feed.feedId);
      if (!previous) {
        byFeedId.set(feed.feedId, feed);
        continue;
      }
      const selected = (feed.activityType === 'disaster-event'
        || (feed.activityType === 'special-event' && previous.activityType !== 'disaster-event'))
        ? feed
        : previous;
      const listeners = Math.max(previous.listeners ?? -1, feed.listeners ?? -1);
      byFeedId.set(feed.feedId, Object.freeze({
        ...selected,
        listeners: listeners >= 0 ? listeners : null,
        activeSignal: previous.activeSignal || feed.activeSignal,
        activityType: selected.activityType || previous.activityType || feed.activityType,
        activityLabel: selected.activityLabel || previous.activityLabel || feed.activityLabel,
      }));
    }
    const feeds = [...byFeedId.values()].sort((a, b) => (Number(b.activeSignal) - Number(a.activeSignal))
      || ((b.listeners ?? -1) - (a.listeners ?? -1)) || a.name.localeCompare(b.name));
    if (!feeds.length) throw new Error('Broadcastify returned no usable law-enforcement feeds');
    cache = Object.freeze({
      feeds,
      activeEventCount: feeds.filter((feed) => feed.activeSignal).length,
      updatedAt: new Date().toISOString(),
      cachedAt: Date.now(),
    });
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
            activeEventCount: catalog.activeEventCount,
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
