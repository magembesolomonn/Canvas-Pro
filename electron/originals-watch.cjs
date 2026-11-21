const fs = require('node:fs');
const path = require('node:path');

const ASSET_ID = /^[a-f0-9-]{36}$/;

function createOriginalsWatch({ library, onChange = () => {}, debounce = 90 }) {
  const directory = path.join(library.root, 'originals');
  const pending = new Set();
  let watcher = null;
  let timer = null;
  let closed = false;

  function originalPath(stored) {
    return path.join(library.root, stored);
  }

  function report(ids) {
    if (closed || !ids.length) return;
    try { onChange([...new Set(ids)]); } catch {  }
  }

  function apply(id) {
    if (closed || library.deleting.has(id)) return false;
    let row;
    try { row = library.db.prepare('SELECT stored,trash,missing FROM assets WHERE id=?').get(id); } catch { return false; }
    if (!row) return false;
    const exists = fs.existsSync(originalPath(row.stored));
    if (exists) return row.missing ? library.markPresent(id) : false;
    return !row.trash && !row.missing ? library.markMissing(id) : false;
  }

  function flush() {
    timer = null;
    const ids = [...pending];
    pending.clear();
    report(ids.filter(apply));
  }

  function schedule(id) {
    if (closed) return;
    pending.add(id);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounce);
  }

  async function scan() {
    if (closed) return [];
    let rows;
    try { rows = library.db.prepare('SELECT id,stored,missing FROM assets WHERE trash=0 OR missing=1').all(); }
    catch { return []; }
    const changed = [];
    const batchSize = 250;
    for (let i = 0; i < rows.length; i += batchSize) {
      if (closed) break;
      const batch = rows.slice(i, i + batchSize);
      const present = [], missing = [];
      await Promise.all(batch.map(async row => {
        if (closed || library.deleting.has(row.id)) return;
        let exists = false;
        try { await fs.promises.access(originalPath(row.stored), fs.constants.F_OK); exists = true; }
        catch { exists = false; }
        if (exists) { if (row.missing) present.push(row.id); }
        else if (!row.missing) missing.push(row.id);
      }));
      if (present.length || missing.length) changed.push(...library.applyPresence(present, missing));
      if (i + batchSize < rows.length) await new Promise(resolve => setImmediate(resolve));
    }
    report(changed);
    return changed;
  }

  try {
    watcher = fs.watch(directory, { persistent: false }, (event, filename) => {
      if (!filename) return;
      const id = String(filename).split('.')[0];
      if (ASSET_ID.test(id)) schedule(id);
    });
    watcher.on('error', () => {  });
  } catch {  }

  return {
    scan,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try { watcher?.close(); } catch {  }
      watcher = null;
    },
    get watching() { return !!watcher; },
  };
}

module.exports = { createOriginalsWatch };
