const MAX_TEXT = 240;
const MAX_CATALOG_ROWS = 12_000;

function firstValue(object, keys) {
  if (!object || typeof object !== 'object') return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return undefined;
}

function cleanText(value, max = MAX_TEXT) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function serviceType(raw) {
  const text = [
    firstValue(raw, ['name', 'description', 'descr', 'feedName', 'feed_name', 'title']),
    firstValue(raw, ['service', 'serviceType', 'service_type', 'category', 'genreName', 'genre_name']),
    firstValue(raw, ['agency', 'agencyName', 'agency_name', 'department']),
  ].map((value) => cleanText(value).toLowerCase()).join(' ');
  const emergency = /\b(fire|ems|ambulance|rescue)\b/.test(text);
  const law = /\b(police|sheriff|law enforcement|public safety|state patrol|highway patrol|constable|corrections?|troopers?|marshal)\b/.test(text);
  if (law && emergency) return 'combined';
  if (/\bsheriff\b/.test(text)) return 'sheriff';
  if (law) return 'police';
  return 'dispatch';
}

function catalogRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['feeds', 'results', 'data', 'feed']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  const values = Object.values(payload);
  return values.length && values.every((value) => value && typeof value === 'object') ? values : [];
}

export function isLawEnforcementBroadcast(raw = {}) {
  const location = raw.location && typeof raw.location === 'object' ? raw.location : {};
  const haystack = [
    firstValue(raw, ['name', 'description', 'descr', 'feedName', 'feed_name', 'title']),
    firstValue(raw, ['service', 'serviceType', 'service_type', 'category', 'genreName', 'genre_name']),
    firstValue(raw, ['agency', 'agencyName', 'agency_name', 'department']),
    firstValue(location, ['agency', 'department']),
  ].map((value) => cleanText(value).toLowerCase()).join(' ');
  if (/\b(police|sheriff|law enforcement|public safety|state patrol|highway patrol|constable|corrections?|troopers?|marshal)\b/.test(haystack)) {
    return true;
  }
  return /\bdispatch\b/.test(haystack) && !/\b(fire|ems|ambulance|rescue)\b/.test(haystack);
}

export function normalizeBroadcastifyFeed(raw, index = 0, context = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const location = raw.location && typeof raw.location === 'object' ? raw.location : {};
  const feedId = cleanText(firstValue(raw, ['feedId', 'feedid', 'feed_id', 'id']), 64);
  const name = cleanText(firstValue(raw, ['name', 'description', 'descr', 'feedName', 'feed_name', 'title']));
  const eventGenre = Number(context.genreId);
  const isEventFeed = eventGenre === 7 || eventGenre === 8;
  if (!feedId || !name || (!isLawEnforcementBroadcast(raw) && !isEventFeed)) return null;

  const lat = finiteCoordinate(firstValue(raw, ['lat', 'latitude', 'feedLat', 'feed_lat'])
    ?? firstValue(location, ['lat', 'latitude']), -90, 90);
  const lon = finiteCoordinate(firstValue(raw, ['lon', 'lng', 'longitude', 'feedLon', 'feed_lng', 'feed_lon'])
    ?? firstValue(location, ['lon', 'lng', 'longitude']), -180, 180);
  const listenerValue = Number(firstValue(raw, ['listeners', 'listenerCount', 'listener_count']));
  const statusText = cleanText(firstValue(raw, ['status', 'feedStatus', 'feed_status']), 32).toLowerCase();
  const explicitOnline = firstValue(raw, ['online', 'isOnline', 'is_online']);
  const online = typeof explicitOnline === 'boolean'
    ? explicitOnline
    : !/offline|down|disabled|inactive/.test(statusText);

  const activityType = eventGenre === 8
    ? 'disaster-event'
    : (eventGenre === 7 ? 'special-event' : (context.top === true ? 'listener-activity' : null));
  const activityLabel = eventGenre === 8
    ? 'DISASTER EVENT FEED'
    : (eventGenre === 7 ? 'SPECIAL EVENT FEED' : (context.top === true ? 'ELEVATED LISTENER ACTIVITY' : null));

  return Object.freeze({
    id: `broadcastify-${feedId || index}`,
    feedId,
    name,
    country: cleanText(firstValue(raw, ['countryName', 'country_name', 'country'])
      ?? firstValue(location, ['countryName', 'country']), 100) || null,
    countryCode: cleanText(firstValue(raw, ['countryCode', 'country_code', 'coCode', 'co_code'])
      ?? firstValue(location, ['countryCode', 'country_code']), 3).toUpperCase() || null,
    region: cleanText(firstValue(raw, ['region', 'regionName', 'region_name', 'state', 'stateName', 'state_name'])
      ?? firstValue(location, ['region', 'state']), 100) || null,
    county: cleanText(firstValue(raw, ['county', 'countyName', 'county_name'])
      ?? firstValue(location, ['county']), 100) || null,
    city: cleanText(firstValue(raw, ['city', 'cityName', 'city_name'])
      ?? firstValue(location, ['city']), 100) || null,
    agency: cleanText(firstValue(raw, ['agency', 'agencyName', 'agency_name', 'department']), 160) || name,
    service: serviceType(raw),
    listeners: Number.isFinite(listenerValue) && listenerValue >= 0 ? Math.floor(listenerValue) : null,
    online,
    genreId: Number.isFinite(eventGenre) ? eventGenre : null,
    activityType,
    activityLabel,
    activeSignal: Boolean(activityType) && online,
    lat,
    lon,
    officialUrl: `https://www.broadcastify.com/listen/feed/${encodeURIComponent(feedId)}`,
    streamUrl: `https://broadcastify.cdnstream1.com/${encodeURIComponent(feedId)}`,
  });
}

export function normalizeBroadcastifyCatalog(payload, maxRows = MAX_CATALOG_ROWS, context = {}) {
  const limit = Math.max(1, Math.min(MAX_CATALOG_ROWS, Math.floor(Number(maxRows) || MAX_CATALOG_ROWS)));
  const seen = new Set();
  const feeds = [];
  for (const [index, raw] of catalogRows(payload).entries()) {
    const feed = normalizeBroadcastifyFeed(raw, index, context);
    if (!feed || seen.has(feed.feedId)) continue;
    seen.add(feed.feedId);
    feeds.push(feed);
    if (feeds.length >= limit) break;
  }
  return feeds.sort((a, b) => (Number(b.online) - Number(a.online))
    || ((b.listeners ?? -1) - (a.listeners ?? -1))
    || a.name.localeCompare(b.name));
}
