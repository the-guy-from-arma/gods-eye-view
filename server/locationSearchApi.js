const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;
const MAX_QUERY_LENGTH = 240;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

const searchCache = new Map();
let nominatimQueue = Promise.resolve();
let nominatimLastRequestAt = 0;

/** Keep user-entered addresses intact while removing whitespace/control noise. */
export function normalizeLocationQuery(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

export function looksLikeIntersection(value) {
  const query = normalizeLocationQuery(value);
  return /\s(?:&|and|at|@)\s/i.test(query);
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeViewport(viewport) {
  const southwest = viewport?.southwest;
  const northeast = viewport?.northeast;
  const south = finiteCoordinate(southwest?.lat, -90, 90);
  const west = finiteCoordinate(southwest?.lng, -180, 180);
  const north = finiteCoordinate(northeast?.lat, -90, 90);
  const east = finiteCoordinate(northeast?.lng, -180, 180);
  if ([south, west, north, east].some((value) => value === null)) return null;
  return { southwest: { lat: south, lng: west }, northeast: { lat: north, lng: east } };
}

/** Normalize a Google Geocoding result to the small client contract we need. */
export function normalizeGoogleGeocodeResult(result) {
  const lat = finiteCoordinate(result?.geometry?.location?.lat, -90, 90);
  const lng = finiteCoordinate(result?.geometry?.location?.lng, -180, 180);
  if (lat === null || lng === null) return null;
  const viewport = normalizeViewport(result?.geometry?.bounds)
    || normalizeViewport(result?.geometry?.viewport);
  return {
    formatted_address: normalizeLocationQuery(result?.formatted_address) || null,
    types: Array.isArray(result?.types)
      ? result.types.map((type) => normalizeLocationQuery(type)).filter(Boolean).slice(0, 12)
      : [],
    geometry: {
      location: { lat, lng },
      viewport,
    },
  };
}

function nominatimTypes(row, intersection) {
  const kind = String(row?.addresstype || row?.type || '').toLowerCase();
  let types;
  if (kind === 'country') types = ['country', 'political'];
  else if (['state', 'province', 'region'].includes(kind)) types = ['administrative_area_level_1', 'political'];
  else if (['county', 'state_district'].includes(kind)) types = ['administrative_area_level_2', 'political'];
  else if (['city', 'town', 'municipality', 'village', 'borough'].includes(kind)) types = ['locality', 'political'];
  else if (['suburb', 'neighbourhood', 'quarter', 'district'].includes(kind)) types = ['neighborhood', 'political'];
  else if (['road', 'street', 'pedestrian', 'residential'].includes(kind)) types = ['route'];
  else if (['house', 'building'].includes(kind)) types = ['street_address', 'premise'];
  else types = ['point_of_interest'];
  if (intersection && !types.includes('intersection')) types.unshift('intersection');
  return types;
}

/** Normalize an OpenStreetMap/Nominatim result to the Google-shaped client contract. */
export function normalizeNominatimResult(row, query = '') {
  const lat = finiteCoordinate(row?.lat, -90, 90);
  const lng = finiteCoordinate(row?.lon, -180, 180);
  if (lat === null || lng === null) return null;
  const box = Array.isArray(row?.boundingbox) ? row.boundingbox.map(Number) : [];
  const viewport = box.length === 4 && box.every(Number.isFinite)
    ? normalizeViewport({
      southwest: { lat: box[0], lng: box[2] },
      northeast: { lat: box[1], lng: box[3] },
    })
    : null;
  return {
    formatted_address: normalizeLocationQuery(row?.display_name) || normalizeLocationQuery(query) || null,
    types: nominatimTypes(row, looksLikeIntersection(query)),
    geometry: { location: { lat, lng }, viewport },
  };
}

function cacheRead(key) {
  const entry = searchCache.get(key);
  if (!entry || Date.now() - entry.at > SEARCH_CACHE_TTL_MS) {
    if (entry) searchCache.delete(key);
    return undefined;
  }
  searchCache.delete(key);
  searchCache.set(key, entry);
  return entry.value;
}

function cacheWrite(key, value) {
  searchCache.set(key, { at: Date.now(), value });
  while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
}

function parseBoundsParam(value) {
  const parts = String(value || '').split(/[|,]/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return '';
  const [south, west, north, east] = parts;
  if (south < -90 || south > 90 || north < -90 || north > 90
      || west < -180 || west > 180 || east < -180 || east > 180) return '';
  return { parts, google: `${south},${west}|${north},${east}` };
}

async function fetchGoogleGeocode(query, bounds, apiKey, fetchImpl) {
  if (!apiKey) return { result: null, error: null };
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('key', apiKey);
  if (bounds) url.searchParams.set('bounds', bounds.google);
  try {
    const response = await fetchImpl(url);
    const data = await response.json().catch(() => ({}));
    const result = data?.status === 'OK' && Array.isArray(data?.results)
      ? normalizeGoogleGeocodeResult(data.results[0])
      : null;
    return { result, error: result ? null : (data?.error_message || data?.status || null) };
  } catch (error) {
    return { result: null, error: error?.message || 'Google geocoding failed' };
  }
}

async function fetchGooglePlaces(query, bounds, apiKey, fetchImpl) {
  if (!apiKey) return { result: null, error: null };
  const body = { textQuery: query, maxResultCount: 5 };
  if (bounds) {
    const [south, west, north, east] = bounds.parts;
    if (west <= east) {
      body.locationBias = {
        rectangle: {
          low: { latitude: south, longitude: west },
          high: { latitude: north, longitude: east },
        },
      };
    }
  }
  try {
    const response = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.formattedAddress',
          'places.displayName',
          'places.location',
          'places.viewport',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    const place = Array.isArray(data?.places) ? data.places[0] : null;
    const result = place ? normalizeGoogleGeocodeResult({
      formatted_address: place.formattedAddress || place.displayName?.text || query,
      types: place.types,
      geometry: {
        location: { lat: place.location?.latitude, lng: place.location?.longitude },
        viewport: place.viewport ? {
          southwest: { lat: place.viewport.low?.latitude, lng: place.viewport.low?.longitude },
          northeast: { lat: place.viewport.high?.latitude, lng: place.viewport.high?.longitude },
        } : null,
      },
    }) : null;
    return { result, error: result ? null : (data?.error?.message || null) };
  } catch (error) {
    return { result: null, error: error?.message || 'Google Places search failed' };
  }
}

function fetchNominatim(query, fetchImpl) {
  const task = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, NOMINATIM_MIN_INTERVAL_MS - (Date.now() - nominatimLastRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nominatimLastRequestAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'en');
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': 'ThunderLinkGodsEye/0.1 (+https://github.com/the-guy-from-arma/gods-eye-view)',
        Referer: 'https://github.com/the-guy-from-arma/gods-eye-view',
      },
    });
    if (!response.ok) throw new Error(`OpenStreetMap search returned ${response.status}`);
    const rows = await response.json();
    const result = Array.isArray(rows)
      ? rows.map((row) => normalizeNominatimResult(row, query)).find(Boolean) || null
      : null;
    return { result, error: null };
  });
  nominatimQueue = task.catch(() => null);
  return task;
}

/** Resolve an address/place with Google first, then keyless OpenStreetMap fallback. */
export async function resolveLocationSearch({ query, bounds = '', apiKey = '', fetchImpl = fetch }) {
  const cleanQuery = normalizeLocationQuery(query);
  if (!cleanQuery) return { result: null, provider: null, error: 'A location is required' };
  const cleanBounds = parseBoundsParam(bounds);
  const cacheKey = `${cleanQuery.toLowerCase()}|${cleanBounds?.google || ''}`;
  const cached = cacheRead(cacheKey);
  if (cached !== undefined) return { ...cached, cached: true };

  const google = await fetchGoogleGeocode(cleanQuery, cleanBounds, String(apiKey || '').trim(), fetchImpl);
  if (google.result) {
    // Google Maps Content stays live-only under the provider terms.
    return { result: google.result, provider: 'google', error: null };
  }

  const places = await fetchGooglePlaces(cleanQuery, cleanBounds, String(apiKey || '').trim(), fetchImpl);
  if (places.result) {
    // Google Maps Content stays live-only under the provider terms.
    return { result: places.result, provider: 'google-places', error: null };
  }

  try {
    const osm = await fetchNominatim(cleanQuery, fetchImpl);
    if (osm.result) {
      const value = { result: osm.result, provider: 'openstreetmap', error: null };
      cacheWrite(cacheKey, value);
      return value;
    }
  } catch (error) {
    return {
      result: null,
      provider: null,
      error: error?.message || places.error || google.error || 'Location search failed',
    };
  }

  const value = { result: null, provider: null, error: null };
  cacheWrite(cacheKey, value);
  return value;
}

function sendJson(res, statusCode, payload, cacheControl = 'no-store') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(payload));
}

export function locationSearchApiPlugin({ env = {}, fetchImpl = fetch } = {}) {
  function install(middlewares) {
    middlewares.use('/api/location/search', async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { result: null, provider: null, error: 'Method not allowed' });
        return;
      }
      const requestUrl = new URL(req.url || '', 'http://localhost');
      const query = normalizeLocationQuery(requestUrl.searchParams.get('q'));
      if (!query) {
        sendJson(res, 400, { result: null, provider: null, error: 'A location is required' });
        return;
      }
      try {
        const payload = await resolveLocationSearch({
          query,
          bounds: requestUrl.searchParams.get('bounds') || '',
          apiKey: env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '',
          fetchImpl,
        });
        const cacheControl = payload.provider === 'openstreetmap' || payload.cached
          ? 'private, max-age=300'
          : 'no-store';
        sendJson(res, 200, payload, cacheControl);
      } catch (error) {
        sendJson(res, 502, {
          result: null,
          provider: null,
          error: error?.message || 'Location search failed',
        });
      }
    });
  }
  return {
    name: 'location-search-api',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}
