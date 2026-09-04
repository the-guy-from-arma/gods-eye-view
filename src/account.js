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
  let mode = 'login';
  let user = null;
  let authenticationHandled = false;

  if (!chip || !dialog || !form || !status) return null;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  const paint = () => {
    signedOut.hidden = Boolean(user);
    signedIn.hidden = !user;
    chipLabel.textContent = user ? (user.role === 'owner' ? 'OWNER' : 'ACCOUNT') : 'ACCOUNT';
    if (!user) return;
    signedIn.querySelector('[data-account-email]').textContent = user.email;
    signedIn.querySelector('[data-account-role]').textContent = user.role === 'owner' ? 'OWNER ACCESS' : 'VERIFIED OPERATOR';
    activityButton.hidden = user.role !== 'owner';
    if (user.role !== 'owner') activityPanel.hidden = true;
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
    submit.textContent = mode === 'register' ? 'CREATE & VERIFY' : 'SIGN IN';
    form.elements.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    ownerSetupField.hidden = mode !== 'register';
    setStatus(mode === 'register' ? 'Use the one-time owner code, or receive an email verification link.' : '');
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
          setStatus('Owner account secured.');
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
    paint();
    setStatus('Signed out.');
    if (accessRequired) location.reload();
  });
  activityButton?.addEventListener('click', () => {
    activityPanel.hidden = !activityPanel.hidden;
    if (!activityPanel.hidden) void loadEvents();
  });
  dialog.querySelector('[data-account-refresh]')?.addEventListener('click', loadEvents);

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

  const verified = new URLSearchParams(location.search).get('verified') === '1';
  api('/api/account/session').then((payload) => {
    user = payload.user;
    paint();
    if (verified) {
      dialog.hidden = false;
      setStatus('Email verified. You can sign in now.');
    }
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
