// A library that cannot be opened must say so. Before this, a throw while
// starting up ended the process with no message at all.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-startup-failure-'+Date.now();
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,dialog}=require('electron');
const seen=[];
dialog.showErrorBox=(title,content)=>{seen.push({title,content});};
const realExit=app.exit.bind(app);
app.exit=code=>{seen.push({exit:code});};
// A database that is not a database: the library cannot be opened.
const library=path.join(process.env.AGAGWU_DATA_DIR,'Library');
fs.mkdirSync(library,{recursive:true});
fs.writeFileSync(path.join(library,'library.sqlite'),'this is not a database');
require('../electron/main.cjs');
(async()=>{
  await app.whenReady();
  await new Promise(r=>setTimeout(r,800));
  console.log('STARTUP_FAILURE',JSON.stringify(seen.map(s=>s.title||('exit'+s.exit))));
  assert.ok(seen.length>0,'The app failed without telling anyone.');
  assert.ok(seen.some(s=>s.title),'The app did not show an error.');
  assert.ok(seen.some(s=>s.title&&/library/i.test(s.title)),'The error did not mention the library.');
  realExit(0);
})().catch(error=>{console.error(error.stack);realExit(1);});
