const { spawn } = require('node:child_process');
const path = require('node:path');

const EXECUTABLE = path.resolve(__dirname, '../bin/rss-extractor');
const MAX_OUTPUT = 2 * 1024 * 1024;
const TIMEOUT = 30000;

function extract(html, url) {
  return new Promise((resolve, reject) => {
    const process = spawn(EXECUTABLE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let outputSize = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      process.kill();
      finish(new Error('Trafilatura extraction timed out.'));
    }, TIMEOUT);
    timer.unref();
    process.on('error', error => finish(error));
    process.stdout.on('data', chunk => {
      outputSize += chunk.length;
      if (outputSize > MAX_OUTPUT) {
        process.kill();
        finish(new Error('Trafilatura returned too much article content.'));
        return;
      }
      stdout.push(chunk);
    });
    process.stderr.on('data', chunk => stderr.push(chunk));
    process.on('close', code => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(Buffer.concat(stderr).toString('utf8').trim().slice(0, 500) ||
          `Trafilatura exited with status ${code}.`));
        return;
      }
      try { finish(null, JSON.parse(Buffer.concat(stdout).toString('utf8'))); }
      catch (error) { finish(new Error('Trafilatura returned invalid output: ' + error.message)); }
    });
    process.stdin.on('error', error => finish(error));
    process.stdin.end(JSON.stringify({ html, url }));
  });
}

module.exports = { extract };
