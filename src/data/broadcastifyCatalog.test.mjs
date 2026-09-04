import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLawEnforcementBroadcast,
  normalizeBroadcastifyCatalog,
  normalizeBroadcastifyFeed,
} from './broadcastifyCatalog.js';

test('recognizes law-enforcement and combined dispatch feed names', () => {
  assert.equal(isLawEnforcementBroadcast({ description: 'Austin Police Dispatch' }), true);
  assert.equal(isLawEnforcementBroadcast({ name: 'County Sheriff, Fire and EMS' }), true);
  assert.equal(isLawEnforcementBroadcast({ name: 'County Fire and EMS Dispatch' }), false);
});

test('normalizes a feed without exposing a stream URL or credential', () => {
  const feed = normalizeBroadcastifyFeed({
    feedId: 42,
    description: 'Metro Police Dispatch',
    listeners: '12',
    latitude: '30.25',
    longitude: '-97.75',
    stateName: 'Texas',
    countyName: 'Travis',
    streamUrl: 'https://audio.example/private',
  });
  assert.equal(feed.id, 'broadcastify-42');
  assert.equal(feed.listeners, 12);
  assert.equal(feed.lat, 30.25);
  assert.equal(feed.lon, -97.75);
  assert.equal(feed.service, 'police');
  assert.equal(feed.officialUrl, 'https://www.broadcastify.com/listen/feed/42');
  assert.equal('streamUrl' in feed, false);
});

test('accepts common catalog envelopes, filters non-law feeds, and deduplicates ids', () => {
  const result = normalizeBroadcastifyCatalog({ feeds: [
    { id: '7', name: 'City Police', lat: 1, lon: 2, listeners: 4 },
    { id: '8', name: 'City Fire and EMS', lat: 3, lon: 4, listeners: 100 },
    { id: '7', name: 'Duplicate Police', lat: 5, lon: 6, listeners: 9 },
  ] });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'City Police');
});
