import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIbi511Query,
  encryptNewJersey511Payload,
  normalizeIbi511Camera,
  normalizeIndianaCamera,
  normalizeMassachusettsCamera,
  normalizeMichiganCamera,
  normalizeNewJerseyCamera,
  normalizeOregonCamera,
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
