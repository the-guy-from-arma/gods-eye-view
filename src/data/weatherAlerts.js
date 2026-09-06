import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

const SEVERITY_COLORS = Object.freeze({
  Extreme: '#ff284f',
  Severe: '#ff6a3d',
  Moderate: '#ffc84b',
  Minor: '#58d6ff',
  Unknown: '#9d82ff',
});

function colorForSeverity(value) {
  return SEVERITY_COLORS[value] || SEVERITY_COLORS.Unknown;
}

export function createWeatherAlertsLayer() {
  let dataSource = null;
  let viewerRef = null;
  let enabled = false;
  let lastUpdate = null;
  let lastError = null;
  let totalAlerts = 0;
  let mappedAlerts = 0;
  let severityCounts = new Map();

  async function replaceDataSource(next) {
    const prior = dataSource;
    dataSource = next;
    dataSource.show = enabled;
    await viewerRef.dataSources.add(dataSource);
    if (prior) viewerRef.dataSources.remove(prior, true);
  }

  return {
    id: 'weather-alerts',
    name: 'Active Weather Warnings',
    icon: '⚠',
    source: 'NOAA / NWS',
    updateInterval: 2 * 60_000,

    init(viewer) {
      viewerRef = viewer;
      dataSource = new Cesium.GeoJsonDataSource('weather-alerts');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
    },

    enable(viewer) {
      enabled = true;
      if (dataSource) dataSource.show = true;
      governorRequestRender(viewer?.scene, 'weather-alerts-enable');
    },

    disable(viewer) {
      enabled = false;
      if (dataSource) dataSource.show = false;
      governorRequestRender(viewer?.scene, 'weather-alerts-disable');
    },

    async update(viewer) {
      try {
        const response = await fetch('/api/weather/alerts', { headers: { Accept: 'application/geo+json, application/json' } });
        if (!response.ok) throw new Error(`Weather alerts HTTP ${response.status}`);
        const payload = await response.json();
        if (payload?.featureCollection?.type !== 'FeatureCollection') throw new Error('Malformed weather-alert response');
        const next = await Cesium.GeoJsonDataSource.load(payload.featureCollection, {
          clampToGround: false,
          stroke: Cesium.Color.WHITE.withAlpha(0.75),
          strokeWidth: 2,
          fill: Cesium.Color.CYAN.withAlpha(0.14),
        });
        severityCounts = new Map();
        for (const entity of next.entities.values) {
          const severity = entity.properties?.severity?.getValue?.() || 'Unknown';
          const color = Cesium.Color.fromCssColorString(colorForSeverity(severity));
          severityCounts.set(severity, (severityCounts.get(severity) || 0) + 1);
          if (entity.polygon) {
            entity.polygon.height = 10_000;
            entity.polygon.material = color.withAlpha(0.16);
            entity.polygon.outline = true;
            entity.polygon.outlineColor = color.withAlpha(0.95);
          }
          entity.name = entity.properties?.event?.getValue?.() || 'Weather alert';
        }
        await replaceDataSource(next);
        totalAlerts = Number(payload.totalAlerts || 0);
        mappedAlerts = Number(payload.mappedAlerts || next.entities.values.length);
        lastUpdate = Date.now();
        lastError = payload.status === 'stale' ? 'Serving cached NWS alerts' : null;
        governorRequestRender(viewer?.scene, 'weather-alerts-refresh');
        return true;
      } catch (error) {
        lastError = String(error?.message || error || 'Weather alerts unavailable');
        console.warn('[Data:WeatherAlerts] Fetch error:', error);
        return false;
      }
    },

    destroy(viewer) {
      enabled = false;
      if (dataSource) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
      viewerRef = null;
      severityCounts = new Map();
    },

    getRowControls() {
      return {
        legend: [...severityCounts.entries()].map(([label, count]) => ({ label: label.toUpperCase(), count, color: colorForSeverity(label) })),
      };
    },

    getStats() {
      return { count: mappedAlerts, totalAlerts, lastUpdate, error: lastError, source: 'NOAA / NWS active alerts' };
    },
  };
}

export default createWeatherAlertsLayer();
