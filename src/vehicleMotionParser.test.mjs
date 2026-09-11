import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMotionRegions, rgbaToLuma } from './vehicleMotionParser.js';

test('RGBA conversion uses deterministic luminance without external services', () => {
  assert.deepEqual([...rgbaToLuma(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1)], [76, 150]);
});

test('frame differencing finds a changed connected region', () => {
  const width = 32;
  const height = 24;
  const previous = new Uint8Array(width * height);
  const current = new Uint8Array(width * height);
  for (let y = 4; y < 12; y += 1) {
    for (let x = 8; x < 20; x += 1) current[y * width + x] = 220;
  }
  const regions = detectMotionRegions(previous, current, width, height, { ignoreBottomFraction: 0 });
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0].bbox, [4 / 24, 8 / 32, 12 / 24, 20 / 32]);
});

test('uniform lighting changes are compensated instead of becoming motion', () => {
  const previous = new Uint8Array(32 * 24).fill(80);
  const current = new Uint8Array(32 * 24).fill(110);
  assert.deepEqual(detectMotionRegions(previous, current, 32, 24), []);
});

test('timestamp-like changes in the bottom band are ignored', () => {
  const width = 32;
  const height = 24;
  const previous = new Uint8Array(width * height);
  const current = new Uint8Array(width * height);
  for (let y = 22; y < 24; y += 1) current.fill(255, y * width, (y + 1) * width);
  assert.deepEqual(detectMotionRegions(previous, current, width, height, { ignoreBottomFraction: .15 }), []);
});
