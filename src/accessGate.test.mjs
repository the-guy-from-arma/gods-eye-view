import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('./bootstrap.js', import.meta.url), 'utf8');
const account = readFileSync(new URL('./account.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const owner = readFileSync(new URL('../owner.html', import.meta.url), 'utf8');
const ownerJs = readFileSync(new URL('./ownerDashboard.js', import.meta.url), 'utf8');
const ownerCss = readFileSync(new URL('../owner.css', import.meta.url), 'utf8');

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

test('owner access opens a dedicated full-page command center', () => {
  assert.match(index, /data-owner-dashboard[^>]*>OPEN OWNER COMMAND/);
  assert.match(account, /window\.location\.assign\('\/owner\.html'\)/);
  assert.match(owner, /<title>Owner Command · ThunderLink God's Eye<\/title>/);
  assert.match(owner, /data-owner-metric="locked"/);
  assert.match(owner, /data-owner-autopilot[^>]*aria-pressed="false"/);
  assert.match(owner, /data-owner-accounts/);
  assert.match(owner, /data-owner-layers/);
  assert.match(owner, /data-owner-activity/);
  assert.match(ownerJs, /api\/account\/admin\/autopilot/);
  assert.match(ownerJs, /api\/account\/admin\/users/);
  assert.match(ownerJs, /api\/account\/admin\/layers/);
  assert.match(ownerCss, /\.command-main/);
});

test('site-wide interruption states block the globe with an owner recovery path', () => {
  assert.match(index, /id="system-mode-gate"[^>]*hidden/);
  assert.match(index, /data-system-owner-access>OWNER ACCESS/);
  assert.match(account, /siteAccessBlocked/);
  assert.match(account, /siteMode\.mode !== 'online'/);
  assert.match(owner, /data-mode="maintenance"/);
  assert.match(owner, /data-mode="feed_disconnected"/);
  assert.match(owner, /data-mode="restricted"/);
  assert.match(ownerJs, /api\/account\/admin\/system-mode/);
  assert.match(css, /#system-mode-gate/);
});

test('phones receive a friendly tablet-or-PC compatibility gate before authentication', () => {
  assert.match(index, /id="phone-compatibility-gate"[^>]*hidden/);
  assert.match(index, /iPad, tablet, laptop, or desktop PC/);
  assert.match(index, /Your phone did absolutely nothing wrong/);
  assert.match(bootstrap, /detectPhoneLikeDevice\(\)/);
  assert.match(bootstrap, /classList\.add\('phone-unsupported'\)/);
  assert.match(css, /body\.phone-unsupported/);
});

test('boot screen names every required initialization phase', () => {
  for (const phase of ['auth', 'database', 'runtime', 'globe', 'feeds', 'ready']) {
    assert.match(index, new RegExp(`data-boot-phase="${phase}"`));
  }
});
