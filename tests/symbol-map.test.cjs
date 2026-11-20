const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function jsMap() {
  const source = fs.readFileSync(path.join(root, 'src', 'symbols.js'), 'utf8');
  return Object.fromEntries([...source.matchAll(/^\s{2}([A-Za-z]+): '([a-z0-9.]+)'/gm)].map(m => [m[1], m[2]]));
}

function swiftMap() {
  const source = fs.readFileSync(path.join(root, 'native', 'Symbols.swift'), 'utf8');
  const entries = [
    ...[...source.matchAll(/"([A-Za-z]+)":"([a-z0-9.]+)"/g)].map(m => [m[1], m[2]]),
    ...[...source.matchAll(/symbols\["([A-Za-z]+)"\]="([a-z0-9.]+)"/g)].map(m => [m[1], m[2]])
  ];
  return Object.fromEntries(entries);
}

test('renderer and fallback generator agree on every symbol key', () => {
  const js = jsMap(), swift = swiftMap();
  assert.ok(Object.keys(js).length > 60, 'symbol map did not parse');
  const drift = Object.keys(js).filter(key => swift[key] !== js[key]).map(key => `${key}: js=${js[key]} swift=${swift[key]}`);
  assert.deepEqual(drift, [], drift.join('\n'));
  assert.deepEqual(Object.keys(swift).sort(), Object.keys(js).sort());
});
