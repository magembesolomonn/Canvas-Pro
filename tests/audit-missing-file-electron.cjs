// A managed original deleted in Finder must leave the library too. The record
// goes to Trash, remembers why, and comes back if the file is put back.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-audit-missing-'+Date.now();
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),electron=require('electron'),{app}=electron,{Library}=require('../electron/library.cjs');
electron.dialog.showMessageBox=async()=>({response:1});
require('../electron/main.cjs');
const waitFor=async(check,timeout=5000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await check())return true;await new Promise(r=>setTimeout(r,25));}return false;};
(async()=>{
  const root=path.join(process.env.AGAGWU_DATA_DIR,'Library');
  const lib=new Library(root);
  const source=path.join(process.env.AGAGWU_DATA_DIR,'missing.txt');
  fs.writeFileSync(source,'missing original');
  const id=(await lib.importFile(source)).imported;
  const original=lib.file(id);
  fs.unlinkSync(original);

  await app.whenReady();
  const win=global.assetTestWindow;
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
  const run=s=>win.webContents.executeJavaScript(s);
  await run('refresh()');

  // The watcher itself, not a manual scan, must notice the file disappear.
  assert.ok(await waitFor(()=>lib.asset(id).missing===1),'the watcher did not move a deleted original to Trash');
  assert.equal(lib.asset(id).trash,1,'a deleted original did not move its item to Trash');
  assert.ok(await waitFor(()=>run(`assetById.get('${id}')?.trash===1`)),'the window did not update after the original vanished');
  await run(`api.contextMenu(['${id}'])`);
  assert.ok(global.canvasFileMenu.getMenuItemById('delete-permanently'));
  assert.equal(global.canvasFileMenu.getMenuItemById('trash'),null,'a missing item must not offer Move to Trash again');

  // Putting the file back in Finder brings the item back automatically.
  fs.writeFileSync(original,fs.readFileSync(source));
  assert.ok(await waitFor(()=>lib.asset(id).missing===0),'the watcher did not notice the restored original');
  assert.equal(lib.asset(id).trash,0,'a restored original did not bring its item back');
  assert.ok(await waitFor(()=>run(`assetById.get('${id}')?.trash===0`)),'the window did not update after the original returned');

  // Delete it again and remove the record through the normal Trash command.
  fs.unlinkSync(original);
  assert.ok(await waitFor(()=>lib.asset(id).missing===1),'the watcher did not notice the second deletion');
  await run(`api.contextMenu(['${id}'])`);
  assert.ok(global.canvasFileMenu.getMenuItemById('delete-permanently'));
  await run(`deleteSelectedPermanently(['${id}'])`);
  assert.equal(lib.list().length,0);
  console.log('MISSING_ORIGINAL_AUTO_TRASH_RESTORE_DELETE_OK');
  lib.close();
  app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
