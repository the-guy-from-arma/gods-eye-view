import { CURRENT_LEGAL_VERSION } from './legalPolicy.js';

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
  const legalRenewal = dialog?.querySelector('[data-account-legal-renewal]');
  const legalRenewalCheck = dialog?.querySelector('[data-account-legal-renewal-check]');
  const legalAcceptButton = dialog?.querySelector('[data-account-legal-accept]');
  const systemModeGate = document.getElementById('system-mode-gate');
  const systemModeTitle = systemModeGate?.querySelector('[data-system-mode-title]');
  const systemModeMessage = systemModeGate?.querySelector('[data-system-mode-message]');
  const systemModeCode = systemModeGate?.querySelector('[data-system-mode-code]');
  const systemOwnerAccess = systemModeGate?.querySelector('[data-system-owner-access]');
  const disclaimerDialog = document.getElementById('platform-disclaimer-dialog');
  const disclaimerOpen = dialog?.querySelector('[data-disclaimer-open]');
  const disclaimerCloseButtons = [...(disclaimerDialog?.querySelectorAll('[data-disclaimer-close]') || [])];
  let mode = 'login';
  let user = null;
  let siteMode = { mode: 'online', label: 'Systems Online', message: '' };
  let authenticationHandled = false;
  let legalAcceptanceRequired = false;
  let ownerAccessRequested = false;

  if (!chip || !dialog || !form || !status) return null;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  // A site-wide operating mode applies to every globe session, including the
  // owner. Owners recover through the dedicated command page rather than a
  // hidden bypass that makes Maintenance appear ineffective in their browser.
  const siteAccessBlocked = () => siteMode.mode !== 'online';

  const routeOwnerToCommand = () => {
    if (!siteAccessBlocked() || user?.role !== 'owner') return false;
    window.location.assign('/owner.html');
    return true;
  };

  const paintSystemMode = () => {
    const blocked = siteAccessBlocked();
    if (systemModeGate) systemModeGate.hidden = !blocked;
    if (!blocked) {
      ownerAccessRequested = false;
      return;
    }
    if (systemModeTitle) systemModeTitle.textContent = siteMode.label;
    if (systemModeMessage) systemModeMessage.textContent = siteMode.message;
    if (systemModeCode) systemModeCode.textContent = `LINK STATUS · ${siteMode.mode.replaceAll('_', ' ').toUpperCase()}`;
    if (systemOwnerAccess) {
      const label = user?.role === 'owner' ? 'Open Owner Command' : 'Owner sign in';
      systemOwnerAccess.setAttribute('aria-label', label);
      systemOwnerAccess.title = label;
    }
    if (!ownerAccessRequested) dialog.hidden = true;
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
    paintSystemMode();
    if (!user) return;
    signedIn.querySelector('[data-account-email]').textContent = user.email;
    signedIn.querySelector('[data-account-role]').textContent = user.role === 'owner' ? 'OWNER ACCESS' : 'APPROVED OPERATOR';
    if (legalRenewal) legalRenewal.hidden = !legalAcceptanceRequired;
    activityButton.hidden = user.role !== 'owner' || legalAcceptanceRequired;
    ownerDashboardButton.hidden = user.role !== 'owner' || legalAcceptanceRequired;
    if (user.role !== 'owner') {
      activityPanel.hidden = true;
    }
  };

  const continueAfterAuthentication = async () => {
    if (!user || legalAcceptanceRequired || authenticationHandled || siteAccessBlocked()) return;
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
    if (accessRequired && (!user || legalAcceptanceRequired)) return;
    dialog.hidden = true;
    chip.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && disclaimerDialog?.open) return;
    if (event.key === 'Escape' && !dialog.hidden) {
      if (accessRequired && (!user || legalAcceptanceRequired)) return;
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
      legalAccepted: form.elements.legalAccepted.checked,
      legalVersion: CURRENT_LEGAL_VERSION,
    });
    try {
      const payload = await api(`/api/account/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body });
      form.elements.password.value = '';
      form.elements.ownerSetupToken.value = '';
      if (mode === 'register') {
        if (payload.user) {
          user = payload.user;
          legalAcceptanceRequired = false;
          setStatus(payload.message || 'Account approved.');
          paint();
          if (routeOwnerToCommand()) return;
          await continueAfterAuthentication();
        } else {
          setMode('login');
          setStatus(payload.message);
        }
      } else {
        user = payload.user;
        legalAcceptanceRequired = false;
        setStatus('Signed in.');
        paint();
        if (routeOwnerToCommand()) return;
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
    legalAcceptanceRequired = false;
    paint();
    setStatus('Signed out.');
    if (accessRequired) location.reload();
  });
  legalAcceptButton?.addEventListener('click', async () => {
    if (!legalRenewalCheck?.checked) {
      setStatus('You must affirmatively accept the complete legal bundle to continue.', true);
      legalRenewalCheck?.focus();
      return;
    }
    legalAcceptButton.disabled = true;
    setStatus('Recording legal acceptance…');
    try {
      const payload = await api('/api/account/accept-legal', {
        method: 'POST',
        body: JSON.stringify({ legalAccepted: true, legalVersion: CURRENT_LEGAL_VERSION }),
      });
      legalAcceptanceRequired = false;
      user = { ...user, legalAccepted: true, legalAcceptedAt: payload.acceptedAt };
      legalRenewalCheck.checked = false;
      setStatus('Terms accepted. Starting command console.');
      paint();
      if (routeOwnerToCommand()) return;
      await continueAfterAuthentication();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      legalAcceptButton.disabled = false;
    }
  });
  activityButton?.addEventListener('click', () => {
    activityPanel.hidden = !activityPanel.hidden;
    if (!activityPanel.hidden) void loadEvents();
  });
  dialog.querySelector('[data-account-refresh]')?.addEventListener('click', loadEvents);
  ownerDashboardButton?.addEventListener('click', () => {
    if (user?.role === 'owner') window.location.assign('/owner.html');
  });
  systemOwnerAccess?.addEventListener('click', () => {
    if (user?.role === 'owner') {
      window.location.assign('/owner.html');
      return;
    }
    ownerAccessRequested = true;
    dialog.hidden = false;
    form.elements.email?.focus();
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

  const synchronizeSession = async ({ initial = false } = {}) => {
    const payload = await api('/api/account/session');
    const previousUser = user;
    const previousSiteMode = siteMode.mode;
    user = payload.user;
    legalAcceptanceRequired = Boolean(payload.legalAcceptanceRequired);
    siteMode = payload.siteMode || siteMode;
    if (!initial && previousUser && !user) {
      location.reload();
      return;
    }
    paint();
    // The globe is blocked for every account during a shutdown, but the sole
    // configured owner is routed to the independently protected recovery page.
    if (routeOwnerToCommand()) return;
    // If a running console receives a shutdown mode, reload once so the heavy
    // globe runtime and live-feed pollers are actually stopped behind the
    // command gate. On this reload authentication never starts main.js while
    // the mode remains blocked.
    if (!initial && previousSiteMode === 'online' && siteAccessBlocked() && authenticationHandled) {
      location.reload();
      return;
    }
    if (user && legalAcceptanceRequired) {
      dialog.hidden = false;
      setStatus(`Review and accept legal version ${payload.legalVersion || CURRENT_LEGAL_VERSION} to continue.`);
      return;
    }
    if (user) void continueAfterAuthentication();
  };

  synchronizeSession({ initial: true }).then(() => {
    window.setInterval(() => synchronizeSession().catch(() => {}), 5_000);
    window.addEventListener('storage', (event) => {
      if (event.key === 'gev:site-mode-pulse') void synchronizeSession().catch(() => {});
    });
  }).catch(() => {
    chip.classList.add('account-unavailable');
    setStatus('Accounts are waiting for the Railway Postgres connection.', true);
  });
  sendActivity('page_view', { path: location.pathname });
  paint();
  return { getUser: () => user, sendActivity, continueAfterAuthentication };
}

export { sendActivity };
