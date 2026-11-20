// Real-interaction audit of the smaller UI fixes: sidebar counts and add
// buttons clear the card edge, the file-details panel stays usable while the
// viewer is open, and the colour details strip uses round, varied swatches
// that still navigate to matching files.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {app}=require('electron');
const {Library}=require('../electron/library.cjs');
const profile=fs.mkdtempSync('/private/tmp/canvas-ui-audit-');
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR=profile;
const lib=new Library(path.join(profile,'Library'));
require('../electron/main.cjs');
(async()=>{
 const ids={};
 for(const name of ['Landscape.png','Portrait.png','Square.png'])ids[name]=(await lib.importFile(path.join(__dirname,'fixtures',name))).imported;
 lib.close();
 await app.whenReady();
 const win=global.assetTestWindow;
 win.webContents.setBackgroundThrottling(false);
 if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(check,label,time=20000)=>{
  const end=Date.now()+time;
  while(Date.now()<end){if(await check())return;await wait(40);}
  throw Error('Timed out: '+label);
 };
 await win.setSize(1400,900);
 await run('refresh()');
 for(const id of Object.values(ids)){
  await run(`api.smartAnalyze('${id}')`);
  await until(()=>run(`(assetById.get('${id}')?.smart?.palette?.length||0)>0`),'palette '+id);
 }
 await run('refresh()');

 // Counts and the section add button stay inside the sidebar card.
 const spacing=JSON.parse(await run(`(()=>{
  const sidebar=$('.sidebar').getBoundingClientRect();
  const badge=$('#navigation button .badge').getBoundingClientRect();
  const add=$('#add-folder').getBoundingClientRect();
  const row=$('#navigation button').getBoundingClientRect();
  return JSON.stringify({sidebarRight:sidebar.right,badgeRight:badge.right,addRight:add.right,rowRight:row.right,badgeGap:sidebar.right-badge.right,addGap:sidebar.right-add.right,rowGap:sidebar.right-row.right});
 })()`));
 console.log('SIDEBAR_SPACING',JSON.stringify(spacing));
 assert.ok(spacing.badgeGap>=8,'The count badge crowds the sidebar edge: '+spacing.badgeGap+'px');
 assert.ok(spacing.addGap>=8,'The collection add button crowds the sidebar edge: '+spacing.addGap+'px');
 assert.ok(spacing.badgeRight<=spacing.sidebarRight,'The count badge overflows the sidebar');

 // The viewer leaves File Details interactive; only the gallery is inert.
 await run(`select('${ids['Landscape.png']}');openPreview()`);
 await until(()=>run("!$('#preview').hidden"),'preview opens');
 const viewer=JSON.parse(await run(`JSON.stringify({mainInert:$('main').inert,inspectorInert:$('#inspector').inert,inspectorVisible:!$('#inspector').hidden})`));
 console.log('VIEWER_INERT',JSON.stringify(viewer));
 assert.equal(viewer.mainInert,true,'The gallery should be inert behind the viewer');
 assert.equal(viewer.inspectorInert,false,'File Details must stay interactive during the viewer');
 // Clicking the empty raster stage around the photograph dismisses the viewer.
 const blank=JSON.parse(await run(`(()=>{const r=document.querySelector('#preview-content .raster-preview').getBoundingClientRect();for(const [fx,fy] of [[.5,.02],[.02,.5],[.98,.5],[.5,.98]]){const x=Math.round(r.left+r.width*fx),y=Math.round(r.top+r.height*fy);if(document.elementFromPoint(x,y)?.classList.contains('raster-preview'))return JSON.stringify({x,y,hit:'raster-preview'});}return JSON.stringify({hit:document.elementFromPoint(r.left+8,r.top+8)?.className});})()`));
 assert.equal(blank.hit,'raster-preview','The viewer stage is not exposed around the picture');
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:blank.x,y:blank.y});
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:blank.x,y:blank.y});
 await until(()=>run("$('#preview').hidden"),'viewer closes on a stage click');
 console.log('VIEWER_BACKDROP_CLOSE_OK');

 // Nearby colours: round swatches, a varied set, and a working navigation.
 const paletteHex=await run(`assetById.get('${ids['Landscape.png']}').smart.palette[0].hex`);
 await run(`showColorDetails('${paletteHex}')`);
 await until(()=>run("!!document.querySelector('#inspector .color-palette .color-swatch')"),'nearby colours render');
 const colours=JSON.parse(await run(`(()=>{
  const swatches=[...document.querySelectorAll('#inspector .color-palette .color-swatch')];
  return JSON.stringify({
   count:swatches.length,
   radii:swatches.map(s=>getComputedStyle(s).borderRadius),
   sizes:swatches.map(s=>getComputedStyle(s).width),
   colours:swatches.map(s=>getComputedStyle(s).backgroundColor),
   section:[...document.querySelectorAll('#inspector h3,#inspector .section-label')].map(n=>n.textContent.trim())
  });
 })()`));
 console.log('NEARBY_COLOURS',JSON.stringify({count:colours.count,radii:[...new Set(colours.radii)],sizes:[...new Set(colours.sizes)],distinct:new Set(colours.colours).size,section:colours.section}));
 assert.ok(colours.count>=4,'The nearby colour strip is too small to be varied');
 assert.ok(colours.radii.every(radius=>radius==='50%'),'Nearby colour swatches are not circular');
 assert.ok(colours.sizes.every(size=>size==='24px'),'Nearby colour swatches are not the standard size');
 assert.equal(new Set(colours.colours).size,colours.count,'Nearby colours repeat, so the set is not varied');
 assert.ok(colours.section.includes('Nearby colours'),'The Nearby colours section is missing');

 // One rule between the two stat groups; the Nearby colours section paints
 // its own, so adding another divider here double-ruled the panel.
 const detail=JSON.parse(await run(`(()=>{const dividers=[...document.querySelectorAll('#inspector .color-detail-divider')];const row=getComputedStyle(document.querySelector('#inspector .color-stat'));return JSON.stringify({dividers:dividers.length,rowPadding:row.paddingTop,rowFont:row.fontSize});})()`));
 console.log('COLOUR_DETAIL_SPACING',JSON.stringify(detail));
 assert.equal(detail.dividers,1,'The colour panel draws more than one explicit divider');
 assert.equal(detail.rowPadding,'7px','The colour stat rows are still cramped');

 // Menu rows are contiguous within and between groups, so the pointer never
 // travels over pixels that belong to no row. The highlight itself is inset.
 await run(`$('#view-menu-button').click()`);
 await until(()=>run("$('#view-menu').matches(':popover-open')"),'view menu opens');
 const menu=JSON.parse(await run(`(()=>{const groups=[...document.querySelectorAll('#view-menu .view-menu-group')];const rows=groups.map(g=>[...g.querySelectorAll('button')]);const joins=[];for(let i=1;i<rows.length;i++){const a=rows[i-1].at(-1).getBoundingClientRect(),b=rows[i][0].getBoundingClientRect();joins.push(Math.round((b.top-a.bottom)*10)/10);}const before=getComputedStyle(rows[0][0],'::before');return JSON.stringify({groups:groups.length,joins,padding:groups.map(g=>getComputedStyle(g).paddingTop).join(','),fillInset:before.inset,fillTop:before.top,rowGap:Math.round((rows[0][1].getBoundingClientRect().top-rows[0][0].getBoundingClientRect().bottom)*10)/10});})()`));
 console.log('MENU_ROWS',JSON.stringify(menu));
 assert.ok(menu.joins.every(gap=>Math.abs(gap)<=1),'The view menu leaves a dead band between groups: '+menu.joins);
 assert.ok(Math.abs(menu.rowGap)<=1,'The view menu leaves a dead band between rows: '+menu.rowGap);
 assert.equal(menu.padding,'0px,0px,0px','The view menu groups still add padding around the rows');
 assert.equal(menu.fillTop,'2px','The menu highlight is not inset from the full-height row');
 await run(`$('#view-menu').hidePopover()`);

 // Click the first swatch with a real mouse press and land on the matches.
 const point=JSON.parse(await run(`(()=>{const r=document.querySelector('#inspector .color-palette .color-swatch').getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});})()`));
 win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(point.x),y:Math.round(point.y)});
 win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(point.x),y:Math.round(point.y)});
 await until(()=>run("view==='smart'&&WorkbenchUI.title.startsWith('Files with ')"),'colour navigation');
 console.log('COLOUR_NAV',await run("JSON.stringify({view,title:WorkbenchUI.title})"));

 console.log('UI_AUDIT_OK');
 app.quit();
})().catch(error=>{console.error('UI_AUDIT_FAILED',error.stack);try{lib.close();}catch{}app.exit(1);});
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
