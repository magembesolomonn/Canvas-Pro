const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Library}=require('../electron/library.cjs');
const {createOriginalsWatch}=require('../electron/originals-watch.cjs');

const waitFor=async(check,timeout=4000)=>{const start=Date.now();while(Date.now()-start<timeout){if(check())return true;await new Promise(resolve=>setTimeout(resolve,20));}return false;};

test('a managed original deleted in Finder moves to Trash and returns with the file',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-missing-'));
  let lib;
  try{
    lib=new Library(path.join(temp,'library'));
    const source=path.join(temp,'photo.png');
    fs.writeFileSync(source,'original bytes');
    const {imported:id}=await lib.importFile(source);
    const original=lib.file(id);
    fs.unlinkSync(original);
    assert.throws(()=>lib.file(id),/missing from this library/);
    assert.equal(lib.markMissing(id),true);
    assert.equal(lib.asset(id).trash,1);
    assert.equal(lib.asset(id).missing,1);
    assert.equal(lib.markMissing(id),false,'marking the same item twice must not change it again');
    assert.throws(()=>lib.update(id,{trash:false}),/missing from this library/,'a missing item must not be restored without its file');
    fs.writeFileSync(original,'original bytes');
    assert.equal(lib.markPresent(id),true);
    assert.equal(lib.asset(id).trash,0);
    assert.equal(lib.asset(id).missing,0);
    assert.equal(lib.markPresent(id),false);
  }finally{
    lib?.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('a file the person moved to Trash here is not treated as missing',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-missing-user-trash-'));
  let lib;
  try{
    lib=new Library(path.join(temp,'library'));
    const source=path.join(temp,'photo.png');
    fs.writeFileSync(source,'original bytes');
    const {imported:id}=await lib.importFile(source);
    const original=lib.file(id);
    lib.update(id,{trash:true});
    fs.unlinkSync(original);
    assert.equal(lib.markMissing(id),false);
    assert.equal(lib.asset(id).missing,0);
    fs.writeFileSync(original,'original bytes');
    assert.equal(lib.markPresent(id),false,'the person’s own Trash choice must not be undone');
    assert.equal(lib.asset(id).trash,1);
  }finally{
    lib?.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('importing the same file again puts a missing original back',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-missing-reimport-'));
  let lib;
  try{
    lib=new Library(path.join(temp,'library'));
    const source=path.join(temp,'photo.png');
    fs.writeFileSync(source,'original bytes');
    const {imported:id}=await lib.importFile(source);
    fs.unlinkSync(lib.file(id));
    lib.markMissing(id);
    const again=await lib.importFile(source);
    assert.equal(again.duplicate,id);
    assert.equal(lib.asset(id).trash,0);
    assert.equal(lib.asset(id).missing,0);
    assert.equal(fs.readFileSync(lib.file(id),'utf8'),'original bytes');
  }finally{
    lib?.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});

test('the originals watcher notices a deletion and a restore',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-originals-watch-'));
  let lib,watch;
  try{
    lib=new Library(path.join(temp,'library'));
    const source=path.join(temp,'photo.png');
    fs.writeFileSync(source,'original bytes');
    const {imported:id}=await lib.importFile(source);
    const original=lib.file(id);
    const changed=[];
    watch=createOriginalsWatch({library:lib,onChange:ids=>changed.push(...ids),debounce:25});
    assert.equal(watch.watching,true);
    await new Promise(resolve=>setTimeout(resolve,80));
    fs.unlinkSync(original);
    assert.ok(await waitFor(()=>lib.asset(id).missing===1),'the watcher did not notice the deleted original');
    fs.writeFileSync(original,'original bytes');
    assert.ok(await waitFor(()=>lib.asset(id).missing===0),'the watcher did not notice the restored original');
    assert.deepEqual([...new Set(changed)],[id]);
  }finally{
    watch?.close();
    lib?.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
