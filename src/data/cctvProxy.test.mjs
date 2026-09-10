import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CCTV_FRAME_FETCH_TIMEOUT_MS,
  fetchCctvImageFromUpstream,
  normalizeWsdot511Camera,
} from '../../vite.config.js';

test('CCTV upstream frame fetch supplies a bounded abort signal', async () => {
  let observedSignal = null;
  const startedAt = Date.now();
  const result = await fetchCctvImageFromUpstream('https://example.com/frame.jpg', {
    timeoutMs: 20,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      observedSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }),
  });

  assert.equal(result, null);
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 500, 'test timeout should settle promptly');
  assert.ok(CCTV_FRAME_FETCH_TIMEOUT_MS < 10_000, 'production timeout must beat the active refresh cadence');
});

test('CCTV upstream frame fetch returns a valid image response', async () => {
  const result = await fetchCctvImageFromUpstream('https://example.com/frame.jpg', {
    timeoutMs: 100,
    fetchImpl: async () => new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  });

  assert.equal(result?.ok, true);
  assert.equal(result?.contentType, 'image/jpeg');
  assert.deepEqual(result?.body, Buffer.from([1, 2, 3]));
});

test('Washington 511 ArcGIS camera features normalize into snapshot sources', () => {
  const camera = normalizeWsdot511Camera({
    id: 1001,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.674, 45.620483] },
    properties: {
      OBJECTID: 1001,
      CameraTitle: 'I-5 at Interstate Bridge SB, north end',
      ImageURL: 'https://images.wsdot.wa.gov/southwest/005vc00000.jpg',
      CompassDirection: 'S',
    },
  });

  assert.deepEqual(camera && {
    id: camera.id,
    provider: camera.provider,
    lat: camera.lat,
    lon: camera.lon,
    headingDeg: camera.headingDeg,
    feedType: camera.feedType,
    sourceKind: camera.sourceKind,
  }, {
    id: 'wsdot-1001',
    provider: 'Washington 511 · WSDOT',
    lat: 45.620483,
    lon: -122.674,
    headingDeg: 180,
    feedType: 'image',
    sourceKind: 'wsdot-511-open-data',
  });
});

test('Washington 511 normalization rejects unsafe or out-of-area rows', () => {
  const base = {
    id: 7,
    geometry: { type: 'Point', coordinates: [-122.3, 47.6] },
    properties: { OBJECTID: 7, CameraTitle: 'Camera', ImageURL: 'https://images.wsdot.wa.gov/cam.jpg' },
  };
  assert.equal(normalizeWsdot511Camera({ ...base, properties: { ...base.properties, ImageURL: 'http://example.test/cam.jpg' } }), null);
  assert.equal(normalizeWsdot511Camera({ ...base, geometry: { type: 'Point', coordinates: [-80, 35] } }), null);
});
