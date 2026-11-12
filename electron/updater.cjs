// Canvas Pro updates: find the newest public release on GitHub, download the
// signed DMG and its checksum, verify both, then hand the app bundle swap to a
// detached helper that runs after this process exits. Nothing here touches the
// library; only the .app bundle is replaced.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const RELEASE_API = 'https://api.github.com/repos/magembesolomonn/Canvas-Pro/releases/latest';
const DOWNLOAD_HEADERS = {
  'User-Agent': 'Canvas-Pro',
  Accept: 'application/octet-stream'
};
const JSON_HEADERS = {
  'User-Agent': 'Canvas-Pro',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

class UpdateError extends Error {
  constructor(message, code = 'update-failed') {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

function versionParts(value) {
  const text = String(value || '').trim().replace(/^v/i, '').split(/[+-]/)[0];
  return text.split('.').map(part => {
    const number = Number.parseInt(part, 10);
    return Number.isFinite(number) ? number : 0;
  });
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function parseChecksums(text) {
  const sums = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) sums.set(path.basename(match[2].trim()), match[1].toLowerCase());
  }
  return sums;
}

function releaseAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const dmg = assets.find(asset => /\.dmg$/i.test(asset.name || '') && /apple[-\s]?silicon|arm64/i.test(asset.name || ''))
    || assets.find(asset => /\.dmg$/i.test(asset.name || ''));
  const sums = assets.find(asset => /^SHA256SUMS\.txt$/i.test(asset.name || ''))
    || assets.find(asset => /sha256/i.test(asset.name || '') && /\.txt$/i.test(asset.name || ''));
  return { dmg, sums };
}

function xmlText(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function mountPointFromPlist(text) {
  const matches = [...String(text || '').matchAll(/<key>mount-point<\/key>\s*<string>([^<]*)<\/string>/g)];
  return matches.length ? xmlText(matches[matches.length - 1][1]) : null;
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

const SWAP_SCRIPT = `#!/bin/bash
# Written by Canvas Pro. Wait for the running app to exit, then replace it.
set -u
pid=$1
target=$2
staged=$3
old=$4
log=$5
open_command=$6
exec >>"$log" 2>&1
: >"$log.started"
echo "Canvas Pro update $(date)"
for _ in $(seq 1 1500); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
done
if kill -0 "$pid" 2>/dev/null; then
  echo "Canvas Pro did not quit; the update was cancelled."
  rm -rf "$staged"
  exit 1
fi
rm -rf "$old"
if ! mv "$target" "$old"; then
  echo "Could not move the current app aside."
  rm -rf "$staged"
  exit 1
fi
if ! mv "$staged" "$target"; then
  echo "Could not put the new app in place; restoring the previous app."
  mv "$old" "$target"
  exit 1
fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
"$open_command" "$target"
sleep "\${CANVAS_UPDATE_SLEEP:-5}"
rm -rf "$old"
rm -f "$0"
rm -rf "$(dirname "$0")"
`;

function defaultSpawnDetached(command, args) {
  const { spawn } = require('node:child_process');
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function waitForFile(file, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (fs.existsSync(file)) return resolve();
      if (Date.now() - started >= timeout) return reject(new UpdateError('The update helper did not start. Canvas Pro was not changed.', 'helper-failed'));
      setTimeout(check, 50);
    };
    check();
  });
}

function applicationsPath(bundle) {
  const resolved = path.resolve(bundle);
  const home = path.join(os.homedir(), 'Applications');
  return path.dirname(resolved) === '/Applications' || path.dirname(resolved) === home;
}

class Updater {
  constructor({
    currentVersion,
    appBundle,
    isPackaged = true,
    platform = process.platform,
    fetchImpl = globalThis.fetch,
    tempRoot = os.tmpdir(),
    onProgress = () => {},
    runCommand = execFileAsync,
    spawnDetached = defaultSpawnDetached,
    quit = () => {},
    openCommand = '/usr/bin/open',
    allowAnyLocation = false,
    now = Date.now
  }) {
    this.currentVersion = String(currentVersion || '0.0.0');
    this.appBundle = appBundle ? path.resolve(appBundle) : '';
    this.isPackaged = isPackaged;
    this.platform = platform;
    this.fetchImpl = fetchImpl;
    this.tempRoot = tempRoot;
    this.onProgress = onProgress;
    this.runCommand = runCommand;
    this.spawnDetached = spawnDetached;
    this.quit = quit;
    this.openCommand = openCommand;
    this.allowAnyLocation = allowAnyLocation;
    this.now = now;
    this.release = null;
    this.downloaded = null;
    this.workDirectory = null;
    this.controller = null;
    this.lastProgressAt = 0;
  }

  progress(value) {
    try { this.onProgress(value); } catch {}
  }

  installBlocker() {
    if (this.platform !== 'darwin') return 'Automatic updates are available on macOS only.';
    if (!this.isPackaged) return 'Automatic updates need the installed Canvas Pro app. This development copy cannot replace itself.';
    if (!this.appBundle || !this.appBundle.endsWith('.app')) return 'Canvas Pro could not locate its application bundle.';
    if (this.appBundle.startsWith('/Volumes/') || this.appBundle.includes('/AppTranslocation/')) {
      return 'Canvas Pro is running from a read-only disk image or a temporary location. Move Canvas Pro to Applications, then open it again.';
    }
    if (!this.allowAnyLocation && !applicationsPath(this.appBundle)) {
      return 'Automatic updates only work when Canvas Pro is installed in Applications. Move Canvas Pro to Applications, then open it again.';
    }
    if (!fs.existsSync(this.appBundle)) return 'The Canvas Pro application bundle could not be found.';
    try {
      fs.accessSync(path.dirname(this.appBundle), fs.constants.W_OK);
    } catch {
      return 'Canvas Pro cannot replace the app in ' + path.dirname(this.appBundle) + '. Move Canvas Pro to Applications, or grant write access to that folder.';
    }
    return null;
  }

  async check() {
    this.progress({ phase: 'check', message: 'Checking GitHub for the latest release…' });
    let response;
    try {
      response = await this.fetchImpl(RELEASE_API, {
        headers: JSON_HEADERS,
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new UpdateError('GitHub could not be reached. Check your internet connection and try again.', 'network');
    }
    if (response.status === 404) {
      return {
        available: false,
        currentVersion: this.currentVersion,
        version: null,
        installable: false,
        reason: 'No public release is available yet.'
      };
    }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new UpdateError('GitHub is limiting update checks right now. Try again in a little while.', 'rate-limit');
      }
      throw new UpdateError('GitHub could not be reached (HTTP ' + response.status + '). Try again later.', 'network');
    }
    let release;
    try { release = await response.json(); } catch {
      throw new UpdateError('GitHub returned an unreadable update response.', 'bad-response');
    }
    const version = String(release?.tag_name || release?.name || '').trim().replace(/^v/i, '');
    if (!/^\d+(?:\.\d+)*$/.test(version)) throw new UpdateError('The latest GitHub release has no usable version number.', 'bad-release');
    const assets = releaseAssets(release);
    const available = compareVersions(version, this.currentVersion) > 0;
    const blocker = available ? this.installBlocker() : null;
    let reason = blocker;
    if (available && !assets.dmg) reason = 'The latest release does not include an Apple Silicon disk image.';
    if (available && !assets.sums) reason = 'The latest release does not include a SHA-256 checksum, so it cannot be installed automatically.';
    this.release = available && !reason ? {
      version,
      notes: String(release.body || '').slice(0, 8000),
      page: String(release.html_url || ''),
      publishedAt: String(release.published_at || ''),
      dmg: { name: assets.dmg.name, url: assets.dmg.browser_download_url, size: Number(assets.dmg.size) || 0 },
      sums: { name: assets.sums.name, url: assets.sums.browser_download_url }
    } : null;
    return {
      available,
      currentVersion: this.currentVersion,
      version,
      notes: String(release.body || '').slice(0, 8000),
      page: String(release.html_url || ''),
      publishedAt: String(release.published_at || ''),
      size: Number(assets.dmg?.size) || 0,
      installable: available && !reason,
      reason: reason || null
    };
  }

  cancel() {
    this.controller?.abort();
    this.controller = null;
  }

  async fetchFile(url, destination, { name, totalHint = 0, quiet = false } = {}) {
    let response;
    try {
      response = await this.fetchImpl(url, { headers: DOWNLOAD_HEADERS, signal: this.controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new UpdateError('The update was cancelled.', 'cancelled');
      throw new UpdateError('The update download could not start. Check your internet connection and try again.', 'network');
    }
    if (!response.ok || !response.body) throw new UpdateError('GitHub could not deliver the update (HTTP ' + response.status + ').', 'download');
    const total = Number(response.headers.get('content-length')) || totalHint || 0;
    const output = fs.createWriteStream(destination);
    const reader = response.body.getReader();
    let received = 0;
    this.lastProgressAt = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (!output.write(Buffer.from(value))) {
          await new Promise((resolve, reject) => {
            output.once('drain', resolve);
            output.once('error', reject);
          });
        }
        const timestamp = this.now();
        if (!quiet && timestamp - this.lastProgressAt >= 100) {
          this.lastProgressAt = timestamp;
          this.progress({
            phase: 'download',
            name,
            received,
            total,
            percent: total ? Math.min(100, Math.floor((received / total) * 100)) : null
          });
        }
      }
      await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    } catch (error) {
      output.destroy();
      if (error?.name === 'AbortError') throw new UpdateError('The update was cancelled.', 'cancelled');
      throw new UpdateError('The update download stopped before it finished. Try again.', 'download');
    }
    if (total && received !== total) throw new UpdateError('The update download was incomplete. Try again.', 'download');
    if (totalHint && received !== totalHint) throw new UpdateError('The downloaded update does not match the size GitHub published. Try again.', 'download');
    if (!quiet) this.progress({ phase: 'download', name, received, total: total || received, percent: 100 });
    return received;
  }

  async download() {
    if (!this.release) throw new UpdateError('There is no update ready to download. Check for updates first.', 'no-release');
    const blocker = this.installBlocker();
    if (blocker) throw new UpdateError(blocker, 'not-installable');
    if (this.downloaded?.version === this.release.version) return this.downloaded;
    if (this.downloaded) {
      await fs.promises.rm(this.downloaded.directory, { recursive: true, force: true }).catch(() => {});
      this.downloaded = null;
    }
    this.cancel();
    this.controller = new AbortController();
    this.progress({ phase: 'download', name: this.release.dmg.name, received: 0, total: this.release.dmg.size, percent: 0 });
    let directory;
    try {
      directory = await fs.promises.mkdtemp(path.join(this.tempRoot, 'canvas-pro-update-'));
      this.workDirectory = directory;
      const sumsPath = path.join(directory, this.release.sums.name);
      const dmgPath = path.join(directory, this.release.dmg.name);
      await this.fetchFile(this.release.sums.url, sumsPath, { name: this.release.sums.name, quiet: true });
      const sums = parseChecksums(await fs.promises.readFile(sumsPath, 'utf8'));
      const expected = sums.get(path.basename(this.release.dmg.name));
      if (!expected) throw new UpdateError('The release checksum does not list the downloaded disk image, so the update was not installed.', 'checksum-missing');
      await this.fetchFile(this.release.dmg.url, dmgPath, { name: this.release.dmg.name, totalHint: this.release.dmg.size });
      this.progress({ phase: 'verify', message: 'Verifying the download…' });
      const actual = await fileSha256(dmgPath);
      if (actual !== expected) throw new UpdateError('The downloaded update did not match its SHA-256 checksum. It was discarded and nothing was installed.', 'checksum');
      this.downloaded = { version: this.release.version, dmgPath, sumsPath, directory };
      this.controller = null;
      return { version: this.release.version, size: (await fs.promises.stat(dmgPath)).size };
    } catch (error) {
      this.controller = null;
      if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
      this.workDirectory = null;
      throw error instanceof UpdateError ? error : new UpdateError(error.message || 'The update could not be downloaded.', 'download');
    }
  }

  async plistValue(file, key) {
    try {
      const { stdout } = await this.runCommand('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, file], { timeout: 15000, maxBuffer: 1024 * 1024 });
      return String(stdout || '').trim();
    } catch {
      return '';
    }
  }

  async install() {
    const blocker = this.installBlocker();
    if (blocker) throw new UpdateError(blocker, 'not-installable');
    if (!this.downloaded) throw new UpdateError('Download the update before installing it.', 'no-download');
    this.progress({ phase: 'mount', message: 'Preparing the update…' });
    let mount = null;
    let staged = null;
    let old = null;
    let helper = null;
    try {
      const attached = await this.runCommand('/usr/bin/hdiutil', ['attach', '-nobrowse', '-noautoopen', '-readonly', '-plist', this.downloaded.dmgPath], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      mount = mountPointFromPlist(attached.stdout);
      if (!mount || !fs.existsSync(mount)) throw new UpdateError('The downloaded disk image could not be opened.', 'mount');
      const candidates = fs.readdirSync(mount, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
        .map(entry => path.join(mount, entry.name));
      const mountedApp = candidates.find(candidate => path.basename(candidate) === 'Canvas Pro.app') || candidates[0];
      if (!mountedApp) throw new UpdateError('The downloaded disk image does not contain Canvas Pro.', 'bad-bundle');
      const mountedPlist = path.join(mountedApp, 'Contents/Info.plist');
      if (!fs.existsSync(mountedPlist)) throw new UpdateError('The downloaded app is incomplete.', 'bad-bundle');
      const mountedVersion = await this.plistValue(mountedPlist, 'CFBundleShortVersionString');
      if (compareVersions(mountedVersion, this.release.version) !== 0) {
        throw new UpdateError('The downloaded app is version ' + (mountedVersion || 'unknown') + ', not ' + this.release.version + '. Nothing was installed.', 'bad-version');
      }
      const currentPlist = path.join(this.appBundle, 'Contents/Info.plist');
      const currentIdentifier = await this.plistValue(currentPlist, 'CFBundleIdentifier');
      const mountedIdentifier = await this.plistValue(mountedPlist, 'CFBundleIdentifier');
      if (currentIdentifier && mountedIdentifier && currentIdentifier !== mountedIdentifier) {
        throw new UpdateError('The downloaded app is not Canvas Pro. Nothing was installed.', 'bad-bundle');
      }
      try {
        await this.runCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', mountedApp], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      } catch {
        throw new UpdateError('The downloaded app failed its security check. Nothing was installed.', 'signature');
      }
      const parent = path.dirname(this.appBundle);
      staged = path.join(parent, '.Canvas Pro Update-' + process.pid + '-' + this.now() + '.app');
      old = this.appBundle + '.previous-update';
      await fs.promises.rm(staged, { recursive: true, force: true }).catch(() => {});
      await fs.promises.rm(old, { recursive: true, force: true }).catch(() => {});
      this.progress({ phase: 'install', message: 'Installing Canvas Pro ' + this.release.version + '…' });
      await this.runCommand('/usr/bin/ditto', [mountedApp, staged], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
      await this.runCommand('/usr/bin/hdiutil', ['detach', mount, '-force'], { timeout: 60000, maxBuffer: 1024 * 1024 }).catch(() => {});
      mount = null;
      const log = path.join(this.downloaded.directory, 'install.log');
      const script = path.join(this.downloaded.directory, 'install.sh');
      await fs.promises.writeFile(script, SWAP_SCRIPT, { mode: 0o700 });
      helper = this.spawnDetached('/bin/bash', [script, String(process.pid), this.appBundle, staged, old, log, this.openCommand]);
      await waitForFile(log + '.started');
      await fs.promises.rm(this.downloaded.dmgPath, { force: true }).catch(() => {});
      await fs.promises.rm(this.downloaded.sumsPath, { force: true }).catch(() => {});
      setTimeout(() => this.quit(), 250).unref?.();
      return { installing: true, version: this.release.version, bundle: this.appBundle };
    } catch (error) {
      helper?.kill?.();
      if (mount) await this.runCommand('/usr/bin/hdiutil', ['detach', mount, '-force'], { timeout: 60000, maxBuffer: 1024 * 1024 }).catch(() => {});
      if (staged) await fs.promises.rm(staged, { recursive: true, force: true }).catch(() => {});
      if (this.downloaded) {
        await fs.promises.rm(this.downloaded.directory, { recursive: true, force: true }).catch(() => {});
        this.downloaded = null;
        this.workDirectory = null;
      }
      throw error instanceof UpdateError ? error : new UpdateError(error.message || 'The update could not be installed.', 'install');
    }
  }
}

module.exports = {
  Updater,
  UpdateError,
  compareVersions,
  parseChecksums,
  releaseAssets,
  mountPointFromPlist,
  shellQuote,
  SWAP_SCRIPT,
  RELEASE_API
};
