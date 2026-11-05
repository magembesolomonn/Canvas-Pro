const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') throw new Error('Build this app on macOS.');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'node_modules/electron/dist/Electron.app');
if (!fs.existsSync(runtime)) throw new Error('Run npm install and node node_modules/electron/install.js first.');
const output = path.join(root, 'dist/Canvas Pro.app');
if (fs.existsSync(output)) throw new Error('The app already exists in dist. Move it aside before rebuilding.');
fs.mkdirSync(path.dirname(output), { recursive: true });
execFileSync('/usr/bin/ditto', [runtime, output]);
const resources = path.join(output, 'Contents/Resources');
fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
fs.copyFileSync(path.join(root,'assets/AssetLibrary.icns'),path.join(resources,'AssetLibrary.icns'));
const appDir = path.join(resources, 'app');
fs.mkdirSync(appDir);
for (const entry of ['electron', 'src', 'bin', 'chrome-extension']) fs.cpSync(path.join(root, entry), path.join(appDir, entry), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete pkg.devDependencies; delete pkg.scripts;
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg, null, 2));
const plist = path.join(output, 'Contents/Info.plist');
for (const [key, value] of Object.entries({CFBundleIconFile:'AssetLibrary.icns',CFBundleName:'Canvas Pro',CFBundleDisplayName:'Canvas Pro',CFBundleIdentifier:'local.assetlibrary.desktop',CFBundleShortVersionString:pkg.version,CFBundleVersion:'1'})) {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
}
for (const helper of ['media-tool','analysis-tool','rss-extractor']) execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path.join(appDir, 'bin',helper)]);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', output], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', output], { stdio: 'inherit' });
console.log('Created ' + output);
