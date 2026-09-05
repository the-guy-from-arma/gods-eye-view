const API_BASE = 'https://api.battlemetrics.com';
const CACHE_TTL_MS = 5 * 60_000;
const STALE_TTL_MS = 24 * 60 * 60_000;
const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 12;
const MAX_GAMES_PER_REQUEST = 24;

function cleanString(value, max = 240) {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteInteger(value) {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.trunc(numeric);
}

function booleanValue(value) {
  return typeof value === 'boolean' ? value : null;
}

function validIso(value) {
  const text = cleanString(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function detailValue(details, paths) {
  for (const path of paths) {
    let cursor = details;
    for (const key of path.split('.')) cursor = cursor && typeof cursor === 'object' ? cursor[key] : null;
    if (cursor !== null && cursor !== undefined && cursor !== '') return cursor;
  }
  return null;
}

function cleanTags(value) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,|]/) : []);
  return [...new Set(source.map((entry) => cleanString(entry, 48)).filter(Boolean))].slice(0, 24);
}

/**
 * BattleMetrics documents the location tuple as longitude/latitude, while its
 * own Seattle response example is [47.614, -122.196] (latitude/longitude).
 * Prefer the observed/example order and only swap when the first value cannot
 * be a latitude. Invalid coordinates remain unmapped rather than becoming 0,0.
 */
export function normalizeBattleMetricsLocation(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = finiteNumber(value[0]);
  const second = finiteNumber(value[1]);
  if (first === null || second === null) return null;
  let latitude = first;
  let longitude = second;
  if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
    latitude = second;
    longitude = first;
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function normalizeBattleMetricsGame(resource) {
  if (!resource || resource.type !== 'game') return null;
  const id = cleanString(resource.id, 64);
  const name = cleanString(resource.attributes?.name, 160);
  if (!id || !name) return null;
  return Object.freeze({
    id,
    name,
    players: Math.max(0, finiteInteger(resource.attributes?.players) ?? 0),
    servers: Math.max(0, finiteInteger(resource.attributes?.servers) ?? 0),
    publicPlayerLists: resource.attributes?.metadata?.noPlayerList !== true,
  });
}

export function normalizeBattleMetricsServer(resource, gamesById = new Map()) {
  if (!resource || resource.type !== 'server') return null;
  const attributes = resource.attributes && typeof resource.attributes === 'object' ? resource.attributes : {};
  const id = cleanString(resource.id || attributes.id, 64);
  const gameId = cleanString(resource.relationships?.game?.data?.id, 64) || 'unknown';
  const name = cleanString(attributes.name, 240);
  if (!id || !name || attributes.private === true) return null;
  const details = attributes.details && typeof attributes.details === 'object' ? attributes.details : {};
  const location = normalizeBattleMetricsLocation(attributes.location);
  const upstreamStatus = cleanString(attributes.status, 32)?.toLowerCase();
  const status = upstreamStatus === 'online' || upstreamStatus === 'offline'
    ? upstreamStatus
    : (upstreamStatus === 'dead' || upstreamStatus === 'removed' ? 'dead' : 'unknown');
  const map = cleanString(detailValue(details, ['map', 'mapName', 'rust_header.map', 'minecraft.map']), 160);
  const scenario = cleanString(detailValue(details, ['scenario', 'mission', 'missionName', 'gameMode', 'gamemode']), 160);
  const version = cleanString(detailValue(details, ['version', 'serverVersion', 'gameVersion']), 80);
  const region = cleanString(detailValue(details, ['region', 'state', 'province']), 100);
  const city = cleanString(detailValue(details, ['city']), 100);
  const description = cleanString(detailValue(details, ['description', 'serverDescription']), 600);
  const passwordProtected = booleanValue(detailValue(details, ['password', 'passwordProtected', 'locked']));
  const secure = booleanValue(detailValue(details, ['secure', 'battleye', 'vac']));
  const queue = finiteInteger(detailValue(details, ['queue', 'queuedPlayers', 'rust_queued_players']));
  const organizationName = cleanString(detailValue(details, ['organization', 'organizationName']), 160);
  const tags = cleanTags(detailValue(details, ['tags', 'keywords', 'rust_header.tags']));
  return Object.freeze({
    id,
    provider: 'battlemetrics',
    gameId,
    gameName: gamesById.get(gameId)?.name || gameId,
    name,
    status,
    ip: cleanString(attributes.ip, 128),
    address: cleanString(attributes.address, 180),
    port: finiteInteger(attributes.port),
    queryPort: finiteInteger(attributes.portQuery),
    country: cleanString(attributes.country, 2)?.toUpperCase() || null,
    region,
    city,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    players: Math.max(0, finiteInteger(attributes.players) ?? 0),
    maxPlayers: Math.max(0, finiteInteger(attributes.maxPlayers) ?? 0),
    queue: queue === null ? null : Math.max(0, queue),
    rank: finiteInteger(attributes.rank),
    map,
    scenario,
    version,
    description,
    passwordProtected,
    secure,
    tags,
    organizationName,
    firstSeenAt: validIso(attributes.createdAt),
    lastSeenAt: validIso(attributes.updatedAt),
    updatedAt: validIso(attributes.updatedAt),
    sourceUrl: `https://www.battlemetrics.com/servers/${encodeURIComponent(gameId)}/${encodeURIComponent(id)}`,
    locationAccuracy: location ? (city || region ? 'region' : 'datacenter') : (attributes.country ? 'country' : 'unknown'),
  });
}

function boundedInteger(value, fallback, min, max) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.trunc(numeric))) : fallback;
}

function cleanGameIds(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((entry) => String(entry).trim().toLowerCase())
    .filter((entry) => /^[a-z0-9_-]{1,64}$/.test(entry)))].slice(0, MAX_GAMES_PER_REQUEST);
}

export function normalizeGamingQuery(searchParams = new URLSearchParams()) {
  const status = ['online', 'offline', 'dead', 'all'].includes(searchParams.get('status'))
    ? searchParams.get('status')
    : 'online';
  const minPlayers = boundedInteger(searchParams.get('minPlayers'), 0, 0, 100000);
  const maxPlayers = boundedInteger(searchParams.get('maxPlayers'), 100000, minPlayers, 100000);
  const country = cleanString(searchParams.get('country'), 2)?.toUpperCase();
  const bboxValues = String(searchParams.get('bbox') || '').split(',').map(Number);
  const bbox = bboxValues.length === 4 && bboxValues.every(Number.isFinite)
    ? {
      west: Math.max(-180, Math.min(180, bboxValues[0])),
      south: Math.max(-90, Math.min(90, bboxValues[1])),
      east: Math.max(-180, Math.min(180, bboxValues[2])),
      north: Math.max(-90, Math.min(90, bboxValues[3])),
    }
    : null;
  return Object.freeze({
    games: cleanGameIds(searchParams.getAll('game').length ? searchParams.getAll('game') : searchParams.get('games')),
    search: cleanString(searchParams.get('search'), 100),
    status,
    minPlayers,
    maxPlayers,
    country: /^[A-Z]{2}$/.test(country || '') ? country : null,
    limit: boundedInteger(searchParams.get('limit'), 600, 1, 1200),
    bbox: bbox && bbox.south <= bbox.north ? bbox : null,
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function boundsToBattleMetricsLocation(bbox) {
  if (!bbox) return null;
  const longitude = bbox.west <= bbox.east
    ? (bbox.west + bbox.east) / 2
    : (((bbox.west + bbox.east + 360) / 2 + 540) % 360) - 180;
  const latitude = (bbox.south + bbox.north) / 2;
  const distance = Math.ceil(Math.max(
    haversineKm(latitude, longitude, bbox.south, bbox.west),
    haversineKm(latitude, longitude, bbox.north, bbox.east),
  ));
  return { longitude, latitude, maxDistance: Math.min(20000, Math.max(10, distance)) };
}

function queryKey(query) {
  return JSON.stringify(query);
}

function retryAfterMs(response, attempt) {
  const raw = response.headers?.get?.('retry-after');
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(5000, Math.max(100, seconds * 1000));
  return Math.min(5000, 350 * (2 ** attempt));
}

function safeNextLink(value) {
  if (!value) return null;
  try {
    const url = new URL(value, API_BASE);
    return url.origin === API_BASE && url.pathname === '/servers' ? url.href : null;
  } catch {
    return null;
  }
}

function validateDocument(payload, expectedType) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new Error('BattleMetrics returned an invalid JSON:API document');
  }
  if (payload.data.some((entry) => !entry || entry.type !== expectedType)) {
    throw new Error(`BattleMetrics returned an unexpected ${expectedType} resource`);
  }
  return payload;
}

export function createBattleMetricsProvider(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const token = cleanString(options.token, 4096);
  const cache = new Map();
  const inFlight = new Map();

  const requestJson = async (url, attempt = 0) => {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ThunderLink-Gods-Eye/0.3.08',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      if (attempt < 2) {
        await sleep(350 * (2 ** attempt));
        return requestJson(url, attempt + 1);
      }
      throw new Error(cause?.name === 'TimeoutError'
        ? 'BattleMetrics request timed out'
        : 'BattleMetrics is temporarily unreachable');
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(retryAfterMs(response, attempt));
      return requestJson(url, attempt + 1);
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error('BattleMetrics rejected the configured token');
      error.code = 'unauthorized';
      error.status = 503;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(response.status === 429
        ? 'BattleMetrics rate limit reached'
        : `BattleMetrics returned HTTP ${response.status}`);
      error.code = response.status === 429 ? 'rate_limited' : 'upstream_response';
      error.status = response.status === 429 ? 429 : 502;
      error.retryAfterSec = Math.ceil(retryAfterMs(response, attempt) / 1000);
      throw error;
    }
    return response.json();
  };

  const cached = async (key, loader) => {
    const existing = cache.get(key);
    if (existing && now() - existing.cachedAt < CACHE_TTL_MS) return { ...existing.value, stale: false, cached: true };
    if (!inFlight.has(key)) inFlight.set(key, Promise.resolve().then(loader).finally(() => inFlight.delete(key)));
    try {
      const value = await inFlight.get(key);
      cache.set(key, { value, cachedAt: now() });
      return { ...value, stale: false, cached: false };
    } catch (error) {
      if (existing && now() - existing.cachedAt < STALE_TTL_MS) {
        return { ...existing.value, stale: true, cached: true, warning: error.message };
      }
      throw error;
    }
  };

  const getGames = () => cached('games', async () => {
    const url = new URL('/games', API_BASE);
    url.searchParams.set('page[size]', '100');
    const payload = validateDocument(await requestJson(url), 'game');
    const games = payload.data.map(normalizeBattleMetricsGame).filter(Boolean)
      .sort((left, right) => right.players - left.players || left.name.localeCompare(right.name));
    return { games, updatedAt: new Date(now()).toISOString(), authMode: token ? 'authenticated' : 'public' };
  });

  const getServers = async (query) => cached(`servers:${queryKey(query)}`, async () => {
    const gamesResult = await getGames();
    const gamesById = new Map(gamesResult.games.map((game) => [game.id, game]));
    const gameScopes = query.games.length ? query.games : [null];
    const rows = new Map();
    let partial = false;
    for (const gameId of gameScopes) {
      const scopeStartSize = rows.size;
      const scopeLimit = gameScopes.length === 1
        ? query.limit
        : Math.max(1, Math.ceil(query.limit / gameScopes.length));
      let page = 0;
      let nextUrl = null;
      do {
        const url = nextUrl ? new URL(nextUrl) : new URL('/servers', API_BASE);
        if (!nextUrl) {
          url.searchParams.set('page[size]', String(Math.min(MAX_PAGE_SIZE, scopeLimit)));
          url.searchParams.set('sort', '-players');
          if (gameId) url.searchParams.set('filter[game]', gameId);
          if (query.search) url.searchParams.set('filter[search]', query.search);
          if (query.status !== 'all') url.searchParams.set('filter[status]', query.status);
          url.searchParams.set('filter[players][min]', String(query.minPlayers));
          url.searchParams.set('filter[players][max]', String(query.maxPlayers));
          if (query.country) url.searchParams.append('filter[countries][]', query.country);
          const geo = boundsToBattleMetricsLocation(query.bbox);
          if (geo && geo.maxDistance < 12000) {
            url.searchParams.set('location', `${geo.longitude},${geo.latitude}`);
            url.searchParams.set('filter[maxDistance]', String(geo.maxDistance));
          }
        }
        const payload = validateDocument(await requestJson(url), 'server');
        for (const resource of payload.data) {
          const server = normalizeBattleMetricsServer(resource, gamesById);
          if (server) rows.set(server.id, server);
          if (rows.size - scopeStartSize >= scopeLimit || rows.size >= query.limit) break;
        }
        const candidateNext = safeNextLink(payload.links?.next);
        const scopeFull = rows.size - scopeStartSize >= scopeLimit;
        nextUrl = !scopeFull && rows.size < query.limit ? candidateNext : null;
        if (candidateNext && (scopeFull || rows.size >= query.limit)) partial = true;
        page += 1;
        if (page >= MAX_PAGES && nextUrl) partial = true;
      } while (nextUrl && page < MAX_PAGES && rows.size - scopeStartSize < scopeLimit && rows.size < query.limit);
      if (rows.size >= query.limit) break;
    }
    return {
      servers: [...rows.values()],
      updatedAt: new Date(now()).toISOString(),
      authMode: token ? 'authenticated' : 'public',
      partial,
      request: { ...query, bbox: query.bbox || null },
    };
  });

  return Object.freeze({
    id: 'battlemetrics',
    name: 'BattleMetrics',
    getGames,
    getServers,
    tokenConfigured: Boolean(token),
    clearCache: () => cache.clear(),
  });
}

export const BATTLEMETRICS_LIMITS = Object.freeze({
  cacheTtlMs: CACHE_TTL_MS,
  staleTtlMs: STALE_TTL_MS,
  maxPageSize: MAX_PAGE_SIZE,
  maxPages: MAX_PAGES,
  maxGamesPerRequest: MAX_GAMES_PER_REQUEST,
});
