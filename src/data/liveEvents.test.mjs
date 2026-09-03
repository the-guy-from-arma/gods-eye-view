import assert from 'node:assert/strict';
import test from 'node:test';

import { liveEventOverlayEntry, liveEventPriority } from './liveEvents.js';

const EVENT = {
  id: 'gdacs:TC:1',
  title: 'Tropical Cyclone Example',
  category: 'Tropical Cyclone',
  source: 'GDACS',
  country: 'Exampleland',
  alertLevel: 'red',
  severity: '120 km/h',
  occurredAt: '2026-09-03T12:00:00Z',
  url: 'https://example.test/report',
};

test('live event card exposes provenance and a safe activation callback', () => {
  let opened = null;
  const entry = liveEventOverlayEntry(EVENT, { x: 1, y: 2, z: 3 }, Date.parse('2026-09-03T13:00:00Z'), (url) => {
    opened = url;
  });
  assert.equal(entry.variant, 'card');
  assert.equal(entry.interactive, true);
  assert.match(entry.details[0], /GDACS · RED · Exampleland/);
  assert.match(entry.details[1], /Tropical Cyclone · 120 km\/h · 1h ago/);
  entry.activate();
  assert.equal(opened, EVENT.url);
});

test('red alerts outrank otherwise equal unclassified events', () => {
  const now = Date.parse('2026-09-03T13:00:00Z');
  assert.ok(liveEventPriority(EVENT, now) > liveEventPriority({ ...EVENT, alertLevel: null }, now));
});

