import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWeatherRadarLayer } from './weatherRadar.js';
import { createWeatherAlertsLayer } from './weatherAlerts.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { PUBLIC_LAYER_CATALOG } from './layerAvailability.js';
import { weatherLayersApiPlugin, weatherLayersInternals } from '../../server/weatherLayersApi.js';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const consoleClient = readFileSync(new URL('../intelligenceConsole.js', import.meta.url), 'utf8');

test('radar and warning areas are independent owner-governed map layers', () => {
  const radar = createWeatherRadarLayer();
  const alerts = createWeatherAlertsLayer();
  assert.equal(radar.id, 'weather-radar');
  assert.equal(alerts.id, 'weather-alerts');
  assert.equal(LAYER_STATE_REGISTRY.some(({ id }) => id === radar.id), true);
  assert.equal(LAYER_STATE_REGISTRY.some(({ id }) => id === alerts.id), true);
  assert.equal(PUBLIC_LAYER_CATALOG.some(({ id, group }) => id === radar.id && group === 'Weather'), true);
  assert.equal(PUBLIC_LAYER_CATALOG.some(({ id, group }) => id === alerts.id && group === 'Weather'), true);
  assert.match(main, /dataManager\.register\(weatherRadarLayer\)/);
  assert.match(main, /dataManager\.register\(weatherAlertsLayer\)/);
});

test('NWS alert normalization keeps mapped warning geometry and bounded properties', () => {
  const normalized = weatherLayersInternals.normalizeAlert({
    id: 'alert-1',
    geometry: { type: 'Polygon', coordinates: [[[-98, 30], [-97, 30], [-97, 31], [-98, 30]]] },
    properties: { event: 'Tornado Warning', severity: 'Extreme', description: 'not forwarded' },
  });
  assert.equal(normalized.geometry.type, 'Polygon');
  assert.equal(normalized.properties.event, 'Tornado Warning');
  assert.equal(normalized.properties.severity, 'Extreme');
  assert.equal('description' in normalized.properties, false);
  assert.equal(weatherLayersInternals.normalizeAlert({ geometry: null, properties: {} }), null);
});

test('radar proxy is pinned to NOAA and severe weather no longer renders as a console list', () => {
  const url = new URL(weatherLayersInternals.NOAA_RADAR_EXPORT);
  assert.equal(url.hostname, 'mapservices.weather.noaa.gov');
  assert.equal(url.searchParams.get('transparent'), 'true');
  assert.doesNotMatch(consoleClient.split('\n')[1], /severe-weather/);
  assert.match(consoleClient, /enable Live Weather Radar, Active Weather Warnings/);
});

test('weather plugin setup never returns the middleware app as a Vite post hook', () => {
  const middlewareApp = () => {};
  const server = { middlewares: { use() { return middlewareApp; } } };
  const plugin = weatherLayersApiPlugin({ env: {} });
  assert.equal(plugin.configureServer(server), undefined);
  assert.equal(plugin.configurePreviewServer(server), undefined);
});
