const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DEFAULT_DISTANCE,distance,bands:fingerprintBands,token:tokenFor}=require('./perceptual-hash.cjs');
const fields=['name','notes','url','rating','favorite','trash','tags','folders'];
function keepScore(asset){const tags=JSON.parse(asset.tags||'[]').length;return (asset.notes?1e15:0)+(tags?1e14:0)+(asset.favorite?1e13:0)+asset.size;}
class Workbench{
 constructor(library){this.library=library;this.db=library.db;this.undo=[];this.redo=[];this.backingUp=false;this.db.exec(`CREATE TABLE IF NOT EXISTS presentation(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS library_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS duplicate_dismissals(token TEXT PRIMARY KEY,ids TEXT NOT NULL,at TEXT NOT NULL);`);}
 snapshot(ids){return this.library.selectedAssets(ids).map(a=>({id:a.id,...Object.fromEntries(fields.map(k=>[k,['tags','folders'].includes(k)?JSON.parse(a[k]):a[k]]))}));}
 change(ids,fn,label='Edit files'){const before=this.snapshot(ids);fn();const after=this.snapshot(ids);if(JSON.stringify(before)!==JSON.stringify(after)){const old=[],next=[];for(let i=0;i<before.length;i++){const keys=fields.filter(k=>JSON.stringify(before[i][k])!==JSON.stringify(after[i][k]));if(keys.length){old.push({id:before[i].id,...Object.fromEntries(keys.map(k=>[k,before[i][k]]))});next.push({id:after[i].id,...Object.fromEntries(keys.map(k=>[k,after[i][k]]))});}}this.undo.push({before:old,after:next,label});if(this.undo.length>50)this.undo.shift();this.redo=[];}return {label};}
 history(redo=false){const source=redo?this.redo:this.undo,target=redo?this.undo:this.redo,item=source.at(-1);if(!item)return {changed:false};const values=(redo?item.after:item.before).filter(a=>{try{this.library.asset(a.id);return true;}catch{return false;}});if(!values.length){source.pop();return this.history(redo);}this.db.exec('SAVEPOINT history');try{for(const a of values)this.library.update(a.id,a);this.db.exec('RELEASE history');}catch(e){this.db.exec('ROLLBACK TO history; RELEASE history');throw e;}source.pop();target.push(item);return {changed:true,label:item.label};}
 pref(key,value){if(value===undefined){const row=this.db.prepare('SELECT value FROM library_preferences WHERE key=?').get(key);return row?JSON.parse(row.value):null;}this.db.prepare('INSERT INTO library_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return value;}
 icons(){return Object.fromEntries(this.db.prepare('SELECT * FROM presentation').all().map(r=>[r.key,JSON.parse(r.value)]));}
 icon(key,value){if(typeof key!=='string'||key.length>150||!value||!['symbol','emoji'].includes(value.type)||typeof value.value!=='string'||value.value.length>40)throw Error('Choose an icon or emoji.');this.db.prepare('INSERT INTO presentation VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return this.icons();}
 async recover(id,source){const a=this.library.asset(id);if(this.library.deleting.has(id))throw Error('File is being deleted.');const stored=path.resolve(this.library.root,a.stored);const dest=path.join(fs.realpathSync(path.dirname(stored)),path.basename(stored)),base=fs.realpathSync(path.join(this.library.root,'originals'));if(path.dirname(dest)!==base)throw Error('Unsafe original location.');try{await fs.promises.lstat(dest);throw Error('The original still exists. It will not be overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}const stat=await fs.promises.stat(source);if(!stat.isFile()||stat.size!==a.size)throw Error('This file does not match the missing original.');const temp=path.join(base,'.restore-'+crypto.randomUUID());try{await fs.promises.copyFile(source,temp,fs.constants.COPYFILE_EXCL);const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(temp))hash.update(b);if(hash.digest('hex')!==a.hash)throw Error('The selected file has different contents. Choose the matching original.');await fs.promises.link(temp,dest);this.library.markPresent(id);return {restored:true,id};}finally{await fs.promises.rm(temp,{force:true});}}
 backup(destination){if(this.backupTask)return Promise.reject(Error('Wait for the current backup to finish.'));this.backupTask=this.runBackup(destination).finally(()=>{this.backupTask=null;});return this.backupTask;}
 async close(){await this.backupTask?.catch(()=>{});}
 async runBackup(destination){if(this.backingUp||this.library.deleting.size)throw Error('Wait for the current backup or deletion to finish.');const real=path.resolve(destination),root=fs.realpathSync(this.library.root);if(real===root||real.startsWith(root+path.sep))throw Error('Save backups outside the current library.');this.backingUp=true;let made=false;try{await fs.promises.mkdir(real);made=true;this.db.prepare('VACUUM INTO ?').run(path.join(real,'library.sqlite'));const {DatabaseSync}=require('node:sqlite'),snapshot=new DatabaseSync(path.join(real,'library.sqlite'),{readOnly:true});let originals;try{originals=snapshot.prepare('SELECT stored FROM assets').all();}finally{snapshot.close();}await fs.promises.mkdir(path.join(real,'originals'));for(const record of originals){const source=path.resolve(root,record.stored);if(path.dirname(source)!==path.join(root,'originals')||!(await fs.promises.lstat(source)).isFile()||(await fs.promises.lstat(source)).isSymbolicLink())throw Error('Backup stopped: an original is missing or unsafe. Run Library health.');await fs.promises.copyFile(source,path.join(real,record.stored));}for(const dir of ['thumbnails','media-v2'])if(fs.existsSync(path.join(root,dir)))await fs.promises.cp(path.join(root,dir),path.join(real,dir),{recursive:true,filter:source=>!fs.lstatSync(source).isSymbolicLink()});const info={at:new Date().toISOString(),path:real};this.pref('lastBackup',info);return info;}catch(e){if(made)await fs.promises.rm(real,{recursive:true,force:true});throw e;}finally{this.backingUp=false;}}
 async duplicates({threshold = DEFAULT_DISTANCE} = {}) {
  const limit = Math.max(1, Math.min(12, Math.round(Number(threshold) || DEFAULT_DISTANCE)));
  const rows = this.db.prepare(`SELECT id,name,size,ext,hash,phash,imported,notes,favorite,tags FROM assets WHERE trash=0 AND phash IS NOT NULL AND phash<>''`).all();
  const pending = this.library.phashPending();
  if (rows.length < 2) return { groups: [], pending, total: rows.length, scanned: rows.length, threshold: limit };
  const dismissed = new Set(this.db.prepare('SELECT token FROM duplicate_dismissals').all().map(row => row.token));
  const byId = new Map(rows.map(row => [row.id, row]));
  const parent = new Map(), rank = new Map();
  const root = id => {
    let node = id;
    while (parent.get(node) !== node) node = parent.get(node);
    while (parent.get(id) !== node) { const next = parent.get(id); parent.set(id, node); id = next; }
    return node;
  };
  const union = (a, b) => {
    let left = root(a), right = root(b);
    if (left === right) return;
    if ((rank.get(left) || 0) < (rank.get(right) || 0)) [left, right] = [right, left];
    parent.set(right, left);
    if (rank.get(left) === (rank.get(right) || 0)) rank.set(left, (rank.get(left) || 0) + 1);
  };
  for (const row of rows) { parent.set(row.id, row.id); rank.set(row.id, 0); }

  const byHash = new Map();
  for (const row of rows) {
    const previous = byHash.get(row.hash);
    if (previous) union(previous, row.id);
    else byHash.set(row.hash, row.id);
  }

  const buckets = new Map();
  for (const row of rows) {
    for (const band of fingerprintBands(row.phash)) {
      let bucket = buckets.get(band);
      if (!bucket) { bucket = []; buckets.set(band, bucket); }
      for (const other of bucket) {
        if (distance(row.phash, byId.get(other).phash) <= limit) union(other, row.id);
      }
      bucket.push(row.id);
      if (bucket.length > 400) bucket.shift();
    }
  }

  const clusters = new Map();
  for (const row of rows) {
    const key = root(row.id);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(row);
  }

  const interesting = rows.filter(row => clusters.get(root(row.id)).length > 1);
  const records = new Map(this.library.list(interesting.map(row => row.id)).map(asset => [asset.id, asset]));
  const groups = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const ids = members.map(member => member.id);
    const token = tokenFor(ids);
    if (dismissed.has(token)) continue;
    let smallest = 64;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        smallest = Math.min(smallest, distance(members[i].phash, members[j].phash));
      }
    }
    const exact = members.every(member => member.hash === members[0].hash) || smallest === 0;
    const keep = members.slice().sort((a, b) => keepScore(b) - keepScore(a) || String(a.imported).localeCompare(String(b.imported)))[0];
    const total = members.reduce((sum, member) => sum + member.size, 0);
    groups.push({
      token,
      kind: exact ? 'exact' : 'near',
      similarity: exact ? 100 : Math.round((1 - smallest / 64) * 100),
      bits: smallest,
      keep: keep.id,
      savings: Math.max(0, total - keep.size),
      size: total,
      members: members.map(member => {
        const asset = records.get(member.id) || {};
        return {
          id: member.id,
          name: member.name,
          size: member.size,
          ext: member.ext,
          imported: member.imported,
          notes: member.notes || '',
          favorite: Boolean(member.favorite),
          tags: Array.isArray(asset.tags) ? asset.tags : JSON.parse(member.tags || '[]'),
          folders: Array.isArray(asset.folders) ? asset.folders : []
        };
      }).sort((a, b) => (a.id === keep.id ? -1 : b.id === keep.id ? 1 : b.size - a.size))
    });
  }
  groups.sort((a, b) => b.savings - a.savings || b.members.length - a.members.length || b.similarity - a.similarity);
  return { groups: groups.slice(0, 200), pending, total: rows.length, scanned: rows.length, threshold: limit };
 }
 dismissDuplicates(ids) {
  if (!Array.isArray(ids) || ids.length < 2) throw new Error('Choose a duplicate group first.');
  const token = tokenFor(ids);
  this.db.prepare('INSERT INTO duplicate_dismissals(token,ids,at) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET at=excluded.at').run(token, JSON.stringify([...new Set(ids)].sort()), new Date().toISOString());
  return { token };
 }

 similar(id,limit=30){this.library.asset(id);const source=this.db.prepare('SELECT vector,model FROM asset_analysis WHERE id=?').get(id);if(!source?.vector)return [];const floats=b=>new Float32Array(Uint8Array.from(b).buffer),v=floats(source.vector);if(v.length!==512)return [];const results=[];for(const row of this.db.prepare('SELECT s.id,s.vector FROM asset_analysis s JOIN assets a ON a.id=s.id WHERE a.trash=0 AND s.model=? AND s.id!=? AND s.vector IS NOT NULL').all(source.model,id)){const b=floats(row.vector);if(b.length!==512)continue;let dot=0,x=0,y=0;for(let i=0;i<512;i++){dot+=v[i]*b[i];x+=v[i]*v[i];y+=b[i]*b[i];}const score=dot/Math.sqrt(x*y);if(Number.isFinite(score))results.push({id:row.id,score});}return results.sort((a,b)=>b.score-a.score).slice(0,limit);}
}
module.exports={Workbench};
