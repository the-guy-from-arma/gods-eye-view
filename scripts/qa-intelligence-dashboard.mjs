import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const baseUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4199';
const modules = [
  ['overview', 'Global Overview'],
  ['space-weather', 'Space Weather'],
  ['cyber-threats', 'Cyber Threats'],
  ['internet-outages', 'Internet Outages'],
  ['market-watch', 'Market Watch'],
].map(([id, name]) => ({ id, name, group: 'Operations', access: 'registered', description: `${name} live channel`, status: 'live', allowed: true }));

const overview = {
  generatedAt: new Date().toISOString(),
  feeds: {
    'space-weather': { kp: [{ kp_index: 4 }], alerts: [], flares: [], source: 'NOAA SWPC' },
    'cyber-threats': { catalogVersion: 'qa', vulnerabilities: [{ cveID: 'CVE-2026-1234' }], source: 'CISA KEV' },
    'internet-outages': { events: [{ entityCode: 'US', entityName: 'QA Network' }], source: 'Georgia Tech IODA' },
    'market-watch': { quotes: [{ meta: { symbol: 'QA', regularMarketPrice: 100 } }], source: 'Yahoo Finance public chart endpoint' },
  },
};

const cyberFeed = {
  feedId: 'cyber-threats',
  catalogVersion: 'qa',
  source: 'CISA KEV',
  vulnerabilities: [{
    cveID: 'CVE-2026-1234',
    vendorProject: 'ThunderLink QA',
    product: 'Interaction Contract',
    vulnerabilityName: 'Clickable channel fixture',
    shortDescription: 'Deterministic browser verification record.',
    dateAdded: '2026-09-07',
    dueDate: '2026-09-08',
    knownRansomwareCampaignUse: 'Unknown',
    requiredAction: 'Verify the interface.',
  }],
};

const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate));
const browser = await puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    let payload = null;
    if (url.pathname === '/api/intelligence/catalog') payload = { user: { email: 'owner@example.com', role: 'owner', access: 'owner', verificationStatus: 'verified' }, modules };
    else if (url.pathname === '/api/intelligence/overview') payload = overview;
    else if (url.pathname === '/api/intelligence/feed/cyber-threats') payload = cyberFeed;
    else if (url.pathname === '/api/activity') payload = { ok: true };
    if (payload) {
      request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      return;
    }
    request.continue();
  });

  await page.goto(`${baseUrl}/intelligence.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-intel-shell]:not([hidden])');
  assert.equal(await page.$eval('[data-intel-gate]', (node) => getComputedStyle(node).display), 'none');
  assert.equal(await page.$$eval('.overview-card[data-module-id]', (nodes) => nodes.length), 4);
  assert.equal(await page.$$eval('.fusion-node[data-module-id]', (nodes) => nodes.length), 4);
  assert.equal(await page.$eval('[data-fusion-total]', (node) => node.textContent), '4');
  assert.match(await page.$eval('[data-fusion-state]', (node) => node.textContent), /ALL CHANNELS LIVE/);

  await page.click('.fusion-node[data-module-id="cyber-threats"]');
  await page.waitForFunction(() => document.querySelector('[data-feed-view]')?.hidden === false);
  await page.waitForFunction(() => document.querySelector('[data-feed-records]')?.textContent.includes('CVE-2026-1234'));
  assert.match(await page.$eval('[data-feed-view]', (node) => node.textContent), /KNOWN EXPLOITED[\s\S]*CVE-2026-1234[\s\S]*SOURCE/);
  console.log('Intelligence dashboard interaction QA passed.');
} finally {
  await browser.close();
}
