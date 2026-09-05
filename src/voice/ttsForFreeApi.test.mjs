import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ttsForFreeApiPlugin } from '../../server/ttsForFreeApi.js';

function request(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
}

function routeFor(plugin) {
  let handler;
  plugin.configureServer({ middlewares: { use(path, fn) {
    assert.equal(path, '/api/tts/speak');
    handler = fn;
  } } });
  return handler;
}

test('TTSForFree proxy keeps its key server-side and polls for trusted audio', async () => {
  const calls = [];
  const handler = routeFor(ttsForFreeApiPlugin({
    env: { TTSFORFREE_API_KEY: 'server-secret', TTSFORFREE_VOICE_ID: 'voice-id' },
    sleep: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return calls.length === 1
        ? { ok: true, json: async () => ({ Id: 42, Status: 'PENDING' }) }
        : { ok: true, json: async () => ({ Id: 42, Status: 'SUCCESS', Data: 'https://cdn.ttsforfree.com/audio/result.mp3' }) };
    },
  }));
  const res = responseRecorder();
  await handler(request({ text: 'Command complete' }), res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.audioUrl, 'https://cdn.ttsforfree.com/audio/result.mp3');
  assert.equal(payload.provider, 'ttsforfree');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['X-API-Key'], 'server-secret');
  assert.equal(JSON.parse(calls[0].options.body).Voice, 'voice-id');
  assert.equal(res.body.includes('server-secret'), false);
});

test('TTSForFree proxy degrades cleanly when no Railway key is configured', async () => {
  let calls = 0;
  const handler = routeFor(ttsForFreeApiPlugin({ env: {}, fetchImpl: async () => { calls += 1; } }));
  const res = responseRecorder();
  await handler(request({ text: 'Command complete' }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, 'not_configured');
  assert.equal(calls, 0);
});

test('TTSForFree proxy refuses untrusted audio result hosts', async () => {
  const handler = routeFor(ttsForFreeApiPlugin({
    env: { TTSFORFREE_API_KEY: 'server-secret' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ Id: 9, Status: 'SUCCESS', Data: 'https://attacker.example/audio.mp3' }),
    }),
  }));
  const res = responseRecorder();
  await handler(request({ text: 'Command complete' }), res);
  assert.equal(res.statusCode, 504);
  assert.equal(JSON.parse(res.body).audioUrl, undefined);
});

test('TTSForFree proxy identifies an exhausted provider quota without exposing provider details', async () => {
  const handler = routeFor(ttsForFreeApiPlugin({
    env: { TTSFORFREE_API_KEY: 'server-secret' },
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Insufficient credit balance for account 123' }),
    }),
  }));
  const res = responseRecorder();
  await handler(request({ text: 'Command complete' }), res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 429);
  assert.equal(payload.code, 'tts_quota_limited');
  assert.equal(payload.error, 'TTSForFree account credits are unavailable');
  assert.equal(res.body.includes('account 123'), false);
});
