const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {app}=require('electron'),{Library}=require('../electron/library.cjs');
const root=fs.mkdtempSync('/private/tmp/canvas-navigation-');
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR=root;
process.on('exit',()=>fs.rmSync(root,{recursive:true,force:true}));
require('../electron/main.cjs');

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(check){
 // The same patience as the canvas suite: a busy machine needs more than
 // five seconds to open the editor.
 for(let i=0;i<600;i++){const value=await check();if(value)return value;await wait(20);}
 throw Error('Navigation test timed out');
}
(async()=>{
 const library=new Library(path.join(root,'Library'));
 const id=(await library.importFile(path.join(__dirname,'fixtures','Landscape.png'))).imported;
 const asset=library.asset(id);
 library.addFolder('References');
 const insert=library.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,created,imported,folders) VALUES(?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<360;i++)insert.run(crypto.randomUUID(),'Fixture '+i+'.png',asset.ext,asset.size,'fixture-'+i,asset.stored,asset.created,asset.imported,'["References"]');
 library.close();
 await app.whenReady();
 const win=global.assetTestWindow;
 win.setSize(960,640);
 win.webContents.setBackgroundThrottling(false);
 if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
 const run=code=>win.webContents.executeJavaScript(code);
 const loaded=()=>run('catalogKey===JSON.stringify(catalogQuery())&&!catalogLoading');
 await poll(loaded);
 assert.equal(await run('assets.length'),120);
 await run("$('#gallery').scrollTop=$('#gallery').scrollHeight;renderWindow()");
 await poll(()=>run('assets.length===240&&!catalogLoading'));
 await run("$('#gallery').scrollTop=layout.positions[155].y;renderWindow()");
 const allTop=await run("$('#gallery').scrollTop");
 await run("setView('folder','References')");
 await poll(loaded);
 await run("$('#gallery').scrollTop=layout.positions[47].y;renderWindow()");
 const folderTop=await run("$('#gallery').scrollTop");
 await run("setView('all')");
 await poll(loaded);
 assert.ok(Math.abs(await run("$('#gallery').scrollTop")-allTop)<3);
 await run("setView('folder','References')");
 await poll(loaded);
 assert.ok(Math.abs(await run("$('#gallery').scrollTop")-folderTop)<3);
 await run("setView('tags')");
 await poll(loaded);
 assert.equal(await run("$('#empty h2').textContent"),'No tags yet');
 assert.equal(await run('visible.length'),0);
 await run(`(async()=>{await api.bulkUpdate(['${id}'],{type:'tags',tags:['sample']});await refreshCurrent();})()`);
 assert.deepEqual(await run('visible.map(a=>a.id)'),[id]);
 console.log('GALLERY_POSITION_AND_TAGS_OK');

 await run("(async()=>{const board=await api.canvasCreate('Editing audit');await CanvasWorkspace.open(board.id);})()");
 await poll(()=>run("!!CanvasWorkspace.doc"));
 const rect=await run("$('#canvas-viewport').getBoundingClientRect().toJSON()");
 async function click(x,y,count=1){
  win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:count});
  await wait(25);
  win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:count});
  await wait(35);
 }
 for(const [tool,dx,dy] of [['text',40,50],['sticky',350,55],['list',60,250]]){
  const x=Math.round(rect.x+dx),y=Math.round(rect.y+dy);
  await run(`document.querySelector('[data-canvas-tool="${tool}"]').click()`);
  await click(x,y);
  await poll(()=>run("document.activeElement?.matches('.board-text[contenteditable=true]')"));
  const itemId=await run('CanvasWorkspace.editing.id');
  if(tool==='text')await run("document.execCommand('insertText',false,'Original text')");
  if(tool==='list')assert.equal(await run('window.getSelection().toString()'),'First item');
  await run("document.activeElement.blur()");
  await click(x+14,y+14,1);
  await click(x+14,y+14,2);
  await poll(()=>run(`CanvasWorkspace.editing?.id==='${itemId}'`));
  await run("document.execCommand('insertText',false,' edited');document.activeElement.blur()");
  assert.match(await run(`CanvasWorkspace.doc.items.get('${itemId}').data.text`),/ edited$/);
 }
 await run("document.querySelector('[data-canvas-tool=arrow]').click()");
 const x=Math.round(rect.x+15),y=Math.round(rect.y+200);
 win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
 await poll(()=>run("CanvasWorkspace.gesture?.type==='stroke'"));
 win.webContents.sendInputEvent({type:'mouseMove',x:x+170,y:y+12,button:'left'});
 await wait(70);
 assert.equal(await run("document.querySelectorAll('.canvas-snap-guide:not([hidden])').length"),0);
 win.webContents.sendInputEvent({type:'mouseUp',x:x+170,y:y+12,button:'left',clickCount:1});
 await poll(()=>run("!CanvasWorkspace.gesture"));
 const zoom=await run('CanvasWorkspace.doc.camera.zoom');
 await run("$('#canvas-zoom-in').click()");
 assert.ok(await run('CanvasWorkspace.doc.camera.zoom')>zoom);
 await run("$('#canvas-zoom-out').click();$('#canvas-fit').click();$('#canvas-undo').click()");
 assert.equal(await run("[...CanvasWorkspace.doc.items.values()].filter(item=>item.data.shape==='arrow').length"),0);
 await run("$('#canvas-redo').click();$('#canvas-library').click()");
 assert.equal(await run("$('#canvas-tray').hidden"),false);
 await run("$('#canvas-tray-close').click()");
 assert.equal(await run("$('#canvas-tray').hidden"),true);
 await run('CanvasWorkspace.flushAll()');
 const board=await run('api.canvasGet(CanvasWorkspace.doc.board.id)');
 assert.equal(board.items.filter(item=>item.data.text?.endsWith(' edited')).length,3);
 assert.equal(board.items.filter(item=>item.data.shape==='arrow').length,1);
 console.log('CANVAS_REAL_DOUBLE_CLICK_AND_ARROW_OK');
 const revealed=await run(`(async()=>{
  const target='${id}',boardId=CanvasWorkspace.doc.board.id;
  const {items}=await CanvasWorkspace.addAssets(boardId,[target])||{items:[]};
  const placement=items[0]||[...CanvasWorkspace.doc.items.values()].find(item=>item.assetId===target);
  const reveal=async()=>{
   const button=[...$('#inspector').querySelectorAll('button')].find(button=>button.textContent==='Show in library');
   button.click();
   await new Promise(resolve=>requestAnimationFrame(resolve));
   const gallery=$('#gallery'),position=layout.byId.get(target);
   return {selected:selected===target,inViewport:!!position&&position.y>=gallery.scrollTop&&position.y<gallery.scrollTop+gallery.clientHeight};
  };
  const unfiltered=await reveal();
  await CanvasWorkspace.open(boardId);
  CanvasWorkspace.select([placement.id]);
  $('#type').value='video';
  return {unfiltered,filtered:await reveal()};
 })()`);
 console.log('CANVAS_SHOW_IN_LIBRARY',JSON.stringify(revealed));
 assert.deepEqual(revealed,{unfiltered:{selected:true,inViewport:true},filtered:{selected:true,inViewport:true}});
 app.quit();
})().catch(error=>{console.error(error);app.exit(1);});
