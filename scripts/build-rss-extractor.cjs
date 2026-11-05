const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(__dirname, 'rss-extractor.py');
const requirements = path.join(root, 'requirements-rss.txt');
const output = path.join(root, 'bin/rss-extractor');
const environment = path.join(root, 'node_modules/.cache/rss-extractor');
const venv = path.join(environment, 'venv');
const python = process.env.PYTHON || 'python3';

if (process.platform !== 'darwin') throw new Error('Build the RSS extractor on macOS.');
if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= Math.max(
  fs.statSync(source).mtimeMs, fs.statSync(requirements).mtimeMs
)) {
  console.log('RSS article extractor is up to date.');
  process.exit(0);
}

fs.mkdirSync(environment, { recursive: true });
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}.`);
}

if (!fs.existsSync(path.join(venv, 'bin/python'))) {
  run(python, ['-m', 'venv', venv]);
}
const venvPython = path.join(venv, 'bin/python');
run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements]);
const pyinstaller = path.join(venv, 'bin/pyinstaller');
const buildDirectory = path.join(environment, 'build');
const distDirectory = path.join(environment, 'dist');
fs.rmSync(buildDirectory, { recursive: true, force: true });
fs.rmSync(distDirectory, { recursive: true, force: true });
run(pyinstaller, [
  '--clean', '--noconfirm', '--onefile', '--name', 'rss-extractor',
  '--distpath', distDirectory, '--workpath', buildDirectory,
  '--specpath', environment, '--collect-all', 'trafilatura', source
]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.copyFileSync(path.join(distDirectory, 'rss-extractor'), output);
fs.chmodSync(output, 0o755);
console.log('Built ' + output);
