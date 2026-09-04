/**
 * Server-side resilience policy for the OpenSky proxy.
 *
 * Kept independent from Vite so the retry and diagnostic rules can be tested
 * without starting the application server.
 */

export const OPENSKY_TRANSPORT_BACKOFF_MS = Object.freeze([
  30_000,
  60_000,
  120_000,
  300_000,
]);

/** Return the bounded cooldown for a run of consecutive transport failures. */
export function openSkyTransportCooldownMs(consecutiveFailures) {
  const count = Math.max(1, Math.floor(Number(consecutiveFailures) || 1));
  return OPENSKY_TRANSPORT_BACKOFF_MS[
    Math.min(count - 1, OPENSKY_TRANSPORT_BACKOFF_MS.length - 1)
  ];
}

/**
 * Produce a useful, secret-free diagnostic for Node fetch failures.
 * Undici commonly places the actionable DNS/TLS/socket code on `cause` while
 * the public error message is only "fetch failed".
 */
export function openSkyFetchFailureDetail(error) {
  const message = String(error?.message || error || 'unknown error').trim();
  const causeCode = String(error?.cause?.code || '').trim();
  const causeMessage = String(error?.cause?.message || '').trim();
  const detail = causeCode || causeMessage;
  if (!detail || message.includes(detail)) return message.slice(0, 240);
  return `${message} (${detail})`.slice(0, 240);
}
