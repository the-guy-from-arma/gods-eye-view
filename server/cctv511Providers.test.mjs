import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIbi511Query,
  enabledProviderKeys,
  encryptNewJersey511Payload,
  normalizeAlabamaCamera,
  normalizeArkansasCamera,
  normalizeColoradoCamera,
  normalizeGraphql511Cameras,
  normalizeIbi511Camera,
  normalizeIndianaCamera,
  normalizeMassachusettsCamera,
  normalizeMichiganCamera,
  normalizeMissouriCamera,
  normalizeNewJerseyCamera,
  normalizeNewMexicoCamera,
  normalizeOklahomaCamera,
  normalizeOhioCamera,
  normalizeOregonCamera,
  normalizeSouthCarolinaCamera,
  normalizeSouthDakotaCameras,
  normalizeTennesseeCamera,
  normalizeTravelMidwestCamera,
  normalizeVirginiaCamera,
  parseIbi511Wkt,
} from './cctv511Providers.js';

test('IBI 511 query requests a bounded 100-row page', () => {
  const query = JSON.parse(decodeURIComponent(buildIbi511Query(200)));
  assert.equal(query.start, 200);
  assert.equal(query.length, 100);
  assert.equal(query.order[0].dir, 'asc');
});

test('IBI 511 records normalize public snapshots and reject gated video', () => {
  const config = {
    key: 'fl', base: 'https://fl511.com', idPrefix: 'fdot', provider: 'Florida 511 · FDOT',
    state: 'Florida', bounds: [24.4, 31.1, -87.7, -79.9],
  };
  const camera = normalizeIbi511Camera({
    id: 42,
    roadway: 'I-95',
    location: 'I-95 at Sample Road',
    county: 'Broward',
    latLng: { geography: { wellKnownText: 'POINT (-80.1402 26.2712)' } },
    images: [{ imageUrl: '/map/Cctv/42', videoUrl: 'https://video.example/42.m3u8', isVideoAuthRequired: true }],
  }, config);

  assert.equal(camera?.id, 'fdot-42');
  assert.equal(camera?.feedType, 'image');
  assert.equal(camera?.url, 'https://fl511.com/map/Cctv/42');
  assert.equal(camera?.city, 'Broward County, Florida');
  assert.equal(parseIbi511Wkt('POINT (-80.1 26.2)')?.lon, -80.1);
});

test('Oregon, Michigan, and Indiana provider rows normalize to canonical cameras', () => {
  const oregon = normalizeOregonCamera({ attributes: {
    cameraId: 7, filename: 'US26-at-Zoo.jpg', latitude: 45.51, longitude: -122.71,
    route: 'US 26', title: 'US 26 at Zoo',
  } });
  assert.equal(oregon?.id, 'odot-7');
  assert.equal(oregon?.provider, 'Oregon 511 · ODOT TripCheck');

  const michigan = normalizeMichiganCamera({
    route: 'I-75', location: 'at Main St',
    county: '<a href="?lat=42.33&amp;lon=-83.05&id=88">Go to</a> Wayne',
    image: '<img src="https://mdot.example/cam88.jpg">',
  });
  assert.equal(michigan?.id, 'mdot-88');
  assert.match(michigan?.city || '', /Wayne, Michigan/);

  const indiana = normalizeIndianaCamera({
    __typename: 'Camera', active: true, title: 'I-94: 1-094-035-8-1 E OF US421', uri: 'camera/99',
    features: [{ geometry: { coordinates: [-86.88, 41.61] } }],
    views: [{ url: 'https://511in.org/cameras/IN/INDOT_99_token.flv.png' }],
  });
  assert.equal(indiana?.id, 'indot-99');
  assert.equal(indiana?.feedType, 'hls');
  assert.match(indiana?.url || '', /INDOT_99_token\/playlist\.m3u8$/);
});

test('state normalizers reject out-of-bounds or malformed records', () => {
  assert.equal(normalizeOregonCamera({ attributes: { cameraId: 1, filename: 'x.jpg', latitude: 30, longitude: -122 } }), null);
  assert.equal(parseIbi511Wkt('not a point'), null);
  assert.equal(normalizeIndianaCamera({ __typename: 'Camera', active: true }), null);
});

test('Virginia, New Jersey, and Massachusetts rows normalize their official schemas', () => {
  const virginia = normalizeVirginiaCamera({
    properties: {
      id: '3958', active: true, description: 'University Drive and Sager Avenue',
      jurisdiction: 'City of Fairfax',
      image_url: 'https://snapshot.vdotcameras.com/thumbs/sample.flv.png',
      https_url: 'https://media-sfs7.vdotcameras.com/rtplive/sample/playlist.m3u8',
    },
    geometry: { coordinates: [-77.3055, 38.84519] },
  });
  assert.equal(virginia?.id, 'vdot-3958');
  assert.equal(virginia?.feedType, 'hls');
  assert.match(virginia?.city || '', /Fairfax, Virginia/);

  const newJersey = normalizeNewJerseyCamera({
    id: 4, name: 'NJ-35 @ Cliffwood Avenue', latitude: '40.43880048', longitude: '-74.22426624',
    deviceDescription: 'Aberdeen Township',
    cameraMainDetail: [{ camera_use_flag: 'HLS', url: 'https://nj-511.wink.co/hls/public/sample/index.m3u8' }],
  });
  assert.equal(newJersey?.id, 'njdot-4');
  assert.equal(newJersey?.feedType, 'hls');

  const massachusetts = normalizeMassachusettsCamera({
    __typename: 'Camera', active: true, title: 'US 1 at Walnut Street', uri: 'camera/12292',
    features: [{ geometry: { coordinates: [-71.01348, 42.50653] } }],
    views: [{ category: 'VIDEO', url: 'https://public.carsprogram.org/cameras/MA/435429-fullJpeg.jpg' }],
  });
  assert.equal(massachusetts?.id, 'massdot-12292');
  assert.equal(massachusetts?.feedType, 'image');
  assert.equal(massachusetts?.url, '');
  assert.equal(massachusetts?.framePolicy, 'metadata-only');
});

test('511NJ public-role request envelope is deterministic AES hex', () => {
  const encrypted = encryptNewJersey511Payload({ username: 'public', password: '', role: 'public' });
  assert.match(encrypted, /^[0-9a-f]+$/);
  assert.equal(encrypted.length % 32, 0);
  assert.equal(encrypted, encryptNewJersey511Payload({ username: 'public', password: '', role: 'public' }));
});

test('Tennessee and South Carolina rows normalize public HLS cameras', () => {
  const tennessee = normalizeTennesseeCamera({
    id: 3165, active: 'true', title: 'I-40/75 @ West Hills', jurisdiction: 'Knoxville',
    lat: 35.928889, lng: -84.039167,
    thumbnailUrl: 'https://tnsnapshots.com/thumbs/R1_010.flv.png',
    httpsVideoUrl: 'https://mcleansfs1.us-east-1.skyvdn.com/rtplive/R1_010/playlist.m3u8',
  });
  assert.equal(tennessee?.id, 'tdot-3165');
  assert.equal(tennessee?.feedType, 'hls');
  assert.match(tennessee?.city || '', /Knoxville, Tennessee/);

  const southCarolina = normalizeSouthCarolinaCamera({
    geometry: { coordinates: [-80.997286, 33.948503] },
    properties: {
      id: '2735', active: true, problem_stream: false, description: 'I-77 S @ MM 4.9', jurisdiction: 'Columbia',
      https_url: 'https://s18.us-east-1.skyvdn.com/rtplive/10002/playlist.m3u8',
      image_url: 'https://scdotsnap.us-east-1.skyvdn.com/thumbs/10002.flv.png',
    },
  });
  assert.equal(southCarolina?.id, 'scdot-2735');
  assert.equal(southCarolina?.feedType, 'hls');
});

test('Alabama placements and Ohio snapshots honor provider media rules', () => {
  const alabama = normalizeAlabamaCamera({
    id: 1845, accessLevel: 'Public',
    location: { latitude: 30.535105, longitude: -88.23953, city: 'Mobile', displayRouteDesignator: 'I-10', displayCrossStreet: 'McDonald Rd', direction: 'East' },
    snapshotImageUrl: 'https://api.algotraffic.com/v4/Cameras/1845/snapshot.jpg',
  });
  assert.equal(alabama?.id, 'aldot-1845');
  assert.equal(alabama?.url, '');
  assert.equal(alabama?.framePolicy, 'metadata-only');

  const ohio = normalizeOhioCamera({
    Id: '00000000000001', Latitude: 41.50557, Longitude: -82.84921,
    Description: 'SR-2 at S Lightner Rd',
  }, { Direction: 'View', LargeURL: 'https://itscameras.dot.state.oh.us/images/toledo/sample.jpg' }, 0);
  assert.equal(ohio?.id, 'ohdot-00000000000001-0');
  assert.equal(ohio?.feedType, 'image');
});

test('legacy provider override cannot hide newly added defaults, but explicit exclusions can', () => {
  const enabled = enabledProviderKeys({ CCTV_STATE_511_PROVIDERS: 'az,fl,ga' });
  for (const key of ['ny', 'tn', 'sc', 'al', 'oh', 'vt', 'ct', 'co', 'nm', 'ks', 'ok', 'ar', 'mo', 'ia', 'ne', 'sd', 'mn', 'wi', 'il']) assert.equal(enabled.has(key), true);
  const excluded = enabledProviderKeys({ CCTV_STATE_511_EXCLUDE_PROVIDERS: 'ny,al' });
  assert.equal(excluded.has('ny'), false);
  assert.equal(excluded.has('al'), false);
  assert.equal(excluded.has('tn'), true);
});

test('new state schemas normalize public media and placement-only records', () => {
  const graphql = normalizeGraphql511Cameras({
    __typename: 'Camera', active: true, title: 'I-80 at MM 60', uri: 'camera/42',
    features: [{ geometry: { coordinates: [-94.94, 41.49] } }],
    views: [{ category: 'IMAGE', url: 'https://example.gov/camera.jpg' }],
  }, { key: 'ia', idPrefix: 'iadot', state: 'Iowa', provider: 'Iowa 511', bounds: [40.3, 43.6, -96.7, -90] });
  assert.equal(graphql[0]?.id, 'iadot-42-0');
  assert.equal(graphql[0]?.stateCode, 'IA');

  const colorado = normalizeColoradoCamera({ geometry: { coordinates: [-105, 39.7] }, properties: {
    id: 7, name: 'I-70 at Denver', views: [{ name: 'WEST', url: 'https://example.gov/co.jpg' }],
  } });
  assert.equal(colorado[0]?.stateCode, 'CO');

  const newMexico = normalizeNewMexicoCamera({ name: 'I25_Test', title: 'I-25 Test', lat: 35.5, lon: -106.2, enabled: true, snapshotFile: 'http://ss.nmroads.com/snapshots/test.jpg' });
  assert.match(newMexico?.url || '', /^http:\/\//);

  const arkansas = normalizeArkansasCamera({ geometry: { coordinates: [-92.2, 34.7] }, properties: { id: 9, status: 'online', name: 'I-40', hls_stream_protected: 'https://example.gov/feed.m3u8' } });
  assert.equal(arkansas?.feedType, 'hls');

  const oklahoma = normalizeOklahomaCamera({ id: 2, latitude: 36.1, longitude: -95.8, location: 'I-244', blockAtis: '0' });
  assert.equal(oklahoma?.framePolicy, 'metadata-only');

  const missouri = normalizeMissouriCamera({ id: 1, caption: 'US-60', url: '/camera.jpg', location: { x: -90.4, y: 36.7 } });
  assert.equal(missouri?.stateCode, 'MO');

  const southDakota = normalizeSouthDakotaCameras({ id: 'SITE', geometry: { coordinates: [-97.06, 44.95] }, properties: { cameras: [{ id: 1, description: 'I-29 south', image: 'https://example.gov/sd.jpg' }] } });
  assert.equal(southDakota[0]?.stateCode, 'SD');

  const illinois = normalizeTravelMidwestCamera({ geometry: { coordinates: [-88.1, 42.2] }, properties: { id: 'IL-IDOT-1', locDesc: 'I-90', remUrls: ['https://example.gov/il.jpg'], dirs: ['W'] } });
  assert.equal(illinois[0]?.minFrameRefreshMs, 300000);
});
