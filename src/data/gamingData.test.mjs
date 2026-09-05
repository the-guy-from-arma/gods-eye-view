import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aggregateGamingHeat,
  clusterGamingServers,
  filterGamingServers,
  markerDescriptor,
  normalizeGamingDataFilters,
  resetGamingDataFilters,
} from './gamingDataModel.js';
import {
  createBattleMetricsProvider,
  normalizeBattleMetricsLocation,
  normalizeBattleMetricsServer,
  normalizeGamingQuery,
} from '../../server/gaming/battleMetricsProvider.js';

const game = { id: 'reforger', name: 'Arma Reforger' };

function resource(overrides = {}) {
  return {
    type: 'server',
    id: '42',
    attributes: {
      id: '42',
      name: 'Test Reforger Server',
      ip: '203.0.113.20',
      address: 'play.example.test',
      port: 2001,
      portQuery: 17777,
      players: 100,
      maxPlayers: 128,
      rank: 8,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-09-05T12:00:00Z',
      location: [40.7, -74],
      country: 'US',
      status: 'online',
      details: { map: 'Everon', scenario: 'Conflict', version: '1.4', password: false, secure: true, queue: 4, tags: ['modded'] },
      private: false,
      ...overrides,
    },
    relationships: { game: { data: { type: 'game', id: 'reforger' } } },
  };
}

test('BattleMetrics normalization keeps public server fields and omits missing values safely', () => {
  const normalized = normalizeBattleMetricsServer(resource(), new Map([[game.id, game]]));
  assert.equal(normalized.gameName, 'Arma Reforger');
  assert.equal(normalized.latitude, 40.7);
  assert.equal(normalized.longitude, -74);
  assert.equal(normalized.queue, 4);
  assert.equal(normalized.passwordProtected, false);
  assert.match(normalized.sourceUrl, /battlemetrics\.com\/servers\/reforger\/42/);
  const sparse = normalizeBattleMetricsServer(resource({ location: null, details: null, maxPlayers: null }), new Map());
  assert.equal(sparse.latitude, null);
  assert.equal(sparse.longitude, null);
  assert.equal(sparse.map, null);
  assert.equal(sparse.locationAccuracy, 'country');
  assert.equal(normalizeBattleMetricsServer(resource({ private: true })), null);
});

test('BattleMetrics location accepts its documented example and rejects invalid or missing coordinates', () => {
  assert.deepEqual(normalizeBattleMetricsLocation([47.6140999, -122.1966574]), { latitude: 47.6140999, longitude: -122.1966574 });
  assert.deepEqual(normalizeBattleMetricsLocation([-122.1966574, 47.6140999]), { latitude: 47.6140999, longitude: -122.1966574 });
  assert.equal(normalizeBattleMetricsLocation([0, 999]), null);
  assert.equal(normalizeBattleMetricsLocation(null), null);
});

test('Gaming filters isolate games, population, status, geography and identity', () => {
  const base = normalizeBattleMetricsServer(resource(), new Map([[game.id, game]]));
  const offline = { ...base, id: '43', status: 'offline', players: 0, latitude: 50, longitude: 10 };
  const filtered = filterGamingServers([base, offline], {
    ...resetGamingDataFilters(),
    allGames: false,
    selectedGames: ['reforger'],
    minPlayers: 50,
    maxPlayers: 110,
    country: 'US',
    map: 'ever',
    scenario: 'conf',
    serverSearch: 'test',
    identitySearch: '17777',
  }, { west: -80, south: 35, east: -70, north: 45 });
  assert.deepEqual(filtered.map((server) => server.id), ['42']);
});

test('heat aggregation is population weighted, clustered, deduplicated, and skips unmapped servers', () => {
  const rows = [
    { id: 'a', latitude: 10, longitude: 10, players: 100 },
    { id: 'b', latitude: 10.1, longitude: 10.1, players: 10 },
    { id: 'c', latitude: null, longitude: null, players: 999 },
  ];
  const heat = aggregateGamingHeat(rows, 1);
  assert.equal(heat.length, 1);
  assert.equal(heat[0].weight, 110);
  assert.ok(heat[0].latitude < 10.02, 'larger server must pull weighted center closer');
  assert.equal(clusterGamingServers(rows, 1)[0].count, 2);
  assert.equal(markerDescriptor(rows[2], resetGamingDataFilters()), null);
  assert.ok(markerDescriptor(rows[0], resetGamingDataFilters()).size > markerDescriptor(rows[1], resetGamingDataFilters()).size);
});

test('Gaming Data reset cannot retain player names or mutate unrelated state', () => {
  const unrelated = Object.freeze({ flights: true, radio: { volume: 0.4 } });
  const filters = normalizeGamingDataFilters({ publicPlayerNames: true, selectedGames: ['REFORGER'], visualizationMode: 'markers' });
  assert.equal(filters.publicPlayerNames, false);
  assert.deepEqual(filters.selectedGames, ['reforger']);
  assert.equal(filters.heatmapEnabled, false);
  assert.deepEqual(unrelated, { flights: true, radio: { volume: 0.4 } });
  assert.deepEqual(resetGamingDataFilters().selectedGames, []);
  assert.equal(resetGamingDataFilters().allGames, true);
  assert.deepEqual(filterGamingServers([normalizeBattleMetricsServer(resource())], {
    ...resetGamingDataFilters(), allGames: false, selectedGames: [],
  }), []);
});

function jsonResponse(data, { status = 200, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => data,
  };
}

const gamesDocument = {
  data: [{ type: 'game', id: 'reforger', attributes: { name: 'Arma Reforger', players: 300, servers: 10, metadata: { noPlayerList: false } } }],
  links: {},
};

test('provider sends optional bearer auth, follows safe pagination, retries 429, and deduplicates', async () => {
  const calls = [];
  let serverPageAttempts = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/games')) return jsonResponse(gamesDocument);
    serverPageAttempts += 1;
    if (serverPageAttempts === 1) return jsonResponse({}, { status: 429, retryAfter: '0' });
    if (!String(url).includes('page%5Bkey%5D=next')) {
      return jsonResponse({ data: [resource()], links: { next: 'https://api.battlemetrics.com/servers?page%5Bsize%5D=100&page%5Bkey%5D=next' } });
    }
    return jsonResponse({ data: [{ ...resource({ players: 22 }), id: '43' }], links: {} });
  };
  const provider = createBattleMetricsProvider({ fetchImpl, token: 'server-secret', sleep: async () => {} });
  const query = normalizeGamingQuery(new URLSearchParams({ status: 'online', limit: '2' }));
  const first = provider.getServers(query);
  const second = provider.getServers(query);
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.servers.map((server) => server.id), ['42', '43']);
  assert.deepEqual(b.servers.map((server) => server.id), ['42', '43']);
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer server-secret'));
  assert.equal(calls.filter((call) => call.url.includes('/games')).length, 1);
  assert.ok(serverPageAttempts >= 3);
});

test('provider serves a stale last-good snapshot after a temporary outage', async () => {
  let clock = 1_000_000;
  let failing = false;
  const fetchImpl = async (url) => {
    if (failing) throw new Error('offline');
    if (String(url).includes('/games')) return jsonResponse(gamesDocument);
    return jsonResponse({ data: [resource()], links: {} });
  };
  const provider = createBattleMetricsProvider({ fetchImpl, now: () => clock, sleep: async () => {} });
  const query = normalizeGamingQuery(new URLSearchParams({ limit: '1' }));
  const fresh = await provider.getServers(query);
  assert.equal(fresh.stale, false);
  clock += 6 * 60_000;
  failing = true;
  const stale = await provider.getServers(query);
  assert.equal(stale.stale, true);
  assert.equal(stale.cached, true);
  assert.match(stale.warning, /unreachable/i);
});

test('multi-game requests divide the result budget fairly instead of exhausting it on the first game', async () => {
  const serverCalls = [];
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes('/games')) return jsonResponse({
      data: [
        ...gamesDocument.data,
        { type: 'game', id: 'rust', attributes: { name: 'Rust', players: 200, servers: 8 } },
      ],
      links: {},
    });
    serverCalls.push(text);
    const gameId = new URL(text).searchParams.get('filter[game]');
    return jsonResponse({
      data: [
        { ...resource(), id: `${gameId}-1`, relationships: { game: { data: { type: 'game', id: gameId } } } },
        { ...resource(), id: `${gameId}-2`, relationships: { game: { data: { type: 'game', id: gameId } } } },
      ],
      links: {},
    });
  };
  const provider = createBattleMetricsProvider({ fetchImpl });
  const query = normalizeGamingQuery(new URLSearchParams('game=reforger&game=rust&limit=4'));
  const result = await provider.getServers(query);
  assert.deepEqual(new Set(result.servers.map((server) => server.gameId)), new Set(['reforger', 'rust']));
  assert.equal(serverCalls.length, 2);
  assert.ok(serverCalls.every((url) => new URL(url).searchParams.get('page[size]') === '2'));
});

test('public provider omits Authorization and unauthorized errors are sanitized', async () => {
  let headers;
  const publicProvider = createBattleMetricsProvider({ fetchImpl: async (_url, options) => {
    headers = options.headers;
    return jsonResponse(gamesDocument);
  } });
  await publicProvider.getGames();
  assert.equal(Object.hasOwn(headers, 'Authorization'), false);

  const denied = createBattleMetricsProvider({ fetchImpl: async () => jsonResponse({}, { status: 401 }), token: 'secret' });
  await assert.rejects(denied.getGames(), /rejected the configured token/);
});

test('Gaming Data panel is isolated, responsive, private-by-default, and default-off', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(html, /id="gaming-data-panel"/);
  assert.match(html, /<span class="panel-title">GAMING DATA<\/span>/);
  assert.match(html, /Locations represent game servers or hosting regions, not the physical locations of individual players\./);
  assert.match(html, /data-gaming-key="publicPlayerNames" disabled/);
  assert.match(main, /mountGamingDataPanelInLeftRail\(\)/);
  assert.match(main, /leftPanelStack\.append\(gamingDataPanel\)/);
  assert.match(css, /#left-panel-stack > #gaming-data-panel \{ order: 5; \}/);
  assert.match(css, /#gaming-data-panel\.collapsed \.gaming-data-panel-inner > :not\(\.panel-header\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*gaming-data-details/);
  assert.match(main, /dataManager\.register\(gamingDataLayer\)/);
  assert.doesNotMatch(main, /setEnabled\(['"]gaming-data['"],\s*true/);
});
