const FREE_STATUS = Object.freeze({
  idle: 'OFF',
  connecting: 'STARTING',
  listening: 'LISTENING',
  executing: 'EXECUTING',
  error: 'ERROR',
});

const LAYER_PHRASES = [
  'military flights',
  'breaking news',
  'global events',
  'live events',
  'active fires',
  'space missions',
  'rocket launches',
  'submarine cables',
  'data centers',
  'data centres',
  'radio stations',
  'live vessels',
  'earthquakes',
  'satellites',
  'datacenters',
  'bikeshare',
  'aircraft',
  'missions',
  'traffic',
  'cameras',
  'flights',
  'military',
  'vessels',
  'planes',
  'quakes',
  'cables',
  'ships',
  'fires',
  'dams',
  'radio',
  'cctv',
  'news',
  'bikes',
];

const LAYER_PATTERN = LAYER_PHRASES
  .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

function freeLayerId(phrase) {
  return phrase === 'rocket launches' ? 'rocket-launches' : phrase;
}

function cleanSpeech(value) {
  return String(value || '')
    .trim()
    .replace(/[?!.,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

/** Convert a spoken phrase into one existing God's Eye action. */
export function parseFreeVoiceCommand(value) {
  const spoken = cleanSpeech(value);
  const text = spoken.toLowerCase();
  if (!text) return null;

  if (/^(?:stop|cancel|never mind|stop listening)$/.test(text)) {
    return { localAction: 'stop', confirmation: 'Voice off' };
  }

  if (/\b(?:whole (?:earth|planet)|globe view|show (?:the )?globe|zoom (?:all the way )?out to (?:the )?globe)\b/.test(text)) {
    return { name: 'zoom_to_globe', args: {}, confirmation: 'Globe view' };
  }

  if (/^(?:zoom|get|move)\s+(?:a\s+)?(?:little\s+)?closer$/.test(text) || /^zoom\s+in(?:\s+(?:a little|more|a lot))?$/.test(text)) {
    const amount = /a lot/.test(text) ? 'lot' : /little/.test(text) ? 'little' : 'medium';
    return { name: 'adjust_camera_zoom', args: { direction: 'in', amount }, confirmation: 'Zooming in' };
  }
  if (/^(?:zoom|pull|move)\s+(?:a\s+)?(?:little\s+)?(?:back|out)$/.test(text) || /^zoom\s+out(?:\s+(?:a little|more|a lot))?$/.test(text)) {
    const amount = /a lot/.test(text) ? 'lot' : /little/.test(text) ? 'little' : 'medium';
    return { name: 'adjust_camera_zoom', args: { direction: 'out', amount }, confirmation: 'Zooming out' };
  }

  if (/^(?:stop|cancel)\s+(?:following|tracking)$/.test(text)) {
    return { name: 'stop_tracking', args: {}, confirmation: 'Tracking stopped' };
  }
  const tracking = text.match(/^(?:track|follow)\s+(.+)$/);
  if (tracking) {
    return { name: 'track_entity', args: { query: tracking[1] }, confirmation: `Tracking ${tracking[1]}` };
  }

  const layerOn = text.match(new RegExp(`^(?:show|show me|enable|display|turn on|open)\\s+(?:the\\s+)?(${LAYER_PATTERN})(?:\\s+(?:layer|markers))?$`));
  if (layerOn) {
    return {
      name: 'set_layer_visibility',
      args: { layerId: freeLayerId(layerOn[1]), enabled: true },
      confirmation: `${layerOn[1]} on`,
    };
  }
  const layerOff = text.match(new RegExp(`^(?:hide|disable|turn off|close)\\s+(?:the\\s+)?(${LAYER_PATTERN})(?:\\s+(?:layer|markers))?$`));
  if (layerOff) {
    return {
      name: 'set_layer_visibility',
      args: { layerId: freeLayerId(layerOff[1]), enabled: false },
      confirmation: `${layerOff[1]} off`,
    };
  }

  const style = text.match(/^(?:use|set|enable|turn on|switch to)\s+(?:the\s+)?(night vision|nvg|thermal|flir|surveillance|normal|default)(?:\s+(?:mode|style|filter))?$/);
  if (style) {
    return { name: 'set_visual_style', args: { style: style[1] }, confirmation: `${style[1]} style` };
  }

  const stack = text.match(/^(?:use|set|show|switch to)\s+(?:the\s+)?(google 3d|photoreal|photorealistic|bing aerial|bing labels|aerial with labels|esri|esri imagery|osm|road map)(?:\s+(?:map|imagery|basemap))?$/);
  if (stack) {
    return { name: 'set_map_stack', args: { stack: stack[1] }, confirmation: `${stack[1]} map` };
  }

  const hud = text.match(/^(?:turn|switch|set)\s+(?:the\s+)?hud\s+(on|off)$/);
  if (hud) {
    return { name: 'set_hud', args: { visible: hud[1] === 'on' }, confirmation: `HUD ${hud[1]}` };
  }
  const hudLayout = text.match(/^(?:use|set|switch to)\s+(operator|minimal|tactical)(?:\s+hud)?(?:\s+layout)?$/);
  if (hudLayout) {
    return { name: 'set_hud', args: { layout: hudLayout[1] }, confirmation: `${hudLayout[1]} HUD` };
  }

  const destination = text.match(/^(?:go|fly|navigate|take me)(?:\s+to)?\s+(.+)$/)
    || text.match(/^(?:search for|search|find|show me)\s+(.+)$/);
  if (destination?.[1]) {
    return {
      name: 'fly_to_location',
      args: { query: destination[1] },
      confirmation: `Flying to ${destination[1]}`,
    };
  }

  return null;
}

export function freeVoiceResultMessage(command, result) {
  if (!result?.ok) return result?.error || 'Command failed';
  if (result.action === 'fly_to_location') return `Flying to ${result.label || command.args.query}`;
  if (result.action === 'set_layer_visibility') return `${result.label || command.args.layerId} ${command.args.enabled ? 'on' : 'off'}`;
  if (result.action === 'track_entity') return `Tracking ${result.label || command.args.query}`;
  return command.confirmation || 'Command complete';
}

function recognitionConstructor(windowRef) {
  return windowRef?.SpeechRecognition || windowRef?.webkitSpeechRecognition || null;
}

function isEditableTarget(target) {
  if (target?.isContentEditable) return true;
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable], [role="textbox"]'));
}

/** Keyless one-command-at-a-time voice controller backed by the Web Speech API. */
export class GevFreeVoiceController {
  constructor({ runner, ui, windowRef = window, documentRef = document }) {
    this.runner = runner;
    this.ui = ui;
    this.windowRef = windowRef;
    this.documentRef = documentRef;
    this.recognition = null;
    this.status = 'idle';
    this.pushToTalk = false;
    this.spaceKeyHeld = false;
    this.commandHandled = false;
    this.buttonHandler = null;
    this.shortcutKeyDownHandler = null;
    this.shortcutKeyUpHandler = null;
    this.shortcutBlurHandler = null;
    this.annotationEventUnsubscribe = null;
    this.configureUi();
  }

  configureUi() {
    const kicker = this.ui.root.querySelector('.gev-voice-kicker');
    if (kicker) kicker.textContent = 'VOICE COMMANDS';
    if (this.ui.tierButton) {
      this.ui.tierButton.textContent = 'FREE';
      this.ui.tierButton.disabled = true;
      this.ui.tierButton.title = 'Free browser voice — no API charges';
    }
    if (this.ui.costValue) {
      this.ui.costValue.textContent = '$0';
      this.ui.costValue.title = 'No paid voice API';
    }
    if (this.ui.helpDetail) this.ui.helpDetail.textContent = 'Click mic and speak one command · hold Space to talk';
    this.ui.button.setAttribute('aria-label', 'Free voice command — click or hold Space, then speak');
    this.setStatus('idle', 'FREE VOICE READY');
  }

  isActive() {
    return this.status === 'connecting' || this.status === 'listening' || this.status === 'executing';
  }

  syncCostUi() {
    // The shared initializer calls this for the paid controller's live meter.
    // Free mode configured its fixed $0 display in configureUi().
  }

  start({ pushToTalk = false } = {}) {
    if (this.isActive()) return;
    const Recognition = recognitionConstructor(this.windowRef);
    if (!Recognition) {
      this.setStatus('error', 'Free voice requires Chrome or Edge speech recognition');
      return;
    }
    this.pushToTalk = Boolean(pushToTalk);
    this.commandHandled = false;
    this.windowRef?.speechSynthesis?.cancel?.();
    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => this.setStatus('listening', 'Speak a command');
    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => this.handleError(event);
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      if (this.status === 'listening' || this.status === 'connecting') {
        this.setStatus('idle', this.commandHandled ? 'COMMAND COMPLETE' : 'NO SPEECH HEARD');
      }
    };
    this.setStatus('connecting', 'Starting microphone');
    try {
      recognition.start();
    } catch (error) {
      this.recognition = null;
      this.setStatus('error', error?.message || 'Could not start microphone');
    }
  }

  async handleResult(event) {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex || 0; i < event.results.length; i++) {
      const transcript = event.results[i]?.[0]?.transcript || '';
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (interim && !finalText) this.setStatus('listening', cleanSpeech(interim));
    if (!finalText || this.commandHandled) return;
    this.commandHandled = true;
    const spoken = cleanSpeech(finalText);
    const command = parseFreeVoiceCommand(spoken);
    if (!command) {
      this.setStatus('error', `Command not recognized: ${spoken}`);
      this.speak('Command not recognized');
      return;
    }
    if (command.localAction === 'stop') {
      this.stop();
      return;
    }
    this.setStatus('executing', spoken);
    try {
      const result = await this.runner(command.name, command.args);
      const message = freeVoiceResultMessage(command, result);
      this.setStatus(result?.ok ? 'idle' : 'error', message);
      this.speak(message);
    } catch (error) {
      const message = error?.message || 'Command failed';
      this.setStatus('error', message);
      this.speak(message);
    }
  }

  handleError(event) {
    const code = String(event?.error || 'unknown');
    if (code === 'aborted') return;
    const detail = code === 'not-allowed' || code === 'service-not-allowed'
      ? 'Microphone or speech recognition permission denied'
      : code === 'no-speech'
        ? 'No speech heard — try again'
        : `Speech recognition error: ${code}`;
    this.setStatus(code === 'no-speech' ? 'idle' : 'error', detail);
  }

  speak(message) {
    const synthesis = this.windowRef?.speechSynthesis;
    const Utterance = this.windowRef?.SpeechSynthesisUtterance;
    if (!synthesis || !Utterance || !message) return;
    try {
      synthesis.cancel();
      const utterance = new Utterance(String(message).slice(0, 180));
      utterance.rate = 1.05;
      synthesis.speak(utterance);
    } catch {
      // On-screen confirmation remains available when speech synthesis is blocked.
    }
  }

  setStatus(status, detail) {
    this.status = status;
    this.ui.root.dataset.status = status;
    this.ui.status.textContent = FREE_STATUS[status] || FREE_STATUS.idle;
    this.ui.detail.textContent = detail || (status === 'idle' ? 'FREE VOICE READY' : 'VOICE ACTIVE');
    this.ui.detail.title = this.ui.detail.textContent;
    if (this.ui.errorDetail) this.ui.errorDetail.textContent = status === 'error' ? this.ui.detail.textContent : '';
    if (this.ui.buttonLabel) this.ui.buttonLabel.textContent = this.isActive() ? 'STOP' : 'SPEAK';
  }

  bindPushToTalkShortcut() {
    if (this.shortcutKeyDownHandler) return;
    this.shortcutKeyDownHandler = (event) => {
      if ((event.code !== 'Space' && event.key !== ' ') || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableTarget(event.target)) return;
      if (event.repeat) return;
      event.preventDefault();
      this.spaceKeyHeld = true;
      this.start({ pushToTalk: true });
    };
    this.shortcutKeyUpHandler = (event) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (!this.spaceKeyHeld) return;
      event.preventDefault();
      this.spaceKeyHeld = false;
      try { this.recognition?.stop(); } catch { /* already stopped */ }
    };
    this.shortcutBlurHandler = () => {
      this.spaceKeyHeld = false;
      try { this.recognition?.stop(); } catch { /* already stopped */ }
    };
    this.documentRef.addEventListener('keydown', this.shortcutKeyDownHandler);
    this.documentRef.addEventListener('keyup', this.shortcutKeyUpHandler);
    this.windowRef.addEventListener('blur', this.shortcutBlurHandler);
  }

  stop({ removeUi = false, preserveStatus = false } = {}) {
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
    this.windowRef?.speechSynthesis?.cancel?.();
    this.spaceKeyHeld = false;
    if (removeUi) {
      if (this.buttonHandler) this.ui.button.removeEventListener('click', this.buttonHandler);
      if (this.shortcutKeyDownHandler) this.documentRef.removeEventListener('keydown', this.shortcutKeyDownHandler);
      if (this.shortcutKeyUpHandler) this.documentRef.removeEventListener('keyup', this.shortcutKeyUpHandler);
      if (this.shortcutBlurHandler) this.windowRef.removeEventListener('blur', this.shortcutBlurHandler);
      if (this.annotationEventUnsubscribe) this.annotationEventUnsubscribe();
      this.annotationEventUnsubscribe = null;
      this.ui.root.remove();
    } else if (!preserveStatus) {
      this.setStatus('idle', 'FREE VOICE READY');
    }
  }

  notifyMapEvent() {
    // Free deterministic voice has no remote conversation context to update.
  }
}
