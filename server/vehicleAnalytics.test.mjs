import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeVehicleFrame, normalizeVehicleDetections } from './vehicleAnalytics.js';

test('vehicle detections retain only bounded non-identifying attributes', () => {
  const [vehicle] = normalizeVehicleDetections({ vehicles: [{
    vehicleType: 'Pickup Truck', color: 'Blue', make: 'Ford', model: 'F-150',
    yearStart: 2018, yearEnd: 2022, confidence: 1.7, bbox: [-1, 0.2, 0.9, 2],
    plate: 'MUST-NOT-PERSIST', occupant: 'MUST-NOT-PERSIST',
  }] });
  assert.deepEqual(vehicle, {
    vehicleType: 'pickup', color: 'blue', make: 'Ford', model: 'F-150',
    yearStart: 2018, yearEnd: 2022, confidence: 1, bbox: [0, 0.2, 0.9, 1],
  });
  assert.equal('plate' in vehicle, false);
  assert.equal('occupant' in vehicle, false);
});

test('Gemini request forbids plate, occupant, face, and movement analysis', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"vehicles":[]}' }] } }] }) };
  };
  const result = await analyzeVehicleFrame({ apiKey: 'secret', model: 'gemini-test', mimeType: 'image/jpeg', imageBase64: 'AA==', fetchImpl });
  assert.deepEqual(result, { model: 'gemini-test', vehicles: [] });
  assert.match(request.url, /gemini-test:generateContent$/);
  assert.equal(request.headers['x-goog-api-key'], 'secret');
  const prompt = request.body.contents[0].parts[1].text;
  assert.match(prompt, /Do not read, transcribe, infer, or return license plates/);
  assert.match(prompt, /Do not identify faces, occupants/);
  assert.match(prompt, /movement history/);
});

test('vehicle analysis rejects unsupported image types before network access', async () => {
  await assert.rejects(
    analyzeVehicleFrame({ apiKey: 'secret', mimeType: 'image/svg+xml', imageBase64: 'AA==', fetchImpl: async () => assert.fail('network called') }),
    /JPEG, PNG, or WebP/,
  );
});
