const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  Updater,
  UpdateError,
  compareVersions,
  parseChecksums,
  releaseAssets,
  mountPointFromPlist,
  RELEASE_API
} = require('../electron/updater.cjs');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeBundle(root) {
  const bundle = path.join(root, 'Applications/Canvas Pro.app');
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), '<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>local.assetlibrary.desktop</string><key>CFBundleShortVersionString</key><string>1.1.3</string></dict></plist>');
  return bundle;
}

function releasePayload(version, { dmgURL, sumsURL } = {}) {
  return {
    tag_name: 'v' + version,
    name: 'Canvas Pro ' + version,
    body: 'A quieter update.',
    html_url: 'https://github.com/magembesolomonn/Canvas-Pro/releases/tag/v' + version,
    published_at: '2026-11-12T00:00:00Z',
    assets: [
      {
        name: 'Canvas-Pro-' + version + '-apple-silicon.dmg',
        browser_download_url: dmgURL || 'https://example.test/Canvas-Pro-' + version + '-apple-silicon.dmg',
        size: 11
      },
      {
        name: 'SHA256SUMS.txt',
        browser_download_url: sumsURL || 'https://example.test/SHA256SUMS.txt',
        size: 100
      }
    ]
  };
}

test('versions compare numerically and release assets are chosen by name', () => {
  assert.equal(compareVersions('v1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.1.3', 'v1.1.3'), 0);
  assert.equal(compareVersions('1.1.2', '1.1.3'), -1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.1', '1.2'), 1);

  const sums = parseChecksums('a'.repeat(64) + '  Canvas-Pro-1.2.0.dmg\n' + 'b'.repeat(64) + ' *SHA256SUMS.txt\n');
  assert.equal(sums.get('Canvas-Pro-1.2.0.dmg'), 'a'.repeat(64));
  assert.equal(sums.get('SHA256SUMS.txt'), 'b'.repeat(64));

  const assets = releaseAssets({
    assets: [
      { name: 'Canvas-Pro-Capture-1.2.0.zip' },
      { name: 'Canvas-Pro-1.2.0-apple-silicon.dmg' },
      { name: 'SHA256SUMS.txt' }
    ]
  });
  assert.equal(assets.dmg.name, 'Canvas-Pro-1.2.0-apple-silicon.dmg');
  assert.equal(assets.sums.name, 'SHA256SUMS.txt');
});

test('check reports a newer release and whether this copy can install it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-updater-check-'));
  try {
    const bundle = fakeBundle(root);
    const updater = new Updater({
      currentVersion: '1.1.3',
      appBundle: bundle,
      isPackaged: true,
      allowAnyLocation: true,
      tempRoot: root,
      fetchImpl: async () => jsonResponse(releasePayload('1.1.4'))
    });
    const result = await updater.check();
    assert.equal(result.available, true);
    assert.equal(result.version, '1.1.4');
    assert.equal(result.currentVersion, '1.1.3');
    assert.equal(result.installable, true);
    assert.equal(result.size, 11);

    const upToDate = new Updater({
      currentVersion: '1.1.4',
      appBundle: bundle,
      isPackaged: true,
      allowAnyLocation: true,
      tempRoot: root,
      fetchImpl: async () => jsonResponse(releasePayload('1.1.4'))
    });
    const same = await upToDate.check();
    assert.equal(same.available, false);
    assert.equal(same.installable, false);

    const noRelease = new Updater({
      currentVersion: '1.1.4',
      appBundle: bundle,
      isPackaged: true,
      allowAnyLocation: true,
      tempRoot: root,
      fetchImpl: async () => jsonResponse({ message: 'Not Found' }, 404)
    });
    const none = await noRelease.check();
    assert.equal(none.available, false);
    assert.match(none.reason, /No public release/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('check explains why development and disk-image copies cannot self-install', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-updater-block-'));
  try {
    const dev = new Updater({
      currentVersion: '1.1.3',
      appBundle: path.join(root, 'dist/Canvas Pro.app'),
      isPackaged: false,
      tempRoot: root,
      fetchImpl: async () => jsonResponse(releasePayload('1.1.4'))
    });
    const development = await dev.check();
    assert.equal(development.available, true);
    assert.equal(development.installable, false);
    assert.match(development.reason, /development copy/);

    const outside = new Updater({
      currentVersion: '1.1.3',
      appBundle: path.join(root, 'Downloads/Canvas Pro.app'),
      isPackaged: true,
      tempRoot: root,
      fetchImpl: async () => jsonResponse(releasePayload('1.1.4'))
    });
    const moved = await outside.check();
    assert.match(moved.reason, /installed in Applications/);

    const volume = new Updater({
      currentVersion: '1.1.3',
      appBundle: '/Volumes/Canvas Pro/Canvas Pro.app',
      isPackaged: true,
      tempRoot: root,
      fetchImpl: async () => jsonResponse(releasePayload('1.1.4'))
    });
    const mounted = await volume.check();
    assert.match(mounted.reason, /read-only disk image/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('download streams the DMG, reports progress and verifies SHA-256', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-updater-download-'));
  const payload = crypto.randomBytes(192 * 1024);
  const checksum = crypto.createHash('sha256').update(payload).digest('hex');
  let server;
  try {
    server = http.createServer((request, response) => {
      if (request.url === '/SHA256SUMS.txt') {
        response.end(checksum + '  Canvas-Pro-1.1.4-apple-silicon.dmg\n');
        return;
      }
      response.setHeader('content-length', payload.length);
      response.end(payload);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const bundle = fakeBundle(root);
    const events = [];
    const payloadRelease = releasePayload('1.1.4', { dmgURL: origin + '/Canvas-Pro-1.1.4-apple-silicon.dmg', sumsURL: origin + '/SHA256SUMS.txt' });
    payloadRelease.assets[0].size = payload.length;
    const updater = new Updater({
      currentVersion: '1.1.3',
      appBundle: bundle,
      isPackaged: true,
      allowAnyLocation: true,
      tempRoot: root,
      onProgress: event => events.push(event),
      fetchImpl: (url, options) => url === RELEASE_API
        ? Promise.resolve(jsonResponse(payloadRelease))
        : fetch(url, options)
    });
    const release = await updater.check();
    assert.equal(release.installable, true);
    const downloaded = await updater.download();
    assert.equal(downloaded.version, '1.1.4');
    assert.equal(downloaded.size, payload.length);
    assert.ok(fs.existsSync(updater.downloaded.dmgPath));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(updater.downloaded.dmgPath)).digest('hex'), checksum);
    assert.ok(events.some(event => event.phase === 'download' && event.percent === 100));
    assert.ok(events.some(event => event.phase === 'verify'));
  } finally {
    await new Promise(resolve => server?.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a bad checksum discards the download and leaves no update behind', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-updater-bad-'));
  let server;
  try {
    server = http.createServer((request, response) => {
      if (request.url === '/SHA256SUMS.txt') {
        response.end('0'.repeat(64) + '  Canvas-Pro-1.1.4-apple-silicon.dmg\n');
        return;
      }
      response.end('not the published bytes');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const bundle = fakeBundle(root);
    const badRelease = releasePayload('1.1.4', { dmgURL: origin + '/Canvas-Pro-1.1.4-apple-silicon.dmg', sumsURL: origin + '/SHA256SUMS.txt' });
    badRelease.assets[0].size = Buffer.byteLength('not the published bytes');
    const updater = new Updater({
      currentVersion: '1.1.3',
      appBundle: bundle,
      isPackaged: true,
      allowAnyLocation: true,
      tempRoot: root,
      fetchImpl: (url, options) => url === RELEASE_API
        ? Promise.resolve(jsonResponse(badRelease))
        : fetch(url, options)
    });
    await updater.check();
    await assert.rejects(() => updater.download(), error => {
      assert.ok(error instanceof UpdateError);
      assert.match(error.message, /checksum/i);
      return true;
    });
    assert.equal(updater.downloaded, null);
    assert.equal(fs.readdirSync(root).filter(name => name.startsWith('canvas-pro-update-')).length, 0);
  } finally {
    await new Promise(resolve => server?.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('install stages the new bundle and hands the swap to a detached helper', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-updater-install-'));
  try {
    const bundle = fakeBundle(root);
    const mount = path.join(root, 'mounted');
    const mountedApp = path.join(mount, 'Canvas Pro.app');
    fs.mkdirSync(path.join(mountedApp, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(mountedApp, 'Contents/Info.plist'), 'new');
    const calls = [];
    const updater = new Updater({
      currentVersion: '1.1.3',
      appBundle: bundle,
      isPackaged: true,
      allowAnyLocation: true,
      tempRoot: root,
      runCommand: async (command, args) => {
        calls.push([command, ...args]);
        if (command === '/usr/bin/hdiutil' && args[0] === 'attach') {
          return { stdout: '<?xml version="1.0"?><plist><dict><key>mount-point</key><string>' + mount + '</string></dict></plist>', stderr: '' };
        }
        if (command === '/usr/bin/hdiutil') return { stdout: '', stderr: '' };
        if (command === '/usr/libexec/PlistBuddy') {
          const file = args[args.length - 1];
          if (args[1].includes('CFBundleIdentifier')) return { stdout: 'local.assetlibrary.desktop\n', stderr: '' };
          return { stdout: file === path.join(mountedApp, 'Contents/Info.plist') ? '1.1.4\n' : '1.1.3\n', stderr: '' };
        }
        if (command === '/usr/bin/codesign') return { stdout: '', stderr: '' };
        if (command === '/usr/bin/ditto') {
          fs.cpSync(args[0], args[1], { recursive: true });
          return { stdout: '', stderr: '' };
        }
        throw new Error('Unexpected command: ' + command);
      },
      spawnDetached: (command, args) => {
        calls.push([command, ...args]);
        fs.writeFileSync(args[5] + '.started', '');
        return { unref() {} };
      },
      quit: () => calls.push(['quit'])
    });
    updater.release = { version: '1.1.4', dmg: { name: 'Canvas-Pro-1.1.4-apple-silicon.dmg' } };
    const directory = path.join(root, 'download');
    fs.mkdirSync(directory);
    const dmgPath = path.join(directory, 'Canvas-Pro-1.1.4-apple-silicon.dmg');
    fs.writeFileSync(dmgPath, 'dmg');
    updater.downloaded = { version: '1.1.4', dmgPath, sumsPath: path.join(directory, 'SHA256SUMS.txt'), directory };

    const result = await updater.install();
    assert.equal(result.installing, true);
    assert.equal(result.version, '1.1.4');
    assert.ok(calls.some(call => call[0] === '/usr/bin/ditto'));
    assert.ok(calls.some(call => call[0] === '/bin/bash'));
    const spawn = calls.find(call => call[0] === '/bin/bash');
    const script = spawn[1], target = spawn[3], staged = spawn[4], old = spawn[5], log = spawn[6], openCommand = spawn[7];
    assert.equal(target, bundle);
    assert.match(staged, /\.Canvas Pro Update-/);
    assert.equal(old, bundle + '.previous-update');
    assert.ok(fs.existsSync(script));
    assert.ok(fs.existsSync(staged));
    assert.equal(openCommand, '/usr/bin/open');
    assert.ok(fs.readFileSync(script, 'utf8').includes('kill -0 "$pid"'));
    await wait(400);
    assert.ok(calls.some(call => call[0] === 'quit'));

    // Run the same helper against a disposable target: it must wait for the
    // old process, move the old bundle aside, put the staged app in place and
    // remove the backup. No real app is touched.
    fs.writeFileSync(path.join(staged, 'new-marker'), 'new');
    execFileSync('/bin/bash', [script, '999999', target, staged, old, log, '/usr/bin/true'], {
      env: { ...process.env, CANVAS_UPDATE_SLEEP: '0' },
      timeout: 10000
    });
    assert.equal(fs.readFileSync(path.join(target, 'new-marker'), 'utf8'), 'new');
    assert.equal(fs.existsSync(old), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
