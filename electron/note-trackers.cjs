const { randomUUID } = require('node:crypto');
const idPattern = /^[a-f0-9-]{36}$/;
const fieldTypes = ['text', 'number', 'money', 'date', 'url', 'file', 'canvas'];
const presets = {
  movies: ['Movies & Series', [['Type'], ['Year','number'], ['Genre'], ['My rating','number'], ['Season','number'], ['Episode','number'], ['Source','url'], ['Poster','file']], ['Watchlist','Watching','Watched'], 'gallery'],
  roadmap: ['Feature roadmap', [['Priority'], ['Owner'], ['Target date','date'], ['Canvas','canvas'], ['Reference','file']], ['Planned','In progress','Shipped'], 'board'],
  videos: ['Video production', [['Publish date','date'], ['Thumbnail','file'], ['Reference','url']], ['Idea','Scripting','Production','Ready','Published'], 'board'],
  transactions: ['Transactions', [['Date','date'], ['Category'], ['Amount','money'], ['Receipt','file']], ['Income','Expense'], 'table'],
  budgets: ['Budgets', [['Month','date'], ['Planned','money'], ['Actual','money']], [], 'table'],
  blank: ['Tracker', [], ['To do','In progress','Done'], 'table']
};
function tracker(preset) {
  const [title, fields, statuses, layout] = presets[preset];
  const view = (name,layout,status='') => ({name,layout,status,query:'',sort:'recent',month:''});
  const views = [view(layout==='gallery'?'Gallery':layout==='board'?'Board':'Table',layout)];
  if (preset==='movies') views.push(...statuses.map(status=>view(status,'gallery',status)));
  if (layout!=='table') views.push(view('Table','table'));
  return {
    type:'tracker', id:randomUUID(), title, preset, statuses,
    fields:fields.map(([label,type='text'],i)=>({key:'f'+i,label,type})),
    views,
    active:0, nextField:fields.length, currency:''
  };
}
function cleanTracker(block) {
  if (!idPattern.test(block.id) || !Object.hasOwn(presets,block.preset)) throw Error('Invalid tracker.');
  const fields = block.fields.slice(0,12).map(({key,label,type})=>{
    if (!/^f[0-9]{1,6}$/.test(key) || !fieldTypes.includes(type)) throw Error('Invalid tracker field.');
    return {key,label:String(label).slice(0,80),type};
  });
  const statuses = [...new Set(block.statuses.map(s=>String(s).trim().slice(0,40)).filter(Boolean))].slice(0,8);
  const views = block.views.slice(0,12).map(view=>({
    name:String(view.name).trim().slice(0,60)||'View',
    layout:['table','gallery','board'].includes(view.layout)?view.layout:'table',
    query:String(view.query||'').slice(0,120),
    status:statuses.includes(view.status)?view.status:'',
    sort:['title','date','rating'].includes(view.sort)?view.sort:'recent',
    month:/^\d{4}-\d{2}$/.test(view.month)?view.month:''
  }));
  if (!views.length || new Set(fields.map(f=>f.key)).size !== fields.length) throw Error('Invalid tracker settings.');
  return {type:'tracker',id:block.id,title:String(block.title).slice(0,120),preset:block.preset,fields,statuses,views,
    active:Math.max(0,Math.min(views.length-1,Number.isInteger(block.active)?block.active:0)),
    nextField:Math.max(0,...fields.map(f=>Number(f.key.slice(1))+1),Number.isInteger(block.nextField)?block.nextField:0),
    currency:/^[A-Z]{3}$/.test(block.currency)?block.currency:''};
}
function ensureTrackerRecords(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS note_tracker_records (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL, tracker_id TEXT NOT NULL,
    title TEXT NOT NULL, status TEXT NOT NULL, properties TEXT NOT NULL,
    body TEXT NOT NULL, updated TEXT NOT NULL,
    FOREIGN KEY(note_id) REFERENCES workspace_notes(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS note_tracker_scope ON note_tracker_records(note_id,tracker_id,status,updated);`);
}
function cleanProperties(fields, raw) {
  const result = {};
  for (const {key,type} of fields) {
    const value = raw?.[key];
    if (value === undefined || value === null || value === '') continue;
    if (type === 'number' || type === 'money') {
      if (!Number.isFinite(value) || Math.abs(value)>1e12) throw Error('Enter a valid number.');
      result[key] = type === 'money' ? Math.round(value*100) : value;
    } else if (type === 'file' || type === 'canvas') {
      if (!idPattern.test(value.id)) throw Error('Invalid attachment.');
      result[key] = {id:value.id,label:String(value.label||'').slice(0,300),bookmarkCover:type==='file'&&value.bookmarkCover===true};
    } else {
      if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Enter a valid date.');
      if (type === 'url' && !/^https?:\/\//i.test(value)) throw Error('Enter a web address beginning with https:// or http://.');
      result[key] = String(value).slice(0,2000);
    }
  }
  return result;
}
class NoteTrackers {
  constructor(notes) { this.notes = notes; this.db = notes.db; }
  schema(noteId, trackerId) {
    const block = this.notes.get(noteId).blocks.find(block=>block.type==='tracker'&&block.id===trackerId);
    if (!block) throw Error('Tracker no longer exists.');
    return cleanTracker(block);
  }
  list(noteId, trackerId, input) {
    const schema = this.schema(noteId,trackerId);
    const view = cleanTracker({...schema,views:[input],active:0}).views[0];
    const date = schema.fields.find(f=>f.type==='date')?.key;
    const rating = schema.fields.find(f=>f.label==='My rating')?.key;
    const scope = ['note_id=?','tracker_id=?'], args = [noteId,trackerId];
    if (view.query) { scope.push('instr(lower(title || properties),lower(?))>0'); args.push(view.query); }
    if (view.status) { scope.push('status=?'); args.push(view.status); }
    if (view.month && date) { scope.push(`substr(json_extract(properties,'$.${date}'),1,7)=?`); args.push(view.month); }
    const order = {title:'title COLLATE NOCASE',date:date&&`json_extract(properties,'$.${date}') DESC`,
      rating:rating&&`json_extract(properties,'$.${rating}') DESC`}[view.sort] || 'updated DESC';
    const where = scope.join(' AND ');
    const offset = Number.isSafeInteger(input.offset) ? Math.max(0,input.offset) : 0;
    const records = this.db.prepare(`SELECT id,title,status,properties FROM note_tracker_records WHERE ${where}
      ORDER BY ${order}, id LIMIT 49 OFFSET ?`).all(...args,offset);
    const money = schema.fields.filter(f=>f.type==='money');
    const totals = money.length ? this.db.prepare(`SELECT status,${money.map(f=>`sum(json_extract(properties,'$.${f.key}')) AS ${f.key}`).join(',')}
      FROM note_tracker_records WHERE ${where} GROUP BY status`).all(...args) : [];
    return {rows:records.slice(0,48).map(row=>({...row,properties:JSON.parse(row.properties)})),more:records.length>48,totals};
  }
  get(noteId,trackerId,id) {
    const row = this.db.prepare('SELECT id,title,status,properties,body FROM note_tracker_records WHERE note_id=? AND tracker_id=? AND id=?').get(noteId,trackerId,id);
    if (!row) throw Error('Record no longer exists.');
    const {body,...details} = row;
    const record = {...details,properties:JSON.parse(row.properties),body};
    if (body.startsWith('canvas-record-v1:')) Object.assign(record,JSON.parse(body.slice('canvas-record-v1:'.length)));
    return record;
  }
  save(noteId,trackerId,record) {
    const schema = this.schema(noteId,trackerId);
    const title = String(record.title||'').trim().slice(0,200);
    if (!title) throw Error('Enter a title.');
    const id = record.id ? this.get(noteId,trackerId,record.id).id : randomUUID();
    const properties = cleanProperties(schema.fields,record.properties);
    const status = schema.statuses.includes(record.status)?record.status:schema.statuses[0]||'';
    const body = String(record.body||'').slice(0,40000);
    const checklist = Array.isArray(record.checklist) ? record.checklist.slice(0,30).map(item=>({
      text:String(item.text||'').trim().slice(0,300),done:item.done===true
    })).filter(item=>item.text) : [];
    this.db.prepare(`INSERT INTO note_tracker_records VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,properties=excluded.properties,
      body=excluded.body,updated=excluded.updated`).run(id,noteId,trackerId,title,status,JSON.stringify(properties),
        'canvas-record-v1:'+JSON.stringify({body,checklist}),new Date().toISOString());
    return id;
  }
  setThumbnail(noteId,trackerId,recordId,assetId) {
    const schema = this.schema(noteId,trackerId);
    if (schema.preset!=='videos'||!schema.fields.some(field=>field.key==='f1'&&field.type==='file'))
      throw Error('This tracker has no thumbnail field.');
    const asset = this.notes.db.prepare('SELECT id,name FROM assets WHERE id=? AND trash=0').get(assetId);
    if (!asset) throw Error('This image is no longer available.');
    const attachment = JSON.stringify({id:asset.id,label:asset.name.slice(0,300)});
    const result = this.db.prepare(`UPDATE note_tracker_records SET properties=json_set(properties,'$.f1',json(?)),
      updated=? WHERE note_id=? AND tracker_id=? AND id=?`).run(attachment,new Date().toISOString(),noteId,trackerId,recordId);
    if (!result.changes) throw Error('Record no longer exists.');
  }
  move(noteId,trackerId,id,status) {
    if (!this.schema(noteId,trackerId).statuses.includes(status)) throw Error('Invalid status.');
    const previous = this.get(noteId,trackerId,id).status;
    this.db.prepare('UPDATE note_tracker_records SET status=? WHERE id=?').run(status,id);
    return previous;
  }
  remove(noteId,trackerId,id) {
    this.db.prepare('DELETE FROM note_tracker_records WHERE note_id=? AND tracker_id=? AND id=?').run(noteId,trackerId,id);
  }
}
module.exports = {tracker,cleanTracker,ensureTrackerRecords,NoteTrackers};
