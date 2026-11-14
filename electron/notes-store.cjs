const { randomUUID } = require('node:crypto');
const {tracker,cleanTracker,ensureTrackerRecords} = require('./note-trackers.cjs');

const templates = {
  movies: ['Movies & Series', [['tracker','movies']]],
  blank: ['Untitled note', [['paragraph', '']]],
  finance: ['Finance tracker', [
    ['tracker','transactions'], ['tracker','budgets'],
    ['toggle', 'Financial records', 'Link receipts and statements from your library.']
  ]],
  product: ['Product workspace', [
    ['heading','Product spec'], ['paragraph','Describe the problem, audience, goals and success measures.'],
    ['tracker','roadmap'], ['heading','Requirements'], ['checklist','Define acceptance criteria'],
    ['toggle','Open questions','']
  ]],
  youtube: ['YouTube workspace', [
    ['tracker','videos'], ['heading','Publishing checklist'], ['checklist','Review final cut'],
    ['checklist','Prepare title and thumbnail'], ['checklist','Add description and captions'], ['checklist','Schedule publication']
  ]]
};
const text = (value, limit) => {
  if (typeof value !== 'string' || value.length > limit) throw Error('A note field exceeds its allowed size.');
  return value;
};
function encodeBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length > 250) throw Error('A note supports up to 250 blocks.');
  const clean = blocks.map(block => {
    const { type } = block;
    if (type === 'tracker') return cleanTracker(block);
    if (type === 'reference') {
      if (!['note','file','canvas'].includes(block.kind) || !/^[a-f0-9-]{36}$/.test(block.id)) throw Error('Invalid link.');
      return {type,kind:block.kind,id:block.id,label:text(block.label,300)};
    }
    if (type === 'image') {
      if (!/^[a-f0-9-]{36}$/.test(block.assetId)) throw Error('Invalid library image.');
      return { type, assetId: block.assetId, name: text(block.name, 500) };
    }
    if (type === 'table') {
      const { rows } = block;
      const width = rows?.[0]?.length;
      if (!Array.isArray(rows) || rows.length > 100 || !(width >= 1 && width <= 8)) throw Error('Invalid table size.');
      return { type, rows: rows.map(row => {
        if (!Array.isArray(row) || row.length !== width) throw Error('Invalid table row.');
        return row.map(cell => text(cell, 1000));
      }) };
    }
    if (!['paragraph', 'heading', 'bullet', 'checklist', 'toggle'].includes(type)) throw Error('Unknown note block.');
    const result = { type, text: text(block.text, 20000) };
    if (type === 'toggle') Object.assign(result, { body: text(block.body, 20000), open: block.open === true });
    if (type === 'heading') {
      // The level is what the heading is; the size and colour are overrides.
      if (Number.isInteger(block.headingLevel) && block.headingLevel >= 1 && block.headingLevel <= 6) result.headingLevel = block.headingLevel;
      if (Number.isInteger(block.fontSize) && block.fontSize >= 12 && block.fontSize <= 72) result.fontSize = block.fontSize;
      if (typeof block.color === 'string' && /^#[a-f0-9]{6}$/i.test(block.color)) result.color = block.color;
    }
    if (type === 'checklist') result.checked = block.checked === true;
    return result;
  });
  const encoded = JSON.stringify(clean);
  if (Buffer.byteLength(encoded) > 1024 * 1024) throw Error('This note exceeds the 1 MB text limit.');
  return encoded;
}

class NotesStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, blocks TEXT NOT NULL,
      position INTEGER NOT NULL, updated TEXT NOT NULL, cover BLOB, thumbnail BLOB
    )`);
    if (!db.prepare("SELECT 1 FROM pragma_table_info('workspace_notes') WHERE name='parent_id'").get()) {
      db.exec('ALTER TABLE workspace_notes ADD COLUMN parent_id TEXT REFERENCES workspace_notes(id) ON DELETE SET NULL');
    }
    if (!db.prepare("SELECT 1 FROM pragma_table_info('workspace_notes') WHERE name='emoji'").get()) {
      db.exec("ALTER TABLE workspace_notes ADD COLUMN emoji TEXT NOT NULL DEFAULT ''");
    }
    ensureTrackerRecords(db);
  }
  list() {
    return this.db.prepare('SELECT id, title, parent_id AS parentId, emoji, cover IS NOT NULL AS hasCover, updated FROM workspace_notes ORDER BY position, id').all();
  }
  get(id) {
    const note = this.db.prepare('SELECT id, title, parent_id AS parentId, emoji, blocks, cover IS NOT NULL AS hasCover, updated FROM workspace_notes WHERE id = ?').get(id);
    if (!note) throw Error('This note no longer exists.');
    return { ...note, blocks: JSON.parse(note.blocks) };
  }
  create(template, parentId = null, titleOverride) {
    if (parentId) {
      let depth = 0, current = parentId;
      while (current) {
        if (++depth > 12) throw Error('Notes support up to 12 levels of subpages.');
        current = this.get(current).parentId;
      }
    }
    if (!Object.hasOwn(templates, template)) throw Error('Unknown note template.');
    const [title, entries] = templates[template], id = randomUUID();
    const blocks = entries.map(([type, value, body]) => type === 'tracker' ? tracker(value) : type === 'table' ? { type, rows: value } :
      { type, text: value, ...(type === 'toggle' ? { body } : {}) });
    this.db.prepare(`INSERT INTO workspace_notes (id, title, blocks, position, updated, parent_id)
      VALUES (?, ?, ?, (SELECT coalesce(max(position) + 1, 0) FROM workspace_notes), ?, ?)`)
      .run(id, titleOverride === undefined ? title : text(titleOverride, 120), encodeBlocks(blocks), new Date().toISOString(), parentId);
    return this.get(id);
  }
  save(id, { title, blocks }) {
    const updated = new Date().toISOString();
    const encoded = encodeBlocks(blocks);
    this.db.exec('SAVEPOINT save_note');
    try {
      const result = this.db.prepare('UPDATE workspace_notes SET title = ?, blocks = ?, updated = ? WHERE id = ?')
        .run(text(title, 120), encoded, updated, id);
      if (!result.changes) throw Error('This note no longer exists.');
      this.db.prepare(`DELETE FROM note_tracker_records WHERE note_id=? AND tracker_id NOT IN
        (SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_extract(value,'$.type')='tracker')`).run(id,encoded);
      this.db.exec('RELEASE save_note');
    } catch (error) {
      this.db.exec('ROLLBACK TO save_note; RELEASE save_note');
      throw error;
    }
    return updated;
  }
  reorder(id, target) {
    const ids = this.db.prepare('SELECT id FROM workspace_notes ORDER BY position, id').all().map(note => note.id);
    const from = ids.indexOf(id), to = ids.indexOf(target);
    if (from < 0 || to < 0) throw Error('This note no longer exists.');
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    this.db.exec('SAVEPOINT reorder_notes');
    try {
      const update = this.db.prepare('UPDATE workspace_notes SET position = ? WHERE id = ?');
      ids.forEach((noteId, index) => update.run(index, noteId));
      this.db.exec('RELEASE reorder_notes');
    } catch (error) {
      this.db.exec('ROLLBACK TO reorder_notes; RELEASE reorder_notes');
      throw error;
    }
    return this.list();
  }
  remove(id) {
    this.db.prepare('DELETE FROM workspace_notes WHERE id = ?').run(id);
  }
  setEmoji(id, emoji) {
    if (typeof emoji !== 'string' || emoji.length > 64 || (emoji &&
        (!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji) ||
          [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(emoji)].length !== 1))) {
      throw Error('Choose a single emoji.');
    }
    const result = this.db.prepare('UPDATE workspace_notes SET emoji=? WHERE id=?').run(emoji,id);
    if (!result.changes) throw Error('This note no longer exists.');
    return emoji;
  }
  setCover(id, cover, thumbnail) {
    const result = this.db.prepare('UPDATE workspace_notes SET cover = ?, thumbnail = ? WHERE id = ?').run(cover, thumbnail, id);
    if (!result.changes) throw Error('This note no longer exists.');
  }
  cover(id, small) {
    return this.db.prepare(small ? 'SELECT thumbnail AS image FROM workspace_notes WHERE id = ?' :
      'SELECT cover AS image FROM workspace_notes WHERE id = ?').get(id)?.image;
  }
}
module.exports = { NotesStore };
