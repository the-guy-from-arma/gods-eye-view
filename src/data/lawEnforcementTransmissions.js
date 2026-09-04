import * as Cesium from 'cesium';

const ENDPOINT = '/api/broadcastify/feeds';
const LABEL_DISTANCE_METERS = 350_000;

function labelFor(feed) {
  const jurisdiction = [feed.city, feed.county, feed.region, feed.countryCode].filter(Boolean).join(' · ');
  return jurisdiction ? `${feed.name}\n${jurisdiction}` : feed.name;
}

function descriptionFor(feed) {
  const escape = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const rows = [
    ['Agency', feed.agency],
    ['Service', feed.service],
    ['Jurisdiction', [feed.city, feed.county, feed.region, feed.country].filter(Boolean).join(', ')],
    ['Listeners', Number.isFinite(feed.listeners) ? feed.listeners.toLocaleString() : 'Not reported'],
    ['Status', feed.online ? 'Online' : 'Offline'],
  ].map(([key, value]) => `<tr><th>${key}</th><td>${escape(value || 'Not reported')}</td></tr>`).join('');
  return `<table class="cesium-infoBox-defaultTable"><tbody>${rows}</tbody></table>`
    + `<p><a href="${escape(feed.officialUrl)}" target="_blank" rel="noopener noreferrer">Open authorized Broadcastify feed page</a></p>`;
}

export function createLawEnforcementTransmissionsLayer() {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let count = 0;
  let geolocated = 0;
  let lastUpdate = null;
  let lastError = null;
  let stale = false;
  let controller = null;

  return {
    id: 'law-enforcement-transmissions',
    name: 'Law Enforcement Transmissions',
    icon: '📡',
    source: 'Broadcastify',
    updateInterval: 5 * 60_000,

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource('Broadcastify law enforcement transmissions');
      dataSource.show = false;
      dataSource.clustering.enabled = true;
      dataSource.clustering.pixelRange = 42;
      dataSource.clustering.minimumClusterSize = 3;
      dataSource.clustering.clusterPoints = true;
      dataSource.clustering.clusterLabels = true;
      dataSource.clustering.clusterBillboards = false;
      viewer.dataSources.add(dataSource);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      controller?.abort();
      controller = null;
      if (dataSource) dataSource.show = false;
    },

    async update() {
      if (!enabled || !dataSource) return false;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(ENDPOINT, { signal: controller.signal });
        if (!response.ok) throw new Error(`Broadcastify directory returned ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload?.feeds)) throw new Error('Broadcastify directory response was malformed');

        dataSource.entities.removeAll();
        count = payload.feeds.length;
        geolocated = 0;
        for (const feed of payload.feeds) {
          if (!Number.isFinite(feed.lat) || !Number.isFinite(feed.lon)) continue;
          geolocated += 1;
          dataSource.entities.add({
            id: feed.id,
            name: feed.name,
            description: descriptionFor(feed),
            position: Cesium.Cartesian3.fromDegrees(feed.lon, feed.lat, 15),
            point: {
              pixelSize: feed.online ? 8 : 6,
              color: feed.online ? Cesium.Color.fromCssColorString('#00dcff') : Cesium.Color.fromCssColorString('#66747c'),
              outlineColor: Cesium.Color.fromCssColorString('#03131a'),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: 250_000,
            },
            label: {
              text: labelFor(feed),
              font: '11px monospace',
              fillColor: Cesium.Color.fromCssColorString('#9cefff'),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -17),
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, LABEL_DISTANCE_METERS),
              disableDepthTestDistance: 250_000,
            },
            properties: {
              layerId: 'law-enforcement-transmissions',
              feedId: feed.feedId,
              agency: feed.agency,
              service: feed.service,
              provider: 'Broadcastify',
              officialUrl: feed.officialUrl,
              listeners: feed.listeners,
              online: feed.online,
            },
          });
        }
        stale = payload.stale === true;
        lastUpdate = Date.now();
        lastError = null;
        viewer?.scene?.requestRender?.();
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
        lastError = error?.message || 'Broadcastify directory unavailable';
        stale = count > 0;
        return false;
      } finally {
        controller = null;
      }
    },

    destroy() {
      controller?.abort();
      controller = null;
      if (dataSource && viewer) viewer.dataSources.remove(dataSource, true);
      viewer = null;
      dataSource = null;
      enabled = false;
      count = 0;
      geolocated = 0;
      lastUpdate = null;
      lastError = null;
      stale = false;
    },

    getStats() {
      return {
        count,
        geolocated,
        lastUpdate,
        error: lastError,
        stale,
        coverage: count ? `${geolocated.toLocaleString()} geolocated · provider links` : 'licensed catalog',
      };
    },
  };
}

const lawEnforcementTransmissionsLayer = createLawEnforcementTransmissionsLayer();
export default lawEnforcementTransmissionsLayer;
