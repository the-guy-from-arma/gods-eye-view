import test from 'node:test';
import assert from 'node:assert/strict';
import { filterJurisdictionRows } from './publicSafetyPreview.js';

const rows = [
  { country: 'US', region: 'Texas', county: 'Travis', city: 'Austin', agency: 'Austin Police', service: 'police' },
  { country: 'US', region: 'Texas', county: 'Harris', city: 'Houston', agency: 'Houston Police', service: 'police' },
  { country: 'CA', region: 'Ontario', county: '', city: 'Toronto', agency: 'Toronto Police', service: 'police' },
];

test('jurisdiction filtering cascades through area and department fields', () => {
  const selected = { country: 'US', region: 'Texas', county: 'Travis', city: '', agency: '', service: '' };
  assert.deepEqual(filterJurisdictionRows(rows, selected).map((row) => row.agency), ['Austin Police']);
});

test('a downstream choice does not hide options for its own control', () => {
  const selected = { country: 'US', region: 'Texas', county: 'Travis', city: 'Austin', agency: 'Austin Police', service: 'police' };
  assert.equal(filterJurisdictionRows(rows, selected, 'county').length, 2);
});
