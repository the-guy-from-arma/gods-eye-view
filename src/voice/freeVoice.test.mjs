import test from 'node:test';
import assert from 'node:assert/strict';
import { freeVoiceResultMessage, parseFreeVoiceCommand } from './freeVoice.js';

test('free voice parses navigation and search phrases', () => {
  assert.deepEqual(parseFreeVoiceCommand('Fly to London'), {
    name: 'fly_to_location',
    args: { query: 'london' },
    confirmation: 'Flying to london',
  });
  assert.equal(parseFreeVoiceCommand('search for Eiffel Tower').args.query, 'eiffel tower');
  assert.equal(parseFreeVoiceCommand('show me Tokyo').name, 'fly_to_location');
});

test('free voice prefers layer commands over generic show-me navigation', () => {
  assert.deepEqual(parseFreeVoiceCommand('show me breaking news'), {
    name: 'set_layer_visibility',
    args: { layerId: 'breaking news', enabled: true },
    confirmation: 'breaking news on',
  });
  assert.equal(parseFreeVoiceCommand('turn off military flights').args.enabled, false);
  assert.equal(parseFreeVoiceCommand('enable ships').args.layerId, 'ships');
  assert.equal(parseFreeVoiceCommand('show rocket launches').args.layerId, 'rocket-launches');
});

test('free voice parses camera, tracking, style, map, and HUD controls', () => {
  assert.deepEqual(parseFreeVoiceCommand('zoom out a little').args, { direction: 'out', amount: 'little' });
  assert.equal(parseFreeVoiceCommand('whole earth').name, 'zoom_to_globe');
  assert.equal(parseFreeVoiceCommand('track UAL 428').name, 'track_entity');
  assert.equal(parseFreeVoiceCommand('stop tracking').name, 'stop_tracking');
  assert.equal(parseFreeVoiceCommand('switch to night vision').name, 'set_visual_style');
  assert.equal(parseFreeVoiceCommand('use Bing aerial').name, 'set_map_stack');
  assert.deepEqual(parseFreeVoiceCommand('turn HUD off').args, { visible: false });
});

test('free voice rejects empty and conversational text instead of guessing', () => {
  assert.equal(parseFreeVoiceCommand(''), null);
  assert.equal(parseFreeVoiceCommand('hello there'), null);
});

test('free voice result copy reflects authoritative action outcomes', () => {
  const command = parseFreeVoiceCommand('show flights');
  assert.equal(freeVoiceResultMessage(command, { ok: true, action: 'set_layer_visibility', label: 'Flights' }), 'Flights on');
  assert.equal(freeVoiceResultMessage(command, { ok: false, error: 'Feed unavailable' }), 'Feed unavailable');
});
