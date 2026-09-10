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

export const OPENSKY_OAUTH_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

/** One retry covers short provider/egress blips without stalling every poll. */
export const OPENSKY_OAUTH_MAX_ATTEMPTS = 2;

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

/** Classify a fetch failure without confusing transport trouble with bad keys. */
export function openSkyTransportFailureKind(error) {
  const name = String(error?.name || '').toUpperCase();
  const code = String(error?.cause?.code || error?.code || '').toUpperCase();
  const message = String(error?.message || '').toUpperCase();
  if (
    name === 'ABORTERROR'
    || name === 'TIMEOUTERROR'
    || code.includes('TIMEOUT')
    || message.includes('TIMEOUT')
    || message.includes('ABORTED')
  ) return 'transport_timeout';
  return 'transport_error';
}

/** Parse Retry-After (seconds or HTTP date), bounded for a server cooldown. */
export function openSkyRetryAfterMs(value, nowMs = Date.now()) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(text);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exchange OpenSky client credentials for a bearer token.
 *
 * Returns a structured status rather than `null`, which lets the proxy tell a
 * rejected credential pair apart from a temporarily unreachable auth host.
 * Dependencies are injectable for deterministic unit tests.
 */
export async function fetchOpenSkyOAuthToken({
  clientId,
  clientSecret,
  fetchImpl = globalThis.fetch,
  makeSignal = (timeoutMs) => AbortSignal.timeout(timeoutMs),
  sleepImpl = sleep,
  timeoutMs = 20_000,
  maxAttempts = OPENSKY_OAUTH_MAX_ATTEMPTS,
} = {}) {
  if (!clientId || !clientSecret) {
    return { ok: false, kind: 'not_configured', retryAfterMs: 0 };
  }

  let lastFailure = null;
  const attempts = Math.max(1, Math.min(3, Math.floor(Number(maxAttempts) || 1)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(OPENSKY_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: makeSignal(timeoutMs),
      });
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      const token = String(data?.access_token || '').trim();
      if (response.ok && token) {
        const expiresIn = Number(data?.expires_in);
        return {
          ok: true,
          kind: 'ok',
          token,
          expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 1800,
        };
      }

      const status = Number(response.status) || 0;
      const detail = String(data?.error_description || data?.error || `HTTP ${status}`).slice(0, 240);
      if (status === 401 || status === 403 || status === 400) {
        return { ok: false, kind: 'credentials_rejected', status, detail, retryAfterMs: 15 * 60_000 };
      }
      if (status === 429) {
        const retryAfter = openSkyRetryAfterMs(response.headers?.get?.('retry-after'));
        return {
          ok: false,
          kind: 'rate_limited',
          status,
          detail,
          retryAfterMs: Math.min(Math.max(retryAfter ?? 120_000, 30_000), 30 * 60_000),
        };
      }
      lastFailure = {
        ok: false,
        kind: 'provider_error',
        status,
        detail,
        retryAfterMs: 60_000,
      };
      if (status < 500 || attempt >= attempts - 1) return lastFailure;
    } catch (error) {
      lastFailure = {
        ok: false,
        kind: openSkyTransportFailureKind(error),
        detail: openSkyFetchFailureDetail(error),
        retryAfterMs: 60_000,
      };
      if (attempt >= attempts - 1) return lastFailure;
    }
    await sleepImpl(500 * (attempt + 1));
  }
  return lastFailure || { ok: false, kind: 'transport_error', retryAfterMs: 60_000 };
}
