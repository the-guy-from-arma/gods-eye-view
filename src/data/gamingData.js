import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';
import {
  DEFAULT_GAMING_DATA_FILTERS,
  GAMING_DATA_STORAGE_KEY,
  aggregateGamingHeat,
  filterGamingServers,
  gamingOverview,
  heatCellSizeDegrees,
  markerDescriptor,
  normalizeGamingDataFilters,
  resetGamingDataFilters,
  serverHasCoordinates,
} from './gamingDataModel.js';

const MARKER_SOURCE_ID = 'gamingData-markers';
const HEAT_SOURCE_ID = 'gamingData-heatmap';
const MAX_MARKERS = 1200;
const GAME_COLORS = ['#35e7ff', '#ffb84a', '#d17cff', '#58e391', '#ff5c78', '#7aa7ff', '#f3df55'];

function safeStoredFilters() {
  try {
    return normalizeGamingDataFilters(JSON.parse(localStorage.getItem(GAMING_DATA_STORAGE_KEY) || '{}'));
  } catch {
    return resetGamingDataFilters();
  }
}

function saveFilters(filters) {
  try { localStorage.setItem(GAMING_DATA_STORAGE_KEY, JSON.stringify(filters)); } catch { /* optional */ }
}

function hashColor(value) {
  let hash = 0;
  for (const character of String(value || 'unknown')) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return GAME_COLORS[Math.abs(hash) % GAME_COLORS.length];
}

function markerColor(server, mode, isStale = false) {
  if (isStale) return Cesium.Color.fromCssColorString('#ff9d3d');
  if (mode === 'game') return Cesium.Color.fromCssColorString(hashColor(server.gameId));
  if (mode === 'status') {
    return Cesium.Color.fromCssColorString({
      online: '#43f2a1', offline: '#8d99a8', dead: '#ff4567', unknown: '#ffc857',
    }[server.status] || '#ffc857');
  }
  const load = server.maxPlayers > 0 ? server.players / server.maxPlayers : Math.min(1, server.players / 100);
  return Cesium.Color.fromHsl(0.52 - Math.min(1, load) * 0.5, 0.92, 0.58);
}

function cameraBounds(viewer) {
  try {
    const rectangle = viewer?.camera?.computeViewRectangle?.(viewer.scene.globe.ellipsoid);
    if (!rectangle) return null;
    return {
      west: Cesium.Math.toDegrees(rectangle.west),
      south: Cesium.Math.toDegrees(rectangle.south),
      east: Cesium.Math.toDegrees(rectangle.east),
      north: Cesium.Math.toDegrees(rectangle.north),
    };
  } catch {
    return null;
  }
}

function currentZoom(viewer) {
  const height = Math.max(1, viewer?.camera?.positionCartographic?.height || 20_000_000);
  return Math.max(1, Math.min(18, Math.round(Math.log2(591_657_550 / height))));
}

function heatColor(ratio, alpha) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const hue = 0.66 - clamped * 0.66;
  return Cesium.Color.fromHsl(hue, 1, 0.53, alpha);
}

function syncEntitySet(collection, descriptors, create, update) {
  const live = new Set();
  for (const descriptor of descriptors) {
    live.add(descriptor.id);
    const existing = collection.getById(descriptor.id);
    if (existing) update(existing, descriptor);
    else collection.add(create(descriptor));
  }
  for (const entity of [...collection.values]) if (!live.has(entity.id)) collection.remove(entity);
}

function detailRows(server) {
  const location = [server.city, server.region, server.country].filter(Boolean).join(', ');
  return [
    ['Game', server.gameName],
    ['Status', server.status?.toUpperCase()],
    ['Players', `${server.players ?? 0}${server.maxPlayers ? ` / ${server.maxPlayers}` : ''}`],
    ['Queue', server.queue],
    ['Rank', server.rank ? `#${server.rank}` : null],
    ['Map', server.map],
    ['Scenario', server.scenario],
    ['Approximate location', location || null],
    ['Location accuracy', server.locationAccuracy?.replaceAll('-', ' ')],
    ['Address', server.address || (server.ip ? `${server.ip}:${server.queryPort || server.port || ''}` : null)],
    ['Version', server.version],
    ['Password', server.passwordProtected === null ? null : (server.passwordProtected ? 'Protected' : 'Not protected')],
    ['Secure', server.secure === null ? null : (server.secure ? 'Yes' : 'No')],
    ['Tags', server.tags?.length ? server.tags.join(', ') : null],
    ['First seen', server.firstSeenAt ? new Date(server.firstSeenAt).toLocaleString() : null],
    ['Last updated', server.updatedAt ? new Date(server.updatedAt).toLocaleString() : null],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
}

function showDetails(server) {
  const card = document.getElementById('gaming-data-details');
  if (!card || !server) return;
  card.replaceChildren();
  const header = document.createElement('header');
  const title = document.createElement('h3');
  const close = document.createElement('button');
  title.textContent = server.name;
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close Gaming Data server details');
  close.addEventListener('click', () => { card.hidden = true; });
  header.append(title, close);
  const notice = document.createElement('strong');
  notice.className = 'gaming-data-details-notice';
  notice.textContent = 'Server location—not player location';
  const list = document.createElement('dl');
  for (const [label, value] of detailRows(server)) {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = String(value);
    list.append(term, detail);
  }
  const privacy = document.createElement('p');
  privacy.textContent = 'Activity is mapped using game-server locations, not players’ physical locations.';
  const link = document.createElement('a');
  link.href = server.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'OPEN BATTLEMETRICS PROFILE';
  card.append(header, notice, list, privacy, link);
  card.hidden = false;
}

export function createGamingDataLayer() {
  let viewer = null;
  let markerSource = null;
  let heatSource = null;
  let enabled = false;
  let filters = typeof localStorage === 'undefined' ? resetGamingDataFilters() : safeStoredFilters();
  let servers = [];
  let games = [];
  let filteredServers = [];
  let lastUpdate = null;
  let lastAttempt = null;
  let error = null;
  let stale = false;
  let cached = false;
  let loading = false;
  let partial = false;
  let authMode = 'public';
  let abortController = null;
  let autoRefreshTimer = null;
  let cameraRefreshTimer = null;
  let removeCameraListener = null;
  let clickHandler = null;
  const listeners = new Set();
  const serverById = new Map();

  const emit = () => {
    const state = layer.getUIState();
    for (const listener of listeners) listener(state);
  };

  const syncTimer = () => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (enabled && filters.autoRefresh && filters.providerEnabled) {
      autoRefreshTimer = setInterval(() => { void layer.update(); }, filters.refreshIntervalSec * 1000);
    }
  };

  const render = () => {
    if (!viewer || !markerSource || !heatSource) return;
    const bounds = cameraBounds(viewer);
    filteredServers = filterGamingServers(servers, filters, null);
    const mapped = filteredServers.filter(serverHasCoordinates);
    const mode = filters.visualizationMode;
    markerSource.show = enabled && filters.markersEnabled && mode !== 'heatmap';
    heatSource.show = enabled && filters.heatmapEnabled && mode !== 'markers';
    markerSource.clustering.enabled = filters.clusteringEnabled;
    markerSource.clustering.pixelRange = filters.clusterRadius;
    markerSource.clustering.minimumClusterSize = 3;
    const zoom = currentZoom(viewer);
    const markerRows = mapped.slice(0, MAX_MARKERS).map((server) => markerDescriptor(server, filters)).filter(Boolean);
    syncEntitySet(markerSource.entities, markerRows, (descriptor) => ({
      id: descriptor.id,
      position: Cesium.Cartesian3.fromDegrees(descriptor.longitude, descriptor.latitude, 20),
      point: {
        pixelSize: descriptor.size,
        color: markerColor(descriptor.server, filters.colorMode, stale).withAlpha(stale ? 0.58 : 0.92),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: descriptor.server.name.slice(0, 44),
        show: filters.labelsVisible && zoom >= filters.labelMinimumZoom,
        font: '11px monospace',
        fillColor: Cesium.Color.fromCssColorString('#c9fbff'),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.72),
        pixelOffset: new Cesium.Cartesian2(0, 15),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1_500_000),
      },
      properties: { gamingServerId: descriptor.server.id },
    }), (entity, descriptor) => {
      entity.position = Cesium.Cartesian3.fromDegrees(descriptor.longitude, descriptor.latitude, 20);
      entity.point.pixelSize = descriptor.size;
      entity.point.color = markerColor(descriptor.server, filters.colorMode, stale).withAlpha(stale ? 0.58 : 0.92);
      entity.label.text = descriptor.server.name.slice(0, 44);
      entity.label.show = filters.labelsVisible && zoom >= filters.labelMinimumZoom;
    });

    const cameraHeight = viewer.camera.positionCartographic?.height || 20_000_000;
    const cells = aggregateGamingHeat(mapped, heatCellSizeDegrees(cameraHeight));
    const maximumWeight = Math.max(1, ...cells.map((cell) => cell.weight));
    const heatRows = cells.flatMap((cell) => [0, 1, 2].map((ring) => ({
      ...cell,
      id: `gaming-heat:${cell.id}:${ring}`,
      ring,
      ratio: Math.log1p(cell.weight * filters.heatIntensity / 50) / Math.log1p(maximumWeight * filters.heatIntensity / 50),
    })));
    const heatGeometry = (descriptor) => {
      const base = Math.max(8_000, descriptor.cellSizeDegrees * 70_000 * (filters.heatRadius / 55));
      return {
        position: Cesium.Cartesian3.fromDegrees(descriptor.longitude, descriptor.latitude),
        radius: base * (1 + descriptor.ring * 0.48),
        color: heatColor(descriptor.ratio, (filters.heatOpacity / 100) * [0.35, 0.18, 0.08][descriptor.ring]),
      };
    };
    syncEntitySet(heatSource.entities, heatRows, (descriptor) => {
      const geometry = heatGeometry(descriptor);
      return {
        id: descriptor.id,
        position: geometry.position,
        ellipse: {
          semiMajorAxis: geometry.radius,
          semiMinorAxis: geometry.radius,
          material: geometry.color,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: { gamingHeatPlayers: descriptor.players, gamingHeatServers: descriptor.serverCount },
      };
    }, (entity, descriptor) => {
      const geometry = heatGeometry(descriptor);
      entity.position = geometry.position;
      entity.ellipse.semiMajorAxis = geometry.radius;
      entity.ellipse.semiMinorAxis = geometry.radius;
      entity.ellipse.material = geometry.color;
    });
    const visible = filterGamingServers(filteredServers, filters, bounds);
    const overview = gamingOverview(visible, lastUpdate);
    window.dispatchEvent(new CustomEvent('gev:gaming-data-visible-change', { detail: overview }));
    governorRequestRender('gaming-data-render');
    emit();
  };

  const buildQuery = () => {
    const params = new URLSearchParams({
      status: filters.onlineOnly && !filters.includeOffline ? 'online' : 'all',
      minPlayers: String(filters.minPlayers),
      maxPlayers: String(filters.maxPlayers),
      limit: '1200',
    });
    if (!filters.allGames) for (const game of filters.selectedGames) params.append('game', game);
    if (filters.country) params.set('country', filters.country);
    if (filters.serverSearch) params.set('search', filters.serverSearch);
    const bounds = cameraBounds(viewer);
    const height = viewer?.camera?.positionCartographic?.height || 20_000_000;
    if (bounds && height < 4_000_000) params.set('bbox', [bounds.west, bounds.south, bounds.east, bounds.north].join(','));
    return params;
  };

  const layer = {
    id: 'gaming-data',
    name: 'Gaming Data',
    icon: '◈',
    source: 'BattleMetrics',
    showInTogglePanel: false,
    updateInterval: 0,

    init(nextViewer) {
      viewer = nextViewer;
      markerSource = new Cesium.CustomDataSource(MARKER_SOURCE_ID);
      heatSource = new Cesium.CustomDataSource(HEAT_SOURCE_ID);
      markerSource.show = false;
      heatSource.show = false;
      markerSource.clustering.enabled = true;
      markerSource.clustering.pixelRange = filters.clusterRadius;
      markerSource.clustering.minimumClusterSize = 3;
      viewer.dataSources.add(heatSource);
      viewer.dataSources.add(markerSource);
      const onCameraMove = () => {
        if (!enabled) return;
        render();
        if (!filters.autoRefresh || !filters.providerEnabled || viewer.camera.positionCartographic.height >= 4_000_000) return;
        clearTimeout(cameraRefreshTimer);
        cameraRefreshTimer = setTimeout(() => { void layer.update(); }, 900);
      };
      viewer.camera.moveEnd.addEventListener(onCameraMove);
      removeCameraListener = () => viewer?.camera?.moveEnd?.removeEventListener(onCameraMove);
      clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const property = picked?.id?.properties?.gamingServerId;
        const id = property?.getValue?.(viewer.clock.currentTime) || property;
        if (id && serverById.has(String(id))) showDetails(serverById.get(String(id)));
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    },

    enable() {
      enabled = true;
      syncTimer();
      render();
      emit();
    },

    disable() {
      enabled = false;
      abortController?.abort();
      abortController = null;
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      if (cameraRefreshTimer) clearTimeout(cameraRefreshTimer);
      autoRefreshTimer = null;
      cameraRefreshTimer = null;
      if (markerSource) markerSource.show = false;
      if (heatSource) heatSource.show = false;
      const card = document.getElementById('gaming-data-details');
      if (card) card.hidden = true;
      governorRequestRender('gaming-data-disable');
      emit();
    },

    async update() {
      if (!enabled || !filters.providerEnabled) return true;
      abortController?.abort();
      abortController = new AbortController();
      const request = abortController;
      loading = true;
      error = null;
      lastAttempt = Date.now();
      emit();
      try {
        const shouldLoadServers = filters.allGames || filters.selectedGames.length > 0;
        const [gameResponse, serverResponse] = await Promise.all([
          fetch('/api/gaming/games', { signal: request.signal, headers: { Accept: 'application/json' } }),
          shouldLoadServers
            ? fetch(`/api/gaming/servers?${buildQuery()}`, { signal: request.signal, headers: { Accept: 'application/json' } })
            : Promise.resolve(null),
        ]);
        if (!gameResponse.ok || (serverResponse && !serverResponse.ok)) {
          const failed = serverResponse && !serverResponse.ok ? serverResponse : gameResponse;
          const body = await failed.json().catch(() => ({}));
          throw new Error(body.error || `Gaming Data returned HTTP ${failed.status}`);
        }
        const gamePayload = await gameResponse.json();
        const serverPayload = serverResponse
          ? await serverResponse.json()
          : { servers: [], updatedAt: lastUpdate, stale: false, cached: true, partial: false, authMode: gamePayload.authMode };
        if (!Array.isArray(gamePayload.games) || !Array.isArray(serverPayload.servers)) throw new Error('Gaming Data response was malformed');
        games = gamePayload.games;
        servers = serverPayload.servers;
        serverById.clear();
        for (const server of servers) serverById.set(String(server.id), server);
        lastUpdate = serverPayload.updatedAt || new Date().toISOString();
        stale = serverPayload.stale === true;
        cached = serverPayload.cached === true;
        partial = serverPayload.partial === true;
        authMode = serverPayload.authMode || gamePayload.authMode || 'public';
        error = serverPayload.warning || null;
        render();
        return true;
      } catch (caught) {
        if (caught?.name === 'AbortError') return true;
        error = caught?.message || 'BattleMetrics is temporarily unavailable';
        stale = servers.length > 0;
        render();
        return servers.length > 0;
      } finally {
        if (abortController === request) {
          abortController = null;
          loading = false;
          emit();
        }
      }
    },

    destroy() {
      layer.disable();
      removeCameraListener?.();
      removeCameraListener = null;
      clickHandler?.destroy();
      clickHandler = null;
      if (markerSource && viewer) viewer.dataSources.remove(markerSource, true);
      if (heatSource && viewer) viewer.dataSources.remove(heatSource, true);
      markerSource = null;
      heatSource = null;
      viewer = null;
      servers = [];
      games = [];
      serverById.clear();
      listeners.clear();
    },

    getParams() { return { ...filters, selectedGames: [...filters.selectedGames] }; },

    setParams(params = {}) {
      filters = normalizeGamingDataFilters({ ...filters, ...params });
      saveFilters(filters);
      syncTimer();
      if (!filters.providerEnabled) {
        servers = [];
        serverById.clear();
      }
      render();
      if (enabled && params.providerEnabled === true && servers.length === 0) queueMicrotask(() => { void layer.update(); });
      return true;
    },

    resetFilters() {
      filters = resetGamingDataFilters();
      saveFilters(filters);
      syncTimer();
      render();
      return layer.getParams();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getUIState() {
      const visible = filterGamingServers(filteredServers, filters, cameraBounds(viewer));
      return {
        enabled,
        filters: layer.getParams(),
        games: [...games],
        serverCount: servers.length,
        mappedCount: filteredServers.filter(serverHasCoordinates).length,
        filteredCount: filteredServers.length,
        overview: gamingOverview(visible, lastUpdate),
        lastUpdate,
        lastAttempt,
        error,
        stale,
        cached,
        loading,
        partial,
        authMode,
      };
    },

    getStats() {
      return {
        count: filteredServers.length,
        lastUpdate: lastUpdate ? Date.parse(lastUpdate) : null,
        loading,
        stale,
        degraded: stale || partial,
        error,
        source: 'BattleMetrics',
      };
    },
  };
  return layer;
}

export default createGamingDataLayer();
