const INTERFACE_FEATURES = Object.freeze({
  'interface-display': 'pp-toggles',
  'interface-cctv': 'cctv-panel',
  'interface-context': 'global-context-panel',
});

const LABELS = Object.freeze({
  coming_soon: 'COMING SOON',
  maintenance: 'MAINTENANCE',
});

function statusOf(features, id) {
  const row = features.find((feature) => String(feature?.id || feature?.layerId || '') === id);
  return ['live', 'coming_soon', 'maintenance', 'disabled'].includes(row?.status)
    ? row.status
    : 'live';
}

function installGuard(panel) {
  if (panel.dataset.ownerAvailabilityGuard === 'true') return;
  panel.dataset.ownerAvailabilityGuard = 'true';
  panel.addEventListener('click', (event) => {
    if (panel.dataset.featureAvailability === 'live') return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function restoreControls(panel) {
  panel.querySelectorAll('[data-owner-availability-disabled="true"]').forEach((control) => {
    control.disabled = false;
    delete control.dataset.ownerAvailabilityDisabled;
  });
}

function disableControls(panel) {
  panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)').forEach((control) => {
    control.disabled = true;
    control.dataset.ownerAvailabilityDisabled = 'true';
  });
}

/** Apply owner-governed visibility to the three primary interface modules. */
export function applyInterfaceAvailability(features = [], root = document) {
  for (const [featureId, panelId] of Object.entries(INTERFACE_FEATURES)) {
    const panel = root.getElementById(panelId);
    if (!panel) continue;
    const status = statusOf(features, featureId);
    panel.dataset.ownerFeature = featureId;
    panel.dataset.featureAvailability = status;
    panel.hidden = status === 'disabled';
    panel.setAttribute('aria-disabled', String(status !== 'live'));
    installGuard(panel);

    let badge = panel.querySelector(':scope > .interface-availability-badge');
    if (status === 'live' || status === 'disabled') {
      restoreControls(panel);
      badge?.remove();
      continue;
    }

    panel.classList.add('collapsed');
    disableControls(panel);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'interface-availability-badge';
      panel.appendChild(badge);
    }
    badge.textContent = LABELS[status];
  }
}

export { INTERFACE_FEATURES };
