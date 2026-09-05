const FILTER_ORDER = ['country', 'region', 'county', 'city', 'agency', 'service'];
const AREA_KEYS = ['country', 'region', 'county', 'city'];
const MAX_VISIBLE_FEEDS = 14;
const MAX_MATCH_ALTITUDE_M = 3_000_000;

function option(value, label = value) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function comparable(value, key = '') {
  let text = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (key === 'county') {
    text = text.replace(/\b(county|parish|borough|census area|municipality|district)\b/g, '').replace(/\s+/g, ' ').trim();
  }
  return text;
}

function sameArea(left, right, key = '') {
  return Boolean(left && right) && comparable(left, key) === comparable(right, key);
}

function firstMatchingValue(rows, key, value) {
  return rows.map((row) => row[key]).find((candidate) => sameArea(candidate, value, key)) || '';
}

export function normalizeDirectStreamUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || !url.hostname) return null;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function filterJurisdictionRows(rows, selected, untilKey = null) {
  const limit = untilKey ? FILTER_ORDER.indexOf(untilKey) : FILTER_ORDER.length;
  return rows.filter((row) => FILTER_ORDER.slice(0, limit).every((key) => !selected[key] || row[key] === selected[key]));
}

/** Find the deepest available catalog jurisdiction for a reverse-geocoded view. */
export function matchCatalogJurisdiction(rows, jurisdiction = {}) {
  const countryCandidates = rows.filter((row) => (
    sameArea(row.country, jurisdiction.countryCode, 'country')
    || sameArea(row.country, jurisdiction.country, 'country')
    || sameArea(row.countryName, jurisdiction.country, 'country')
  ));
  if (!countryCandidates.length) return { rows: [], selection: {}, level: null, label: '' };

  const selection = { country: countryCandidates[0].country };
  let candidates = countryCandidates;
  let level = 'country';
  let label = countryCandidates[0].countryName || jurisdiction.country || countryCandidates[0].country;

  const regionValue = firstMatchingValue(candidates, 'region', jurisdiction.region);
  if (regionValue) {
    selection.region = regionValue;
    candidates = candidates.filter((row) => row.region === regionValue);
    level = 'region';
    label = regionValue;
  }

  const countyValue = firstMatchingValue(candidates, 'county', jurisdiction.county);
  const cityValue = firstMatchingValue(candidates, 'city', jurisdiction.city);
  if (countyValue || cityValue) {
    const local = candidates.filter((row) => (
      (countyValue && sameArea(row.county, countyValue, 'county'))
      || (cityValue && sameArea(row.city, cityValue, 'city'))
    ));
    if (local.length) candidates = local;
  }
  if (countyValue) {
    selection.county = countyValue;
    level = 'county';
    label = countyValue;
  }
  if (cityValue) {
    selection.city = cityValue;
    level = 'city';
    label = cityValue;
  }

  return { rows: candidates, selection, level, label };
}

function viewCoordinates(viewer) {
  const scene = viewer?.scene;
  const camera = viewer?.camera;
  const canvas = scene?.canvas;
  if (!scene || !camera || !canvas) return null;
  const width = canvas.clientWidth || canvas.width || 0;
  const height = canvas.clientHeight || canvas.height || 0;
  let cartesian = null;
  const center = { x: width / 2, y: height / 2 };
  if (width && height && scene.pickPositionSupported && typeof scene.pickPosition === 'function') {
    try { cartesian = scene.pickPosition(center); } catch { cartesian = null; }
  }
  if (!cartesian && width && height && typeof camera.pickEllipsoid === 'function') {
    try { cartesian = camera.pickEllipsoid(center, scene.globe?.ellipsoid); } catch { cartesian = null; }
  }
  let cartographic = null;
  if (cartesian && typeof scene.globe?.ellipsoid?.cartesianToCartographic === 'function') {
    try { cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian); } catch { cartographic = null; }
  }
  cartographic ||= camera.positionCartographic || null;
  if (!cartographic) return null;
  const latitude = Number(cartographic.latitude) * 180 / Math.PI;
  const longitude = Number(cartographic.longitude) * 180 / Math.PI;
  const altitude = Number(camera.positionCartographic?.height);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, altitude }
    : null;
}

function feedRow(feed, onPlay) {
  const article = document.createElement('article');
  article.className = 'scanner-feed-card';
  const summary = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = feed.name || feed.agency || 'Public safety feed';
  const meta = document.createElement('span');
  const area = [feed.city, feed.county, feed.region].filter(Boolean).join(' · ');
  const listeners = Number.isFinite(feed.listeners) ? `${feed.listeners.toLocaleString()} listeners` : '';
  meta.textContent = [area, feed.service, listeners].filter(Boolean).join(' · ');
  summary.append(name, meta);
  article.append(summary);
  const actions = document.createElement('div');
  actions.className = 'scanner-feed-actions';
  if (feed.streamUrl && feed.online !== false) {
    const play = document.createElement('button');
    play.type = 'button';
    play.textContent = 'PLAY';
    play.setAttribute('aria-label', `Play ${feed.name || 'feed'} inside God’s Eye`);
    play.addEventListener('click', () => onPlay(feed));
    actions.append(play);
  }
  if (feed.officialUrl) {
    const link = document.createElement('a');
    link.href = feed.officialUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'OPEN';
    link.setAttribute('aria-label', `Open ${feed.name || 'feed'} on Broadcastify`);
    actions.append(link);
  }
  article.append(actions);
  return article;
}

export function initPublicSafetyPreview() {
  const radioPanel = document.getElementById('radio-panel');
  if (!radioPanel) return null;
  const tabs = [...radioPanel.querySelectorAll('[data-radio-source]')];
  const broadcast = radioPanel.querySelector('[data-radio-broadcast-controls]');
  const scanner = radioPanel.querySelector('[data-scanner-preview]');
  const status = radioPanel.querySelector('[data-scanner-auto-status]');
  const results = radioPanel.querySelector('[data-scanner-results]');
  const streamForm = radioPanel.querySelector('[data-scanner-stream-form]');
  const streamInput = radioPanel.querySelector('[data-scanner-stream-url]');
  const streamAudio = radioPanel.querySelector('[data-scanner-stream-audio]');
  const streamStop = radioPanel.querySelector('[data-scanner-stream-stop]');
  const streamState = radioPanel.querySelector('[data-scanner-stream-state]');
  const controls = Object.fromEntries([...radioPanel.querySelectorAll('[data-jurisdiction]')].map((node) => [node.dataset.jurisdiction, node]));
  let rows = [];
  let activeTab = 'broadcast';
  let viewer = null;
  let moveEndHandler = null;
  let settleTimer = null;
  let reverseController = null;
  let lastViewKey = '';
  let availabilityStatus = 'live';

  const selected = () => Object.fromEntries(FILTER_ORDER.map((key) => [key, controls[key]?.value || '']));
  const setStreamState = (message, error = false) => {
    if (!streamState) return;
    streamState.textContent = message;
    streamState.classList.toggle('error', error);
  };
  const stopDirectStream = () => {
    if (!streamAudio) return;
    streamAudio.pause();
    streamAudio.removeAttribute('src');
    streamAudio.load();
    if (streamStop) streamStop.disabled = true;
    setStreamState('Stream stopped. Paste or reload an authorized HTTPS audio URL.');
  };
  const loadDirectStream = async (providedUrl = null) => {
    const streamUrl = normalizeDirectStreamUrl(providedUrl || streamInput?.value);
    if (!streamUrl) {
      setStreamState('Enter a valid HTTPS direct audio URL. A webpage URL cannot be played as audio.', true);
      return false;
    }
    if (streamInput) streamInput.value = streamUrl;
    document.getElementById('radio-stop-btn')?.click();
    streamAudio.src = streamUrl;
    streamAudio.load();
    if (streamStop) streamStop.disabled = false;
    setStreamState('Connecting directly to the stream host…');
    try {
      await streamAudio.play();
      setStreamState('LIVE · Direct stream playing inside God’s Eye.');
      window.dispatchEvent(new CustomEvent('gev:activity', {
        detail: { type: 'scanner_stream_started', metadata: { direct: true } },
      }));
      return true;
    } catch (error) {
      const blocked = error?.name === 'NotAllowedError';
      setStreamState(blocked
        ? 'Stream loaded. Press play in the audio controls to begin.'
        : 'The host rejected playback or the URL is not a browser-compatible audio stream.', !blocked);
      return false;
    }
  };
  const renderFeeds = (visibleRows = filterJurisdictionRows(rows, selected())) => {
    if (!results) return;
    results.replaceChildren();
    const shown = visibleRows.slice(0, MAX_VISIBLE_FEEDS);
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'scanner-feed-empty';
      empty.textContent = rows.length ? 'No catalog feeds match this jurisdiction.' : 'The authorized catalog is not available yet.';
      results.append(empty);
      return;
    }
    results.append(...shown.map((feed) => feedRow(feed, (selectedFeed) => {
      setStreamState(`CONNECTING · ${selectedFeed.name || 'Broadcastify feed'}`);
      void loadDirectStream(selectedFeed.streamUrl);
    })));
    if (visibleRows.length > shown.length) {
      const more = document.createElement('p');
      more.className = 'scanner-feed-more';
      more.textContent = `+ ${visibleRows.length - shown.length} additional matching feeds`;
      results.append(more);
    }
  };

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
    renderFeeds();
  };

  const applySelection = (selection) => {
    for (const key of AREA_KEYS) if (controls[key]) controls[key].value = '';
    refresh();
    for (const key of AREA_KEYS) {
      const value = selection[key];
      if (!value || !controls[key]) continue;
      controls[key].value = [...controls[key].options].some((item) => item.value === value) ? value : '';
      refresh();
    }
  };

  const matchCurrentView = async ({ force = false } = {}) => {
    if (!viewer || activeTab !== 'scanner' || !rows.length) return;
    const coordinates = viewCoordinates(viewer);
    if (!coordinates) return;
    if (Number.isFinite(coordinates.altitude) && coordinates.altitude > MAX_MATCH_ALTITUDE_M) {
      if (status) status.textContent = 'ZOOM CLOSER TO MATCH A LOCAL JURISDICTION';
      return;
    }
    const viewKey = `${coordinates.latitude.toFixed(2)},${coordinates.longitude.toFixed(2)}`;
    if (!force && viewKey === lastViewKey) return;
    lastViewKey = viewKey;
    reverseController?.abort();
    reverseController = new AbortController();
    if (status) status.textContent = 'MATCHING VIEW TO AUTHORIZED CATALOG…';
    try {
      const params = new URLSearchParams({
        lat: coordinates.latitude.toFixed(6),
        lon: coordinates.longitude.toFixed(6),
      });
      const response = await fetch(`/api/location/reverse?${params}`, { signal: reverseController.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.jurisdiction) throw new Error(payload.error || 'Jurisdiction unavailable');
      const match = matchCatalogJurisdiction(rows, payload.jurisdiction);
      applySelection(match.selection);
      renderFeeds(match.rows);
      if (status) {
        status.textContent = match.rows.length
          ? `VIEW MATCH · ${match.label.toUpperCase()} · ${match.rows.length.toLocaleString()} FEED${match.rows.length === 1 ? '' : 'S'}`
          : `NO CATALOG MATCH · ${payload.jurisdiction.formattedAddress || 'CURRENT VIEW'}`;
      }
      window.dispatchEvent(new CustomEvent('gev:activity', {
        detail: {
          type: 'scanner_jurisdiction_match',
          metadata: { ...match.selection, matchLevel: match.level, matchCount: match.rows.length },
        },
      }));
    } catch (error) {
      if (error?.name !== 'AbortError' && status) status.textContent = 'JURISDICTION MATCH TEMPORARILY UNAVAILABLE';
    } finally {
      reverseController = null;
    }
  };

  const setTab = (name) => {
    if (name === 'scanner' && availabilityStatus !== 'live') return;
    activeTab = name;
    tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.radioSource === name)));
    broadcast.hidden = name !== 'broadcast';
    scanner.hidden = name !== 'scanner';
    if (name === 'scanner') {
      window.dispatchEvent(new CustomEvent('gev:activity', { detail: { type: 'scanner_interest', metadata: selected() } }));
      void matchCurrentView({ force: true });
    }
  };

  const applyAvailability = (layers = []) => {
    const configured = (Array.isArray(layers) ? layers : []).find((layer) => (
      (layer.id || layer.layerId) === 'law-enforcement-transmissions'
    ));
    availabilityStatus = configured?.status || 'live';
    const scannerTab = tabs.find((tab) => tab.dataset.radioSource === 'scanner');
    if (!scannerTab) return;
    const hidden = availabilityStatus === 'disabled';
    const unavailable = availabilityStatus !== 'live';
    scannerTab.hidden = hidden;
    scannerTab.disabled = unavailable;
    scannerTab.dataset.availabilityStatus = availabilityStatus;
    scannerTab.textContent = availabilityStatus === 'coming_soon'
      ? 'LAW ENFORCEMENT · SOON'
      : availabilityStatus === 'maintenance'
        ? 'LAW ENFORCEMENT · MAINT'
        : 'LAW ENFORCEMENT';
    if (activeTab === 'scanner' && unavailable) {
      stopDirectStream();
      setTab('broadcast');
    }
  };

  const attachViewer = (nextViewer) => {
    if (viewer && moveEndHandler) viewer.camera?.moveEnd?.removeEventListener?.(moveEndHandler);
    viewer = nextViewer;
    moveEndHandler = () => {
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => void matchCurrentView(), 450);
    };
    viewer?.camera?.moveEnd?.addEventListener?.(moveEndHandler);
    if (activeTab === 'scanner') void matchCurrentView({ force: true });
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.radioSource)));
  Object.values(controls).forEach((control) => control.addEventListener('change', () => {
    refresh();
    if (status) status.textContent = 'MANUAL JURISDICTION FILTER';
  }));
  streamForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void loadDirectStream();
  });
  streamStop?.addEventListener('click', stopDirectStream);
  streamAudio?.addEventListener('playing', () => setStreamState('LIVE · Direct stream playing inside God’s Eye.'));
  streamAudio?.addEventListener('waiting', () => setStreamState('BUFFERING · Waiting for stream audio…'));
  streamAudio?.addEventListener('error', () => setStreamState(
    'Playback failed. Confirm this is a direct HTTPS MP3/AAC stream—not a feed webpage or playlist requiring authorization.',
    true,
  ));

  fetch('/api/broadcastify/feeds')
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Catalog unavailable');
      return payload;
    })
    .then((payload) => {
      rows = Array.isArray(payload.feeds) ? payload.feeds.map((row) => ({
        id: row.id,
        feedId: row.feedId,
        name: row.name,
        country: row.countryCode,
        countryName: row.country,
        region: row.region,
        county: row.county,
        city: row.city,
        agency: row.agency,
        service: row.service,
        listeners: row.listeners,
        online: row.online,
        officialUrl: row.officialUrl,
        streamUrl: row.streamUrl,
      })) : [];
      refresh();
      if (status) status.textContent = `${rows.length.toLocaleString()} AUTHORIZED CATALOG FEEDS · MOVE OR ZOOM TO MATCH`;
      void matchCurrentView({ force: true });
    })
    .catch((error) => {
      if (status) status.textContent = String(error?.message || 'CATALOG UNAVAILABLE').toUpperCase();
      renderFeeds();
    });

  setTab('broadcast');
  window.addEventListener('gev:layer-availability-changed', (event) => applyAvailability(event.detail?.layers));
  return { setTab, refresh, attachViewer, matchCurrentView, loadDirectStream, stopDirectStream, applyAvailability };
}
