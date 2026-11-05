const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
esbuild.buildSync({
  entryPoints: [path.join(root, 'scripts/rss-engine.cjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  minify: true,
  outfile: path.join(root, 'electron/rss-engine.cjs')
});
