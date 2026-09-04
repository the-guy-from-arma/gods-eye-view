import { initAccounts } from './account.js';
import { detectPhoneLikeDevice } from './deviceCompatibility.js';

const loadingScreen = document.getElementById('loading-screen');
const loaderStatus = loadingScreen?.querySelector('.loader-status');
const phaseOrder = ['auth', 'database', 'runtime', 'globe', 'feeds', 'ready'];
let started = false;

function setBootPhase(name, message) {
  const index = phaseOrder.indexOf(name);
  for (const [phaseIndex, phaseName] of phaseOrder.entries()) {
    const node = loadingScreen?.querySelector(`[data-boot-phase="${phaseName}"]`);
    node?.classList.toggle('active', phaseIndex <= index);
    node?.classList.toggle('current', phaseIndex === index && phaseName !== 'ready');
  }
  if (message && loaderStatus) loaderStatus.textContent = message;
}

function failBoot(message) {
  if (!loaderStatus) return;
  loaderStatus.textContent = message || 'COMMAND CONSOLE FAILED TO START';
  loaderStatus.style.color = '#ff8477';
}

window.__thunderlinkBoot = { phase: setBootPhase, fail: failBoot };

async function startGodsEye() {
  if (started) return;
  started = true;
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-booting');
  const accountDialog = document.getElementById('account-dialog');
  if (accountDialog) accountDialog.hidden = true;
  loadingScreen?.classList.remove('hidden');
  setBootPhase('auth', 'ACCESS GRANTED · VERIFYING SESSION');
  await new Promise((resolve) => setTimeout(resolve, 220));
  setBootPhase('database', 'SESSION VERIFIED · STARTING THUNDERLINK');
  await new Promise((resolve) => setTimeout(resolve, 280));
  setBootPhase('runtime', 'LOADING COMMAND RUNTIME');
  try {
    await import('./main.js');
  } catch (error) {
    started = false;
    failBoot(error?.message || 'COMMAND CONSOLE FAILED TO START');
    throw error;
  }
}

if (detectPhoneLikeDevice()) {
  document.body.classList.add('phone-unsupported');
  document.getElementById('phone-compatibility-gate')?.removeAttribute('hidden');
} else {
  initAccounts({ required: true, onAuthenticated: startGodsEye });
}
