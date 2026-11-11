// Exercises real buttons, IPC, networking and an isolated WebContentsView. Never uses the personal library.
process.env.ASSET_TEST_MODE='1';process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-bookmark-ui-'+Date.now();
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');const electron=require('electron'),{app}=electron;let confirm=1;electron.dialog.showMessageBox=async()=>({response:confirm});const {Library}=require('../electron/library.cjs');require(process.env.ASSET_LIBRARY_MAIN||'../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));async function poll(fn,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const result=await fn();if(result)return result;await wait(25);}throw Error('Timed out');}
let server,lib;
(async()=>{const requests=[];const png=fs.readFileSync(path.join(__dirname,'fixtures/Landscape.png'));server=http.createServer((req,res)=>{requests.push(req.url);if(req.url.startsWith('/cover.png')||req.url==='/icon.png'){res.setHeader('Content-Type','image/png');res.end(png);return;}if(req.url==='/article'){
 res.setHeader('Content-Type','text/html');
 res.end('<html><head><meta property="og:type" content="article"><title>Reader layout fixture</title></head><body><article><h1>Reader layout fixture</h1>'+('<p>Article prose should inherit the centered reader alignment. The fixture repeats enough material to produce a readable document with several blocks.</p>'.repeat(10))+'</article></body></html>');
 return;
}if(req.url==='/gone'){res.writeHead(503);res.end('Offline');return;}res.writeHead(200,{'Content-Type':'text/html','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'"});res.end(`<!doctype html><title>Beautiful reading page</title><meta property="og:title" content="A beautiful bookmark"><meta property="og:image" content="/cover.png"><meta name="description" content="Saved inspiration for later"><link rel="icon" href="/icon.png"><h1>Readable offline article</h1><p>These words stay available offline.</p><img src="/cover.png" width="500"><a href="/next">Next page</a>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 lib=new Library(path.join(process.env.AGAGWU_DATA_DIR,'Library'));const ids=[];for(const name of ['Square','Landscape','Portrait'])ids.push((await lib.importFile(path.join(__dirname,'fixtures',name+'.png'))).imported);lib.addFolder('Inspiration');await app.whenReady();const win=global.assetTestWindow;win.webContents.setBackgroundThrottling(false);if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));const run=s=>win.webContents.executeJavaScript(s),errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'&&!event.message.startsWith('Failed to load resource'))errors.push(event.message);});await run('refresh()');assert.equal(requests.length,0,'Startup must not fetch pages');
 // Favourites: the grid star, actual context menu, category, inspector and batch controls.
 await run(`mounted.get('${ids[0]}').querySelector('.favorite-toggle').click()`);await poll(()=>lib.asset(ids[0]).favorite);await run(`setView('favorites')`);assert.equal(await run('visible.length'),1);await run(`select('${ids[0]}');renderInspector();api.contextMenu(selection.values())`);await poll(()=>global.canvasFileMenu?.getMenuItemById('favorite'));global.canvasFileMenu.getMenuItemById('favorite').click();await poll(()=>!lib.asset(ids[0]).favorite);await poll(()=>run('visible.length===0'));assert.equal(await run("$('#empty h2').textContent"),'No favourites yet');await run(`setView('all');select('${ids[0]}');select('${ids[1]}',{metaKey:true});renderInspector();api.contextMenu(selection.values())`);global.canvasFileMenu.getMenuItemById('favorite').click();await poll(()=>lib.list().filter(a=>a.favorite).length===2);assert.equal(lib.asset(ids[0]).rating,0);console.log('FAVOURITES_UI_OK');
 // Collection creation, assignment, rename, unassignment, cancellation and deletion from the sidebar menu.
 await run(`$('#add-folder').click();$('#folder-name').value='Created in UI';$('#folder-dialog').querySelector('button[value=create]').click()`);await poll(()=>lib.folders().includes('Created in UI'));await run(`handleContextAction({action:'collection',ids:${JSON.stringify(ids.slice(0,2))},folder:'Created in UI'})`);assert.equal(lib.list().filter(a=>a.folders.includes('Created in UI')).length,2);
 await run(`setView('folder','Created in UI');showActionDialog('rename-collection',[],'Created in UI');$('#action-value').value='Renamed collection';$('#action-form').requestSubmit()`);await poll(()=>lib.folders().includes('Renamed collection'));await run(`handleContextAction({action:'remove-collection',ids:['${ids[0]}'],folder:'Renamed collection'})`);assert.ok(!JSON.parse(lib.asset(ids[0]).folders).includes('Renamed collection'));await run(`api.collectionMenu('Renamed collection')`);global.canvasCollectionMenu.items.find(i=>i.label==='Remove Collection…').click();await poll(()=>!lib.folders().includes('Renamed collection'));assert.ok(ids.every(id=>fs.existsSync(lib.file(id))));await run(`$('#add-folder').click();$('#folder-dialog').close()`);await wait(100);assert.ok(!lib.folders().includes(''));console.log('COLLECTION_UI_OK');
 // Pasted/dropped URLs use the same import-url IPC and create a portable .url immediately.
 const result=await run(`api.importURL('${base}/page','Inspiration')`),id=result.ids[0];assert.equal(lib.asset(id).ext,'url');await run(`refresh();setView('link')`);await poll(()=>lib.list().find(a=>a.id===id)?.captureMetadata?.linkPreview?.cover);const info=await run(`api.linkInfo('${id}')`);assert.equal(info.title,'A beautiful bookmark');assert.equal(info.icon,true);assert.ok(fs.existsSync(path.join(lib.root,'thumbnails',id+'.link.cover.jpg')));await poll(()=>run(`!!mounted.get('${id}').querySelector('.smart-web-image')?.naturalWidth`));const count=requests.length;await run(`api.linkInfo('${id}')`);assert.equal(requests.length,count,'Cached previews must not fetch again');await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait(120);console.log('COVER_LAYOUT',JSON.stringify(await run(`(()=>{const i=mounted.get('${id}').querySelector('.smart-web-image'),r=i.getBoundingClientRect();return {width:r.width,height:r.height,opacity:getComputedStyle(i).opacity,display:getComputedStyle(i).display};})()`)));const card=await run(`(()=>{const card=mounted.get('${id}');return {title:card.querySelector('.smart-web-title')?.textContent,domain:card.querySelector('.smart-web-domain')?.textContent,favicon:card.querySelector('.smart-web-favicon')?.getAttribute('src'),caption:getComputedStyle(card.querySelector('.card-meta')).display};})()`);assert.deepEqual(card,{title:'A beautiful bookmark',domain:'127.0.0.1',favicon:'asset://link-icon/'+id+'?v='+info.updatedAt,caption:'none'});fs.writeFileSync('/private/tmp/canvas-bookmark-grid.png',(await win.webContents.capturePage()).toPNG());console.log('BOOKMARK_COVER_CACHE_OK',JSON.stringify({requests:count}));
 // A site denying iframes still loads inside the app in its own sandboxed view.
 await run(`select('${id}');openPreview()`);await poll(()=>global.canvasWebPreview?.view&&!global.canvasWebPreview.view.webContents.isLoading());const viewer=global.canvasWebPreview,web=viewer.view.webContents;await poll(()=>web.executeJavaScript("document.querySelector('h1')?.textContent==='Readable offline article'"));assert.deepEqual(await web.executeJavaScript(`({node:typeof require,bridge:typeof window.library})`),{node:'undefined',bridge:'undefined'});assert.equal(web.getLastWebPreferences().sandbox,true);assert.ok(win.contentView.children.includes(viewer.view));assert.ok(await run("$('#preview').hidden===false"));console.log('IN_APP_WEB_VIEW_OK');
 // Save a real self-contained page archive and render it with the network disabled.
 const saved=await run(`api.webSave('${viewer.token}')`);assert.equal(lib.asset(saved.id).ext,'mhtml');assert.ok(fs.readFileSync(lib.file(saved.id),'utf8').includes('Readable offline article'));assert.deepEqual(JSON.parse(lib.asset(saved.id).folders),['Inspiration']);const offlineRequests=requests.length;await run(`(async()=>{closePreview();await refresh();setView('all');select('${saved.id}');openPreview();})()`);await poll(()=>run("$('#preview-content').textContent.includes('Readable offline article')"));await poll(()=>run("!!$('#preview-content .document-reader img')?.naturalWidth"));assert.equal(requests.length,offlineRequests,'Offline reader must use embedded resources, not the network');console.log('OFFLINE_COPY_OK');await run('closePreview()');
 // Reopening the same live page uses one bounded native view rather than making another process.
 await run(`select('${id}');openPreview()`);await poll(()=>viewer.view);const old=viewer.view.webContents.id;await run('closePreview()');await run(`select('${id}');openPreview()`);await poll(()=>viewer.view);assert.equal(viewer.view.webContents.id,old);await run('closePreview()');console.log('WARM_WEB_REOPEN_OK');const rapid=await run(`(async()=>{const rect={x:30,y:80,width:500,height:400};await Promise.all([api.webOpen('${id}','rapid-A',rect),api.webOpen('${id}','rapid-B',rect)]);api.webClose('rapid-A');return true;})()`);await wait(30);assert.equal(viewer.token,'rapid-B');await run(`api.webClose('rapid-B')`);console.log('RAPID_PREVIEW_OWNERSHIP_OK',rapid);
 const imageRequests=requests.filter(u=>u==='/cover.png').length;const direct=await run(`api.importURL('${base}/cover.png')`);await run('refresh()');const directInfo=await run(`api.linkInfo('${direct.ids[0]}')`);assert.equal(directInfo.cover,true);assert.equal(lib.asset(direct.ids[0]).ext,'url');assert.equal(requests.filter(u=>u==='/cover.png').length-imageRequests,1,'Direct image bookmark reuses the original response');console.log('DIRECT_IMAGE_BOOKMARK_OK');
 // Social links render real post text and gallery images together in the grid.
 const socialFixtures=[
  ['https://x.com/design/status/123','X',4],
  ['https://www.reddit.com/r/design/comments/test/post/','Reddit',0],
  ['https://www.instagram.com/p/Fixture/','Instagram',1]
 ];
 const socialIds=[];
 for(const [url,label,count] of socialFixtures){
  const file=path.join(process.env.AGAGWU_DATA_DIR,label+'.url');
  fs.writeFileSync(file,'[InternetShortcut]\nURL='+url+'\n');
  const {imported}=await lib.importFile(file);
  const postImages=Array.from({length:count},(_,n)=>base+'/cover.png?image='+n);
  lib.setCaptureMetadata(imported,{linkPreview:{
   url,title:label+' fixture',type:'social',state:'ready',smartVersion:8,updatedAt:Date.now(),
   postText:'A long post about visual design and the way ideas develop. '.repeat(24),
   postImages,imageURL:postImages[0],cover:count>0
  }});
  if(count)fs.writeFileSync(path.join(lib.root,'thumbnails',imported+'.link.cover.jpg'),electron.nativeImage.createFromBuffer(png).toJPEG(85));
  socialIds.push(imported);
 }
 await run("refresh().then(()=>setView('social'))");
 for(const [index,assetId] of socialIds.entries()){
  const [,label,count]=socialFixtures[index];
  await poll(()=>run(`mounted.get('${assetId}')?.querySelector('.social-card-icon')?.naturalWidth>0`));
  if(count)await poll(()=>run(`[...mounted.get('${assetId}').querySelectorAll('.social-card-photo')].filter(img=>img.naturalWidth>0).length===${count}`));
  const card=await run(`(()=>{const card=mounted.get('${assetId}'),text=card.querySelector('.social-card-text');return {label:card.querySelector('.social-card-icon').alt,clamp:getComputedStyle(text).webkitLineClamp,footer:getComputedStyle(card.querySelector('.card-meta')).display,systemFont:getComputedStyle(text).fontFamily.includes('-apple-system')};})()`);
  assert.deepEqual(card,{label,clamp:count?'3':'14',footer:'none',systemFont:true});
 }
 console.log('SOCIAL_POST_CARDS_OK');
 const articleId=(await run(`api.importURL('${base}/article')`)).ids[0];
 await run(`api.linkInfo('${articleId}',true).then(()=>refresh()).then(()=>{setView('link');select('${articleId}');openPreview()})`);
 await poll(()=>run("!!document.querySelector('.smart-reader > p:not([class])')"));
 const readerStyle=await run("(()=>{const prose=document.querySelector('.smart-reader > p:not([class])'),style=getComputedStyle(prose);return {alignment:style.textAlign,systemFont:style.fontFamily.includes('-apple-system')};})()");
 assert.deepEqual(readerStyle,{alignment:'center',systemFont:true});
 await run("closePreview();setView('all')");
 console.log('CENTERED_READER_BODY_OK');
 // A large original uses a bounded first preview and requests a sharper tier only on zoom.
 const largePath=path.join(process.env.AGAGWU_DATA_DIR,'Large detail.png');
 fs.writeFileSync(largePath,electron.nativeImage.createFromBuffer(png).resize({width:4600}).toPNG());
 const {imported:largeId}=await lib.importFile(largePath);
 fs.writeFileSync(path.join(lib.root,'thumbnails',largeId+'.png'),electron.nativeImage.createFromBuffer(png).resize({width:600}).toPNG());
 const firstSource=await run(`refresh().then(()=>{setView('all');select('${largeId}');openPreview();return $('.raster-preview img').src})`);
 assert.match(firstSource,/asset:\/\/thumb\//);
 await poll(()=>run("$('.raster-preview img')?.naturalWidth>0"));
 const first=await run("$('.raster-preview img').naturalWidth");
 assert.ok(first<4600);
 assert.equal(await run("!!$('.raster-preview-controls')"),false);
 for(let i=0;i<4;i++){
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'=',modifiers:['meta']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'=',modifiers:['meta']});
 }
 await poll(()=>run("$('.raster-preview img').style.transform.includes('scale(3.')"));
 await poll(()=>run("$('.raster-preview img')?.naturalWidth===4096"));
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'-',modifiers:['meta']});
 win.webContents.sendInputEvent({type:'keyUp',keyCode:'-',modifiers:['meta']});
 await poll(()=>run("$('.raster-preview img').style.transform.includes('scale(2.')"));
 await run("$('.raster-preview').dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-20,bubbles:true,cancelable:true}));closePreview()");
 assert.equal(await run("(async()=>{await api.smartIdlePolicy(true);return (await api.smartState()).idleOnly})()"),true);
 assert.equal(await run("(async()=>{await api.smartIdlePolicy(false);return (await api.smartState()).idleOnly})()"),false);
 console.log('PROGRESSIVE_IMAGE_AND_AI_POLICY_OK');
 // Common controls remain functional after transitions.
 await run(`$('#toggle-inspector').click();$('#toggle-inspector').click();$('#toggle-sidebar').click();$('#show-sidebar').click();setGalleryLayout('waterfall');setGalleryLayout('justified');setGalleryLayout('masonry');$('#sort').value='old';$('#sort').dispatchEvent(new Event('change'));$('#search').value='Square';$('#search').dispatchEvent(new Event('input'))`);assert.equal(await run('visible.length'),1);await run(`$('#search').value='';render();$('#show-settings').click()`);assert.equal(await run("$('#settings-dialog').open"),true);await run("$('#settings-close').click()");assert.deepEqual(errors,[]);console.log('BOOKMARK_WORKFLOWS_OK');lib.close();lib=null;await new Promise(r=>server.close(r));server=null;app.quit();
})().catch(e=>{console.error('BOOKMARK_WORKFLOWS_FAILED',e.stack);lib?.close();server?.close();app.exit(1);});
