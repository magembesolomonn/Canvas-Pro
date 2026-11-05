const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') throw new Error('Package this release on macOS.');
const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const manifest = require(path.join(root, 'chrome-extension/manifest.json'));
const bundle = path.join(root, 'dist/Canvas Pro.app');
const appSource = path.join(bundle, 'Contents/Resources/app');
if (JSON.parse(fs.readFileSync(path.join(appSource, 'package.json'))).version !== pkg.version) throw new Error('Update the dist app before packaging.');
function verifyTree(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) verifyTree(from, to);
    else if (entry.isFile() && (!fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to)))) throw new Error('The dist app is stale: ' + from);
  }
}
for (const name of ['src', 'electron', 'chrome-extension']) verifyTree(path.join(root, name), path.join(appSource, name));
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
for (const file of [path.join(bundle, 'Contents/MacOS/Electron'), path.join(appSource, 'bin/media-tool'), path.join(appSource, 'bin/analysis-tool')]) {
  if (execFileSync('/usr/bin/lipo', ['-archs', file], { encoding: 'utf8' }).trim() !== 'arm64') throw new Error('Expected an Apple Silicon binary: ' + file);
}
const helperBuild=execFileSync('/usr/bin/otool',['-l',path.join(appSource,'bin/media-tool')],{encoding:'utf8'});const helperMinimum=helperBuild.match(/\bminos\s+(\d+(?:\.\d+)*)/)?.[1];if(!helperMinimum||Number(helperMinimum.split('.')[0])>13)throw new Error('Rebuild media-tool for macOS 13 before packaging.');
const release = path.join(root, 'dist/releases', pkg.version);
const dmg = path.join(release, 'Canvas-Pro-' + pkg.version + '-apple-silicon.dmg');
const zip = path.join(release, 'Canvas-Pro-Capture-' + manifest.version + '.zip');
if ([dmg, zip].some(file => fs.existsSync(file))) throw new Error('Release files already exist; move them aside before rebuilding.');
fs.mkdirSync(release, { recursive: true });
const instructions = `CANVAS PRO ${pkg.version} — APPLE SILICON TEST BUILD

App: ${pkg.version}. Extension: ${manifest.version}.
Requires an Apple Silicon Mac (M1 or newer), macOS 13 or later.
This build is ad-hoc signed and is not notarized by Apple.

INSTALL THE APP
1. Quit any running Canvas Pro instance.
2. Open the DMG and drag Canvas Pro.app onto Applications.
3. Eject the disk image. Open Canvas Pro from Applications.
4. If macOS blocks this known test build, use System Settings → Privacy & Security → Open Anyway after attempting to open it. Approve only the build you intended to test.
Apple's instructions: https://support.apple.com/en-gb/102445

LIBRARIES
A fresh account offers Create library or Open existing. For a disposable test, create a new library in Documents. Existing users keep their current library automatically.
To select another library: File → New Library / Open Library, or Settings.
To back up: quit Canvas Pro completely, copy the WHOLE library folder (including library.sqlite, originals, thumbnails and other contents) to an external drive. After reinstalling, copy it back and choose Open existing library. Do not import the library's internal files individually. Installing/replacing the app does not replace your library.

INSTALL THE EXTENSION
1. Install and open Canvas Pro from Applications. It automatically registers the browser connection for your macOS account.
2. In Helium or Chrome, open chrome://extensions and enable Developer mode.
3. Click Load unpacked. Select the extracted Canvas Pro Capture folder containing manifest.json. For future app updates, you can instead load the app-managed copy:
   ~/Library/Application Support/Canvas Pro/Browser Extension
4. Open the extension popup and check that it says Connected.
If you already loaded Canvas Pro Capture from the app-managed folder, click Reload on its card.

QUICK TEST
- Import images, a video, audio and a PDF into your disposable library.
- Select files, preview with Space, navigate with arrows, and test hover playback/Loop.
- Create a canvas, drag multiple items onto it, add text, resize and reopen it.
- Capture a webpage image, screenshot and bookmark through the extension.
- Quit/reopen, then copy the closed disposable library and open the copy; verify files, tags, collections and canvas layouts.

UPDATES
Download a future app release, quit Canvas Pro and replace the app in Applications. Keep your library folder. For an extension update, reload the app-managed extension on chrome://extensions, or replace the files in the folder you loaded from the ZIP and then click Reload.
`;
fs.writeFileSync(path.join(release, 'START HERE.txt'), instructions);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-dmg-stage-'));
try {
  execFileSync('/usr/bin/ditto', [bundle, path.join(stage, 'Canvas Pro.app')]);
  fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
  fs.writeFileSync(path.join(stage, 'START HERE.txt'), instructions);
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'Canvas Pro ' + pkg.version, '-srcfolder', stage, '-format', 'UDZO', '-fs', 'HFS+', dmg], { stdio: 'inherit' });
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
execFileSync('/usr/bin/zip', ['-q', '-X', '-r', zip, '.', '-x', '*/.DS_Store', '.DS_Store'], { cwd: path.join(root, 'chrome-extension') });
const sums = [dmg, zip].map(file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + path.basename(file));
fs.writeFileSync(path.join(release, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
fs.copyFileSync(zip, path.join(root, 'Canvas Pro Capture.zip'));
console.log('Release ready: ' + release);
