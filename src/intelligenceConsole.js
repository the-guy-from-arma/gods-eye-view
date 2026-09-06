const QUERY_MODULES = new Set(['dns','whois','certificates','cve','github','shodan','ip-intel','bgp','mac','breaches','username','infostealer','wallet-intel','phone']);
const FEED_MODULES = new Set(['severe-weather','space-weather','cyber-threats','malware-live','internet-outages','market-watch','air-quality']);
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
    const row = document.createElement('div'); row.className = 'provider-row';
    row.append(text('span', id.replaceAll('-',' ').toUpperCase()), text('b', data?.error ? 'DEGRADED' : data?.configured === false ? 'NOT CONFIGURED' : 'CONNECTED'));
    return row;
  });
  host.replaceChildren(...(rows.length ? rows : [text('p','No provider health returned.') ]));
}

function countRecord(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return value ? 1 : 0;
  return Object.values(value).reduce((best, item) => Math.max(best, Array.isArray(item) ? item.length : 0), 0);
}

function renderOverview(payload) {
  const cards = Object.entries(payload.feeds || {}).map(([id, data]) => {
    const card = document.createElement('article'); card.className = 'overview-card';
    const header = document.createElement('header'); header.append(text('span', id.replaceAll('-',' ').toUpperCase()), text('span', data.error ? 'DEGRADED' : 'LIVE'));
    const source = data.source || data.message || (data.error ? 'Provider unavailable' : 'Connected source');
    card.append(header, text('b', String(countRecord(data))), text('p', source));
    return card;
  });
  overviewGrid.replaceChildren(...cards);
  providerSummary(payload.feeds);
  q('[data-last-sync]').textContent = new Date(payload.generatedAt).toLocaleTimeString();
}

function resetWorkspace() {
  queryForm.hidden = true; resultView.hidden = true; overviewGrid.hidden = true; notice.hidden = true; assetPanel.hidden = true;
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
    resultView.hidden = false; resultView.textContent = 'Synchronizing provider…';
    try { const payload = await api(`/api/intelligence/feed/${encodeURIComponent(module.id)}`); resultView.textContent = pretty(payload); q('[data-workspace-state]').textContent = payload.configured === false ? 'NOT CONFIGURED' : 'LIVE'; }
    catch (error) { resultView.textContent = error.message; q('[data-workspace-state]').textContent = 'DEGRADED'; }
    return;
  }
  notice.hidden = false;
  notice.textContent = `${module.name} is managed through the connected God’s Eye operations map or a provider-specific workspace. Its access state and auditing are active here; source ingestion will only run when the authorized provider is configured.`;
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
