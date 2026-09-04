function sendActivity(type, metadata = {}) {
  const body = JSON.stringify({ type, metadata });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/activity', new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch('/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function activityLabel(event) {
  const when = new Date(event.created_at).toLocaleString();
  const who = event.email || 'Anonymous visitor';
  const details = Object.entries(event.metadata || {}).map(([key, value]) => `${key}: ${value}`).join(' · ');
  return { when, who, summary: `${event.event_type}${details ? ` · ${details}` : ''}` };
}

export function initAccounts(options = {}) {
  const onAuthenticated = typeof options.onAuthenticated === 'function' ? options.onAuthenticated : null;
  const accessRequired = options.required === true;
  const chip = document.getElementById('account-chip');
  const dialog = document.getElementById('account-dialog');
  const close = dialog?.querySelector('[data-account-close]');
  const signedOut = document.getElementById('account-signed-out');
  const signedIn = document.getElementById('account-signed-in');
  const form = document.getElementById('account-form');
  const status = dialog?.querySelector('[data-account-status]');
  const chipLabel = chip?.querySelector('[data-account-chip-label]');
  const submit = form?.querySelector('[data-account-submit]');
  const ownerSetupField = form?.querySelector('[data-owner-setup-field]');
  const tabs = [...(dialog?.querySelectorAll('[data-account-tab]') || [])];
  const activityButton = dialog?.querySelector('[data-account-activity]');
  const activityPanel = dialog?.querySelector('[data-account-activity-panel]');
  const eventsHost = dialog?.querySelector('[data-account-events]');
  const ownerDashboardButton = dialog?.querySelector('[data-owner-dashboard]');
  const ownerDashboardDialog = document.getElementById('owner-dashboard-dialog');
  const ownerDashboardCloseButtons = [...(ownerDashboardDialog?.querySelectorAll('[data-owner-dashboard-close]') || [])];
  const ownerRefreshButton = ownerDashboardDialog?.querySelector('[data-owner-refresh]');
  const ownerAutopilotButton = ownerDashboardDialog?.querySelector('[data-owner-autopilot]');
  const ownerAutopilotState = ownerDashboardDialog?.querySelector('[data-owner-autopilot-state]');
  const ownerAutopilotDescription = ownerDashboardDialog?.querySelector('[data-owner-autopilot-description]');
  const ownerAccountsHost = ownerDashboardDialog?.querySelector('[data-owner-accounts]');
  const ownerAccountCount = ownerDashboardDialog?.querySelector('[data-owner-account-count]');
  const ownerLayersHost = ownerDashboardDialog?.querySelector('[data-owner-layers]');
  const ownerLayerCount = ownerDashboardDialog?.querySelector('[data-owner-layer-count]');
  const ownerStatus = ownerDashboardDialog?.querySelector('[data-owner-status]');
  const ownerMetrics = new Map([...(ownerDashboardDialog?.querySelectorAll('[data-owner-metric]') || [])]
    .map((node) => [node.dataset.ownerMetric, node]));
  const disclaimerDialog = document.getElementById('platform-disclaimer-dialog');
  const disclaimerOpen = dialog?.querySelector('[data-disclaimer-open]');
  const disclaimerCloseButtons = [...(disclaimerDialog?.querySelectorAll('[data-disclaimer-close]') || [])];
  let mode = 'login';
  let user = null;
  let authenticationHandled = false;

  if (!chip || !dialog || !form || !status) return null;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  const setOwnerStatus = (message, error = false) => {
    if (!ownerStatus) return;
    ownerStatus.textContent = message;
    ownerStatus.classList.toggle('error', error);
  };

  const closeOwnerDashboard = ({ returnToAccount = true } = {}) => {
    if (ownerDashboardDialog?.open) ownerDashboardDialog.close();
    if (returnToAccount && user) {
      dialog.hidden = false;
      ownerDashboardButton?.focus();
    }
  };

  const closeDisclaimer = () => {
    if (!disclaimerDialog?.open) return;
    disclaimerDialog.close();
    disclaimerOpen?.focus();
  };

  disclaimerOpen?.addEventListener('click', () => {
    if (!disclaimerDialog || disclaimerDialog.open) return;
    disclaimerDialog.showModal();
    disclaimerDialog.querySelector('[data-disclaimer-close]')?.focus();
  });
  disclaimerCloseButtons.forEach((button) => button.addEventListener('click', closeDisclaimer));
  disclaimerDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDisclaimer();
  });

  const paint = () => {
    signedOut.hidden = Boolean(user);
    signedIn.hidden = !user;
    chipLabel.textContent = user ? (user.role === 'owner' ? 'OWNER' : 'ACCOUNT') : 'ACCOUNT';
    if (!user) return;
    signedIn.querySelector('[data-account-email]').textContent = user.email;
    signedIn.querySelector('[data-account-role]').textContent = user.role === 'owner' ? 'OWNER ACCESS' : 'APPROVED OPERATOR';
    activityButton.hidden = user.role !== 'owner';
    ownerDashboardButton.hidden = user.role !== 'owner';
    if (user.role !== 'owner') {
      activityPanel.hidden = true;
      closeOwnerDashboard({ returnToAccount: false });
    }
  };

  const continueAfterAuthentication = async () => {
    if (!user || authenticationHandled) return;
    authenticationHandled = true;
    try {
      await onAuthenticated?.(user);
    } catch (error) {
      authenticationHandled = false;
      setStatus(error?.message || 'Command console failed to start', true);
    }
  };

  const setMode = (next) => {
    mode = next;
    tabs.forEach((tab) => {
      const selected = tab.dataset.accountTab === mode;
      tab.setAttribute('aria-selected', String(selected));
    });
    submit.textContent = mode === 'register' ? 'REQUEST ACCESS' : 'SIGN IN';
    form.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    ownerSetupField.hidden = mode !== 'register';
    setStatus(mode === 'register' ? 'Create an access request. The owner or Autopilot will approve it.' : '');
  };

  const renderOwnerAccounts = (accounts = []) => {
    const pending = accounts.filter((account) => account.status === 'pending').length;
    const approved = accounts.filter((account) => account.status === 'approved').length;
    const rejected = accounts.filter((account) => account.status === 'rejected').length;
    ownerAccountCount.textContent = `${pending} PENDING · ${accounts.length} TOTAL`;
    if (ownerMetrics.get('pending')) ownerMetrics.get('pending').textContent = String(pending);
    if (ownerMetrics.get('approved')) ownerMetrics.get('approved').textContent = String(approved);
    if (ownerMetrics.get('rejected')) ownerMetrics.get('rejected').textContent = String(rejected);
    if (ownerMetrics.get('total')) ownerMetrics.get('total').textContent = String(accounts.length);
    ownerAccountsHost.replaceChildren(...accounts.map((account) => {
      const row = document.createElement('article');
      row.className = 'owner-account-row';
      row.dataset.status = account.status;
      const identity = document.createElement('div');
      const email = document.createElement('strong');
      const detail = document.createElement('span');
      email.textContent = account.email;
      detail.textContent = `${String(account.status || 'pending').toUpperCase()} · ${new Date(account.createdAt).toLocaleString()}`;
      identity.append(email, detail);
      const actions = document.createElement('div');
      actions.className = 'owner-account-actions';
      for (const action of ['approve', 'reject']) {
        if ((action === 'approve' && account.status === 'approved') || (action === 'reject' && account.status === 'rejected')) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.ownerAccountAction = action;
        button.dataset.userId = account.id;
        button.textContent = action === 'approve' ? 'APPROVE' : 'DENY';
        actions.append(button);
      }
      row.append(identity, actions);
      return row;
    }));
    if (!accounts.length) ownerAccountsHost.textContent = 'No operator accounts yet.';
  };

  const paintAutopilot = (enabled) => {
    ownerAutopilotButton.setAttribute('aria-pressed', String(enabled));
    ownerAutopilotState.textContent = enabled ? 'ON' : 'OFF';
    ownerAutopilotDescription.textContent = enabled
      ? 'New registrations are approved automatically.'
      : 'Manual approval is active.';
  };

  const renderOwnerLayers = (layers = []) => {
    if (!ownerLayersHost || !ownerLayerCount) return;
    const live = layers.filter((layer) => layer.status === 'live').length;
    ownerLayerCount.textContent = `${live} LIVE · ${layers.length} TOTAL`;
    ownerLayersHost.replaceChildren(...layers.map((layer) => {
      const row = document.createElement('label');
      row.className = 'owner-layer-row';
      row.dataset.status = layer.status;
      const identity = document.createElement('span');
      const name = document.createElement('strong');
      const id = document.createElement('small');
      name.textContent = layer.name;
      id.textContent = layer.id;
      identity.append(name, id);
      const select = document.createElement('select');
      select.dataset.ownerLayerId = layer.id;
      select.setAttribute('aria-label', `${layer.name} public availability`);
      for (const [value, label] of [
        ['live', 'LIVE'],
        ['coming_soon', 'COMING SOON'],
        ['maintenance', 'MAINTENANCE'],
        ['disabled', 'DISABLED'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = layer.status === value;
        select.appendChild(option);
      }
      row.append(identity, select);
      return row;
    }));
  };

  const loadOwnerDashboard = async () => {
    ownerAccountsHost.textContent = 'Loading access queue…';
    setOwnerStatus('SYNCHRONIZING WITH RAILWAY POSTGRES');
    try {
      const payload = await api('/api/account/admin');
      paintAutopilot(Boolean(payload.autopilot));
      renderOwnerAccounts(payload.accounts);
      renderOwnerLayers(payload.layers);
      setOwnerStatus(`SYNC COMPLETE · ${payload.accounts.length} ACCOUNTS`);
    } catch (error) {
      ownerAccountsHost.textContent = error.message;
      setOwnerStatus(error.message, true);
    }
  };

  const loadEvents = async () => {
    eventsHost.textContent = 'Loading…';
    try {
      const payload = await api('/api/account/activity?limit=100');
      eventsHost.replaceChildren(...payload.events.map((event) => {
        const row = document.createElement('div');
        const label = activityLabel(event);
        const heading = document.createElement('strong');
        const detail = document.createElement('span');
        heading.textContent = `${label.who} · ${label.when}`;
        detail.textContent = label.summary;
        row.append(heading, detail);
        return row;
      }));
      if (!payload.events.length) eventsHost.textContent = 'No activity recorded yet.';
    } catch (error) {
      eventsHost.textContent = error.message;
    }
  };

  chip.addEventListener('click', () => {
    dialog.hidden = false;
    dialog.querySelector('input:not([hidden]), button:not([hidden])')?.focus();
  });
  close?.addEventListener('click', () => {
    if (accessRequired && !user) return;
    dialog.hidden = true;
    chip.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && disclaimerDialog?.open) return;
    if (event.key === 'Escape' && ownerDashboardDialog?.open) {
      event.preventDefault();
      closeOwnerDashboard();
      return;
    }
    if (event.key === 'Escape' && !dialog.hidden) {
      if (accessRequired && !user) return;
      dialog.hidden = true;
      chip.focus();
    }
  });
  tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.accountTab)));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    setStatus(mode === 'register' ? 'Creating account…' : 'Signing in…');
    const body = JSON.stringify({
      email: form.elements.email.value,
      password: form.elements.password.value,
      ownerSetupToken: mode === 'register' ? form.elements.ownerSetupToken.value : '',
    });
    try {
      const payload = await api(`/api/account/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body });
      form.elements.password.value = '';
      form.elements.ownerSetupToken.value = '';
      if (mode === 'register') {
        if (payload.user) {
          user = payload.user;
          setStatus(payload.message || 'Account approved.');
          paint();
          await continueAfterAuthentication();
        } else {
          setMode('login');
          setStatus(payload.message);
        }
      } else {
        user = payload.user;
        setStatus('Signed in.');
        paint();
        await continueAfterAuthentication();
      }
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  dialog.querySelector('[data-account-logout]')?.addEventListener('click', async () => {
    try { await api('/api/account/logout', { method: 'POST', body: '{}' }); } catch { /* Clear local UI anyway. */ }
    user = null;
    closeOwnerDashboard({ returnToAccount: false });
    paint();
    setStatus('Signed out.');
    if (accessRequired) location.reload();
  });
  activityButton?.addEventListener('click', () => {
    activityPanel.hidden = !activityPanel.hidden;
    if (!activityPanel.hidden) void loadEvents();
  });
  dialog.querySelector('[data-account-refresh]')?.addEventListener('click', loadEvents);
  ownerDashboardButton?.addEventListener('click', () => {
    if (user?.role !== 'owner' || !ownerDashboardDialog) return;
    activityPanel.hidden = true;
    dialog.hidden = true;
    if (!ownerDashboardDialog.open) ownerDashboardDialog.showModal();
    ownerRefreshButton?.focus();
    void loadOwnerDashboard();
  });
  ownerDashboardCloseButtons.forEach((button) => button.addEventListener('click', () => {
    closeOwnerDashboard();
  }));
  ownerDashboardDialog?.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeOwnerDashboard();
  });
  ownerRefreshButton?.addEventListener('click', loadOwnerDashboard);
  ownerAutopilotButton?.addEventListener('click', async () => {
    const enabled = ownerAutopilotButton.getAttribute('aria-pressed') !== 'true';
    ownerAutopilotButton.disabled = true;
    try {
      const payload = await api('/api/account/admin/autopilot', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      paintAutopilot(Boolean(payload.autopilot));
      setOwnerStatus(`REGISTRATION AUTOPILOT ${payload.autopilot ? 'ENABLED' : 'DISABLED'}`);
    } catch (error) {
      setOwnerStatus(error.message, true);
    } finally {
      ownerAutopilotButton.disabled = false;
    }
  });
  ownerAccountsHost?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-owner-account-action]');
    if (!button) return;
    button.disabled = true;
    try {
      await api('/api/account/admin/users', {
        method: 'POST',
        body: JSON.stringify({ userId: button.dataset.userId, action: button.dataset.ownerAccountAction }),
      });
      setOwnerStatus(`ACCOUNT ${button.dataset.ownerAccountAction === 'approve' ? 'APPROVED' : 'DENIED'}`);
      await loadOwnerDashboard();
    } catch (error) {
      setOwnerStatus(error.message, true);
      button.disabled = false;
    }
  });
  ownerLayersHost?.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-owner-layer-id]');
    if (!select) return;
    select.disabled = true;
    try {
      const payload = await api('/api/account/admin/layers', {
        method: 'POST',
        body: JSON.stringify({ layerId: select.dataset.ownerLayerId, status: select.value }),
      });
      renderOwnerLayers(payload.layers);
      window.dispatchEvent(new CustomEvent('gev:layer-availability-changed', {
        detail: { layers: payload.layers },
      }));
      setOwnerStatus(`${select.dataset.ownerLayerId.toUpperCase()} SET TO ${select.value.replace('_', ' ').toUpperCase()}`);
    } catch (error) {
      setOwnerStatus(error.message, true);
      await loadOwnerDashboard();
    }
  });

  document.getElementById('location-search')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendActivity('search', { query: event.currentTarget.value });
  }, true);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || dialog.contains(button)) return;
    const action = button.id || button.dataset.layerId || button.dataset.radioSource || button.dataset.collapseTarget;
    if (action) sendActivity('ui_action', { action });
  }, true);
  document.addEventListener('change', (event) => {
    const control = event.target.closest('select');
    if (!control) return;
    const filter = control.dataset.jurisdiction || control.id;
    if (filter) sendActivity('filter_change', { filter, value: control.value });
  }, true);
  window.addEventListener('gev:activity', (event) => sendActivity(event.detail?.type, event.detail?.metadata));

  api('/api/account/session').then((payload) => {
    user = payload.user;
    paint();
    if (user) void continueAfterAuthentication();
  }).catch(() => {
    chip.classList.add('account-unavailable');
    setStatus('Accounts are waiting for the Railway Postgres connection.', true);
  });
  sendActivity('page_view', { path: location.pathname });
  paint();
  return { getUser: () => user, sendActivity, continueAfterAuthentication };
}

export { sendActivity };
