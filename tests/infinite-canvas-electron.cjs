// Regression coverage for the infinite canvas view: seamless repeated tiling
// on both axes, full coverage at every zoom, pointer-anchored zoom, 1:1 drag,
// exact preview return, click/keyboard/context-menu interaction, and returning
// to an open canvas without losing it.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-infinite-test-'+Date.now();
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {app}=require('electron');
const {Library}=require('../electron/library.cjs');
const lib=new Library(path.join(process.env.AGAGWU_DATA_DIR,'Library'));
const png=fs.readFileSync(path.join(__dirname,'fixtures/Portrait.png'));
fs.writeFileSync(path.join(process.env.AGAGWU_DATA_DIR,'fixture.png'),png);
const insert=lib.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,created,imported) VALUES(?,?,?,?,?,?,?,?)');
for(let i=0;i<40;i++)insert.run(crypto.randomUUID(),'Image '+i+'.png','png',png.length,'fixture'+i,'../fixture.png','2020-01-01','2020-01-'+String(i+1).padStart(2,'0'));
lib.close();
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await app.whenReady();
 const win=global.assetTestWindow;
 if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
 const run=s=>win.webContents.executeJavaScript(s);
 const errors=[];
 win.webContents.on('console-message',e=>{if(e.level==='error'&&!/unsafe file location/.test(e.message))errors.push(e.message);});
 await run('refresh()');
 await win.setSize(1400,900);
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};

 // Geometry and repeated tiling. A row is exactly 172px and every page is an
 // integer number of repeats tall.
 console.log('START',await run(`(()=>{window.InfiniteCanvas.start();return JSON.stringify({view,active:InfiniteCanvas.active,hidden:document.querySelector('#infinite-view').hidden,bodyClass:document.body.classList.contains('infinite-mode')});})()`));
 await wait(300);
 const geom=JSON.parse(await run(`(()=>{const pages=[...document.querySelectorAll('.infinite-page')];const rows=[...pages[1].querySelectorAll('.infinite-row')];const x=n=>new DOMMatrix(getComputedStyle(n).transform).m41,dx=x(pages[2])-x(pages[1]);const a=[...pages[1].querySelectorAll('.infinite-item')],b=[...pages[2].querySelectorAll('.infinite-item')];const bad=a.filter((n,i)=>n.dataset.id!==b[i]?.dataset.id||Math.abs((b[i].getBoundingClientRect().left-n.getBoundingClientRect().left)-dx)>1).length;const signatures=rows.map(r=>[...r.querySelectorAll('.infinite-item')].map(n=>n.dataset.id).join(','));let period=0;for(let i=1;i<signatures.length;i++)if(signatures[i]===signatures[0]){period=i;break;}const pitch=rows.length>1?rows[1].offsetTop-rows[0].offsetTop:rows[0].offsetHeight;return JSON.stringify({pages:pages.length,items:a.length,bad,rowPitch:pitch,rowHeight:rows[0].getBoundingClientRect().height,totalRows:rows.length,period,pageHeight:parseFloat(pages[1].style.height),pageWidth:pages[1].getBoundingClientRect().width,innerWidth});})()`));
 console.log('GEOM',JSON.stringify(geom));
 assert(geom.pages===3&&geom.bad===0,'The infinite wall is not tiled horizontally');
 assert(Math.abs(geom.rowPitch-172)<0.5,'Row pitch is not 172px');
 assert(Math.abs(geom.rowHeight-172)<0.5,'Row height is not 172px');
 assert(geom.period>0&&geom.totalRows%geom.period===0,'Page rows do not repeat in whole groups');
 assert(Math.abs(geom.pageHeight-geom.totalRows*geom.rowPitch)<1,'Page height does not match its rows');
 assert(geom.pageWidth>=geom.innerWidth,'The page is narrower than the window');

 // Zoom out as far as possible: pages must cover the whole window at every
 // wrapped position, with no blank band on either side.
 await run(`(()=>{const s=document.querySelector('.infinite-stage');for(let i=0;i<80;i++)s.dispatchEvent(new WheelEvent('wheel',{deltaY:200,ctrlKey:true,clientX:700,clientY:450,bubbles:true,cancelable:true}));})()`);
 await wait(80);
 const coverage=JSON.parse(await run(`(()=>{const pages=[...document.querySelectorAll('.infinite-page')];const rects=pages.map(p=>{const r=p.getBoundingClientRect();return {l:r.left,r:r.right};});return JSON.stringify({zoom:new DOMMatrix(getComputedStyle(document.querySelector('.infinite-strip')).transform).a,left:Math.round(Math.min(...rects.map(r=>r.l))),right:Math.round(Math.max(...rects.map(r=>r.r))),innerWidth});})()`));
 console.log('COVER',JSON.stringify(coverage));
 assert(coverage.zoom<=0.46,'Zoom did not reach the minimum');
 assert(coverage.left<=0&&coverage.right>=coverage.innerWidth,'The wall leaves a blank band when zoomed out');

 // Return to ~1:1, then check that zoom keeps the content under the pointer.
 await run(`(()=>{const s=document.querySelector('.infinite-stage');for(let i=0;i<2;i++)s.dispatchEvent(new WheelEvent('wheel',{deltaY:-70,ctrlKey:true,clientX:700,clientY:450,bubbles:true,cancelable:true}));})()`);
 await wait(80);
 const anchor=JSON.parse(await run(`(()=>{const at=()=>document.elementFromPoint(700,450)?.closest('.infinite-item')?.dataset.id||null;const before=at();for(let i=0;i<3;i++)document.querySelector('.infinite-stage').dispatchEvent(new WheelEvent('wheel',{deltaY:-90,ctrlKey:true,clientX:700,clientY:450,bubbles:true,cancelable:true}));const after=at();return JSON.stringify({before,after,same:before===after,zoom:new DOMMatrix(getComputedStyle(document.querySelector('.infinite-strip')).transform).a});})()`));
 console.log('ANCHOR',JSON.stringify(anchor));
 assert(anchor.same,'Zoom did not keep the content under the pointer');

 // Free roaming: a vertical wheel moves the wall vertically, not sideways.
 const vertical=JSON.parse(await run(`(()=>{const before=InfiniteCanvas.state;const stage=document.querySelector('.infinite-stage');stage.dispatchEvent(new WheelEvent('wheel',{deltaY:180,clientX:700,clientY:450,bubbles:true,cancelable:true}));const after=InfiniteCanvas.state;return JSON.stringify({before,after});})()`));
 console.log('VERTICAL_WHEEL',JSON.stringify({dx:vertical.after.offsetX-vertical.before.offsetX,dy:vertical.after.offsetY-vertical.before.offsetY}));
 assert(vertical.after.offsetY-vertical.before.offsetY>100,'A vertical wheel did not move the wall vertically');
 assert(Math.abs(vertical.after.offsetX-vertical.before.offsetX)<1,'A vertical wheel moved the wall sideways');

 // Drag must be 1:1 on both axes even when zoomed in.
 await run(`(()=>{const s=document.querySelector('.infinite-stage');for(let i=0;i<6;i++)s.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,ctrlKey:true,clientX:700,clientY:450,bubbles:true,cancelable:true}));})()`);
 await wait(50);
 const drag=JSON.parse(await run(`(()=>{const node=document.elementFromPoint(700,450)?.closest('.infinite-item');if(!node)return JSON.stringify({error:'no item at center'});const r0=node.getBoundingClientRect();const stage=document.querySelector('.infinite-stage');stage.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:700,clientY:450,pointerId:3}));stage.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,clientX:720,clientY:468,pointerId:3}));const r1=node.getBoundingClientRect();stage.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:720,clientY:468,pointerId:3}));return JSON.stringify({dx:Math.round(r1.left-r0.left),dy:Math.round(r1.top-r0.top),zoom:new DOMMatrix(getComputedStyle(document.querySelector('.infinite-strip')).transform).a});})()`));
 console.log('DRAG',JSON.stringify(drag));
 assert(drag.zoom>2,'Drag test did not reach the zoomed-in range');
 assert(Math.abs(drag.dx-20)<2&&Math.abs(drag.dy-18)<2,'Drag is not 1:1 on both axes');

 // A click only selects. Double-click opens the viewer with the wall as its
 // own navigation scope; Space also opens it, and Space closes it again.
 await wait(200);
 const preview=JSON.parse(await run(`(()=>{const item=document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.infinite-item');if(!item)return JSON.stringify({error:'no item at center'});const id=item.dataset.id,strip=document.querySelector('.infinite-strip'),before=strip.style.transform;item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:innerWidth/2,clientY:innerHeight/2,pointerId:5}));item.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:innerWidth/2,clientY:innerHeight/2,pointerId:5}));const clickOpened=!document.querySelector('#preview').hidden,clickSelected=selected===id;item.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:innerWidth/2,clientY:innerHeight/2}));const open=!document.querySelector('#preview').hidden,index=document.querySelector('#preview-index').textContent,total=InfiniteCanvas.scope().length;return JSON.stringify({clickOpened,clickSelected,open,index,total,selected,before});})()`));
 console.log('PREVIEW',JSON.stringify(preview));
 assert(!preview.clickOpened,'A single click must not open the viewer');
 assert(preview.clickSelected,'A single click must select the wall item');
 assert(preview.open,'Double-clicking a wall item did not open the viewer');
 assert(preview.index.trim().endsWith('/ '+preview.total),'The viewer did not use the wall as its scope');
 // With the side islands over the wall, the viewer backdrop must cover the
 // whole window; otherwise the island margins expose moving wall items.
 const chrome=JSON.parse(await run(`(()=>{const backdrop=getComputedStyle(document.body,'::before');const hit=document.elementFromPoint(5,innerHeight/2);return JSON.stringify({position:backdrop.position,zIndex:backdrop.zIndex,sidebar:getComputedStyle(document.querySelector('.sidebar')).zIndex,hit:hit?.tagName});})()`));
 console.log('PREVIEW_CHROME',JSON.stringify(chrome));
 assert(chrome.position==='fixed'&&chrome.zIndex==='9','The viewer backdrop does not span the wall');
 assert(chrome.sidebar==='11','The side islands are not above the viewer backdrop');
 assert(chrome.hit==='BODY','The island margin still lets clicks through to the wall');
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))`);
 await wait(150);
 const returned=JSON.parse(await run(`(()=>{return JSON.stringify({open:!document.querySelector('#preview').hidden,transform:document.querySelector('.infinite-strip').style.transform,selected,focus:document.activeElement?.classList.contains('infinite-item')&&document.activeElement.dataset.id});})()`));
 console.log('RETURN',JSON.stringify(returned));
 assert(!returned.open,'Space did not close the viewer');
 assert(returned.transform===preview.before,'The exact pan was not restored after the viewer');
 assert(returned.focus===returned.selected,'Focus did not return to the wall item');

 // Space reopens the selected wall item, the same chord the library grid uses.
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}))`);
 await wait(150);
 assert(await run(`!document.querySelector('#preview').hidden`),'Space did not open the viewer');
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
 await wait(100);

 // Clicking the empty viewer surface also dismisses it, so a viewer opened by
 // a click can never trap the pointer.
 const backdrop=JSON.parse(await run(`(()=>{const item=document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('.infinite-item');item.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:innerWidth/2,clientY:innerHeight/2}));const opened=!document.querySelector('#preview').hidden;document.querySelector('.preview-body').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return JSON.stringify({opened,closed:document.querySelector('#preview').hidden});})()`));
 console.log('BACKDROP',JSON.stringify(backdrop));
 assert(backdrop.opened&&backdrop.closed,'Double-clicking a wall item or clicking the viewer surface did not work');

 // Right-click selects the item before opening the context menu.
 const context=JSON.parse(await run(`(()=>{selection.clear();selected=null;const item=[...document.querySelectorAll('.infinite-item')].find(n=>n.getBoundingClientRect().left>0);item.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:400,clientY:400}));return JSON.stringify({selected,selectedCount:selection.ids.size});})()`));
 console.log('CONTEXT',JSON.stringify(context));
 assert(context.selected&&context.selectedCount===1,'Right-click did not select the wall item');

 // Arrow keys move across the wall, not the hidden gallery.
 const keyboard=JSON.parse(await run(`(()=>{const before=selected;document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true,cancelable:true}));return JSON.stringify({before,after:selected,changed:before!==selected});})()`));
 console.log('KEYBOARD',JSON.stringify(keyboard));
 assert(keyboard.changed,'Arrow keys did not move the wall selection');

 // The wall shows the whole library, not only the view it was opened from.
 // Opening it from a one-item Favourites view and clicking a different item
 // must select (and preview) that item instead of falling back to the one
 // that was in the filtered gallery.
 const filtered=JSON.parse(await run(`(async()=>{
  const first=assets.find(a=>!a.trash);
  await api.bulkUpdate([first.id],{type:'favorite',favorite:true});
  await refresh();
  setView('favorites');
  await new Promise(r=>setTimeout(r,120));
  InfiniteCanvas.start();
  await new Promise(r=>setTimeout(r,160));
  const wall=InfiniteCanvas.scope();
  const target=wall.find(a=>a.id!==first.id);
  const node=[...document.querySelectorAll('.infinite-item')].find(n=>n.dataset.id===target.id);
  node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:400,clientY:300,pointerId:11}));
  node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:400,clientY:300,pointerId:11}));
  const index=document.querySelector('#preview-index').textContent;
  const shown=current()?.id;
  closePreview();
  InfiniteCanvas.exit();
  await new Promise(r=>setTimeout(r,120));
  const main=document.querySelector('main');
  const leftInert=main.inert;
  setView('all');
  await new Promise(r=>setTimeout(r,160));
  const card=document.querySelector('.card');
  card.click();
  return JSON.stringify({wallSize:wall.length,first:first.id,target:target.id,shown,index,infinite:InfiniteCanvas.active,inert:leftInert,librarySelected:selected,cardId:card.dataset.id});
 })()`));
 console.log('FILTERED',JSON.stringify(filtered));
 assert(filtered.shown===filtered.target,'Clicking a wall item outside the previous view still showed the old item');
 assert(filtered.index.trim().endsWith('/ '+filtered.wallSize),'The viewer did not use the full wall as its scope');
 assert(filtered.infinite===false&&filtered.inert===false,'Leaving the wall left the library inert');
 assert(filtered.librarySelected===filtered.cardId,'The library was unresponsive after leaving the wall');

 // A colour check leaves File Details through the Smart view. Coming back to
 // the wall must still select the item that was clicked, and leaving again
 // must hand the library back for normal browsing.
 const colourFlow=JSON.parse(await run(`(async()=>{
  await WorkbenchUI.findColor('#ffffff');
  const smartView=view;
  InfiniteCanvas.start();
  await new Promise(r=>setTimeout(r,160));
  const wall=InfiniteCanvas.scope();
  const target=wall[wall.length-1];
  const node=[...document.querySelectorAll('.infinite-item')].find(n=>n.dataset.id===target.id);
  node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:420,clientY:320,pointerId:13}));
  node.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,clientX:420,clientY:320,pointerId:13}));
  const shown=current()?.id;
  closePreview();
  InfiniteCanvas.exit();
  await new Promise(r=>setTimeout(r,160));
  const afterExit=view;
  setView('all');
  await new Promise(r=>setTimeout(r,160));
  const mainInert=document.querySelector('main').inert;
  const card=document.querySelector('.card');
  card.click();
  return JSON.stringify({smartView,target:target.id,shown,afterExit,mainInert,librarySelected:selected,cardId:card.dataset.id});
 })()`));
 console.log('COLOUR',JSON.stringify(colourFlow));
 assert(colourFlow.smartView==='smart','The colour check did not open the Smart view');
 assert(colourFlow.shown===colourFlow.target,'Coming back from a colour check still previewed the old wall item');
 assert(colourFlow.afterExit==='smart','Leaving the wall did not return to the colour view');
 assert(colourFlow.mainInert===false&&colourFlow.librarySelected===colourFlow.cardId,'The library stayed inert after a colour check and wall exit');

 // Entering the infinite canvas from a canvas must not destroy that canvas.
 const canvas=JSON.parse(await run(`(async()=>{InfiniteCanvas.exit();const b=await api.canvasCreate('Audit board');await CanvasWorkspace.open(b.id);InfiniteCanvas.start();await new Promise(r=>setTimeout(r,120));InfiniteCanvas.exit();await new Promise(r=>setTimeout(r,120));return JSON.stringify({view,doc:!!CanvasWorkspace.doc,title:document.querySelector('#view-title').textContent,canvasHidden:document.querySelector('#canvas-workspace')?.hidden});})()`));
 console.log('CANVAS',JSON.stringify(canvas));
 assert(canvas.view==='canvas'&&canvas.doc&&canvas.title==='Audit board'&&canvas.canvasHidden===false,'Returning from the infinite canvas lost the canvas');
 await run(`CanvasWorkspace.leave()`);

 // A real Option+O must toggle the wall in both directions.
 const press=async()=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:'o',modifiers:['alt']});win.webContents.sendInputEvent({type:'char',keyCode:'ø',modifiers:['alt']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'o',modifiers:['alt']});await wait(220);return JSON.parse(await run(`JSON.stringify({view,active:InfiniteCanvas.active})`));};
 const on=await press();
 const off=await press();
 console.log('SHORTCUT',JSON.stringify({on,off}));
 assert(on.active===true,'Option+O did not open the infinite canvas');
 assert(off.active===false,'Option+O did not close the infinite canvas');

 if(errors.length)throw Error('Renderer errors: '+errors.join(' | '));
 console.log('INFINITE_CANVAS_OK');
 app.quit();
})().catch(e=>{console.error('INFINITE_CANVAS_FAILED',e.stack);app.exit(1);});
setTimeout(()=>app.exit(2),60000);
