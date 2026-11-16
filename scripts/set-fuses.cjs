const fs = require('node:fs');
const path = require('node:path');
const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');

if (process.platform !== 'darwin') throw new Error('This script targets the macOS Electron binary.');
const root = path.resolve(__dirname, '..');
const binary = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
if (!fs.existsSync(binary)) throw new Error('Run npm install and node node_modules/electron/install.js first.');

// RunAsNode stays enabled because the native messaging host launches this
// binary with ELECTRON_RUN_AS_NODE=1. Everything else that can be disabled
// without breaking the unpacked app or the web preview is disabled here.
flipFuses(binary, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: false
});
console.log('Electron fuses configured (RunAsNode kept for native messaging).');
