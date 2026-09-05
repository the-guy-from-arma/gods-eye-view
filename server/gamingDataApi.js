import {
  createBattleMetricsProvider,
  normalizeGamingQuery,
} from './gaming/battleMetricsProvider.js';

function respond(res, status, payload, maxAge = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? `private, max-age=${maxAge}` : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function publicError(error) {
  if (error?.code === 'unauthorized') return { status: 503, code: 'provider_unauthorized', message: 'BattleMetrics authentication is unavailable' };
  if (error?.code === 'rate_limited') return { status: 429, code: 'provider_rate_limited', message: 'BattleMetrics is rate limited; try again shortly' };
  return { status: error?.status || 502, code: 'provider_unavailable', message: 'BattleMetrics is temporarily unavailable' };
}

export function gamingDataApiPlugin(options = {}) {
  const env = options.env || process.env;
  const provider = options.provider || createBattleMetricsProvider({
    fetchImpl: options.fetchImpl,
    token: env.BATTLEMETRICS_API_TOKEN || '',
  });
  return {
    name: 'gaming-data-battlemetrics-proxy',
    configureServer(server) {
      server.middlewares.use('/api/gaming', async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
        try {
          if (url.pathname === '/status') {
            return respond(res, 200, {
              provider: 'battlemetrics',
              configured: true,
              authMode: provider.tokenConfigured ? 'authenticated' : 'public',
              tokenConfigured: provider.tokenConfigured,
              refreshIntervalSec: 300,
              privacy: 'Game-server locations only; player physical locations are never collected.',
            }, 60);
          }
          if (url.pathname === '/games') {
            const result = await provider.getGames();
            return respond(res, 200, { provider: 'battlemetrics', ...result }, 300);
          }
          if (url.pathname === '/servers') {
            const query = normalizeGamingQuery(url.searchParams);
            const result = await provider.getServers(query);
            return respond(res, 200, { provider: 'battlemetrics', ...result }, 60);
          }
          return next();
        } catch (error) {
          const failure = publicError(error);
          console.warn('[Gaming Data]', { code: failure.code, status: failure.status });
          return respond(res, failure.status, {
            error: failure.message,
            code: failure.code,
            ...(Number.isFinite(error?.retryAfterSec) ? { retryAfterSec: error.retryAfterSec } : {}),
          });
        }
      });
    },
  };
}
