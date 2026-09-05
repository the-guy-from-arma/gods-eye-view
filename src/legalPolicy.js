export const CURRENT_LEGAL_VERSION = '0.3.02';
export const LEGAL_EFFECTIVE_DATE = 'September 5, 2026';

export function legalAcceptanceIsCurrent(value) {
  return String(value || '') === CURRENT_LEGAL_VERSION;
}
