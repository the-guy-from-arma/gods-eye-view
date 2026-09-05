export const LAYER_AVAILABILITY_STATUSES = Object.freeze([
  'live',
  'coming_soon',
  'maintenance',
  'disabled',
]);

const VALID_STATUSES = new Set(LAYER_AVAILABILITY_STATUSES);

export const PUBLIC_LAYER_CATALOG = Object.freeze([
  ['interface-display', 'Display Controls', 'Interface Modules'],
  ['interface-cctv', 'CCTV Controls', 'Interface Modules'],
  ['interface-context', 'Context Controls', 'Interface Modules'],
  ['ais-live-vessels', 'Live AIS Vessels'],
  ['bikeshare', 'Bikeshare'],
  ['cctv', 'CCTV'],
  ['earthquakes', 'Earthquakes (24h)'],
  ['flights', 'Live Flights'],
  ['flock-cameras', 'Flock Cameras'],
  ['global-news-reports', 'Global News Reports'],
  ['law-enforcement-transmissions', 'Law Enforcement Transmissions'],
  ['live-events', 'Live Global Events'],
  ['local-dams', 'Dams'],
  ['local-datacenters', 'Datacenters'],
  ['local-firms', 'FIRMS Active Fires'],
  ['military', 'Military Flights'],
  ['military-awareness', 'Global Context'],
  ['military-installations', 'Mapped Installations'],
  ['radio', 'Radio'],
  ['rocket-launches', 'Space Missions (30d)'],
  ['satellites', 'Satellites'],
  ['scenes', 'Scenes'],
  ['telegeography-submarine-cables', 'Submarine Cables'],
  ['traffic', 'Street Traffic'],
].map(([id, name, group = 'Data & Tools']) => Object.freeze({ id, name, group })));

export const PUBLIC_LAYER_IDS = Object.freeze(PUBLIC_LAYER_CATALOG.map(({ id }) => id));

export function normalizeLayerAvailabilityStatus(value) {
  return VALID_STATUSES.has(value) ? value : 'live';
}

export function mergeLayerAvailability(rows = []) {
  const statusById = new Map((Array.isArray(rows) ? rows : []).map((row) => [
    String(row?.layerId || row?.layer_id || ''),
    normalizeLayerAvailabilityStatus(row?.status),
  ]));
  return PUBLIC_LAYER_CATALOG.map(({ id, name, group }) => ({
    id,
    name,
    group,
    status: statusById.get(id) || 'live',
  }));
}
