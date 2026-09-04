#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOCK_CAMERA_FIELDS,
  FLOCK_CAMERA_SCHEMA_VERSION,
  extractFlockCameraRecords,
} from '../src/data/flockCameraData.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sourceArgument, outputOrCommit, explicitCommit] = process.argv.slice(2);
const sourcePath = resolve(sourceArgument || '');
const outputPath = resolve(explicitCommit
  ? outputOrCommit
  : resolve(projectRoot, 'src/data/local_data/flock-cameras/flock-cameras.json'));
const sourceCommit = String(explicitCommit || outputOrCommit || '').trim();

if (!sourceArgument || !sourceCommit) {
  throw new Error('Usage: node scripts/import-flock-cameras.mjs <master.geojson> [output.json] <source-commit>');
}

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
const cameras = extractFlockCameraRecords(source);
if (cameras.length < 1000) throw new Error(`Refusing suspiciously small import (${cameras.length} records)`);

const payload = {
  schemaVersion: FLOCK_CAMERA_SCHEMA_VERSION,
  sourceRepository: 'https://github.com/Ringmast4r/FLOCK',
  sourceCommit,
  sourceUpdated: '2025-11-14',
  license: 'ODbL 1.0 / source-specific public data terms; see README.md',
  fields: FLOCK_CAMERA_FIELDS,
  count: cameras.length,
  cameras,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
console.log(`Imported ${cameras.length.toLocaleString('en-US')} unique Flock camera placements to ${outputPath}`);
