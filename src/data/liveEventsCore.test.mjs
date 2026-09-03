import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeLiveEvents,
  normalizeEonetPayload,
  normalizeGdacsPayload,
  pointFromEventGeometry,
} from './liveEventsCore.js';

test('pointFromEventGeometry uses the latest coordinate in a track', () => {
  assert.deepEqual(pointFromEventGeometry({
    type: 'LineString',
    coordinates: [[10, 20], [30, 40]],
  }), { longitude: 30, latitude: 40 });
  assert.deepEqual(pointFromEventGeometry({
    type: 'Point',
    coordinates: [[128.8054, 0.1685]],
  }), { longitude: 128.8054, latitude: 0.1685 });
  assert.equal(pointFromEventGeometry({ type: 'Point', coordinates: [200, 91] }), null);
});

test('NASA EONET GeoJSON normalizes to the live-event contract', () => {
  const events = normalizeEonetPayload({ features: [{
    geometry: { type: 'Point', coordinates: [-117.74215, 41.517567] },
    properties: {
      id: 'EONET_23868',
      title: 'Emergency Stabilization BAER McConnell',
      description: 'Example wildfire',
      date: '2026-09-03T13:03:00Z',
      magnitudeValue: 500,
      magnitudeUnit: 'acres',
      categories: [{ id: 'wildfires', title: 'Wildfires' }],
      sources: [{ id: 'IRWIN', url: 'https://example.test/event' }],
    },
  }] });

  assert.deepEqual(events, [{
    id: 'eonet:EONET_23868',
    title: 'Emergency Stabilization BAER McConnell',
    description: 'Example wildfire',
    category: 'Wildfires',
    source: 'NASA EONET',
    country: null,
    alertLevel: null,
    severity: '500 acres',
    occurredAt: '2026-09-03T13:03:00.000Z',
    latitude: 41.517567,
    longitude: -117.74215,
    url: 'https://example.test/event',
    confidence: 'official-source',
  }]);
});

test('GDACS GeoJSON normalizes alert level, severity, date, and HTTPS source link', () => {
  const events = normalizeGdacsPayload({ features: [{
    geometry: { type: 'Point', coordinates: [120.1, -3.2] },
    properties: {
      eventtype: 'EQ',
      eventid: 1562918,
      alertlevel: 'Orange',
      country: 'Indonesia',
      title: 'Earthquake in Indonesia',
      description: 'Orange earthquake alert',
      todate: '2026-09-01 08:22:20',
      severity: 5.6,
      severityunit: 'M',
      link: [{ Key: 'web', Value: 'http://www.gdacs.org/report.aspx?eventid=1562918' }],
    },
  }] });

  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'gdacs:EQ:1562918');
  assert.equal(events[0].category, 'Earthquake');
  assert.equal(events[0].alertLevel, 'orange');
  assert.equal(events[0].severity, '5.6 M');
  assert.equal(events[0].occurredAt, '2026-09-01T08:22:20.000Z');
  assert.match(events[0].url, /^https:\/\/www\.gdacs\.org\//);
});

test('mergeLiveEvents deduplicates and sorts newest first', () => {
  const oldEvent = { id: 'old', occurredAt: '2026-09-01T00:00:00Z' };
  const newEvent = { id: 'new', occurredAt: '2026-09-03T00:00:00Z' };
  assert.deepEqual(mergeLiveEvents([oldEvent, newEvent], [oldEvent]), [newEvent, oldEvent]);
});
