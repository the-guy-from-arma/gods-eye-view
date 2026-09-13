import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_TRAFFIC_PROVIDERS, normalizeMontanaCamera, normalizeNorthDakotaCamera,
  normalizeIdahoCamera, loadIdahoCameras, parseWyomingCameras, loadLiveTrafficProvider,
  fetchLiveTrafficFrame } from './cctvLiveTrafficProviders.js';
import { enabledProviderKeys } from './cctv511Providers.js';
import { CCTV_REGION_NAMES, isLiveTrafficCameraId } from '../src/data/cctvRegions.js';

const config = (key) => LIVE_TRAFFIC_PROVIDERS.find((item) => item.key === key);
const response = (value) => new Response(JSON.stringify(value));
const mt = { geometry: { coordinates: [-104.37, 47.426] }, properties: {
  description: 'MT-16 MP 29.5', cameras: [
    { id: '302070-00-01', name: 'Savage North', image: 'https://mt.cdn.iteris-atis.com/rwis_images/302070-00-01.jpg' },
    { id: '302071-00-02', name: 'Savage East', image: 'https://mt.cdn.iteris-atis.com/rwis_images/302071-00-02.jpg' },
  ],
} };
const nd = { geometry: { coordinates: [-100.64, 46.27] }, properties: { Cameras: [
  { Description: 'Fort Yates North', FullPath: 'https://www.dot.nd.gov/travel-info/cameras/ND1806@RP22.81FortYatesNorth.jpg' },
  { Description: 'Road', FullPath: 'https://www.dot.nd.gov/travel-info/cameras/I29RP68.237Fargo19th&40thAveNPavement.jpg' },
] } };
const idaho = (id = 16) => ({ id, state: 'Idaho', visible: true,
  latLng: { geography: { wellKnownText: 'POINT (-116.51544 43.599537)' } },
  images: [{ id: id * 10, description: 'I-84 East', imageUrl: `/map/Cctv/${id * 10}` },
    { id: id * 10 + 1, description: 'I-84 West', imageUrl: `/map/Cctv/${id * 10 + 1}` }],
});

test('four northern state catalogs default on with independent exclusions and state names', () => {
  for (const key of ['mt', 'wy', 'nd', 'id']) {
    assert.ok(enabledProviderKeys({}).has(key));
    assert.equal(enabledProviderKeys({ CCTV_STATE_511_EXCLUDE_PROVIDERS: key }).has(key), false);
    assert.equal(CCTV_REGION_NAMES[key.toUpperCase()], config(key).state);
  }
});

test('Montana includes each public RWIS direction and excludes neighboring states and foreign URLs', () => {
  const cameras = normalizeMontanaCamera(mt);
  assert.equal(cameras.length, 2);
  assert.notEqual(cameras[0].id, cameras[1].id);
  assert.equal(cameras[0].cityId, 'us-mt');
  assert.equal(cameras[0].minFrameRefreshMs, 300_000);
  assert.deepEqual(normalizeMontanaCamera({ ...mt, properties: { ...mt.properties, route: 'WY I-90' } }), []);
  assert.deepEqual(normalizeMontanaCamera({ ...mt, geometry: { coordinates: [-108.62, 44.96] } }), []);
  assert.deepEqual(normalizeMontanaCamera({ ...mt, properties: { cameras: [{ id: 1, image: 'https://evil.test/c.jpg' }] } }), []);
  assert.deepEqual(normalizeMontanaCamera({ ...mt, geometry: { coordinates: [0, 0] } }), []);
});

test('Montana loads traffic and RWIS catalogs, deduplicates views and reports partial outages', async () => {
  let fail = false;
  const options = { fetchImpl: async (url) => {
    if (fail && url.includes('rwis.geojson')) throw new Error('offline');
    return response({ features: [mt, mt] });
  } };
  const first = await loadLiveTrafficProvider(config('mt'), {}, options);
  assert.equal(first.cameras.length, 2); assert.equal(first.warning, '');
  fail = true;
  const second = await loadLiveTrafficProvider(config('mt'), {}, options);
  assert.equal(second.cameras.length, 2); assert.match(second.warning, /rwis/);
  await assert.rejects(loadLiveTrafficProvider(config('mt'), {}, { fetchImpl: async () => response({}) }), /unavailable/);
});

test('North Dakota supports published filename punctuation, stable view IDs and required disclaimer', async () => {
  const cameras = normalizeNorthDakotaCamera(nd);
  assert.equal(cameras.length, 2);
  assert.match(cameras[0].license, /as-is, without liability to NDDOT/);
  assert.equal(cameras[0].cityId, 'us-nd');
  assert.deepEqual(normalizeNorthDakotaCamera({ ...nd, geometry: { coordinates: [-120, 48] } }), []);
  assert.deepEqual(normalizeNorthDakotaCamera({ ...nd, properties: { Cameras: [{ FullPath: 'https://www.dot.nd.gov.evil.test/a.jpg' }] } }), []);
  const result = await loadLiveTrafficProvider(config('nd'), {}, { fetchImpl: async () => response({ features: [nd, nd] }) });
  assert.equal(result.length, 2);
  await assert.rejects(loadLiveTrafficProvider(config('nd'), {}, { fetchImpl: async () => response({ features: [] }) }), /empty/);
});

test('Idaho preserves all enabled images but never imports blocked views or authenticated video', () => {
  const row = idaho();
  row.images.push({ id: 3, imageUrl: '/map/Cctv/3', disabled: true },
    { id: 4, imageUrl: '/map/Cctv/4', blocked: true },
    { id: 5, imageUrl: 'https://127.0.0.1/map/Cctv/5' });
  row.images[0].videoUrl = 'https://example.test/restricted.m3u8';
  row.images[0].isVideoAuthRequired = true;
  const cameras = normalizeIdahoCamera(row);
  assert.equal(cameras.length, 2); assert.equal(cameras[0].feedType, 'image');
  assert.equal(cameras[0].cityId, 'us-id');
  assert.deepEqual(normalizeIdahoCamera({ ...row, visible: false }), []);
  assert.deepEqual(normalizeIdahoCamera({ ...row, state: 'Oregon' }), []);
  assert.deepEqual(normalizeIdahoCamera({ ...row, latLng: {} }), []);
});

test('Idaho public pagination loads all locations without a developer key', async () => {
  const starts = [];
  const cameras = await loadIdahoCameras({ fetchImpl: async (url, options) => {
    assert.ok(url.startsWith('https://511.idaho.gov/List/GetData/Cameras?'));
    assert.ok(options.signal); assert.equal(options.redirect, 'error');
    const { start, length } = JSON.parse(new URL(url).searchParams.get('query'));
    starts.push(start); assert.equal(length, 100);
    return response({ recordsTotal: 103, data: Array.from({ length: start ? 3 : 100 }, (_, i) => idaho(start + i + 1)) });
  } });
  assert.deepEqual(starts, [0, 100]); assert.equal(cameras.length, 206);
  assert.ok(cameras.every((c) => c.framePolicy === 'live-only' && isLiveTrafficCameraId(c.id)));
});

test('Idaho surfaces truncated or repeating pagination and rejects changed schemas', async () => {
  const partial = await loadIdahoCameras({ fetchImpl: async () => response({ recordsTotal: 200, data: [idaho()] }) });
  assert.equal(partial.cameras.length, 2); assert.match(partial.warning, /1\/200/);
  const repeated = await loadIdahoCameras({ fetchImpl: async () => response({ recordsTotal: 201,
    data: Array.from({ length: 100 }, (_, i) => idaho(i + 1)) }) });
  assert.equal(repeated.cameras.length, 200); assert.match(repeated.warning, /100\/201/);
  await assert.rejects(loadIdahoCameras({ fetchImpl: async () => response({ data: [] }) }), /Unexpected/);
});

// Test-only protobuf fixture encoder; no real camera frames are retained.
function varint(n) {
  const bytes = [];
  do { const byte = n % 128; n = Math.floor(n / 128); bytes.push(byte | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}
const integer = (n, v) => Buffer.concat([varint(n * 8), varint(v)]);
const bytes = (n, v) => Buffer.concat([varint(n * 8 + 2), varint(v.length), v]);
const double = (n, v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return Buffer.concat([varint(n * 8 + 1), b]); };
const publicText = (n, text) => {
  const mask = Buffer.from('EkhJp6wsgahsqkiw5nahFOSCwAND1zhZ');
  const value = Buffer.from(text).map((b, i) => b ^ mask[i % mask.length]);
  return bytes(n, Buffer.from(value.toString('base64')));
};
function wyomingFixture(url = 'https://www.wyoroad.info/web-cam/cache?ref=example') {
  const view = (id, title) => bytes(3, Buffer.concat([integer(1, id), publicText(2, title), publicText(3, url), integer(4, id)]));
  const site = Buffer.concat([integer(1, 55), publicText(2, 'Cheyenne'), view(1, 'North'), view(2, 'South'),
    double(8, -104.855988), double(9, 41.079213), integer(20, 42)]);
  return bytes(1, site);
}

test('Wyoming parses public binary coordinates and all directions, ignoring unknown fields', async () => {
  const cameras = parseWyomingCameras(wyomingFixture());
  assert.equal(cameras.length, 2);
  assert.equal(cameras[0].name, 'North'); assert.equal(cameras[1].name, 'South');
  assert.equal(cameras[0].id, 'live-traffic-wy-55-1');
  assert.equal(cameras[0].lat, 41.079213); assert.equal(cameras[0].lon, -104.855988);
  assert.equal(cameras[0].cityId, 'us-wy'); assert.equal(cameras[0].framePolicy, 'live-only');
  const loaded = await loadLiveTrafficProvider(config('wy'), {}, { fetchImpl: async (url) => {
    assert.equal(url, 'https://map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf');
    return new Response(wyomingFixture());
  } });
  assert.equal(loaded.length, 2);
});

test('Wyoming rejects truncated, oversized, malformed and foreign-host camera records', () => {
  for (const bad of [Buffer.from([0x80]), Buffer.from([0x0a, 0xff, 0xff, 0x7f]), Buffer.from([0x0f]),
    Buffer.alloc(0), Buffer.alloc(17 * 1024 * 1024), wyomingFixture('https://evil.test/web-cam/cache?ref=a'),
    wyomingFixture().subarray(0, 15), Buffer.from([0]), Buffer.from([0x08, 1])]) {
    assert.throws(() => parseWyomingCameras(bad));
  }
});

test('provider PNGs with JPEG headers are served correctly; larger Idaho frames remain bounded', async () => {
  const png = Buffer.alloc(3 * 1024 * 1024); Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  for (const source of [normalizeMontanaCamera(mt)[0], normalizeIdahoCamera(idaho())[0]]) {
    const frame = await fetchLiveTrafficFrame(source, { fetchImpl: async () => new Response(png, { headers: { 'Content-Type': 'image/jpeg' } }) });
    assert.equal(frame.contentType, 'image/png'); assert.equal(frame.body.length, png.length);
    const tooLarge = Buffer.alloc(7 * 1024 * 1024); png.copy(tooLarge);
    assert.equal(await fetchLiveTrafficFrame(source, { fetchImpl: async () => new Response(tooLarge, { headers: { 'Content-Type': 'image/png' } }) }), null);
  }
});
