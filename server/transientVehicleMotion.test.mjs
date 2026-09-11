import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTransientVehicleMotionTracker,
  groupVehicleFlowDetections,
  vehicleFlowBucketStart,
} from './transientVehicleMotion.js';

test('tracklets continue only inside one short-lived camera session', () => {
  let clock = Date.parse('2026-09-10T12:00:00Z');
  const tracker = createTransientVehicleMotionTracker({ now: () => clock, sessionTtlMs: 60_000 });
  const input = { ownerId: 1, sessionId: 'anonymous-motion-session-001', cameraId: 'cam-a' };
  const first = tracker.update({ ...input, capturedAt: new Date(clock), vehicles: [{ vehicleType: 'sedan', confidence: .9, bbox: [.2, .2, .5, .5] }] });
  clock += 5_000;
  const second = tracker.update({ ...input, capturedAt: new Date(clock), vehicles: [{ vehicleType: 'sedan', confidence: .8, bbox: [.2, .25, .5, .55] }] });
  assert.equal(second.activeTracklets[0].trackId, first.activeTracklets[0].trackId);
  assert.equal(second.activeTracklets[0].direction, 'right');
  const otherCamera = tracker.update({ ...input, cameraId: 'cam-b', capturedAt: new Date(clock), vehicles: [{ vehicleType: 'sedan', bbox: [.2, .25, .5, .55] }] });
  assert.notEqual(otherCamera.activeTracklets[0].trackId, first.activeTracklets[0].trackId);
  assert.equal(otherCamera.scope, 'single_camera');
  assert.equal(otherCamera.memoryOnly, true);
});

test('expired sessions cannot preserve a track identity', () => {
  let clock = Date.parse('2026-09-10T12:00:00Z');
  const tracker = createTransientVehicleMotionTracker({ now: () => clock, sessionTtlMs: 60_000 });
  const input = { ownerId: 1, sessionId: 'anonymous-motion-session-002', cameraId: 'cam-a' };
  const first = tracker.update({ ...input, capturedAt: new Date(clock), vehicles: [{ vehicleType: 'van', bbox: [.1, .1, .3, .3] }] });
  clock += 61_000;
  const second = tracker.update({ ...input, capturedAt: new Date(clock), vehicles: [{ vehicleType: 'van', bbox: [.1, .1, .3, .3] }] });
  assert.notEqual(second.activeTracklets[0].trackId, first.activeTracklets[0].trackId);
});

test('flow buckets retain only aggregate class counts', () => {
  assert.equal(vehicleFlowBucketStart('2026-09-10T12:14:59Z'), '2026-09-10T12:00:00.000Z');
  assert.deepEqual(groupVehicleFlowDetections([
    { vehicleType: 'sedan', confidence: .8, plate: 'discard' },
    { vehicleType: 'sedan', confidence: .6 },
    { vehicleType: 'pickup', confidence: .9 },
  ]), [
    { vehicleType: 'sedan', detections: 2, confidenceTotal: 1.4 },
    { vehicleType: 'pickup', detections: 1, confidenceTotal: .9 },
  ]);
});
