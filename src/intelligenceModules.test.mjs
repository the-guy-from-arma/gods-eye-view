import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTELLIGENCE_MODULES,
  INTELLIGENCE_MODULE_BY_ID,
  intelligenceAccessAllows,
} from './data/intelligenceModules.js';
import { PUBLIC_LAYER_CATALOG } from './data/layerAvailability.js';

const html = readFileSync(new URL('../intelligence.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('./intelligenceConsole.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../server/intelligenceApi.js', import.meta.url), 'utf8');

test('intelligence capability ids are unique and every module is owner-governed', () => {
  const ids = INTELLIGENCE_MODULES.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(INTELLIGENCE_MODULE_BY_ID.size, ids.length);
  const controlledIds = new Set(PUBLIC_LAYER_CATALOG.filter(({ id }) => id.startsWith('intel-')).map(({ id }) => id.slice(6)));
  assert.deepEqual(controlledIds, new Set(ids));
});

test('access levels form a strict capability ladder', () => {
  assert.equal(intelligenceAccessAllows('registered', 'verified'), false);
  assert.equal(intelligenceAccessAllows('verified', 'verified'), true);
  assert.equal(intelligenceAccessAllows('analyst', 'verified'), true);
  assert.equal(intelligenceAccessAllows('analyst', 'owner'), false);
  assert.equal(intelligenceAccessAllows('owner', 'owner'), true);
});

test('console is authenticated, source-grounded, and separates passive from active checks', () => {
  assert.match(html, /THUNDERLINK · SOURCE-GROUNDED INTELLIGENCE/);
  assert.match(html, /LAWFUL USE ONLY/);
  assert.match(client, /api\/intelligence\/catalog/);
  assert.match(client, /RUN PASSIVE QUERY/);
  assert.match(client, /RUN AUTHORIZED CHECK/);
  assert.match(api, /Verify ownership of this target before scanning/);
  assert.match(api, /Scanner backend must use HTTPS/);
  assert.doesNotMatch(api, /rejectUnauthorized\s*:\s*false|X-Forwarded-For.*random|X-Real-IP.*random/);
});
