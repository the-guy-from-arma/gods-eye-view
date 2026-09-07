const RADAR_TTL_MS = 5 * 60_000;
const ALERT_TTL_MS = 2 * 60_000;
const STALE_MS = 60 * 60_000;
const MAX_ALERT_BYTES = 16 * 1024 * 1024;
const MAX_RADAR_BYTES = 12 * 1024 * 1024;

const NOAA_RADAR_EXPORT = new URL(
  'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer/export',
);
NOAA_RADAR_EXPORT.search = new URLSearchParams({
  bbox: '-180,-85,180,85',
  bboxSR: '4326',
  imageSR: '4326',
  size: '2048,1024',
  format: 'png32',
  transparent: 'true',
  layers: 'show:3',
  f: 'image',
}).toString();

const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual';

function sendJson(res, status, payload, cacheState = 'NONE') {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    'X-Weather-Cache': cacheState,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function readCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('upstream response too large');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error('upstream response too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function clean(value, max = 600) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeAlert(feature) {
  if (!feature?.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) return null;
  const props = feature.properties || {};
  return {
    type: 'Feature',
    id: clean(feature.id || props.id, 300),
    geometry: feature.geometry,
    properties: {
      event: clean(props.event, 120) || 'Weather alert',
      severity: clean(props.severity, 30) || 'Unknown',
      certainty: clean(props.certainty, 30) || 'Unknown',
      urgency: clean(props.urgency, 30) || 'Unknown',
      areaDesc: clean(props.areaDesc, 500),
      headline: clean(props.headline, 500),
      senderName: clean(props.senderName, 160),
      onset: clean(props.onset, 50),
      expires: clean(props.expires, 50),
      instruction: clean(props.instruction, 1000),
    },
  };
}

export function createWeatherLayersApi(options = {}) {
  const env = options.env || process.env;
  let radarCache = null;
  let radarInFlight = null;
  let alertsCache = null;
  let alertsInFlight = null;

  async function refreshRadar() {
    const response = await fetch(NOAA_RADAR_EXPORT, {
      signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'image/png', 'User-Agent': 'ThunderLinkGodsEye/0.3.13 (+https://github.com/the-guy-from-arma/gods-eye-view)' },
    });
    if (!response.ok) throw new Error(`NOAA radar HTTP ${response.status}`);
    const body = await readCapped(response, MAX_RADAR_BYTES);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('image/')) throw new Error('NOAA radar returned a non-image response');
    radarCache = { at: Date.now(), body, contentType };
    return radarCache;
  }

  async function refreshAlerts() {
    const response = await fetch(NWS_ALERTS_URL, {
      signal: AbortSignal.timeout(25_000),
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': env.NWS_USER_AGENT || 'ThunderLinkGodsEye/0.3.13 (https://github.com/the-guy-from-arma/gods-eye-view)',
      },
    });
    if (!response.ok) throw new Error(`NWS alerts HTTP ${response.status}`);
    const body = await readCapped(response, MAX_ALERT_BYTES);
    const upstream = JSON.parse(body.toString('utf8'));
    const features = (upstream.features || []).map(normalizeAlert).filter(Boolean).slice(0, 750);
    const payload = {
      status: 'ready',
      retrievedAt: new Date().toISOString(),
      totalAlerts: Array.isArray(upstream.features) ? upstream.features.length : 0,
      mappedAlerts: features.length,
      source: 'NOAA National Weather Service',
      featureCollection: { type: 'FeatureCollection', features },
    };
    alertsCache = { at: Date.now(), payload };
    return alertsCache;
  }

  return async function weatherLayersMiddleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://local');
    if (!url.pathname.startsWith('/api/weather/')) return next();
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    if (url.pathname === '/api/weather/radar.png') {
      const fresh = radarCache && Date.now() - radarCache.at <= RADAR_TTL_MS;
      const stale = radarCache && Date.now() - radarCache.at <= STALE_MS ? radarCache : null;
      try {
        if (!fresh) {
          if (!radarInFlight) radarInFlight = refreshRadar().finally(() => { radarInFlight = null; });
          radarCache = await radarInFlight;
        }
        res.writeHead(200, {
          'Content-Type': radarCache.contentType,
          'Cache-Control': 'public, max-age=120',
          'X-Weather-Cache': fresh ? 'HIT' : 'REFRESH',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(radarCache.body);
      } catch (error) {
        if (stale) {
          res.writeHead(200, { 'Content-Type': stale.contentType, 'Cache-Control': 'no-cache', 'X-Weather-Cache': 'STALE' });
          res.end(stale.body);
          return;
        }
        sendJson(res, 502, { error: 'NOAA radar unavailable' });
      }
      return;
    }

    if (url.pathname === '/api/weather/alerts') {
      const fresh = alertsCache && Date.now() - alertsCache.at <= ALERT_TTL_MS;
      const stale = alertsCache && Date.now() - alertsCache.at <= STALE_MS ? alertsCache : null;
      try {
        if (!fresh) {
          if (!alertsInFlight) alertsInFlight = refreshAlerts().finally(() => { alertsInFlight = null; });
          alertsCache = await alertsInFlight;
        }
        sendJson(res, 200, alertsCache.payload, fresh ? 'HIT' : 'REFRESH');
      } catch (error) {
        if (stale) return sendJson(res, 200, { ...stale.payload, status: 'stale' }, 'STALE');
        sendJson(res, 502, { error: 'NWS weather alerts unavailable' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Weather endpoint not found' });
  };
}

export function weatherLayersApiPlugin(options = {}) {
  const install = (server) => {
    server.middlewares.use(createWeatherLayersApi(options));
  };
  return { name: 'thunderlink-weather-layers-api', configureServer: install, configurePreviewServer: install };
}

export const weatherLayersInternals = { normalizeAlert, NOAA_RADAR_EXPORT: NOAA_RADAR_EXPORT.href };
