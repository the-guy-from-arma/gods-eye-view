const STEAM_API_BASE = 'https://api.steampowered.com';
const CACHE_TTL_MS = 5 * 60_000;
const STALE_TTL_MS = 24 * 60 * 60_000;
const MAX_GAMES = 24;
const MAX_SERVERS_PER_GAME = 500;
const MAX_CONCURRENT_REQUESTS = 3;

export const DEFAULT_STEAM_GAMES = Object.freeze([
  Object.freeze({ id: '1874880', name: 'Arma Reforger' }),
  Object.freeze({ id: '730', name: 'Counter-Strike 2' }),
  Object.freeze({ id: '440', name: 'Team Fortress 2' }),
  Object.freeze({ id: '252490', name: 'Rust' }),
  Object.freeze({ id: '221100', name: 'DayZ' }),
  Object.freeze({ id: '393380', name: 'Squad' }),
  Object.freeze({ id: '108600', name: 'Project Zomboid' }),
  Object.freeze({ id: '2399830', name: 'ARK: Survival Ascended' }),
]);

export const STEAM_REGIONS = Object.freeze({
  0: Object.freeze({ name: 'US East', latitude: 38.5, longitude: -77.5 }),
  1: Object.freeze({ name: 'US West', latitude: 37.5, longitude: -122.2 }),
  2: Object.freeze({ name: 'South America', latitude: -23.5, longitude: -46.6 }),
  3: Object.freeze({ name: 'Europe', latitude: 50.1, longitude: 10.2 }),
  4: Object.freeze({ name: 'Asia', latitude: 34.8, longitude: 104.2 }),
  5: Object.freeze({ name: 'Australia', latitude: -33.9, longitude: 151.2 }),
  6: Object.freeze({ name: 'Middle East', latitude: 25.2, longitude: 45.1 }),
  7: Object.freeze({ name: 'Africa', latitude: 0.8, longitude: 20.1 }),
});

function cleanString(value, max = 240) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function boundedInteger(value, fallback, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

function configuredGames(value) {
  const requested = String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{1,10}$/.test(id))
    .slice(0, MAX_GAMES);
  if (!requested.length) return [...DEFAULT_STEAM_GAMES];
  const names = new Map(DEFAULT_STEAM_GAMES.map((game) => [game.id, game.name]));
  return [...new Set(requested)].map((id) => ({ id, name: names.get(id) || `Steam App ${id}` }));
}

function splitAddress(value) {
  const text = cleanString(value, 180);
  if (!text) return { address: null, port: null };
  const ipv6 = text.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6) return { address: ipv6[1], port: boundedInteger(ipv6[2], null, 1, 65535) };
  const ipv4 = text.match(/^(.+):(\d+)$/);
  if (ipv4) return { address: ipv4[1], port: boundedInteger(ipv4[2], null, 1, 65535) };
  return { address: text, port: null };
}

function cleanTags(value) {
  return [...new Set(String(value || '').split(',').map((tag) => cleanString(tag, 48)).filter(Boolean))].slice(0, 24);
}

export function normalizeSteamServer(resource, game) {
  if (!resource || typeof resource !== 'object' || !game) return null;
  const name = cleanString(resource.name, 240);
  const address = splitAddress(resource.addr);
  const identity = cleanString(resource.steamid || resource.addr, 128);
  if (!name || !identity) return null;
  const regionCode = boundedInteger(resource.region, 255, 0, 255);
  const region = STEAM_REGIONS[regionCode] || null;
  const players = boundedInteger(resource.players, 0, 0, 100000);
  const maxPlayers = boundedInteger(resource.max_players, 0, 0, 100000);
  return Object.freeze({
    id: `steam:${game.id}:${identity}`,
    provider: 'steam',
    gameId: game.id,
    gameName: game.name,
    name,
    status: 'online',
    ip: address.address,
    address: address.address,
    port: boundedInteger(resource.gameport, address.port, 1, 65535),
    queryPort: address.port,
    country: null,
    region: region?.name || 'Unspecified Steam region',
    city: null,
    latitude: region?.latitude ?? null,
    longitude: region?.longitude ?? null,
    players,
    maxPlayers,
    queue: null,
    rank: null,
    map: cleanString(resource.map, 160),
    scenario: cleanString(resource.gametype, 160),
    version: cleanString(resource.version, 80),
    description: null,
    passwordProtected: typeof resource.password === 'boolean' ? resource.password : null,
    secure: typeof resource.secure === 'boolean' ? resource.secure : Boolean(resource.secure),
    tags: cleanTags(resource.gametype),
    organizationName: null,
    firstSeenAt: null,
    lastSeenAt: null,
    updatedAt: new Date().toISOString(),
    sourceUrl: `https://store.steampowered.com/app/${encodeURIComponent(game.id)}`,
    locationAccuracy: region ? 'steam-region' : 'unknown',
  });
}

function retryDelay(response, attempt) {
  const seconds = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(seconds)) return Math.min(5000, Math.max(100, seconds * 1000));
  return Math.min(5000, 350 * (2 ** attempt));
}

function createRequestQueue(maxConcurrent = MAX_CONCURRENT_REQUESTS) {
  let active = 0;
  const pending = [];
  const drain = () => {
    while (active < maxConcurrent && pending.length) {
      const entry = pending.shift();
      active += 1;
      Promise.resolve()
        .then(entry.run)
        .then(entry.resolve, entry.reject)
        .finally(() => { active -= 1; drain(); });
    }
  };
  return (run) => new Promise((resolve, reject) => {
    pending.push({ run, resolve, reject });
    drain();
  });
}

export function createSteamGamingProvider(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const key = cleanString(options.key, 4096);
  const gamesCatalog = configuredGames(options.appIds);
  const cache = new Map();
  const inFlight = new Map();
  const requestQueue = createRequestQueue();

  const requestJson = async (url, attempt = 0) => {
    let response;
    try {
      response = await requestQueue(() => fetchImpl(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'ThunderLink-Gods-Eye/0.3.11' },
        signal: AbortSignal.timeout(15_000),
      }));
    } catch (cause) {
      if (attempt < 2) {
        await sleep(350 * (2 ** attempt));
        return requestJson(url, attempt + 1);
      }
      const error = new Error(cause?.name === 'TimeoutError' ? 'Steam request timed out' : 'Steam is temporarily unreachable');
      error.code = 'unreachable';
      throw error;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryDelay(response, attempt));
      return requestJson(url, attempt + 1);
    }
    if (response.status === 403 && attempt < 1) {
      await sleep(1200);
      return requestJson(url, attempt + 1);
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error('Steam rejected the configured Web API key');
      error.code = 'unauthorized';
      error.status = 503;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Steam rate limit reached' : `Steam returned HTTP ${response.status}`);
      error.code = response.status === 429 ? 'rate_limited' : 'upstream_response';
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    return response.json();
  };

  const cached = async (cacheKey, loader) => {
    const existing = cache.get(cacheKey);
    if (existing && now() - existing.cachedAt < CACHE_TTL_MS) return { ...existing.value, stale: false, cached: true };
    if (!inFlight.has(cacheKey)) inFlight.set(cacheKey, Promise.resolve().then(loader).finally(() => inFlight.delete(cacheKey)));
    try {
      const value = await inFlight.get(cacheKey);
      cache.set(cacheKey, { value, cachedAt: now() });
      return { ...value, stale: false, cached: false };
    } catch (error) {
      if (existing && now() - existing.cachedAt < STALE_TTL_MS) {
        return { ...existing.value, stale: true, cached: true, warning: error.message };
      }
      throw error;
    }
  };

  const loadPlayerCount = (game) => cached(`players:${game.id}`, async () => {
    const url = new URL('/ISteamUserStats/GetNumberOfCurrentPlayers/v1/', STEAM_API_BASE);
    url.searchParams.set('appid', game.id);
    const payload = await requestJson(url);
    return { players: boundedInteger(payload?.response?.player_count, 0, 0, 100000000) };
  });

  const loadServers = (game) => cached(`servers:${game.id}`, async () => {
    if (!key) {
      const error = new Error('Steam Game Activity requires STEAM_WEB_API_KEY configured in Railway');
      error.code = 'not_configured';
      error.status = 503;
      throw error;
    }
    const url = new URL('/IGameServersService/GetServerList/v1/', STEAM_API_BASE);
    url.searchParams.set('key', key);
    url.searchParams.set('limit', String(MAX_SERVERS_PER_GAME));
    url.searchParams.set('filter', `\\appid\\${game.id}\\dedicated\\1`);
    const payload = await requestJson(url);
    const rows = Array.isArray(payload?.response?.servers) ? payload.response.servers : [];
    return { servers: rows.map((row) => normalizeSteamServer(row, game)).filter(Boolean) };
  });

  const getGames = () => cached('games', async () => {
    const games = await Promise.all(gamesCatalog.map(async (game) => {
      const [population, serverResult] = await Promise.all([loadPlayerCount(game), loadServers(game)]);
      return Object.freeze({
        id: game.id,
        name: game.name,
        players: population.players,
        servers: serverResult.servers.length,
        publicPlayerLists: false,
      });
    }));
    return {
      games: games.sort((left, right) => right.players - left.players || left.name.localeCompare(right.name)),
      updatedAt: new Date(now()).toISOString(),
      authMode: 'steam',
    };
  });

  const getServers = async (query) => cached(`query:${JSON.stringify(query)}`, async () => {
    const gameIds = query.games.length ? new Set(query.games) : null;
    const selectedGames = gamesCatalog.filter((game) => !gameIds || gameIds.has(game.id));
    const results = await Promise.all(selectedGames.map((game) => loadServers(game)));
    let servers = results.flatMap((result) => result.servers);
    if (query.status !== 'all' && query.status !== 'online') servers = [];
    if (query.search) {
      const needle = query.search.toLowerCase();
      servers = servers.filter((server) => `${server.name} ${server.address || ''}`.toLowerCase().includes(needle));
    }
    servers = servers.filter((server) => server.players >= query.minPlayers && server.players <= query.maxPlayers);
    if (query.country) servers = [];
    servers.sort((left, right) => right.players - left.players || left.name.localeCompare(right.name));
    const partial = servers.length > query.limit;
    return {
      servers: servers.slice(0, query.limit),
      updatedAt: new Date(now()).toISOString(),
      authMode: 'steam',
      partial,
      request: { ...query, bbox: query.bbox || null },
    };
  });

  return Object.freeze({
    id: 'steam',
    name: 'Steam',
    getGames,
    getServers,
    tokenConfigured: Boolean(key),
    clearCache: () => cache.clear(),
  });
}

export const STEAM_GAMING_LIMITS = Object.freeze({
  cacheTtlMs: CACHE_TTL_MS,
  staleTtlMs: STALE_TTL_MS,
  maxGames: MAX_GAMES,
  maxServersPerGame: MAX_SERVERS_PER_GAME,
  maxConcurrentRequests: MAX_CONCURRENT_REQUESTS,
});
