/**
 * Bundled Flock Safety camera-placement layer.
 *
 * Only the filtered, compact placement data from Ringmast4r/FLOCK is used.
 * The upstream Leaflet map, network lines, precincts, and UI are not imported.
 */
import * as Cesium from 'cesium';
import flockCameraDataUrl from './local_data/flock-cameras/flock-cameras.json?url';
import { governorRequestRender } from '../renderGovernor.js';
import {
  clearOverlaySource,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../overlays/worldOverlay.js';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  selectEntityContext,
} from './contextStore.js';
import { registerPickOwner, resolvePickId, unregisterPickOwner } from './pickRegistry.js';
import { registerSpriteCollection, restoreSpriteOrder } from './spriteOrder.js';
import { parseFlockCameraDataset, selectFlockCamerasForView } from './flockCameraData.js';

const LAYER_ID = 'flock-cameras';
const OVERLAY_SOURCE_ID = 'flock-camera-selected';
const MAX_RENDERED = 5000;
const MAX_CAMERA_ALTITUDE_M = 4_000_000;
const POINT_HEIGHT_M = 12;
const CAMERA_MOVE_DEBOUNCE_MS = 180;
const EARTH_RADIUS_M = 6_371_008.8;

const state = {
  viewer: null,
  pointCollection: null,
  records: [],
  recordById: new Map(),
  renderedById: new Map(),
  enabled: false,
  loaded: false,
  loading: false,
  loadPromise: null,
  lastUpdate: null,
  sourceUpdated: null,
  sourceCommit: null,
  error: null,
  status: 'idle',
  renderedCount: 0,
  clickHandler: null,
  moveEndRemove: null,
  renderTimer: null,
  selectedId: null,
  selectedEntity: null,
};

function recordTitle(record) {
  return record.name || record.operator || 'FLOCK CAMERA';
}

function recordDetails(record) {
  const details = [];
  if (record.operator && record.operator !== recordTitle(record)) details.push(record.operator);
  const hardware = [record.cameraType || 'CAMERA', record.mount ? `${record.mount} mount` : '']
    .filter(Boolean)
    .join(' · ');
  if (hardware) details.push(hardware.toUpperCase());
  if (record.direction) details.push(`DIRECTION ${record.direction}`);
  details.push(`${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}`);
  details.push('PUBLIC PLACEMENT DATA · NOT A LIVE VIDEO FEED');
  return details;
}

function cameraPosition(record) {
  return Cesium.Cartesian3.fromDegrees(record.longitude, record.latitude, POINT_HEIGHT_M);
}

function clearSelection() {
  const selectedPoint = state.selectedId
    ? state.renderedById.get(state.selectedId)?.point
    : null;
  if (selectedPoint) selectedPoint.show = true;
  if (state.selectedEntity && state.viewer) state.viewer.entities.remove(state.selectedEntity);
  state.selectedEntity = null;
  state.selectedId = null;
  clearOverlaySource(OVERLAY_SOURCE_ID);
  clearSelectedEntityContextForLayer(LAYER_ID);
}

function selectRecord(id) {
  const record = state.recordById.get(String(id));
  if (!record || !state.viewer) return false;
  clearSelection();
  state.selectedId = record.id;
  const basePoint = state.renderedById.get(record.id)?.point;
  if (basePoint) basePoint.show = false;
  const position = cameraPosition(record);
  state.selectedEntity = state.viewer.entities.add({
    id: `${record.id}:selected`,
    position,
    point: {
      pixelSize: 15,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#ff304f'),
      outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  state.selectedEntity.gevTrackedId = record.id;
  state.selectedEntity.gevDisplayPosition = () => position;
  state.selectedEntity.gevLabelModel = {
    title: recordTitle(record),
    details: recordDetails(record),
    accent: '#ff4058',
  };
  registerEntityContext(state.selectedEntity, {
    id: record.id,
    layerId: LAYER_ID,
    layerName: 'Flock Cameras',
    source: 'Ringmast4r/FLOCK public placement snapshot',
    label: recordTitle(record),
    latitude: record.latitude,
    longitude: record.longitude,
    properties: {
      operator: record.operator || null,
      cameraType: record.cameraType || null,
      mount: record.mount || null,
      direction: record.direction || null,
      sourceUpdated: state.sourceUpdated,
      verification: 'public-placement-data-not-live-video',
    },
  });
  selectEntityContext(state.selectedEntity);
  setOverlayEntries(OVERLAY_SOURCE_ID, [{
    id: record.id,
    source: OVERLAY_SOURCE_ID,
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title: recordTitle(record),
    details: recordDetails(record),
    accent: '#ff4058',
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  }], {
    cohortLimit: 1,
    collisionCapacity: 0,
    moving: false,
  });
  governorRequestRender('flock-camera-select');
  return true;
}

function viewBounds(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rectangle) return null;
  return {
    south: Cesium.Math.toDegrees(rectangle.south),
    north: Cesium.Math.toDegrees(rectangle.north),
    west: Cesium.Math.toDegrees(rectangle.west),
    east: Cesium.Math.toDegrees(rectangle.east),
  };
}

function clearPoints() {
  state.pointCollection?.removeAll();
  state.renderedById.clear();
  state.renderedCount = 0;
}

function renderVisible() {
  if (!state.enabled || !state.loaded || !state.viewer || !state.pointCollection) return;
  const altitude = Number(state.viewer.camera.positionCartographic?.height);
  if (!Number.isFinite(altitude) || altitude > MAX_CAMERA_ALTITUDE_M) {
    clearPoints();
    state.status = 'zoom-in';
    governorRequestRender('flock-cameras-zoom-guidance');
    return;
  }
  const bounds = viewBounds(state.viewer);
  if (!bounds) {
    clearPoints();
    state.status = 'zoom-in';
    return;
  }
  const visible = selectFlockCamerasForView(state.records, bounds, MAX_RENDERED);
  clearPoints();
  for (const record of visible) {
    const point = state.pointCollection.add({
      position: cameraPosition(record),
      pixelSize: 7,
      color: Cesium.Color.fromCssColorString('#ff304f').withAlpha(0.93),
      outlineColor: Cesium.Color.BLACK.withAlpha(0.88),
      outlineWidth: 1,
      scaleByDistance: new Cesium.NearFarScalar(100, 1.55, 4_000_000, 0.42),
      translucencyByDistance: new Cesium.NearFarScalar(100, 1, 4_000_000, 0.32),
      disableDepthTestDistance: 2_000_000,
      id: record.id,
    });
    if (record.id === state.selectedId) point.show = false;
    state.renderedById.set(record.id, { record, point });
  }
  state.renderedCount = visible.length;
  state.status = visible.length === MAX_RENDERED ? 'capped' : 'ready';
  if (state.selectedId && !state.renderedById.has(state.selectedId)) clearSelection();
  governorRequestRender('flock-cameras-render');
}

function scheduleRender() {
  if (!state.enabled) return;
  clearTimeout(state.renderTimer);
  state.renderTimer = setTimeout(renderVisible, CAMERA_MOVE_DEBOUNCE_MS);
}

async function ensureLoaded() {
  if (state.loaded) return;
  if (state.loadPromise) return state.loadPromise;
  state.loading = true;
  state.error = null;
  state.loadPromise = (async () => {
    const response = await fetch(flockCameraDataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const records = parseFlockCameraDataset(payload);
    if (!records.length) throw new Error('camera dataset is empty');
    state.records = records;
    state.recordById = new Map(records.map((record) => [record.id, record]));
    state.sourceUpdated = String(payload.sourceUpdated || 'unknown');
    state.sourceCommit = String(payload.sourceCommit || 'unknown');
    state.lastUpdate = Date.now();
    state.loaded = true;
  })().catch((error) => {
    state.error = `dataset unavailable (${error?.message || 'unknown error'})`;
    state.status = 'unavailable';
    throw error;
  }).finally(() => {
    state.loading = false;
    state.loadPromise = null;
  });
  return state.loadPromise;
}

function installInteraction(viewer) {
  if (state.clickHandler) return;
  state.clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  state.clickHandler.setInputAction((click) => {
    if (!state.enabled) return;
    const picked = viewer.scene.pick(click.position);
    const id = resolvePickId(picked);
    if (id && state.renderedById.has(id)) {
      selectRecord(id);
    } else if (state.selectedId && picked?.id !== state.selectedEntity) {
      clearSelection();
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function distanceM(aLatitude, aLongitude, bLatitude, bLongitude) {
  const toRadians = Math.PI / 180;
  const dLat = (bLatitude - aLatitude) * toRadians;
  const dLon = (bLongitude - aLongitude) * toRadians;
  const latA = aLatitude * toRadians;
  const latB = bLatitude * toRadians;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

const flockCamerasLayer = {
  id: LAYER_ID,
  name: 'Flock Cameras',
  icon: '◉',
  source: 'Bundled public placement snapshot',
  updateInterval: 0,
  statsRefreshInterval: 1000,

  init(viewer) {
    state.viewer = viewer;
    state.pointCollection = new Cesium.PointPrimitiveCollection({
      blendOption: Cesium.BlendOption.TRANSLUCENT,
    });
    state.pointCollection.show = false;
    viewer.scene.primitives.add(state.pointCollection);
    registerSpriteCollection(LAYER_ID, state.pointCollection);
    restoreSpriteOrder(viewer);
  },

  async enable(viewer) {
    state.enabled = true;
    state.pointCollection.show = true;
    setOverlaySourceVisible(OVERLAY_SOURCE_ID, true);
    registerPickOwner(LAYER_ID, (id) => state.recordById.has(id));
    installInteraction(viewer);
    if (!state.moveEndRemove) state.moveEndRemove = viewer.camera.moveEnd.addEventListener(scheduleRender);
    try {
      await ensureLoaded();
      if (state.enabled) renderVisible();
      restoreSpriteOrder(viewer);
    } catch (error) {
      console.warn('[Data:FlockCameras] load failed:', error);
    }
  },

  disable() {
    state.enabled = false;
    clearTimeout(state.renderTimer);
    state.renderTimer = null;
    clearSelection();
    clearPoints();
    if (state.pointCollection) state.pointCollection.show = false;
    if (state.clickHandler) {
      state.clickHandler.destroy();
      state.clickHandler = null;
    }
    state.moveEndRemove?.();
    state.moveEndRemove = null;
    unregisterPickOwner(LAYER_ID);
    setOverlaySourceVisible(OVERLAY_SOURCE_ID, false);
  },

  update() {},

  getNearby(center, rangeM, maxCount = 50) {
    if (!center || !state.loaded) return [];
    const origin = Cesium.Cartographic.fromCartesian(center);
    if (!origin) return [];
    const originLatitude = Cesium.Math.toDegrees(origin.latitude);
    const originLongitude = Cesium.Math.toDegrees(origin.longitude);
    const range = Number.isFinite(rangeM) ? rangeM : Number.POSITIVE_INFINITY;
    const nearby = [];
    for (const record of state.records) {
      const separationM = distanceM(
        originLatitude,
        originLongitude,
        record.latitude,
        record.longitude,
      );
      if (separationM > range) continue;
      nearby.push({ ...record, distanceM: separationM, position: cameraPosition(record) });
    }
    nearby.sort((a, b) => a.distanceM - b.distanceM);
    return nearby.slice(0, Math.max(1, Math.floor(Number(maxCount) || 50)));
  },

  getStats() {
    let loadingLabel = '';
    if (state.loading) loadingLabel = 'loading bundled placements...';
    else if (state.status === 'zoom-in') loadingLabel = 'zoom in to view placements';
    else if (state.status === 'capped') loadingLabel = `showing nearest ${MAX_RENDERED.toLocaleString('en-US')} in view`;
    else if (state.loaded) loadingLabel = `${state.renderedCount.toLocaleString('en-US')} visible · public snapshot`;
    return {
      count: state.records.length,
      renderedCount: state.renderedCount,
      lastUpdate: state.lastUpdate,
      loading: state.loading,
      loadingLabel,
      error: state.error,
      status: state.status,
      sourceUpdated: state.sourceUpdated,
      sourceCommit: state.sourceCommit,
    };
  },

  destroy(viewer) {
    this.disable();
    if (state.pointCollection && viewer) viewer.scene.primitives.remove(state.pointCollection);
    state.pointCollection = null;
    state.viewer = null;
    state.records = [];
    state.recordById.clear();
    state.loaded = false;
  },
};

export default flockCamerasLayer;
