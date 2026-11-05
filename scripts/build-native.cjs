const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') throw new Error('Build the native helpers on macOS.');

const root = path.resolve(__dirname, '..');
const moduleCache = '/private/tmp/asset-swift-module-cache';
const tools = {
  media: ['native/Media.swift', 'bin/media-tool'],
  analysis: ['native/Analyze.swift', 'bin/analysis-tool']
};
const requested = process.argv.slice(2);
const selected = requested.length ? requested : Object.keys(tools);

for (const name of selected) {
  const tool = tools[name];
  if (!tool) throw new Error(`Unknown native helper: ${name}`);
  const [source, output] = tool;
  fs.mkdirSync(path.dirname(path.join(root, output)), { recursive: true });
  fs.mkdirSync(moduleCache, { recursive: true });
  execFileSync('swiftc', [
    '-target', 'arm64-apple-macosx13.0',
    '-O',
    '-parse-as-library',
    path.join(root, source),
    '-o', path.join(root, output),
    '-module-cache-path', moduleCache
  ], { stdio: 'inherit' });
}

console.log(`Built native helper${selected.length === 1 ? '' : 's'}: ${selected.join(', ')}`);
