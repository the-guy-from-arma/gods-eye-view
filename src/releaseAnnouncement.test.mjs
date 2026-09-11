import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RELEASE_ANNOUNCEMENT } from './releaseAnnouncement.js';

const whatsNew = readFileSync(new URL('./whatsNew.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const owner = readFileSync(new URL('../owner.html', import.meta.url), 'utf8');

test('release briefing covers every build from 0.3.10 through 0.3.31', () => {
  assert.deepEqual(RELEASE_ANNOUNCEMENT.releases.map(({ version }) => version),
    Array.from({ length: 22 }, (_, index) => `0.3.${index + 10}`));
  assert.ok(RELEASE_ANNOUNCEMENT.comingSoon.length >= 3);
});

test('What’s New is reopenable but automatic display is acknowledged per account', () => {
  assert.match(index, /id="whats-new-dialog"/);
  assert.match(index, /data-whats-new-open/);
  assert.match(whatsNew, /api\/account\/whats-new\/acknowledge/);
  assert.match(whatsNew, /gev:whats-new:/);
  assert.match(whatsNew, /status\.enabled && !status\.acknowledged/);
  assert.match(whatsNew, /first-run-launcher/);
});

test('owner System Control exposes the announcement switch', () => {
  assert.match(owner, /data-whats-new-enabled/);
  assert.match(owner, /New features added/);
});
