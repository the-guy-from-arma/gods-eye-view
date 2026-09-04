import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8');
const account = readFileSync(new URL('./account.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('the app document starts locked and loads only the access bootstrap', () => {
  assert.match(index, /<body class="auth-pending">/);
  assert.match(index, /<aside id="account-dialog"[^>]*>/);
  assert.doesNotMatch(index, /<aside id="account-dialog"[^>]*hidden/);
  assert.match(index, /src="\/src\/bootstrap\.js"/);
  assert.doesNotMatch(index, /src="\/src\/main\.js"/);
});

test('Gods Eye runtime is dynamically imported only after authentication', () => {
  assert.match(bootstrap, /initAccounts\(\{ required: true, onAuthenticated: startGodsEye \}\)/);
  assert.match(bootstrap, /await import\('\.\/main\.js'\)/);
  assert.match(bootstrap, /document\.body\.classList\.remove\('auth-pending'\)/);
});

test('the locked gate cannot be dismissed and hidden account states stay hidden', () => {
  assert.match(account, /if \(accessRequired && !user\) return/);
  assert.match(css, /#account-signed-in\[hidden\], #account-signed-out\[hidden\]/);
  assert.match(css, /body\.auth-pending > :not\(#account-dialog\)/);
});

test('the access gate includes a responsible-use disclaimer with an accessible details dialog', () => {
  assert.match(index, /WARNING · LAWFUL USE ONLY/);
  assert.match(index, /data-disclaimer-open[^>]*aria-haspopup="dialog"/);
  assert.match(index, /<dialog id="platform-disclaimer-dialog"/);
  assert.match(index, /DO NOT USE THIS INFORMATION MALICIOUSLY/);
  assert.match(index, /PUBLIC DATA DOES NOT MEAN HARMLESS DATA/);
  assert.match(account, /disclaimerDialog\.showModal\(\)/);
  assert.match(account, /disclaimerDialog\.close\(\)/);
});

test('owner access includes a Postgres approval dashboard and Autopilot controls', () => {
  assert.match(index, /data-owner-dashboard[^>]*aria-controls="owner-dashboard-dialog"[^>]*>ACCOUNT DASHBOARD/);
  assert.match(index, /<dialog id="owner-dashboard-dialog"[^>]*aria-labelledby="owner-dashboard-title"/);
  assert.match(index, /data-owner-metric="pending"/);
  assert.match(index, /data-owner-metric="approved"/);
  assert.match(index, /data-owner-autopilot[^>]*aria-pressed="false"/);
  assert.match(index, /data-owner-accounts/);
  assert.match(account, /ownerDashboardDialog\.showModal\(\)/);
  assert.match(account, /ownerDashboardDialog\.close\(\)/);
  assert.match(account, /api\/account\/admin\/autopilot/);
  assert.match(account, /api\/account\/admin\/users/);
  assert.match(account, /REGISTRATION AUTOPILOT/i);
});

test('boot screen names every required initialization phase', () => {
  for (const phase of ['auth', 'database', 'runtime', 'globe', 'feeds', 'ready']) {
    assert.match(index, new RegExp(`data-boot-phase="${phase}"`));
  }
});
