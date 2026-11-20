// Invariants that the app depends on but that no existing test pinned down.
// Each one is a place where a silent change would corrupt behaviour without
// throwing: duplicate detection missing pairs, the canvas index dropping
// items, or a URL guard letting a private address through.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { distance, bands, signature, token } = require('../electron/perceptual-hash.cjs');
const { SpatialIndex, intersects } = require('../src/canvas-model.js');
const { isPublicAddress } = require('../electron/public-fetch.cjs');
const { compareVersions, parseChecksums, releaseAssets } = require('../electron/updater.cjs');
const Layout = require('../src/layout.js');

function randomHash() {
  let value = '';
  for (let index = 0; index < 16; index += 1) value += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return value;
}
function flipBits(hash, count) {
  let bits = BigInt('0x' + hash);
  for (let index = 0; index < count; index += 1) bits ^= 1n << BigInt(Math.floor(Math.random() * 64));
  return bits.toString(16).padStart(16, '0');
}

test('two fingerprints within the duplicate threshold always share two bands', () => {
  // The band index is what keeps duplicate review fast. If this invariant
  // breaks, real duplicates stop being found and nothing reports an error.
  for (let trial = 0; trial < 4000; trial += 1) {
    const left = randomHash();
    const right = flipBits(left, Math.floor(Math.random() * 7));
    if (distance(left, right) > 6) continue;
    const shared = bands(left).filter((band, index) => band === bands(right)[index]).length;
    assert.ok(shared >= 2, `${left} and ${right} share only ${shared} bands`);
  }
});

test('distance rejects malformed fingerprints instead of guessing', () => {
  assert.equal(distance('', ''), 64);
  assert.equal(distance('zzzzzzzzzzzzzzzz', randomHash()), 64);
  assert.equal(distance(null, undefined), 64);
  assert.equal(distance('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(distance('0000000000000000', '0000000000000001'), 1);
});

test('fingerprint tokens are order independent and stable', () => {
  assert.equal(signature(['b', 'a', 'a']), 'a:b');
  assert.equal(token(['a', 'b']), token(['b', 'a']));
  assert.notEqual(token(['a']), token(['a', 'b']));
});

test('the canvas spatial index answers exactly like a linear scan', () => {
  const make = (id, x, y, width, height, z) => ({ id, z, data: { x, y, width, height } });
  for (let trial = 0; trial < 120; trial += 1) {
    const items = [];
    const count = 1 + Math.floor(Math.random() * 40);
    for (let index = 0; index < count; index += 1) {
      items.push(make('i' + index, Math.random() * 3000 - 1500, Math.random() * 3000 - 1500, Math.random() * 250 + 1, Math.random() * 250 + 1, index));
    }
    const index = new SpatialIndex(items, 1024);
    for (let query = 0; query < 12; query += 1) {
      const rect = { x: Math.random() * 3000 - 1500, y: Math.random() * 3000 - 1500, width: Math.random() * 600, height: Math.random() * 600 };
      const found = new Set(index.query(rect).map(item => item.id));
      const expected = new Set(items.filter(item => intersects(item.data, rect)).map(item => item.id));
      assert.equal(found.size, expected.size, 'index returned a different number of items than a linear scan');
      for (const id of expected) assert.ok(found.has(id), `index missed ${id}`);
    }
  }
});

test('hit testing returns the topmost item', () => {
  const index = new SpatialIndex([
    { id: 'under', z: 1, data: { x: 0, y: 0, width: 100, height: 100 } },
    { id: 'over', z: 9, data: { x: 0, y: 0, width: 100, height: 100 } }
  ], 1024);
  assert.equal(index.hit(50, 50).id, 'over');
  assert.equal(index.hit(500, 500), null);
});

test('the automatic-preview guard refuses every private and reserved address', () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '127.0.0.1', '127.255.255.255', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255',
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '198.19.255.255', '192.0.0.1',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '192.88.99.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd00::1', 'ff00::1', '2001:db8::1', '2002::1', '3fff::1'
  ];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, `${address} must not be fetchable`);
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111'];
  for (const address of allowed) assert.equal(isPublicAddress(address), true, `${address} must be fetchable`);
});

test('version comparison orders numbers, not strings', () => {
  assert.equal(compareVersions('1.1.11', '1.1.9'), 1);
  assert.equal(compareVersions('1.1.9', '1.1.11'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('2', '1.9.9'), 1);
  assert.equal(compareVersions('', '1'), -1);
});

test('checksum parsing accepts the real formats and ignores junk', () => {
  const digest = 'a'.repeat(64);
  assert.equal(parseChecksums(`${digest}  Canvas Pro.dmg`).get('Canvas Pro.dmg'), digest);
  assert.equal(parseChecksums(`${digest.toUpperCase()} *Canvas Pro.dmg\r\n`).get('Canvas Pro.dmg'), digest);
  assert.equal(parseChecksums('not a checksum').size, 0);
  assert.equal(parseChecksums('').size, 0);
});

test('release selection prefers the Apple Silicon disk image', () => {
  const release = { assets: [
    { name: 'Canvas Pro-1.2.0-x64.dmg' },
    { name: 'Canvas Pro-1.2.0-arm64.dmg' },
    { name: 'SHA256SUMS.txt' },
    { name: 'update.sig' }
  ] };
  const picked = releaseAssets(release);
  assert.match(picked.dmg.name, /arm64/);
  assert.match(picked.sums.name, /SHA256SUMS/);
  assert.match(picked.sig.name, /update\.sig/);
  assert.deepEqual(releaseAssets({}), { dmg: undefined, sums: undefined, sig: undefined });
});

test('the gallery layout survives missing and nonsensical aspect ratios', () => {
  for (const ratio of [undefined, null, NaN, 0, -2, Infinity]) {
    const layout = Layout.createLayout('masonry', [{ id: 'a', aspectRatio: ratio }], 1000, 230);
    const position = layout.positions[0];
    assert.ok(Number.isFinite(position.width) && position.width > 0, `ratio ${ratio} produced width ${position.width}`);
    assert.ok(Number.isFinite(position.surfaceHeight) && position.surfaceHeight > 0, `ratio ${ratio} produced height ${position.surfaceHeight}`);
  }
  assert.equal(Layout.createLayout('masonry', [], 1000, 230).positions.length, 0);
});
