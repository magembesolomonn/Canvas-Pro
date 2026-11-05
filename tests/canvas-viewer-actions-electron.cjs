const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,ipcMain}=require('electron');
const workspace=path.resolve(__dirname,'..'),root=fs.mkdtempSync('/private/tmp/canvas-copy-preview-');
process.env.ASSET_TEST_MODE='1';process.env.AGAGWU_DATA_DIR=root;
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
const main=process.env.CANVAS_AUDIT_MAIN||path.join(workspace,'electron/main.cjs');
const {Library}=require(path.join(path.dirname(main),'library.cjs'));
const {CanvasStore}=require(path.join(path.dirname(main),'canvas-store.cjs'));
const requests=[],handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,listener)=>handle(name,name==='copy-files'?(_,ids)=>{requests.push(ids);}:listener);
require(main);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(check){for(let i=0;i<200;i++){const value=await check();if(value)return value;await wait(25);}throw Error('Timed out');}
(async()=>{
 const library=new Library(path.join(root,'Library')),ids=[];
 for(const name of ['First','Second']){
  const source=path.join(root,name+'.txt');fs.writeFileSync(source,name);
  ids.push((await library.importFile(source)).imported);
 }
 const store=new CanvasStore(library),board=store.create('Preview command audit');
 store.addAssets(board.id,ids);library.close();
 await app.whenReady();
 const win=global.assetTestWindow;
 if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
 const run=code=>win.webContents.executeJavaScript(code);
 win.webContents.setBackgroundThrottling(false);
 await poll(()=>run("!!document.querySelector('#canvas-navigation button')"));
 await run(`select('${ids[0]}');select('${ids[1]}',{metaKey:true});`);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'C',modifiers:['meta']});
 win.webContents.sendInputEvent({type:'keyUp',keyCode:'C',modifiers:['meta']});
 await poll(()=>requests.length);
 assert.deepEqual(requests.shift(),ids);
 console.log('GALLERY_COPY_SELECTION',JSON.stringify(['First.txt','Second.txt']));
 await run("document.querySelector('#canvas-navigation button').click()");
 await poll(()=>run("CanvasWorkspace.doc?.items.size===2"));
 await run(`CanvasWorkspace.select([[...CanvasWorkspace.doc.items.values()].find(item=>item.assetId==='${ids[0]}').id]);CanvasWorkspace.previewSelected()`);
 await poll(()=>run("document.querySelector('#preview').getAttribute('aria-label')==='Preview: First.txt'"));
 function key(keyCode,modifiers=[]){
  win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
  win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
 }
 key('Right');
 await poll(()=>run("document.querySelector('#preview').getAttribute('aria-label')==='Preview: Second.txt'"));
 key('C',['meta']);
 await poll(()=>requests.length);
 const actual=requests[0].map(id=>id===ids[0]?'First.txt':id===ids[1]?'Second.txt':id);
 console.log('CANVAS_PREVIEW_COPY',JSON.stringify({showing:'Second.txt',copyRequested:actual}));
 const rect=await run("document.querySelector('#preview-content').getBoundingClientRect().toJSON()");
 const x=Math.round(rect.x+20),y=Math.round(rect.y+20);
 win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'right',clickCount:1});
 win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'right',clickCount:1});
 await poll(()=>global.canvasFileMenu);
 global.canvasFileMenu.getMenuItemById('trash').click();
 const changed=await poll(async()=>{
  const assets=await run('api.list().then(r=>r.assets)');
  const trashed=assets.find(a=>a.trash);
  return trashed?.name;
 });
 console.log('CANVAS_PREVIEW_MENU_TRASH',JSON.stringify({showing:'Second.txt',trashed:changed}));
 assert.deepEqual([actual,changed],[['Second.txt'],'Second.txt']);
 const broken=path.join(root,'broken.xyz');
 fs.writeFileSync(broken,'no preview available');
 const imported=await run(`api.importPaths([${JSON.stringify(broken)}],null)`);
 const lateError=await run(`(async()=>{
  closePreview();setView('all');await refresh();
  select('${imported.ids[0]}');openPreview();
  const previous=$('#preview-content img');
  select('${ids[0]}');renderPreview();
  previous.dispatchEvent(new Event('error'));
  return {current:$('#preview').getAttribute('aria-label'),textVisible:!!$('#preview-content .text-preview')};
 })()`);
 assert.deepEqual(lateError,{current:'Preview: First.txt',textVisible:true});
 console.log('LATE_PREVIEW_ERROR',JSON.stringify(lateError));
 app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
