import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/account/session') {
      request.respond({ contentType: 'application/json', body: JSON.stringify({ user: { email: 'owner@thunderlink.local', role: 'owner' } }) });
      return;
    }
    if (path === '/api/account/admin') {
      request.respond({
        contentType: 'application/json',
        body: JSON.stringify({
          accounts: [
            { id: '1', email: 'operator@thunderlink.local', status: 'approved', locked: false, createdAt: new Date().toISOString() },
            { id: '2', email: 'review@thunderlink.local', status: 'pending', locked: false, createdAt: new Date().toISOString() },
          ],
          layers: [
            { id: 'interface-display', name: 'Display Controls', group: 'Interface Modules', status: 'live' },
            { id: 'interface-cctv', name: 'CCTV Controls', group: 'Interface Modules', status: 'coming_soon' },
            { id: 'interface-context', name: 'Context Controls', group: 'Interface Modules', status: 'maintenance' },
            { id: 'flights', name: 'Live Flights', group: 'Data & Tools', status: 'live' },
          ],
          autopilot: false,
          siteMode: { mode: 'online', label: 'Systems Online', message: 'Satellite link established. Public command access is available.' },
        }),
      });
      return;
    }
    if (path === '/api/cctv/sources') {
      request.respond({
        contentType: 'application/json',
        body: JSON.stringify({ sources: [{
          id: 'qa-camera-1', name: 'I-90 QA CAMERA', provider: 'QA 511', stateCode: 'NY', city: 'Albany',
          frameUrl: '/api/cctv/frame/qa-camera-1',
        }] }),
      });
      return;
    }
    if (path === '/api/account/admin/vehicle-analytics') {
      request.respond({
        contentType: 'application/json',
        body: JSON.stringify({
          configured: true,
          enabled: true,
          model: 'qa-vehicle-model',
          retentionDays: 90,
          totals: { total: 126, cameras: 18 },
          observations: [],
          aggregateFlow: {
            windowHours: 24, retentionDays: 30, bucketMinutes: 15, identityLinks: false,
            cameras: 2, detections: 47, lastBucketAt: new Date().toISOString(),
            buckets: [
              { bucketStart: new Date().toISOString(), cameraId: 'qa-camera-1', jurisdiction: 'Albany, NY', vehicleType: 'sedan', detections: 31 },
              { bucketStart: new Date().toISOString(), cameraId: 'qa-camera-1', jurisdiction: 'Albany, NY', vehicleType: 'pickup', detections: 16 },
            ],
          },
          protectedArchive: { configured: false, enabled: false, retentionDays: 7, frames: [] },
        }),
      });
      return;
    }
    if (path === '/api/account/activity') {
      request.respond({ contentType: 'application/json', body: JSON.stringify({ events: [] }) });
      return;
    }
    request.continue();
  });
  await page.goto(process.env.OWNER_QA_URL || 'http://127.0.0.1:4173/owner.html', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !document.body.classList.contains('owner-loading'));
  await page.screenshot({ path: 'qa-owner-dashboard.png', fullPage: true });
} finally {
  await browser.close();
}
