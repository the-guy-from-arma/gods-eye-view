import { createHash } from 'node:crypto';
import { normalizeGoogleGeocodeResult } from './locationSearchApi.js';

const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const CACHE_MS = 15 * 60_000;
const STALE_MS = 6 * 60 * 60_000;
const GEOCODE_CACHE_MS = 6 * 60 * 60_000;
const MAX_REPORTS = 18;
const GDELT_MIN_INTERVAL_MS = 5_200;
const INCIDENT_QUERY = '("mass shooting" OR "active shooter" OR "school shooting" OR "mass casualty")';
const PUBLISHER_QUERY = '(domain:cnn.com OR domain:foxnews.com OR domain:abcnews.go.com)';

export const NEWS_SOURCES = Object.freeze([
  Object.freeze({ id: 'cnn', name: 'CNN', domain: 'cnn.com', domains: ['cnn.com'], rssUrl: 'http://rss.cnn.com/rss/cnn_latest.rss' }),
  Object.freeze({ id: 'fox-news', name: 'FOX NEWS', domain: 'foxnews.com', domains: ['foxnews.com'], rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml' }),
  Object.freeze({ id: 'abc-news', name: 'ABC NEWS', domain: 'abcnews.go.com', domains: ['abcnews.go.com', 'abcnews.com'], rssUrl: 'https://abcnews.go.com/abcnews/topstories' }),
]);

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function domainMatches(value, expected) {
  const domain = cleanText(value, 160).toLowerCase().replace(/^www\./, '');
  return domain === expected || domain.endsWith(`.${expected}`);
}

function sourceDomainMatches(value, source) {
  const domains = Array.isArray(source?.domains) && source.domains.length ? source.domains : [source?.domain];
  return domains.filter(Boolean).some((domain) => domainMatches(value, domain));
}

function incidentTitleMatches(value) {
  return /\b(?:mass shooting|active shooter|school shooting|mass casualty|multiple (?:people|victims) shot)\b/i.test(value);
}

function decodeXmlText(value) {
  return String(value ?? '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Math.min(0x10ffff, Number(number))))
    .replace(/&#x([0-9a-f]+);/gi, (_match, number) => String.fromCodePoint(Math.min(0x10ffff, Number.parseInt(number, 16))))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function rssTag(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return match ? cleanText(decodeXmlText(match[1]), 500) : '';
}

export function normalizePublisherRss(xml, source) {
  const reports = [];
  const items = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, 100)) {
    const title = cleanText(rssTag(item, 'title'), 300);
    const url = safeHttpUrl(rssTag(item, 'link'));
    if (!title || !url || !incidentTitleMatches(title) || !sourceDomainMatches(new URL(url).hostname, source)) continue;
    const locationHint = extractNewsLocationHint(title);
    if (!locationHint) continue;
    const parsedDate = new Date(rssTag(item, 'pubDate'));
    reports.push({
      title,
      url,
      domain: new URL(url).hostname.toLowerCase().replace(/^www\./, ''),
      source: source.name,
      sourceId: source.id,
      sourceCountry: null,
      language: 'English',
      reportedAt: Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      category: incidentCategory(title),
      locationHint,
    });
  }
  return reports;
}

export function parseGdeltDate(value) {
  const text = cleanText(value, 32);
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function incidentCategory(title) {
  const value = title.toLowerCase();
  if (value.includes('active shooter')) return 'Active shooter report';
  if (value.includes('school shooting')) return 'School shooting report';
  if (value.includes('mass shooting')) return 'Mass shooting report';
  return 'Mass-casualty report';
}

export function extractNewsLocationHint(value) {
  const title = cleanText(value, 300);
  const afterPreposition = /\b(?:in|near|outside|at)\s+([^|:;–—]{2,90}?)(?=,\s*(?:police|officials|authorities|deputies|sheriff|reports?|sources?|witnesses)\b|\s+(?:after|as|during|where|when|leaves?|kills?|injures?|sends?)\b|[|:;–—]|$)/i.exec(title);
  if (afterPreposition) {
    const hint = cleanText(afterPreposition[1].replace(/^(?:a|an|the)\s+/i, ''), 100);
    if (hint && !/^(?:mass|school|active) shoot/i.test(hint)) return hint;
  }
  const cityRegion = /\b([A-Z][A-Za-z.'’ -]{1,45},\s*(?:[A-Z]{2}|[A-Z][A-Za-z.'’ -]{2,30}))\b/.exec(title);
  if (cityRegion) return cleanText(cityRegion[1], 100);
  const leading = /^([^:]{2,60}):/.exec(title);
  if (leading && !/\b(?:breaking|update|video|live|watch)\b/i.test(leading[1])) return cleanText(leading[1], 100);
  const beforeIncident = /^([A-Z][A-Za-z.'’ -]{2,55})\s+(?:mass|school) shooting\b/.exec(title);
  return beforeIncident ? cleanText(beforeIncident[1], 100) : null;
}

export function normalizeGdeltArticles(payload, source) {
  const rows = Array.isArray(payload?.articles) ? payload.articles : [];
  const reports = [];
  for (const article of rows.slice(0, 50)) {
    const title = cleanText(article?.title, 300);
    const url = safeHttpUrl(article?.url);
    const domain = cleanText(article?.domain, 160).toLowerCase().replace(/^www\./, '');
    if (!title || !url || !sourceDomainMatches(domain, source)) continue;
    const locationHint = extractNewsLocationHint(title);
    if (!locationHint) continue;
    reports.push({
      title,
      url,
      domain,
      source: source.name,
      sourceId: source.id,
      sourceCountry: cleanText(article?.sourcecountry, 80) || null,
      language: cleanText(article?.language, 40) || null,
      reportedAt: parseGdeltDate(article?.seendate),
      category: incidentCategory(title),
      locationHint,
    });
  }
  return reports;
}

function locationPrecision(types) {
  const values = new Set(Array.isArray(types) ? types : []);
  if (values.has('country')) return 'country';
  if (values.has('administrative_area_level_1')) return 'region';
  if (values.has('locality') || values.has('postal_town')) return 'city';
  if (values.has('neighborhood') || values.has('administrative_area_level_2')) return 'local area';
  return 'place';
}

function respond(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'private, max-age=120' : 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

export function newsEventsApiPlugin(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const gdeltMinIntervalMs = Number.isFinite(options.gdeltMinIntervalMs)
    ? Math.max(0, options.gdeltMinIntervalMs)
    : GDELT_MIN_INTERVAL_MS;
  let cache = null;
  let inFlight = null;
  let lastGdeltRequestAt = 0;
  const geocodeCache = new Map();

  const requestGdelt = async (url, retry = true) => {
    const waitMs = Math.max(0, gdeltMinIntervalMs - (Date.now() - lastGdeltRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastGdeltRequestAt = Date.now();
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ThunderLink-Gods-Eye/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429 && retry) return requestGdelt(url, false);
    return response;
  };

  const fetchNewsIndex = async () => {
    const url = new URL(GDELT_DOC_URL);
    url.search = new URLSearchParams({
      query: `${INCIDENT_QUERY} ${PUBLISHER_QUERY}`,
      mode: 'artlist',
      maxrecords: '75',
      format: 'json',
      timespan: '24h',
      sort: 'datedesc',
    }).toString();
    const response = await requestGdelt(url);
    if (!response.ok) throw new Error(`News index returned HTTP ${response.status}`);
    return response.json();
  };

  const fetchPublisherRss = async (source) => {
    const response = await fetchImpl(source.rssUrl, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'ThunderLink-Gods-Eye/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${source.name} RSS returned HTTP ${response.status}`);
    const xml = await response.text();
    if (xml.length > 2_000_000) throw new Error(`${source.name} RSS response was too large`);
    return normalizePublisherRss(xml, source);
  };

  const geocode = async (query, apiKey) => {
    const key = query.toLowerCase();
    const cached = geocodeCache.get(key);
    if (cached && Date.now() - cached.cachedAt < GEOCODE_CACHE_MS) return cached.value;
    const url = new URL(GOOGLE_GEOCODE_URL);
    url.search = new URLSearchParams({ address: query, key: apiKey }).toString();
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    const result = payload?.status === 'OK' && Array.isArray(payload?.results)
      ? normalizeGoogleGeocodeResult(payload.results[0])
      : null;
    if (!result) return null;
    const value = {
      latitude: result.geometry.location.lat,
      longitude: result.geometry.location.lng,
      location: result.formatted_address || query,
      locationPrecision: locationPrecision(result.types),
    };
    geocodeCache.set(key, { value, cachedAt: Date.now() });
    while (geocodeCache.size > 500) geocodeCache.delete(geocodeCache.keys().next().value);
    return value;
  };

  const refresh = async () => {
    const sourceStatus = {};
    const articles = [];
    const [gdeltResult, ...rssResults] = await Promise.allSettled([
      fetchNewsIndex(),
      ...NEWS_SOURCES.map(fetchPublisherRss),
    ]);
    let availableSources = 0;
    for (const [index, source] of NEWS_SOURCES.entries()) {
      const gdeltArticles = gdeltResult.status === 'fulfilled'
        ? normalizeGdeltArticles(gdeltResult.value, source)
        : [];
      const rssResult = rssResults[index];
      const rssArticles = rssResult?.status === 'fulfilled' ? rssResult.value : [];
      const sourceArticles = [...new Map([...gdeltArticles, ...rssArticles]
        .map((article) => [article.url, article])).values()];
      const ok = gdeltResult.status === 'fulfilled' || rssResult?.status === 'fulfilled';
      if (ok) availableSources += 1;
      sourceStatus[source.id] = {
        ok,
        count: sourceArticles.length,
        channels: [gdeltResult.status === 'fulfilled' ? 'GDELT' : null, rssResult?.status === 'fulfilled' ? 'RSS' : null].filter(Boolean),
        error: ok ? null : cleanText(rssResult?.reason?.message || gdeltResult.reason?.message || 'Unavailable', 160),
      };
      articles.push(...sourceArticles);
    }
    if (!availableSources) throw new Error('All publisher news feeds are unavailable');
    const unique = [...new Map(articles.map((article) => [article.url, article])).values()]
      .sort((a, b) => (Date.parse(b.reportedAt || '') || 0) - (Date.parse(a.reportedAt || '') || 0))
      .slice(0, MAX_REPORTS);
    const apiKey = cleanText(env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '', 500);
    const located = apiKey
      ? await Promise.all(unique.map(async (article) => ({ ...article, location: await geocode(article.locationHint, apiKey) })))
      : unique.map((article) => ({ ...article, location: null }));
    const reports = located.filter((article) => article.location).map((article) => Object.freeze({
      id: `news-${createHash('sha256').update(article.url).digest('hex').slice(0, 16)}`,
      title: article.title,
      url: article.url,
      source: article.source,
      sourceId: article.sourceId,
      category: article.category,
      reportedAt: article.reportedAt,
      location: article.location.location,
      locationPrecision: article.location.locationPrecision,
      latitude: article.location.latitude,
      longitude: article.location.longitude,
      verification: 'reported-unverified',
    }));
    cache = Object.freeze({
      reports,
      sourceStatus,
      indexedCount: unique.length,
      geolocatedCount: reports.length,
      geocodingConfigured: Boolean(apiKey),
      updatedAt: new Date().toISOString(),
      cachedAt: Date.now(),
    });
    return cache;
  };

  const getReports = async () => {
    if (cache && Date.now() - cache.cachedAt < CACHE_MS) return { ...cache, stale: false };
    if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
    try {
      return { ...(await inFlight), stale: false };
    } catch (error) {
      if (cache && Date.now() - cache.cachedAt < STALE_MS) return { ...cache, stale: true };
      throw error;
    }
  };

  const install = (middlewares) => {
    middlewares.use('/api/news-events', async (req, res) => {
      if (req.method !== 'GET') return respond(res, 405, { error: 'Method not allowed' });
      try {
        const result = await getReports();
        return respond(res, 200, {
          reports: result.reports,
          sources: result.sourceStatus,
          indexedCount: result.indexedCount,
          geolocatedCount: result.geolocatedCount,
          geocodingConfigured: result.geocodingConfigured,
          updatedAt: result.updatedAt,
          stale: result.stale,
          disclaimer: 'Automated map of publisher reports. Locations are approximate; reports are not independently verified.',
        });
      } catch (error) {
        return respond(res, 502, { error: cleanText(error?.message || 'News reports are temporarily unavailable', 200) });
      }
    });
  };

  return {
    name: 'global-news-events-proxy',
    configureServer(server) { install(server.middlewares); },
    configurePreviewServer(server) { install(server.middlewares); },
  };
}
