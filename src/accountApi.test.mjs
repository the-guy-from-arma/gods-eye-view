import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { accountSecurity, createAccountApi } from '../server/accountApi.js';

function request(method, url, payload) {
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'app.example', 'x-forwarded-proto': 'https' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function response() {
  const headers = {};
  let body = '';
  return {
    headers,
    get body() { return body; },
    setHeader(name, value) { headers[name] = value; },
    end(value = '') { body += value; },
  };
}

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
  assert.deepEqual(JSON.parse(body), {
    database: false,
    email: false,
    ownerConfigured: false,
    ownerLoginConfigured: false,
    ownerSetupConfigured: false,
  });
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('owner variable secrets use a constant-length digest comparison', () => {
  assert.equal(accountSecurity.secretMatches('correct horse battery staple', 'correct horse battery staple'), true);
  assert.equal(accountSecurity.secretMatches('wrong', 'correct horse battery staple'), false);
  assert.equal(accountSecurity.secretMatches('', ''), false);
});

test('Railway owner variables create a verified owner session without exposing the password', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/RETURNING id, email/.test(sql)) return { rows: [{ id: 42, email: 'owner@example.com' }] };
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({
    pool,
    env: { OWNER_EMAIL: 'owner@example.com', OWNER_PASSWORD: 'unique-owner-password' },
  });
  const req = request('POST', '/api/account/login', {
    email: 'OWNER@example.com',
    password: 'unique-owner-password',
  });
  const res = response();

  await middleware(req, res, () => assert.fail('account path must not fall through'));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body).user, {
    id: '42',
    email: 'owner@example.com',
    verified: true,
    role: 'owner',
  });
  assert.match(res.headers['Set-Cookie'], /^gev_session=/);
  assert.equal(res.headers['Set-Cookie'].includes('unique-owner-password'), false);
  assert.equal(JSON.stringify(calls).includes('unique-owner-password'), false);
  assert.match(calls.find(({ sql }) => /INSERT INTO gev_users/.test(sql)).params[1], /^scrypt:/);
});

test('Railway owner login rejects an incorrect variable password before creating a session', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({
    pool,
    env: { OWNER_EMAIL: 'owner@example.com', OWNER_PASSWORD: 'unique-owner-password' },
  });
  const res = response();

  await middleware(request('POST', '/api/account/login', {
    email: 'owner@example.com',
    password: 'incorrect-password',
  }), res, () => assert.fail('account path must not fall through'));

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'Invalid email or password');
  assert.equal(calls.some(({ sql }) => /INSERT INTO gev_sessions/.test(sql)), false);
});

test('non-account paths fall through', async () => {
  const middleware = createAccountApi({ env: {} });
  let passed = false;
  await middleware({ method: 'GET', url: '/other', headers: {} }, {}, () => { passed = true; });
  assert.equal(passed, true);
});
