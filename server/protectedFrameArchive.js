import crypto from 'node:crypto';

const MAX_REDACTED_FRAME_BYTES = 1_200_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function serviceError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

function normalizeStateCode(value) {
  const state = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(state) ? state : 'US';
}

export function opaqueCameraTitle({ cameraId, stateCode, labelKey }) {
  if (!cameraId || !labelKey || String(labelKey).length < 24) {
    throw serviceError('Protected archive label key is not configured', 503);
  }
  const reference = crypto.createHmac('sha256', String(labelKey)).update(String(cameraId)).digest('hex').slice(0, 12).toUpperCase();
  return {
    cameraRef: reference,
    title: `REDACTED CAMERA · ${normalizeStateCode(stateCode)} · ${reference}`,
  };
}

export async function redactFrameWithWorker({
  workerUrl,
  workerToken,
  frameBytes,
  mimeType,
  fetchImpl = fetch,
}) {
  if (!workerUrl || !workerToken) throw serviceError('Protected redaction worker is not configured', 503);
  let endpoint;
  try {
    endpoint = new URL('/v1/redact', workerUrl);
  } catch {
    throw serviceError('Protected redaction worker URL is invalid', 503);
  }
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && LOOPBACK_HOSTS.has(endpoint.hostname))) {
    throw serviceError('Protected redaction worker must use HTTPS', 503);
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workerToken}`,
      'Content-Type': mimeType,
      Accept: 'image/jpeg',
    },
    body: frameBytes,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw serviceError(response.status === 422
      ? 'No verified redaction regions were found; raw frame discarded'
      : `Protected redaction failed (HTTP ${response.status}); raw frame discarded`);
  }
  if (response.headers.get('x-redaction-verified') !== 'true') {
    throw serviceError('Redaction could not be verified; raw frame discarded');
  }
  for (const forbidden of ['x-ocr-text', 'x-plate-text', 'x-identifier', 'x-embedding']) {
    if (response.headers.get(forbidden)) throw serviceError('Redaction worker returned prohibited identifying output');
  }
  const regions = Number.parseInt(response.headers.get('x-redacted-region-count') || '', 10);
  if (!Number.isInteger(regions) || regions < 1 || regions > 50) {
    throw serviceError('Redaction region count is invalid; raw frame discarded');
  }
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (contentType !== 'image/jpeg') throw serviceError('Redaction worker returned an unsupported frame type');
  const redactedFrame = Buffer.from(await response.arrayBuffer());
  if (!redactedFrame.length || redactedFrame.length > MAX_REDACTED_FRAME_BYTES) {
    throw serviceError('Redacted frame is empty or exceeds the protected archive limit');
  }
  if (redactedFrame[0] !== 0xff || redactedFrame[1] !== 0xd8) {
    throw serviceError('Redacted frame signature is invalid');
  }
  return {
    redactedFrame,
    mimeType: 'image/jpeg',
    regions,
    model: String(response.headers.get('x-redaction-model') || 'detector-only').slice(0, 80),
  };
}

export const protectedArchiveLimits = Object.freeze({ maxRedactedFrameBytes: MAX_REDACTED_FRAME_BYTES });
