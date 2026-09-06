import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

const REFRESH_MS = 5 * 60_000;

export function createWeatherRadarLayer() {
  let dataSource = null;
  let objectUrl = null;
  let enabled = false;
  let lastUpdate = null;
  let lastError = null;

  function clearObjectUrl() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  return {
    id: 'weather-radar',
    name: 'Live Weather Radar',
    icon: '◉',
    source: 'NOAA / NWS MRMS',
    updateInterval: REFRESH_MS,

    init(viewer) {
      dataSource = new Cesium.CustomDataSource('weather-radar');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
    },

    enable(viewer) {
      enabled = true;
      if (dataSource) dataSource.show = true;
      governorRequestRender(viewer?.scene, 'weather-radar-enable');
    },

    disable(viewer) {
      enabled = false;
      if (dataSource) dataSource.show = false;
      governorRequestRender(viewer?.scene, 'weather-radar-disable');
    },

    async update(viewer) {
      try {
        const bucket = Math.floor(Date.now() / REFRESH_MS);
        const response = await fetch(`/api/weather/radar.png?t=${bucket}`, { headers: { Accept: 'image/png' } });
        if (!response.ok) throw new Error(`Radar HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('Radar returned a non-image response');
        const nextUrl = URL.createObjectURL(blob);
        dataSource.entities.removeAll();
        dataSource.entities.add({
          id: 'weather-radar:latest',
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(-180, -85, 180, 85),
            height: 12_000,
            material: new Cesium.ImageMaterialProperty({
              image: nextUrl,
              transparent: true,
              color: Cesium.Color.WHITE.withAlpha(0.72),
            }),
          },
          properties: {
            provider: 'NOAA / NWS MRMS',
            coverage: 'United States, Canada, Alaska, Caribbean, Guam, and Hawaii',
            observedAt: new Date().toISOString(),
          },
        });
        clearObjectUrl();
        objectUrl = nextUrl;
        dataSource.show = enabled;
        lastUpdate = Date.now();
        lastError = null;
        governorRequestRender(viewer?.scene, 'weather-radar-refresh');
        return true;
      } catch (error) {
        lastError = String(error?.message || error || 'Radar unavailable');
        console.warn('[Data:WeatherRadar] Fetch error:', error);
        return false;
      }
    },

    destroy(viewer) {
      enabled = false;
      clearObjectUrl();
      if (dataSource) viewer.dataSources.remove(dataSource, true);
      dataSource = null;
    },

    getRowControls() {
      return { legend: [{ label: 'NOAA MRMS REFLECTIVITY', color: '#65e7ff' }] };
    },

    getStats() {
      return { count: dataSource?.entities.values.length || 0, lastUpdate, error: lastError, coverage: 'NOAA regional coverage' };
    },
  };
}

export default createWeatherRadarLayer();
