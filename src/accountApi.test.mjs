import test from 'node:test';
import assert from 'node:assert/strict';
import { accountSecurity, createAccountApi } from '../server/accountApi.js';

test('activity metadata removes secrets and bounds arbitrary text', () => {
  const clean = accountSecurity.sanitizeActivityMetadata({
    query: 'Austin',
    apiKey: 'must-not-survive',
    password: 'must-not-survive',
    enabled: true,
    invalid_key_name_with_way_too_many_characters_here: 'no',
  });
  assert.deepEqual(clean, { query: 'Austin', enabled: true });
});

test('account status is honest when Railway Postgres is not attached', async () => {
  const middleware = createAccountApi({ env: {} });
  const req = { method: 'GET', url: '/api/account/status', headers: {} };
  const headers = {};
  let body = '';
  const res = {
    setHeader(name, value) { headers[name] = value; },
    end(value = '') { body += value; },
  };
  await middleware(req, res, () => assert.fail('account path must not fall through'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(body), { database: false, email: false, ownerConfigured: false });
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('non-account paths fall through', async () => {
  const middleware = createAccountApi({ env: {} });
  let passed = false;
  await middleware({ method: 'GET', url: '/other', headers: {} }, {}, () => { passed = true; });
  assert.equal(passed, true);
});
