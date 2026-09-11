import crypto from 'node:crypto';

const SESSION_ID_RE = /^[A-Za-z0-9_-]{20,80}$/;
const DEFAULT_SESSION_TTL_MS = 10 * 60_000;
const DEFAULT_TRACK_GAP_MS = 45_000;
const MAX_SESSIONS = 64;
const MAX_TRACKS_PER_SESSION = 160;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizedBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = value.map((part) => clamp(part, 0, 1));
  if (ymax <= ymin || xmax <= xmin) return null;
  return [ymin, xmin, ymax, xmax];
}

function center(box) {
  return { x: (box[1] + box[3]) / 2, y: (box[0] + box[2]) / 2 };
}

function intersectionOverUnion(left, right) {
  const ymin = Math.max(left[0], right[0]);
  const xmin = Math.max(left[1], right[1]);
  const ymax = Math.min(left[2], right[2]);
  const xmax = Math.min(left[3], right[3]);
  const intersection = Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
  const leftArea = (left[2] - left[0]) * (left[3] - left[1]);
  const rightArea = (right[2] - right[0]) * (right[3] - right[1]);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

function motionLabel(dx, dy) {
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 0.002) return 'stable';
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down-frame' : 'up-frame';
}

function safeToken(value, max) {
  return String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, max);
}

/**
 * Memory-only, single-camera tracklets. IDs are random and never derived from
 * vehicle appearance. A session cannot match or carry a track into another
 * camera, and the entire state expires after a short inactivity window.
 */
export function createTransientVehicleMotionTracker(options = {}) {
  const sessionTtlMs = Math.max(60_000, Number(options.sessionTtlMs) || DEFAULT_SESSION_TTL_MS);
  const trackGapMs = Math.max(2_000, Number(options.trackGapMs) || DEFAULT_TRACK_GAP_MS);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const sessions = new Map();

  const prune = (at = now()) => {
    for (const [key, session] of sessions) {
      if (session.expiresAt <= at) sessions.delete(key);
    }
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  };

  const stop = ({ ownerId, sessionId, cameraId }) => {
    const key = `${safeToken(ownerId, 40)}:${safeToken(sessionId, 80)}:${safeToken(cameraId, 180)}`;
    return sessions.delete(key);
  };

  const update = ({ ownerId, sessionId, cameraId, capturedAt, vehicles = [] }) => {
    const cleanSessionId = safeToken(sessionId, 80);
    const cleanCameraId = safeToken(cameraId, 180);
    if (!SESSION_ID_RE.test(cleanSessionId) || !cleanCameraId) {
      throw Object.assign(new Error('A valid anonymous motion session and camera are required'), { status: 400 });
    }
    const at = new Date(capturedAt || now()).getTime();
    if (!Number.isFinite(at)) throw Object.assign(new Error('Motion sample time is invalid'), { status: 400 });
    prune(at);
    const key = `${safeToken(ownerId, 40)}:${cleanSessionId}:${cleanCameraId}`;
    let session = sessions.get(key);
    if (!session) {
      session = { cameraId: cleanCameraId, expiresAt: at + sessionTtlMs, tracks: new Map(), frames: 0 };
      sessions.set(key, session);
    }
    session.expiresAt = at + sessionTtlMs;
    session.frames += 1;
    for (const [id, track] of session.tracks) {
      if (at - track.lastSeenAt > trackGapMs) session.tracks.delete(id);
    }

    const detections = vehicles.map((vehicle) => ({
      vehicleType: safeToken(vehicle?.vehicleType, 40) || 'unknown',
      confidence: clamp(vehicle?.confidence, 0, 1),
      bbox: normalizedBox(vehicle?.bbox),
    })).filter((vehicle) => vehicle.bbox);
    const claimed = new Set();
    const current = [];

    for (const detection of detections) {
      const detectionCenter = center(detection.bbox);
      let best = null;
      for (const track of session.tracks.values()) {
        if (claimed.has(track.id) || track.vehicleType !== detection.vehicleType) continue;
        const ageMs = at - track.lastSeenAt;
        if (ageMs < 0 || ageMs > trackGapMs) continue;
        const previousCenter = center(track.bbox);
        const distance = Math.hypot(detectionCenter.x - previousCenter.x, detectionCenter.y - previousCenter.y);
        const overlap = intersectionOverUnion(track.bbox, detection.bbox);
        if (overlap < 0.08 && distance > 0.22) continue;
        const score = overlap - distance * 0.35;
        if (!best || score > best.score) best = { track, score, previousCenter, ageMs };
      }

      let track;
      let dx = 0;
      let dy = 0;
      if (best) {
        track = best.track;
        dx = detectionCenter.x - best.previousCenter.x;
        dy = detectionCenter.y - best.previousCenter.y;
        track.samples += 1;
      } else {
        track = {
          id: `trk-${crypto.randomBytes(6).toString('hex')}`,
          vehicleType: detection.vehicleType,
          firstSeenAt: at,
          samples: 1,
        };
        session.tracks.set(track.id, track);
      }
      track.bbox = detection.bbox;
      track.lastSeenAt = at;
      track.confidence = detection.confidence;
      claimed.add(track.id);
      current.push({
        trackId: track.id,
        vehicleType: track.vehicleType,
        samples: track.samples,
        ageSeconds: Math.max(0, Math.round((at - track.firstSeenAt) / 1000)),
        direction: motionLabel(dx, dy),
        displacement: Number(Math.hypot(dx, dy).toFixed(4)),
        confidence: track.confidence,
        bbox: track.bbox,
      });
    }

    while (session.tracks.size > MAX_TRACKS_PER_SESSION) session.tracks.delete(session.tracks.keys().next().value);
    return {
      scope: 'single_camera',
      memoryOnly: true,
      cameraId: cleanCameraId,
      frames: session.frames,
      activeTracklets: current,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  };

  return { update, stop, prune, size: () => sessions.size };
}

export function vehicleFlowBucketStart(value, bucketMinutes = 15) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error('Invalid flow sample time');
  const width = Math.max(1, Number(bucketMinutes) || 15) * 60_000;
  return new Date(Math.floor(time / width) * width).toISOString();
}

export function groupVehicleFlowDetections(vehicles = []) {
  const groups = new Map();
  for (const vehicle of vehicles) {
    const vehicleType = safeToken(vehicle?.vehicleType, 40) || 'unknown';
    const current = groups.get(vehicleType) || { vehicleType, detections: 0, confidenceTotal: 0 };
    current.detections += 1;
    current.confidenceTotal += clamp(vehicle?.confidence, 0, 1);
    groups.set(vehicleType, current);
  }
  return [...groups.values()];
}
