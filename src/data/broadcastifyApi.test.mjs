import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastifyApiPlugin } from '../../server/broadcastifyApi.js';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
}

test('Broadcastify proxy keeps the credential server-side and returns normalized provider links', async () => {
  let handler;
  let requestedUrl = '';
  const plugin = broadcastifyApiPlugin({
    env: { BROADCASTIFY_API_KEY: 'licensed-secret-value' },
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => [{ feedId: 99, description: 'County Sheriff Dispatch', lat: 30, lon: -97 }],
      };
    },
  });
  plugin.configureServer({ middlewares: { use(path, fn) { assert.equal(path, '/api/broadcastify/feeds'); handler = fn; } } });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.feeds.length, 1);
  assert.equal(payload.feeds[0].officialUrl, 'https://www.broadcastify.com/listen/feed/99');
  assert.match(requestedUrl, /genre=1/);
  assert.match(requestedUrl, /key=licensed-secret-value/);
  assert.equal(res.body.includes('licensed-secret-value'), false);
});

test('Broadcastify proxy reports an unconfigured server without attempting an upstream request', async () => {
  let handler;
  let calls = 0;
  const plugin = broadcastifyApiPlugin({
    env: {},
    fetchImpl: async () => { calls += 1; },
  });
  plugin.configureServer({ middlewares: { use(path, fn) { handler = fn; } } });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls, 0);
});
