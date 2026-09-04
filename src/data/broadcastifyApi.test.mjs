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
  const requestedUrls = [];
  const plugin = broadcastifyApiPlugin({
    env: { BROADCASTIFY_API_KEY: 'licensed-secret-value' },
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
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
  assert.equal(payload.activeEventCount, 1);
  assert.equal(payload.feeds[0].officialUrl, 'https://www.broadcastify.com/listen/feed/99');
  assert.equal(payload.feeds[0].listeners, null);
  assert.equal(requestedUrls.length, 4);
  assert.ok(requestedUrls.some((url) => /genre=1/.test(url)));
  assert.ok(requestedUrls.some((url) => /genre=7/.test(url)));
  assert.ok(requestedUrls.some((url) => /genre=8/.test(url)));
  assert.ok(requestedUrls.some((url) => /top=50/.test(url)));
  assert.ok(requestedUrls.every((url) => /key=licensed-secret-value/.test(url)));
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

test('optional event catalog failures do not take down a valid public-safety catalog', async () => {
  let handler;
  let calls = 0;
  const plugin = broadcastifyApiPlugin({
    env: { BROADCASTIFY_API_KEY: 'licensed-secret-value' },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return {
        ok: true,
        json: async () => [{ feedId: 41, description: 'Metro Police Dispatch', lat: 30, lon: -97 }],
      };
      return { ok: false, status: 429 };
    },
  });
  plugin.configureServer({ middlewares: { use(_path, fn) { handler = fn; } } });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.feeds.length, 1);
  assert.equal(payload.degraded, true);
  assert.equal(payload.optionalFailureCount, 3);
});

test('credential rejection is reported explicitly without exposing the key', async () => {
  let handler;
  let calls = 0;
  const plugin = broadcastifyApiPlugin({
    env: { BROADCASTIFY_API_KEY: 'licensed-secret-value' },
    fetchImpl: async () => { calls += 1; return { ok: false, status: 403 }; },
  });
  plugin.configureServer({ middlewares: { use(_path, fn) { handler = fn; } } });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 503);
  assert.equal(payload.code, 'credential_rejected');
  assert.equal(payload.upstreamStatus, 403);
  assert.equal(res.body.includes('licensed-secret-value'), false);
  assert.equal(calls, 1, 'credential rejection must not trigger more licensed requests');
});

test('a failed genre-filter request falls back to the documented unfiltered catalog', async () => {
  let handler;
  const requestedUrls = [];
  const plugin = broadcastifyApiPlugin({
    env: { BROADCASTIFY_API_KEY: 'licensed-secret-value' },
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      if (requestedUrls.length === 1) throw new TypeError('network fixture');
      if (requestedUrls.length === 2) return {
        ok: true,
        json: async () => [{ feedId: 51, description: 'County Sheriff Dispatch', lat: 30, lon: -97 }],
      };
      return { ok: false, status: 429 };
    },
  });
  plugin.configureServer({ middlewares: { use(_path, fn) { handler = fn; } } });
  const res = responseRecorder();
  await handler({ method: 'GET' }, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.feeds.length, 1);
  assert.equal(payload.degraded, true);
  assert.equal(new URL(requestedUrls[1]).searchParams.has('genre'), false);
});
