const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, protocol, net, Menu, ShareMenu, nativeTheme, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { Library } = require('./library.cjs');
const {LibraryLocation}=require('./library-location.cjs');
const { MediaCache } = require('./media-cache.cjs');
const { fileResponse } = require('./file-response.cjs');
const { clipboardData } = require('./clipboard-data.cjs');
const crypto=require('node:crypto');
const {CanvasStore,normalize:normalizeCanvasItem}=require('./canvas-store.cjs');
const {publicFetch}=require('./public-fetch.cjs');
const {Bookmarks}=require('./bookmarks.cjs');
const {WebPreview}=require('./web-preview.cjs');
const {SmartIndex}=require('./smart-index.cjs');
const {LocalModel}=require('./local-model.cjs');
const { CaptureBridge } = require('./capture-bridge.cjs');
const {contextTemplate}=require('./file-menu.cjs');
const {ImportQueue}=require('./import-queue.cjs');
const {Workbench}=require('./workbench.cjs');
const {HealthService}=require('./health-service.cjs');
app.setName(process.env.CANVAS_PROTOTYPE?'Canvas Pro Prototype':'Canvas Pro');
const legacyData=path.join(app.getPath('appData'),'Asset Library');
if(fs.existsSync(path.join(legacyData,'Library/library.sqlite')))app.setPath('userData',legacyData);
protocol.registerSchemesAsPrivileged([{ scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (process.env.AGAGWU_DATA_DIR) {
  fs.mkdirSync(process.env.AGAGWU_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.AGAGWU_DATA_DIR);
}
if(!process.env.ASSET_TEST_MODE&&!app.requestSingleInstanceLock()){app.quit();return;}
let win, library, mediaCache, captureBridge, importQueue, healthService,bookmarks,webPreview,canvasStore,smartIndex,localModel,workbench;
let notesStore;
let assistantService;
const getAssistant = () => assistantService ??= new (require('./assistant.cjs').Assistant)(
  path.join(app.getPath('userData'), 'Local Models', 'FunctionGemma')
);
const getNotesStore=()=>notesStore??=new (require('./notes-store.cjs').NotesStore)(library.db);
let pendingLibrarySwitch=null;
let previewZoomActive=false;
let canvasDirty=false,notesDirty=false;const canvasFlushWaiters=new Map();
function flushWorkspaces(){if((!canvasDirty&&!notesDirty)||!win||win.isDestroyed())return Promise.resolve();const token=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{canvasFlushWaiters.delete(token);reject(new Error('Workspace changes could not be saved. Please retry before closing.'));},8000);canvasFlushWaiters.set(token,{resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}});win.webContents.send('canvas-flush-request',token);});}
app.on('second-instance',()=>{if(app.isReady())ensureWindow();});
const thumbPending = new Map();
const thumbnailMisses = new Set();
let thumbnailActive = 0;
const thumbnailQueue = [];
let visibleThumbnails=null;
function thumbnailSlot(task,id,gallery,cacheKey) {
  return new Promise((resolve,reject)=>{
    const job={task,id,gallery,cacheKey,resolve,reject};
    if(gallery)thumbnailQueue.push(job);else thumbnailQueue.unshift(job);
    pumpThumbnails();
  });
}
function setVisibleThumbnails(ids){
  visibleThumbnails=new Set(ids);
  for(let i=thumbnailQueue.length-1;i>=0;i--){
    const job=thumbnailQueue[i];
    if(job.gallery&&!visibleThumbnails.has(job.id)){
      thumbnailQueue.splice(i,1);
      job.resolve(null);
    }
  }
}
function pumpThumbnails() { if(thumbnailActive >= 2 || !thumbnailQueue.length)return;const job=thumbnailQueue.shift();thumbnailActive++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{thumbnailActive--;pumpThumbnails();});pumpThumbnails(); }
function sendProgress(value) { if (win && !win.isDestroyed()) win.webContents.send('import-progress', value); }
const previewSizes=new Set([960,1800,3200,4096]);
const rasterThumbnail=/^(png|jpe?g|jfif|jpe|insp|webp|avif|gif|bmp|heic|heif|tiff?|jxl|jpegxl)$/;
const jpegThumbnail=/^(jpe?g|jfif|jpe|insp)$/;
const galleryEdge=480;
function compactThumbnailPath(base){
  for(const ext of ['jpg','png']){
    const file=base+'.thumb-v2.'+ext;
    if(fs.existsSync(file))return file;
  }
  return null;
}
async function generateCompactThumbnail(file,base,ext){
  const jpeg=jpegThumbnail.test(ext);
  const temp=base+'.thumb-v2.part.'+(jpeg?'jpg':'png');
  try{
    try{
      await run(path.join(__dirname,'../bin/media-tool'),['--thumbnail',file,temp,String(galleryEdge),'200000000','any'],{timeout:10000,maxBuffer:65536});
    }catch(error){
      if(!/^(jxl|jpegxl)$/.test(ext))throw error;
      await run('/usr/bin/sips',['-s','format','png','-Z',String(galleryEdge),file,'--out',temp],{timeout:15000,maxBuffer:1024*1024});
    }
    let target=base+'.thumb-v2.'+(jpeg?'jpg':'png');
    if(!jpeg){
      const image=nativeImage.createFromPath(temp);
      if(image.isEmpty())throw Error('Invalid gallery thumbnail');
      const bitmap=image.toBitmap();
      let opaque=true;
      for(let i=3;i<bitmap.length;i+=4){
        if(bitmap[i]!==255){opaque=false;break;}
      }
      if(opaque){
        const compressed=image.toJPEG(78);
        if(compressed.length&&(await fs.promises.stat(temp)).size>compressed.length){
          await fs.promises.writeFile(temp,compressed);
          target=base+'.thumb-v2.jpg';
        }
      }
    }
    await fs.promises.rename(temp,target);
    await fs.promises.rm(base+'.png',{force:true}).catch(()=>{});
    return target;
  }finally{
    await fs.promises.rm(temp,{force:true}).catch(()=>{});
  }
}
async function thumbnail(id,full=false,gallery=false,detail=null) {
  if(library.deleting.has(id))return null;
  const {ext}=library.asset(id);
  const base=path.join(library.root,'thumbnails',id);
  const compact=!full&&!detail&&rasterThumbnail.test(ext);
  const detailExt=detail&&jpegThumbnail.test(ext)?'.jpg':'.png';
  const target=base+(detail?'.detail-'+detail+detailExt:full?'.preview.png':'.png');
  const cached=!full&&!detail?compactThumbnailPath(base):null;
  if(cached)return cached;
  if(!compact&&fs.existsSync(target))return target;
  const prefix = mediaCache.prefix(id);
  if(fs.existsSync(prefix+'.art.jpg'))return prefix+'.art.jpg';
  if(fs.existsSync(prefix+'.poster.jpg'))return prefix+'.poster.jpg';
  const cacheKey=id+(detail?':detail-'+detail:full?':preview':'');
  if(thumbnailMisses.has(cacheKey))return compact&&fs.existsSync(target)?target:null;
  if(gallery&&visibleThumbnails&&!visibleThumbnails.has(id))return null;
  if(thumbPending.has(cacheKey)){
    if(!gallery){
      const index=thumbnailQueue.findIndex(job=>job.id===id&&job.gallery&&job.cacheKey===cacheKey);
      if(index>=0){const [job]=thumbnailQueue.splice(index,1);job.gallery=false;thumbnailQueue.unshift(job);}
    }
    return thumbPending.get(cacheKey);
  }
  const promise=thumbnailSlot(async()=>{
    if(compact){
      try{return await generateCompactThumbnail(library.file(id),base,ext);}
      catch{
        thumbnailMisses.add(cacheKey);
        if(thumbnailMisses.size>4096)thumbnailMisses.delete(thumbnailMisses.values().next().value);
        return fs.existsSync(target)?target:null;
      }
    }
    const file=library.file(id);
    try {
      if(['mp3','m4a','wav','aac','flac','aiff','ogg','mp4','mov','m4v','webm','ogv','mkv','avi','gifv','3gp','3g2','h265','hevc','aif','oga','opus','alac'].includes(ext)) {
        const info=await mediaCache.get(id);
        if(info.artwork)return prefix+'.art.jpg';if(info.poster)return prefix+'.poster.jpg';
        if(info.deferred)return null;
      }
      if(detail||/^(png|jpe?g|jfif|jpe|insp|webp|avif|gif|bmp|heic|heif|tiff?)$/.test(ext)){
        const temp=target+'.part'+detailExt;
        try{
          await run(path.join(__dirname,'../bin/media-tool'),['--thumbnail',file,temp,String(detail||(full?1800:600)),'200000000','any'],{timeout:10000,maxBuffer:65536});
          await fs.promises.rename(temp,target);
          return target;
        }catch{
          await fs.promises.rm(temp,{force:true}).catch(()=>{});
          if(detail)return null;
        }
      }
      if(['jxl','jpegxl'].includes(ext)){
        try{await run('/usr/bin/sips',['-s','format','png','-Z',full?'1800':'600',file,'--out',target],{timeout:15000,maxBuffer:1024*1024});if(fs.existsSync(target))return target;}catch{}
      }
      const image=await nativeImage.createThumbnailFromPath(file,{width:full?1800:600,height:full?1800:600});
      if(!image.isEmpty()){await fs.promises.writeFile(target,image.toPNG());return target;}
    } catch { }
    // ImageIO can decode image formats whose extension has no Quick Look generator.
    try {
      await run('/usr/bin/sips',['-s','format','png','-Z',full?'1800':'600',file,'--out',target],{timeout:15000,maxBuffer:1024*1024});
      if(fs.existsSync(target))return target;
    }catch{}
    thumbnailMisses.add(cacheKey);
    if(thumbnailMisses.size>4096)thumbnailMisses.delete(thumbnailMisses.values().next().value);
    return null;
  },id,gallery,cacheKey).finally(()=>thumbPending.delete(cacheKey));
  thumbPending.set(cacheKey,promise);return promise;
}
async function importBuffer(buffer, name, folder, sourceURL='') {
  const dir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'asset-paste-'));
  try {
    const file=path.join(dir,path.basename(name));await fs.promises.writeFile(file,buffer);
    const result=await importPaths([file],folder);
    if(sourceURL)for(const id of result.ids)if(!library.asset(id).url)library.update(id,{url:sourceURL});
    return result;
  } finally { await fs.promises.rm(dir,{recursive:true,force:true}); }
}
function escapeXML(value){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
async function importURL(value,folder){return bookmarks.save(value,folder);}
function canvasPNG(value){
 if(typeof value!=='string'||!value.startsWith('data:image/png;base64,')||value.length>350000000)throw Error('Invalid canvas image.');
 const bytes=Buffer.from(value.slice('data:image/png;base64,'.length),'base64');
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid canvas image.');
 return bytes;
}
async function importPaths(paths, folder) {
  return importQueue.enqueue(paths, folder).done;
}

function appearanceState(){
 const reducedTransparency=!!nativeTheme.prefersReducedTransparency,highContrast=!!nativeTheme.shouldUseHighContrastColors;
 return {dark:!!nativeTheme.shouldUseDarkColors,nativeGlass:process.platform==='darwin'&&nativeTheme.shouldUseDarkColors&&!reducedTransparency&&!highContrast,reducedTransparency,highContrast};
}
nativeTheme.on('updated',()=>{
 if(!win||win.isDestroyed())return;const state=appearanceState();
 if(process.platform==='darwin')win.setVibrancy(state.nativeGlass?'sidebar':null);
 win.setBackgroundColor(state.nativeGlass?'#00000000':state.dark?'#202020':'#f4f4f6');win.webContents.send('appearance-changed',state);
});
function createWindow() {
  const appearance=appearanceState();
  win = new BrowserWindow({ width: 1480, height: 940, minWidth: 960, minHeight: 640, title: 'Canvas Pro', backgroundColor: appearance.nativeGlass?'#00000000':appearance.dark?'#202020':'#f4f4f6', ...(appearance.nativeGlass?{vibrancy:'sidebar',visualEffectState:'followWindow'}:{}), titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), autoplayPolicy: 'no-user-gesture-required', contextIsolation: true, nodeIntegration: false, sandbox: true } });
  previewZoomActive=false;
  win.webContents.on('before-input-event',(_event,input)=>{
    win.webContents.setIgnoreMenuShortcuts(previewZoomActive&&(input.meta||input.control)&&['+','=','-','0'].includes(input.key));
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const target=win;
  target.webContents.on('render-process-gone',(_event,details)=>{
    if(shutdownStarted||target.isDestroyed()||details.reason==='clean-exit')return;
    canvasDirty=false;notesDirty=false;for(const [token,waiter]of canvasFlushWaiters){canvasFlushWaiters.delete(token);waiter.reject(new Error('The app view stopped before the save completed. Reopen the view to inspect your last saved changes.'));}
    const oldPreview=webPreview;webPreview=null;oldPreview?.close().catch(()=>{});
    dialog.showMessageBox(target,{type:'warning',title:'Canvas Pro',message:'The app view stopped unexpectedly.',detail:'Reload to reopen your library. Saved files, notes and canvas changes are kept; edits that had not finished saving may be lost.',buttons:['Reload view','Close window'],defaultId:0,cancelId:1}).then(({response})=>{if(target.isDestroyed()||shutdownStarted)return;if(response===0)target.loadFile(path.join(__dirname,'../src/index.html'));else target.close();}).catch(()=>{if(!target.isDestroyed())target.close();});
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close',event=>{if((!canvasDirty&&!notesDirty)||shutdownStarted)return;event.preventDefault();const target=win;flushWorkspaces().then(()=>{if(!target.isDestroyed())target.close();}).catch(error=>dialog.showErrorBox('Workspace could not be saved',error.message));});
  win.on('closed',()=>{webPreview?.close();webPreview=null;});
  win.loadFile(path.join(__dirname, '../src/index.html'));
  if(process.env.ASSET_TEST_MODE)global.assetTestWindow=win;
}
function ensureWindow() {
  if(!win||win.isDestroyed())createWindow();
  if(win.isMinimized())win.restore();
  win.show();win.focus();
  return win;
}
async function openImportWindow() {
  const target=ensureWindow();
  if(target.webContents.isLoading())await new Promise(resolve=>target.webContents.once('did-finish-load',resolve));
  if(!target.isDestroyed())target.webContents.send('menu-import');
}
app.whenReady().then(async () => {
  if(process.platform==='darwin'&&!fs.existsSync(path.join(process.resourcesPath,'AssetLibrary.icns'))){
    const dockIcon=path.join(__dirname,'../src/assets/app-icon.png');
    if(fs.existsSync(dockIcon))app.dock.setIcon(dockIcon);
  }
  const locations=new LibraryLocation(path.join(app.getPath('userData'),'libraries.json'));
  async function chooseLibrary(mode){
    if(mode==='new'){const chosen=await dialog.showSaveDialog({title:'Create Canvas Pro library',defaultPath:path.join(app.getPath('documents'),'My Library.canvaslibrary'),buttonLabel:'Create library',properties:['createDirectory','showOverwriteConfirmation']});if(chosen.canceled)return null;return locations.create(chosen.filePath);}
    const chosen=await dialog.showOpenDialog({title:'Open Canvas Pro library',buttonLabel:'Open library',properties:['openDirectory','treatPackageAsDirectory']});if(chosen.canceled)return null;return locations.validate(chosen.filePaths[0]);
  }
  let libraryRoot,savedLibrary;
  if(process.env.ASSET_TEST_MODE&&!process.env.ASSET_TEST_CHOOSER)libraryRoot=path.join(app.getPath('userData'),'Library');
  else {
    const legacy=path.join(app.getPath('userData'),'Library');
    while(!libraryRoot){try{const saved=locations.read();if(saved.root){libraryRoot=locations.validate(saved.root);savedLibrary=saved;}else if(fs.existsSync(path.join(legacy,'library.sqlite')))libraryRoot=locations.validate(legacy);}catch(error){dialog.showErrorBox('Library unavailable',error.message+' Your library files have not been moved.');}
      if(!libraryRoot){const answer=await dialog.showMessageBox({type:'question',title:'Welcome to Canvas Pro',message:'Choose your library',detail:'Keep your originals, bookmarks, collections and canvases together in a folder you choose.',buttons:['Create library…','Open existing…','Quit'],cancelId:2});if(answer.response===2){app.quit();return;}try{libraryRoot=await chooseLibrary(answer.response===0?'new':'open');}catch(error){dialog.showErrorBox('Could not open library',error.message);}}
    }
  }
  if(!process.env.ASSET_TEST_MODE&&(savedLibrary?.root!==libraryRoot||savedLibrary.recent[0]!==libraryRoot))locations.remember(libraryRoot);
  library = new Library(libraryRoot);
  workbench=new Workbench(library);
  let switchingLibrary=false;
  async function changeLibrary(mode){if(switchingLibrary)return;switchingLibrary=true;try{await flushWorkspaces();const target=await chooseLibrary(mode);if(!target||target===library.root)return;pendingLibrarySwitch=()=>{locations.remember(target);app.relaunch();};app.quit();}catch(error){dialog.showErrorBox('Could not switch library',error.message);}finally{switchingLibrary=false;}}
  ipcMain.handle('library-location',event=>{trusted(event);return ({root:library.root,name:path.basename(library.root).replace(/\.canvaslibrary$/i,''),recent:locations.read().recent||[]});});
  ipcMain.handle('library-switch',(event,mode)=>{trusted(event);if(!['new','open'].includes(mode))throw Error('Invalid library action.');return changeLibrary(mode);});
  canvasStore=new CanvasStore(library);if(process.env.ASSET_TEST_MODE)global.canvasTestStore=canvasStore;
  bookmarks=new Bookmarks({library,fetcher:process.env.ASSET_TEST_MODE?(url,options)=>net.fetch(url,options):publicFetch,onUpdate:(id,info)=>{if(win&&!win.isDestroyed())win.webContents.send('link-info-changed',{id,info});}});
  mediaCache = new MediaCache(library,path.join(__dirname,'../bin/media-tool'));
  importQueue=new ImportQueue({library,onChange:jobs=>{
    if(win&&!win.isDestroyed())win.webContents.send('import-state',jobs);
    const active=jobs.find(j=>['running','cancelling'].includes(j.state));
    sendProgress(active?{name:active.name||'Preparing import…',count:active.processed+1}:null);
  }});
  localModel=new LocalModel({root:process.env.ASSET_TEST_MODE&&process.env.ASSET_MODEL_DIR?path.resolve(process.env.ASSET_MODEL_DIR):path.join(app.getPath('userData'),'Local Models'),fetcher:(url,options)=>net.fetch(url,options),onProgress:value=>{if(win&&!win.isDestroyed())win.webContents.send('model-progress',value);}});
  let thermalState=process.env.ASSET_TEST_MODE?'unknown':powerMonitor.getCurrentThermalState();
  const canAccelerateIndex=()=>thermalState==='nominal'&&!powerMonitor.isOnBatteryPower()&&powerMonitor.getSystemIdleTime()>=60;
  smartIndex=new SmartIndex({library,thumbnail:async id=>{const a=library.asset(id);if(['url','webloc'].includes(a.ext)){const file=bookmarks.path(id);return fs.existsSync(file)?file:null;}return thumbnail(id);},nativeImage,delay:()=>canAccelerateIndex()?350:650,testMode:!!process.env.ASSET_TEST_MODE,onWork:()=>{if(win&&!win.isDestroyed())win.webContents.send('smart-work',smartIndex?.paused?'manual':smartIndex?.powerPause);},onUpdate:value=>{if(win&&!win.isDestroyed())win.webContents.send('smart-changed',value);}});
  if(!process.env.ASSET_TEST_MODE&&workbench.pref('indexPaused'))smartIndex.pause(true);
  let indexIdleTimer,updateIndexPower=()=>{};
  if(!process.env.ASSET_TEST_MODE){
    updateIndexPower=()=>{
      if(smartIndex.closed)return;
      const hot=thermalState==='serious'||thermalState==='critical';
      const idleOnly=workbench.pref('indexIdleOnly')!==false;
      smartIndex.setPowerPause(hot?'thermal':powerMonitor.isOnBatteryPower()?'battery':idleOnly&&powerMonitor.getSystemIdleTime()<60?'active':null);
      clearTimeout(indexIdleTimer);
      if(idleOnly&&!hot&&!powerMonitor.isOnBatteryPower()){
        indexIdleTimer=setTimeout(updateIndexPower,5000);
        indexIdleTimer.unref();
      }
    };
    powerMonitor.on('on-battery',updateIndexPower);
    powerMonitor.on('on-ac',updateIndexPower);
    powerMonitor.on('thermal-state-change',({state})=>{thermalState=state;updateIndexPower();});
    powerMonitor.on('resume',()=>{thermalState=powerMonitor.getCurrentThermalState();updateIndexPower();});
    updateIndexPower();
  }
  healthService=new HealthService(library.root,state=>{if(win&&!win.isDestroyed())win.webContents.send('health-state',state);});
  ipcMain.handle('appearance-state',()=>appearanceState());
  ipcMain.handle('import-state',()=>importQueue.snapshot());
  ipcMain.handle('import-cancel',(_,id)=>{importQueue.cancel(id);return importQueue.snapshot();});
  ipcMain.handle('import-retry',(_,id)=>importQueue.retry(id).done);
  ipcMain.handle('health-state',()=>healthService.state);
  ipcMain.handle('health-start',()=>healthService.start());
  ipcMain.handle('health-cancel',()=>healthService.cancel());

  protocol.handle('asset', async request => {
    try {
      const u = new URL(request.url);
      if(u.hostname==='ai'){const file=localModel.file(decodeURIComponent(u.pathname));return file?await fileResponse(file,request):new Response('',{status:404});}
      const id = u.pathname.slice(1);
      if (!/^[a-f0-9-]{36}$/.test(id)) return new Response('', { status: 400 });
      if(u.hostname==='note-cover'){
        const image=getNotesStore().cover(id,u.searchParams.has('small'));
        return image?new Response(image,{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'}}):new Response(null,{status:404});
      }
      if(u.hostname==='thumb'&&u.searchParams.has('cached')){
        if(library.deleting.has(id))return new Response(null,{status:404});
        const base=path.join(library.root,'thumbnails',id);
        const file=compactThumbnailPath(base);
        return file?await fileResponse(file,request):new Response(null,{status:404});
      }
      if(u.hostname==='image-detail'){
        const size=Number(u.searchParams.get('size'));
        if(!previewSizes.has(size))return new Response(null,{status:400});
        const file=await thumbnail(id,false,false,size);
        return file?await fileResponse(file,request):new Response(null,{status:404});
      }
      if(u.hostname==='social-image'){
        const index=u.searchParams.get('index')||'';
        if(!/^[0-7]$/.test(index))return new Response('',{status:400});
        return await bookmarks.socialImage(id,Number(index),request.signal);
      }
      if(u.hostname==='reader-image'){
        const index=u.searchParams.get('block')||'';
        if(index!=='featured'&&!/^\d{1,4}$/.test(index))return new Response('',{status:400});
        return await bookmarks.readerImage(id,index==='featured'?index:Number(index),request.signal);
      }
      const file = u.hostname==='link-cover'?bookmarks.path(id):u.hostname==='link-icon'?bookmarks.path(id,'icon'):u.hostname === 'preview' ? await thumbnail(id,true) : u.hostname === 'thumb' ? await thumbnail(id,false,u.searchParams.has('gallery')) : u.hostname === 'file' ? library.file(id) : u.hostname === 'art' ? mediaCache.prefix(id)+'.art.jpg' : null;
      return file ? await fileResponse(file, request) : new Response('', { status: 404 });
    } catch { return new Response('', { status: 404 }); }
  });
  const trusted=event=>{if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Unavailable outside the library.');};
  ipcMain.handle('notes-emoji',(event,id,emoji)=>{trusted(event);return getNotesStore().setEmoji(id,emoji);});
  ipcMain.handle('notes-show-emoji-picker',event=>{trusted(event);if(process.platform==='darwin')app.showEmojiPanel();});
  ipcMain.handle('notes-list',event=>{trusted(event);return getNotesStore().list();});
  ipcMain.handle('notes-get',(event,id)=>{trusted(event);return getNotesStore().get(id);});
  ipcMain.handle('notes-create',(event,template,parent,title)=>{trusted(event);return getNotesStore().create(template,parent,title);});
  ipcMain.handle('notes-save',(event,id,draft)=>{trusted(event);return getNotesStore().save(id,draft);});
  ipcMain.handle('note-tracker',(event,operation,noteId,trackerId,data)=>{
    trusted(event);
    const {NoteTrackers,tracker}=require('./note-trackers.cjs');
    const notes=getNotesStore(), store=new NoteTrackers(notes);
    if(operation==='new')return tracker('blank');
    if(operation==='list')return store.list(noteId,trackerId,data);
    if(operation==='get')return store.get(noteId,trackerId,data);
    if(operation==='save')return store.save(noteId,trackerId,data);
    if(operation==='thumbnail')return store.setThumbnail(noteId,trackerId,data.id,data.assetId);
    if(operation==='move')return store.move(noteId,trackerId,data.id,data.status);
    if(operation==='delete')return store.remove(noteId,trackerId,data);
    if(operation==='convert'){
      const draft=notes.get(noteId), table=draft.blocks[data];
      if(table?.type!=='table')throw Error('Select a plain table.');
      const block=tracker('blank'), [head,...rows]=table.rows;
      if(head[0].length>120||head.slice(1).some(label=>label.length>80)||rows.some(row=>row[0].trim().length>200))
        throw Error('Shorten long column headings and record titles before converting this table.');
      block.title=head[0]||'Tracker';
      block.fields=head.slice(1).map((label,i)=>({key:'f'+i,label:label||'Column '+(i+2),type:'text'}));
      draft.blocks[data]=block;
      library.db.exec('SAVEPOINT convert_tracker');
      try{
        notes.save(noteId,draft);
        for(const [title,...values] of rows){
          if(!title.trim()&&!values.some(value=>value.trim()))continue;
          store.save(noteId,block.id,{title:title.trim()||'Untitled record',properties:Object.fromEntries(values.map((value,i)=>['f'+i,value]))});
        }
        library.db.exec('RELEASE convert_tracker');
        return notes.get(noteId);
      }catch(error){
        library.db.exec('ROLLBACK TO convert_tracker; RELEASE convert_tracker');
        throw error;
      }
    }
    throw Error('Unknown tracker action.');
  });
  ipcMain.handle('note-movie-link',async(event,value)=>{
    trusted(event);
    const url=new URL(value);
    if(!/^https?:$/.test(url.protocol)||!/(^|\.)(imdb\.com|letterboxd\.com|rottentomatoes\.com|themoviedb\.org)$/i.test(url.hostname))
      throw Error('Paste an IMDb, Letterboxd, Rotten Tomatoes or TMDB title link.');
    const {ids:[id]}=await bookmarks.save(url.href,null);
    if(!event.sender.isDestroyed())event.sender.send('library-changed',[id]);
    const info=await bookmarks.get(id);
    return {id,url:url.href,title:info?.state==='ready'?info.title:'',year:Number(info?.details?.year)||null,
      genre:info?.details?.genre||'',type:info?.type==='series'?'Series':info?.type==='movie'?'Movie':'',cover:!!info?.cover};
  });
  ipcMain.handle('notes-reorder',(event,id,target)=>{trusted(event);return getNotesStore().reorder(id,target);});
  ipcMain.on('notes-dirty',(event,dirty)=>{trusted(event);notesDirty=dirty===true;});
  ipcMain.handle('notes-remove',async(event,id)=>{
    trusted(event);
    const note=getNotesStore().get(id);
    const answer=await dialog.showMessageBox(win,{type:'warning',message:'Delete “'+(note.title||'Untitled note')+'”?',detail:'The note and its featured image will be removed from this library.',buttons:['Cancel','Delete Note'],defaultId:0,cancelId:0});
    if(answer.response!==1)return false;
    getNotesStore().remove(id);
    return true;
  });
  ipcMain.handle('notes-cover',async(event,id,source)=>{
    trusted(event);
    if(source===true){getNotesStore().setCover(id,null,null);return false;}
    let file;
    if(typeof source==='string'){
      if(library.asset(source).trash)throw Error('This image is in Trash.');
      file=await thumbnail(source,true);
      if(!file)throw Error('This image could not be opened.');
    }else{
      const chosen=await dialog.showOpenDialog(win,{title:'Choose featured image',properties:['openFile'],filters:[{name:'Images',extensions:['jpg','jpeg','png','webp','heic','gif','tif','tiff']}]});
      if(chosen.canceled)return null;
      file=chosen.filePaths[0];
      const stat=await fs.promises.stat(file);
      if(!stat.isFile()||stat.size>30*1024*1024)throw Error('Choose an image smaller than 30 MB.');
    }
    const image=await nativeImage.createThumbnailFromPath(file,{width:1600,height:900});
    if(image.isEmpty())throw Error('This image could not be opened.');
    if(shutdownStarted||event.sender.isDestroyed())return null;
    getNotesStore().setCover(id,image.toJPEG(86),image.resize({width:96}).toJPEG(78));
    return true;
  });
  ipcMain.handle('canvas-create',(event,name)=>{trusted(event);return canvasStore.create(name);});
  ipcMain.handle('canvas-get',(event,id)=>{trusted(event);return canvasStore.get(id);});
  ipcMain.handle('canvas-rename',(event,id,name)=>{trusted(event);return canvasStore.rename(id,name);});
  ipcMain.handle('canvas-apply',(event,id,patch)=>{trusted(event);return canvasStore.apply(id,patch);});
  ipcMain.handle('canvas-add-assets',(event,id,ids,point,ratios)=>{trusted(event);return canvasStore.addAssets(id,ids,point,ratios);});
  ipcMain.handle('canvas-add-collection',(event,id,name,point)=>{trusted(event);return canvasStore.addCollection(id,name,point);});
  ipcMain.handle('canvas-menu',(event,id)=>{trusted(event);const board=canvasStore.summary(id);const menu=Menu.buildFromTemplate([{label:board.name,enabled:false},{id:'rename',label:'Rename Canvas…',click:()=>win.webContents.send('context-action',{action:'canvas-rename',boardId:id})},{id:'delete',label:'Delete Canvas…',click:()=>win.webContents.send('context-action',{action:'canvas-delete',boardId:id})}]);if(process.env.ASSET_TEST_MODE){global.canvasBoardMenu=menu;return;}menu.popup({window:win});});
  ipcMain.handle('canvas-remove',async(event,id)=>{trusted(event);const board=canvasStore.summary(id);const answer=await dialog.showMessageBox(win,{type:'question',message:'Delete “'+board.name+'”?',detail:'This removes the canvas layout, text and shapes. Its library files and collections stay intact.',buttons:['Cancel','Delete Canvas'],defaultId:0,cancelId:0});return answer.response===1?canvasStore.remove(id):{cancelled:true};});
  ipcMain.on('preview-zoom-active',(event,active)=>{
    trusted(event);previewZoomActive=active===true;
    if(!previewZoomActive)event.sender.setIgnoreMenuShortcuts(false);
  });
  ipcMain.on('canvas-dirty',(event,dirty)=>{trusted(event);canvasDirty=!!dirty;});
  ipcMain.on('canvas-flushed',(event,token,error)=>{trusted(event);const pending=canvasFlushWaiters.get(token);if(!pending)return;canvasFlushWaiters.delete(token);if(error)pending.reject(new Error(String(error)));else{canvasDirty=false;notesDirty=false;pending.resolve();}});
  ipcMain.handle('canvas-clipboard-write',(event,items)=>{trusted(event);if(!Array.isArray(items)||items.length>10000)throw new Error('Invalid canvas selection.');const buffer=Buffer.from(JSON.stringify(items.map(normalizeCanvasItem)));if(buffer.length>5*1024*1024)throw new Error('Copy fewer canvas items at once.');return clipboard.writeText('CanvasProItems\n'+buffer.toString('utf8'));});
  ipcMain.handle('canvas-clipboard-read',async event=>{trusted(event);const text=await clipboard.readText();if(!text.startsWith('CanvasProItems\n')||text.length>5*1024*1024)return null;try{const items=JSON.parse(text.slice(15));return Array.isArray(items)&&items.length<=10000?items.map(normalizeCanvasItem):null;}catch{return null;}});
  ipcMain.handle('canvas-drop-paths',async(event,id,paths,point)=>{trusted(event);canvasStore.summary(id);if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('Choose valid files.');const ids=[],external=[];for(const file of paths){const candidate=path.basename(file).slice(0,36);let asset;try{asset=library.asset(candidate);}catch{}if(asset&&path.resolve(file)===path.resolve(library.root,asset.stored))ids.push(asset.id);else external.push(file);}const result=external.length?await importPaths(external,null):{ids:[],errors:[]};const combined=[...new Set([...ids,...result.ids])];return {...(combined.length?canvasStore.addAssets(id,combined,point):{board:canvasStore.summary(id),items:[]}),importResult:result};});
  ipcMain.handle('cache-video-thumb',async(event,id,data)=>{
    trusted(event);
    const a=library.asset(id);
    const header='data:image/jpeg;base64,';
    if(!['mp4','webm','mov','m4v','ogv','mkv','avi','gifv','3gp','3g2','h265','hevc'].includes(a.ext)||typeof data!=='string'||data.length>3000000||!data.startsWith(header))throw Error('Invalid video preview.');
    if(library.deleting.has(id))return;
    const key=id+':browser';
    if(thumbPending.has(key))return thumbPending.get(key);
    const bytes=Buffer.from(data.slice(header.length),'base64');
    const image=nativeImage.createFromBuffer(bytes);
    const {width,height}=image.getSize();
    if(image.isEmpty()||Math.max(width,height)>galleryEdge)throw Error('Invalid preview.');
    const base=path.join(library.root,'thumbnails',id);
    const temp=base+'.thumb-v2.part.jpg';
    const write=(async()=>{
      try{
        await fs.promises.writeFile(temp,bytes);
        await fs.promises.rename(temp,base+'.thumb-v2.jpg');
        await fs.promises.rm(base+'.png',{force:true}).catch(()=>{});
        thumbnailMisses.delete(id);
        return true;
      }finally{
        await fs.promises.rm(temp,{force:true}).catch(()=>{});
      }
    })();
    thumbPending.set(key,write);
    try{return await write;}finally{thumbPending.delete(key);}
  });
  ipcMain.handle('save-feedback',async(event,data)=>{trusted(event);const chosen=await dialog.showSaveDialog(win,{title:'Save beta feedback',defaultPath:'Canvas Pro feedback.json'});if(chosen.canceled)return {cancelled:true};const report={app:require('../package.json').version,platform:process.platform,architecture:process.arch,os:require('node:os').release(),at:new Date().toISOString(),notes:String(data.notes||'').slice(0,20000),checks:Array.isArray(data.checks)?data.checks.slice(0,20):[]};await fs.promises.writeFile(chosen.filePath,JSON.stringify(report,null,2));return {saved:true};});
  ipcMain.handle('canvas-export',async(event,data)=>{trusted(event);if(!['png','pdf'].includes(data.format)||!Number.isFinite(data.width)||!Number.isFinite(data.height)||data.width<1||data.height<1||data.width>16000||data.height>16000||data.width*data.height>64000000)throw Error('Choose a smaller export area.');let basename=String(data.name||'Canvas').trim().slice(0,120).replace(/[/\\:\x00-\x1f]/g,'-').replace(/^\.+/,'').trim();
    while(Buffer.byteLength(basename)>240)basename=basename.slice(0,-1);
    const name=(basename||'Canvas')+'.'+data.format;
    if(data.destination==='library'){
      if(data.format!=='png')throw Error('Save moodboards to Files as PNG.');
      const dir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'canvas-snapshot-'));
      try{
        const file=path.join(dir,name);
        await fs.promises.writeFile(file,canvasPNG(data.png));
        const result=await importPaths([file],null);
        if(!result.ids?.length)throw Error(result.errors?.[0]?.message||'Could not save the moodboard to Files.');
        return {saved:true,id:result.ids[0],duplicate:!result.imported};
      }finally{await fs.promises.rm(dir,{recursive:true,force:true});}
    }
    const chosen=await dialog.showSaveDialog(win,{title:'Export canvas',defaultPath:name,filters:[{name:data.format.toUpperCase(),extensions:[data.format]}]});if(chosen.canceled)return {cancelled:true};
    if(data.format==='png')await fs.promises.writeFile(chosen.filePath,canvasPNG(data.png));
    else {
      if(typeof data.svg!=='string'||data.svg.length>150000000)throw Error('Export is too large.');
      const dir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'canvas-pdf-'));
      let printer;
      try {
        const file=path.join(dir,'export.html');
        const url=pathToFileURL(file).href;
        const head=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{margin:0}html,body{margin:0}svg{display:block;width:100%;height:100%}</style>`;
        await fs.promises.writeFile(file,[head,data.svg],{mode:0o600});
        printer=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,partition:'canvas-export-'+crypto.randomUUID()}});
        printer.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!==url&&!details.url.startsWith('data:')}));
        await printer.loadFile(file);
        const pdf=await printer.webContents.printToPDF({printBackground:true,pageSize:{width:data.width/96,height:data.height/96},margins:{top:0,bottom:0,left:0,right:0}});
        await fs.promises.writeFile(chosen.filePath,pdf);
      } finally {
        if(printer&&!printer.isDestroyed())printer.destroy();
        await fs.promises.rm(dir,{recursive:true,force:true});
      }
    }
    return {saved:true};
  });
  ipcMain.handle('workbench',async(event,op,data={})=>{trusted(event);
    if(op==='state')return {icons:workbench.icons(),backup:workbench.pref('lastBackup'),reminders:workbench.pref('backupReminders')!==false,total:library.db.prepare('SELECT COUNT(*) n,SUM(size) bytes FROM assets').get(),root:library.root};
    if(op==='history')return workbench.history(!!data.redo);
    if(op==='icon')return workbench.icon(data.key,data.icon);
    if(op==='duplicates')return workbench.duplicates();
    if(op==='similar')return workbench.similar(data.id);
    if(op==='retry-index'){
      thumbnailMisses.clear();
      const rows=data.ids?data.ids.map(id=>({id,retryNative:1})):library.db.prepare(
        "SELECT s.id,json_extract(s.summary,'$.state')='unavailable' AS retryNative FROM asset_analysis s JOIN assets a ON a.id=s.id WHERE a.trash=0 AND (json_extract(s.summary,'$.state')='unavailable' OR json_extract(s.summary,'$.visualRetry') IS NOT NULL)").all();
      const retry=library.db.prepare("UPDATE asset_analysis SET version=CASE WHEN ? THEN 0 ELSE version END,summary=json_remove(summary,'$.visualRetry','$.visualAttempts') WHERE id=?");
      for(const {id,retryNative} of rows){
        library.asset(id);retry.run(Number(!!retryNative),id);
        if(retryNative)smartIndex.queue.add(id);
      }
      workbench.pref('indexPaused',false);return smartIndex.pause(false);
    }
    if(op==='reminders')return workbench.pref('backupReminders',!!data.enabled);
    if(op==='recover'){thumbnailMisses.clear();const chosen=await dialog.showOpenDialog(win,{title:'Locate matching original',properties:['openFile']});if(chosen.canceled)return {cancelled:true};return workbench.recover(data.id,chosen.filePaths[0]);}
    if(op==='backup'){await flushWorkspaces();const chosen=await dialog.showSaveDialog(win,{title:'Back up library',defaultPath:path.join(app.getPath('documents'),'Canvas Pro Backup '+new Date().toISOString().slice(0,10)+'.canvaslibrary'),buttonLabel:'Back up'});if(chosen.canceled)return {cancelled:true};return workbench.backup(chosen.filePath);}
    throw Error('Unknown library tool.');
  });
  ipcMain.handle('assistant-state', event => { trusted(event); return getAssistant().state(); });
  ipcMain.handle('assistant-download', event => { trusted(event); return getAssistant().download(); });
  ipcMain.handle('assistant-cancel', event => { trusted(event); getAssistant().cancel(); });
  ipcMain.handle('assistant-stop', event => { trusted(event); getAssistant().stop(); });
  ipcMain.handle('assistant-plan', (event, command, context) => { trusted(event); return getAssistant().plan(command, context); });
  ipcMain.handle('assistant-filename-matches', (event, query, extensions = []) => {
    trusted(event);
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Invalid filename search.');
    if (!Array.isArray(extensions) || extensions.length > 100 || extensions.some(ext => typeof ext !== 'string' || ext.length > 12)) throw new Error('Invalid file types.');
    return library.filenameMatches(query.trim(), extensions);
  });
  ipcMain.handle('assistant-create-collection', (event, root, name, ids) => {
    trusted(event);
    if (root !== library.root) throw new Error('The library changed. Submit the command again.');
    if (workbench.backingUp) throw new Error('Wait for the library backup to finish.');
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || !Array.isArray(ids)) throw new Error('Invalid collection.');
    library.createCollectionWithAssets(name.trim(), ids);
  });
  ipcMain.handle('assistant-folder', async event => {
    trusted(event);
    const { folder } = getAssistant().state();
    await require('node:fs/promises').mkdir(folder, { recursive: true, mode: 0o700 });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  ipcMain.handle('assistant-terms', event => {
    trusted(event);
    return shell.openExternal('https://ai.google.dev/gemma/terms');
  });
  ipcMain.handle('assistant-web', (event, query) => {
    trusted(event);
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Invalid search.');
    const url = new URL('https://duckduckgo.com/');
    url.searchParams.set('q', query);
    return shell.openExternal(url.href);
  });
  ipcMain.handle('model-state',event=>{trusted(event);return localModel.state();});
  ipcMain.handle('model-download',event=>{trusted(event);return localModel.download();});
  ipcMain.handle('model-cancel',event=>{trusted(event);return localModel.cancel();});
  ipcMain.handle('copy-color',(event,value)=>{trusted(event);if(!/^#[a-f0-9]{6}$/i.test(value))throw Error('Invalid colour.');return clipboard.writeText(value);});
  ipcMain.handle('smart-state',event=>{trusted(event);return {...smartIndex.state(),idleOnly:workbench.pref('indexIdleOnly')!==false};});
  ipcMain.handle('smart-idle-policy',(event,value)=>{
    trusted(event);
    if(typeof value!=='boolean')throw Error('Choose a valid indexing policy.');
    workbench.pref('indexIdleOnly',value);updateIndexPower();
    return {...smartIndex.state(),idleOnly:value};
  });
  ipcMain.handle('smart-pause',(event,value)=>{trusted(event);return (workbench.pref('indexPaused',!!value),smartIndex.pause(value));});
  ipcMain.handle('smart-search',(event,query,vector)=>{trusted(event);return smartIndex.search(String(query).slice(0,500),vector);});
  ipcMain.handle('smart-next-work',event=>{trusted(event);return {...smartIndex.nextVisualWork(),delay:canAccelerateIndex()?250:650};});
  ipcMain.handle('smart-vector-skip',(event,id)=>{trusted(event);return smartIndex.deferVisual(id);});
  ipcMain.handle('smart-vector',(event,id,vector)=>{trusted(event);return smartIndex.put(id,{vector});});
  ipcMain.handle('smart-analyze',(event,id)=>{trusted(event);return smartIndex.analyze(id);});
  ipcMain.handle('link-reader',(event,id)=>{trusted(event);return bookmarks.reader(id);});
  ipcMain.handle('link-info',(event,id,force)=>{trusted(event);return bookmarks.get(id,{force:!!force});});
  ipcMain.handle('web-preview-open',(event,id,token,rect)=>{trusted(event);if(typeof token!=='string'||token.length>100)throw new Error('Invalid preview.');if(!webPreview)webPreview=new WebPreview({electron:require('electron'),window:win,library,resolveLink:id=>bookmarks.resolveURL(id),onSaved:()=>{if(win&&!win.isDestroyed())win.webContents.send('library-changed');}});if(process.env.ASSET_TEST_MODE)global.canvasWebPreview=webPreview;return webPreview.open(id,token,rect);});
  ipcMain.on('web-preview-bounds',(event,token,rect)=>{trusted(event);if(webPreview?.token===token)webPreview.bounds(rect);});
  ipcMain.on('web-preview-close', (event,token)=>{trusted(event);webPreview?.detach(token);});
  ipcMain.handle('web-preview-command',(event,token,command)=>{trusted(event);return webPreview?.command(token,command);});
  ipcMain.handle('web-preview-save',(event,token)=>{trusted(event);return webPreview?.saveCopy(token);});
  ipcMain.handle('capture-assets',(event,ids)=>{
    trusted(event);
    if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id)))throw new Error('Invalid captured assets.');
    return library.list(ids);
  });
  function libraryNavigation(){
    return {navigation:library.navSummary(),folders:library.folders(),folderRecords:library.folderRecords(),
      canvases:canvasStore.list(),prototype:!!process.env.CANVAS_PROTOTYPE,workbench:{icons:workbench.icons()}};
  }
  ipcMain.handle('library-navigation',event=>{trusted(event);return libraryNavigation();});
  ipcMain.handle('library-page',(event,data={})=>{
    trusted(event);
    const offset=Math.max(0,Math.min(10000000,Math.floor(Number(data.offset)||0)));
    const limit=Math.max(1,Math.min(500,Math.floor(Number(data.limit)||120)));
    const result=library.page({offset,limit,view:String(data.view||'all'),folder:String(data.folder||'').slice(0,120),
      tag:String(data.tag||'').slice(0,500),sort:String(data.sort||'new'),query:String(data.query||'').toLowerCase().slice(0,500),
      other:data.other===true,knownExtensions:Array.isArray(data.knownExtensions)?data.knownExtensions.filter(value=>typeof value==='string').slice(0,100):[],
      extensions:Array.isArray(data.extensions)?data.extensions.filter(value=>typeof value==='string').slice(0,100):[],
      matches:Array.isArray(data.matches)?data.matches.filter(value=>typeof value==='string').slice(0,3000):[]});
    if(data.navigation)Object.assign(result,libraryNavigation());
    return result;
  });
  ipcMain.handle('list', () => ({ assets: library.list(), folders: library.folders(), root: library.root,canvases:canvasStore.list(),folderRecords:library.folderRecords(),prototype:!!process.env.CANVAS_PROTOTYPE,workbench:{icons:workbench.icons()} }));
  function checkedAssets(ids){return library.selectedAssets(ids);}
  async function deleteFromTrash(ids,empty=false){
    const records=checkedAssets(ids);if(records.some(a=>!a.trash))throw new Error('Only files in Trash can be permanently deleted.');
    if(workbench.backingUp)throw Error('Wait for the library backup to finish.');
    const count=records.length;const answer=await dialog.showMessageBox(win,{type:'warning',message:empty?'Empty Trash?':`Delete ${count===1?'this file':count+' files'} permanently?`,detail:`This permanently removes ${count===1?'the file':count+' files'} and their originals, thumbnails, cover artwork, waveforms and cached previews from Canvas Pro’s library. It cannot be undone. Source files outside the library are not removed.`,buttons:['Cancel',empty?'Empty Trash':'Delete Permanently'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1)return {deleted:0,cancelled:true};
    try{const result=await library.permanentDelete(records.map(a=>a.id),{beforeRemove:async deleting=>{
      await Promise.all([mediaCache.cancelAndDrain(deleting),bookmarks.cancelAndDrain(deleting)]);const set=new Set(deleting);for(let i=thumbnailQueue.length-1;i>=0;i--)if(set.has(thumbnailQueue[i].id)){const [job]=thumbnailQueue.splice(i,1);job.resolve(null);}
      await Promise.allSettled(deleting.map(id=>Promise.all([thumbPending.get(id),thumbPending.get(id+':preview'),thumbPending.get(id+':browser'),...[...previewSizes].map(size=>thumbPending.get(id+':detail-'+size))].filter(Boolean))).filter(Boolean));
    }});for(const id of result.ids){thumbnailMisses.delete(id);thumbnailMisses.delete(id+':preview');for(const size of previewSizes)thumbnailMisses.delete(id+':detail-'+size);}try{await win.webContents.session.clearCache();}catch(e){console.error('Preview cache cleanup:',e.message);}win.webContents.send('library-changed');return result;}finally{mediaCache.unblock(records.map(a=>a.id));if(win&&!win.isDestroyed())win.webContents.send('library-changed');}
  }
  ipcMain.handle('delete-permanently',(_,ids)=>deleteFromTrash(ids));
  ipcMain.handle('empty-trash',()=>{const ids=library.db.prepare('SELECT id FROM assets WHERE trash=1').all().map(a=>a.id);return ids.length?deleteFromTrash(ids,true):{deleted:0};});
  ipcMain.handle('rename-collection',(_,oldName,newName)=>library.renameCollection(oldName,newName));
  ipcMain.handle('remove-collection',async(_,name)=>{if(!library.folders().includes(name))throw new Error('Collection not found.');const answer=await dialog.showMessageBox(win,{type:'question',message:'Remove “'+name+'”?',detail:'The collection will be removed. Its files will remain in your library.',buttons:['Cancel','Remove Collection'],defaultId:0,cancelId:0});if(answer.response!==1)return {cancelled:true};library.removeCollection(name);return {removed:true};});
  ipcMain.handle('share-files',(_,ids)=>{const records=checkedAssets(ids);const sharingItem={filePaths:records.map(a=>library.file(a.id))};const menu=new ShareMenu(sharingItem);menu.popup({browserWindow:win});});
  ipcMain.handle('open-file',async(_,id)=>{const error=await shell.openPath(library.file(id));if(error)throw new Error(error);});
  ipcMain.handle('copy-source',(_,id)=>{const url=library.asset(id).url;if(!/^https?:\/\//i.test(url))throw new Error('No web source is saved for this file.');return clipboard.writeText(url);});
  ipcMain.handle('file-context-menu',(_,ids,currentCollection)=>{
    const records=checkedAssets(ids).map(a=>({...a,tags:JSON.parse(a.tags),folders:JSON.parse(a.folders)}));
    const template=contextTemplate({assets:records,folders:library.folders(),canvases:canvasStore.list(),currentCollection,platform:process.platform,paths:records.flatMap(a=>{try{return [library.file(a.id)];}catch{return [];}})},payload=>{if(win&&!win.isDestroyed())win.webContents.send('context-action',payload);});
    const menu=Menu.buildFromTemplate(template);if(process.env.ASSET_TEST_MODE){global.canvasFileMenu=menu;return template.map(item=>({id:item.id,label:item.label,role:item.role,submenu:item.submenu?.map(sub=>({label:sub.label,type:sub.type}))}));}menu.popup({window:win});
  });
  ipcMain.handle('collection-context-menu',(_,name)=>{if(!library.folders().includes(name))throw new Error('Collection not found.');const menu=Menu.buildFromTemplate([{label:name,enabled:false},{type:'separator'},{label:'Add to Canvas…',click:()=>win.webContents.send('context-action',{action:'canvas-collection',name})},{label:'Choose Icon…',click:()=>win.webContents.send('context-action',{action:'choose-icon',key:'folder:'+library.folderRecords().find(f=>f.name===name).id})},{label:'Rename Collection…',click:()=>win.webContents.send('context-action',{action:'rename-collection',name})},{label:'Remove Collection…',click:()=>win.webContents.send('context-action',{action:'delete-collection',name})}]);if(process.env.ASSET_TEST_MODE){global.canvasCollectionMenu=menu;return;}menu.popup({window:win});});
  ipcMain.handle('bulk-update',(_,ids,operation)=>workbench.change(ids,()=>library.updateMany(ids,operation),'Edit selection'));
  ipcMain.handle('read-text',async(_,id)=>{const a=library.asset(id);if(!['md','txt','json','csv','css','js','ts','log','xml'].includes(a.ext)||a.size>2*1024*1024)throw new Error('Text preview is unavailable for this file.');return fs.promises.readFile(library.file(id),'utf8');});
  function registerBrowserConnection(){
    const testHome=process.env.ASSET_TEST_MODE?process.env.CANVAS_TEST_BROWSER_HOME:null;
    if(process.platform!=='darwin'||process.env.CANVAS_PROTOTYPE||(process.env.ASSET_TEST_MODE&&!testHome))return null;
    const bundle=path.resolve(process.execPath,'../../..');
    if(!bundle.endsWith('.app')||path.resolve(app.getAppPath())!==path.join(bundle,'Contents/Resources/app'))return null;
    // A disk image or a translocated copy has a temporary path. Only a copied app registers the host.
    if (!testHome && (bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/'))) return null;
    return require('./extension-setup.cjs').installExtension({appPath:bundle,extensionSource:path.join(app.getAppPath(),'chrome-extension'),...(testHome?{homeDirectory:testHome}:{})});
  }
  ipcMain.handle('show-extension',event=>{
    trusted(event);
    const setup=registerBrowserConnection();
    return shell.openPath(setup?.extension||path.join(app.getPath('appData'),'Canvas Pro/Browser Extension'));
  });
  ipcMain.handle('update', (_, id, changes) => {workbench.change([id],()=>library.update(id, changes));const saved=library.asset(id);return {...saved,tags:JSON.parse(saved.tags),folders:JSON.parse(saved.folders)};});
  ipcMain.handle('folder', (_, name) => library.addFolder(name));
  ipcMain.handle('import-dialog', async (_, folder, directory) => {
    const r = await dialog.showOpenDialog(win, { properties: directory ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
    return r.canceled ? null : importPaths(r.filePaths, folder);
  });
  ipcMain.handle('note-import-thumbnail',async(event,extensions)=>{
    trusted(event);
    const images=(Array.isArray(extensions)?extensions:[]).filter(ext=>typeof ext==='string'&&/^[a-z0-9]{1,8}$/.test(ext)).slice(0,40);
    if(!images.length)throw Error('No supported image formats.');
    const chosen=await dialog.showOpenDialog(win,{
      title:'Import a thumbnail',defaultPath:app.getPath('downloads'),
      properties:['openFile'],filters:[{name:'Images',extensions:images}]
    });
    if(chosen.canceled)return null;
    const file=chosen.filePaths[0];
    if(!images.includes(path.extname(file).slice(1).toLowerCase())||!(await fs.promises.stat(file)).isFile())
      throw Error('Choose a supported image file.');
    const result=await importPaths([file],null);
    if(!result.ids.length)throw Error(result.errors[0]||'The image was not imported.');
    return library.asset(result.ids[0]);
  });
  ipcMain.handle('import-url',(_,url,folder)=>importURL(url,folder));
  ipcMain.handle('import-paths', (_, paths, folder) => {
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('Invalid file paths');
    return importPaths(paths, folder);
  });
  const ratioUpdates=new Map();let ratioTimer;
  ipcMain.on('asset-ratio',(_,id,ratio)=>{if(typeof id!=='string'||!Number.isFinite(ratio)||ratio<=0||ratio>=100000)return;ratioUpdates.set(id,ratio);clearTimeout(ratioTimer);ratioTimer=setTimeout(()=>{try{library.setAspectRatios([...ratioUpdates]);ratioUpdates.clear();}catch{}},200);});
  app.on('before-quit',()=>{clearTimeout(ratioTimer);if(ratioUpdates.size)library.setAspectRatios([...ratioUpdates]);});
  ipcMain.handle('media-info', (_,id,priority) => mediaCache.get(id,!!priority));
  ipcMain.on('visible-assets', (_,ids) => { if(Array.isArray(ids)&&ids.length<=300){setVisibleThumbnails(ids);mediaCache.setVisible(ids);bookmarks.setVisible(ids);} });
  ipcMain.on('drag-file', async(event,value)=>{
    try {const ids=Array.isArray(value)?value:[value];const files=checkedAssets(ids).map(a=>library.file(a.id));const icon=await app.getFileIcon(files[0],{size:'normal'});event.sender.startDrag({file:files[0],files,icon});}catch{}
  });
  ipcMain.handle('open-link', (_,id) => {const url=new URL(library.asset(id).url);if(['http:','https:'].includes(url.protocol))return shell.openExternal(url.href);});
  ipcMain.handle('paste', async (_, folder) => {
    if (process.platform === 'darwin') {
      const script = `ObjC.import('AppKit'); const p = $.NSPasteboard.generalPasteboard; const a = p.propertyListForType('NSFilenamesPboardType'); a ? JSON.stringify(ObjC.deepUnwrap(a)) : '[]';`;
      try {const {stdout}=await run('/usr/bin/osascript',['-l','JavaScript','-e',script]);const paths=JSON.parse(stdout.trim()||'[]');if(paths.length)return importPaths(paths,folder);} catch { }
    }
    const data=await clipboardData(clipboard);
    if(data.image){
      const image=nativeImage.createFromBuffer(data.image.buffer);
      if(!image.isEmpty())return importBuffer(image.toPNG(),'Clipboard '+new Date().toISOString().replaceAll(':','-')+'.png',folder);
      throw new Error('This clipboard image format could not be read. Try copying the image itself.');
    }
    if(data.url)return importURL(data.url,folder);
    if(data.text?.trim()){const text=data.text.trim().slice(0,2000000),result=await importBuffer(Buffer.from(text),'Note '+new Date().toISOString().replaceAll(':','-')+'.txt',folder);for(const id of result.ids)library.setCaptureMetadata(id,{kind:'content',selection:true,textExcerpt:text.slice(0,2000)});return result;}
    return {imported:0,duplicates:0,errors:['Copy files, an image, or a web link, then paste here.'],skipped:0};
  });
  ipcMain.handle('copy-files',async(_,ids)=>{
    const files=checkedAssets(ids).map(a=>library.file(a.id));
    const script=`ObjC.import('AppKit');const files=${JSON.stringify(files)};const urls=$.NSMutableArray.array;for(const file of files)urls.addObject($.NSURL.fileURLWithPath(file));const p=$.NSPasteboard.generalPasteboard;p.clearContents;p.writeObjects(urls);`;
    const dir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'canvas-copy-'));try{const file=path.join(dir,'copy.js');await fs.promises.writeFile(file,script);await run('/usr/bin/osascript',['-l','JavaScript',file]);}finally{await fs.promises.rm(dir,{recursive:true,force:true});}
  });
  ipcMain.handle('export-files',async(_,ids)=>{
    const assets=checkedAssets(ids);
    const chosen=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory'],buttonLabel:'Export copies'});if(chosen.canceled)return 0;
    for(const a of assets){const base=path.basename(a.name).replace(/[\/\\]/g,'_')||'File';let target=path.join(chosen.filePaths[0],base),counter=1;while(fs.existsSync(target)){const parts=path.parse(base);target=path.join(chosen.filePaths[0],parts.name+' ('+(counter++)+')'+parts.ext);}await fs.promises.copyFile(library.file(a.id),target,fs.constants.COPYFILE_EXCL);}return assets.length;
  });
  ipcMain.handle('reveal', (_, id) => shell.showItemInFolder(library.file(id)));
  ipcMain.handle('quick-look', async (_, id) => {
    if (process.platform === 'darwin') win.previewFile(library.file(id), library.asset(id).name);
  });
  ipcMain.handle('export', async (_, id) => {
    const a = library.asset(id); const r = await dialog.showSaveDialog(win, { defaultPath: a.name });
    if (!r.canceled) await fs.promises.copyFile(library.file(id), r.filePath);
  });
  ipcMain.handle('show-library', () => shell.openPath(library.root));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { label: 'File', submenu: [{label:'New Library…',click:()=>changeLibrary('new')},{label:'Open Library…',click:()=>changeLibrary('open')},{type:'separator'},{ label: 'Import files…', accelerator: 'CmdOrCtrl+O', click: () => openImportWindow().catch(error=>console.error('Import menu:',error.message)) }, { label: 'Show library folder', click: () => shell.openPath(library.root) }, { role: 'close' }] },
    {label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>win?.webContents.send('history-command',false)},{label:'Redo',accelerator:'CmdOrCtrl+Shift+Z',click:()=>win?.webContents.send('history-command',true)},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]}, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]));
  createWindow();
  const bridgeDirectory=(process.env.ASSET_TEST_MODE||process.env.CANVAS_PROTOTYPE)?path.join(app.getPath('userData'),'Bridge'):path.join(app.getPath('appData'),'Canvas Pro/Bridge');
  captureBridge=new CaptureBridge({library,directory:bridgeDirectory,fetcher:(url,options)=>net.fetch(url,options),onChange:ids=>{if(win&&!win.isDestroyed())win.webContents.send('library-changed',ids);},onStatus:status=>{if(win&&!win.isDestroyed())win.webContents.send('capture-status',status);}});
  try{await captureBridge.start();}catch(e){console.error('Browser capture bridge:',e.message);}
  setImmediate(()=>{
    try{
      const setup=registerBrowserConnection();
      if(setup?.failures.length)console.error('Browser connection:',setup.failures.join('; '));
    }catch(error){console.error('Browser connection:',error.message);}
  });
  app.on('activate', () => ensureWindow());
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let shutdownStarted=false,shutdownComplete=false;
app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(shutdownStarted)return;shutdownStarted=true;
  flushWorkspaces().then(()=>Promise.allSettled([bookmarks?.close(),webPreview?.close(),importQueue?.close(),captureBridge?.close(),smartIndex?.close(),localModel?.close(),assistantService?.close(),workbench?.close(),healthService?.cancel(),mediaCache?.cancelAndDrain([...mediaCache.pending.keys()])])).then(()=>{pendingLibrarySwitch?.();pendingLibrarySwitch=null;shutdownComplete=true;app.quit();}).catch(error=>{shutdownStarted=false;dialog.showErrorBox('Workspace could not be saved',error.message);});
});
app.on('will-quit', () => {library?.close();});
module.exports = { importBuffer, importURL };
