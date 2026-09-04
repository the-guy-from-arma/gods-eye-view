import assert from 'node:assert/strict';
import test from 'node:test';

import { newsReportOverlayEntry } from './globalNewsReports.js';

test('global news cards visibly classify publisher reports as unverified and open the source', () => {
  let opened = null;
  const report = {
    id: 'news-example',
    title: 'Mass shooting reported in Austin, Texas',
    source: 'CNN',
    category: 'Mass shooting report',
    location: 'Austin, TX, USA',
    locationPrecision: 'city',
    reportedAt: '2026-09-04T08:00:00Z',
    url: 'https://www.cnn.com/example',
  };
  const entry = newsReportOverlayEntry(
    report,
    { x: 1, y: 2, z: 3 },
    Date.parse('2026-09-04T09:00:00Z'),
    (url) => { opened = url; },
  );
  assert.equal(entry.variant, 'card');
  assert.equal(entry.interactive, true);
  assert.match(entry.details[0], /^REPORTED · UNVERIFIED · CNN · 1h ago$/);
  assert.match(entry.details[1], /Mass shooting report · Austin, TX, USA · city location/);
  entry.activate();
  assert.equal(opened, report.url);
});
