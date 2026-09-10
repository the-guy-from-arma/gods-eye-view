import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchOpenSkyOAuthToken,
  OPENSKY_TRANSPORT_BACKOFF_MS,
  openSkyFetchFailureDetail,
  openSkyRetryAfterMs,
  openSkyTransportFailureKind,
  openSkyTransportCooldownMs,
} from './openSkyResilience.js';

test('OpenSky transport cooldown grows and remains bounded', () => {
  assert.equal(openSkyTransportCooldownMs(1), 30_000);
  assert.equal(openSkyTransportCooldownMs(2), 60_000);
  assert.equal(openSkyTransportCooldownMs(3), 120_000);
  assert.equal(openSkyTransportCooldownMs(4), 300_000);
  assert.equal(openSkyTransportCooldownMs(40), 300_000);
  assert.equal(openSkyTransportCooldownMs(0), 30_000);
  assert.equal(Object.isFrozen(OPENSKY_TRANSPORT_BACKOFF_MS), true);
});

test('OpenSky diagnostics surface the nested transport code without credentials', () => {
  const error = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('socket disconnected'), { code: 'UND_ERR_SOCKET' }),
  });
  assert.equal(openSkyFetchFailureDetail(error), 'fetch failed (UND_ERR_SOCKET)');
});

test('OpenSky diagnostics remain bounded', () => {
  const detail = openSkyFetchFailureDetail(new Error('x'.repeat(500)));
  assert.equal(detail.length, 240);
});

test('OpenSky OAuth returns a token without leaking credentials', async () => {
  let request = null;
  const result = await fetchOpenSkyOAuthToken({
    clientId: 'client-id',
    clientSecret: 'very-secret',
    makeSignal: () => undefined,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'bearer-token', expires_in: 900 }),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.token, 'bearer-token');
  assert.equal(result.expiresIn, 900);
  assert.match(request.options.body, /grant_type=client_credentials/);
  assert.match(request.options.body, /client_secret=very-secret/);
  assert.equal(JSON.stringify(result).includes('very-secret'), false);
});

test('OpenSky OAuth distinguishes rejected credentials from timeouts', async () => {
  const rejected = await fetchOpenSkyOAuthToken({
    clientId: 'bad-client',
    clientSecret: 'bad-secret',
    makeSignal: () => undefined,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ error: 'invalid_client' }),
    }),
  });
  assert.equal(rejected.kind, 'credentials_rejected');

  let attempts = 0;
  const timeout = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
  });
  const unavailable = await fetchOpenSkyOAuthToken({
    clientId: 'client',
    clientSecret: 'secret',
    makeSignal: () => undefined,
    sleepImpl: async () => {},
    fetchImpl: async () => { attempts += 1; throw timeout; },
  });
  assert.equal(attempts, 2);
  assert.equal(unavailable.kind, 'transport_timeout');
  assert.equal(unavailable.detail, 'fetch failed (UND_ERR_CONNECT_TIMEOUT)');
});

test('OpenSky Retry-After and timeout classification are deterministic', () => {
  assert.equal(openSkyRetryAfterMs('15', 0), 15_000);
  assert.equal(openSkyTransportFailureKind(new DOMException('timed out', 'TimeoutError')), 'transport_timeout');
  assert.equal(openSkyTransportFailureKind(new Error('network reset')), 'transport_error');
});
