import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
    approval: 'owner',
    ownerConfigured: false,
    ownerLoginConfigured: false,
    ownerSetupConfigured: false,
  });
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('manual approval mode stores a registration as pending without email delivery', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, approval_status FROM gev_users/.test(sql)) return { rows: [] };
      if (/SELECT value FROM gev_settings/.test(sql)) return { rows: [{ value: 'false' }] };
      if (/INSERT INTO gev_users/.test(sql)) return { rows: [{ id: 7, email: 'new@example.com' }] };
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const res = response();

  await middleware(request('POST', '/api/account/register', {
    email: 'new@example.com',
    password: 'valid-new-password',
  }), res, () => assert.fail('account path must not fall through'));

  assert.equal(res.statusCode, 202);
  assert.equal(JSON.parse(res.body).status, 'pending');
  assert.equal(calls.some(({ sql }) => /gev_email_verifications|resend/i.test(sql)), false);
  assert.equal(calls.some(({ sql }) => /INSERT INTO gev_sessions/.test(sql)), false);
});

test('Autopilot approves a new registration and creates its session', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT id, approval_status FROM gev_users/.test(sql)) return { rows: [] };
      if (/SELECT value FROM gev_settings/.test(sql)) return { rows: [{ value: 'true' }] };
      if (/INSERT INTO gev_users/.test(sql)) return { rows: [{ id: 8, email: 'auto@example.com' }] };
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const res = response();

  await middleware(request('POST', '/api/account/register', {
    email: 'auto@example.com',
    password: 'valid-auto-password',
  }), res, () => assert.fail('account path must not fall through'));

  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 201);
  assert.equal(payload.status, 'approved');
  assert.equal(payload.user.role, 'user');
  assert.match(res.headers['Set-Cookie'], /^gev_session=/);
  assert.equal(calls.some(({ sql }) => /INSERT INTO gev_sessions/.test(sql)), true);
});

test('owner dashboard is session-protected and returns Autopilot plus the account queue', async () => {
  const pool = {
    async query(sql) {
      if (/FROM gev_sessions/.test(sql)) return { rows: [{ id: 1, email: 'owner@example.com', email_verified_at: new Date() }] };
      if (/SELECT value FROM gev_settings/.test(sql)) return { rows: [{ value: 'false' }] };
      if (/FROM gev_users\s+WHERE email <>/.test(sql)) return { rows: [{ id: 9, email: 'wait@example.com', status: 'pending', createdAt: new Date(), approvedAt: null }] };
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const req = request('GET', '/api/account/admin');
  req.headers.cookie = 'gev_session=test-session';
  const res = response();

  await middleware(req, res, () => assert.fail('account path must not fall through'));

  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.autopilot, false);
  assert.equal(payload.accounts[0].id, '9');
  assert.equal(payload.accounts[0].status, 'pending');
});

test('owner can enable Autopilot and manually approve or reject accounts', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM gev_sessions/.test(sql)) return { rows: [{ id: 1, email: 'owner@example.com', email_verified_at: new Date() }] };
      if (/UPDATE gev_users SET approval_status/.test(sql)) {
        return { rows: [{ id: Number(params[1]), email: 'member@example.com', status: params[0], createdAt: new Date(), approvedAt: null }] };
      }
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const autopilotRequest = request('POST', '/api/account/admin/autopilot', { enabled: true });
  autopilotRequest.headers.cookie = 'gev_session=owner-session';
  const autopilotResponse = response();
  await middleware(autopilotRequest, autopilotResponse, () => assert.fail('account path must not fall through'));
  assert.equal(autopilotResponse.statusCode, 200);
  assert.equal(JSON.parse(autopilotResponse.body).autopilot, true);
  assert.equal(calls.some(({ sql, params }) => /INSERT INTO gev_settings/.test(sql) && params[0] === 'true'), true);

  const accountRequest = request('POST', '/api/account/admin/users', { userId: '27', action: 'reject' });
  accountRequest.headers.cookie = 'gev_session=owner-session';
  const accountResponse = response();
  await middleware(accountRequest, accountResponse, () => assert.fail('account path must not fall through'));
  assert.equal(accountResponse.statusCode, 200);
  assert.equal(JSON.parse(accountResponse.body).account.status, 'rejected');
  assert.equal(calls.some(({ sql, params }) => /DELETE FROM gev_sessions WHERE user_id/.test(sql) && params[0] === 27), true);
});

test('owner can publish maintenance state while invalid layer changes are rejected', async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM gev_sessions/.test(sql)) return { rows: [{ id: 1, email: 'owner@example.com', email_verified_at: new Date() }] };
      if (/SELECT layer_id AS/.test(sql)) return { rows: [{ layerId: 'radio', status: 'maintenance' }] };
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const req = request('POST', '/api/account/admin/layers', { layerId: 'radio', status: 'maintenance' });
  req.headers.cookie = 'gev_session=owner-session';
  const res = response();
  await middleware(req, res, () => assert.fail('account path must not fall through'));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).layers.find(({ id }) => id === 'radio').status, 'maintenance');
  assert.equal(calls.some(({ sql, params }) => /INSERT INTO gev_layer_availability/.test(sql) && params[0] === 'radio' && params[1] === 'maintenance'), true);

  const badReq = request('POST', '/api/account/admin/layers', { layerId: '../../secret', status: 'disabled' });
  badReq.headers.cookie = 'gev_session=owner-session';
  const badRes = response();
  await middleware(badReq, badRes, () => assert.fail('account path must not fall through'));
  assert.equal(badRes.statusCode, 400);
});

test('a pending account cannot sign in before owner approval', async () => {
  const digest = await new Promise((resolve, reject) => {
    crypto.scrypt('valid-user-password', '00112233445566778899aabbccddeeff', 64, (error, key) => {
      if (error) reject(error);
      else resolve(`scrypt:00112233445566778899aabbccddeeff:${Buffer.from(key).toString('hex')}`);
    });
  });
  const pool = {
    async query(sql) {
      if (/SELECT id, email, password_digest/.test(sql)) {
        return { rows: [{ id: 4, email: 'pending@example.com', password_digest: digest, email_verified_at: null, approval_status: 'pending' }] };
      }
      return { rows: [] };
    },
  };
  const middleware = createAccountApi({ pool, env: { OWNER_EMAIL: 'owner@example.com' } });
  const res = response();
  await middleware(request('POST', '/api/account/login', {
    email: 'pending@example.com',
    password: 'valid-user-password',
  }), res, () => assert.fail('account path must not fall through'));
  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).error, /awaiting owner approval/i);
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
