import test from 'node:test';
import assert from 'node:assert/strict';
import { gamingDataApiPlugin } from './gamingDataApi.js';

function install(plugin) {
  let middleware;
  plugin.configureServer({
    middlewares: {
      use(prefix, handler) {
        assert.equal(prefix, '/api/gaming');
        middleware = handler;
      },
    },
  });
  return middleware;
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = String(value || ''); },
  };
}

test('Gaming Data reports unconfigured providers without calling either protected feed', async () => {
  let calls = 0;
  const middleware = install(gamingDataApiPlugin({
    env: {},
    provider: {
      tokenConfigured: false,
      async getGames() { calls += 1; return { games: [] }; },
      async getServers() { calls += 1; return { servers: [] }; },
    },
    steamProvider: {
      id: 'steam',
      name: 'Steam',
      tokenConfigured: false,
      async getGames() { calls += 1; return { games: [] }; },
      async getServers() { calls += 1; return { servers: [] }; },
    },
  }));

  const statusResponse = responseRecorder();
  await middleware({ method: 'GET', url: '/status' }, statusResponse, () => {});
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(statusResponse.body), {
    provider: 'steam',
    configured: false,
    authMode: 'unconfigured',
    tokenConfigured: false,
    providers: {
      steam: { configured: false },
      battlemetrics: { configured: false },
    },
    refreshIntervalSec: 300,
    privacy: 'Coarse game-server regions only; Steam IDs and player physical locations are never collected.',
  });

  const gamesResponse = responseRecorder();
  await middleware({ method: 'GET', url: '/games' }, gamesResponse, () => {});
  assert.equal(gamesResponse.statusCode, 503);
  assert.equal(JSON.parse(gamesResponse.body).code, 'provider_not_configured');
  assert.equal(calls, 0);
});

test('Gaming Data prefers configured Steam regional activity and preserves provider identity', async () => {
  let steamCalls = 0;
  const middleware = install(gamingDataApiPlugin({
    env: { GAMING_DATA_PROVIDER: 'steam' },
    provider: { id: 'battlemetrics', name: 'BattleMetrics', tokenConfigured: false },
    steamProvider: {
      id: 'steam',
      name: 'Steam',
      tokenConfigured: true,
      async getGames() { steamCalls += 1; return { games: [], authMode: 'steam' }; },
      async getServers() { steamCalls += 1; return { servers: [], authMode: 'steam' }; },
    },
  }));
  const statusResponse = responseRecorder();
  await middleware({ method: 'GET', url: '/status' }, statusResponse, () => {});
  assert.equal(JSON.parse(statusResponse.body).provider, 'steam');
  const gamesResponse = responseRecorder();
  await middleware({ method: 'GET', url: '/games' }, gamesResponse, () => {});
  assert.equal(gamesResponse.statusCode, 200);
  assert.equal(JSON.parse(gamesResponse.body).provider, 'steam');
  assert.equal(steamCalls, 1);
});
