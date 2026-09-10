import { createCipheriv } from 'node:crypto';

/**
 * Keyless public U.S. state 511/DOT camera catalogs.
 *
 * Catalog requests are server-side, bounded, cached by the parent CCTV proxy,
 * and return only provider-published positions and media URLs. A provider
 * failure is isolated so one state cannot blank the rest of the catalog.
 */

const PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 4;
const RETRY_CONCURRENCY = 2;
const MAX_IBI_PAGES = 60;
const CATALOG_TIMEOUT_MS = 20_000;

const IBI_PROVIDERS = [
  {
    key: 'az', base: 'https://az511.gov', idPrefix: 'adot', provider: 'Arizona 511 · ADOT',
    state: 'Arizona', bounds: [31.3, 37.1, -115.0, -109.0],
  },
  {
    key: 'fl', base: 'https://fl511.com', idPrefix: 'fdot', provider: 'Florida 511 · FDOT',
    state: 'Florida', bounds: [24.4, 31.1, -87.7, -79.9],
  },
  {
    key: 'ga', base: 'https://511ga.org', idPrefix: 'gdot', provider: 'Georgia 511 · GDOT',
    state: 'Georgia', bounds: [30.3, 35.1, -85.7, -80.8],
  },
  {
    key: 'nc', base: 'https://drivenc.gov', idPrefix: 'ncdot', provider: 'DriveNC · NCDOT',
    state: 'North Carolina', bounds: [33.8, 36.6, -84.4, -75.4],
  },
  {
    key: 'ut', base: 'https://prod-ut.ibi511.com', idPrefix: 'udot', provider: 'UDOT Traffic · Utah 511',
    state: 'Utah', bounds: [36.9, 42.1, -114.2, -108.9],
  },
  {
    key: 'nv', base: 'https://www.nvroads.com', idPrefix: 'ndot', provider: 'Nevada 511 · NDOT',
    state: 'Nevada', bounds: [34.9, 42.1, -120.1, -113.9],
  },
  {
    key: 'la', base: 'https://511la.org', idPrefix: 'ladotd', provider: 'Louisiana 511 · LADOTD',
    state: 'Louisiana', bounds: [28.8, 33.1, -94.2, -88.6],
  },
  {
    key: 'pa', base: 'https://www.511pa.com', idPrefix: 'penndot', provider: '511PA · PennDOT',
    state: 'Pennsylvania', bounds: [39.7, 42.6, -80.6, -74.5],
  },
  {
    key: 'ny', base: 'https://www.511ny.org', idPrefix: 'nysdot', provider: '511NY · NYSDOT',
    state: 'New York', bounds: [40.4, 45.1, -79.9, -71.7],
  },
];

const PROVIDER_LABELS = {
  az: 'Arizona 511 · ADOT',
  fl: 'Florida 511 · FDOT',
  ga: 'Georgia 511 · GDOT',
  nc: 'DriveNC · NCDOT',
  ut: 'UDOT Traffic · Utah 511',
  nv: 'Nevada 511 · NDOT',
  la: 'Louisiana 511 · LADOTD',
  pa: '511PA · PennDOT',
  ny: '511NY · NYSDOT',
  va: 'Virginia 511 · VDOT',
  nj: '511NJ · NJDOT',
  ma: 'Massachusetts 511 · MassDOT',
  tn: 'Tennessee SmartWay · TDOT',
  sc: '511SC · SCDOT',
  al: 'ALGO Traffic · ALDOT',
  oh: 'OHGO · ODOT',
  vt: 'New England 511 · VTrans',
  ct: 'CTroads · CTDOT',
  or: 'Oregon 511 · ODOT TripCheck',
  mi: 'Michigan 511 · MDOT MiDrive',
  in: 'Indiana 511 · INDOT TrafficWise',
};

const statusByProvider = new Map();
const lastGoodByProvider = new Map();

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function inBounds(lat, lon, bounds) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= bounds[0] && lat <= bounds[1]
    && lon >= bounds[2] && lon <= bounds[3];
}

function fallbackHeading(id) {
  let hash = 2166136261;
  for (const char of String(id)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 16) * 22.5;
}

function cameraDefaults({ id, name, state, provider, lat, lon, url, snapshotUrl, feedType = 'image', sourceKind, framePolicy = '', license = '' }) {
  return {
    id,
    name,
    city: state,
    cityId: `us-${state.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    provider,
    lat,
    lon,
    headingDeg: fallbackHeading(id),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    groundElevationM: 0,
    feedType,
    url,
    snapshotUrl: snapshotUrl || (feedType === 'image' ? url : ''),
    sourceKind,
    framePolicy,
    license: license || `${provider} public traveler-information camera`,
  };
}

export function buildIbi511Query(start = 0, length = PAGE_SIZE) {
  return encodeURIComponent(JSON.stringify({
    columns: [
      { data: null, name: '' },
      { name: 'sortOrder', s: true },
      { name: 'roadway', s: true },
      { data: 3, name: '' },
    ],
    order: [{ column: 1, dir: 'asc' }],
    start,
    length,
    search: { value: '' },
  }));
}

export function parseIbi511Wkt(value) {
  const match = String(value || '').match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return null;
  const lon = finite(match[1]);
  const lat = finite(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function usableLabel(record, state, provider) {
  const stripCode = (value) => String(value || '').trim().replace(/^[A-Z]{2,8}-?\d*\s*:\s*/, '');
  const location = stripCode(record?.location);
  const roadway = String(record?.roadway || '').trim();
  const direction = String(record?.direction || '').trim();
  const imageDescription = String(record?.images?.[0]?.description || '').trim();
  if (location && location !== 'N/A' && /\s/.test(location)) return location;
  if (roadway && roadway !== 'N/A') return direction && direction !== 'N/A' ? `${roadway} ${direction}` : roadway;
  return imageDescription || `${provider} camera in ${state}`;
}

export function normalizeIbi511Camera(record, config) {
  if (!record || !Number.isFinite(Number(record.id))) return null;
  const image = record.images?.[0];
  if (!image || image.blocked || image.disabled) return null;
  const point = parseIbi511Wkt(record.latLng?.geography?.wellKnownText);
  if (!point || !inBounds(point.lat, point.lon, config.bounds)) return null;

  let snapshotUrl = '';
  try {
    snapshotUrl = image.imageUrl ? new URL(image.imageUrl, config.base).toString() : '';
  } catch { /* malformed provider URL */ }
  let streamUrl = '';
  if (!image.videoDisabled && image.isVideoAuthRequired !== true && /\.m3u8(?:\?|$)/i.test(String(image.videoUrl || ''))) {
    try { streamUrl = new URL(image.videoUrl, config.base).toString(); } catch { /* malformed provider URL */ }
  }
  if (!snapshotUrl && !streamUrl) return null;

  const id = `${config.idPrefix}-${record.id}`;
  const locality = String(record.city || '').trim();
  const county = String(record.county || '').trim();
  return cameraDefaults({
    id,
    name: usableLabel(record, config.state, config.provider),
    state: locality && locality !== 'N/A' ? `${locality}, ${config.state}`
      : county && county !== 'N/A' ? `${county} County, ${config.state}` : config.state,
    provider: config.provider,
    lat: point.lat,
    lon: point.lon,
    url: streamUrl || snapshotUrl,
    snapshotUrl,
    feedType: streamUrl ? 'hls' : 'image',
    sourceKind: `state-511-${config.key}`,
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchIbiPage(config, start) {
  const url = `${config.base}/List/GetData/Cameras?query=${buildIbi511Query(start)}&lang=en`;
  const payload = await fetchJson(url, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
  });
  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    total: Number(payload?.recordsTotal) || 0,
  };
}

async function loadIbiProvider(config) {
  const first = await fetchIbiPage(config, 0);
  const cameras = new Map();
  let rawRowCount = first.rows.length;
  const ingest = (rows) => {
    for (const row of rows) {
      const camera = normalizeIbi511Camera(row, config);
      if (camera) cameras.set(camera.id, camera);
    }
  };
  ingest(first.rows);

  const starts = [];
  for (let start = PAGE_SIZE; start < first.total && start < PAGE_SIZE * MAX_IBI_PAGES; start += PAGE_SIZE) starts.push(start);
  const failed = [];
  for (let index = 0; index < starts.length; index += PAGE_CONCURRENCY) {
    const batch = starts.slice(index, index + PAGE_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((start) => fetchIbiPage(config, start)));
    settled.forEach((result, offset) => {
      if (result.status === 'fulfilled') {
        rawRowCount += result.value.rows.length;
        ingest(result.value.rows);
      }
      else failed.push(batch[offset]);
    });
  }
  if (failed.length) {
    for (let index = 0; index < failed.length; index += RETRY_CONCURRENCY) {
      const batch = failed.slice(index, index + RETRY_CONCURRENCY);
      const retried = await Promise.allSettled(batch.map((start) => fetchIbiPage(config, start)));
      for (const result of retried) {
        if (result.status === 'fulfilled') {
          rawRowCount += result.value.rows.length;
          ingest(result.value.rows);
        }
      }
    }
  }
  const result = [...cameras.values()];
  if (first.total && rawRowCount < first.total * 0.9) {
    throw new Error(`short pagination ${rawRowCount}/${first.total}`);
  }
  return result;
}

export function normalizeOregonCamera(feature) {
  const attributes = feature?.attributes || {};
  const id = String(attributes.cameraId ?? '').trim();
  const filename = String(attributes.filename || '').trim();
  const lat = finite(attributes.latitude);
  const lon = finite(attributes.longitude);
  if (!id || !filename || !inBounds(lat, lon, [41.9, 46.3, -124.6, -116.4])) return null;
  return cameraDefaults({
    id: `odot-${id}`,
    name: String(attributes.title || attributes.route || `ODOT camera ${id}`).trim(),
    state: attributes.route ? `${attributes.route}, Oregon` : 'Oregon',
    provider: PROVIDER_LABELS.or,
    lat,
    lon,
    url: `https://tripcheck.com/RoadCams/cams/${encodeURIComponent(filename)}`,
    sourceKind: 'state-511-or',
  });
}

async function loadOregon() {
  const payload = await fetchJson('https://www.tripcheck.com/Scripts/map/data/cctvinventory.js', { headers: { Accept: '*/*' } });
  return (Array.isArray(payload?.features) ? payload.features : []).map(normalizeOregonCamera).filter(Boolean);
}

function stripHtml(value) {
  return String(value || '').replace(/<a\b[\s\S]*?<\/a>/gi, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeMichiganCamera(record) {
  const county = String(record?.county || '');
  const image = String(record?.image || '');
  const point = county.match(/lat=(-?[\d.]+)&(?:amp;)?lon=(-?[\d.]+)/);
  const src = image.match(/src=["'](https?:\/\/[^"']+)["']/i);
  const id = county.match(/[?&]id=(\d+)/)?.[1];
  const lat = finite(point?.[1]);
  const lon = finite(point?.[2]);
  if (!id || !src || !inBounds(lat, lon, [41.6, 48.3, -90.5, -82.1])) return null;
  const title = [record?.route, record?.location].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  return cameraDefaults({
    id: `mdot-${id}`,
    name: title || `MDOT camera ${id}`,
    state: stripHtml(county) ? `${stripHtml(county)}, Michigan` : 'Michigan',
    provider: PROVIDER_LABELS.mi,
    lat,
    lon,
    url: src[1],
    sourceKind: 'state-511-mi',
  });
}

async function loadMichigan() {
  const payload = await fetchJson('https://mdotjboss.state.mi.us/MiDrive/camera/list', { headers: { Accept: 'application/json' } });
  if (!Array.isArray(payload)) throw new Error('non-array payload');
  return payload.map(normalizeMichiganCamera).filter(Boolean);
}

const INDIANA_QUERY = `query MapFeatures($input: MapFeaturesArgs!) {
  mapFeaturesQuery(input: $input) {
    mapFeatures { title uri features { geometry } __typename ... on Camera { active views(limit: 1) { category ... on CameraView { url } } } }
    error { message }
  }
}`;

export function normalizeIndianaCamera(feature) {
  if (feature?.__typename !== 'Camera' || feature.active === false) return null;
  const posterUrl = String(feature.views?.[0]?.url || '');
  const token = posterUrl.match(/\/cameras\/IN\/(INDOT_\d+_[A-Za-z0-9_-]+)\.flv\.png$/)?.[1];
  const id = String(feature.uri || '').match(/camera\/(\d+)/)?.[1];
  const coords = feature.features?.[0]?.geometry?.coordinates;
  const lon = finite(coords?.[0]);
  const lat = finite(coords?.[1]);
  if (!id || !token || !inBounds(lat, lon, [37.7, 41.9, -88.2, -84.6])) return null;
  const title = String(feature.title || '')
    .replace(/(^|:\s*)\d+(?:-[0-9a-z_]+)*\s+/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return cameraDefaults({
    id: `indot-${id}`,
    name: title || `INDOT camera ${id}`,
    state: 'Indiana',
    provider: PROVIDER_LABELS.in,
    lat,
    lon,
    url: `https://skysfs4.trafficwise.org/preroll/${token}/playlist.m3u8`,
    snapshotUrl: posterUrl,
    feedType: 'hls',
    sourceKind: 'state-511-in',
  });
}

async function loadIndiana() {
  const payload = await fetchJson('https://511in.org/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://511in.org/' },
    body: JSON.stringify({
      query: INDIANA_QUERY,
      variables: { input: { north: 41.9, south: 37.7, east: -84.6, west: -88.2, zoom: 16, layerSlugs: ['normalCameras'], nonClusterableUris: null } },
    }),
  });
  const features = payload?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(features)) throw new Error('no mapFeatures');
  return features.map(normalizeIndianaCamera).filter(Boolean);
}

export function normalizeVirginiaCamera(feature) {
  const properties = feature?.properties || {};
  if (properties.active === false) return null;
  const id = String(properties.id || '').trim();
  const coords = feature?.geometry?.coordinates;
  const lon = finite(coords?.[0]);
  const lat = finite(coords?.[1]);
  if (!id || !inBounds(lat, lon, [36.4, 39.6, -83.8, -75.1])) return null;

  const snapshotUrl = /^https?:\/\//i.test(String(properties.image_url || '')) ? String(properties.image_url) : '';
  const streamUrl = /^https:\/\/[^\s]+\.m3u8(?:\?|$)/i.test(String(properties.https_url || ''))
    ? String(properties.https_url) : '';
  if (!snapshotUrl && !streamUrl) return null;
  const jurisdiction = String(properties.jurisdiction || '').trim();
  const route = String(properties.route || '').trim();
  const direction = String(properties.direction || '').trim();
  const description = String(properties.description || '').trim();
  return cameraDefaults({
    id: `vdot-${id}`,
    name: description || [route, direction].filter(Boolean).join(' ') || `VDOT camera ${id}`,
    state: jurisdiction ? `${jurisdiction}, Virginia` : 'Virginia',
    provider: PROVIDER_LABELS.va,
    lat,
    lon,
    url: streamUrl || snapshotUrl,
    snapshotUrl,
    feedType: streamUrl ? 'hls' : 'image',
    sourceKind: 'state-511-va',
  });
}

async function loadVirginia() {
  const payload = await fetchJson('https://511.vdot.virginia.gov/services/map/array/cameras', {
    headers: { Accept: 'application/json', Referer: 'https://511.vdot.virginia.gov/' },
  });
  const features = payload?.data;
  if (!Array.isArray(features)) throw new Error('no camera array');
  return features.map(normalizeVirginiaCamera).filter(Boolean);
}

const NEW_JERSEY_BASE = 'https://511nj.org';
const NEW_JERSEY_PUBLIC_KEY = Buffer.from('lIo3M)_83,ALC0Wz');
const NEW_JERSEY_PUBLIC_IV = Buffer.from('.%A}8Qvqm23jYVc9');

/** Encode the public-role request envelope used by the official 511NJ client. */
export function encryptNewJersey511Payload(value) {
  const cipher = createCipheriv('aes-128-cbc', NEW_JERSEY_PUBLIC_KEY, NEW_JERSEY_PUBLIC_IV);
  return Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('hex');
}

export function normalizeNewJerseyCamera(record) {
  const id = String(record?.id || record?.cameraId || '').trim();
  const lat = finite(record?.latitude);
  const lon = finite(record?.longitude);
  if (!id || !inBounds(lat, lon, [38.9, 41.4, -75.7, -73.8])) return null;
  const media = (Array.isArray(record?.cameraMainDetail) ? record.cameraMainDetail : [])
    .find((item) => /^https?:\/\//i.test(String(item?.url || '')));
  const mediaUrl = String(media?.url || '');
  if (!mediaUrl) return null;
  const isHls = String(media?.camera_use_flag || '').toLowerCase() === 'hls' || /\.m3u8(?:\?|$)/i.test(mediaUrl);
  const locality = String(record?.deviceDescription || '').trim();
  return cameraDefaults({
    id: `njdot-${id}`,
    name: String(record?.name || `NJDOT camera ${id}`).trim(),
    state: locality ? `${locality}, New Jersey` : 'New Jersey',
    provider: PROVIDER_LABELS.nj,
    lat,
    lon,
    url: mediaUrl,
    snapshotUrl: isHls ? '' : mediaUrl,
    feedType: isHls ? 'hls' : 'image',
    sourceKind: 'state-511-nj',
  });
}

async function loadNewJersey() {
  const commonHeaders = {
    'Content-Type': 'application/json', Accept: 'application/json',
    Origin: NEW_JERSEY_BASE, Referer: `${NEW_JERSEY_BASE}/`,
  };
  const login = await fetchJson(`${NEW_JERSEY_BASE}/account/login`, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({
      encryptedData: encryptNewJersey511Payload({ username: 'public', password: '', role: 'public' }),
    }),
  });
  const token = String(login?.data?.accessToken || login?.accessToken || '').trim();
  if (!token) throw new Error('public role token unavailable');
  const payload = await fetchJson(`${NEW_JERSEY_BASE}/client/trafficMap/getCamera`, {
    method: 'POST',
    headers: { ...commonHeaders, Token: `Bearer ${token}` },
    body: 'null',
  });
  const cameras = payload?.data;
  if (!Array.isArray(cameras)) throw new Error('no camera array');
  return cameras.map(normalizeNewJerseyCamera).filter(Boolean);
}

export function normalizeMassachusettsCamera(feature) {
  if (feature?.__typename !== 'Camera' || feature.active === false) return null;
  const id = String(feature?.uri || '').match(/camera\/(\d+)/)?.[1];
  const coords = feature?.features?.[0]?.geometry?.coordinates;
  const lon = finite(coords?.[0]);
  const lat = finite(coords?.[1]);
  const snapshotUrl = String(feature?.views?.find((view) => /^https?:\/\//i.test(String(view?.url || '')))?.url || '');
  if (!id || !snapshotUrl || !inBounds(lat, lon, [41.1, 42.9, -73.6, -69.8])) return null;
  return cameraDefaults({
    id: `massdot-${id}`,
    name: String(feature?.title || `MassDOT camera ${id}`).trim(),
    state: 'Massachusetts',
    provider: PROVIDER_LABELS.ma,
    lat,
    lon,
    url: '',
    snapshotUrl: '',
    sourceKind: 'state-511-ma-metadata',
    framePolicy: 'metadata-only',
    license: 'MassDOT camera placement metadata; live imagery requires TrafficLand developer access',
  });
}

async function loadMassachusetts() {
  const payload = await fetchJson('https://mass511.com/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://mass511.com/' },
    body: JSON.stringify({
      query: INDIANA_QUERY,
      variables: { input: { north: 42.9, south: 41.1, east: -69.8, west: -73.6, zoom: 16, layerSlugs: ['normalCameras'], nonClusterableUris: null } },
    }),
  });
  const features = payload?.data?.mapFeaturesQuery?.mapFeatures;
  if (!Array.isArray(features)) throw new Error('no mapFeatures');
  return features.map(normalizeMassachusettsCamera).filter(Boolean);
}

export function normalizeTennesseeCamera(record) {
  if (!record || String(record.active).toLowerCase() !== 'true') return null;
  const id = String(record.id || '').trim();
  const lat = finite(record.lat);
  const lon = finite(record.lng);
  if (!id || !inBounds(lat, lon, [34.9, 36.8, -90.4, -81.5])) return null;
  const streamUrl = /^https:\/\/[^\s]+\.m3u8(?:\?|$)/i.test(String(record.httpsVideoUrl || ''))
    ? String(record.httpsVideoUrl) : '';
  const snapshotUrl = /^https:\/\//i.test(String(record.thumbnailUrl || '')) ? String(record.thumbnailUrl) : '';
  if (!streamUrl && !snapshotUrl) return null;
  const jurisdiction = String(record.jurisdiction || record.county || '').trim();
  return cameraDefaults({
    id: `tdot-${id}`,
    name: String(record.title || record.description || `TDOT camera ${id}`).trim(),
    state: jurisdiction ? `${jurisdiction}, Tennessee` : 'Tennessee',
    provider: PROVIDER_LABELS.tn,
    lat,
    lon,
    url: streamUrl || snapshotUrl,
    snapshotUrl,
    feedType: streamUrl ? 'hls' : 'image',
    sourceKind: 'state-511-tn',
  });
}

async function loadTennessee() {
  const payload = await fetchJson('https://www.tdot.tn.gov/opendata/api/public/RoadwayCameras', {
    headers: {
      ApiKey: '8d3b7a82635d476795c09b2c41facc60',
      Accept: 'application/json', Origin: 'https://smartway.tn.gov', Referer: 'https://smartway.tn.gov/',
    },
  });
  if (!Array.isArray(payload)) throw new Error('no camera array');
  return payload.map(normalizeTennesseeCamera).filter(Boolean);
}

export function normalizeSouthCarolinaCamera(feature) {
  const properties = feature?.properties || {};
  if (properties.active === false) return null;
  const id = String(properties.id || properties.guid || '').trim();
  const coords = feature?.geometry?.coordinates;
  const lon = finite(coords?.[0]);
  const lat = finite(coords?.[1]);
  if (!id || !inBounds(lat, lon, [32.0, 35.3, -83.4, -78.4])) return null;
  const streamUrl = properties.problem_stream !== true && /^https:\/\/[^\s]+\.m3u8(?:\?|$)/i.test(String(properties.https_url || ''))
    ? String(properties.https_url) : '';
  const snapshotUrl = /^https:\/\//i.test(String(properties.image_url || '')) ? String(properties.image_url) : '';
  if (!streamUrl && !snapshotUrl) return null;
  const jurisdiction = String(properties.jurisdiction || '').trim();
  return cameraDefaults({
    id: `scdot-${id}`,
    name: String(properties.description || properties.name || `SCDOT camera ${id}`).trim(),
    state: jurisdiction ? `${jurisdiction}, South Carolina` : 'South Carolina',
    provider: PROVIDER_LABELS.sc,
    lat,
    lon,
    url: streamUrl || snapshotUrl,
    snapshotUrl,
    feedType: streamUrl ? 'hls' : 'image',
    sourceKind: 'state-511-sc',
    license: '511SC public traveler-information camera; SCDOT does not record footage',
  });
}

async function loadSouthCarolina() {
  const payload = await fetchJson('https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson', {
    headers: { Accept: 'application/json', Referer: 'https://www.511sc.org/' },
  });
  const features = payload?.features;
  if (!Array.isArray(features)) throw new Error('no camera features');
  return features.map(normalizeSouthCarolinaCamera).filter(Boolean);
}

export function normalizeAlabamaCamera(record) {
  const location = record?.location || {};
  const id = String(record?.id || '').trim();
  const lat = finite(location.latitude);
  const lon = finite(location.longitude);
  if (!id || String(record?.accessLevel || '').toLowerCase() !== 'public'
    || !inBounds(lat, lon, [30.1, 35.1, -88.6, -84.8])) return null;
  const route = String(location.displayRouteDesignator || location.routeDesignator || '').trim();
  const crossStreet = String(location.displayCrossStreet || location.crossStreet || '').trim();
  const city = String(location.city || '').trim();
  const direction = String(location.direction || '').trim();
  const name = [route, crossStreet ? `at ${crossStreet}` : '', direction ? `(${direction})` : ''].filter(Boolean).join(' ');
  return cameraDefaults({
    id: `aldot-${id}`,
    name: name || `ALDOT camera ${id}`,
    state: city ? `${city}, Alabama` : 'Alabama',
    provider: PROVIDER_LABELS.al,
    lat,
    lon,
    url: '',
    snapshotUrl: '',
    sourceKind: 'state-511-al-metadata',
    framePolicy: 'metadata-only',
    license: 'ALDOT ALGO camera placement metadata; visual media is not retransmitted under ALGO camera-use restrictions',
  });
}

async function loadAlabama() {
  const payload = await fetchJson('https://api.algotraffic.com/v4.0/Cameras', {
    headers: { Accept: 'application/json', Origin: 'https://algotraffic.com', Referer: 'https://algotraffic.com/' },
  });
  if (!Array.isArray(payload)) throw new Error('no camera array');
  return payload.map(normalizeAlabamaCamera).filter(Boolean);
}

export function normalizeOhioCamera(record, view, index = 0) {
  const siteId = String(record?.Id || '').trim();
  const lat = finite(record?.Latitude);
  const lon = finite(record?.Longitude);
  const mediaUrl = String(view?.LargeURL || view?.SmallURL || '').trim();
  if (!siteId || !/^https:\/\//i.test(mediaUrl) || !inBounds(lat, lon, [38.3, 42.1, -84.9, -80.4])) return null;
  const direction = String(view?.Direction || '').trim();
  return cameraDefaults({
    id: `ohdot-${siteId}-${index}`,
    name: [String(record?.Description || record?.Location || `ODOT camera ${siteId}`).trim(), direction].filter(Boolean).join(' · '),
    state: 'Ohio',
    provider: PROVIDER_LABELS.oh,
    lat,
    lon,
    url: mediaUrl,
    sourceKind: 'state-511-oh',
    license: 'OHGO · Ohio Department of Transportation public-domain traveler information',
  });
}

async function loadOhio() {
  const payload = await fetchJson('https://api.ohgo.com/cameras', {
    headers: { Accept: 'application/json', Referer: 'https://ohgo.com/' },
  });
  if (!Array.isArray(payload)) throw new Error('no camera array');
  return payload.flatMap((record) => (Array.isArray(record?.Cameras) ? record.Cameras : [])
    .map((view, index) => normalizeOhioCamera(record, view, index)).filter(Boolean));
}

function buildRegional511Query(start, length, state = '') {
  return encodeURIComponent(JSON.stringify({
    columns: [
      { data: null, name: '' },
      { name: 'sortOrder', s: true },
      ...(state ? [{ name: 'state', search: { value: state }, s: true }] : [{ name: 'region', s: true }]),
      { name: 'roadway', s: true },
      ...(state ? [{ name: 'location' }] : []),
      { data: state ? 5 : 4, name: '' },
    ],
    order: state ? [{ column: 2, dir: 'asc' }, { column: 1, dir: 'asc' }]
      : [{ column: 1, dir: 'asc' }, { column: 2, dir: 'asc' }, { column: 3, dir: 'asc' }],
    start,
    length,
    search: { value: '' },
  }));
}

async function createRegional511Session(base) {
  const response = await fetch(`${base}/cctv`, {
    headers: { Accept: 'text/html', 'User-Agent': 'ThunderLink-Gods-Eye/0.3.19' },
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`session HTTP ${response.status}`);
  const html = await response.text();
  const token = html.match(/name=["']__RequestVerificationToken["'][^>]*value=["']([^"']+)/i)?.[1]
    || html.match(/value=["']([^"']+)["'][^>]*name=["']__RequestVerificationToken["']/i)?.[1];
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  if (!token) throw new Error('session verification token unavailable');
  return { token, cookie: setCookies.map((value) => value.split(';')[0]).join('; ') };
}

async function fetchRegional511Page(config, session, start) {
  const query = buildRegional511Query(start, PAGE_SIZE, config.filterState || '');
  const payload = await fetchJson(`${config.base}/List/GetData/Cameras?query=${query}&lang=${config.lang}`, {
    headers: {
      __requestverificationtoken: session.token,
      Cookie: session.cookie,
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${config.base}/cctv`,
    },
  });
  return {
    rows: Array.isArray(payload?.data) ? payload.data : [],
    total: Number(config.filterState ? payload?.recordsFiltered : payload?.recordsTotal) || 0,
  };
}

async function loadRegional511(config) {
  const session = await createRegional511Session(config.base);
  const first = await fetchRegional511Page(config, session, 0);
  const cameras = new Map();
  let rawRowCount = first.rows.length;
  const ingest = (rows) => {
    for (const row of rows) {
      const camera = normalizeIbi511Camera(row, config);
      if (camera) cameras.set(camera.id, camera);
    }
  };
  ingest(first.rows);
  const starts = [];
  for (let start = PAGE_SIZE; start < first.total && start < PAGE_SIZE * MAX_IBI_PAGES; start += PAGE_SIZE) starts.push(start);
  for (let index = 0; index < starts.length; index += PAGE_CONCURRENCY) {
    const batch = await Promise.allSettled(starts.slice(index, index + PAGE_CONCURRENCY)
      .map((start) => fetchRegional511Page(config, session, start)));
    for (const result of batch) {
      if (result.status !== 'fulfilled') continue;
      rawRowCount += result.value.rows.length;
      ingest(result.value.rows);
    }
  }
  if (first.total && rawRowCount < first.total * 0.9) throw new Error(`short pagination ${rawRowCount}/${first.total}`);
  return [...cameras.values()];
}

const REGIONAL_511_PROVIDERS = {
  vt: {
    key: 'vt', base: 'https://newengland511.org', idPrefix: 'vtrans', provider: PROVIDER_LABELS.vt,
    state: 'Vermont', filterState: 'Vermont', lang: 'en', bounds: [42.7, 45.1, -73.5, -71.4],
  },
  ct: {
    key: 'ct', base: 'https://ctroads.org', idPrefix: 'ctdot', provider: PROVIDER_LABELS.ct,
    state: 'Connecticut', filterState: '', lang: 'en-US', bounds: [40.9, 42.1, -73.8, -71.7],
  },
};

const DEFAULT_PROVIDER_KEYS = Object.freeze(Object.keys(PROVIDER_LABELS));

export function enabledProviderKeys(env = process.env) {
  const additions = String(env.CCTV_STATE_511_PROVIDERS || '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const exclusions = new Set(String(env.CCTV_STATE_511_EXCLUDE_PROVIDERS || '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
  return new Set([...DEFAULT_PROVIDER_KEYS, ...additions]
    .filter((key) => Object.hasOwn(PROVIDER_LABELS, key) && !exclusions.has(key)));
}

function recordStatus(key, state, count = 0, error = '', stale = false) {
  statusByProvider.set(key, {
    key,
    provider: PROVIDER_LABELS[key],
    state,
    count,
    status: error ? 'degraded' : 'live',
    stale,
    error: error ? String(error).slice(0, 160) : '',
    checkedAt: new Date().toISOString(),
  });
}

/** Load every enabled state provider; failures remain isolated and observable. */
export async function loadState511Cameras(env = process.env) {
  if (String(env.CCTV_STATE_511_ENABLED || '1').trim() === '0') return [];
  const enabled = enabledProviderKeys(env);
  const loaders = [
    ...IBI_PROVIDERS.filter((provider) => enabled.has(provider.key)).map((provider) => ({
      key: provider.key, state: provider.state, load: () => loadIbiProvider(provider),
    })),
    ...(enabled.has('or') ? [{ key: 'or', state: 'Oregon', load: loadOregon }] : []),
    ...(enabled.has('mi') ? [{ key: 'mi', state: 'Michigan', load: loadMichigan }] : []),
    ...(enabled.has('in') ? [{ key: 'in', state: 'Indiana', load: loadIndiana }] : []),
    ...(enabled.has('va') ? [{ key: 'va', state: 'Virginia', load: loadVirginia }] : []),
    ...(enabled.has('nj') ? [{ key: 'nj', state: 'New Jersey', load: loadNewJersey }] : []),
    ...(enabled.has('ma') ? [{ key: 'ma', state: 'Massachusetts', load: loadMassachusetts }] : []),
    ...(enabled.has('tn') ? [{ key: 'tn', state: 'Tennessee', load: loadTennessee }] : []),
    ...(enabled.has('sc') ? [{ key: 'sc', state: 'South Carolina', load: loadSouthCarolina }] : []),
    ...(enabled.has('al') ? [{ key: 'al', state: 'Alabama', load: loadAlabama }] : []),
    ...(enabled.has('oh') ? [{ key: 'oh', state: 'Ohio', load: loadOhio }] : []),
    ...(enabled.has('vt') ? [{ key: 'vt', state: 'Vermont', load: () => loadRegional511(REGIONAL_511_PROVIDERS.vt) }] : []),
    ...(enabled.has('ct') ? [{ key: 'ct', state: 'Connecticut', load: () => loadRegional511(REGIONAL_511_PROVIDERS.ct) }] : []),
  ];

  const settled = await Promise.allSettled(loaders.map((entry) => entry.load()));
  const cameras = [];
  settled.forEach((result, index) => {
    const entry = loaders[index];
    if (result.status === 'fulfilled') {
      const unique = [...new Map(result.value.map((camera) => [camera.id, camera])).values()];
      lastGoodByProvider.set(entry.key, unique);
      cameras.push(...unique);
      recordStatus(entry.key, entry.state, unique.length);
      console.log(`[CCTV] Loaded ${entry.provider || PROVIDER_LABELS[entry.key]}: ${unique.length}`);
    } else {
      const stale = lastGoodByProvider.get(entry.key) || [];
      cameras.push(...stale);
      recordStatus(entry.key, entry.state, stale.length, result.reason?.message || result.reason || 'unavailable', stale.length > 0);
      console.warn(`[CCTV] ${PROVIDER_LABELS[entry.key]} catalog failed:`, result.reason?.message || result.reason);
    }
  });
  return cameras;
}

export function getState511ProviderStatus() {
  return [...statusByProvider.values()];
}
