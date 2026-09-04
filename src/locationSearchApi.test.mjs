import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  locationSearchApiPlugin,
  findRoadIntersection,
  looksLikeIntersection,
  normalizeGoogleGeocodeResult,
  normalizeGoogleJurisdiction,
  normalizeLocationQuery,
  normalizeNominatimJurisdiction,
  normalizeNominatimResult,
  parseIntersectionQuery,
  resolveLocationSearch,
} from '../server/locationSearchApi.js';

test('normalizes human location queries without damaging address punctuation', () => {
  assert.equal(normalizeLocationQuery('  5th St.  &  Congress Ave, Austin, TX  '), '5th St. & Congress Ave, Austin, TX');
  assert.equal(looksLikeIntersection('5th St and Congress Ave, Austin'), true);
  assert.equal(looksLikeIntersection('Congress Avenue, Austin'), false);
  assert.deepEqual(parseIntersectionQuery('E 5th St & Congress Ave, Austin, TX'), {
    first: 'E 5th St', second: 'Congress Ave', locality: 'Austin, TX',
  });
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

test('finds the geometric crossing of expanded OSM street names', () => {
  const point = findRoadIntersection([
    { tags: { name: 'East 5th Street' }, geometry: [{ lat: 30, lon: -98 }, { lat: 30, lon: -97 }] },
    { tags: { name: 'Congress Avenue' }, geometry: [{ lat: 29, lon: -97.5 }, { lat: 31, lon: -97.5 }] },
  ], 'E 5th St', 'Congress Ave');
  assert.deepEqual(point, { lat: 30, lng: -97.5 });
});

test('resolver falls back to OSM road geometry when Google rejects an intersection', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('maps.googleapis.com')) {
      return { json: async () => ({ status: 'REQUEST_DENIED', error_message: 'disabled' }) };
    }
    if (String(url).includes('places.googleapis.com')) {
      return { json: async () => ({ error: { message: 'disabled' } }) };
    }
    if (String(url).includes('nominatim.openstreetmap.org')) {
      const road = new URL(String(url)).searchParams.get('q');
      const first = road.startsWith('E 5th St')
        ? { type: 'LineString', coordinates: [[-97.75, 30.26], [-97.73, 30.27]] }
        : { type: 'LineString', coordinates: [[-97.73, 30.25], [-97.745, 30.28]] };
      return {
      ok: true,
      json: async () => [{
        lat: '30.2673', lon: '-97.7431', display_name: road,
        addresstype: 'road', geojson: first,
      }],
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const resolved = await resolveLocationSearch({
    query: 'E 5th St & Congress Ave, Austin, TX',
    apiKey: 'server-only-key',
    fetchImpl,
  });
  assert.equal(resolved.provider, 'openstreetmap');
  assert.equal(resolved.result.formatted_address, 'E 5th St & Congress Ave, Austin, TX');
  assert.ok(resolved.result.types.includes('intersection'));
  assert.equal(calls.length, 4);
});

test('location API registers the same-origin search route', () => {
  const routes = new Map();
  locationSearchApiPlugin({ env: {} }).configureServer({
    middlewares: { use(path, handler) { routes.set(path, handler); } },
  });
  assert.equal(typeof routes.get('/api/location/search'), 'function');
  assert.equal(typeof routes.get('/api/location/reverse'), 'function');
});

test('normalizes Google and OpenStreetMap jurisdiction responses', () => {
  assert.deepEqual(normalizeGoogleJurisdiction({
    status: 'OK',
    results: [{
      formatted_address: 'Austin, Travis County, Texas, USA',
      address_components: [
        { long_name: 'Austin', short_name: 'Austin', types: ['locality'] },
        { long_name: 'Travis County', short_name: 'Travis County', types: ['administrative_area_level_2'] },
        { long_name: 'Texas', short_name: 'TX', types: ['administrative_area_level_1'] },
        { long_name: 'United States', short_name: 'US', types: ['country'] },
      ],
    }],
  }), {
    countryCode: 'US', country: 'United States', region: 'Texas', county: 'Travis County', city: 'Austin',
    formattedAddress: 'Austin, Travis County, Texas, USA',
  });
  assert.deepEqual(normalizeNominatimJurisdiction({
    display_name: 'Austin, Travis County, Texas, United States',
    address: { city: 'Austin', county: 'Travis County', state: 'Texas', country: 'United States', country_code: 'us' },
  }), {
    countryCode: 'US', country: 'United States', region: 'Texas', county: 'Travis County', city: 'Austin',
    formattedAddress: 'Austin, Travis County, Texas, United States',
  });
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
