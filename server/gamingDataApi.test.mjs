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

test('Gaming Data reports an unconfigured subscriber token without calling the provider', async () => {
  let calls = 0;
  const middleware = install(gamingDataApiPlugin({
    env: {},
    provider: {
      tokenConfigured: false,
      async getGames() { calls += 1; return { games: [] }; },
      async getServers() { calls += 1; return { servers: [] }; },
    },
  }));

  const statusResponse = responseRecorder();
  await middleware({ method: 'GET', url: '/status' }, statusResponse, () => {});
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(statusResponse.body), {
    provider: 'battlemetrics',
    configured: false,
    authMode: 'unconfigured',
    tokenConfigured: false,
    refreshIntervalSec: 300,
    privacy: 'Game-server locations only; player physical locations are never collected.',
  });

  const gamesResponse = responseRecorder();
  await middleware({ method: 'GET', url: '/games' }, gamesResponse, () => {});
  assert.equal(gamesResponse.statusCode, 503);
  assert.equal(JSON.parse(gamesResponse.body).code, 'provider_not_configured');
  assert.equal(calls, 0);
});
