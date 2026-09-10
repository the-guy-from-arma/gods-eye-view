import assert from 'node:assert/strict';
import test from 'node:test';
import { opaqueCameraTitle, redactFrameWithWorker } from '../server/protectedFrameArchive.js';

function headers(values) {
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => normalized[String(name).toLowerCase()] || null };
}

test('protected archive titles are opaque, stable, and omit camera names', () => {
  const input = { cameraId: 'NYSDOT:I-90 Camera 2187', stateCode: 'ny', labelKey: 'a-very-long-private-label-key' };
  const first = opaqueCameraTitle(input);
  const second = opaqueCameraTitle(input);
  assert.deepEqual(first, second);
  assert.match(first.title, /^REDACTED CAMERA · NY · [A-F0-9]{12}$/);
  assert.equal(first.title.includes(input.cameraId), false);
});

test('redaction client accepts only verified JPEG output and returns no OCR data', async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const fetchImpl = async (_url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer worker-secret');
    return {
      ok: true,
      headers: headers({
        'content-type': 'image/jpeg',
        'x-redaction-verified': 'true',
        'x-redacted-region-count': '2',
        'x-redaction-model': 'plate-detector-only',
      }),
      arrayBuffer: async () => jpeg.buffer,
    };
  };
  const result = await redactFrameWithWorker({
    workerUrl: 'https://privacy-worker.internal', workerToken: 'worker-secret',
    frameBytes: Buffer.from(jpeg), mimeType: 'image/jpeg', fetchImpl,
  });
  assert.equal(result.regions, 2);
  assert.equal(result.model, 'plate-detector-only');
  assert.deepEqual(Object.keys(result).sort(), ['mimeType', 'model', 'redactedFrame', 'regions']);
});

test('redaction client fails closed on zero regions or identifying headers', async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const response = (extra = {}) => ({
    ok: true,
    headers: headers({
      'content-type': 'image/jpeg', 'x-redaction-verified': 'true',
      'x-redacted-region-count': '0', ...extra,
    }),
    arrayBuffer: async () => jpeg.buffer,
  });
  await assert.rejects(redactFrameWithWorker({
    workerUrl: 'https://privacy-worker.internal', workerToken: 'secret', frameBytes: Buffer.from(jpeg),
    mimeType: 'image/jpeg', fetchImpl: async () => response(),
  }), /region count is invalid/);
  await assert.rejects(redactFrameWithWorker({
    workerUrl: 'https://privacy-worker.internal', workerToken: 'secret', frameBytes: Buffer.from(jpeg),
    mimeType: 'image/jpeg', fetchImpl: async () => response({ 'x-redacted-region-count': '1', 'x-ocr-text': 'prohibited' }),
  }), /prohibited identifying output/);
});

test('redaction client rejects cleartext non-loopback worker URLs', async () => {
  await assert.rejects(redactFrameWithWorker({
    workerUrl: 'http://privacy-worker.internal', workerToken: 'secret', frameBytes: Buffer.from('x'),
    mimeType: 'image/jpeg', fetchImpl: async () => assert.fail('network called'),
  }), /must use HTTPS/);
});
