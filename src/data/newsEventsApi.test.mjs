import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEWS_SOURCES,
  extractNewsLocationHint,
  newsEventsApiPlugin,
  normalizeGdeltArticles,
  normalizePublisherRss,
  parseGdeltDate,
} from '../../server/newsEventsApi.js';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
}

test('normalizes only the requested publisher domain and extracts an incident location', () => {
  const reports = normalizeGdeltArticles({ articles: [
    {
      title: 'Police respond to mass shooting in Austin, Texas, officials say',
      url: 'https://www.cnn.com/example',
      domain: 'cnn.com',
      seendate: '20260904T081500Z',
    },
    {
      title: 'Mass shooting in Denver, Colorado',
      url: 'https://example.com/not-cnn',
      domain: 'example.com',
      seendate: '20260904T081500Z',
    },
  ] }, NEWS_SOURCES[0]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].locationHint, 'Austin, Texas');
  assert.equal(reports[0].category, 'Mass shooting report');
  assert.equal(reports[0].reportedAt, '2026-09-04T08:15:00.000Z');
});

test('extracts conservative title location hints and rejects invalid GDELT dates', () => {
  assert.equal(extractNewsLocationHint('School shooting near Madison, Wisconsin, police say'), 'Madison, Wisconsin');
  assert.equal(extractNewsLocationHint('BREAKING: active shooter report'), null);
  assert.equal(parseGdeltDate('not-a-date'), null);
});

test('normalizes publisher RSS headlines without accepting off-domain links or article bodies', () => {
  const reports = normalizePublisherRss(`<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Mass shooting reported in Denver, Colorado]]></title><link>https://www.cnn.com/2026/example</link><description>body text</description><pubDate>Fri, 04 Sep 2026 08:15:00 GMT</pubDate></item>
    <item><title>Mass shooting in Denver, Colorado</title><link>https://example.com/not-cnn</link></item>
  </channel></rss>`, NEWS_SOURCES[0]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].locationHint, 'Denver, Colorado');
  assert.equal('description' in reports[0], false);
});

test('news proxy keeps the Google key server-side and returns approximate reported markers', async () => {
  let handler;
  const requestedUrls = [];
  const plugin = newsEventsApiPlugin({
    env: { GOOGLE_MAPS_API_KEY: 'server-only-google-key' },
    gdeltMinIntervalMs: 0,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      requestedUrls.push(parsed);
      if (parsed.hostname === 'maps.googleapis.com') {
        return {
          ok: true,
          json: async () => ({
            status: 'OK',
            results: [{
              formatted_address: 'Austin, TX, USA',
              types: ['locality', 'political'],
              geometry: { location: { lat: 30.2672, lng: -97.7431 } },
            }],
          }),
        };
      }
      if (parsed.hostname !== 'api.gdeltproject.org') {
        return { ok: true, status: 200, text: async () => '<rss><channel></channel></rss>' };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ articles: NEWS_SOURCES.map((source) => ({
          title: `Mass shooting reported in Austin, Texas, officials say — ${source.name}`,
          url: `https://${source.domain}/incident-${source.id}`,
          domain: source.domain,
          seendate: '20260904T081500Z',
        })) }),
      };
    },
  });
  plugin.configureServer({ middlewares: { use(path, fn) { assert.equal(path, '/api/news-events'); handler = fn; } } });
  const response = responseRecorder();
  await handler({ method: 'GET' }, response);
  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(payload.reports.length, 3);
  assert.ok(payload.reports.every((report) => report.verification === 'reported-unverified'));
  assert.ok(payload.reports.every((report) => report.locationPrecision === 'city'));
  assert.equal(response.body.includes('server-only-google-key'), false);
  assert.equal(requestedUrls.filter((url) => url.hostname === 'api.gdeltproject.org').length, 1);
  assert.equal(requestedUrls.filter((url) => url.hostname !== 'api.gdeltproject.org' && url.hostname !== 'maps.googleapis.com').length, 3);
});

test('publisher RSS remains available when the GDELT index is rate-limited', async () => {
  let handler;
  let gdeltCalls = 0;
  const plugin = newsEventsApiPlugin({
    env: { GOOGLE_MAPS_API_KEY: 'server-only-google-key' },
    gdeltMinIntervalMs: 0,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === 'api.gdeltproject.org') {
        gdeltCalls += 1;
        return { ok: false, status: 429 };
      }
      if (parsed.hostname === 'maps.googleapis.com') {
        return {
          ok: true,
          json: async () => ({
            status: 'OK',
            results: [{
              formatted_address: 'Denver, CO, USA',
              types: ['locality'],
              geometry: { location: { lat: 39.7392, lng: -104.9903 } },
            }],
          }),
        };
      }
      const rss = parsed.hostname === 'rss.cnn.com'
        ? '<rss><channel><item><title>Mass shooting reported in Denver, Colorado</title><link>https://cnn.com/example</link><pubDate>Fri, 04 Sep 2026 08:15:00 GMT</pubDate></item></channel></rss>'
        : '<rss><channel></channel></rss>';
      return { ok: true, status: 200, text: async () => rss };
    },
  });
  plugin.configureServer({ middlewares: { use(_path, fn) { handler = fn; } } });
  const response = responseRecorder();
  await handler({ method: 'GET' }, response);
  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(gdeltCalls, 2);
  assert.equal(payload.reports.length, 1);
  assert.deepEqual(payload.sources.cnn.channels, ['RSS']);
  assert.equal(payload.reports[0].source, 'CNN');
});
