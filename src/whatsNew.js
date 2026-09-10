import { RELEASE_ANNOUNCEMENT } from './releaseAnnouncement.js';

let initialized = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function localAcknowledgementKey(userId) {
  return `gev:whats-new:${userId || 'operator'}:${RELEASE_ANNOUNCEMENT.id}`;
}

function locallyAcknowledged(userId) {
  try { return localStorage.getItem(localAcknowledgementKey(userId)) === '1'; } catch { return false; }
}

function rememberLocally(userId) {
  try { localStorage.setItem(localAcknowledgementKey(userId), '1'); } catch { /* Postgres acknowledgement remains authoritative. */ }
}

function populate(dialog) {
  const releaseHost = dialog.querySelector('[data-whats-new-releases]');
  const soonHost = dialog.querySelector('[data-whats-new-coming-soon]');
  const releaseRows = RELEASE_ANNOUNCEMENT.releases.map((release) => {
    const row = document.createElement('article');
    row.innerHTML = `<span>${release.version}</span><div><strong></strong><p></p></div>`;
    row.querySelector('strong').textContent = release.title;
    row.querySelector('p').textContent = release.summary;
    return row;
  });
  const soonRows = RELEASE_ANNOUNCEMENT.comingSoon.map((item, index) => {
    const row = document.createElement('article');
    row.innerHTML = `<span>0${index + 1}</span><div><strong></strong><p></p></div>`;
    row.querySelector('strong').textContent = item.title;
    row.querySelector('p').textContent = item.summary;
    return row;
  });
  releaseHost.replaceChildren(...releaseRows);
  soonHost.replaceChildren(...soonRows);
  dialog.querySelector('[data-whats-new-range]').textContent = RELEASE_ANNOUNCEMENT.range;
  dialog.querySelector('[data-whats-new-title]').textContent = RELEASE_ANNOUNCEMENT.title;
  dialog.querySelector('[data-whats-new-intro]').textContent = RELEASE_ANNOUNCEMENT.intro;
}

async function waitForConsoleReveal() {
  const loading = document.getElementById('loading-screen');
  if (loading && !loading.classList.contains('hidden')) {
    await new Promise((resolve) => {
      const finish = () => resolve();
      loading.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 1_800);
    });
  }
  // Fresh accounts receive the guided first-run launcher first. Do not stack
  // two onboarding surfaces; queue the release briefing until that one closes.
  await new Promise((resolve) => setTimeout(resolve, 80));
  const firstRun = document.getElementById('first-run-launcher');
  if (!firstRun || firstRun.hidden) return;
  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!firstRun.hidden) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(firstRun, { attributes: true, attributeFilter: ['hidden'] });
  });
}

export async function initWhatsNew({ user } = {}) {
  const dialog = document.getElementById('whats-new-dialog');
  const manualOpen = document.querySelector('[data-whats-new-open]');
  if (!dialog || initialized) return null;
  initialized = true;
  populate(dialog);
  let status = { enabled: false, acknowledged: true };
  let acknowledgementPending = false;

  const selectTab = (name) => {
    dialog.querySelectorAll('[data-whats-new-tab]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.whatsNewTab === name));
    });
    dialog.querySelectorAll('[data-whats-new-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.whatsNewPanel !== name;
    });
  };

  const acknowledge = async () => {
    if (acknowledgementPending || status.acknowledged) return;
    acknowledgementPending = true;
    rememberLocally(user?.id);
    try {
      await api('/api/account/whats-new/acknowledge', {
        method: 'POST', body: JSON.stringify({ announcementId: RELEASE_ANNOUNCEMENT.id }),
      });
      status.acknowledged = true;
    } catch { /* Local acknowledgement prevents a disruptive repeat until Postgres recovers. */ }
    acknowledgementPending = false;
  };

  const close = () => {
    void acknowledge();
    if (dialog.open) dialog.close();
  };

  const open = ({ automatic = false } = {}) => {
    if (!status.enabled || dialog.open) return;
    selectTab('added');
    dialog.showModal();
    dialog.dataset.openReason = automatic ? 'login' : 'manual';
    dialog.querySelector('[data-whats-new-close]')?.focus();
  };

  dialog.querySelectorAll('[data-whats-new-tab]').forEach((button) => {
    button.addEventListener('click', () => selectTab(button.dataset.whatsNewTab));
  });
  dialog.querySelectorAll('[data-whats-new-close]').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  manualOpen?.addEventListener('click', () => open());
  window.addEventListener('gev:whats-new-availability', (event) => {
    status.enabled = Boolean(event.detail?.enabled);
    if (!status.enabled && dialog.open) dialog.close();
  });

  try {
    status = await api('/api/account/whats-new');
    if (status.enabled && !status.acknowledged && !locallyAcknowledged(user?.id)) {
      await waitForConsoleReveal();
      open({ automatic: true });
    }
  } catch { /* An announcement must never block the command console. */ }
  return { open, close, getStatus: () => ({ ...status }) };
}
