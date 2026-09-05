import {
  createBattleMetricsProvider,
  normalizeGamingQuery,
} from './gaming/battleMetricsProvider.js';
import { createSteamGamingProvider } from './gaming/steamProvider.js';

function respond(res, status, payload, maxAge = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? `private, max-age=${maxAge}` : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function publicError(error) {
  const source = error?.providerName || 'Gaming Data provider';
  if (error?.code === 'unauthorized') return { status: 503, code: 'provider_unauthorized', message: `${source} authentication is unavailable` };
  if (error?.code === 'rate_limited') return { status: 429, code: 'provider_rate_limited', message: `${source} is rate limited; try again shortly` };
  return { status: error?.status || 502, code: 'provider_unavailable', message: `${source} is temporarily unavailable` };
}

export function gamingDataApiPlugin(options = {}) {
  const env = options.env || process.env;
  const battleMetricsProvider = options.provider || options.battleMetricsProvider || createBattleMetricsProvider({
    fetchImpl: options.fetchImpl,
    token: env.BATTLEMETRICS_API_TOKEN || '',
  });
  const steamProvider = options.steamProvider || createSteamGamingProvider({
    fetchImpl: options.fetchImpl,
    key: env.STEAM_WEB_API_KEY || '',
    appIds: env.STEAM_GAMING_APP_IDS || '',
  });
  const preferred = String(env.GAMING_DATA_PROVIDER || 'steam').trim().toLowerCase();
  const selectProvider = () => {
    if (preferred === 'battlemetrics' && battleMetricsProvider.tokenConfigured) return battleMetricsProvider;
    if (steamProvider.tokenConfigured) return steamProvider;
    if (battleMetricsProvider.tokenConfigured) return battleMetricsProvider;
    return null;
  };
  return {
    name: 'gaming-data-provider-proxy',
    configureServer(server) {
      server.middlewares.use('/api/gaming', async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
        try {
          const provider = selectProvider();
          if (url.pathname === '/status') {
            return respond(res, 200, {
              provider: provider?.id || (preferred === 'battlemetrics' ? 'battlemetrics' : 'steam'),
              configured: Boolean(provider),
              authMode: provider?.id || 'unconfigured',
              tokenConfigured: Boolean(provider),
              providers: {
                steam: { configured: steamProvider.tokenConfigured },
                battlemetrics: { configured: battleMetricsProvider.tokenConfigured },
              },
              refreshIntervalSec: 300,
              privacy: 'Coarse game-server regions only; Steam IDs and player physical locations are never collected.',
            }, 60);
          }
          if (!provider && (url.pathname === '/games' || url.pathname === '/servers')) {
            return respond(res, 503, {
              error: 'Gaming Data requires STEAM_WEB_API_KEY or BATTLEMETRICS_API_TOKEN configured in Railway.',
              code: 'provider_not_configured',
            });
          }
          if (url.pathname === '/games') {
            const result = await provider.getGames();
            return respond(res, 200, { provider: provider.id, ...result }, 300);
          }
          if (url.pathname === '/servers') {
            const query = normalizeGamingQuery(url.searchParams);
            const result = await provider.getServers(query);
            return respond(res, 200, { provider: provider.id, ...result }, 60);
          }
          return next();
        } catch (error) {
          const provider = selectProvider();
          if (provider && error && typeof error === 'object') error.providerName = provider.name || provider.id;
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
