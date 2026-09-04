import * as Cesium from 'cesium';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';

const ENDPOINT = '/api/news-events';
export const GLOBAL_NEWS_OVERLAY_SOURCE_ID = 'global-news-reports';
const ACCENT = '#ff476f';
const MAX_OVERLAY_CARDS = 36;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  clearSource: clearOverlaySource,
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
});

function ageLabel(value, now = Date.now()) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'time unavailable';
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function cleanLine(value, max = 90) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function newsReportOverlayEntry(report, position, now = Date.now(), openExternal = null) {
  const url = typeof report?.url === 'string' ? report.url : null;
  return {
    id: report.id,
    position,
    variant: 'card',
    title: cleanLine(report.title, 96) || 'Reported incident',
    details: [
      ['REPORTED · UNVERIFIED', report.source, ageLabel(report.reportedAt, now)].filter(Boolean).join(' · '),
      [report.category, cleanLine(report.location, 70), `${report.locationPrecision || 'approximate'} location`]
        .filter(Boolean).join(' · '),
    ],
    accent: ACCENT,
    priority: 2450 - Math.max(0, (now - (Date.parse(report.reportedAt || '') || now)) / 3_600_000) * 10,
    collisionGroup: 'ambient-card',
    paintLane: 'ambient-card',
    interactive: Boolean(url),
    accessibilityLabel: url ? `Open ${report.source || 'publisher'} report: ${report.title}` : '',
    activate: url && typeof openExternal === 'function' ? () => openExternal(url) : null,
    maxDistance: 22_000_000,
    distanceFadeStartRatio: 0.8,
    distanceScale: { near: 200_000, nearValue: 1, far: 18_000_000, farValue: 0.66 },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 16,
    placement: 'above',
    metadata: report,
  };
}

export function createGlobalNewsReportsLayer({ overlayHost = DEFAULT_OVERLAY_HOST } = {}) {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let reports = [];
  let indexedCount = 0;
  let lastUpdate = null;
  let lastError = null;
  let stale = false;
  let sourceStatus = null;
  let controller = null;

  function publish() {
    if (!enabled || !dataSource) return;
    const now = Date.now();
    const entries = reports.slice(0, MAX_OVERLAY_CARDS).map((report) => newsReportOverlayEntry(
      report,
      Cesium.Cartesian3.fromDegrees(report.longitude, report.latitude, 60),
      now,
      (url) => globalThis.window?.open?.(url, '_blank', 'noopener,noreferrer'),
    ));
    overlayHost.setEntries(GLOBAL_NEWS_OVERLAY_SOURCE_ID, entries, {
      cohortLimit: MAX_OVERLAY_CARDS,
      collisionCapacity: 24,
      moving: false,
    });
  }

  return {
    id: 'global-news-reports',
    name: 'Global News Reports',
    icon: '📰',
    source: 'CNN + FOX News + ABC News via GDELT',
    updateInterval: 15 * 60_000,

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(GLOBAL_NEWS_OVERLAY_SOURCE_ID);
      dataSource.show = false;
      dataSource.clustering.enabled = true;
      dataSource.clustering.pixelRange = 48;
      dataSource.clustering.minimumClusterSize = 3;
      viewer.dataSources.add(dataSource);
      overlayHost.setVisible(GLOBAL_NEWS_OVERLAY_SOURCE_ID, false);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
      overlayHost.setVisible(GLOBAL_NEWS_OVERLAY_SOURCE_ID, true);
      publish();
    },

    disable() {
      enabled = false;
      controller?.abort();
      controller = null;
      if (dataSource) dataSource.show = false;
      overlayHost.clearSource(GLOBAL_NEWS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GLOBAL_NEWS_OVERLAY_SOURCE_ID, false);
    },

    async update() {
      if (!enabled || !dataSource) return false;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(ENDPOINT, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Global news reports returned ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.reports)) throw new Error('Global news response was malformed');
        reports = payload.reports.filter((report) => Number.isFinite(report?.latitude)
          && Number.isFinite(report?.longitude) && typeof report?.id === 'string');
        indexedCount = Number(payload.indexedCount) || reports.length;
        stale = payload.stale === true;
        sourceStatus = payload.sources || null;
        lastUpdate = Date.now();
        lastError = stale ? 'Serving cached news reports' : null;

        dataSource.entities.removeAll();
        const accent = Cesium.Color.fromCssColorString(ACCENT);
        for (const report of reports) {
          dataSource.entities.add({
            id: `global-news:${report.id}`,
            name: `REPORTED · UNVERIFIED — ${report.title}`,
            position: Cesium.Cartesian3.fromDegrees(report.longitude, report.latitude, 60),
            point: {
              pixelSize: 11,
              color: accent.withAlpha(0.92),
              outlineColor: Cesium.Color.WHITE.withAlpha(0.88),
              outlineWidth: 1,
              heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: {
              layerId: 'global-news-reports',
              reportId: report.id,
              title: report.title,
              source: report.source,
              category: report.category,
              reportedAt: report.reportedAt,
              location: report.location,
              locationPrecision: report.locationPrecision,
              verification: 'reported-unverified',
              url: report.url,
            },
          });
        }
        publish();
        viewer?.scene?.requestRender?.();
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error?.message || 'Global news reports unavailable';
        stale = reports.length > 0;
        return false;
      } finally {
        controller = null;
      }
    },

    destroy() {
      controller?.abort();
      overlayHost.clearSource(GLOBAL_NEWS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GLOBAL_NEWS_OVERLAY_SOURCE_ID, false);
      if (dataSource && viewer) viewer.dataSources.remove(dataSource, true);
      viewer = null;
      dataSource = null;
      enabled = false;
      reports = [];
      indexedCount = 0;
      lastUpdate = null;
      lastError = null;
      stale = false;
      sourceStatus = null;
    },

    getAnalystRecords(maxCount = 500) {
      if (!enabled) return [];
      const limit = Number.isFinite(maxCount) ? Math.max(1, Math.floor(maxCount)) : 500;
      return reports.slice(0, limit).map((report) => ({ ...report }));
    },

    getRowControls() {
      const sourceCounts = new Map();
      for (const report of reports) sourceCounts.set(report.source, (sourceCounts.get(report.source) || 0) + 1);
      return {
        legend: [...sourceCounts.entries()].map(([label, count]) => ({ label, count, color: ACCENT })),
      };
    },

    getStats() {
      return {
        count: reports.length,
        indexedCount,
        lastUpdate,
        error: lastError,
        stale,
        sources: sourceStatus,
        coverage: reports.length
          ? `${reports.length.toLocaleString()} approximate markers · reported/unverified`
          : 'no matching incident reports in the current 24h window',
      };
    },
  };
}

export default createGlobalNewsReportsLayer();
