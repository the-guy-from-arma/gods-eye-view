import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGamingQuery } from './battleMetricsProvider.js';
import {
  createSteamGamingProvider,
  normalizeSteamServer,
} from './steamProvider.js';

const game = { id: '1874880', name: 'Arma Reforger' };
const serverRow = {
  addr: '203.0.113.20:17777',
  gameport: 2001,
  steamid: '90123456789012345',
  name: 'Reforger Conflict East',
  appid: 1874880,
  region: 0,
  players: 74,
  max_players: 128,
  map: 'Everon',
  version: '1.4',
  secure: true,
  dedicated: true,
  gametype: 'conflict,modded',
};

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => data,
  };
}

test('Steam server normalization maps only a coarse Steam region and never a player identity', () => {
  const server = normalizeSteamServer(serverRow, game);
  assert.equal(server.provider, 'steam');
  assert.equal(server.region, 'US East');
  assert.equal(server.locationAccuracy, 'steam-region');
  assert.equal(server.latitude, 38.5);
  assert.equal(server.longitude, -77.5);
  assert.equal(server.players, 74);
  assert.equal(server.gameId, '1874880');
  assert.equal(Object.hasOwn(server, 'playerIds'), false);
  assert.equal(Object.hasOwn(server, 'steamUsers'), false);
});

test('Steam provider combines global game totals with regional server population and keeps its key server-side', async () => {
  const calls = [];
  const provider = createSteamGamingProvider({
    key: 'steam-secret-key',
    appIds: '1874880',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('GetNumberOfCurrentPlayers')) {
        return jsonResponse({ response: { player_count: 19321 } });
      }
      return jsonResponse({ response: { servers: [serverRow] } });
    },
  });
  const games = await provider.getGames();
  const servers = await provider.getServers(normalizeGamingQuery(new URLSearchParams('limit=20&minPlayers=50')));
  assert.equal(games.games[0].players, 19321);
  assert.equal(games.games[0].servers, 1);
  assert.equal(servers.servers.length, 1);
  assert.equal(servers.authMode, 'steam');
  assert.ok(calls.some((call) => call.url.includes('GetServerList')));
  assert.ok(calls.some((call) => new URL(call.url).searchParams.get('key') === 'steam-secret-key'));
  assert.ok(calls.every((call) => !Object.values(call.options.headers).includes('steam-secret-key')));
  assert.doesNotMatch(JSON.stringify({ games, servers }), /steam-secret-key/);
});

test('Steam regional server feed fails closed when no server-side key is configured', async () => {
  let calls = 0;
  const provider = createSteamGamingProvider({
    appIds: '1874880',
    fetchImpl: async () => { calls += 1; return jsonResponse({}); },
  });
  await assert.rejects(provider.getGames(), /STEAM_WEB_API_KEY/);
  assert.equal(calls, 1, 'only the keyless global player-count request may start');
});

test('Steam provider caps concurrent upstream requests during a cold all-games load', async () => {
  let active = 0;
  let maximumActive = 0;
  const provider = createSteamGamingProvider({
    key: 'steam-secret-key',
    fetchImpl: async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return String(url).includes('GetNumberOfCurrentPlayers')
        ? jsonResponse({ response: { player_count: 100 } })
        : jsonResponse({ response: { servers: [] } });
    },
  });
  await provider.getGames();
  assert.ok(maximumActive <= 3, `expected at most 3 concurrent requests, observed ${maximumActive}`);
});
