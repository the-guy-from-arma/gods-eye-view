import * as Cesium from 'cesium';

const ENDPOINT = '/api/broadcastify/feeds';
const LABEL_DISTANCE_METERS = 350_000;

function labelFor(feed) {
  const jurisdiction = [feed.city, feed.county, feed.region, feed.countryCode].filter(Boolean).join(' · ');
  const activity = feed.activityLabel ? `${feed.activityLabel}\n` : '';
  return jurisdiction ? `${activity}${feed.name}\n${jurisdiction}` : `${activity}${feed.name}`;
}

function activityColor(feed) {
  if (feed.activityType === 'disaster-event') return '#ff2d55';
  if (feed.activityType === 'special-event') return '#ff9f0a';
  if (feed.activityType === 'listener-activity') return '#ffd166';
  return feed.online ? '#00dcff' : '#66747c';
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
    ['Directory signal', feed.activityLabel || 'Standard catalog feed'],
  ].map(([key, value]) => `<tr><th>${key}</th><td>${escape(value || 'Not reported')}</td></tr>`).join('');
  return `<table class="cesium-infoBox-defaultTable"><tbody>${rows}</tbody></table>`
    + '<p><strong>Directory context only:</strong> a listed event feed or listener increase does not confirm an emergency.</p>'
    + `<p><a href="${escape(feed.officialUrl)}" target="_blank" rel="noopener noreferrer">Open authorized Broadcastify feed page</a></p>`;
}

export function createLawEnforcementTransmissionsLayer() {
  let viewer = null;
  let dataSource = null;
  let enabled = false;
  let count = 0;
  let geolocated = 0;
  let activeEventCount = 0;
  let activityCounts = { special: 0, disaster: 0, listeners: 0 };
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
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Broadcastify directory returned ${response.status}`);
        if (!Array.isArray(payload?.feeds)) throw new Error('Broadcastify directory response was malformed');

        dataSource.entities.removeAll();
        count = payload.feeds.length;
        geolocated = 0;
        activeEventCount = Number.isFinite(payload.activeEventCount)
          ? payload.activeEventCount
          : payload.feeds.filter((feed) => feed.activeSignal).length;
        activityCounts = payload.feeds.reduce((counts, feed) => {
          if (!feed.activeSignal) return counts;
          if (feed.activityType === 'special-event') counts.special += 1;
          else if (feed.activityType === 'disaster-event') counts.disaster += 1;
          else if (feed.activityType === 'listener-activity') counts.listeners += 1;
          return counts;
        }, { special: 0, disaster: 0, listeners: 0 });
        for (const feed of payload.feeds) {
          if (!Number.isFinite(feed.lat) || !Number.isFinite(feed.lon)) continue;
          geolocated += 1;
          const accent = Cesium.Color.fromCssColorString(activityColor(feed));
          dataSource.entities.add({
            id: feed.id,
            name: feed.name,
            description: descriptionFor(feed),
            position: Cesium.Cartesian3.fromDegrees(feed.lon, feed.lat, 15),
            point: {
              pixelSize: feed.activeSignal ? 12 : (feed.online ? 8 : 6),
              color: accent,
              outlineColor: Cesium.Color.fromCssColorString('#03131a'),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: 250_000,
            },
            label: {
              text: labelFor(feed),
              font: '11px monospace',
              fillColor: feed.activeSignal ? accent : Cesium.Color.fromCssColorString('#9cefff'),
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
              activeSignal: feed.activeSignal,
              activityType: feed.activityType,
              activityLabel: feed.activityLabel,
            },
          });
        }
        stale = payload.stale === true || payload.degraded === true;
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
      activeEventCount = 0;
      activityCounts = { special: 0, disaster: 0, listeners: 0 };
      lastUpdate = null;
      lastError = null;
      stale = false;
    },

    getRowControls() {
      return {
        legend: [
          { label: 'Disaster event feeds', count: activityCounts.disaster, color: '#ff2d55' },
          { label: 'Special event feeds', count: activityCounts.special, color: '#ff9f0a' },
          { label: 'Listener activity', count: activityCounts.listeners, color: '#ffd166' },
        ].filter((entry) => entry.count > 0),
      };
    },

    getStats() {
      return {
        count,
        geolocated,
        activeEventCount,
        lastUpdate,
        error: lastError,
        stale,
        coverage: count
          ? `${geolocated.toLocaleString()} geolocated · ${activeEventCount.toLocaleString()} directory activity signals`
          : 'licensed catalog',
      };
    },
  };
}

const lawEnforcementTransmissionsLayer = createLawEnforcementTransmissionsLayer();
export default lawEnforcementTransmissionsLayer;
