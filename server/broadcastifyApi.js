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
const UNFILTERED_REQUEST = Object.freeze({ genreId: null, params: {} });

function upstreamError(status) {
  const credentialRejected = status === 401 || status === 403;
  const error = new Error(credentialRejected
    ? 'Broadcastify rejected the configured application key'
    : `Broadcastify catalog returned HTTP ${status}`);
  error.status = credentialRejected ? 503 : status;
  error.upstreamStatus = status;
  error.code = credentialRejected ? 'credential_rejected' : 'upstream_response';
  return error;
}

function transportError(cause) {
  const error = new Error(cause?.name === 'TimeoutError'
    ? 'Broadcastify catalog request timed out'
    : 'Broadcastify catalog transport failed');
  error.status = 502;
  error.code = cause?.name === 'TimeoutError' ? 'upstream_timeout' : 'upstream_unreachable';
  return error;
}

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
    const fetchCatalog = async (request) => {
      const url = new URL(UPSTREAM_URL);
      url.search = new URLSearchParams({ a: 'feeds', type: 'json', ...request.params, key }).toString();
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Accept: 'application/json', 'User-Agent': "ThunderLink-Gods-Eye/1.0" },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        throw transportError(error);
      }
      if (!response.ok) throw upstreamError(response.status);
      try {
        return normalizeBroadcastifyCatalog(await response.json(), undefined, request);
      } catch {
        const error = new Error('Broadcastify returned an invalid catalog response');
        error.status = 502;
        error.code = 'invalid_upstream_payload';
        throw error;
      }
    };

    // Public Safety is the only catalog required to serve the layer. Special
    // events, disaster events, and listener rankings enrich it, but one
    // optional rejection must never turn an otherwise valid directory into a
    // 502. If a license rejects the genre filter, the documented unfiltered
    // catalog remains a compatible fallback and is filtered locally.
    let primary;
    let usedUnfilteredFallback = false;
    try {
      primary = await fetchCatalog(CATALOG_REQUESTS[0]);
    } catch (error) {
      if (error?.code === 'credential_rejected') throw error;
      primary = await fetchCatalog(UNFILTERED_REQUEST);
      usedUnfilteredFallback = true;
    }
    const optional = await Promise.allSettled(CATALOG_REQUESTS.slice(1).map(fetchCatalog));
    const catalogs = [primary, ...optional
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)];
    const optionalFailureCount = optional.filter((result) => result.status === 'rejected').length;
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
      degraded: usedUnfilteredFallback || optionalFailureCount > 0,
      optionalFailureCount,
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
            degraded: catalog.degraded,
            optionalFailureCount: catalog.optionalFailureCount,
            provider: 'Broadcastify',
            playbackMode: 'direct-stream',
          });
        } catch (error) {
          console.warn('[Broadcastify Proxy]', {
            code: error?.code || 'catalog_unavailable',
            status: error?.status || 502,
            upstreamStatus: error?.upstreamStatus || null,
          });
          return respond(res, error?.status || 502, {
            error: error?.code === 'credential_rejected'
              ? 'Broadcastify rejected the configured application key'
              : (error?.status === 503
                ? 'Broadcastify key is not configured'
                : 'Broadcastify catalog is temporarily unavailable'),
            code: error?.code || 'catalog_unavailable',
            ...(Number.isInteger(error?.upstreamStatus) ? { upstreamStatus: error.upstreamStatus } : {}),
          });
        }
      });
    },
  };
}
