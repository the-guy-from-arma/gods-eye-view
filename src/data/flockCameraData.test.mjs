import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compactFlockCameraFeature,
  extractFlockCameraRecords,
  isFlockCameraFeature,
  parseFlockCameraDataset,
  selectFlockCamerasForView,
} from './flockCameraData.js';

function point(properties, longitude = -97.7, latitude = 30.2) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties };
}

test('brand classifier accepts explicit Flock identity fields but rejects incidental text', () => {
  assert.equal(isFlockCameraFeature(point({ manufacturer: 'Flock Safety' })), true);
  assert.equal(isFlockCameraFeature(point({ brand: 'Flock' })), true);
  assert.equal(isFlockCameraFeature(point({ surveillance: 'flock' })), true);
  assert.equal(isFlockCameraFeature(point({ operator: 'Flock Safety' })), true);
  assert.equal(isFlockCameraFeature(point({ note: 'may share data with Flock Safety' })), false);
  assert.equal(isFlockCameraFeature(point({ pe_external_orgs: 'Agency, Flock Safety' })), false);
});

test('compact records retain placement context without portal/network metadata', () => {
  const record = compactFlockCameraFeature(point({
    manufacturer: 'Flock Safety',
    operator: 'Example Police',
    name: 'Main & First',
    direction: '90',
    'camera:mount': 'pole',
    'surveillance:type': 'ALPR',
    source: 'survey',
    pe_external_orgs: 'must not ship',
    pe_portal_url: 'https://example.invalid/private-metadata',
  }));
  assert.deepEqual(record, [-97.7, 30.2, 'Example Police', 'Main & First', '90', 'pole', 'ALPR', 'survey']);
  assert.equal(JSON.stringify(record).includes('must not ship'), false);
  assert.equal(JSON.stringify(record).includes('private-metadata'), false);
});

test('extraction deduplicates coordinates and keeps richer context', () => {
  const records = extractFlockCameraRecords({ features: [
    point({ manufacturer: 'Flock Safety' }),
    point({ manufacturer: 'Flock Safety', operator: 'Example Police', direction: '180' }),
    point({ manufacturer: 'Other' }, -90, 35),
  ] });
  assert.equal(records.length, 1);
  assert.equal(records[0][2], 'Example Police');
  assert.equal(records[0][4], '180');
});

test('runtime parser rejects wrong schemas and expands valid compact records', () => {
  assert.throws(() => parseFlockCameraDataset({ schemaVersion: 99, cameras: [] }), /unsupported/);
  const records = parseFlockCameraDataset({
    schemaVersion: 1,
    cameras: [[-97.7, 30.2, 'Example Police', '', '90', 'pole', 'ALPR', 'OSM']],
  });
  assert.deepEqual(records[0], {
    id: 'flock-camera:0',
    longitude: -97.7,
    latitude: 30.2,
    operator: 'Example Police',
    name: '',
    direction: '90',
    mount: 'pole',
    cameraType: 'ALPR',
    source: 'OSM',
  });
});

test('viewport selection handles antimeridian bounds and dense-view caps', () => {
  const records = [
    { id: 'west', longitude: 179, latitude: 10 },
    { id: 'east', longitude: -179, latitude: 10 },
    { id: 'outside', longitude: 0, latitude: 10 },
  ];
  assert.deepEqual(
    selectFlockCamerasForView(records, { south: 0, north: 20, west: 170, east: -170 }, 10)
      .map((record) => record.id),
    ['west', 'east'],
  );
  assert.equal(
    selectFlockCamerasForView(records, { south: -90, north: 90, west: -180, east: 180 }, 1).length,
    1,
  );
});

