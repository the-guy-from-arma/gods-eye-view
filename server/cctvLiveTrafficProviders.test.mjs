import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIVE_TRAFFIC_PROVIDERS, liveTrafficUrl, normalizeTexasCamera, normalizeDriveBcCamera,
  normalizeCanadian511Camera, normalizeAustralianCamera, parseNewfoundlandCameras,
  loadTexasCameras, loadLiveTrafficProvider, fetchLiveTrafficFrame, createLiveTrafficFrameCache,
} from './cctvLiveTrafficProviders.js';
import { enabledProviderKeys } from './cctv511Providers.js';
import { normalizeCctvRegion, cctvRegionCountry, isLiveTrafficCameraId } from '../src/data/cctvRegions.js';

const config = (key) => LIVE_TRAFFIC_PROVIDERS.find((item) => item.key === key);
const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const txRow = { hasSnapshot: true, icd_Id: 'IH20 @ Ramp/1', name: 'IH20 @ Ramp', latitude: 32.4, longitude: -99.7 };

test('regional IDs distinguish California, Canada and Australia and validate persistence input', () => {
  assert.equal(normalizeCctvRegion(' ca-on '), 'CA-ON');
  assert.equal(normalizeCctvRegion('AU-NSW'), 'AU-NSW');
  assert.equal(normalizeCctvRegion('<script>'), '');
  assert.equal(cctvRegionCountry('CA'), 'United States');
  assert.equal(cctvRegionCountry('CA-BC'), 'Canada');
  assert.equal(cctvRegionCountry('AU-QLD'), 'Australia');
});

test('all verified providers are default enabled and individually excludable', () => {
  const enabled = enabledProviderKeys({});
  for (const item of LIVE_TRAFFIC_PROVIDERS) assert.ok(enabled.has(item.key));
  const excluded = enabledProviderKeys({ CCTV_STATE_511_EXCLUDE_PROVIDERS: 'tx,ca-on,au-qld' });
  for (const key of ['tx', 'ca-on', 'au-qld']) assert.equal(excluded.has(key), false);
  assert.ok(excluded.has('ny'));
});

test('Texas snapshots have stable district-scoped IDs and escaped request parameters', () => {
  const cam = normalizeTexasCamera(txRow, 'ABL');
  assert.equal(cam.stateCode, 'TX');
  assert.equal(cam.frameEncoding, 'txdot-json');
  assert.equal(cam.framePolicy, 'live-only');
  assert.ok(isLiveTrafficCameraId(cam.id));
  assert.equal(new URL(cam.url).searchParams.get('icdId'), txRow.icd_Id);
  assert.equal(cam.id, normalizeTexasCamera({ ...txRow, name: 'new name' }, 'ABL').id);
  assert.notEqual(cam.id, normalizeTexasCamera(txRow, 'DAL').id);
  assert.equal(normalizeTexasCamera({ ...txRow, hasSnapshot: false }, 'ABL'), null);
  assert.equal(normalizeTexasCamera({ ...txRow, latitude: null }, 'ABL'), null);
  assert.equal(normalizeTexasCamera({ ...txRow, longitude: 150 }, 'ABL'), null);
  assert.equal(normalizeTexasCamera(txRow, '../'), null);
});

test('Texas discovers every district, deduplicates rows and preserves individual stale catalogs', async () => {
  let fail = false; let calls = 0;
  const options = { fetchImpl: async (url) => {
    if (url.includes('GetDistricts')) return jsonResponse([{ icd_Id: 'ABL' }, { icd_Id: 'DAL' }]);
    calls++;
    if (fail && url.endsWith('DAL')) throw new Error('offline');
    return jsonResponse({ roadwayCctvStatuses: { IH20: [txRow, txRow] } });
  } };
  const first = await loadTexasCameras(options);
  assert.equal(calls, 2); assert.equal(first.cameras.length, 2); assert.equal(first.warning, '');
  fail = true;
  const second = await loadTexasCameras(options);
  assert.equal(second.cameras.length, 2); assert.match(second.warning, /DAL/);
});

test('DriveBC uses current images only, respects cadence and excludes hidden cameras', () => {
  const row = { id: 12, name: 'Pass', is_on: true, should_appear: true, location: { coordinates: [-120, 50] },
    links: { imageDisplay: '/images/12.jpg?t=123', replayTheDay: '/not-used' }, update_period_mean: 1200 };
  const cam = normalizeDriveBcCamera(row);
  assert.equal(cam.snapshotUrl, 'https://www.drivebc.ca/images/12.jpg');
  assert.equal(cam.minFrameRefreshMs, 1_200_000);
  assert.equal(cam.cityId, 'ca-bc');
  assert.equal(normalizeDriveBcCamera({ ...row, should_appear: false }), null);
  assert.equal(normalizeDriveBcCamera({ ...row, links: { imageDisplay: 'https://evil.test/x' } }), null);
});

test('Ontario includes each enabled view, excluding disabled and foreign URLs', () => {
  const rows = normalizeCanadian511Camera({ Id: 1, Latitude: 43, Longitude: -79, Location: 'QEW', Views: [
    { Id: 1, Status: 'Enabled', Url: '/map/Cctv/1', Description: 'East' },
    { Id: 2, Status: 'Enabled', Url: 'https://511on.ca/map/Cctv/2', Description: 'West' },
    { Id: 3, Status: 'Disabled', Url: '/map/Cctv/3' },
    { Id: 4, Status: 'Enabled', Url: 'https://localhost/frame' },
  ] }, config('ca-on'));
  assert.equal(rows.length, 2); assert.equal(rows[0].stateCode, 'CA-ON');
  assert.notEqual(rows[0].id, rows[1].id);
  assert.match(rows[1].name, /West/);
});

test('NSW and Queensland normalize their official geometry and snapshot schemas', () => {
  const nsw = normalizeAustralianCamera({ attributes: { id: 'a', title: 'Sydney', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/a.jpeg' }, geometry: { x: 151, y: -34 } }, 'au-nsw');
  const qld = normalizeAustralianCamera({ properties: { id: 1, description: 'Brisbane', image_url: 'https://cameras.qldtraffic.qld.gov.au/a.jpg' }, geometry: { coordinates: [153, -27] } }, 'au-qld');
  assert.equal(nsw.stateCode, 'AU-NSW'); assert.equal(qld.stateCode, 'AU-QLD');
  assert.equal(qld.feedType, 'image'); assert.equal(nsw.framePolicy, 'live-only');
  assert.equal(normalizeAustralianCamera({ ...qld, geometry: { coordinates: [0, 0] } }, 'au-qld'), null);
});

test('Newfoundland pin parser reads literals without evaluating remote code', () => {
  const text = `throw new Error('never execute'); var pins = [
    { type: 'cam', title: "Paddy's Pond", loc: '47.47, -52.88', desc: '<IMG src="https://www.gov.nl.ca/ti/highway-cams/cameras/sites/paddyspond/current.jpg">' },
    { type: 'cam', title: "Untrusted", loc: '47.47,-52.88', desc: '<IMG src="https://evil.test/current.jpg">' }
  ];`;
  const rows = parseNewfoundlandCameras(text);
  assert.equal(rows.length, 1); assert.equal(rows[0].stateCode, 'CA-NL');
  assert.equal(rows[0].name, "Paddy's Pond");
});

test('developer-key providers make no request until configured and never expose keys in errors', async () => {
  let calls = 0;
  await assert.rejects(loadLiveTrafficProvider(config('ca-ab'), {}, { fetchImpl: () => { calls++; } }), /CCTV_ALBERTA_511_API_KEY/);
  assert.equal(calls, 0);
  await assert.rejects(loadLiveTrafficProvider(config('ca-ab'), { CCTV_ALBERTA_511_API_KEY: 'private-test-key' }, {
    fetchImpl: async (url) => { assert.equal(new URL(url).searchParams.get('key'), 'private-test-key'); return new Response('', { status: 401 }); },
  }), { message: 'Provider HTTP 401' });
});

test('NSW pagination does not silently truncate an expanded catalog', async () => {
  let calls = 0;
  const rows = await loadLiveTrafficProvider(config('au-nsw'), {}, { fetchImpl: async (url) => {
    calls++;
    if (url.includes('all-feeds-web')) return new Response('', { status: 503 });
    if (!url.includes('resultOffset')) return jsonResponse({ features: [], exceededTransferLimit: true });
    return jsonResponse({ features: [], exceededTransferLimit: false });
  } });
  assert.equal(calls, 3); assert.deepEqual(rows, []);
});

test('NSW public feed uses only live camera entries, never unrelated events', async () => {
  const row = { id: 'camera-1', eventCategory: 'liveCams', properties: {
    title: 'Sydney', href: 'https://webcams.transport.nsw.gov.au/livetraffic-webcams/cameras/a.jpeg',
  }, geometry: { coordinates: [151, -34] } };
  const rows = await loadLiveTrafficProvider(config('au-nsw'), {}, { fetchImpl: async () => jsonResponse([
    row, { ...row, id: 'not-a-camera', eventCategory: 'publicEvents' },
  ]) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'live-traffic-au-nsw-camera-1');
});

test('snapshot URL validation rejects SSRF, credentials, non-HTTPS and lookalike hosts', () => {
  for (const url of ['http://511on.ca/a', 'https://511on.ca.evil.test/a', 'https://user@511on.ca/a', 'https://511on.ca:444/a', 'https://127.0.0.1/a', 'file:///etc/passwd']) {
    assert.equal(liveTrafficUrl(url, undefined, ['511on.ca']), '');
  }
});

test('TxDOT JSON frames decode JPEG only with capped response sizes and no redirects', async () => {
  const source = normalizeTexasCamera(txRow, 'ABL');
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 1]);
  const frame = await fetchLiveTrafficFrame(source, { fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return jsonResponse({ snippet: bytes.toString('base64') });
  } });
  assert.deepEqual(frame.body, bytes); assert.equal(frame.contentType, 'image/jpeg');
  for (const snippet of ['<html>', Buffer.from('not jpeg').toString('base64'), null]) {
    assert.equal(await fetchLiveTrafficFrame(source, { fetchImpl: async () => jsonResponse({ snippet }) }), null);
  }
  assert.equal(await fetchLiveTrafficFrame(source, { fetchImpl: async () => new Response('huge', { headers: { 'Content-Length': '9000000' } }) }), null);
});

test('unavailable images are not replaced with generated or historical content', async () => {
  const source = normalizeTexasCamera(txRow, 'ABL');
  assert.equal(await fetchLiveTrafficFrame(source, { fetchImpl: async () => new Response('offline', { status: 503 }) }), null);
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /if \(source\?\.framePolicy === 'live-only'\)[\s\S]*?frame \? 200 : 503[\s\S]*?return;/);
});

test('image signatures reject HTML mislabeled as a supported image type', async () => {
  const source = { framePolicy: 'live-only', snapshotUrl: 'https://cameras.qldtraffic.qld.gov.au/camera.jpg' };
  for (const contentType of ['image/jpeg', 'image/png', 'image/webp', 'text/html']) {
    assert.equal(await fetchLiveTrafficFrame(source, { fetchImpl: async () => new Response('<html>offline</html>', { headers: { 'Content-Type': contentType } }) }), null);
  }
});

test('live image RAM cache evicts by byte budget as well as camera count', async () => {
  let calls = 0;
  const cache = createLiveTrafficFrameCache({ fetchFrame: async () => {
    calls++; return { ok: true, body: Buffer.alloc(2 * 1024 * 1024), contentType: 'image/jpeg' };
  } });
  try {
    for (let i = 0; i < 17; i++) await cache({ id: `cam-${i}`, minFrameRefreshMs: 60_000 });
    assert.equal(calls, 17);
    await cache({ id: 'cam-0', minFrameRefreshMs: 60_000 });
    assert.equal(calls, 18, 'oldest image was evicted above 32 MiB');
  } finally { cache.close(); }
});

test('live frame cache coalesces viewers, respects refresh intervals and expires failed requests', async () => {
  let time = 0; let calls = 0;
  const cache = createLiveTrafficFrameCache({ now: () => time, fetchFrame: async () => {
    calls++; return calls > 1 ? null : { body: Buffer.from([1]), contentType: 'image/jpeg', ok: true };
  } });
  const source = { id: 'live-traffic-tx-test', minFrameRefreshMs: 60_000 };
  try {
    await Promise.all([cache(source), cache(source)]); assert.equal(calls, 1);
    time = 59_000; assert.ok(await cache(source)); assert.equal(calls, 1);
    time = 60_001; assert.equal(await cache(source), null); assert.equal(calls, 2);
    time = 60_002; await cache(source); assert.equal(calls, 2);
    time = 81_000; await cache(source); assert.equal(calls, 3);
  } finally { cache.close(); }
});

test('live-only cameras are excluded from existing analytics and archive paths', () => {
  const api = readFileSync(new URL('./accountApi.js', import.meta.url), 'utf8');
  const owner = readFileSync(new URL('../src/ownerDashboard.js', import.meta.url), 'utf8');
  assert.equal((api.match(/if \(isLiveTrafficCameraId\(cameraId\)\)/g) || []).length, 2);
  assert.match(owner, /payload.sources.filter\(\(source\) => source.framePolicy !== 'live-only'\)/);
  assert.equal(isLiveTrafficCameraId('fdot-22'), false);
});
