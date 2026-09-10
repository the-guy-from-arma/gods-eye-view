/**
 * Keyless public U.S. state 511/DOT camera catalogs.
 *
 * Catalog requests are server-side, bounded, cached by the parent CCTV proxy,
 * and return only provider-published positions and media URLs. A provider
 * failure is isolated so one state cannot blank the rest of the catalog.
 */

const PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 10;
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
];

const PROVIDER_LABELS = {
  az: 'Arizona 511 · ADOT',
  fl: 'Florida 511 · FDOT',
  ga: 'Georgia 511 · GDOT',
  nc: 'DriveNC · NCDOT',
  ut: 'UDOT Traffic · Utah 511',
  nv: 'Nevada 511 · NDOT',
  la: 'Louisiana 511 · LADOTD',
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

function cameraDefaults({ id, name, state, provider, lat, lon, url, snapshotUrl, feedType = 'image', sourceKind }) {
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
    license: `${provider} public traveler-information camera`,
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
      if (result.status === 'fulfilled') ingest(result.value.rows);
      else failed.push(batch[offset]);
    });
  }
  if (failed.length) {
    const retried = await Promise.allSettled(failed.map((start) => fetchIbiPage(config, start)));
    for (const result of retried) if (result.status === 'fulfilled') ingest(result.value.rows);
  }
  const result = [...cameras.values()];
  if (first.total && result.length < first.total * 0.9) {
    throw new Error(`short catalog ${result.length}/${first.total}`);
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

function enabledProviderKeys(env) {
  const configured = String(env.CCTV_STATE_511_PROVIDERS || 'az,fl,ga,nc,ut,nv,la,or,mi,in')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return new Set(configured.filter((key) => Object.hasOwn(PROVIDER_LABELS, key)));
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
