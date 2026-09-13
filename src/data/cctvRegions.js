export const CCTV_REGION_NAMES = Object.freeze({
  TX: 'Texas', 'CA-BC': 'British Columbia', 'CA-ON': 'Ontario', 'CA-NL': 'Newfoundland and Labrador',
  'CA-AB': 'Alberta', 'CA-MB': 'Manitoba', 'CA-NB': 'New Brunswick', 'CA-YT': 'Yukon',
  'AU-NSW': 'New South Wales', 'AU-QLD': 'Queensland',
});

export function normalizeCctvRegion(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^(?:[A-Z]{2}|CA-[A-Z]{2}|AU-[A-Z]{2,3})$/.test(code) ? code : '';
}

export function cctvRegionCountry(code) {
  return code.startsWith('CA-') ? 'Canada' : code.startsWith('AU-') ? 'Australia' : 'United States';
}

export function isLiveTrafficCameraId(id) {
  return String(id || '').startsWith('live-traffic-');
}
