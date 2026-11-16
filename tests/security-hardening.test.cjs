const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns');
const { assertPublicHost } = require('../electron/browser-fetch.cjs');
const { CaptureBridge } = require('../electron/capture-bridge.cjs');
const { Library } = require('../electron/library.cjs');

test('private DNS answers are rejected even when a public answer is present', async () => {
  const original = dns.lookup;
  dns.lookup = (host, options, callback) => callback(null, [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 }
  ]);
  try {
    await assert.rejects(() => assertPublicHost('mixed.example'), /public address/);
  } finally {
    dns.lookup = original;
  }
});

test('capture bridge refuses private media URLs unless explicitly allowed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-capture-ssrf-'));
  const library = new Library(path.join(root, 'library'));
  const bridge = new CaptureBridge({
    library,
    directory: path.join(root, 'bridge'),
    fetcher: () => { throw new Error('the guarded fetcher must not be called'); }
  });
  fs.mkdirSync(bridge.directory, { recursive: true });
  try {
    const { jobId } = bridge.handle({
      version: 1,
      op: 'capture',
      items: [{ kind: 'image', title: 'Local', mediaUrl: 'http://127.0.0.1:8080/secret.png' }]
    });
    while (['queued', 'running'].includes(bridge.jobs.get(jobId).state)) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const job = bridge.jobs.get(jobId);
    assert.equal(job.imported, 0);
    assert.match(job.errors[0], /public address/);
  } finally {
    await bridge.close();
    library.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
