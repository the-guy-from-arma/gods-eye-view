const FILTER_ORDER = ['country', 'region', 'county', 'city', 'agency', 'service'];

function option(value, label = value) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function filterJurisdictionRows(rows, selected, untilKey = null) {
  const limit = untilKey ? FILTER_ORDER.indexOf(untilKey) : FILTER_ORDER.length;
  return rows.filter((row) => FILTER_ORDER.slice(0, limit).every((key) => !selected[key] || row[key] === selected[key]));
}

export function initPublicSafetyPreview() {
  const radioPanel = document.getElementById('radio-panel');
  if (!radioPanel) return null;
  const tabs = [...radioPanel.querySelectorAll('[data-radio-source]')];
  const broadcast = radioPanel.querySelector('[data-radio-broadcast-controls]');
  const scanner = radioPanel.querySelector('[data-scanner-preview]');
  const controls = Object.fromEntries([...radioPanel.querySelectorAll('[data-jurisdiction]')].map((node) => [node.dataset.jurisdiction, node]));
  let rows = [];

  const selected = () => Object.fromEntries(FILTER_ORDER.map((key) => [key, controls[key]?.value || '']));
  const refresh = () => {
    const values = selected();
    for (const key of FILTER_ORDER) {
      const control = controls[key];
      if (!control || key === 'service') continue;
      const current = control.value;
      const labels = key === 'country'
        ? new Map(rows.map((row) => [row.country, row.countryName || row.country]))
        : null;
      const available = uniqueValues(filterJurisdictionRows(rows, values, key), key);
      const first = control.options[0]?.cloneNode(true) || option('', `All ${key}`);
      control.replaceChildren(first, ...available.map((value) => option(value, labels?.get(value) || value)));
      control.value = available.includes(current) ? current : '';
      values[key] = control.value;
    }
  };

  const setTab = (name) => {
    tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.radioSource === name)));
    broadcast.hidden = name !== 'broadcast';
    scanner.hidden = name !== 'scanner';
    if (name === 'scanner') window.dispatchEvent(new CustomEvent('gev:activity', { detail: { type: 'scanner_interest', metadata: selected() } }));
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.radioSource)));
  Object.values(controls).forEach((control) => control.addEventListener('change', refresh));

  fetch('/api/public-safety/jurisdictions')
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
    .then((payload) => {
      rows = Array.isArray(payload.sources) ? payload.sources.map((row) => ({
        country: row.countryCode,
        countryName: row.countryName,
        region: row.region,
        county: row.county,
        city: row.city,
        agency: row.agency,
        service: row.service,
      })) : [];
      refresh();
    })
    .catch(() => { /* The Coming Soon surface remains useful before Postgres is attached. */ });

  setTab('broadcast');
  return { setTab, refresh };
}
