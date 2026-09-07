const QUERY_MODULES = new Set(['dns','whois','certificates','cve','github','shodan','ip-intel','bgp','mac','breaches','username','infostealer','wallet-intel','phone']);
const FEED_MODULES = new Set(['space-weather','cyber-threats','malware-live','internet-outages','market-watch','air-quality']);
const SCAN_TYPES = new Map([['security-headers','headers'],['ssl','ssl'],['tech-detect','tech'],['subdomains','subdomains'],['port-scan','quick'],['vulnerability-scan','vuln'],['ip-sweep','quick']]);
const PLACEHOLDERS = { dns:'example.com', whois:'example.com', certificates:'example.com', cve:'CVE-2024-0001', github:'username', shodan:'8.8.8.8', 'ip-intel':'8.8.8.8', bgp:'AS13335 or IP address', mac:'00:00:5E:00:53:AF', breaches:'your signed-in email', username:'public username', infostealer:'email, username, or domain', 'wallet-intel':'public BTC or ETH address', phone:'+15551234567' };

const q = (selector) => document.querySelector(selector);
const shell = q('[data-intel-shell]');
const gate = q('[data-intel-gate]');
const nav = q('[data-module-nav]');
const queryForm = q('[data-query-form]');
const queryInput = q('[data-query-input]');
const resultView = q('[data-result-view]');
const overviewGrid = q('[data-overview-grid]');
const feedView = q('[data-feed-view]');
const feedMetrics = q('[data-feed-metrics]');
const feedRecords = q('[data-feed-records]');
const notice = q('[data-module-notice]');
const assetPanel = q('[data-asset-panel]');
let catalog = [];
let user = null;
let activeModule = null;
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type':'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const host = q('[data-intel-toast]');
  host.textContent = message;
  host.classList.toggle('error', error);
  host.classList.add('visible');
  toastTimer = setTimeout(() => host.classList.remove('visible'), 4200);
}

function pretty(value) { return JSON.stringify(value, null, 2); }
function text(tag, value, className = '') { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }

function renderNav(filter = '') {
  const term = filter.trim().toLowerCase();
  const nodes = [];
  let group = '';
  for (const module of catalog.filter((item) => !term || `${item.name} ${item.group} ${item.description}`.toLowerCase().includes(term))) {
    if (module.group !== group) { group = module.group; nodes.push(text('div', group.toUpperCase(), 'module-group')); }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'module-button'; button.dataset.moduleId = module.id;
    button.dataset.status = module.allowed ? 'live' : (module.status === 'live' ? 'locked' : module.status);
    button.append(text('strong', module.name), text('small', module.description), text('i', module.allowed ? module.access.toUpperCase() : module.status === 'live' ? `LOCK · ${module.access.toUpperCase()}` : module.status.replace('_',' ').toUpperCase()));
    if (activeModule?.id === module.id) button.classList.add('active');
    nodes.push(button);
  }
  nav.replaceChildren(...nodes);
}

function providerSummary(feeds = {}) {
  const host = q('[data-provider-status]');
  const rows = Object.entries(feeds).map(([id, data]) => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'provider-row'; row.dataset.moduleId = id;
    row.append(text('span', id.replaceAll('-',' ').toUpperCase()), text('b', data?.error ? 'DEGRADED' : data?.degraded ? 'PARTIAL' : data?.configured === false ? 'NOT CONFIGURED' : 'CONNECTED'));
    return row;
  });
  host.replaceChildren(...(rows.length ? rows : [text('p','No provider health returned.') ]));
}

function countRecord(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return value ? 1 : 0;
  return Object.values(value).reduce((best, item) => Math.max(best, Array.isArray(item) ? item.length : 0), 0);
}

function safeText(value, fallback = '—', max = 360) {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
}

function numberText(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function dateText(value) {
  if (!value) return 'TIME NOT REPORTED';
  const number = Number(value);
  const date = new Date(Number.isFinite(number) && number > 10_000_000_000 ? number : Number.isFinite(number) && number > 1_000_000_000 ? number * 1000 : value);
  return Number.isNaN(date.getTime()) ? safeText(value, 'TIME NOT REPORTED', 80) : date.toLocaleString();
}

function firstValue(record, keys, fallback = '') {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return fallback;
}

function metricNode(label, value, detail = '') {
  const node = document.createElement('article');
  node.className = 'feed-metric';
  node.append(text('small', label), text('strong', safeText(value)));
  if (detail) node.append(text('span', detail));
  return node;
}

function recordNode({ eyebrow = 'OBSERVATION', title = 'Untitled record', detail = '', meta = [], tags = [], href = '' }) {
  const node = document.createElement('article');
  node.className = 'feed-record';
  const head = document.createElement('header');
  const titleBlock = document.createElement('div');
  titleBlock.append(text('small', safeText(eyebrow, 'OBSERVATION', 100)), text('strong', safeText(title, 'Untitled record', 220)));
  head.append(titleBlock);
  if (href) {
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'SOURCE ↗';
    head.append(link);
  }
  node.append(head);
  if (detail) node.append(text('p', safeText(detail, '', 620)));
  const footer = document.createElement('footer');
  for (const item of meta.filter(Boolean).slice(0, 4)) footer.append(text('span', safeText(item, '', 120)));
  for (const tag of tags.filter(Boolean).slice(0, 3)) footer.append(text('b', safeText(tag, '', 80)));
  if (footer.childNodes.length) node.append(footer);
  return node;
}

function genericRecords(payload) {
  const collection = Object.values(payload || {}).find((value) => Array.isArray(value)) || [];
  return collection.slice(0, 50).map((record, index) => {
    if (!record || typeof record !== 'object') return recordNode({ title: safeText(record, `Record ${index + 1}`) });
    const scalar = Object.entries(record).filter(([, value]) => ['string','number','boolean'].includes(typeof value));
    return recordNode({
      eyebrow: safeText(firstValue(record, ['type','category','status'], `RECORD ${index + 1}`)),
      title: safeText(firstValue(record, ['name','title','event','id'], `Record ${index + 1}`)),
      detail: scalar.slice(0, 4).map(([key, value]) => `${key.replaceAll('_',' ')}: ${safeText(value, '', 120)}`).join(' · '),
    });
  });
}

function buildFeedPresentation(module, payload) {
  const metrics = [];
  let records = [];
  if (module.id === 'space-weather') {
    const kp = Array.isArray(payload.kp) ? payload.kp : [];
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    const flares = Array.isArray(payload.flares) ? payload.flares : [];
    const latest = kp.at(-1) || {};
    metrics.push(
      metricNode('PLANETARY Kp', numberText(firstValue(latest, ['kp_index','estimated_kp','kp','Kp']), 2), 'LATEST GEOMAGNETIC INDEX'),
      metricNode('ACTIVE BULLETINS', alerts.length, 'NOAA SWPC'),
      metricNode('RECENT FLARES', flares.length, 'LATEST REPORTED WINDOW'),
    );
    records = [
      ...alerts.slice(0, 20).map((item) => recordNode({
        eyebrow: 'SWPC BULLETIN',
        title: firstValue(item, ['product_id','message','summary'], 'Space-weather alert'),
        detail: firstValue(item, ['message','description','summary']),
        meta: [dateText(firstValue(item, ['issue_datetime','issue_time','time_tag']))],
        href: 'https://www.swpc.noaa.gov/products/alerts-watches-and-warnings',
      })),
      ...flares.slice(0, 20).map((item) => recordNode({
        eyebrow: 'SOLAR FLARE',
        title: `CLASS ${safeText(firstValue(item, ['max_class','class_type','current_class']), 'UNRATED')}`,
        detail: firstValue(item, ['satellite','observatory'], 'GOES primary X-ray observation'),
        meta: [dateText(firstValue(item, ['max_time','begin_time','time_tag']))],
        href: 'https://www.swpc.noaa.gov/products/goes-x-ray-flux',
      })),
    ];
  } else if (module.id === 'cyber-threats') {
    const vulnerabilities = Array.isArray(payload.vulnerabilities) ? payload.vulnerabilities : [];
    const ransomware = vulnerabilities.filter((item) => String(item.knownRansomwareCampaignUse || '').toLowerCase() === 'known').length;
    metrics.push(
      metricNode('KNOWN EXPLOITED', vulnerabilities.length, 'LATEST CATALOG WINDOW'),
      metricNode('RANSOMWARE LINKED', ransomware, 'CISA CONFIRMED KNOWN USE'),
      metricNode('CATALOG', payload.catalogVersion || 'CURRENT', 'CISA KEV RELEASE'),
    );
    records = vulnerabilities.map((item) => {
      const cve = safeText(item.cveID, 'CVE NOT REPORTED', 40);
      return recordNode({
        eyebrow: cve,
        title: `${safeText(item.vendorProject, 'UNKNOWN VENDOR', 80)} · ${safeText(item.product, 'UNKNOWN PRODUCT', 100)}`,
        detail: firstValue(item, ['shortDescription','vulnerabilityName']),
        meta: [`ADDED ${safeText(item.dateAdded)}`, `ACTION DUE ${safeText(item.dueDate)}`],
        tags: [item.knownRansomwareCampaignUse === 'Known' ? 'KNOWN RANSOMWARE USE' : '', item.requiredAction ? 'REMEDIATION REQUIRED' : ''],
        href: /^CVE-\d{4}-\d+$/i.test(cve) ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}` : 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      });
    });
  } else if (module.id === 'internet-outages') {
    const events = Array.isArray(payload.events) ? payload.events : [];
    const countries = new Set(events.map((item) => safeText(firstValue(item, ['entityCode','countryCode'], item.entity?.code), '', 20)).filter(Boolean));
    const ongoing = events.filter((item) => !firstValue(item, ['end','endTime','end_time'])).length;
    metrics.push(
      metricNode('OUTAGE EVENTS', events.length, 'LAST 24 HOURS'),
      metricNode('ONGOING', ongoing, 'NO END TIME REPORTED'),
      metricNode('JURISDICTIONS', countries.size || '—', 'DISTINCT COUNTRY CODES'),
    );
    records = events.slice(0, 50).map((item, index) => recordNode({
      eyebrow: safeText(firstValue(item, ['entityCode','countryCode','datasource'], item.entity?.code || `EVENT ${index + 1}`)),
      title: safeText(firstValue(item, ['entityName','name'], item.entity?.name || 'Network disruption event')),
      detail: `Observed disruption signal${firstValue(item, ['score','severity','level']) !== '' ? ` · magnitude ${safeText(firstValue(item, ['score','severity','level']))}` : ''}.`,
      meta: [dateText(firstValue(item, ['start','startTime','start_time','timestamp'])), firstValue(item, ['datasource','source'])],
      href: 'https://ioda.inetintel.cc.gatech.edu/',
    }));
  } else if (module.id === 'market-watch') {
    const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
    const snapshots = quotes.map((quote) => {
      const meta = quote.meta || {};
      const rawPrice = firstValue(meta, ['regularMarketPrice'], quote.indicators?.quote?.[0]?.close?.at(-1) ?? null);
      const rawPrevious = firstValue(meta, ['chartPreviousClose','previousClose'], null);
      const price = rawPrice === null ? null : Number(rawPrice);
      const previous = rawPrevious === null ? null : Number(rawPrevious);
      const change = Number.isFinite(price) && Number.isFinite(previous) && previous !== 0 ? ((price - previous) / previous) * 100 : null;
      return { quote, meta, price, change };
    });
    metrics.push(
      metricNode('INSTRUMENTS', snapshots.length, 'LIVE REFERENCE BOARD'),
      metricNode('ADVANCING', snapshots.filter(({ change }) => change > 0).length, 'VERSUS PREVIOUS CLOSE'),
      metricNode('DECLINING', snapshots.filter(({ change }) => change < 0).length, 'VERSUS PREVIOUS CLOSE'),
    );
    records = snapshots.map(({ meta, price, change }) => recordNode({
      eyebrow: safeText(meta.symbol, 'MARKET'),
      title: safeText(meta.longName || meta.shortName || meta.symbol, 'Market instrument'),
      detail: `${numberText(price, 4)} ${safeText(meta.currency, '', 12)}${change === null ? '' : ` · ${change >= 0 ? '+' : ''}${numberText(change, 2)}%`}`,
      meta: [safeText(meta.exchangeName || meta.fullExchangeName), dateText(meta.regularMarketTime)],
      tags: [change === null ? 'REFERENCE' : change >= 0 ? 'ADVANCING' : 'DECLINING'],
      href: meta.symbol ? `https://finance.yahoo.com/quote/${encodeURIComponent(meta.symbol)}` : 'https://finance.yahoo.com/',
    }));
  } else {
    records = genericRecords(payload);
    metrics.push(metricNode('RECORDS', countRecord(payload), 'CURRENT PROVIDER RESPONSE'));
  }
  return { metrics, records };
}

function renderFeed(module, payload) {
  const presentation = buildFeedPresentation(module, payload);
  q('[data-feed-source]').textContent = safeText(payload.source || payload.message, 'PROVIDER NOT REPORTED', 160).toUpperCase();
  q('[data-feed-time]').textContent = `SYNC ${new Date().toLocaleTimeString()}`;
  feedMetrics.replaceChildren(...presentation.metrics);
  feedRecords.replaceChildren(...(presentation.records.length
    ? presentation.records
    : [text('div', payload.configured === false ? safeText(payload.message, 'Provider not configured.') : 'No current records were returned by this provider.', 'feed-empty')]));
  feedView.hidden = false;
}

function renderOverview(payload) {
  const cards = Object.entries(payload.feeds || {}).map(([id, data]) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'overview-card'; card.dataset.moduleId = id;
    card.setAttribute('aria-label', `Open ${id.replaceAll('-',' ')} intelligence feed`);
    const header = document.createElement('span'); header.className = 'overview-card-head'; header.append(text('span', id.replaceAll('-',' ').toUpperCase()), text('span', data.error ? 'DEGRADED' : data.degraded ? 'PARTIAL' : 'LIVE'));
    const source = data.source || data.message || (data.error ? 'Provider unavailable' : 'Connected source');
    card.append(header, text('b', String(countRecord(data))), text('p', source), text('span', 'OPEN CHANNEL →', 'overview-card-open'));
    return card;
  });
  overviewGrid.replaceChildren(...cards);
  providerSummary(payload.feeds);
  q('[data-last-sync]').textContent = new Date(payload.generatedAt).toLocaleTimeString();
}

function resetWorkspace() {
  queryForm.hidden = true; resultView.hidden = true; overviewGrid.hidden = true; feedView.hidden = true; notice.hidden = true; assetPanel.hidden = true;
  resultView.textContent = ''; notice.textContent = '';
}

async function loadOverview() {
  q('[data-workspace-state]').textContent = 'SYNCING';
  try { const payload = await api('/api/intelligence/overview'); renderOverview(payload); q('[data-workspace-state]').textContent = 'LIVE'; }
  catch (error) { notice.hidden = false; notice.textContent = error.message; q('[data-workspace-state]').textContent = 'DEGRADED'; }
}

async function loadTargets() {
  const host = q('[data-targets]');
  try {
    const { targets } = await api('/api/intelligence/targets');
    host.replaceChildren(...targets.map((target) => {
      const row = document.createElement('div'); row.className = 'target-row';
      row.append(text('strong', target.target), text('small', target.status.toUpperCase()));
      if (target.token) row.append(text('code', target.token));
      if (target.status !== 'verified') { const button = text('button','VERIFY DNS'); button.type='button'; button.dataset.verifyTarget=target.target; row.append(button); }
      return row;
    }));
    if (!targets.length) host.append(text('div','No controlled assets registered.','module-notice'));
  } catch (error) { host.replaceChildren(text('div',error.message,'module-notice')); }
}

async function selectModule(moduleId) {
  const module = catalog.find((item) => item.id === moduleId);
  if (!module) return;
  activeModule = module; renderNav(q('[data-module-search]').value); resetWorkspace();
  q('[data-module-title]').textContent = module.name; q('[data-module-description]').textContent = module.description;
  q('[data-workspace-title]').textContent = module.name; q('[data-workspace-state]').textContent = module.allowed ? 'READY' : 'CONTROLLED';
  if (!module.allowed) { notice.hidden = false; notice.textContent = module.status !== 'live' ? `The owner has set this module to ${module.status.replace('_',' ')}.` : `${module.access.toUpperCase()} access is required for this module.`; return; }
  if (module.id === 'overview') { overviewGrid.hidden = false; await loadOverview(); return; }
  if (QUERY_MODULES.has(module.id) || SCAN_TYPES.has(module.id)) {
    queryForm.hidden = false; queryInput.value = ''; queryInput.placeholder = SCAN_TYPES.has(module.id) ? 'verified-domain.example' : (PLACEHOLDERS[module.id] || 'Enter query');
    q('[data-query-label]').firstChild.textContent = SCAN_TYPES.has(module.id) ? 'VERIFIED ASSET ' : 'PASSIVE QUERY ';
    queryForm.querySelector('button').textContent = SCAN_TYPES.has(module.id) ? 'RUN AUTHORIZED CHECK' : 'RUN PASSIVE QUERY';
    if (SCAN_TYPES.has(module.id)) { assetPanel.hidden = false; await loadTargets(); }
    queryInput.focus(); return;
  }
  if (FEED_MODULES.has(module.id)) {
    feedView.hidden = false;
    feedMetrics.replaceChildren(metricNode('CHANNEL', 'SYNCHRONIZING', 'REQUESTING CURRENT PROVIDER STATE'));
    feedRecords.replaceChildren();
    try { const payload = await api(`/api/intelligence/feed/${encodeURIComponent(module.id)}`); renderFeed(module, payload); q('[data-workspace-state]').textContent = payload.configured === false ? 'NOT CONFIGURED' : 'LIVE'; }
    catch (error) { feedMetrics.replaceChildren(metricNode('CHANNEL', 'DEGRADED', error.message)); feedRecords.replaceChildren(); q('[data-workspace-state]').textContent = 'DEGRADED'; }
    return;
  }
  notice.hidden = false;
  notice.textContent = module.id === 'severe-weather'
    ? 'Weather is rendered geospatially. Open the God’s Eye operations map and enable Live Weather Radar, Active Weather Warnings, and Live Global Events in Data Layers.'
    : `${module.name} is managed through the connected God’s Eye operations map or a provider-specific workspace. Its access state and auditing are active here; source ingestion will only run when the authorized provider is configured.`;
}

queryForm.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!activeModule) return;
  const query = queryInput.value.trim(); if (!query) return;
  resultView.hidden = false; resultView.textContent = 'Requesting source…'; q('[data-workspace-state]').textContent = 'RUNNING';
  try {
    const payload = SCAN_TYPES.has(activeModule.id)
      ? await api('/api/intelligence/scan', { method:'POST', body:JSON.stringify({ target:query, scanType:SCAN_TYPES.get(activeModule.id) }) })
      : await api(`/api/intelligence/query?module=${encodeURIComponent(activeModule.id)}&q=${encodeURIComponent(query)}`);
    resultView.textContent = pretty(payload); q('[data-workspace-state]').textContent = 'COMPLETE'; q('[data-last-sync]').textContent = new Date().toLocaleTimeString();
  } catch (error) { resultView.textContent = error.message; q('[data-workspace-state]').textContent = 'BLOCKED'; toast(error.message,true); }
});

q('[data-target-form]').addEventListener('submit', async (event) => {
  event.preventDefault(); const input = event.currentTarget.elements.target;
  try { const payload = await api('/api/intelligence/targets',{method:'POST',body:JSON.stringify({target:input.value})}); input.value=''; toast(payload.instructions); await loadTargets(); }
  catch (error) { toast(error.message,true); }
});

q('[data-targets]').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-verify-target]'); if (!button) return;
  try { await api('/api/intelligence/targets/verify',{method:'POST',body:JSON.stringify({target:button.dataset.verifyTarget})}); toast('ASSET OWNERSHIP VERIFIED'); await loadTargets(); }
  catch (error) { toast(error.message,true); }
});

nav.addEventListener('click',(event)=>{ const button=event.target.closest('[data-module-id]'); if(button) void selectModule(button.dataset.moduleId); });
overviewGrid.addEventListener('click',(event)=>{ const button=event.target.closest('[data-module-id]'); if(button) void selectModule(button.dataset.moduleId); });
q('[data-provider-status]').addEventListener('click',(event)=>{ const button=event.target.closest('[data-module-id]'); if(button) void selectModule(button.dataset.moduleId); });
q('[data-feed-back]').addEventListener('click',()=>void selectModule('overview'));
q('[data-feed-refresh]').addEventListener('click',()=>{ if(activeModule && FEED_MODULES.has(activeModule.id)) void selectModule(activeModule.id); });
q('[data-module-search]').addEventListener('input',(event)=>renderNav(event.currentTarget.value));
q('[data-intel-logout]').addEventListener('click',async()=>{ try{await api('/api/account/logout',{method:'POST',body:'{}'});}finally{location.assign('/');} });

async function start() {
  try {
    const payload = await api('/api/intelligence/catalog'); user = payload.user; catalog = payload.modules;
    gate.hidden = true; shell.hidden = false;
    q('[data-intel-email]').textContent = user.email; q('[data-intel-access]').textContent = user.access.toUpperCase(); q('[data-hero-access]').textContent = user.access.toUpperCase();
    q('[data-context-account]').textContent = user.role.toUpperCase(); q('[data-context-identity]').textContent = String(user.verificationStatus || 'unverified').toUpperCase(); q('[data-context-access]').textContent = user.access.toUpperCase();
    q('[data-module-count]').textContent = String(catalog.filter((item)=>item.allowed).length); q('[data-owner-link]').hidden = user.role !== 'owner';
    renderNav(); await selectModule('overview');
    fetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'page_view',metadata:{path:location.pathname}})}).catch(()=>{});
  } catch (error) { q('[data-gate-message]').textContent = error.message; }
}

setInterval(()=>{ q('[data-intel-clock]').textContent=`${new Date().toISOString().slice(11,19)} UTC`; },1000);
void start();
