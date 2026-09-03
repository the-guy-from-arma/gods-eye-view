import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

const API_URL = '/api/live-events';
export const LIVE_EVENTS_OVERLAY_SOURCE_ID = 'live-events';
export const LIVE_EVENTS_OVERLAY_COHORT_LIMIT = 72;
export const LIVE_EVENTS_OVERLAY_COLLISION_CAPACITY = 36;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  clearSource: clearOverlaySource,
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
});

const CATEGORY_COLORS = Object.freeze({
  drought: '#d4a15a',
  earthquake: '#ff5c57',
  flood: '#37a8ff',
  floods: '#37a8ff',
  'severe storms': '#9b7bff',
  tsunami: '#00d5ff',
  'tropical cyclone': '#9b7bff',
  volcano: '#ff4fd8',
  volcanoes: '#ff4fd8',
  wildfire: '#ff8a32',
  wildfires: '#ff8a32',
});

function eventAccent(event) {
  const alert = String(event?.alertLevel || '').toLowerCase();
  if (alert === 'red') return '#ff2d55';
  if (alert === 'orange') return '#ff9f0a';
  return CATEGORY_COLORS[String(event?.category || '').toLowerCase()] || '#21e6c1';
}

function ageLabel(iso, now = Date.now()) {
  const time = Date.parse(iso || '');
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function cleanCardLine(value, max = 74) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function liveEventPriority(event, now = Date.now()) {
  const alertWeight = { red: 3000, orange: 2000, green: 1000 }[
    String(event?.alertLevel || '').toLowerCase()
  ] || 1200;
  const ageHours = Math.max(0, (now - (Date.parse(event?.occurredAt || '') || now)) / 3600000);
  return alertWeight + Math.max(0, 1000 - ageHours * 8);
}

export function liveEventOverlayEntry(event, position, now = Date.now(), openExternal = null) {
  const accent = eventAccent(event);
  const origin = [event.source, event.alertLevel ? event.alertLevel.toUpperCase() : null, event.country]
    .filter(Boolean)
    .join(' · ');
  const context = [event.category, event.severity, ageLabel(event.occurredAt, now)]
    .filter(Boolean)
    .join(' · ');
  const url = typeof event.url === 'string' ? event.url : null;
  return {
    id: event.id,
    position,
    variant: 'card',
    title: cleanCardLine(event.title, 82) || 'Live event',
    details: [cleanCardLine(origin), cleanCardLine(context)].filter(Boolean),
    accent,
    priority: liveEventPriority(event, now),
    collisionGroup: 'ambient-card',
    paintLane: 'ambient-card',
    interactive: Boolean(url),
    accessibilityLabel: url ? `Open source report: ${event.title}` : '',
    activate: url && typeof openExternal === 'function' ? () => openExternal(url) : null,
    maxDistance: 22000000,
    distanceFadeStartRatio: 0.82,
    distanceScale: {
      near: 200000,
      nearValue: 1,
      far: 18000000,
      farValue: 0.66,
    },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 16,
    placement: 'above',
    metadata: event,
  };
}

export function createLiveEventsLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let dataSource = null;
  let events = [];
  let enabled = false;
  let lastUpdate = null;
  let lastError = null;
  let sourceStatus = null;

  function publish() {
    if (!enabled || !dataSource) return;
    const now = Date.now();
    const entries = [];
    for (const event of events.slice(0, LIVE_EVENTS_OVERLAY_COHORT_LIMIT)) {
      const position = Cesium.Cartesian3.fromDegrees(event.longitude, event.latitude, 50);
      entries.push(liveEventOverlayEntry(event, position, now, (url) => {
        globalThis.window?.open?.(url, '_blank', 'noopener,noreferrer');
      }));
    }
    overlayHost.setEntries(LIVE_EVENTS_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: LIVE_EVENTS_OVERLAY_COHORT_LIMIT,
      collisionCapacity: LIVE_EVENTS_OVERLAY_COLLISION_CAPACITY,
      moving: false,
    });
  }

  const layer = {
    id: 'live-events',
    name: 'Live Global Events',
    icon: '⚡',
    source: 'NASA EONET + GDACS',
    updateInterval: 180000,

    init(viewer) {
      dataSource = new Cesium.CustomDataSource(LIVE_EVENTS_OVERLAY_SOURCE_ID);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      events = [];
      enabled = false;
      lastUpdate = null;
      lastError = null;
      sourceStatus = null;
      overlayHost.setVisible(LIVE_EVENTS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      overlayHost.setVisible(LIVE_EVENTS_OVERLAY_SOURCE_ID, true);
      publish();
    },

    disable() {
      enabled = false;
      if (dataSource) dataSource.show = false;
      overlayHost.clearSource(LIVE_EVENTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(LIVE_EVENTS_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      try {
        const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Live Events HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.events)) throw new Error('Malformed Live Events response');

        const nextEvents = payload.events.filter((event) => (
          event && typeof event.id === 'string'
          && Number.isFinite(event.latitude) && Number.isFinite(event.longitude)
        ));
        events = nextEvents;
        sourceStatus = payload.sources || null;
        lastUpdate = Date.now();
        lastError = payload.status === 'stale' ? 'Serving cached event data' : null;

        dataSource?.entities.removeAll();
        for (const event of events) {
          const accent = Cesium.Color.fromCssColorString(eventAccent(event));
          dataSource?.entities.add({
            id: `live-event:${event.id}`,
            position: Cesium.Cartesian3.fromDegrees(event.longitude, event.latitude, 50),
            point: {
              pixelSize: String(event.alertLevel || '').toLowerCase() === 'red' ? 13 : 9,
              color: accent.withAlpha(0.92),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
              outlineWidth: 1,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              eventId: event.id,
              title: event.title,
              category: event.category,
              source: event.source,
              country: event.country,
              alertLevel: event.alertLevel,
              severity: event.severity,
              occurredAt: event.occurredAt,
              url: event.url,
            },
          });
        }
        publish();
        return true;
      } catch (error) {
        lastError = String(error?.message || error || 'Live event feed unavailable');
        console.warn('[Data:LiveEvents] Fetch error:', error);
        return false;
      }
    },

    destroy(viewer) {
      enabled = false;
      overlayHost.clearSource(LIVE_EVENTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(LIVE_EVENTS_OVERLAY_SOURCE_ID, false);
      if (dataSource) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      events = [];
      lastUpdate = null;
      lastError = null;
      sourceStatus = null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 500;
      return events.slice(0, limit).map((event) => ({ ...event }));
    },

    getRowControls() {
      const counts = new Map();
      for (const event of events) counts.set(event.category, (counts.get(event.category) || 0) + 1);
      return {
        legend: [...counts.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 4)
          .map(([label, count]) => ({ label, count, color: CATEGORY_COLORS[label.toLowerCase()] || '#21e6c1' })),
      };
    },

    getStats() {
      return { count: events.length, lastUpdate, error: lastError, sources: sourceStatus };
    },
  };
  return layer;
}

export default createLiveEventsLayer();

