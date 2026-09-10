const VEHICLE_TYPES = new Set([
  'car', 'suv', 'pickup', 'van', 'minivan', 'motorcycle', 'bus', 'box_truck',
  'semi_truck', 'emergency_vehicle', 'construction_vehicle', 'other',
]);
const VEHICLE_TYPE_ALIASES = Object.freeze({ pickup_truck: 'pickup', truck: 'pickup', sedan: 'car', crossover: 'suv' });

const OUTPUT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    vehicles: {
      type: 'ARRAY',
      maxItems: 40,
      items: {
        type: 'OBJECT',
        properties: {
          vehicleType: { type: 'STRING' },
          color: { type: 'STRING' },
          make: { type: 'STRING' },
          model: { type: 'STRING' },
          yearStart: { type: 'INTEGER' },
          yearEnd: { type: 'INTEGER' },
          confidence: { type: 'NUMBER' },
          bbox: {
            type: 'ARRAY',
            minItems: 4,
            maxItems: 4,
            items: { type: 'NUMBER' },
          },
        },
        required: ['vehicleType', 'color', 'make', 'model', 'yearStart', 'yearEnd', 'confidence', 'bbox'],
      },
    },
  },
  required: ['vehicles'],
};

function clean(value, max = 80) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function numeric(value, min, max, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeVehicleDetections(value) {
  const source = Array.isArray(value?.vehicles) ? value.vehicles : [];
  return source.slice(0, 40).map((vehicle) => {
    const rawType = clean(vehicle?.vehicleType, 40).toLowerCase().replace(/[\s-]+/g, '_');
    const type = VEHICLE_TYPE_ALIASES[rawType] || rawType;
    const firstYear = Math.round(numeric(vehicle?.yearStart, 1900, new Date().getUTCFullYear() + 2, 0));
    const lastYear = Math.round(numeric(vehicle?.yearEnd, 1900, new Date().getUTCFullYear() + 2, 0));
    const yearStart = firstYear && lastYear ? Math.min(firstYear, lastYear) : firstYear || lastYear;
    const yearEnd = firstYear && lastYear ? Math.max(firstYear, lastYear) : firstYear || lastYear;
    const bbox = Array.isArray(vehicle?.bbox) && vehicle.bbox.length === 4
      ? vehicle.bbox.map((part) => numeric(part, 0, 1, 0))
      : [0, 0, 0, 0];
    return {
      vehicleType: VEHICLE_TYPES.has(type) ? type : 'other',
      color: clean(vehicle?.color || 'unknown', 40).toLowerCase() || 'unknown',
      make: clean(vehicle?.make || 'unknown', 80) || 'unknown',
      model: clean(vehicle?.model || 'unknown', 80) || 'unknown',
      yearStart: yearStart || null,
      yearEnd: yearEnd || null,
      confidence: numeric(vehicle?.confidence, 0, 1, 0),
      bbox,
    };
  }).filter((vehicle) => vehicle.confidence >= 0.2);
}

export async function analyzeVehicleFrame({ apiKey, model, mimeType, imageBase64, fetchImpl = fetch }) {
  if (!apiKey) throw Object.assign(new Error('Gemini vehicle analysis is not configured'), { status: 503 });
  if (!/^image\/(?:jpeg|png|webp)$/i.test(mimeType || '')) {
    throw Object.assign(new Error('Use a JPEG, PNG, or WebP camera frame'), { status: 415 });
  }
  const selectedModel = clean(model || 'gemini-3.8-flash', 80);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
  const prompt = [
    'Classify visible road vehicles in this traffic-camera frame.',
    'Return only visible vehicle attributes: general vehicle type, exterior color, likely make, likely model, broad possible model-year range, confidence from 0 to 1, and normalized [ymin,xmin,ymax,xmax] bounding box.',
    'Use "unknown" when image detail is insufficient. Do not read, transcribe, infer, or return license plates. Do not identify faces, occupants, people, unique markings, ownership, or movement history.',
    'A year estimate must be a broad range, not a precise claim. Do not invent a vehicle when none is visible.',
  ].join(' ');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: OUTPUT_SCHEMA,
        temperature: 0.1,
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = clean(payload?.error?.message, 240) || `Gemini returned HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : 502 });
  }
  const text = payload?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === 'string')?.text;
  if (!text) throw Object.assign(new Error('Gemini returned no vehicle analysis'), { status: 502 });
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Gemini returned malformed vehicle analysis'), { status: 502 });
  }
  return { model: selectedModel, vehicles: normalizeVehicleDetections(parsed) };
}
