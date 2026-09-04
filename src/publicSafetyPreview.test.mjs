import test from 'node:test';
import assert from 'node:assert/strict';
import { filterJurisdictionRows, matchCatalogJurisdiction } from './publicSafetyPreview.js';

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

test('matches a camera view to city and county catalog feeds', () => {
  const catalog = [
    ...rows,
    { country: 'US', countryName: 'United States', region: 'Texas', county: 'Travis County', city: '', agency: 'Travis Sheriff', service: 'sheriff' },
  ];
  const match = matchCatalogJurisdiction(catalog, {
    countryCode: 'US', country: 'United States', region: 'Texas', county: 'Travis County', city: 'Austin',
  });
  assert.equal(match.level, 'city');
  assert.equal(match.selection.country, 'US');
  assert.equal(match.selection.region, 'Texas');
  assert.equal(match.selection.county, 'Travis');
  assert.equal(match.selection.city, 'Austin');
  assert.deepEqual(match.rows.map((row) => row.agency), ['Austin Police', 'Travis Sheriff']);
});

test('falls back to the matching region when no local catalog entry exists', () => {
  const match = matchCatalogJurisdiction(rows, {
    countryCode: 'US', region: 'Texas', county: 'Bexar County', city: 'San Antonio',
  });
  assert.equal(match.level, 'region');
  assert.deepEqual(match.rows.map((row) => row.agency), ['Austin Police', 'Houston Police']);
});
