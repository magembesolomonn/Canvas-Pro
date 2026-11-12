const fs = require('node:fs');
const path = require('node:path');

const ASSET_ID = /^[a-f0-9-]{36}$/;

// The library's managed originals can be changed from Finder: someone may
// delete one, or put it back from the macOS Trash. This watcher keeps the
// records honest without ever touching the files themselves. A missing file
// moves its item to Trash; a file that returns restores it.
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
    try { onChange([...new Set(ids)]); } catch { /* A closed window must not stop the watcher. */ }
  }

  function apply(id) {
    if (closed || library.deleting.has(id)) return false;
    let asset;
    try { asset = library.asset(id); } catch { return false; }
    const exists = fs.existsSync(originalPath(asset.stored));
    return exists ? library.markPresent(id) : library.markMissing(id);
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

  // A full pass is used at startup, after sleep and when the window returns
  // to the front. It is cheap: one stat per asset and no hashing.
  async function scan() {
    if (closed) return [];
    let rows;
    try { rows = library.db.prepare('SELECT id,stored FROM assets').all(); }
    catch { return []; }
    const changed = [];
    for (const row of rows) {
      if (closed) break;
      if (library.deleting.has(row.id)) continue;
      const exists = fs.existsSync(originalPath(row.stored));
      if (exists ? library.markPresent(row.id) : library.markMissing(row.id)) changed.push(row.id);
    }
    report(changed);
    return changed;
  }

  try {
    // The originals live directly inside this folder, so one non-recursive
    // watcher sees every add, delete and restore.
    watcher = fs.watch(directory, { persistent: false }, (event, filename) => {
      if (!filename) return;
      const id = String(filename).split('.')[0];
      if (ASSET_ID.test(id)) schedule(id);
    });
    watcher.on('error', () => { /* A later scan still catches any change. */ });
  } catch { /* Watching is an optimisation; scanning is the safety net. */ }

  return {
    scan,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try { watcher?.close(); } catch { /* Already closed. */ }
      watcher = null;
    },
    get watching() { return !!watcher; },
  };
}

module.exports = { createOriginalsWatch };
