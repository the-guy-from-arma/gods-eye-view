/**
 * Pure normalization helpers for the keyless Live Events feed.
 *
 * NASA EONET and GDACS both publish GeoJSON, but their property schemas and
 * geometry shapes differ. This module converts them to one small, JSON-safe
 * contract shared by the Railway proxy and the Cesium client layer.
 */

const GDACS_EVENT_TYPES = Object.freeze({
  DR: 'Drought',
  EQ: 'Earthquake',
  FL: 'Flood',
  TC: 'Tropical Cyclone',
  TS: 'Tsunami',
  VO: 'Volcano',
  WF: 'Wildfire',
});

function cleanText(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function finiteCoordinatePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Return the latest/right-most valid point in any GeoJSON geometry. */
export function pointFromEventGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.type === 'Point') {
    const direct = finiteCoordinatePair(geometry.coordinates);
    if (direct) return direct;
    // GDACS currently wraps Point coordinates in one extra array.
  }
  const pending = [geometry.coordinates];
  while (pending.length) {
    const value = pending.pop();
    const point = finiteCoordinatePair(value);
    if (point) return point;
    if (!Array.isArray(value)) continue;
    // Push in source order so the final coordinate is visited first.
    for (let index = 0; index < value.length; index++) pending.push(value[index]);
  }
  return null;
}

function isoDate(value) {
  const input = cleanText(value, 80);
  if (!input) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)
    ? `${input.replace(' ', 'T')}Z`
    : input;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeExternalUrl(value) {
  const input = cleanText(value, 2000);
  if (!input) return null;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

function gdacsWebUrl(links) {
  if (!Array.isArray(links)) return null;
  const web = links.find((entry) => String(entry?.Key ?? entry?.key).toLowerCase() === 'web');
  return safeExternalUrl(web?.Value ?? web?.value);
}

export function normalizeEonetFeature(feature) {
  const properties = feature?.properties || {};
  const point = pointFromEventGeometry(feature?.geometry);
  const id = cleanText(properties.id, 120);
  const title = cleanText(properties.title, 180);
  if (!point || !id || !title) return null;
  const category = cleanText(properties.categories?.[0]?.title, 80) || 'Natural Event';
  const source = properties.sources?.find((entry) => safeExternalUrl(entry?.url));
  const magnitudeValue = Number(properties.magnitudeValue);
  const magnitudeUnit = cleanText(properties.magnitudeUnit, 40);
  return {
    id: `eonet:${id}`,
    title,
    description: cleanText(properties.description, 320),
    category,
    source: 'NASA EONET',
    country: null,
    alertLevel: null,
    severity: Number.isFinite(magnitudeValue)
      ? `${magnitudeValue.toLocaleString('en-US', { maximumFractionDigits: 1 })}${magnitudeUnit ? ` ${magnitudeUnit}` : ''}`
      : null,
    occurredAt: isoDate(properties.date),
    latitude: point.latitude,
    longitude: point.longitude,
    url: safeExternalUrl(source?.url) || safeExternalUrl(properties.link),
    confidence: 'official-source',
  };
}

export function normalizeGdacsFeature(feature) {
  const properties = feature?.properties || {};
  const point = pointFromEventGeometry(feature?.geometry);
  const eventType = cleanText(properties.eventtype, 12)?.toUpperCase();
  const eventId = cleanText(properties.eventid, 120);
  const title = cleanText(properties.title, 180);
  if (!point || !eventType || !eventId || !title) return null;
  const severityValue = cleanText(properties.severity, 40);
  const severityUnit = cleanText(properties.severityunit, 24);
  return {
    id: `gdacs:${eventType}:${eventId}`,
    title,
    description: cleanText(properties.description, 320),
    category: GDACS_EVENT_TYPES[eventType] || eventType,
    source: 'GDACS',
    country: cleanText(properties.country, 100),
    alertLevel: cleanText(properties.alertlevel, 30)?.toLowerCase() || null,
    severity: severityValue ? `${severityValue}${severityUnit ? ` ${severityUnit}` : ''}` : null,
    occurredAt: isoDate(properties.todate || properties.fromdate),
    latitude: point.latitude,
    longitude: point.longitude,
    url: gdacsWebUrl(properties.link),
    confidence: 'official-alert',
  };
}

function normalizeCollection(payload, mapper) {
  if (!payload || !Array.isArray(payload.features)) return [];
  return payload.features.map(mapper).filter(Boolean);
}

export function normalizeEonetPayload(payload) {
  return normalizeCollection(payload, normalizeEonetFeature);
}

export function normalizeGdacsPayload(payload) {
  return normalizeCollection(payload, normalizeGdacsFeature);
}

/** Stable merge ordered by most recent event time, then source identity. */
export function mergeLiveEvents(...collections) {
  const byId = new Map();
  for (const collection of collections) {
    for (const event of Array.isArray(collection) ? collection : []) {
      if (!event?.id || byId.has(event.id)) continue;
      byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt || '') || 0;
    const rightTime = Date.parse(right.occurredAt || '') || 0;
    return rightTime - leftTime || String(left.id).localeCompare(String(right.id));
  });
}
