import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_LAYER_CATALOG, mergeLayerAvailability } from './data/layerAvailability.js';

const source = readFileSync(new URL('./interfaceAvailability.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('Display, CCTV, and Context are individually owner-governed interface modules', () => {
  const features = PUBLIC_LAYER_CATALOG.filter(({ group }) => group === 'Interface Modules');
  assert.deepEqual(features.map(({ id }) => id), [
    'interface-display',
    'interface-cctv',
    'interface-context',
  ]);
  assert.deepEqual(features.map(({ name }) => name), [
    'Display Controls',
    'CCTV Controls',
    'Context Controls',
  ]);
});

test('interface status merge defaults live and preserves owner selections', () => {
  const rows = mergeLayerAvailability([
    { layerId: 'interface-display', status: 'disabled' },
    { layerId: 'interface-cctv', status: 'coming_soon' },
    { layerId: 'interface-context', status: 'maintenance' },
  ]);
  assert.equal(rows.find(({ id }) => id === 'interface-display').status, 'disabled');
  assert.equal(rows.find(({ id }) => id === 'interface-cctv').status, 'coming_soon');
  assert.equal(rows.find(({ id }) => id === 'interface-context').status, 'maintenance');
  assert.equal(rows.find(({ id }) => id === 'flights').status, 'live');
});

test('runtime applies panel policy and CSS supplies hidden and inactive states', () => {
  assert.match(source, /'interface-display': 'pp-toggles'/);
  assert.match(source, /'interface-cctv': 'cctv-panel'/);
  assert.match(source, /'interface-context': 'global-context-panel'/);
  assert.match(source, /panel\.hidden = status === 'disabled'/);
  assert.match(source, /panel\.classList\.add\('collapsed'\)/);
  assert.match(main, /applyInterfaceAvailability\(latestLayerAvailability\)/);
  assert.match(css, /\[data-owner-feature\]\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /\.interface-availability-badge/);
});
