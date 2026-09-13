import { createHash } from 'node:crypto';

// Public road-condition viewing only. Catalogs contain metadata, never frames.
// No replay endpoints, recording jobs, identifiers or analytics are attached.
const TX_BASE = 'https://its.txdot.gov/its/DistrictIts/';
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_FRAME_CACHE_BYTES = 32 * 1024 * 1024;
const districtsLastGood = new Map();

export const LIVE_TRAFFIC_PROVIDERS = Object.freeze([
  { key: 'tx', state: 'Texas', country: 'US', provider: 'TxDOT ITS', bounds: [25.7, 36.6, -106.7, -93.4] },
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
    city: config.state, cityId: config.key === 'tx' ? 'us-tx' : config.key,
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
    if (contentType === 'image/jpeg' && (body[0] !== 0xff || body[1] !== 0xd8)) return null;
    if (contentType === 'image/png' && body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
    if (contentType === 'image/webp' && (body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WEBP')) return null;
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
