process.env.ASSET_TEST_MODE='1';process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-lifecycle-'+Date.now();const electron=require('electron'),{app}=electron,assert=require('node:assert/strict'),path=require('node:path'),{Library}=require('../electron/library.cjs'),{CanvasStore}=require('../electron/canvas-store.cjs');const messages=[];electron.dialog.showErrorBox=(title,message)=>messages.push({title,message});require(process.env.ASSET_LIBRARY_MAIN||'../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));async function poll(fn){for(let i=0;i<250;i++){const result=await fn();if(result)return result;await wait(20);}throw Error('Canvas lifecycle timed out');}let lib;
(async()=>{await app.whenReady();lib=new Library(path.join(process.env.AGAGWU_DATA_DIR,'Library'));const store=new CanvasStore(lib);let win=global.assetTestWindow;async function ready(){win=global.assetTestWindow;win.webContents.setBackgroundThrottling(false);if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));await win.webContents.executeJavaScript('refresh()');}await ready();let run=s=>win.webContents.executeJavaScript(s);const board=await run("api.canvasCreate('Save safety')");await run(`(async()=>{await refresh();await CanvasWorkspace.open('${board.id}');CanvasWorkspace.add('text',{x:10,y:20});})()`);const textId=await run('CanvasWorkspace.doc.items.values().next().value.id');await run(`(()=>{const item=CanvasWorkspace.doc.items.get('${textId}');item.data.text='Saved before closing';CanvasWorkspace.stage(CanvasWorkspace.doc,[item]);})()`);win.close();await poll(()=>win.isDestroyed());assert.equal(store.get(board.id).items[0].data.text,'Saved before closing');assert.equal(messages.length,0);console.log('CANVAS_CLOSE_FLUSH_OK');app.emit('activate');await poll(()=>global.assetTestWindow!==win);await ready();run=s=>win.webContents.executeJavaScript(s);await run(`CanvasWorkspace.open('${board.id}')`);assert.equal(await run(`CanvasWorkspace.doc.items.get('${textId}').data.text`),'Saved before closing');
 await run(`CanvasWorkspace.fit(['${textId}'])`);
 await poll(()=>run(`!!CanvasWorkspace.nodes.get('${textId}')?.querySelector('.board-text')`));
 await run('CanvasWorkspace.flushAll()');
 const fs=require('node:fs');
 for(const theme of ['light','dark']){
  electron.nativeTheme.themeSource=theme;
  await poll(()=>run(`document.body.classList.contains('light-mode')===${theme==='light'}`));
  const text=await run(`(async()=>{
   const item=CanvasWorkspace.nodes.get('${textId}').querySelector('.board-text');
   const color=getComputedStyle(document.body).getPropertyValue('--text').trim();
   const {svg}=await CanvasExport.build();
   const rgb=color.slice(1).match(/../g).map(value=>parseInt(value,16));
   return {screen:getComputedStyle(item).color==='rgb('+rgb.join(', ')+')',export:svg.includes('fill="'+color+'"')};
  })()`);
  assert.deepEqual(text,{screen:true,export:true});
 }
 console.log('CANVAS_DEFAULT_TEXT_FOLLOWS_THEME_OK');
 const file=path.join(process.env.AGAGWU_DATA_DIR,'large-export.pdf');
 electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
 const pdf=await run(`api.canvasExport({
  format:'pdf',name:'Large export',width:800,height:600,
  svg:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="red"/><!--'+'x'.repeat(3_000_000)+'--></svg>'
 })`);
 assert.equal(pdf.saved,true);
 assert.equal(fs.readFileSync(file).subarray(0,5).toString(),'%PDF-');
 console.log('CANVAS_LARGE_PDF_OK');
 const original=global.canvasTestStore.apply.bind(global.canvasTestStore);global.canvasTestStore.apply=()=>{throw Error('Fixture disk write failure');};await run(`(()=>{const item=CanvasWorkspace.doc.items.get('${textId}');item.data.text='Recoverable edit';CanvasWorkspace.stage(CanvasWorkspace.doc,[item]);})()`);await wait(300);await poll(()=>run("$('#canvas-retry').hidden===false"));win.close();await poll(()=>messages.length>0);assert.equal(win.isDestroyed(),false);assert.equal(store.get(board.id).items[0].data.text,'Saved before closing');assert.equal(await run("$('main').inert"),false);global.canvasTestStore.apply=original;await run("$('#canvas-retry').click()");await poll(()=>store.get(board.id).items[0].data.text==='Recoverable edit');console.log('CANVAS_FAILED_SAVE_RETRY_OK');
  // A canvas deleted behind the app's back must not keep the app from closing.
  const before=messages.length;
  const doomed=await run("api.canvasCreate('Doomed')");
  await run(`(async()=>{await refresh();await CanvasWorkspace.open('${doomed.id}');CanvasWorkspace.add('text',{x:10,y:20});})()`);
  const doomedItem=await run('CanvasWorkspace.doc.items.values().next().value.id');
  await run(`(()=>{const item=CanvasWorkspace.doc.items.get('${doomedItem}');item.data.text='Vanishing edit';CanvasWorkspace.stage(CanvasWorkspace.doc,[item]);})()`);
  store.remove(doomed.id);
  await run(`CanvasWorkspace.flushAll()`);
  assert.equal(messages.length,before);
  assert.equal(await run(`!!CanvasWorkspace.documents.get('${doomed.id}')`),false);
  await run(`(async()=>{await CanvasWorkspace.open('${board.id}');})()`);
  console.log('CANVAS_DELETED_CANVAS_DOES_NOT_BLOCK_OK');
 await run(`(()=>{const item=CanvasWorkspace.doc.items.get('${textId}');item.data.text='Saved on quit';CanvasWorkspace.stage(CanvasWorkspace.doc,[item]);})()`);app.once('will-quit',()=>{assert.equal(store.get(board.id).items[0].data.text,'Saved on quit');console.log('CANVAS_QUIT_FLUSH_OK');lib.close();lib=null;});app.quit();})().catch(error=>{console.error('CANVAS_LIFECYCLE_FAILED',error.stack);lib?.close();app.exit(1);});
