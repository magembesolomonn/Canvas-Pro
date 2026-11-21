const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {permanentDelete,recoverDeletions}=require('./deletion.cjs');
const {recordImport,recoverImports}=require('./import-recovery.cjs');
const {HASHED_SQL}=require('./perceptual-hash.cjs');
class Library {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(path.join(root, 'originals'), { recursive: true });
    fs.mkdirSync(path.join(root, 'thumbnails'), { recursive: true });
    this.db = new DatabaseSync(path.join(root, 'library.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-8000; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, ext TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT UNIQUE NOT NULL, stored TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', folders TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, imported TEXT NOT NULL, trash INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS folders (name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS capture_metadata (id TEXT PRIMARY KEY REFERENCES assets(id), json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assets_imported ON assets(imported DESC,id DESC);
      CREATE INDEX IF NOT EXISTS assets_visible_order ON assets(trash,imported);
      CREATE TABLE IF NOT EXISTS asset_analysis(id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,summary TEXT NOT NULL DEFAULT '{}',text TEXT NOT NULL DEFAULT '',vector BLOB,model TEXT,version INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS aspect_ratios (id TEXT PRIMARY KEY REFERENCES assets(id), ratio REAL NOT NULL);`);
    const columns=this.db.prepare('PRAGMA table_info(assets)').all();if(!columns.some(c=>c.name==='favorite')){this.db.exec('ALTER TABLE assets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0; UPDATE assets SET favorite=1 WHERE rating>=4');}
    if(!this.db.prepare('PRAGMA table_info(assets)').all().some(c=>c.name==='missing'))this.db.exec('ALTER TABLE assets ADD COLUMN missing INTEGER NOT NULL DEFAULT 0');
    const assetColumns=this.db.prepare('PRAGMA table_info(assets)').all();
    if(!assetColumns.some(c=>c.name==='width'))this.db.exec('ALTER TABLE assets ADD COLUMN width INTEGER NOT NULL DEFAULT 0');
    if(!assetColumns.some(c=>c.name==='height'))this.db.exec('ALTER TABLE assets ADD COLUMN height INTEGER NOT NULL DEFAULT 0');
    if(!this.db.prepare('PRAGMA table_info(assets)').all().some(c=>c.name==='phash'))this.db.exec('ALTER TABLE assets ADD COLUMN phash TEXT');
    this.db.exec(`CREATE INDEX IF NOT EXISTS assets_phash_pending ON assets(imported DESC) WHERE phash IS NULL AND trash=0;
      CREATE INDEX IF NOT EXISTS asset_analysis_version ON asset_analysis(version);`);
    if(!this.db.prepare('PRAGMA table_info(folders)').all().some(c=>c.name==='id'))this.db.exec('ALTER TABLE folders ADD COLUMN id TEXT');for(const folder of this.db.prepare('SELECT name FROM folders WHERE id IS NULL').all())this.db.prepare('UPDATE folders SET id=? WHERE name=?').run(crypto.randomUUID(),folder.name);this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS folders_id ON folders(id)');
    for(const table of ['movie_tracker','rss_articles','rss_feeds','rss_settings'])this.db.exec(`DROP TABLE IF EXISTS ${table};`);
    this.assetStatement=this.db.prepare('SELECT * FROM assets WHERE id=?');
    this.updateStatements=new Map();
    this.deleting=new Set();
    this.revision=0;this.navCache=null;
    recoverDeletions(this);
    recoverImports(this);
  }
  list(ids,limit=0,offset=0) { const where=ids?' WHERE assets.id IN ('+ids.map(()=>'?').join(',')+')':'';const params=[...(ids||[])];let sql='SELECT assets.*, assets.rowid AS importOrder, aspect_ratios.ratio AS aspectRatio, capture_metadata.json AS captureJSON, asset_analysis.summary AS smartJSON FROM assets LEFT JOIN aspect_ratios ON assets.id=aspect_ratios.id LEFT JOIN capture_metadata ON assets.id=capture_metadata.id LEFT JOIN asset_analysis ON assets.id=asset_analysis.id'+where+' ORDER BY imported DESC, assets.rowid DESC';if(Number.isFinite(limit)&&limit>0){sql+=' LIMIT ?';params.push(Math.floor(limit));}else if(offset>0){sql+=' LIMIT -1';}if(Number.isFinite(offset)&&offset>0){sql+=' OFFSET ?';params.push(Math.floor(offset));}return this.db.prepare(sql).all(...params).map(a => ({ ...a, captureMetadata: a.captureJSON?JSON.parse(a.captureJSON):null, captureJSON:undefined,smart:a.smartJSON?JSON.parse(a.smartJSON):null,smartJSON:undefined, tags: JSON.parse(a.tags), folders: JSON.parse(a.folders) })); }
  ftsAvailable(){if(this.ftsReady)return true;try{if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='smart_fts'").get())this.ftsReady=true;}catch{}return !!this.ftsReady;}
  page({view='all',folder='',tag='',sort='new',query='',matches=[],extensions=[],bookmark='',excludeBookmarks=false,other=false,knownExtensions=[],offset=0,limit=120,cursor=null}={}){
    const where=['a.trash=?'],params=[view==='trash'?1:0];
    const clause=(sql,...values)=>{where.push(sql);params.push(...values);};
    if(view==='favorites')clause('a.favorite=1');
    if(view==='tags'&&!tag)clause('json_array_length(a.tags)>0');
    if(view==='folder')clause('EXISTS(SELECT 1 FROM json_each(a.folders) WHERE value=?)',folder);
    if(tag)clause('EXISTS(SELECT 1 FROM json_each(a.tags) WHERE value=?)',tag);
    if(extensions.length)clause('a.ext IN (SELECT value FROM json_each(?))',JSON.stringify(extensions));
    if(bookmark==='social'||bookmark==='recipe')clause("EXISTS(SELECT 1 FROM capture_metadata m WHERE m.id=a.id AND json_extract(m.json,'$.linkPreview.type')=?)",bookmark);
    if(excludeBookmarks)clause("NOT EXISTS(SELECT 1 FROM capture_metadata m WHERE m.id=a.id AND json_extract(m.json,'$.linkPreview.type') IN ('social','recipe'))");
    if(other)clause('a.ext NOT IN (SELECT value FROM json_each(?))',JSON.stringify(knownExtensions));
    const text=String(query??'').trim();
    if(text||matches.length){
      const predicates=[],values=[];
      if(text){
        if(!this.searchFunctions){
          this.db.function('canvas_fold',{deterministic:true},value=>String(value??'').toLowerCase());
          this.searchFunctions=true;
        }
        predicates.push(`instr(canvas_fold(a.name||' '||a.notes||' '||a.url||' '||a.tags||' '||a.folders),?)>0`);
        values.push(text);
        if(this.ftsAvailable()){
          const terms=text.split(/\s+/).filter(Boolean).slice(0,8).map(term=>'"'+term.replace(/"/g,'')+'"*');
          if(terms.length){predicates.push('a.id IN (SELECT id FROM smart_fts WHERE smart_fts MATCH ?)');values.push(terms.join(' OR '));}
        }else{
          predicates.push(`EXISTS(SELECT 1 FROM capture_metadata m WHERE m.id=a.id AND instr(canvas_fold(m.json),?)>0)`);
          values.push(text);
          predicates.push(`EXISTS(SELECT 1 FROM asset_analysis s WHERE s.id=a.id AND instr(canvas_fold(s.summary),?)>0)`);
          values.push(text);
        }
      }
      if(matches.length){
        predicates.push('a.id IN (SELECT value FROM json_each(?))');
        values.push(JSON.stringify(matches));
      }
      clause('('+predicates.join(' OR ')+')',...values);
    }
    const condition=' WHERE '+where.join(' AND ');
    const order={new:'a.imported DESC,a.rowid DESC',old:'a.imported ASC,a.rowid ASC',name:'a.name COLLATE NOCASE,a.rowid DESC','name-desc':'a.name COLLATE NOCASE DESC,a.rowid DESC',size:'a.size DESC,a.imported DESC,a.rowid DESC','size-asc':'a.size ASC,a.imported DESC,a.rowid DESC',kind:'a.ext COLLATE NOCASE,a.name COLLATE NOCASE',rating:'a.rating DESC,a.imported DESC,a.rowid DESC'};
    const orderSql=Object.hasOwn(order,sort)?order[sort]:order.new;
    const keyset=sort==='new'&&cursor&&typeof cursor==='object'&&typeof cursor.imported==='string'&&Number.isFinite(Number(cursor.rowid));
    const cursorSql=keyset?' AND (a.imported < ? OR (a.imported = ? AND a.rowid < ?))':'';
    const cursorParams=keyset?[cursor.imported,cursor.imported,Number(cursor.rowid)]:[];
    const rows=this.db.prepare('SELECT a.id, a.imported AS importedKey, a.rowid AS rowKey FROM assets a'+condition+cursorSql+' ORDER BY '+orderSql+' LIMIT ? OFFSET ?').all(...params,...cursorParams,limit,keyset?0:offset);
    const records=new Map(this.list(rows.map(row=>row.id)).map(asset=>[asset.id,asset]));
    const total=offset===0&&!keyset?this.db.prepare('SELECT COUNT(*) AS total FROM assets a'+condition).get(...params).total:null;
    const last=rows.at(-1);
    return {assets:rows.map(row=>records.get(row.id)),total,nextCursor:last?{imported:last.importedKey,rowid:Number(last.rowKey)}:null};
  }
  navSummary(){
    if(this.navCache&&this.navCache.revision===this.revision)return this.navCache.value;
    const counts=this.db.prepare(`SELECT COUNT(*) FILTER(WHERE trash=0) AS "all", COUNT(*) FILTER(WHERE trash=1) AS trash,
      COUNT(*) FILTER(WHERE trash=0 AND favorite=1) AS favorites,
      COUNT(*) FILTER(WHERE trash=0 AND json_array_length(folders)>0) AS categorised FROM assets`).get();
    const extensions=this.db.prepare('SELECT ext, COUNT(*) AS count FROM assets WHERE trash=0 GROUP BY ext').all();
    const tags=this.db.prepare('SELECT DISTINCT value FROM assets,json_each(assets.tags) WHERE trash=0 ORDER BY value').all().map(row=>row.value);
    const members=this.db.prepare('SELECT value,COUNT(*) AS count FROM assets,json_each(assets.folders) WHERE trash=0 GROUP BY value').all().map(row=>[row.value,row.count]);
    const linkTypes=this.db.prepare("SELECT json_extract(m.json,'$.linkPreview.type') AS type,COUNT(*) AS count FROM capture_metadata m JOIN assets a ON a.id=m.id WHERE a.trash=0 AND json_extract(m.json,'$.linkPreview.type') IN ('social','recipe') GROUP BY type").all();
    const value={counts,extensions,tags,members,linkTypes};
    this.navCache={revision:this.revision,value};
    return value;
  }
  folders() { return this.db.prepare('SELECT name FROM folders ORDER BY name').all().map(f => f.name); }
  folderRecords(){return this.db.prepare('SELECT id,name FROM folders ORDER BY name').all();}
  addFolder(name) {
    name = String(name).trim();
    if (!name || name.length > 120) throw new Error('Use a folder name between 1 and 120 characters.');
    this.db.prepare('INSERT OR IGNORE INTO folders(name,id) VALUES (?,?)').run(name,crypto.randomUUID());this.revision++;
    return this.folders();
  }
  filenameMatches(query, extensions = []) {
    if (!this.searchFunctions) {
      this.db.function('canvas_fold', { deterministic: true }, value => String(value ?? '').toLowerCase());
      this.searchFunctions = true;
    }
    return this.db.prepare(`SELECT id FROM assets WHERE trash=0 AND instr(canvas_fold(name),?)>0
      AND (? OR ext IN (SELECT value FROM json_each(?)))`)
      .all(query.toLowerCase(), Number(!extensions.length), JSON.stringify(extensions)).map(row => row.id);
  }

  createCollectionWithAssets(name, ids) {
    this.db.exec('SAVEPOINT create_collection');
    try {
      if (this.folders().includes(name)) throw new Error('A collection already has that name.');
      const assets = ids.length ? this.selectedAssets(ids) : [];
      if (assets.some(asset => asset.trash)) throw new Error('A matching file moved to Trash. Run the command again.');
      this.addFolder(name);
      for (const asset of assets) this.update(asset.id, { folders: [...JSON.parse(asset.folders), name] });
      this.db.exec('RELEASE create_collection');
    } catch (error) {
      this.db.exec('ROLLBACK TO create_collection; RELEASE create_collection');
      throw error;
    }
  }
  asset(id) { const a = this.assetStatement.get(id); if (!a) throw new Error('Asset not found'); return a; }
  file(id) {
    const stored=this.asset(id).stored,base=path.resolve(this.root,'originals'),file=path.resolve(this.root,stored);
    if(!file.startsWith(base+path.sep))throw new Error('The original has an unsafe file location.');
    let real;
    try{real=fs.realpathSync(file);}
    catch(error){
      if(error.code==='ENOENT')throw new Error('The original file is missing from this library. It may have been deleted in Finder.');
      throw error;
    }
    const realBase=fs.realpathSync(base);if(!real.startsWith(realBase+path.sep))throw new Error('The original points outside this library.');return real;
  }
  markMissing(id) {
    const a=this.asset(id);
    if(a.trash||a.missing||this.deleting.has(id))return false;
    this.db.prepare('UPDATE assets SET trash=1,missing=1 WHERE id=?').run(id);
    this.revision++;this.onAssetChanged?.(id);
    return true;
  }
  markPresent(id) {
    const a=this.asset(id);
    if(!a.missing)return false;
    this.db.prepare('UPDATE assets SET trash=0,missing=0 WHERE id=?').run(id);
    this.revision++;this.onAssetChanged?.(id);
    return true;
  }
  async importFile(source, folder, {signal} = {}) {
    signal?.throwIfAborted();
    const destination=folder?this.db.prepare('SELECT id FROM folders WHERE name=?').get(folder):null;
    const sourceStat = await fs.promises.stat(source);
    if (!sourceStat.isFile()) return { skipped: source };
    const id = crypto.randomUUID();
    const ext = path.extname(source).slice(1).toLowerCase();
    const stored = path.join('originals', id + (ext ? '.' + ext : ''));
    const dest = path.join(this.root, stored);
    let retained = false, journal;
    try {
      journal = recordImport(this, id, stored);
      await fs.promises.copyFile(source, dest, fs.constants.COPYFILE_EXCL);
      signal?.throwIfAborted();
      const snapshot = await fs.promises.stat(dest);
      const hash = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(dest,{signal})) hash.update(chunk);
      signal?.throwIfAborted();
      const digest = hash.digest('hex');
      if(destination)folder=this.db.prepare('SELECT name FROM folders WHERE id=?').get(destination.id)?.name||null;
      const exists = this.db.prepare('SELECT id, stored, folders, trash, missing FROM assets WHERE hash=?').get(digest);
      if (exists) {
        if (this.deleting.has(exists.id)) throw new Error('This file is being deleted. Try importing it again afterwards.');
        if (exists.missing) {
          const target=path.join(this.root, exists.stored);
          try { await fs.promises.link(dest, target); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          this.markPresent(exists.id);
        }
        const changes = {};
        if (exists.trash && !exists.missing) changes.trash = false;
        if (folder) changes.folders = [...new Set([...JSON.parse(exists.folders), folder])];
        this.update(exists.id, changes);
        return { duplicate: exists.id };
      }
      this.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,folders,created,imported) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id, path.basename(source), ext, snapshot.size, digest, stored, JSON.stringify(folder ? [folder] : []), sourceStat.birthtime.toISOString(), new Date().toISOString());
      retained = true;
      try {
      if(['url','webloc'].includes(ext)&&snapshot.size<1024*1024){const text=await fs.promises.readFile(dest,'utf8');const value=ext==='url'?text.match(/^URL\s*=\s*(.+)$/im)?.[1]:text.match(/<key>URL<\/key>\s*<string>([\s\S]*?)<\/string>/i)?.[1];if(value){try{const url=new URL(value.trim().replaceAll('&amp;','&'));if(['http:','https:'].includes(url.protocol))this.update(id,{url:url.href});}catch{}}}
      } catch {  }
      this.revision++;this.onAssetChanged?.(id);
      return { imported: id };
    } finally {
      if (!retained) await fs.promises.rm(dest, { force: true });
      if (journal) { try { await fs.promises.rm(journal, { force: true }); } catch {  } }
    }
  }

  update(id, changes) {
    const current=this.asset(id);
    if(this.deleting.has(id))throw new Error('This file is being permanently deleted.');
    if('trash' in changes&&!changes.trash&&current.missing)throw new Error('The original file is missing from this library. Put it back in Finder before restoring this item.');
    const fields = []; const values = [];
    for (const key of ['name', 'notes', 'url', 'rating', 'favorite', 'trash', 'tags', 'folders']) {
      if (!(key in changes)) continue;
      let v = changes[key];
      if (key === 'tags' || key === 'folders') {
        if (!Array.isArray(v) || v.some(s => typeof s !== 'string')) throw new Error('Invalid list');
        v = JSON.stringify([...new Set(v.map(s => s.trim()).filter(Boolean))]);
      } else if (key === 'rating') { if (!Number.isInteger(v) || v < 0 || v > 5) throw new Error('Invalid rating'); }
      else if (key === 'trash' || key === 'favorite') v = v ? 1 : 0;
      else if (typeof v !== 'string') throw new Error('Invalid text');
      fields.push(key + '=?'); values.push(v);
    }
    if(fields.length){const sql='UPDATE assets SET '+fields.join(',')+' WHERE id=?';if(!this.updateStatements.has(sql))this.updateStatements.set(sql,this.db.prepare(sql));this.updateStatements.get(sql).run(...values,id);this.revision++;this.onAssetChanged?.(id);}
  }
  setCaptureMetadata(id,metadata){
    this.asset(id);const previous=this.db.prepare('SELECT json FROM capture_metadata WHERE id=?').get(id);const old=previous?JSON.parse(previous.json):{};
    const sources=[...new Set([...(old.sources||[]),old.pageUrl,metadata.pageUrl].filter(Boolean))].slice(-20);
    this.db.prepare('INSERT INTO capture_metadata(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(id,JSON.stringify({...old,...metadata,sources}));this.revision++;this.onAssetChanged?.(id);
  }
  setPhash(id, value) {
    if (typeof value !== 'string' || (value && !/^[0-9a-f]{16}$/.test(value))) throw new Error('Invalid fingerprint');
    this.db.prepare('UPDATE assets SET phash=? WHERE id=?').run(value, id);
    this.revision++;
  }
  phashCandidates(limit = 24) {
    const extensions = HASHED_SQL;
    return this.db.prepare(`SELECT id,ext,size FROM assets WHERE trash=0 AND phash IS NULL AND ext IN (${extensions}) ORDER BY imported DESC LIMIT ?`).all(limit);
  }
  phashPending() {
    return this.db.prepare(`SELECT COUNT(*) AS count FROM assets WHERE trash=0 AND phash IS NULL AND ext IN (${HASHED_SQL})`).get().count;
  }
  selectedAssets(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new Error('Invalid selection.');
    const unique = [...new Set(ids)];
    if (unique.length > this.db.prepare('SELECT COUNT(*) AS count FROM assets').get().count) throw new Error('Invalid selection.');
    return unique.map(id => this.asset(id));
  }
  updateMany(ids,operation){
    const records = this.selectedAssets(ids);
    if(!operation||!['tags','removeTags','collection','removeCollection','rating','favorite','trash','rename'].includes(operation.type))throw new Error('Invalid bulk action');
    this.db.exec('BEGIN');try{let position=0;for(const asset of records){const id=asset.id;let changes;position++;
      if(operation.type==='tags'){if(!Array.isArray(operation.tags)||operation.tags.some(t=>typeof t!=='string'))throw new Error('Invalid tags');changes={tags:[...JSON.parse(asset.tags),...operation.tags]};}
      if(operation.type==='removeTags'){if(!Array.isArray(operation.tags)||operation.tags.some(t=>typeof t!=='string'))throw new Error('Invalid tags');const remove=new Set(operation.tags.map(tag=>tag.trim()).filter(Boolean));changes={tags:JSON.parse(asset.tags).filter(tag=>!remove.has(tag))};}
      if(operation.type==='rename'){
        if(typeof operation.pattern!=='string'||!operation.pattern.trim())throw new Error('Enter a name pattern.');
        const pattern=operation.pattern.trim();
        const dot=asset.name.lastIndexOf('.');
        const base=dot>0?asset.name.slice(0,dot):asset.name;
        const extension=dot>0?asset.name.slice(dot):'';
        let next=pattern.replaceAll('{name}',base).replaceAll('{n}',String(position));
        if(!next.includes('.')&&extension)next+=extension;
        next=next.slice(0,255);
        changes={name:next||asset.name};
      }
      if(operation.type==='collection'){if(typeof operation.folder!=='string'||!this.db.prepare('SELECT name FROM folders WHERE name=?').get(operation.folder))throw new Error('Choose an existing collection.');changes={folders:[...JSON.parse(asset.folders),operation.folder]};}
      if(operation.type==='removeCollection'){if(typeof operation.folder!=='string')throw new Error('Invalid collection');changes={folders:JSON.parse(asset.folders).filter(name=>name!==operation.folder)};}
      if(operation.type==='favorite')changes={favorite:!!operation.favorite};
      if(operation.type==='rating')changes={rating:operation.rating};
      if(operation.type==='trash')changes={trash:!!operation.trash};
      this.update(id,changes);
    }this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');if(operation.type==='trash'&&!operation.trash&&/original file is missing/i.test(String(e.message||'')))throw new Error('Nothing was restored: one of these files has no original in the library. Put it back in Finder, then restore it on its own.');throw e;}
  }
  renameTag(oldName,newName=''){
    oldName=String(oldName||'').trim();newName=String(newName||'').trim();
    if(!oldName)throw new Error('Choose a tag to rename.');
    if(newName.length>120)throw new Error('Use a tag name of 120 characters or less.');
    const rows=this.db.prepare('SELECT id,tags FROM assets').all();
    this.db.exec('BEGIN');
    try{
      for(const row of rows){
        const tags=JSON.parse(row.tags);
        if(!tags.includes(oldName))continue;
        const next=newName?[...new Set(tags.map(tag=>tag===oldName?newName:tag))]:tags.filter(tag=>tag!==oldName);
        this.update(row.id,{tags:next});
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    this.revision++;
  }
  removeTag(name){return this.renameTag(name,'');}
  applyPresence(presentIds=[],missingIds=[]){
    const changed=[];
    this.db.exec('BEGIN');
    try{
      const present=this.db.prepare('UPDATE assets SET trash=0,missing=0 WHERE id=? AND missing=1');
      for(const id of presentIds)if(present.run(id).changes){changed.push(id);this.onAssetChanged?.(id);}
      const missing=this.db.prepare('UPDATE assets SET trash=1,missing=1 WHERE id=? AND missing=0 AND trash=0');
      for(const id of missingIds)if(missing.run(id).changes){changed.push(id);this.onAssetChanged?.(id);}
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(changed.length)this.revision++;
    return changed;
  }
  setDimensions(id,width,height){
    width=Math.floor(Number(width));height=Math.floor(Number(height));
    if(typeof id!=='string'||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width>200000||height>200000)return false;
    const changed=this.db.prepare('UPDATE assets SET width=?,height=? WHERE id=? AND (width<>? OR height<>?)').run(width,height,id,width,height).changes;
    if(changed)this.revision++;
    return !!changed;
  }
  permanentDelete(ids,options){this.revision++;return permanentDelete(this,ids,options);}
  renameCollection(oldName,newName){newName=String(newName).trim();if(!newName||newName.length>120)throw new Error('Use a collection name between 1 and 120 characters.');if(!this.folders().includes(oldName))throw new Error('Collection not found.');if(oldName===newName)return;if(this.folders().includes(newName))throw new Error('A collection with that name already exists.');this.db.exec('BEGIN');try{this.db.prepare('UPDATE folders SET name=? WHERE name=?').run(newName,oldName);for(const a of this.db.prepare('SELECT id,folders FROM assets').all()){const folders=JSON.parse(a.folders);if(folders.includes(oldName))this.update(a.id,{folders:folders.map(f=>f===oldName?newName:f)});}this.db.exec('COMMIT');this.revision++;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  removeCollection(name){if(!this.folders().includes(name))throw new Error('Collection not found.');this.db.exec('BEGIN');try{for(const a of this.db.prepare('SELECT id,folders FROM assets').all()){const folders=JSON.parse(a.folders);if(folders.includes(name))this.update(a.id,{folders:folders.filter(f=>f!==name)});}this.db.prepare('DELETE FROM folders WHERE name=?').run(name);this.db.exec('COMMIT');this.revision++;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  setAspectRatios(entries) {
    const statement=this.db.prepare('INSERT INTO aspect_ratios(id,ratio) SELECT ?,? WHERE EXISTS(SELECT 1 FROM assets WHERE id=?) ON CONFLICT(id) DO UPDATE SET ratio=excluded.ratio');
    this.db.exec('BEGIN');try {for(const [id,ratio]of entries)if(typeof id==='string'&&Number.isFinite(ratio)&&ratio>0&&ratio<100000)statement.run(id,ratio,id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  close() { this.db.close(); }
}
module.exports = { Library };
