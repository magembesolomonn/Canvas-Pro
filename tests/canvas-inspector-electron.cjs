const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app}=require('electron'),root=fs.mkdtempSync('/private/tmp/canvas-inspector-test-');
process.env.ASSET_TEST_MODE='1';process.env.AGAGWU_DATA_DIR=root;
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
const source=process.env.CANVAS_TEST_ROOT||path.resolve(__dirname,'..');
require(path.join(source,'electron/main.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn){for(let n=0;n<100;n++){if(await fn())return;await wait(25);}throw Error('wait timeout');}
(async()=>{
 const {Library}=require(path.join(source,'electron/library.cjs'));
 const library=new Library(path.join(root,'Library'));
 const sourceFile=path.join(root,'target.txt');
 fs.writeFileSync(sourceFile,'Find me');
 const target=(await library.importFile(sourceFile)).imported;
 const asset=library.asset(target);
 const insert=library.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,created,imported) VALUES(?,?,?,?,?,?,?,?)');
 for(let n=0;n<160;n++)insert.run('reveal-'+n,'Reference '+n+'.txt','txt',asset.size,'fixture'+n,asset.stored,asset.created,asset.imported);
 library.close();
 await app.whenReady();
 const win=global.assetTestWindow;win.webContents.setBackgroundThrottling(false);
 if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
 const run=s=>win.webContents.executeJavaScript(s);
 await run("(async()=>{await refresh();const board=await api.canvasCreate('Inspector audit');await CanvasWorkspace.open(board.id);window.fixture=CanvasWorkspace.add('text',{x:125,y:75}).id;})()");
 await poll(()=>run("CanvasWorkspace.nodes.has(fixture)"));
 const point=await run("(()=>{const r=CanvasWorkspace.nodes.get(fixture).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
 const event=(type,button='left')=>win.webContents.sendInputEvent({type,...point,button,clickCount:1});
 await run("CanvasWorkspace.setLocked(true)");
 event('mouseDown','right');event('mouseUp','right');
 await poll(()=>run("!!$('#canvas-item-menu')?.matches(':popover-open')"));
 const offered=await run("[...$('#canvas-item-menu').querySelectorAll('button')].some(button=>button.textContent==='Edit text')");
 await run("[...$('#canvas-item-menu').querySelectorAll('button')].find(button=>button.textContent==='Edit text')?.click()");
 const opened=await run("!!CanvasWorkspace.editing");
 console.log('CANVAS_LOCKED_EDIT_ACTION',JSON.stringify({offered,opened}));
 await run("CanvasWorkspace.setLocked(false);$('#inspector input[aria-label=\"Canvas x\"]').focus()");
 for(const [keyCode,modifiers] of [['End',[]],['Backspace',[]],['Backspace',[]],['Backspace',[]],['Tab',[]]]){
  for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});
  await wait(25);
 }
 const after=await run("CanvasWorkspace.doc.items.get(fixture).data.x");
 console.log('CANVAS_BLANK_X_INPUT',JSON.stringify({before:125,after}));
 assert.equal(after,125);
 assert.equal(offered,false);
 const reveal=await run(`(async()=>{
   $('#sort').value='name';
   const board=CanvasWorkspace.doc.board.id;
   const target=${JSON.stringify(target)};
   await CanvasWorkspace.addAssets(board,[target]);
   const item=[...CanvasWorkspace.doc.items.values()].find(item=>item.assetId===target);
   const result=[];
   for(const type of ['', 'image']){
     CanvasWorkspace.select([item.id]);
     $('#type').value=type;
     [...$('#inspector').querySelectorAll('button')].find(button=>button.textContent==='Show in library').click();
     await new Promise(requestAnimationFrame);
     const p=layout.byId.get(target),gallery=$('#gallery');
     result.push({selected:selected===target,inViewport:!!p&&p.y>=gallery.scrollTop&&p.y<gallery.scrollTop+gallery.clientHeight});
     await CanvasWorkspace.open(board);
   }
   return result;
 })()`);
 console.log('CANVAS_SHOW_IN_LIBRARY',JSON.stringify(reveal));
 assert.deepEqual(reveal,[{selected:true,inViewport:true},{selected:true,inViewport:true}]);
 app.quit();
})().catch(e=>{console.error(e.message);app.exit(1)});
