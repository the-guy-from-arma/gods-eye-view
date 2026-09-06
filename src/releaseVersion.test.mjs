import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const owner = readFileSync(new URL('../owner.html', import.meta.url), 'utf8');
const intelligence = readFileSync(new URL('../intelligence.html', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');

test('public build and kernel identifiers stay synchronized with package SemVer', () => {
  const [major, minor, patch] = packageJson.version.split('.').map(Number);
  const displayVersion = `${major}.${minor}.${String(patch).padStart(2, '0')}`;
  const kernelVersion = `TBSGE-KERNEL-${major}${minor}0.${String(patch + 1).padStart(3, '0')}`;

  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  for (const markup of [index, owner, intelligence]) {
    assert.match(markup, new RegExp(`VERSION(?:</small><strong>| <strong>)${displayVersion.replaceAll('.', '\\.')}`));
    assert.match(markup, new RegExp(kernelVersion.replaceAll('.', '\\.')));
  }
});

test('repository policy reserves 0.4.0 for explicit owner authorization', () => {
  assert.match(policy, /Every committed or pushed/);
  assert.match(policy, /Do not advance to `0\.4\.0` until the owner explicitly/);
  assert.match(policy, /Increment the TBSGE kernel build once/);
});
