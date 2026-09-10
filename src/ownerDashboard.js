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
const vehicleHost = document.querySelector('[data-vehicle-observations]');
const vehicleState = document.querySelector('[data-vehicle-state]');
const vehicleCamera = document.querySelector('[data-vehicle-camera]');
const vehicleSearch = document.querySelector('[data-vehicle-search]');
let dashboard = { accounts: [], layers: [], autopilot: false, siteMode: { mode: 'online' }, telemetry: {} };
let vehicleAnalytics = { configured: false, enabled: false, observations: [], totals: {}, sources: [] };
let vehicleSearchTimer;
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
    verified: accounts.filter((account) => account.identityVerificationStatus === 'verified').length,
    analysts: accounts.filter((account) => account.intelligenceAccess === 'analyst').length,
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
    identity.append(node('small', account.identityVerificationStatus === 'verified' ? 'legal-current' : '',
      `IDENTITY ${String(account.identityVerificationStatus || 'unverified').toUpperCase()} · INTEL ${String(account.intelligenceAccess || 'registered').toUpperCase()}`));
    if (account.locked) identity.append(node('small', '', `SECURITY LOCK · ${account.lockReason || 'Suspicious activity review'} · ${formatDate(account.lockedAt)}`));
    const actions = node('div', 'owner-account-actions');
    if (account.status !== 'approved') actions.append(actionButton(account, 'approve', 'APPROVE'));
    if (account.status !== 'rejected') actions.append(actionButton(account, 'reject', 'DENY'));
    actions.append(account.locked
      ? actionButton(account, 'unlock', 'REMOVE SECURITY LOCK')
      : actionButton(account, 'lock', 'SECURITY LOCK'));
    actions.append(account.identityVerificationStatus === 'verified'
      ? actionButton(account, 'revoke_identity', 'REVOKE IDENTITY')
      : actionButton(account, 'verify_identity', 'VERIFY IDENTITY'));
    if (account.identityVerificationStatus === 'verified') {
      actions.append(account.intelligenceAccess === 'analyst'
        ? actionButton(account, 'revoke_analyst', 'REMOVE ANALYST')
        : actionButton(account, 'grant_analyst', 'GRANT ANALYST'));
    }
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

function renderVehicleObservations() {
  const rows = vehicleAnalytics.observations.map((observation) => {
    const row = node('article', 'vehicle-observation-row');
    const identity = node('div');
    const year = observation.yearStart && observation.yearEnd
      ? `${observation.yearStart}–${observation.yearEnd}`
      : 'YEAR UNKNOWN';
    identity.append(node('strong', '', `${observation.make} ${observation.model}`), node('span', '', `${year} · ${String(observation.color).toUpperCase()} · ${String(observation.vehicleType).replaceAll('_', ' ').toUpperCase()}`));
    const camera = node('div');
    camera.append(node('strong', '', observation.cameraName || observation.cameraId), node('small', '', `${observation.jurisdiction || 'JURISDICTION UNKNOWN'} · ${observation.provider || 'PROVIDER UNKNOWN'}`));
    const captured = node('div');
    captured.append(node('strong', '', formatDate(observation.capturedAt)), node('small', '', observation.modelVersion));
    row.append(identity, camera, captured, node('strong', 'vehicle-confidence', `${Math.round(Number(observation.confidence || 0) * 100)}% CONF.`));
    return row;
  });
  vehicleHost.replaceChildren(...rows);
  if (!rows.length) vehicleHost.append(node('p', 'empty-state', 'No matching non-identifying vehicle observations.'));
}

function renderProtectedFrames() {
  const host = document.querySelector('[data-protected-frame-list]');
  const frames = vehicleAnalytics.protectedArchive?.frames || [];
  const rows = frames.map((frame) => {
    const row = node('article', 'protected-frame-row');
    const identity = node('div');
    identity.append(node('strong', '', frame.title), node('small', '', `${frame.stateCode} · ${frame.redactedRegions} REDACTED REGION${frame.redactedRegions === 1 ? '' : 'S'}`));
    const details = node('div');
    details.append(node('strong', '', formatDate(frame.capturedAt)), node('small', '', frame.redactionModel));
    const link = node('a', '', 'VIEW REDACTED FRAME');
    link.href = `/api/account/admin/vehicle-analytics/protected-frames/${encodeURIComponent(frame.id)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    row.append(identity, details, link);
    return row;
  });
  host.replaceChildren(...rows);
  if (!rows.length) host.append(node('p', 'empty-state', vehicleAnalytics.protectedArchive?.enabled
    ? 'No verified redacted frames have been retained.'
    : 'Protected Archive is staged and inactive.'));
}

function paintVehicleAnalytics(payload) {
  vehicleAnalytics = { ...vehicleAnalytics, ...payload };
  const toggle = document.querySelector('[data-vehicle-enabled]');
  toggle.setAttribute('aria-pressed', String(Boolean(vehicleAnalytics.enabled)));
  document.querySelector('[data-vehicle-enabled-label]').textContent = vehicleAnalytics.enabled ? 'ON' : 'OFF';
  document.querySelector('[data-vehicle-provider]').textContent = vehicleAnalytics.configured ? `GEMINI · ${vehicleAnalytics.model}` : 'KEY REQUIRED';
  document.querySelector('[data-vehicle-total]').textContent = String(vehicleAnalytics.totals?.total || 0);
  document.querySelector('[data-vehicle-cameras]').textContent = String(vehicleAnalytics.totals?.cameras || 0);
  document.querySelector('[data-vehicle-retention]').textContent = `${vehicleAnalytics.retentionDays || 90} DAYS · NO FRAMES`;
  document.querySelector('[data-vehicle-analyze]').disabled = !vehicleAnalytics.enabled || !vehicleAnalytics.configured;
  document.querySelector('[data-vehicle-sweep]').disabled = !vehicleAnalytics.enabled || !vehicleAnalytics.configured;
  const archive = vehicleAnalytics.protectedArchive || {};
  const archiveToggle = document.querySelector('[data-protected-archive-enabled]');
  archiveToggle.setAttribute('aria-pressed', String(Boolean(archive.enabled)));
  document.querySelector('[data-protected-archive-label]').textContent = archive.enabled ? 'ON' : 'OFF';
  document.querySelector('[data-protected-archive-worker]').textContent = archive.configured ? 'READY · IDLE' : 'NOT CONFIGURED';
  document.querySelector('[data-protected-archive-retention]').textContent = `${archive.retentionDays || 7} DAYS`;
  document.querySelector('[data-protected-archive-count]').textContent = String(archive.frames?.length || 0);
  renderVehicleObservations();
  renderProtectedFrames();
}

async function loadVehicleAnalytics() {
  const q = vehicleSearch.value.trim();
  const payload = await api(`/api/account/admin/vehicle-analytics?limit=250${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  paintVehicleAnalytics(payload);
}

function refreshVehicleCameraOptions() {
  const state = vehicleState.value;
  const sources = vehicleAnalytics.sources.filter((source) => !state || source.stateCode === state);
  const options = [new Option('SELECT CAMERA', '')];
  for (const source of sources) options.push(new Option(`${source.name} · ${source.city || source.stateCode || source.provider}`, source.id));
  vehicleCamera.replaceChildren(...options);
}

async function loadVehicleSources() {
  const response = await fetch('/api/cctv/sources', { cache: 'no-store' });
  if (!response.ok) throw new Error('CCTV catalog unavailable');
  const payload = await response.json();
  vehicleAnalytics.sources = Array.isArray(payload.sources) ? payload.sources : [];
  const states = [...new Set(vehicleAnalytics.sources.map((source) => source.stateCode).filter(Boolean))].sort();
  vehicleState.replaceChildren(new Option('ALL AVAILABLE STATES', ''), ...states.map((state) => new Option(state, state)));
  refreshVehicleCameraOptions();
}

async function blobBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function analyzeVehicleCamera(source) {
  if (!source) throw new Error('Select a camera first');
  const frame = await fetch(`${source.frameUrl || `/api/cctv/frame/${encodeURIComponent(source.id)}`}?vehicleAnalysis=1`, { cache: 'no-store' });
  const mimeType = String(frame.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!frame.ok) throw new Error(`Camera frame failed (${frame.status})`);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('This camera does not currently provide an analyzable raster frame');
  const blob = await frame.blob();
  if (blob.size > 4_800_000) throw new Error('Camera frame exceeds the 4.8 MB analysis limit');
  return api('/api/account/admin/vehicle-analytics/analyze', {
    method: 'POST',
    body: JSON.stringify({
      cameraId: source.id,
      cameraName: source.name,
      provider: source.provider,
      jurisdiction: [source.city, source.stateCode].filter(Boolean).join(', '),
      stateCode: source.stateCode,
      mimeType,
      imageBase64: await blobBase64(blob),
    }),
  });
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
  await loadVehicleAnalytics();
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
    const message = {
      approve: 'ACCOUNT APPROVED',
      reject: 'ACCOUNT DENIED AND SESSIONS REVOKED',
      lock: 'SECURITY LOCK ACTIVE · ALL SESSIONS REVOKED',
      unlock: 'SECURITY LOCK REMOVED',
      verify_identity: 'IDENTITY VERIFICATION RECORDED',
      revoke_identity: 'IDENTITY AND ELEVATED ACCESS REVOKED',
      grant_analyst: 'ANALYST ACCESS GRANTED',
      revoke_analyst: 'ANALYST ACCESS REMOVED',
    }[action] || 'ACCOUNT UPDATED';
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

document.querySelector('[data-vehicle-enabled]').addEventListener('click', async (event) => {
  const control = event.currentTarget;
  const enabled = control.getAttribute('aria-pressed') !== 'true';
  control.disabled = true;
  try {
    const payload = await api('/api/account/admin/vehicle-analytics/settings', { method: 'POST', body: JSON.stringify({ enabled }) });
    vehicleAnalytics.enabled = payload.enabled;
    paintVehicleAnalytics(vehicleAnalytics);
    showStatus(`VEHICLE ANALYTICS ${payload.enabled ? 'ENABLED' : 'DISABLED'}`);
  } catch (error) { showStatus(error.message, true); } finally { control.disabled = false; }
});

document.querySelector('[data-protected-archive-enabled]').addEventListener('click', async (event) => {
  const control = event.currentTarget;
  const enabled = control.getAttribute('aria-pressed') !== 'true';
  control.disabled = true;
  try {
    const payload = await api('/api/account/admin/vehicle-analytics/protected-archive/settings', {
      method: 'POST', body: JSON.stringify({ enabled }),
    });
    vehicleAnalytics.protectedArchive = { ...vehicleAnalytics.protectedArchive, enabled: payload.enabled };
    paintVehicleAnalytics(vehicleAnalytics);
    showStatus(`PROTECTED ARCHIVE ${payload.enabled ? 'ENABLED' : 'DISABLED'}`);
  } catch (error) { showStatus(error.message, true); } finally { control.disabled = false; }
});

vehicleState.addEventListener('change', refreshVehicleCameraOptions);
document.querySelector('[data-vehicle-analyze]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const source = vehicleAnalytics.sources.find((item) => item.id === vehicleCamera.value);
  button.disabled = true;
  try {
    showStatus(`ANALYZING ${source?.name || 'CAMERA FRAME'} · NO IMAGE WILL BE STORED`);
    const result = await analyzeVehicleCamera(source);
    await loadVehicleAnalytics();
    showStatus(result.duplicate ? 'FRAME ALREADY ANALYZED' : `${result.vehicles.length} VEHICLE OBSERVATIONS RECORDED`);
  } catch (error) { showStatus(error.message, true); } finally { button.disabled = !vehicleAnalytics.enabled || !vehicleAnalytics.configured; }
});

document.querySelector('[data-vehicle-sweep]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const sources = vehicleAnalytics.sources.filter((source) => !vehicleState.value || source.stateCode === vehicleState.value).slice(0, 10);
  if (!sources.length) return showStatus('NO CAMERAS AVAILABLE IN THIS GROUP', true);
  button.disabled = true;
  let completed = 0;
  let detections = 0;
  try {
    for (const source of sources) {
      showStatus(`VEHICLE SWEEP ${completed + 1}/${sources.length} · ${source.name}`);
      try {
        const result = await analyzeVehicleCamera(source);
        detections += result.vehicles?.length || 0;
      } catch { /* A stale or non-raster source must not stop the bounded sweep. */ }
      completed += 1;
    }
    await loadVehicleAnalytics();
    showStatus(`SWEEP COMPLETE · ${completed} FRAMES · ${detections} OBSERVATIONS`);
  } finally { button.disabled = !vehicleAnalytics.enabled || !vehicleAnalytics.configured; }
});

document.querySelector('[data-vehicle-refresh]').addEventListener('click', () => loadVehicleAnalytics().catch((error) => showStatus(error.message, true)));
vehicleSearch.addEventListener('input', () => {
  clearTimeout(vehicleSearchTimer);
  vehicleSearchTimer = setTimeout(() => loadVehicleAnalytics().catch((error) => showStatus(error.message, true)), 280);
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
  await loadVehicleSources();
  await loadDashboard();
  window.setInterval(() => loadDashboard(true).catch((error) => showStatus(error.message, true)), 10_000);
}).catch((error) => {
  document.querySelector('[data-owner-denied]').hidden = false;
  showStatus(error.message, true);
});
