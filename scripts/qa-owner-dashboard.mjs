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
