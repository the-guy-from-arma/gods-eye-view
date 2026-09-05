async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const statusNode = document.querySelector('[data-owner-status]');
const accountsHost = document.querySelector('[data-owner-accounts]');
const layersHost = document.querySelector('[data-owner-layers]');
const activityHost = document.querySelector('[data-owner-activity]');
const modeControls = document.querySelector('[data-mode-controls]');
const confirmBar = document.querySelector('[data-system-confirm]');
const accountSearch = document.querySelector('[data-account-search]');
const accountFilter = document.querySelector('[data-account-filter]');
let dashboard = { accounts: [], layers: [], autopilot: false, siteMode: { mode: 'online' }, telemetry: {} };
let pendingMode = null;
let toastTimer;

function showStatus(message, error = false) {
  clearTimeout(toastTimer);
  statusNode.textContent = message;
  statusNode.classList.toggle('error', error);
  statusNode.classList.add('visible');
  toastTimer = setTimeout(() => statusNode.classList.remove('visible'), 4200);
}

function formatDate(value) {
  if (!value) return 'NOT RECORDED';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'NOT RECORDED' : date.toLocaleString();
}

function relativeAge(value) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!value || !Number.isFinite(elapsed)) return 'NO EVENTS';
  if (elapsed < 5_000) return 'JUST NOW';
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}S AGO`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}M AGO`;
  return `${Math.floor(elapsed / 3_600_000)}H AGO`;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function paintMetrics(accounts) {
  const values = {
    pending: accounts.filter((account) => account.status === 'pending').length,
    approved: accounts.filter((account) => account.status === 'approved' && !account.locked).length,
    locked: accounts.filter((account) => account.locked).length,
    total: accounts.length,
  };
  for (const [key, value] of Object.entries(values)) {
    const target = document.querySelector(`[data-owner-metric="${key}"]`);
    if (target) target.textContent = String(value);
  }
  document.querySelector('[data-owner-account-count]').textContent = `${values.pending} PENDING · ${values.locked} LOCKED · ${values.total} TOTAL`;
}

function paintOperationalMetrics(telemetry = {}) {
  const liveLayers = Number(telemetry.layerCounts?.live || 0);
  const restrictedLayers = Number(telemetry.layerCounts?.coming_soon || 0)
    + Number(telemetry.layerCounts?.maintenance || 0)
    + Number(telemetry.layerCounts?.disabled || 0);
  const values = {
    activeSessions: Number(telemetry.activeSessions || 0),
    sessions24h: Number(telemetry.sessions24h || 0),
    failedLogins24h: Number(telemetry.failedLogins24h || 0),
    lockedAccounts: dashboard.accounts.filter((account) => account.locked).length,
    events24h: Number(telemetry.events24h || 0),
    searches24h: Number(telemetry.searches24h || 0),
    legalAcceptances24h: Number(telemetry.legalAcceptances24h || 0),
    liveLayers,
    restrictedLayers,
  };
  for (const [key, value] of Object.entries(values)) {
    document.querySelectorAll(`[data-owner-live-metric="${key}"]`).forEach((target) => { target.textContent = String(value); });
  }
  const connected = telemetry.database === 'connected';
  document.querySelector('[data-owner-core-state]').textContent = connected ? 'OPERATIONAL' : 'DEGRADED';
  document.querySelector('[data-owner-db-state]').textContent = connected ? 'CONNECTED' : 'UNAVAILABLE';
  document.querySelector('[data-owner-db-hero]').textContent = connected ? 'CONNECTED' : 'UNAVAILABLE';
  document.querySelector('[data-owner-hero-sessions]').textContent = String(values.activeSessions);
  document.querySelector('[data-owner-hero-last-activity]').textContent = relativeAge(telemetry.lastActivityAt);
  document.querySelector('[data-owner-last-event]').textContent = relativeAge(telemetry.lastActivityAt);
  document.querySelector('[data-owner-legal-version]').textContent = telemetry.legalVersion || 'UNKNOWN';
  document.querySelector('[data-owner-live-layer-summary]').textContent = `${liveLayers} LIVE · ${restrictedLayers} CONTROLLED`;
  document.querySelector('[data-owner-security-state]').textContent = values.failedLogins24h || values.lockedAccounts ? 'REVIEW' : 'CLEAR';
  document.querySelector('[data-owner-session-note]').textContent = `${values.activeSessions} ACTIVE`;
  document.querySelector('[data-owner-snapshot-age]').textContent = relativeAge(telemetry.generatedAt);
}

function accountMatches(account) {
  const query = accountSearch.value.trim().toLowerCase();
  const filter = accountFilter.value;
  if (query && !String(account.email).toLowerCase().includes(query)) return false;
  if (filter === 'locked') return Boolean(account.locked);
  return filter === 'all' || account.status === filter;
}

function actionButton(account, action, label) {
  const button = node('button', '', label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.userId = account.id;
  return button;
}

function renderAccounts() {
  const visible = dashboard.accounts.filter(accountMatches);
  const rows = visible.map((account) => {
    const row = node('article', 'owner-account-row');
    row.dataset.status = account.status;
    row.dataset.locked = String(Boolean(account.locked));
    const identity = node('div', 'owner-account-identity');
    identity.append(
      node('strong', '', account.email),
      node('span', '', `${String(account.status).toUpperCase()} · CREATED ${formatDate(account.createdAt)}`),
    );
    identity.append(node('small', account.legalAcceptedVersion === dashboard.telemetry?.legalVersion ? 'legal-current' : 'legal-renewal',
      account.legalAcceptedVersion === dashboard.telemetry?.legalVersion
        ? `LEGAL ${account.legalAcceptedVersion} · ACCEPTED ${formatDate(account.legalAcceptedAt)}`
        : `LEGAL RENEWAL REQUIRED · CURRENT ${dashboard.telemetry?.legalVersion || 'UNKNOWN'}`));
    if (account.locked) identity.append(node('small', '', `SECURITY LOCK · ${account.lockReason || 'Suspicious activity review'} · ${formatDate(account.lockedAt)}`));
    const actions = node('div', 'owner-account-actions');
    if (account.status !== 'approved') actions.append(actionButton(account, 'approve', 'APPROVE'));
    if (account.status !== 'rejected') actions.append(actionButton(account, 'reject', 'DENY'));
    actions.append(account.locked
      ? actionButton(account, 'unlock', 'REMOVE SECURITY LOCK')
      : actionButton(account, 'lock', 'SECURITY LOCK'));
    row.append(identity, actions);
    return row;
  });
  accountsHost.replaceChildren(...rows);
  if (!rows.length) accountsHost.append(node('p', 'empty-state', 'No accounts match this view.'));
  paintMetrics(dashboard.accounts);
}

function renderLayers() {
  const live = dashboard.layers.filter((layer) => layer.status === 'live').length;
  document.querySelector('[data-owner-layer-count]').textContent = `${live} LIVE · ${dashboard.layers.length} TOTAL`;
  const rows = [];
  let activeGroup = '';
  for (const layer of dashboard.layers) {
    const group = layer.group || 'Data & Tools';
    if (group !== activeGroup) {
      const heading = node('div', 'owner-layer-group');
      heading.append(node('span', '', group), node('i'));
      rows.push(heading);
      activeGroup = group;
    }
    const row = node('label', 'owner-layer-row');
    row.dataset.status = layer.status;
    const identity = node('div');
    identity.append(node('strong', '', layer.name), node('small', '', layer.id));
    const select = document.createElement('select');
    select.dataset.layerId = layer.id;
    select.setAttribute('aria-label', `${layer.name} public availability`);
    for (const [value, label] of [['live', 'ENABLED'], ['coming_soon', 'COMING SOON'], ['maintenance', 'DISABLED / MAINTENANCE'], ['disabled', 'HIDDEN']]) {
      const option = node('option', '', label);
      option.value = value;
      option.selected = layer.status === value;
      select.append(option);
    }
    row.append(identity, select);
    rows.push(row);
  }
  layersHost.replaceChildren(...rows);
}

function renderActivity(events = []) {
  const rows = events.map((event) => {
    const row = node('article', 'activity-row');
    row.append(
      node('span', '', formatDate(event.created_at)),
      node('strong', '', event.email || 'Anonymous visitor'),
      node('code', '', `${event.event_type} · ${Object.entries(event.metadata || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'no metadata'}`),
    );
    return row;
  });
  activityHost.replaceChildren(...rows);
  if (!rows.length) activityHost.append(node('p', 'empty-state', 'No activity has been recorded yet.'));
}

function paintAutopilot(enabled) {
  const control = document.querySelector('[data-owner-autopilot]');
  control.setAttribute('aria-pressed', String(enabled));
  document.querySelector('[data-owner-autopilot-state]').textContent = enabled ? 'ON' : 'OFF';
  document.querySelector('[data-owner-autopilot-description]').textContent = enabled
    ? 'New operators are approved automatically when they register.'
    : 'Manual approval is active. New operators remain pending until you approve them.';
}

function paintSiteMode(siteMode) {
  dashboard.siteMode = siteMode;
  const hero = document.querySelector('.system-hero');
  hero.dataset.siteMode = siteMode.mode;
  document.querySelector('[data-site-mode-label]').textContent = siteMode.label;
  document.querySelector('[data-site-mode-message]').textContent = siteMode.message;
  document.querySelector('[data-system-readout]').textContent = siteMode.mode.replaceAll('_', ' ').toUpperCase();
  modeControls.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === siteMode.mode);
    button.classList.remove('selected');
  });
  pendingMode = null;
  confirmBar.hidden = true;
}

async function loadDashboard(quiet = false) {
  if (!quiet) showStatus('SYNCHRONIZING WITH RAILWAY POSTGRES');
  const [admin, activity] = await Promise.all([
    api('/api/account/admin'),
    api('/api/account/activity?limit=100'),
  ]);
  dashboard = { ...dashboard, ...admin };
  renderAccounts();
  renderLayers();
  renderActivity(activity.events);
  paintAutopilot(Boolean(admin.autopilot));
  paintSiteMode(admin.siteMode);
  paintOperationalMetrics(admin.telemetry);
  if (!quiet) showStatus(`SYNC COMPLETE · ${admin.accounts.length} ACCOUNTS`);
}

modeControls.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button || button.dataset.mode === dashboard.siteMode.mode) return;
  pendingMode = button.dataset.mode;
  modeControls.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('selected', item === button));
  const label = button.querySelector('strong').textContent;
  document.querySelector('[data-system-confirm-title]').textContent = `CONFIRM · ${label}`;
  document.querySelector('[data-system-confirm-copy]').textContent = pendingMode === 'online'
    ? 'Restore normal access for every approved, unlocked operator.'
    : 'This will immediately disconnect every non-owner visitor from the public console.';
  confirmBar.hidden = false;
});

document.querySelector('[data-system-cancel]').addEventListener('click', () => paintSiteMode(dashboard.siteMode));
document.querySelector('[data-system-apply]').addEventListener('click', async () => {
  if (!pendingMode) return;
  const button = document.querySelector('[data-system-apply]');
  button.disabled = true;
  try {
    const payload = await api('/api/account/admin/system-mode', { method: 'POST', body: JSON.stringify({ mode: pendingMode }) });
    paintSiteMode(payload.siteMode);
    try {
      localStorage.setItem('gev:site-mode-pulse', JSON.stringify({ mode: payload.siteMode.mode, changedAt: Date.now() }));
    } catch { /* Cross-tab acceleration is optional; server polling remains authoritative. */ }
    showStatus(`${payload.siteMode.label.toUpperCase()} IS NOW ACTIVE SITE-WIDE`);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-owner-autopilot]').addEventListener('click', async (event) => {
  const control = event.currentTarget;
  const enabled = control.getAttribute('aria-pressed') !== 'true';
  control.disabled = true;
  try {
    const payload = await api('/api/account/admin/autopilot', { method: 'POST', body: JSON.stringify({ enabled }) });
    dashboard.autopilot = payload.autopilot;
    paintAutopilot(payload.autopilot);
    showStatus(`REGISTRATION AUTOPILOT ${payload.autopilot ? 'ENABLED' : 'DISABLED'}`);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    control.disabled = false;
  }
});

accountsHost.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  button.disabled = true;
  const action = button.dataset.action;
  try {
    await api('/api/account/admin/users', {
      method: 'POST',
      body: JSON.stringify({ userId: button.dataset.userId, action, reason: action === 'lock' ? 'Suspicious activity review' : undefined }),
    });
    await loadDashboard(true);
    const message = { approve: 'ACCOUNT APPROVED', reject: 'ACCOUNT DENIED AND SESSIONS REVOKED', lock: 'SECURITY LOCK ACTIVE · ALL SESSIONS REVOKED', unlock: 'SECURITY LOCK REMOVED' }[action];
    showStatus(message);
  } catch (error) {
    showStatus(error.message, true);
    button.disabled = false;
  }
});

layersHost.addEventListener('change', async (event) => {
  const select = event.target.closest('[data-layer-id]');
  if (!select) return;
  select.disabled = true;
  try {
    const payload = await api('/api/account/admin/layers', { method: 'POST', body: JSON.stringify({ layerId: select.dataset.layerId, status: select.value }) });
    dashboard.layers = payload.layers;
    renderLayers();
    showStatus(`${select.dataset.layerId.toUpperCase()} SET TO ${select.value.replace('_', ' ').toUpperCase()}`);
  } catch (error) {
    showStatus(error.message, true);
    await loadDashboard(true);
  }
});

accountSearch.addEventListener('input', renderAccounts);
accountFilter.addEventListener('change', renderAccounts);
document.querySelector('[data-owner-refresh]').addEventListener('click', () => loadDashboard().catch((error) => showStatus(error.message, true)));

function updateClock() {
  document.querySelector('[data-owner-clock]').textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
  if (dashboard.telemetry?.generatedAt) document.querySelector('[data-owner-snapshot-age]').textContent = relativeAge(dashboard.telemetry.generatedAt);
  if (dashboard.telemetry?.lastActivityAt) {
    document.querySelector('[data-owner-hero-last-activity]').textContent = relativeAge(dashboard.telemetry.lastActivityAt);
    document.querySelector('[data-owner-last-event]').textContent = relativeAge(dashboard.telemetry.lastActivityAt);
  }
}
updateClock();
setInterval(updateClock, 1000);

api('/api/account/session').then(async ({ user }) => {
  if (user?.role !== 'owner') {
    document.querySelector('[data-owner-denied]').hidden = false;
    return;
  }
  document.querySelector('[data-owner-email]').textContent = user.email;
  document.body.classList.remove('owner-loading');
  await loadDashboard();
  window.setInterval(() => loadDashboard(true).catch((error) => showStatus(error.message, true)), 10_000);
}).catch((error) => {
  document.querySelector('[data-owner-denied]').hidden = false;
  showStatus(error.message, true);
});
