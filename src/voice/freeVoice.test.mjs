import test from 'node:test';
import assert from 'node:assert/strict';
import { GevFreeVoiceController, freeVoiceResultMessage, parseFreeVoiceCommand } from './freeVoice.js';

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

function voiceUi() {
  return {
    root: { dataset: {}, querySelector: () => null, remove() {} },
    button: { setAttribute() {}, addEventListener() {}, removeEventListener() {} },
    status: { textContent: '' },
    detail: { textContent: '', title: '' },
  };
}

test('free voice prefers server-side natural audio when it is configured', async () => {
  const played = [];
  class AudioMock {
    constructor(url) { this.url = url; }
    addEventListener() {}
    async play() { played.push(this.url); }
    pause() {}
  }
  const windowRef = {
    fetch: async () => ({ ok: true, json: async () => ({ audioUrl: 'https://cdn.ttsforfree.com/result.mp3' }) }),
    Audio: AudioMock,
    speechSynthesis: { cancel() {}, speak() { throw new Error('browser fallback should not run'); } },
    SpeechSynthesisUtterance: class {},
  };
  const controller = new GevFreeVoiceController({
    runner: async () => ({}), ui: voiceUi(), windowRef,
    documentRef: { addEventListener() {}, removeEventListener() {} },
  });
  controller.speak('Command complete');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, ['https://cdn.ttsforfree.com/result.mp3']);
});

test('free voice falls back to browser speech when natural voice is unavailable', async () => {
  const spoken = [];
  class UtteranceMock { constructor(text) { this.text = text; } }
  const windowRef = {
    fetch: async () => ({ ok: false, json: async () => ({ code: 'not_configured' }) }),
    Audio: class {},
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance.text); } },
    SpeechSynthesisUtterance: UtteranceMock,
  };
  const controller = new GevFreeVoiceController({
    runner: async () => ({}), ui: voiceUi(), windowRef,
    documentRef: { addEventListener() {}, removeEventListener() {} },
  });
  controller.speak('Command complete');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(spoken, ['Command complete']);
});
