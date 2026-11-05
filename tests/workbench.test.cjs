const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Library}=require('../electron/library.cjs'),{Workbench}=require('../electron/workbench.cjs');
async function fixture(fn){const dir=fs.mkdtempSync('/private/tmp/canvas-workbench-'),lib=new Library(path.join(dir,'Library')),tools=new Workbench(lib);try{const source=path.join(dir,'original.txt');fs.writeFileSync(source,'Keep my original and metadata');const id=(await lib.importFile(source)).imported;await fn({dir,lib,tools,source,id});}finally{lib.close();fs.rmSync(dir,{recursive:true,force:true});}}
test('file and bulk undo preserve tags, favourites and collection membership',()=>fixture(async({lib,tools,id})=>{lib.addFolder('Ideas');tools.change([id],()=>lib.updateMany([id],{type:'collection',folder:'Ideas'}));tools.change([id],()=>lib.update(id,{favorite:true,tags:['test']}));tools.history();assert.equal(lib.asset(id).favorite,0);assert.deepEqual(JSON.parse(lib.asset(id).tags),[]);assert.deepEqual(JSON.parse(lib.asset(id).folders),['Ideas']);tools.history(true);assert.equal(lib.asset(id).favorite,1);tools.history();tools.history();assert.deepEqual(JSON.parse(lib.asset(id).folders),[]);}));
test('emoji choices persist in the portable library',()=>fixture(async({tools})=>{tools.icon('canvas:fixture',{type:'emoji',value:'🎨'});assert.equal(tools.icons()['canvas:fixture'].value,'🎨');}));
test('recovery rejects wrong bytes and restores the exact original without losing metadata',()=>fixture(async({lib,tools,id,source,dir})=>{lib.update(id,{tags:['keep']});const original=lib.file(id);fs.unlinkSync(original);const wrong=path.join(dir,'wrong.txt');fs.writeFileSync(wrong,'wrong');await assert.rejects(tools.recover(id,wrong),/match/);await tools.recover(id,source);assert.equal(fs.readFileSync(lib.file(id),'utf8'),'Keep my original and metadata');assert.deepEqual(JSON.parse(lib.asset(id).tags),['keep']);await assert.rejects(tools.recover(id,source),/exists/);}));
test('backup contains a consistent database, originals and presentation settings',()=>fixture(async({lib,tools,id,dir})=>{lib.update(id,{notes:'Important'});tools.icon('canvas:a',{type:'symbol',value:'star'});const dest=path.join(dir,'Backup.canvaslibrary');await tools.backup(dest);const restored=new Library(dest);try{assert.equal(restored.asset(id).notes,'Important');assert.equal(fs.readFileSync(restored.file(id),'utf8'),'Keep my original and metadata');assert.equal(new Workbench(restored).icons()['canvas:a'].value,'star');}finally{restored.close();}await assert.rejects(tools.backup(path.join(lib.root,'nested')),/outside/);assert.ok(tools.pref('lastBackup').at);}));
test('duplicate review groups high-similarity candidates without deleting anything',()=>fixture(async({lib,tools,id,dir})=>{const source=path.join(dir,'second.txt');fs.writeFileSync(source,'A distinct original');const second=(await lib.importFile(source)).imported;const vector=Buffer.from(new Float32Array(Array.from({length:512},(_,i)=>i===0?1:0)).buffer),insert=lib.db.prepare('INSERT INTO asset_analysis(id,vector,model,version) VALUES(?,?,?,1)');for(const key of [id,second])insert.run(key,vector,'clip-vit-base-patch32-q8-v1');const groups=await tools.duplicates();assert.equal(groups.length,1);assert.equal(groups[0][1].score,1);assert.equal(lib.list().length,2);}));
test('undo changes only edited fields, retaining unrelated metadata enrichment',()=>fixture(async({lib,tools,id})=>{tools.change([id],()=>lib.update(id,{favorite:true}));lib.update(id,{notes:'Written after the favourite action'});tools.history();assert.equal(lib.asset(id).favorite,0);assert.equal(lib.asset(id).notes,'Written after the favourite action');}));
test('backup never overwrites an existing destination and close waits for a running copy',()=>fixture(async({tools,dir})=>{const existing=path.join(dir,'Existing');fs.mkdirSync(existing);fs.writeFileSync(path.join(existing,'keep.txt'),'keep');await assert.rejects(tools.backup(existing));assert.equal(fs.readFileSync(path.join(existing,'keep.txt'),'utf8'),'keep');const task=tools.backup(path.join(dir,'Second.canvaslibrary'));await tools.close();await task;assert.equal(tools.backingUp,false);}));

test('legacy captures and collection rules survive opening the library', () => fixture(async ({lib,id}) => {
  lib.db.exec(`ALTER TABLE assets ADD COLUMN inbox INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE saved_searches(id TEXT PRIMARY KEY, name TEXT, rules TEXT);
    INSERT INTO saved_searches VALUES ('legacy','Earlier collection','{}');`);
  lib.db.prepare('UPDATE assets SET inbox=1 WHERE id=?').run(id);
  lib.setCaptureMetadata(id,{kind:'image',pageUrl:'https://example.com/image'});
  const reopened=new Library(lib.root);
  try {
    new Workbench(reopened);
    const [asset]=reopened.page().assets;
    assert.equal(asset.id,id);
    assert.equal(asset.captureMetadata.pageUrl,'https://example.com/image');
    assert.equal(asset.inbox,1);
    assert.equal(reopened.db.prepare('SELECT name FROM saved_searches').get().name,'Earlier collection');
  } finally {
    reopened.close();
  }
}));
