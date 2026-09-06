import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createIntelligenceApi } from '../server/intelligenceApi.js';

function request(method, url, payload) {
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'app.example', cookie: 'gev_session=test', 'x-forwarded-proto': 'https' };
  return req;
}

function response() {
  let body = '';
  return { setHeader() {}, end(value = '') { body += value; }, get payload() { return JSON.parse(body); } };
}

test('authenticated owner receives the complete policy-aware module catalog', async () => {
  const pool = { async query(sql) {
    if (/FROM gev_sessions/.test(sql)) return { rows: [{ id: 1, email: 'owner@example.com', identity_verification_status: 'verified', intelligence_access: 'owner' }] };
    if (/layer_id LIKE/.test(sql)) return { rows: [{ layer_id: 'intel-dns', status: 'maintenance' }] };
    return { rows: [] };
  } };
  const middleware = createIntelligenceApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const res = response();
  await middleware(request('GET', '/api/intelligence/catalog'), res, () => assert.fail('must not fall through'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.user.access, 'owner');
  assert.equal(res.payload.modules.find(({ id }) => id === 'dns').status, 'maintenance');
  assert.equal(res.payload.modules.find(({ id }) => id === 'dns').allowed, false);
});

test('active scanner refuses an analyst target without ownership verification', async () => {
  const pool = { async query(sql) {
    if (/FROM gev_sessions/.test(sql)) return { rows: [{ id: 2, email: 'analyst@example.com', identity_verification_status: 'verified', intelligence_access: 'analyst' }] };
    if (/layer_id LIKE/.test(sql) || /FROM gev_verified_targets/.test(sql)) return { rows: [] };
    return { rows: [] };
  } };
  const middleware = createIntelligenceApi({ pool, env: { OWNER_EMAIL: 'owner@example.com', SCANNER_URL: 'https://scanner.example', SCANNER_KEY: 'server-secret' } });
  const res = response();
  await middleware(request('POST', '/api/intelligence/scan', { target: 'example.com', scanType: 'quick' }), res, () => assert.fail('must not fall through'));
  assert.equal(res.statusCode, 403);
  assert.match(res.payload.error, /Verify ownership/);
});
