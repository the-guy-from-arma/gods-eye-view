/**
 * Pure import/runtime helpers for the bundled Flock camera placement snapshot.
 * No map or UI code from the upstream project is used here.
 */

export const FLOCK_CAMERA_SCHEMA_VERSION = 1;
export const FLOCK_CAMERA_FIELDS = Object.freeze([
  'longitude',
  'latitude',
  'operator',
  'name',
  'direction',
  'mount',
  'cameraType',
  'source',
]);

const FLOCK_IDENTITY_FIELDS = Object.freeze([
  'manufacturer',
  'brand',
  'camera:brand',
  'surveillance:manufacturer',
  'surveillance:brand',
]);

function clean(value, maxLength = 180) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function saysFlock(value) {
  return /(^|\b)flock(?:\s+safety)?(\b|$)/i.test(clean(value));
}

/**
 * Conservative brand classifier. Free-text notes, URLs, network lists, and
 * portal metadata are deliberately excluded because merely mentioning Flock
 * does not establish that the point is a Flock camera placement.
 */
export function isFlockCameraFeature(feature) {
  if (feature?.geometry?.type !== 'Point') return false;
  const properties = feature?.properties;
  if (!properties || typeof properties !== 'object') return false;
  if (FLOCK_IDENTITY_FIELDS.some((field) => saysFlock(properties[field]))) return true;
  if (clean(properties.surveillance).toLowerCase() === 'flock') return true;
  return clean(properties.operator).toLowerCase() === 'flock safety';
}

/** Convert one upstream GeoJSON point into the compact public record schema. */
export function compactFlockCameraFeature(feature) {
  if (!isFlockCameraFeature(feature)) return null;
  const coordinates = feature.geometry.coordinates;
  const longitude = Number(coordinates?.[0]);
  const latitude = Number(coordinates?.[1]);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  const properties = feature.properties;
  return [
    Number(longitude.toFixed(7)),
    Number(latitude.toFixed(7)),
    clean(properties.operator),
    clean(properties.name),
    clean(properties.direction || properties['camera:direction'], 48),
    clean(properties['camera:mount'] || properties.support, 48),
    clean(properties['surveillance:type'] || properties['camera:type'], 48),
    clean(properties.data_source || properties.source, 80),
  ];
}

/** Prefer the duplicate at one coordinate that contains the richest context. */
function compactRecordScore(record) {
  return record.slice(2).reduce((score, value) => score + (value ? 1 : 0), 0);
}

/** Extract, exact-coordinate deduplicate, and deterministically sort placements. */
export function extractFlockCameraRecords(featureCollection) {
  const byCoordinate = new Map();
  for (const feature of featureCollection?.features || []) {
    const record = compactFlockCameraFeature(feature);
    if (!record) continue;
    const key = `${record[0]},${record[1]}`;
    const existing = byCoordinate.get(key);
    if (!existing || compactRecordScore(record) > compactRecordScore(existing)) {
      byCoordinate.set(key, record);
    }
  }
  return [...byCoordinate.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Expand and validate one compact runtime record. */
export function expandFlockCameraRecord(record, index = 0) {
  if (!Array.isArray(record) || record.length < 2) return null;
  const longitude = Number(record[0]);
  const latitude = Number(record[1]);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  return {
    id: `flock-camera:${index}`,
    longitude,
    latitude,
    operator: clean(record[2]),
    name: clean(record[3]),
    direction: clean(record[4], 48),
    mount: clean(record[5], 48),
    cameraType: clean(record[6], 48),
    source: clean(record[7], 80),
  };
}

/** Parse the intentionally small, versioned dataset contract used by the layer. */
export function parseFlockCameraDataset(payload) {
  if (!payload || payload.schemaVersion !== FLOCK_CAMERA_SCHEMA_VERSION) {
    throw new Error('unsupported Flock camera dataset schema');
  }
  if (!Array.isArray(payload.cameras)) throw new Error('Flock camera dataset is malformed');
  return payload.cameras
    .map((record, index) => expandFlockCameraRecord(record, index))
    .filter(Boolean);
}

function longitudeInside(longitude, west, east) {
  return west <= east
    ? longitude >= west && longitude <= east
    : longitude >= west || longitude <= east;
}

function wrappedLongitudeDelta(a, b) {
  return Math.abs((((a - b) + 540) % 360) - 180);
}

/**
 * Select visible placements and cap dense views by proximity to view centre.
 * Bounds support ordinary and antimeridian-crossing rectangles.
 */
export function selectFlockCamerasForView(records, bounds, maxCount = 5000) {
  if (!Array.isArray(records) || !bounds) return [];
  const south = Number(bounds.south);
  const north = Number(bounds.north);
  const west = Number(bounds.west);
  const east = Number(bounds.east);
  if (![south, north, west, east].every(Number.isFinite) || south > north) return [];
  const centerLatitude = (south + north) / 2;
  const longitudeSpan = west <= east ? east - west : 360 - west + east;
  const centerLongitude = ((west + longitudeSpan / 2 + 540) % 360) - 180;
  const selected = records.filter((record) => (
    record.latitude >= south
    && record.latitude <= north
    && longitudeInside(record.longitude, west, east)
  ));
  const limit = Math.max(0, Math.floor(Number(maxCount) || 0));
  if (selected.length <= limit) return selected;
  return selected
    .map((record) => ({
      record,
      distance: (record.latitude - centerLatitude) ** 2
        + (wrappedLongitudeDelta(record.longitude, centerLongitude)
          * Math.cos(centerLatitude * Math.PI / 180)) ** 2,
    }))
    .sort((a, b) => a.distance - b.distance || a.record.id.localeCompare(b.record.id))
    .slice(0, limit)
    .map((entry) => entry.record);
}

