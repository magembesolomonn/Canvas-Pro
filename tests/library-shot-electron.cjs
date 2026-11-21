process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-shot-'+Date.now();
const fs=require('node:fs'),path=require('node:path');
const {app}=require('electron');
const {Library}=require('../electron/library.cjs');
require('../electron/main.cjs');
const out=process.argv[2]||'/private/tmp/canvas-library.png';
(async()=>{
  await app.whenReady();
  const lib=new Library(path.join(process.env.AGAGWU_DATA_DIR,'Library'));
  for(const name of ['Square.png','Portrait.png','Landscape.png']){
    const file=path.join(__dirname,'fixtures',name);
    if(!fs.existsSync(file))continue;
    const result=await lib.importFile(file);
    lib.update(result.imported||result.duplicate,{name:name.replace('.png','')+' study.png'});
  }
  lib.close();
  const win=global.assetTestWindow;
  if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
  const js=code=>win.webContents.executeJavaScript(code);
  await js("refresh();setView('all')");
  await new Promise(r=>setTimeout(r,900));
  fs.writeFileSync(out.replace(/\.png$/,'-library.png'),(await win.webContents.capturePage()).toPNG());
  await js("api.appearanceSet({theme:'light'})");
  await new Promise(r=>setTimeout(r,600));
  const light=await js(`(()=>{const s=getComputedStyle($('.sidebar')),m=getComputedStyle($('main')),c=getComputedStyle(document.body);return {sidebar:s.backgroundColor,work:m.backgroundColor,window:c.backgroundColor};})()`);
  console.log('LIGHT_COLOURS',JSON.stringify(light));
  app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);}).finally(()=>{fs.rmSync(process.env.AGAGWU_DATA_DIR,{recursive:true,force:true});});
