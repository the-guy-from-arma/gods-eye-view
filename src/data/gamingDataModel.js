export const GAMING_DATA_STORAGE_KEY = 'thunderlink:gamingData:filters:v2';

export const DEFAULT_GAMING_DATA_FILTERS = Object.freeze({
  providerEnabled: true,
  markersEnabled: false,
  heatmapEnabled: true,
  clusteringEnabled: false,
  autoRefresh: true,
  publicPlayerNames: false,
  allGames: true,
  selectedGames: Object.freeze([]),
  gamesWithResultsOnly: false,
  onlineOnly: true,
  includeOffline: false,
  minPlayers: 0,
  maxPlayers: 100000,
  minCapacity: 0,
  maxCapacity: 100000,
  minRank: 0,
  country: '',
  region: '',
  map: '',
  scenario: '',
  passwordMode: 'any',
  slotMode: 'any',
  recentlyUpdatedMinutes: 0,
  serverSearch: '',
  identitySearch: '',
  visualizationMode: 'heatmap',
  heatIntensity: 65,
  heatRadius: 55,
  heatOpacity: 52,
  markerScaleByPopulation: true,
  clusterRadius: 46,
  colorMode: 'population',
  labelsVisible: false,
  labelMinimumZoom: 9,
  refreshIntervalSec: 300,
});

const ENUMS = Object.freeze({
  passwordMode: ['any', 'protected', 'unprotected'],
  slotMode: ['any', 'full', 'open'],
  visualizationMode: ['markers', 'heatmap', 'combined'],
  colorMode: ['population', 'game', 'status'],
});

const BOOLEAN_KEYS = [
  'providerEnabled', 'markersEnabled', 'heatmapEnabled', 'clusteringEnabled', 'autoRefresh',
  'allGames', 'gamesWithResultsOnly', 'onlineOnly', 'includeOffline', 'markerScaleByPopulation', 'labelsVisible',
];

const INTEGER_RANGES = Object.freeze({
  minPlayers: [0, 100000],
  maxPlayers: [0, 100000],
  minCapacity: [0, 100000],
  maxCapacity: [0, 100000],
  minRank: [0, 1000000],
  recentlyUpdatedMinutes: [0, 10080],
  heatIntensity: [1, 100],
  heatRadius: [10, 100],
  heatOpacity: [5, 100],
  clusterRadius: [20, 120],
  labelMinimumZoom: [1, 18],
  refreshIntervalSec: [300, 3600],
});

function boundedInteger(value, fallback, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.trunc(numeric))) : fallback;
}

function cleanText(value, max = 100) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeGamingDataFilters(candidate = {}) {
  const input = candidate && typeof candidate === 'object' ? candidate : {};
  const next = { ...DEFAULT_GAMING_DATA_FILTERS };
  for (const key of BOOLEAN_KEYS) if (typeof input[key] === 'boolean') next[key] = input[key];
  for (const [key, [min, max]] of Object.entries(INTEGER_RANGES)) {
    next[key] = boundedInteger(input[key], next[key], min, max);
  }
  for (const [key, values] of Object.entries(ENUMS)) if (values.includes(input[key])) next[key] = input[key];
  for (const key of ['country', 'region', 'map', 'scenario', 'serverSearch', 'identitySearch']) {
    next[key] = cleanText(input[key], key.includes('Search') ? 120 : 80);
  }
  const games = Array.isArray(input.selectedGames) ? input.selectedGames : [];
  next.selectedGames = [...new Set(games.map((value) => cleanText(value, 64).toLowerCase())
    .filter((value) => /^[a-z0-9_-]+$/.test(value)))].slice(0, 24);
  next.publicPlayerNames = false;
  if (next.minPlayers > next.maxPlayers) [next.minPlayers, next.maxPlayers] = [next.maxPlayers, next.minPlayers];
  if (next.minCapacity > next.maxCapacity) [next.minCapacity, next.maxCapacity] = [next.maxCapacity, next.minCapacity];
  if (next.visualizationMode === 'markers') next.heatmapEnabled = false;
  if (next.visualizationMode === 'heatmap') next.markersEnabled = false;
  if (next.visualizationMode === 'combined') {
    next.markersEnabled = true;
    next.heatmapEnabled = true;
  }
  return next;
}

export function resetGamingDataFilters() {
  return normalizeGamingDataFilters(DEFAULT_GAMING_DATA_FILTERS);
}

function includesText(value, query) {
  return !query || String(value || '').toLowerCase().includes(query.toLowerCase());
}

export function serverHasCoordinates(server) {
  return Number.isFinite(server?.latitude)
    && Number.isFinite(server?.longitude)
    && Math.abs(server.latitude) <= 90
    && Math.abs(server.longitude) <= 180;
}

export function serverInBounds(server, bounds) {
  if (!bounds || !serverHasCoordinates(server)) return true;
  const latOk = server.latitude >= bounds.south && server.latitude <= bounds.north;
  const lonOk = bounds.west <= bounds.east
    ? server.longitude >= bounds.west && server.longitude <= bounds.east
    : server.longitude >= bounds.west || server.longitude <= bounds.east;
  return latOk && lonOk;
}

export function filterGamingServers(servers, filters, bounds = null, now = Date.now()) {
  const state = normalizeGamingDataFilters(filters);
  const selectedGames = new Set(state.selectedGames);
  return (Array.isArray(servers) ? servers : []).filter((server) => {
    if (!state.allGames && selectedGames.size === 0) return false;
    if (!state.allGames && selectedGames.size && !selectedGames.has(server.gameId)) return false;
    if (state.onlineOnly && server.status !== 'online') return false;
    if (!state.includeOffline && server.status === 'offline') return false;
    if (server.players < state.minPlayers || server.players > state.maxPlayers) return false;
    if (server.maxPlayers < state.minCapacity || server.maxPlayers > state.maxCapacity) return false;
    if (state.minRank > 0 && (!Number.isFinite(server.rank) || server.rank < state.minRank)) return false;
    if (state.country && String(server.country || '').toLowerCase() !== state.country.toLowerCase()) return false;
    if (!includesText(server.region, state.region)) return false;
    if (!includesText(server.map, state.map)) return false;
    if (!includesText(server.scenario, state.scenario)) return false;
    if (state.passwordMode === 'protected' && server.passwordProtected !== true) return false;
    if (state.passwordMode === 'unprotected' && server.passwordProtected !== false) return false;
    if (state.slotMode === 'full' && !(server.maxPlayers > 0 && server.players >= server.maxPlayers)) return false;
    if (state.slotMode === 'open' && !(server.maxPlayers > server.players)) return false;
    if (state.recentlyUpdatedMinutes > 0) {
      const updated = Date.parse(server.updatedAt || '');
      if (!Number.isFinite(updated) || now - updated > state.recentlyUpdatedMinutes * 60_000) return false;
    }
    if (!includesText(server.name, state.serverSearch)) return false;
    if (state.identitySearch) {
      const identity = `${server.id || ''} ${server.address || ''} ${server.ip || ''}:${server.queryPort || server.port || ''}`;
      if (!includesText(identity, state.identitySearch)) return false;
    }
    return serverInBounds(server, bounds);
  });
}

export function gamingOverview(servers, lastUpdate = null) {
  const rows = Array.isArray(servers) ? servers : [];
  const online = rows.filter((server) => server.status === 'online');
  const totalPlayers = rows.reduce((sum, server) => sum + Math.max(0, Number(server.players) || 0), 0);
  const gamePlayers = new Map();
  for (const server of rows) gamePlayers.set(server.gameName, (gamePlayers.get(server.gameName) || 0) + (server.players || 0));
  const mostPopulatedGame = [...gamePlayers].sort((a, b) => b[1] - a[1])[0] || null;
  const mostPopulatedServer = [...rows].sort((a, b) => (b.players || 0) - (a.players || 0))[0] || null;
  const utilizationRows = rows.filter((server) => server.maxPlayers > 0);
  const averageUtilization = utilizationRows.length
    ? utilizationRows.reduce((sum, server) => sum + Math.min(1, server.players / server.maxPlayers), 0) / utilizationRows.length
    : 0;
  return {
    visibleServers: rows.length,
    onlineServers: online.length,
    totalPlayers,
    gamesRepresented: gamePlayers.size,
    mostPopulatedGame,
    mostPopulatedServer,
    averageUtilization,
    lastUpdate,
  };
}

export function heatCellSizeDegrees(cameraHeight = 20_000_000) {
  if (cameraHeight > 10_000_000) return 8;
  if (cameraHeight > 4_000_000) return 4;
  if (cameraHeight > 1_200_000) return 2;
  if (cameraHeight > 350_000) return 0.75;
  return 0.25;
}

export function aggregateGamingHeat(servers, cellSizeDegrees = 4) {
  const size = Math.max(0.1, Number(cellSizeDegrees) || 4);
  const cells = new Map();
  for (const server of Array.isArray(servers) ? servers : []) {
    if (!serverHasCoordinates(server)) continue;
    const latIndex = Math.floor((server.latitude + 90) / size);
    const lonIndex = Math.floor((server.longitude + 180) / size);
    const key = `${latIndex}:${lonIndex}`;
    const cell = cells.get(key) || {
      id: key,
      latitudeSum: 0,
      longitudeSum: 0,
      coordinateWeight: 0,
      weight: 0,
      serverCount: 0,
      players: 0,
    };
    const players = Math.max(0, Number(server.players) || 0);
    const coordinateWeight = Math.max(1, players);
    cell.latitudeSum += server.latitude * coordinateWeight;
    cell.longitudeSum += server.longitude * coordinateWeight;
    cell.coordinateWeight += coordinateWeight;
    cell.weight += players;
    cell.players += players;
    cell.serverCount += 1;
    cells.set(key, cell);
  }
  return [...cells.values()].map((cell) => Object.freeze({
    id: cell.id,
    latitude: cell.latitudeSum / cell.coordinateWeight,
    longitude: cell.longitudeSum / cell.coordinateWeight,
    weight: cell.weight,
    players: cell.players,
    serverCount: cell.serverCount,
    cellSizeDegrees: size,
  }));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnit(value) {
  let state = stableHash(value) || 1;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 4294967296;
}

function wrapLongitude(value) {
  return ((value + 540) % 360) - 180;
}

/**
 * Builds a Call-of-Duty-style globe activity field from aggregate Steam data.
 * Dots are deterministic visual samples, not individual people. Their regional
 * allocation estimates the selected games' global concurrency using the public
 * game-server distribution observed in the same response.
 */
export function buildGamingActivityField(servers, games, filters = {}, options = {}) {
  const rows = (Array.isArray(servers) ? servers : []).filter(serverHasCoordinates);
  const selected = new Set(Array.isArray(filters.selectedGames) ? filters.selectedGames : []);
  const allGames = filters.allGames !== false;
  const gameRows = (Array.isArray(games) ? games : []).filter((game) => allGames || selected.has(String(game.id)));
  const globalPlayers = gameRows.reduce((sum, game) => sum + Math.max(0, Number(game.players) || 0), 0);
  const groups = new Map();
  for (const server of rows) {
    const regionName = String(server.region || server.country || 'Unspecified region');
    const coordinateKey = `${Number(server.latitude).toFixed(2)}:${Number(server.longitude).toFixed(2)}`;
    const key = `${regionName}|${coordinateKey}`;
    const group = groups.get(key) || {
      id: `gaming-region:${stableHash(key).toString(36)}`,
      name: regionName,
      latitude: Number(server.latitude),
      longitude: Number(server.longitude),
      serverCount: 0,
      observedPlayers: 0,
      gameIds: new Set(),
    };
    group.serverCount += 1;
    group.observedPlayers += Math.max(0, Number(server.players) || 0);
    group.gameIds.add(String(server.gameId || 'unknown'));
    groups.set(key, group);
  }
  const regions = [...groups.values()];
  const totalObservedPlayers = regions.reduce((sum, region) => sum + region.observedPlayers, 0);
  const totalServers = regions.reduce((sum, region) => sum + region.serverCount, 0);
  for (const region of regions) {
    const share = totalObservedPlayers > 0
      ? region.observedPlayers / totalObservedPlayers
      : (totalServers > 0 ? region.serverCount / totalServers : 0);
    region.estimatedPlayers = globalPlayers > 0 ? Math.round(globalPlayers * share) : region.observedPlayers;
    region.share = share;
    region.gameCount = region.gameIds.size;
    delete region.gameIds;
  }
  regions.sort((left, right) => right.estimatedPlayers - left.estimatedPlayers || left.name.localeCompare(right.name));

  const maxDots = Math.max(180, Math.min(2400, Number(options.maxDots) || 1400));
  const densityWeights = regions.map((region) => Math.sqrt(Math.max(1, region.estimatedPlayers || region.serverCount)));
  const densityTotal = densityWeights.reduce((sum, value) => sum + value, 0) || 1;
  const spread = 1.8 + Math.max(0, Math.min(100, Number(filters.heatRadius) || 55)) * 0.105;
  const opacity = Math.max(0.12, Math.min(1, (Number(filters.heatOpacity) || 52) / 100));
  const intensity = Math.max(0.2, Math.min(1, (Number(filters.heatIntensity) || 65) / 100));
  const dots = [];
  regions.forEach((region, regionIndex) => {
    const dotCount = Math.max(3, Math.round(maxDots * densityWeights[regionIndex] / densityTotal));
    for (let index = 0; index < dotCount; index += 1) {
      const radial = Math.sqrt(stableUnit(`${region.id}:radius:${index}`));
      const angle = stableUnit(`${region.id}:angle:${index}`) * Math.PI * 2;
      const latitude = Math.max(-84, Math.min(84, region.latitude + Math.sin(angle) * radial * spread));
      const longitudeScale = Math.max(0.24, Math.cos(region.latitude * Math.PI / 180));
      const longitude = wrapLongitude(region.longitude + Math.cos(angle) * radial * spread / longitudeScale);
      const pulse = stableUnit(`${region.id}:pulse:${index}`);
      dots.push(Object.freeze({
        id: `${region.id}:dot:${index}`,
        regionId: region.id,
        latitude,
        longitude,
        pixelSize: 1.6 + pulse * 2.2 + intensity * 0.7,
        opacity: opacity * (0.58 + pulse * 0.42),
        green: pulse < (0.3 + Math.min(0.5, region.share * 2.5)),
      }));
    }
  });
  return Object.freeze({
    dots: Object.freeze(dots),
    regions: Object.freeze(regions.map((region) => Object.freeze({ ...region }))),
    globalPlayers,
    observedPlayers: totalObservedPlayers,
    serverCount: totalServers,
    methodology: 'Regional estimate from Steam global concurrency and public game-server distribution; dots are not people.',
  });
}

export function clusterGamingServers(servers, radiusDegrees = 4) {
  return aggregateGamingHeat(servers, radiusDegrees).map((cell) => ({
    ...cell,
    count: cell.serverCount,
  }));
}

export function markerDescriptor(server, filters) {
  if (!serverHasCoordinates(server)) return null;
  const population = Math.max(0, Number(server.players) || 0);
  const size = filters?.markerScaleByPopulation ? Math.min(22, 7 + Math.sqrt(population) * 0.7) : 9;
  return Object.freeze({
    id: `gaming:${server.id}`,
    latitude: server.latitude,
    longitude: server.longitude,
    size,
    weight: population,
    server,
  });
}
