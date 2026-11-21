const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Library}=require('../electron/library.cjs'),{Workbench}=require('../electron/workbench.cjs');
async function fixture(fn){const dir=fs.mkdtempSync('/private/tmp/canvas-workbench-'),lib=new Library(path.join(dir,'Library')),tools=new Workbench(lib);try{const source=path.join(dir,'original.txt');fs.writeFileSync(source,'Keep my original and metadata');const id=(await lib.importFile(source)).imported;await fn({dir,lib,tools,source,id});}finally{lib.close();fs.rmSync(dir,{recursive:true,force:true});}}
test('file and bulk undo preserve tags, favourites and collection membership',()=>fixture(async({lib,tools,id})=>{lib.addFolder('Ideas');tools.change([id],()=>lib.updateMany([id],{type:'collection',folder:'Ideas'}));tools.change([id],()=>lib.update(id,{favorite:true,tags:['test']}));tools.history();assert.equal(lib.asset(id).favorite,0);assert.deepEqual(JSON.parse(lib.asset(id).tags),[]);assert.deepEqual(JSON.parse(lib.asset(id).folders),['Ideas']);tools.history(true);assert.equal(lib.asset(id).favorite,1);tools.history();tools.history();assert.deepEqual(JSON.parse(lib.asset(id).folders),[]);}));
test('emoji choices persist in the portable library',()=>fixture(async({tools})=>{tools.icon('canvas:fixture',{type:'emoji',value:'🎨'});assert.equal(tools.icons()['canvas:fixture'].value,'🎨');}));
test('recovery rejects wrong bytes and restores the exact original without losing metadata',()=>fixture(async({lib,tools,id,source,dir})=>{lib.update(id,{tags:['keep']});const original=lib.file(id);fs.unlinkSync(original);const wrong=path.join(dir,'wrong.txt');fs.writeFileSync(wrong,'wrong');await assert.rejects(tools.recover(id,wrong),/match/);await tools.recover(id,source);assert.equal(fs.readFileSync(lib.file(id),'utf8'),'Keep my original and metadata');assert.deepEqual(JSON.parse(lib.asset(id).tags),['keep']);await assert.rejects(tools.recover(id,source),/exists/);}));
test('backup contains a consistent database, originals and presentation settings',()=>fixture(async({lib,tools,id,dir})=>{lib.update(id,{notes:'Important'});tools.icon('canvas:a',{type:'symbol',value:'star'});const dest=path.join(dir,'Backup.canvaslibrary');await tools.backup(dest);const restored=new Library(dest);try{assert.equal(restored.asset(id).notes,'Important');assert.equal(fs.readFileSync(restored.file(id),'utf8'),'Keep my original and metadata');assert.equal(new Workbench(restored).icons()['canvas:a'].value,'star');}finally{restored.close();}await assert.rejects(tools.backup(path.join(lib.root,'nested')),/outside/);assert.ok(tools.pref('lastBackup').at);}));
async function importCopy(lib,dir,name,contents){const source=path.join(dir,name);fs.writeFileSync(source,contents);return (await lib.importFile(source)).imported;}
test('duplicate review clusters fingerprints, keeps the annotated copy and leaves files alone',()=>fixture(async({lib,tools,id,dir})=>{
  const second=await importCopy(lib,dir,'second.txt','A second version');
  const third=await importCopy(lib,dir,'third.txt','A third version, with a note');
  const other=await importCopy(lib,dir,'other.txt','An unrelated picture');
  lib.setPhash(id,'0f0f0f0f0f0f0f0f');
  lib.setPhash(second,'0f0f0f0f0f0f0f0e');
  lib.setPhash(third,'0f0f0f0f0f0f0f0c');
  lib.setPhash(other,'f0f0f0f0f0f0f0f0');
  lib.update(third,{notes:'Colour-corrected'});
  const result=await tools.duplicates();
  assert.equal(result.groups.length,1);
  const [group]=result.groups;
  assert.deepEqual(group.members.map(m=>m.id).sort(),[id,second,third].sort());
  assert.equal(group.keep,third,'the copy with notes is kept');
  assert.equal(group.kind,'near');
  assert.equal(group.bits,1);
  assert.equal(group.similarity,98);
  assert.ok(group.savings>0);
  assert.equal(lib.list().length,4,'review never removes anything');
}));
test('duplicate review forgets a dismissed group until the library changes',()=>fixture(async({lib,tools,id,dir})=>{
  const second=await importCopy(lib,dir,'second.txt','Another copy');
  lib.setPhash(id,'0f0f0f0f0f0f0f0f');
  lib.setPhash(second,'0f0f0f0f0f0f0f0e');
  const [group]=(await tools.duplicates()).groups;
  tools.dismissDuplicates(group.members.map(m=>m.id));
  assert.deepEqual((await tools.duplicates()).groups,[]);
  const third=await importCopy(lib,dir,'third.txt','A later copy');
  lib.setPhash(third,'0f0f0f0f0f0f0f0c');
  const again=(await tools.duplicates()).groups;
  assert.equal(again.length,1);
  assert.equal(again[0].members.length,3);
  assert.throws(()=>tools.dismissDuplicates([id]),/group/);
}));
test('duplicate review compares only non-empty fingerprints and reports pending work',()=>fixture(async({lib,tools,id,dir})=>{
  const failed=await importCopy(lib,dir,'failed.txt','Undecodable');
  const unchecked=await importCopy(lib,dir,'unchecked.txt','Not looked at yet');
  lib.setPhash(id,'0f0f0f0f0f0f0f0f');
  lib.setPhash(failed,'');
  const result=await tools.duplicates();
  assert.deepEqual(result.groups,[]);
  assert.equal(result.total,1);
  assert.equal(result.pending,0);
  lib.db.prepare("UPDATE assets SET ext='jpg' WHERE id=?").run(unchecked);
  assert.equal((await tools.duplicates()).pending,1);
}));
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

test('restoring a backup preserves board references and captured file metadata',()=>fixture(async({lib,tools,id,dir})=>{
  const {CanvasStore}=require('../electron/canvas-store.cjs');
  const boards=new CanvasStore(lib);
  const board=boards.create('Client references');
  boards.addAssets(board.id,[id]);
  lib.update(id,{tags:['packaging'],notes:'Use this direction'});
  lib.setCaptureMetadata(id,{kind:'image',pageUrl:'https://example.com/reference'});
  const backup=path.join(dir,'Client backup.canvaslibrary');
  await tools.backup(backup);
  const copy=path.join(dir,'Restored.canvaslibrary');
  fs.cpSync(backup,copy,{recursive:true});
  const restored=new Library(copy);
  try{
    const item=new CanvasStore(restored).get(board.id).items[0];
    const asset=restored.page().assets.find(asset=>asset.id===item.assetId);
    assert.deepEqual(asset.tags,['packaging']);
    assert.equal(asset.notes,'Use this direction');
    assert.equal(asset.captureMetadata.pageUrl,'https://example.com/reference');
    assert.deepEqual(fs.readFileSync(restored.file(asset.id)),fs.readFileSync(lib.file(id)));
  }finally{restored.close();}
}));
