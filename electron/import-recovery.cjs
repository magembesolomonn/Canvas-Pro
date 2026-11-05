const fs = require('node:fs');
const path = require('node:path');
const { managedPath } = require('./deletion.cjs');
const uuid = /^[a-f0-9-]{36}$/;

function recordImport(library, id, stored) {
  const directory = path.join(library.root, '.import-staging');
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Import staging cannot be a symbolic link.');
  const journal = path.join(directory, id + '.json');
  fs.writeFileSync(journal, JSON.stringify({ id, stored, pid: process.pid }), { flag: 'wx' });
  return journal;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function recoverImports(library) {
  const directory = path.join(library.root, '.import-staging');
  if (!fs.existsSync(directory)) return;
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Import staging cannot be a symbolic link.');
  for (const name of fs.readdirSync(directory)) {
    const id = name.slice(0, -5);
    if (!name.endsWith('.json') || !uuid.test(id)) continue;
    const journal = path.join(directory, name);
    if (fs.lstatSync(journal).isSymbolicLink()) continue;
    let entry;
    try { entry = JSON.parse(fs.readFileSync(journal, 'utf8')); }
    catch { continue; } // An incomplete journal precedes the file copy; never guess a deletion path.
    if (!entry || typeof entry !== 'object' || entry.id !== id || typeof entry.stored !== 'string' || !Number.isInteger(entry.pid) || entry.pid <= 0) continue;
    const base = path.basename(entry.stored);
    if (entry.stored !== path.join('originals', base) || !(base === id || base.startsWith(id + '.'))) continue;
    if (processAlive(entry.pid)) continue; // Other live connections may still be importing.
    const retained = library.db.prepare('SELECT id FROM assets WHERE stored=?').get(entry.stored);
    if (!retained) fs.rmSync(managedPath(library, entry.stored), { force: true });
    fs.rmSync(journal, { force: true });
  }
}

module.exports = { recordImport, recoverImports };
