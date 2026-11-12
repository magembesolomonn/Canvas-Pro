// Capture the library view so the design can be compared before and after.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-shot-'+Date.now();
const fs=require('node:fs'),path=require('node:path');
const {app}=require('electron');
const {Library}=require('../electron/library.cjs');
require('../electron/main.cjs');
const out=process.argv[2]||'/private/tmp/canvas-library.png';
(async()=>{
  await app.whenReady();
  // A small library so the grid shows real tiles.
  const lib=new Library(path.join(process.env.AGAGWU_DATA_DIR,'Library'));
  const fixtures=['Square.png','Portrait.png','Landscape.png'];
  for(const name of fixtures){
    const file=path.join(__dirname,'fixtures',name);
    if(!fs.existsSync(file))continue;
    const result=await lib.importFile(file);
    const id=result.imported||result.duplicate;
    lib.update(id,{name:name.replace('.png','')+' study.png'});
  }
  lib.close();
  const win=global.assetTestWindow;
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
  await win.webContents.executeJavaScript("refresh();setView('all')");
  await new Promise(r=>setTimeout(r,1200));
  fs.writeFileSync(out,(await win.webContents.capturePage()).toPNG());
  console.log('SHOT',out);
  app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);}).finally(()=>{fs.rmSync(process.env.AGAGWU_DATA_DIR,{recursive:true,force:true});});
