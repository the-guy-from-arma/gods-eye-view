import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENSKY_TRANSPORT_BACKOFF_MS,
  openSkyFetchFailureDetail,
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
