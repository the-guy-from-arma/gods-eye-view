import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhoneLikeDevice } from './deviceCompatibility.js';

test('blocks phones but allows iPads and Android tablets', () => {
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  }), true);
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit Mobile',
  }), true);
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',
    userAgentDataMobile: true,
  }), false);
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit Safari',
  }), false);
});

test('recognizes iPadOS desktop user agents and cautious small-screen fallbacks', () => {
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
    platform: 'MacIntel',
    maxTouchPoints: 5,
    userAgentDataMobile: true,
  }), false);
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Unknown Browser',
    screenWidth: 390,
    screenHeight: 844,
    coarsePointer: true,
  }), true);
  assert.equal(isPhoneLikeDevice({
    userAgent: 'Desktop Browser',
    screenWidth: 1440,
    screenHeight: 900,
  }), false);
});
