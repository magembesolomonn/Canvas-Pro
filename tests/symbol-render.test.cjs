const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SymbolRenderer } = require('../electron/symbol-render.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-render-'));
  fs.mkdirSync(path.join(root, 'src', 'assets', 'symbols'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'symbols', 'heart.png'), 'fallback-png');
  const cacheDir = path.join(root, 'cache');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, cacheDir };
}

function params(name = 'heart', key = 'heart') {
  return new URLSearchParams({ name, key, size: '20', weight: 'regular', scale: '2' });
}

test('symbol renderer falls back to the checked-in PNG when the helper is missing', async t => {
  const { root, cacheDir } = fixture(t);
  const renderer = new SymbolRenderer({ root, cacheDir, helper: path.join(root, 'missing-tool') });
  const result = await renderer.render(params());
  assert.equal(result.buffer.toString(), 'fallback-png');
  // The fallback must not be cached as a native render, or a later helper
  // build would never be used.
  assert.equal(fs.existsSync(cacheDir), true);
  assert.deepEqual(fs.readdirSync(cacheDir), []);
});

test('symbol renderer uses the helper and caches its output', async t => {
  const { root, cacheDir } = fixture(t);
  const helper = path.join(root, 'fake-tool');
  fs.writeFileSync(helper, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.argv.at(-1), "native-png");\n', { mode: 0o755 });
  const renderer = new SymbolRenderer({ root, cacheDir, helper });
  const result = await renderer.render(params());
  assert.equal(result.buffer.toString(), 'native-png');
  assert.equal(fs.readdirSync(cacheDir).length, 1);
  const second = await new SymbolRenderer({ root, cacheDir, helper: path.join(root, 'now-missing') }).render(params());
  assert.equal(second.buffer.toString(), 'native-png');
});

test('symbol renderer rejects malformed names', async t => {
  const { root, cacheDir } = fixture(t);
  const renderer = new SymbolRenderer({ root, cacheDir, helper: path.join(root, 'missing-tool') });
  const result = await renderer.render(params('../../etc/passwd'));
  assert.equal(result.status, 400);
});
