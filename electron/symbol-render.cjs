const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const SYMBOL = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/;
const KEY = /^[A-Za-z]+$/;
const WEIGHTS = new Set(['ultralight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black']);

// Renders SF Symbols through AppKit on demand and keeps the results in a disk
// cache. The cache key includes the OS version, so a system update naturally
// invalidates old artwork. If the native helper is missing (for example a
// source checkout that has not run `npm run build:native`), the handler falls
// back to the checked-in PNG masks.
class SymbolRenderer {
  constructor({ root, cacheDir, helper, version = process.getSystemVersion?.() || '' }) {
    this.root = root;
    this.cacheDir = cacheDir;
    this.helper = helper;
    this.version = version;
    this.memory = new Map();
    this.pending = new Map();
    this.active = 0;
    this.queue = [];
  }

  async render(params) {
    const name = String(params.get('name') || '');
    const key = String(params.get('key') || 'file').replace(/[^A-Za-z]/g, '');
    const weight = WEIGHTS.has(params.get('weight')) ? params.get('weight') : 'regular';
    const size = Math.max(8, Math.min(96, Math.round(Number(params.get('size')) || 20)));
    const scale = Math.max(1, Math.min(3, Math.round(Number(params.get('scale')) || 2)));
    if (!SYMBOL.test(name)) return { error: 'Invalid symbol name', status: 400 };
    if (!KEY.test(key)) return { error: 'Invalid key', status: 400 };

    const id = crypto.createHash('sha256').update(`${this.version}|${name}|${size}|${weight}|${scale}`).digest('hex');
    const cached = this.memory.get(id);
    if (cached) return { buffer: cached };
    if (this.pending.has(id)) return { buffer: await this.pending.get(id) };

    const work = this.#load(id, name, size, weight, scale, key).finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    return { buffer: await work };
  }

  async #load(id, name, size, weight, scale, key) {
    const file = path.join(this.cacheDir, id + '.png');
    const disk = await fs.promises.readFile(file).catch(() => null);
    if (disk) {
      this.memory.set(id, disk);
      return disk;
    }
    await fs.promises.mkdir(this.cacheDir, { recursive: true }).catch(() => {});
    let buffer = await this.#renderHelper(id, name, size, weight, scale);
    if (buffer) await fs.promises.writeFile(file, buffer).catch(() => {});
    else buffer = await this.#fallback(key);
    if (!buffer) throw new Error(`Symbol unavailable: ${name}`);
    this.memory.set(id, buffer);
    return buffer;
  }

  async #renderHelper(id, name, size, weight, scale) {
    if (!fs.existsSync(this.helper)) return null;
    return this.#enqueue(async () => {
      const target = path.join(this.cacheDir, `${id}.${process.pid}.png`);
      try {
        await run(this.helper, ['--render', name, String(size), weight, String(scale), target], {
          timeout: 5000,
          maxBuffer: 1024 * 1024
        });
        return await fs.promises.readFile(target);
      } catch {
        return null;
      } finally {
        fs.promises.unlink(target).catch(() => {});
      }
    });
  }

  #enqueue(work) {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active += 1;
        work().then(resolve, reject).finally(() => {
          this.active -= 1;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.active < 4) start();
      else this.queue.push(start);
    });
  }

  async #fallback(key) {
    const file = path.join(this.root, 'src', 'assets', 'symbols', key + '.png');
    return fs.promises.readFile(file).catch(() => null);
  }
}

module.exports = { SymbolRenderer };
