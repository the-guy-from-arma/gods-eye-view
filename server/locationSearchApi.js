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

/** Split common human intersection forms while preserving the locality suffix. */
export function parseIntersectionQuery(value) {
  const query = normalizeLocationQuery(value);
  const match = /^(.+?)\s+(?:&|and|at|@)\s+([^,]+?)(?:,\s*(.+))?$/i.exec(query);
  if (!match) return null;
  const first = normalizeLocationQuery(match[1]);
  const second = normalizeLocationQuery(match[2]);
  const locality = normalizeLocationQuery(match[3]);
  if (!first || !second) return null;
  return { first, second, locality };
}

const STREET_WORDS = Object.freeze({
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest',
  se: 'southeast', sw: 'southwest', st: 'street', ave: 'avenue', av: 'avenue',
  rd: 'road', blvd: 'boulevard', dr: 'drive', ln: 'lane', hwy: 'highway',
  pkwy: 'parkway', pl: 'place', ct: 'court', ter: 'terrace', cir: 'circle',
});

function canonicalStreetName(value) {
  return normalizeLocationQuery(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).map((word) => STREET_WORDS[word] || word).join(' ');
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function streetNamePattern(value) {
  const original = normalizeLocationQuery(value).replace(/[.]/g, '');
  const expanded = canonicalStreetName(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
  return [...new Set([original, expanded].filter(Boolean))].map(regexEscape).join('|');
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

function segmentIntersection(a, b, c, d) {
  const denominator = (a.lon - b.lon) * (c.lat - d.lat) - (a.lat - b.lat) * (c.lon - d.lon);
  if (Math.abs(denominator) < 1e-12) return null;
  const determinantA = a.lon * b.lat - a.lat * b.lon;
  const determinantB = c.lon * d.lat - c.lat * d.lon;
  const lon = (determinantA * (c.lon - d.lon) - (a.lon - b.lon) * determinantB) / denominator;
  const lat = (determinantA * (c.lat - d.lat) - (a.lat - b.lat) * determinantB) / denominator;
  const inside = (value, left, right) => value >= Math.min(left, right) - 1e-9
    && value <= Math.max(left, right) + 1e-9;
  return inside(lon, a.lon, b.lon) && inside(lat, a.lat, b.lat)
    && inside(lon, c.lon, d.lon) && inside(lat, c.lat, d.lat)
    ? { lat, lng: lon }
    : null;
}

/** Find the first geometric crossing between two sets of OSM road ways. */
export function findRoadIntersection(elements, firstName, secondName) {
  const firstCanonical = canonicalStreetName(firstName);
  const secondCanonical = canonicalStreetName(secondName);
  const firstWays = [];
  const secondWays = [];
  for (const element of Array.isArray(elements) ? elements.slice(0, 160) : []) {
    const geometry = Array.isArray(element?.geometry)
      ? element.geometry.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon)).slice(0, 500)
      : [];
    if (geometry.length < 2) continue;
    const name = canonicalStreetName(element?.tags?.name);
    if (name === firstCanonical) firstWays.push(geometry);
    if (name === secondCanonical) secondWays.push(geometry);
  }
  for (const first of firstWays) {
    for (const second of secondWays) {
      for (let i = 1; i < first.length; i += 1) {
        for (let j = 1; j < second.length; j += 1) {
          const point = segmentIntersection(first[i - 1], first[i], second[j - 1], second[j]);
          if (point) return point;
        }
      }
    }
  }
  return null;
}

async function fetchOpenStreetMapIntersection(query, fetchImpl) {
  const parsed = parseIntersectionQuery(query);
  if (!parsed?.locality) return { result: null, error: null };
  const locality = await fetchNominatim(parsed.locality, fetchImpl);
  const center = locality.result?.geometry?.location;
  if (!center) return { result: null, error: locality.error };
  const firstPattern = streetNamePattern(parsed.first);
  const secondPattern = streetNamePattern(parsed.second);
  if (!firstPattern || !secondPattern) return { result: null, error: null };
  const around = `around:50000,${center.lat},${center.lng}`;
  const queryText = `[out:json][timeout:18];(`
    + `way(${around})["highway"]["name"~"^(${firstPattern})$",i];`
    + `way(${around})["highway"]["name"~"^(${secondPattern})$",i];`
    + ');out tags geom;';
  try {
    const body = new URLSearchParams({ data: queryText });
    const response = await fetchImpl('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': 'ThunderLinkGodsEye/0.1 (+https://github.com/the-guy-from-arma/gods-eye-view)',
      },
      body,
    });
    if (!response.ok) throw new Error(`OpenStreetMap road search returned ${response.status}`);
    const payload = await response.json();
    const point = findRoadIntersection(payload?.elements, parsed.first, parsed.second);
    if (!point) return { result: null, error: null };
    const latPad = 0.002;
    const lngPad = latPad / Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
    return {
      result: {
        formatted_address: `${parsed.first} & ${parsed.second}, ${parsed.locality}`,
        types: ['intersection', 'route'],
        geometry: {
          location: point,
          viewport: {
            southwest: { lat: point.lat - latPad, lng: point.lng - lngPad },
            northeast: { lat: point.lat + latPad, lng: point.lng + lngPad },
          },
        },
      },
      error: null,
    };
  } catch (error) {
    return { result: null, error: error?.message || 'OpenStreetMap road search failed' };
  }
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
    const osm = looksLikeIntersection(cleanQuery)
      ? await fetchOpenStreetMapIntersection(cleanQuery, fetchImpl)
      : await fetchNominatim(cleanQuery, fetchImpl);
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
