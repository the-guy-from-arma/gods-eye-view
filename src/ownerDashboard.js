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
let dashboard = { accounts: [], layers: [], autopilot: false, siteMode: { mode: 'online' } };
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
}
updateClock();
setInterval(updateClock, 1000);

function initTelemetryCanvas() {
  const canvas = document.getElementById('owner-telemetry-canvas');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let frame = 0;
  let raf = 0;
  let points = [];

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    points = Array.from({ length: Math.max(24, Math.floor(width / 42)) }, (_, index) => ({
      x: (index * 83.17) % width,
      y: (index * 137.39) % height,
      phase: index * 0.71,
    }));
  };

  const draw = () => {
    context.clearRect(0, 0, width, height);
    context.save();
    context.strokeStyle = 'rgba(58, 218, 243, .055)';
    context.lineWidth = 1;
    for (let x = 238; x < width; x += 96) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = 0; y < height; y += 96) {
      context.beginPath(); context.moveTo(238, y); context.lineTo(width, y); context.stroke();
    }

    const cx = width * 0.77;
    const cy = Math.min(390, height * 0.34);
    const radius = Math.min(width, height) * 0.22;
    context.strokeStyle = 'rgba(70, 225, 249, .075)';
    for (let ring = 1; ring <= 3; ring += 1) {
      context.beginPath();
      context.ellipse(cx, cy, radius * ring * 0.58, radius * ring * 0.22, -0.32, 0, Math.PI * 2);
      context.stroke();
    }
    context.setLineDash([3, 11]);
    context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.stroke();
    context.setLineDash([]);

    for (const point of points) {
      const pulse = 0.25 + (Math.sin(frame * 0.018 + point.phase) + 1) * 0.18;
      context.fillStyle = `rgba(73, 230, 250, ${pulse})`;
      context.fillRect(point.x, point.y, 1.2, 1.2);
    }
    const sweepY = (frame * 0.55) % Math.max(height, 1);
    const sweep = context.createLinearGradient(0, sweepY - 18, 0, sweepY + 18);
    sweep.addColorStop(0, 'rgba(46, 222, 249, 0)');
    sweep.addColorStop(0.5, 'rgba(46, 222, 249, .045)');
    sweep.addColorStop(1, 'rgba(46, 222, 249, 0)');
    context.fillStyle = sweep;
    context.fillRect(238, sweepY - 18, width - 238, 36);
    context.restore();
    frame += 1;
    if (!reducedMotion && !document.hidden) raf = requestAnimationFrame(draw);
  };

  const syncAnimation = () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) draw();
  };
  resize();
  draw();
  addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', syncAnimation);
}

initTelemetryCanvas();

api('/api/account/session').then(async ({ user }) => {
  if (user?.role !== 'owner') {
    document.querySelector('[data-owner-denied]').hidden = false;
    return;
  }
  document.querySelector('[data-owner-email]').textContent = user.email;
  document.body.classList.remove('owner-loading');
  await loadDashboard();
}).catch((error) => {
  document.querySelector('[data-owner-denied]').hidden = false;
  showStatus(error.message, true);
});
