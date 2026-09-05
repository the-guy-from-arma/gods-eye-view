function relativeAge(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'NEVER';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}S AGO`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}M AGO`;
  return `${Math.floor(seconds / 3600)}H AGO`;
}

function fieldValue(field) {
  if (field.type === 'checkbox') return field.checked;
  if (field.type === 'number' || field.type === 'range' || field.tagName === 'SELECT' && /^\d/.test(field.value)) return Number(field.value);
  return field.value;
}

function recordActivity(action, metadata = {}) {
  window.dispatchEvent(new CustomEvent('gev:activity', {
    detail: { type: 'filter_change', metadata: { feature: 'gamingData', action, ...metadata } },
  }));
}

export function initGamingDataPanel({ dataManager, layer }) {
  const panel = document.getElementById('gaming-data-panel');
  const master = panel?.querySelector('[data-gaming-master]');
  const controls = panel?.querySelector('[data-gaming-controls]');
  const status = panel?.querySelector('[data-gaming-status]');
  const freshness = panel?.querySelector('[data-gaming-freshness]');
  const stateChip = document.getElementById('gaming-data-layer-state');
  const gameList = panel?.querySelector('[data-gaming-game-list]');
  const gameSearch = panel?.querySelector('[data-gaming-game-search]');
  const fields = [...(panel?.querySelectorAll('[data-gaming-key]') || [])];
  if (!panel || !master || !controls || !status || !layer) return null;
  let gameQuery = '';
  let debounceTimer = null;
  let latestState = layer.getUIState();

  const availability = () => dataManager.getAll().find((entry) => entry.id === layer.id)?.availabilityStatus || 'live';

  const paintStats = (overview = {}) => {
    const values = {
      visibleServers: Number(overview.visibleServers || 0).toLocaleString(),
      onlineServers: Number(overview.onlineServers || 0).toLocaleString(),
      totalPlayers: Number(overview.totalPlayers || 0).toLocaleString(),
      gamesRepresented: Number(overview.gamesRepresented || 0).toLocaleString(),
      mostPopulatedGame: overview.mostPopulatedGame?.[0] || '—',
      mostPopulatedServer: overview.mostPopulatedServer?.name || '—',
      averageUtilization: `${Math.round(Number(overview.averageUtilization || 0) * 100)}%`,
      lastUpdate: relativeAge(overview.lastUpdate),
    };
    for (const [key, value] of Object.entries(values)) {
      const host = panel.querySelector(`[data-gaming-stat="${key}"]`);
      if (host) {
        host.textContent = value;
        host.title = value;
      }
    }
  };

  const paintGames = () => {
    const selected = new Set(latestState.filters.selectedGames);
    const query = gameQuery.trim().toLowerCase();
    const rows = latestState.games.filter((game) => {
      if (query && !`${game.name} ${game.id}`.toLowerCase().includes(query)) return false;
      if (latestState.filters.gamesWithResultsOnly && game.servers <= 0) return false;
      return true;
    });
    gameList.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.textContent = latestState.enabled ? 'No supported games match this search.' : 'Enable Gaming Data to load supported games.';
      gameList.append(empty);
      return;
    }
    for (const game of rows) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      const name = document.createElement('span');
      const count = document.createElement('output');
      checkbox.type = 'checkbox';
      checkbox.checked = latestState.filters.allGames || selected.has(game.id);
      checkbox.dataset.gameId = game.id;
      name.textContent = game.name;
      count.textContent = Number(game.servers || 0).toLocaleString();
      label.append(checkbox, name, count);
      gameList.append(label);
    }
  };

  const paintFields = () => {
    for (const field of fields) {
      const value = latestState.filters[field.dataset.gamingKey];
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else if (value !== undefined) field.value = String(value);
      if (field.type === 'range') {
        const output = field.parentElement?.querySelector('output');
        if (output) output.textContent = field.dataset.gamingKey === 'labelMinimumZoom'
          ? `Z${field.value}`
          : (field.dataset.gamingKey === 'clusterRadius' ? `${field.value} PX` : `${field.value}%`);
      }
    }
  };

  const paint = (state = layer.getUIState()) => {
    latestState = state;
    const availabilityStatus = availability();
    const live = availabilityStatus === 'live';
    master.checked = state.enabled;
    master.disabled = !live || state.loading;
    controls.setAttribute('aria-disabled', String(!state.enabled || !live));
    controls.classList.toggle('disabled', !state.enabled || !live);
    for (const field of fields) {
      if (field.dataset.gamingKey !== 'publicPlayerNames') field.disabled = !state.enabled || !live;
    }
    for (const button of controls.querySelectorAll('button')) button.disabled = !state.enabled || !live || state.loading;
    gameSearch.disabled = !state.enabled || !live;
    if (!live) {
      const label = availabilityStatus === 'maintenance' ? 'MAINTENANCE' : 'COMING SOON';
      stateChip.textContent = label;
      status.textContent = availabilityStatus === 'maintenance'
        ? 'Gaming Data is temporarily in maintenance mode.'
        : 'Gaming Data is being prepared and is not publicly available yet.';
    } else if (!state.enabled) {
      stateChip.textContent = 'OFF';
      status.textContent = 'Gaming Data is off. No provider requests are running.';
    } else if (state.loading) {
      stateChip.textContent = 'SYNC';
      status.textContent = 'Loading cached and live BattleMetrics server data…';
    } else if (state.error && !state.serverCount) {
      stateChip.textContent = 'UNAVAILABLE';
      status.textContent = state.error;
    } else {
      stateChip.textContent = state.stale ? 'STALE' : (state.partial ? 'PARTIAL' : 'LIVE');
      const cacheLabel = state.stale ? 'STALE CACHE' : (state.cached ? 'CACHE' : 'FRESH');
      status.textContent = `${state.filteredCount.toLocaleString()} FILTERED · ${state.mappedCount.toLocaleString()} MAPPED · ${cacheLabel} · ${state.authMode.toUpperCase()} API${state.error ? ` · ${state.error}` : ''}`;
    }
    freshness.textContent = `LAST SUCCESS · ${relativeAge(state.lastUpdate)} · DATA AGE ${relativeAge(state.lastUpdate)}${state.cached ? ' · CACHED' : ''}${state.stale ? ' · STALE WARNING' : ''}`;
    paintStats(state.overview);
    paintFields();
    paintGames();
  };

  const applyField = (field, immediate = false) => {
    const key = field.dataset.gamingKey;
    if (!key || key === 'publicPlayerNames') return;
    const run = () => {
      dataManager.setLayerParams(layer.id, { [key]: fieldValue(field) }, { origin: 'user' });
      recordActivity('gaming_filter', { key });
    };
    clearTimeout(debounceTimer);
    if (immediate || field.type === 'checkbox' || field.tagName === 'SELECT' || field.type === 'range') run();
    else debounceTimer = setTimeout(run, 260);
  };

  master.addEventListener('change', async () => {
    master.disabled = true;
    const enabled = await dataManager.setEnabled(layer.id, master.checked, { origin: 'user' });
    recordActivity(master.checked ? 'gaming_enabled' : 'gaming_disabled');
    if (master.checked && enabled === false) master.checked = false;
    paint();
  });
  for (const field of fields) {
    field.addEventListener(field.type === 'range' ? 'input' : 'change', () => applyField(field));
    if (field.type === 'search' || field.type === 'text' || field.type === 'number') field.addEventListener('input', () => applyField(field));
  }
  gameSearch.addEventListener('input', () => { gameQuery = gameSearch.value; paintGames(); });
  gameList.addEventListener('change', (event) => {
    const checkbox = event.target.closest?.('[data-game-id]');
    if (!checkbox) return;
    const selected = new Set(latestState.filters.allGames
      ? latestState.games.map((game) => game.id).slice(0, 24)
      : latestState.filters.selectedGames);
    if (checkbox.checked) selected.add(checkbox.dataset.gameId);
    else selected.delete(checkbox.dataset.gameId);
    dataManager.setLayerParams(layer.id, { allGames: false, selectedGames: [...selected] }, { origin: 'user' });
    recordActivity('gaming_game_selection', { selectedCount: selected.size });
  });
  panel.querySelector('[data-gaming-games-all]')?.addEventListener('click', () => {
    dataManager.setLayerParams(layer.id, { allGames: true, selectedGames: [] }, { origin: 'user' });
    recordActivity('gaming_select_all_games', { selectedCount: latestState.games.length });
  });
  panel.querySelector('[data-gaming-games-clear]')?.addEventListener('click', () => {
    dataManager.setLayerParams(layer.id, { allGames: false, selectedGames: [] }, { origin: 'user' });
    recordActivity('gaming_clear_games');
  });
  panel.querySelector('[data-gaming-refresh]')?.addEventListener('click', async () => {
    recordActivity('gaming_manual_refresh');
    await layer.update();
    paint();
  });
  panel.querySelector('[data-gaming-reset]')?.addEventListener('click', () => {
    layer.resetFilters();
    gameQuery = '';
    gameSearch.value = '';
    recordActivity('gaming_reset_filters');
    paint();
  });
  layer.subscribe(paint);
  dataManager.subscribe((event) => {
    if (event.layerId === layer.id || event.type === 'availability') paint();
  });
  window.addEventListener('gev:gaming-data-visible-change', (event) => paintStats(event.detail));
  const ageTimer = setInterval(() => {
    if (latestState.enabled) {
      freshness.textContent = `LAST SUCCESS · ${relativeAge(latestState.lastUpdate)} · DATA AGE ${relativeAge(latestState.lastUpdate)}${latestState.cached ? ' · CACHED' : ''}${latestState.stale ? ' · STALE WARNING' : ''}`;
    }
  }, 30_000);
  paint();
  return { destroy: () => clearInterval(ageTimer), paint };
}
