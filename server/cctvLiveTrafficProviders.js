import { createHash } from 'node:crypto';

// Public road-condition viewing only. Catalogs contain metadata, never frames.
// No replay endpoints, recording jobs, identifiers or analytics are attached.
const TX_BASE = 'https://its.txdot.gov/its/DistrictIts/';
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 6 * 1024 * 1024;
const MAX_FRAME_CACHE_BYTES = 32 * 1024 * 1024;
const districtsLastGood = new Map();

export const LIVE_TRAFFIC_PROVIDERS = Object.freeze([
  { key: 'tx', state: 'Texas', country: 'US', provider: 'TxDOT ITS', bounds: [25.7, 36.6, -106.7, -93.4] },
  { key: 'mt', state: 'Montana', country: 'US', provider: 'Montana MDT 511', bounds: [44.35, 49.01, -116.06, -104.03] },
  { key: 'wy', state: 'Wyoming', country: 'US', provider: 'WYDOT 511', bounds: [40.99, 45.01, -111.06, -104.04] },
  { key: 'nd', state: 'North Dakota', country: 'US', provider: 'NDDOT 511', bounds: [45.93, 49.01, -104.06, -96.55] },
  { key: 'id', state: 'Idaho', country: 'US', provider: 'Idaho 511', bounds: [41.98, 49.01, -117.25, -111.04] },
  { key: 'ca-bc', state: 'British Columbia', country: 'CA', provider: 'DriveBC', bounds: [48, 60.1, -139.1, -114] },
  { key: 'ca-on', state: 'Ontario', country: 'CA', provider: 'Ontario 511', base: 'https://511on.ca', bounds: [41.6, 57, -95.3, -74.2] },
  { key: 'ca-nl', state: 'Newfoundland and Labrador', country: 'CA', provider: 'Newfoundland and Labrador Transportation and Infrastructure', bounds: [46.5, 60.5, -67.9, -52.5] },
  { key: 'ca-ab', state: 'Alberta', country: 'CA', provider: '511 Alberta', base: 'https://511.alberta.ca', envKey: 'CCTV_ALBERTA_511_API_KEY', bounds: [48.9, 60.1, -120.1, -109.9] },
  { key: 'ca-mb', state: 'Manitoba', country: 'CA', provider: 'Manitoba 511', base: 'https://www.manitoba511.ca', envKey: 'CCTV_MANITOBA_511_API_KEY', bounds: [48.9, 60.1, -102.1, -88.8] },
  { key: 'ca-nb', state: 'New Brunswick', country: 'CA', provider: 'New Brunswick 511', base: 'https://511.gnb.ca', envKey: 'CCTV_NEW_BRUNSWICK_511_API_KEY', bounds: [44.5, 48.2, -69.1, -63.7] },
  { key: 'ca-yt', state: 'Yukon', country: 'CA', provider: '511 Yukon', base: 'https://511yukon.ca', envKey: 'CCTV_YUKON_511_API_KEY', bounds: [59.9, 69.7, -141.1, -123.7] },
  { key: 'au-nsw', state: 'New South Wales', country: 'AU', provider: 'Transport for NSW', bounds: [-37.6, -28.1, 140.9, 153.7] },
  { key: 'au-qld', state: 'Queensland', country: 'AU', provider: 'Queensland Transport and Main Roads', bounds: [-29.2, -9, 137.9, 153.7] },
]);

const definition = (key) => LIVE_TRAFFIC_PROVIDERS.find((item) => item.key === key);
const clean = (value) => String(value ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 220);

export function liveTrafficUrl(value, base, hosts) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && hosts.includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}

async function readBody(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Provider response exceeds size limit');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error('Provider response exceeds size limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function request(url, { fetchImpl = fetch, maxBytes = MAX_CATALOG_BYTES, timeoutMs = 20_000, signal } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error',
    headers: { 'User-Agent': 'ThunderLink-Live-Traffic/1.0', Accept: '*/*' },
  });
  // Never put the URL (which may include a provider key) in error/log output.
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Provider HTTP ${response.status}`); }
  return { body: await readBody(response, maxBytes), contentType: response.headers.get('content-type') || '' };
}

async function json(url, options) {
  const body = (await request(url, options)).body;
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Provider returned invalid JSON'); }
}

function camera(config, { id, name, lat, lon, url, refreshMs = 60_000, license = '', frameEncoding = '' }) {
  if (lat === null || lon === null || lat === '' || lon === '') return null;
  lat = Number(lat); lon = Number(lon);
  const [south, north, west, east] = config.bounds;
  if (!id || !url || !Number.isFinite(lat) || !Number.isFinite(lon)
    || lat < south || lat > north || lon < west || lon > east) return null;
  return {
    id: `live-traffic-${config.key}-${id}`, name: clean(name) || `${config.provider} camera`,
    city: config.state, cityId: config.country === 'US' ? `us-${config.key}` : config.key,
    provider: config.provider, lat, lon, headingDeg: 0, headingConfidence: 'low',
    pitchDeg: -18, fovDeg: 44, rangeM: 145, mountHeightM: 8, groundElevationM: 0,
    feedType: 'image', url, snapshotUrl: url, frameEncoding,
    sourceKind: `live-traffic-${config.key}`, framePolicy: 'live-only',
    stateCode: config.key.toUpperCase(), countryCode: config.country,
    minFrameRefreshMs: Math.max(30_000, Math.min(1_800_000, Number(refreshMs) || 60_000)),
    license: license || `${config.provider} public road-condition camera; current image only`,
  };
}

export function normalizeTexasCamera(row, districtCode) {
  if (!/^[A-Z]{3}$/.test(districtCode) || row?.hasSnapshot !== true || !row.icd_Id) return null;
  const id = `${districtCode}-${createHash('sha256').update(String(row.icd_Id)).digest('hex').slice(0, 24)}`;
  const query = new URLSearchParams({ icdId: row.icd_Id, districtCode });
  return camera(definition('tx'), {
    id, name: `${row.name || row.icd_Id} · ${districtCode}`, lat: row.latitude, lon: row.longitude,
    url: `${TX_BASE}GetCctvSnapshotByIcdId?${query}`, frameEncoding: 'txdot-json',
  });
}

export function normalizeMontanaCamera(feature) {
  const p = feature?.properties || {};
  const [lon, lat] = feature?.geometry?.coordinates || [];
  // MDT includes neighboring states in its map. Do not label those as Montana.
  if (/^(WY|ID|ND|SD|WA|BC|AB)\s/i.test(p.route || '') || (lat < 45 && lon > -111.05)) return [];
  return (Array.isArray(p.cameras) ? p.cameras : []).flatMap((view) => {
    const url = liveTrafficUrl(view.image, undefined, ['mt.cdn.iteris-atis.com']);
    if (!url || !/^\/(camera_images|rwis_images)\/[\w.-]+\.jpg$/i.test(new URL(url).pathname)) return [];
    const value = camera(definition('mt'), { id: view.id, lat, lon, url,
      name: [p.description, view.name || view.description].filter(Boolean).join(' · '), refreshMs: 300_000 });
    return value ? [value] : [];
  });
}

export function normalizeNorthDakotaCamera(feature) {
  const p = feature?.properties || {};
  const [lon, lat] = feature?.geometry?.coordinates || [];
  return (Array.isArray(p.Cameras) ? p.Cameras : []).flatMap((view) => {
    const url = liveTrafficUrl(view.FullPath, undefined, ['www.dot.nd.gov']);
    if (!url || !/^\/travel-info\/cameras\/[\w.@&%-]+\.jpg$/i.test(new URL(url).pathname)) return [];
    const id = createHash('sha256').update(new URL(url).pathname).digest('hex').slice(0, 24);
    const value = camera(definition('nd'), { id, name: view.Description, lat, lon, url, refreshMs: 300_000,
      license: 'NDDOT data provided as-is, without liability to NDDOT; current road-condition image only' });
    return value ? [value] : [];
  });
}

export function normalizeIdahoCamera(row) {
  if (row?.visible === false || (row?.state && row.state !== 'Idaho')) return [];
  const point = String(row?.latLng?.geography?.wellKnownText || '')
    .match(/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i);
  if (!point || row.id === undefined || row.id === null) return [];
  return (Array.isArray(row.images) ? row.images : []).flatMap((view) => {
    if (view.disabled || view.blocked || view.id === undefined || view.id === null) return [];
    const url = liveTrafficUrl(view.imageUrl, 'https://511.idaho.gov', ['511.idaho.gov']);
    if (!url || !/^\/map\/Cctv\/\d+$/i.test(new URL(url).pathname)) return [];
    const value = camera(definition('id'), { id: `${row.id}-${view.id}`, name: view.description || row.location,
      lat: point[2], lon: point[1], url, refreshMs: 60_000 });
    return value ? [value] : [];
  });
}

export async function loadIdahoCameras(options = {}) {
  options = { ...options, signal: options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) };
  const cameras = new Map(); const seenRows = new Set();
  for (let start = 0; start < 10_000; start += 100) {
    // Public camera-page pagination, not the separate key-gated developer API.
    const query = encodeURIComponent(JSON.stringify({
      columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }, { name: 'roadway', s: true }, { data: 3, name: '' }],
      order: [{ column: 1, dir: 'asc' }], start, length: 100, search: { value: '' },
    }));
    const payload = await json(`https://511.idaho.gov/List/GetData/Cameras?query=${query}&lang=en`, options);
    if (!Array.isArray(payload?.data) || !Number.isInteger(payload.recordsTotal) || payload.recordsTotal < 0) {
      throw new Error('Unexpected Idaho public camera catalog');
    }
    const before = seenRows.size;
    for (const row of payload.data) {
      if (row.id !== undefined && row.id !== null) seenRows.add(row.id);
      for (const item of normalizeIdahoCamera(row)) cameras.set(item.id, item);
    }
    if (seenRows.size >= payload.recordsTotal) return [...cameras.values()];
    if (seenRows.size === before || payload.data.length < 100) {
      return { cameras: [...cameras.values()], warning: `Idaho partial catalog: ${seenRows.size}/${payload.recordsTotal} locations` };
    }
  }
  return { cameras: [...cameras.values()], warning: 'Idaho catalog reached pagination safety limit' };
}

// Minimal, bounded reader for WYDOT's public webcameras_v1_pkg protobuf schema.
// No generated provider code is executed, and unknown fields are skipped.
function protobufFields(buffer) {
  let offset = 0; const fields = [];
  const ensure = (length) => {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > buffer.length) throw new Error('Invalid Wyoming camera feed');
  };
  const varint = () => {
    let result = 0;
    for (let shift = 0; shift < 49; shift += 7) {
      ensure(1); const byte = buffer[offset++]; result += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return result;
    }
    throw new Error('Invalid Wyoming camera varint');
  };
  while (offset < buffer.length) {
    const tag = varint(); const number = Math.floor(tag / 8); const type = tag % 8;
    if (!number || fields.length >= 50_000) throw new Error('Invalid Wyoming camera fields');
    let value;
    if (type === 0) value = varint();
    else if (type === 1) { ensure(8); value = buffer.readDoubleLE(offset); offset += 8; }
    else if (type === 2) { const length = varint(); ensure(length); value = buffer.subarray(offset, offset + length); offset += length; }
    else if (type === 5) { ensure(4); offset += 4; continue; }
    else throw new Error('Unsupported Wyoming camera wire type');
    fields.push({ number, value });
  }
  return fields;
}

function wyomingPublicText(value) {
  if (!Buffer.isBuffer(value) || value.length > 8192) return '';
  const text = value.toString('utf8');
  if (!/^[A-Za-z0-9+/\r\n]+=*$/.test(text)) return '';
  // Public string-format mask shipped in WYDOT's unauthenticated 511 map JS.
  // This is not an API credential or authorization token.
  const mask = Buffer.from('EkhJp6wsgahsqkiw5nahFOSCwAND1zhZ');
  return Buffer.from(Buffer.from(text, 'base64').map((byte, i) => byte ^ mask[i % mask.length])).toString('utf8');
}

export function parseWyomingCameras(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_CATALOG_BYTES) throw new Error('Invalid Wyoming camera feed size');
  const cameras = new Map();
  for (const site of protobufFields(buffer).filter((field) => field.number === 1)) {
    if (!Buffer.isBuffer(site.value)) throw new Error('Invalid Wyoming camera site');
    const fields = protobufFields(site.value);
    const get = (number) => fields.find((field) => field.number === number)?.value;
    const siteId = get(1);
    if (!Number.isSafeInteger(siteId)) continue;
    for (const view of fields.filter((field) => field.number === 3)) {
      if (!Buffer.isBuffer(view.value)) throw new Error('Invalid Wyoming camera view');
      const image = protobufFields(view.value);
      const item = (number) => image.find((field) => field.number === number)?.value;
      if (!Number.isSafeInteger(item(1))) continue;
      const url = liveTrafficUrl(wyomingPublicText(item(3)), undefined, ['www.wyoroad.info']);
      if (!url || new URL(url).pathname !== '/web-cam/cache' || !new URL(url).searchParams.has('ref')) continue;
      const result = camera(definition('wy'), { id: `${siteId}-${item(1)}`, lat: get(9), lon: get(8), url,
        name: wyomingPublicText(item(2)) || wyomingPublicText(get(2)), refreshMs: 300_000 });
      if (result) cameras.set(result.id, result);
    }
  }
  if (!cameras.size) throw new Error('Wyoming camera catalog is empty or its format changed');
  return [...cameras.values()];
}

export function normalizeDriveBcCamera(row) {
  if (row?.is_on !== true || row.should_appear !== true) return null;
  const [lon, lat] = row.location?.coordinates || [];
  const url = liveTrafficUrl(row.links?.imageDisplay, 'https://www.drivebc.ca', ['www.drivebc.ca']);
  if (!url || !new URL(url).pathname.startsWith('/images/')) return null;
  // The catalog's timestamp is not a camera identifier or a historical frame.
  const image = new URL(url); image.search = '';
  return camera(definition('ca-bc'), {
    id: row.id, name: row.caption || row.name, lat, lon, url: image.href,
    refreshMs: Number(row.update_period_mean) * 1000,
    license: 'DriveBC · Province of British Columbia · Open Government Licence – British Columbia',
  });
}

export function normalizeCanadian511Camera(row, config) {
  if (!row || row.Id === null || row.Id === undefined) return [];
  return (Array.isArray(row.Views) ? row.Views : []).flatMap((view) => {
    if (view.Status !== 'Enabled' || view.Id === null || view.Id === undefined) return [];
    const url = liveTrafficUrl(view.Url, config.base, [new URL(config.base).hostname]);
    if (!url || !/^\/map\/Cctv\/\d+$/i.test(new URL(url).pathname)) return [];
    const value = camera(config, {
      id: `${row.Id}-${view.Id}`, name: [row.Location || row.Roadway, view.Description].filter(Boolean).join(' · '),
      lat: row.Latitude, lon: row.Longitude, url,
    });
    return value ? [value] : [];
  });
}

export function normalizeAustralianCamera(feature, key) {
  const config = definition(key);
  if (!config || !['au-nsw', 'au-qld'].includes(key)) return null;
  const p = feature?.properties || feature?.attributes || {};
  const [lon, lat] = feature?.geometry?.coordinates || [feature?.geometry?.x, feature?.geometry?.y];
  const url = liveTrafficUrl(p.image_url || p.href, undefined,
    key === 'au-nsw' ? ['webcams.transport.nsw.gov.au'] : ['cameras.qldtraffic.qld.gov.au']);
  return camera(config, { id: p.id ?? feature.id, name: p.description || p.view || p.title, lat, lon, url,
    license: `${config.provider} · Creative Commons Attribution${key === 'au-qld' ? ' 4.0' : ''}` });
}

export function parseNewfoundlandCameras(text) {
  // Parse only the published map-pin literals; never execute provider JavaScript.
  return [...String(text).matchAll(/\{\s*type:\s*'cam',\s*title:\s*"([^"]+)",\s*loc:\s*'([^']+)',\s*desc:\s*'([^\n]+?)'\s*\}/g)]
    .flatMap((match) => {
      const [lat, lon] = match[2].split(',').map((value) => value.trim());
      const path = match[3].match(/src="(https:\/\/www\.gov\.nl\.ca\/ti\/highway-cams\/cameras\/sites\/([\w-]+)\/current\.jpg)"/i);
      if (!path) return [];
      const value = camera(definition('ca-nl'), { id: path[2], name: match[1], lat, lon, url: path[1], refreshMs: 1_200_000 });
      return value ? [value] : [];
    });
}

export async function loadTexasCameras(options = {}) {
  options = { ...options, signal: options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) };
  const districts = await json(`${TX_BASE}GetDistrictsByStateCode?stateCode=TX`, options);
  if (!Array.isArray(districts) || !districts.length) throw new Error('Unexpected TxDOT district catalog');
  const codes = [...new Set(districts.map((row) => row.icd_Id).filter((code) => /^[A-Z]{3}$/.test(code)))];
  if (!codes.length || codes.length > 40) throw new Error('Unexpected TxDOT district count');
  const cameras = []; const failures = [];
  for (let offset = 0; offset < codes.length; offset += 4) {
    const batch = codes.slice(offset, offset + 4);
    const settled = await Promise.allSettled(batch.map(async (code) => {
      const payload = await json(`${TX_BASE}GetCctvStatusListByDistrict?districtCode=${code}`, options);
      if (!payload.roadwayCctvStatuses || typeof payload.roadwayCctvStatuses !== 'object') throw new Error('Unexpected TxDOT camera catalog');
      const rows = Object.values(payload.roadwayCctvStatuses).flat();
      const normalized = [...new Map(rows.map((row) => normalizeTexasCamera(row, code)).filter(Boolean).map((c) => [c.id, c])).values()];
      districtsLastGood.set(code, normalized);
      return normalized;
    }));
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') cameras.push(...result.value);
      else { failures.push(batch[i]); cameras.push(...(districtsLastGood.get(batch[i]) || [])); }
    });
  }
  return { cameras, warning: failures.length ? `Districts unavailable/stale: ${failures.join(', ')}` : '' };
}

export async function loadLiveTrafficProvider(config, env = process.env, options = {}) {
  if (config.key === 'tx') return loadTexasCameras(options);
  if (config.key === 'id') return loadIdahoCameras(options);
  if (config.key === 'wy') {
    const response = await request('https://map.wyoroad.info/wti511map-data/Msg-FFBK373B.pbf', options);
    return parseWyomingCameras(response.body);
  }
  if (config.key === 'nd') {
    const payload = await json('https://travelfiles.dot.nd.gov/geojson_nc/cameras.json', options);
    if (!Array.isArray(payload.features)) throw new Error('Unexpected North Dakota camera catalog');
    const cameras = [...new Map(payload.features.flatMap(normalizeNorthDakotaCamera).map((item) => [item.id, item])).values()];
    if (!cameras.length) throw new Error('North Dakota camera catalog is empty or its format changed');
    return cameras;
  }
  if (config.key === 'mt') {
    const catalogs = ['cameras', 'rwis'];
    const results = await Promise.allSettled(catalogs.map(async (type) => {
      const payload = await json(`https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.${type}.geojson`, options);
      if (!Array.isArray(payload.features)) throw new Error('Unexpected Montana camera catalog');
      return payload.features.flatMap(normalizeMontanaCamera);
    }));
    const cameras = [...new Map(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).map((item) => [item.id, item])).values()];
    if (!cameras.length) throw new Error('Montana camera catalogs unavailable or empty');
    const missing = catalogs.filter((_, i) => results[i].status === 'rejected');
    return { cameras, warning: missing.length ? `Montana partial catalog: ${missing.join(', ')} unavailable` : '' };
  }
  if (config.base) {
    if (config.envKey && !String(env[config.envKey] || '').trim()) throw new Error(`Developer access required: ${config.envKey}`);
    const url = new URL('/api/v2/get/cameras', config.base);
    url.searchParams.set('format', 'json');
    if (config.envKey) url.searchParams.set('key', env[config.envKey].trim());
    const rows = await json(url.href, options);
    if (!Array.isArray(rows)) throw new Error('Unexpected 511 camera catalog');
    return rows.flatMap((row) => normalizeCanadian511Camera(row, config));
  }
  if (config.key === 'ca-bc') {
    const rows = await json('https://www.drivebc.ca/api/webcams/', options);
    if (!Array.isArray(rows)) throw new Error('Unexpected DriveBC camera catalog');
    return rows.map(normalizeDriveBcCamera).filter(Boolean);
  }
  if (config.key === 'ca-nl') {
    const result = await request('https://www.gov.nl.ca/ti/wp-content/themes/gnl-web-department/inc/cameralocations.js', options);
    const cameras = parseNewfoundlandCameras(result.body.toString('utf8'));
    if (!cameras.length) throw new Error('Newfoundland camera catalog format changed');
    return cameras;
  }
  if (config.key === 'au-nsw') {
    // Same public feed used by the official Live Traffic NSW camera page.
    // Ignore its non-camera events; keep the open-data mirror as a fallback.
    try {
      const rows = await json('https://www.livetraffic.com/datajson/all-feeds-web.json', options);
      if (!Array.isArray(rows)) throw new Error('Unexpected NSW public feed');
      const cameras = rows.filter((row) => row.eventCategory === 'liveCams')
        .map((row) => normalizeAustralianCamera(row, config.key)).filter(Boolean);
      if (cameras.length) return cameras;
    } catch { /* The official open-data mirror is independently available. */ }
    const url = 'https://portal.data.nsw.gov.au/arcgis/rest/services/Hosted/TfNSW_Traffic_Cameras_Public/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json';
    const initial = await json(url, options);
    if (!Array.isArray(initial.features)) throw new Error('Unexpected NSW camera catalog');
    if (!initial.exceededTransferLimit) return initial.features.map((row) => normalizeAustralianCamera(row, config.key)).filter(Boolean);
    const cameras = [];
    for (let offset = 0; offset < 10_000; offset += 500) {
      const payload = await json(`${url}&orderByFields=objectid&resultRecordCount=500&resultOffset=${offset}`, options);
      if (!Array.isArray(payload.features)) throw new Error('Unexpected NSW camera catalog');
      cameras.push(...payload.features.map((row) => normalizeAustralianCamera(row, config.key)).filter(Boolean));
      if (!payload.exceededTransferLimit) return cameras;
      if (!payload.features.length) throw new Error('NSW pagination made no progress');
    }
    return { cameras, warning: 'NSW catalog reached pagination safety limit' };
  }
  if (config.key === 'au-qld') {
    // Intentionally public developer key, published by TMR in API specification
    // v1.10 §2.1.1.1. This is not a user credential; optional private override stays server-side.
    const publicDeveloperKey = '3e83add325cbb69ac4d8e5bf433d770b';
    const url = new URL('https://api.qldtraffic.qld.gov.au/v1/webcams');
    url.searchParams.set('apikey', env.CCTV_QUEENSLAND_API_KEY || publicDeveloperKey);
    const payload = await json(url.href, options);
    if (!Array.isArray(payload.features)) throw new Error('Unexpected Queensland camera catalog');
    return payload.features.map((row) => normalizeAustralianCamera(row, config.key)).filter(Boolean);
  }
  throw new Error('Unsupported public camera provider');
}

export async function fetchLiveTrafficFrame(source, options = {}) {
  if (source?.framePolicy !== 'live-only') return null;
  const hosts = ['its.txdot.gov', 'www.drivebc.ca', '511on.ca', '511.alberta.ca', 'www.manitoba511.ca',
    'mt.cdn.iteris-atis.com', 'www.wyoroad.info', 'www.dot.nd.gov', '511.idaho.gov',
    '511.gnb.ca', '511yukon.ca', 'www.gov.nl.ca', 'webcams.transport.nsw.gov.au', 'cameras.qldtraffic.qld.gov.au'];
  const url = liveTrafficUrl(source.snapshotUrl, undefined, hosts);
  if (!url) return null;
  try {
    const response = await request(url, { ...options, maxBytes: MAX_FRAME_BYTES * 1.4, timeoutMs: options.timeoutMs || 8_000 });
    let body = response.body; let contentType = response.contentType.split(';')[0];
    if (source.frameEncoding === 'txdot-json') {
      if (new URL(url).hostname !== 'its.txdot.gov') return null;
      const payload = JSON.parse(body.toString('utf8'));
      if (typeof payload.snippet !== 'string' || !/^[A-Za-z0-9+/\r\n]+=*$/.test(payload.snippet)) return null;
      body = Buffer.from(payload.snippet, 'base64'); contentType = 'image/jpeg';
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || !body.length || body.length > MAX_FRAME_BYTES) return null;
    // MDT sometimes serves PNG bytes as image/jpeg. Use the validated binary
    // signature, not that incorrect header; HTML/SVG/error pages stay rejected.
    if (body[0] === 0xff && body[1] === 0xd8) contentType = 'image/jpeg';
    else if (body.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') contentType = 'image/png';
    else if (body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') contentType = 'image/webp';
    else return null;
    return { ok: true, body, contentType };
  } catch { return null; }
}

/** Coalesce viewers and respect provider refresh rates. Latest frames only,
 * bounded RAM, no filesystem/database, no stale-frame fallback or replay. */
export function createLiveTrafficFrameCache({ fetchFrame = fetchLiveTrafficFrame, now = Date.now } = {}) {
  const entries = new Map(); const pending = new Map();
  const evict = () => {
    for (const [key, entry] of entries) if (entry.expires <= now()) entries.delete(key);
    let bytes = [...entries.values()].reduce((sum, item) => sum + (item.frame?.body.length || 0), 0);
    while (entries.size > 64 || bytes > MAX_FRAME_CACHE_BYTES) {
      const key = entries.keys().next().value;
      bytes -= entries.get(key)?.frame?.body.length || 0; entries.delete(key);
    }
  };
  const timer = setInterval(evict, 30_000); timer.unref?.();
  const getFrame = async (source) => {
    evict();
    if (entries.has(source.id)) return entries.get(source.id).frame;
    if (pending.has(source.id)) return pending.get(source.id);
    if (pending.size >= 12) return null;
    const operation = Promise.resolve().then(() => fetchFrame(source)).catch(() => null).then((frame) => {
      const ttl = frame ? Math.max(30_000, Math.min(1_800_000, source.minFrameRefreshMs || 60_000)) : 20_000;
      entries.set(source.id, { frame, expires: now() + ttl }); evict(); return frame;
    }).finally(() => pending.delete(source.id));
    pending.set(source.id, operation); return operation;
  };
  getFrame.close = () => { clearInterval(timer); entries.clear(); };
  return getFrame;
}
