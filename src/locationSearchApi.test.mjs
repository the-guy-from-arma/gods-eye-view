import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  locationSearchApiPlugin,
  looksLikeIntersection,
  normalizeGoogleGeocodeResult,
  normalizeLocationQuery,
  normalizeNominatimResult,
  resolveLocationSearch,
} from '../server/locationSearchApi.js';

test('normalizes human location queries without damaging address punctuation', () => {
  assert.equal(normalizeLocationQuery('  5th St.  &  Congress Ave, Austin, TX  '), '5th St. & Congress Ave, Austin, TX');
  assert.equal(looksLikeIntersection('5th St and Congress Ave, Austin'), true);
  assert.equal(looksLikeIntersection('Congress Avenue, Austin'), false);
});

test('normalizes exact Google address results for the location client', () => {
  assert.deepEqual(normalizeGoogleGeocodeResult({
    formatted_address: '1100 Congress Ave., Austin, TX 78701, USA',
    types: ['street_address'],
    geometry: {
      location: { lat: 30.2747, lng: -97.7403 },
      viewport: {
        southwest: { lat: 30.273, lng: -97.742 },
        northeast: { lat: 30.276, lng: -97.739 },
      },
    },
  }), {
    formatted_address: '1100 Congress Ave., Austin, TX 78701, USA',
    types: ['street_address'],
    geometry: {
      location: { lat: 30.2747, lng: -97.7403 },
      viewport: {
        southwest: { lat: 30.273, lng: -97.742 },
        northeast: { lat: 30.276, lng: -97.739 },
      },
    },
  });
});

test('OpenStreetMap fallback classifies towns and intersections for camera framing', () => {
  const town = normalizeNominatimResult({
    lat: '42.6526', lon: '-73.7562', display_name: 'Albany, New York, United States',
    addresstype: 'city', boundingbox: ['42.60', '42.70', '-73.85', '-73.68'],
  }, 'Albany NY');
  assert.deepEqual(town.types, ['locality', 'political']);

  const intersection = normalizeNominatimResult({
    lat: '30.2673', lon: '-97.7431', display_name: '5th Street and Congress Avenue',
    addresstype: 'road',
  }, '5th Street & Congress Avenue, Austin');
  assert.deepEqual(intersection.types, ['intersection', 'route']);
});

test('resolver falls back to OpenStreetMap when Google rejects the key', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('maps.googleapis.com')) {
      return { json: async () => ({ status: 'REQUEST_DENIED', error_message: 'disabled' }) };
    }
    if (String(url).includes('places.googleapis.com')) {
      return { json: async () => ({ error: { message: 'disabled' } }) };
    }
    return {
      ok: true,
      json: async () => [{
        lat: '30.2673', lon: '-97.7431', display_name: '5th Street and Congress Avenue, Austin, Texas',
        addresstype: 'road', boundingbox: ['30.2672', '30.2674', '-97.7432', '-97.7430'],
      }],
    };
  };
  const resolved = await resolveLocationSearch({
    query: '5th Street & Congress Avenue, Austin',
    apiKey: 'server-only-key',
    fetchImpl,
  });
  assert.equal(resolved.provider, 'openstreetmap');
  assert.equal(resolved.result.formatted_address, '5th Street and Congress Avenue, Austin, Texas');
  assert.ok(resolved.result.types.includes('intersection'));
  assert.equal(calls.length, 3);
});

test('location API registers the same-origin search route', () => {
  const routes = new Map();
  locationSearchApiPlugin({ env: {} }).configureServer({
    middlewares: { use(path, handler) { routes.set(path, handler); } },
  });
  assert.equal(typeof routes.get('/api/location/search'), 'function');
});

test('defined-location and landmark rails expose draggable scrolling plus wheel navigation', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const railCss = css.slice(
    css.lastIndexOf('#command-dock .location-pills {'),
    css.indexOf('#command-dock .location-bar-divider.visible', css.lastIndexOf('#command-dock .location-pills {')),
  );
  assert.match(railCss, /scrollbar-width: thin/);
  assert.match(railCss, /location-pills::-webkit-scrollbar[\s\S]*?display: block/);
  assert.match(railCss, /poi-row-container\.expanded::-webkit-scrollbar[\s\S]*?display: block/);
  assert.match(ui, /_locationPills\.addEventListener\('wheel', this\._locationHorizontalWheelHandler/);
  assert.match(ui, /_poiRow\.addEventListener\('wheel', this\._locationHorizontalWheelHandler/);
});
