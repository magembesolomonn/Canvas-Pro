const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell, protocol, net, Menu, ShareMenu, nativeTheme, powerMonitor, screen } = require('electron');
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
const {previewFetch}=require('./browser-fetch.cjs');
const {Bookmarks,webURL}=require('./bookmarks.cjs');
const {resolveSocialVideo}=require('./social-video.cjs');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {WebPreview}=require('./web-preview.cjs');
const {SmartIndex}=require('./smart-index.cjs');
const {LocalModel}=require('./local-model.cjs');
const { CaptureBridge } = require('./capture-bridge.cjs');
const {YtDlp}=require('./yt-dlp.cjs');
const {contextTemplate}=require('./file-menu.cjs');
const {ImportQueue}=require('./import-queue.cjs');
const {Workbench}=require('./workbench.cjs');
const {hashFile}=require('./perceptual-hash.cjs');
const {HealthService}=require('./health-service.cjs');
const {createOriginalsWatch}=require('./originals-watch.cjs');
const {Updater}=require('./updater.cjs');
const {SymbolRenderer}=require('./symbol-render.cjs');
const {networkBypassEnabled,signedUpdatesRequired}=require('./test-mode.cjs');
process.on('uncaughtException', error => {
  console.error('Unhandled exception in main process:', error);
});
process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection in main process:', reason);
});
app.setName(process.env.CANVAS_PROTOTYPE?'Canvas Pro Prototype':'Canvas Pro');
const testMode=!!process.env.ASSET_TEST_MODE;
const testNetworkBypass=networkBypassEnabled(process.env,process.defaultApp);
const legacyData=path.join(app.getPath('appData'),'Asset Library');
if(fs.existsSync(path.join(legacyData,'Library/library.sqlite')))app.setPath('userData',legacyData);
protocol.registerSchemesAsPrivileged([{ scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },{ scheme: 'symbol', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.AGAGWU_DATA_DIR) {
  fs.mkdirSync(process.env.AGAGWU_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.AGAGWU_DATA_DIR);
}
if(!testMode&&!app.requestSingleInstanceLock()){app.quit();return;}
let win, library, mediaCache, captureBridge, importQueue, healthService,bookmarks,webPreview,canvasStore,smartIndex,localModel,workbench,originalsWatch,updater,videoDownloader,floatingWindow;
let floatingBounds=null;
function closeFloating(){
 if(!floatingWindow)return;
 if(!floatingWindow.isDestroyed())floatingWindow.close();
 floatingWindow=null;
}
let pendingLibrarySwitch=null;
// Files dropped on the Dock icon, or opened with Canvas Pro from Finder, arrive
// as open-file events. They are collected until the library is ready, then
// imported, so a drop during launch is not lost.
const pendingOpenFiles=[];
let openFilesReady=false;
function drainOpenFiles(){
 if(!openFilesReady||!pendingOpenFiles.length)return;
 const paths=pendingOpenFiles.splice(0,pendingOpenFiles.length).filter(file=>{try{return fs.statSync(file).isFile();}catch{return false;}});
 if(!paths.length)return;
 ensureWindow();
 importPaths(paths,null).catch(error=>console.error('Open with Canvas Pro:',error.message));
}
app.on('open-file',(event,file)=>{event.preventDefault();pendingOpenFiles.push(file);drainOpenFiles();});
let previewZoomActive=false;
let canvasDirty=false;const canvasFlushWaiters=new Map();
function flushWorkspaces(){if(!canvasDirty||!win||win.isDestroyed())return Promise.resolve();const token=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{canvasFlushWaiters.delete(token);reject(new Error('Workspace changes could not be saved. Please retry before closing.'));},8000);canvasFlushWaiters.set(token,{resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}});win.webContents.send('canvas-flush-request',token);});}
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
async function downloadMediaToTemp(mediaUrl,pageUrl,title,kind='video'){
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','video/mp4':'mp4','video/x-m4v':'m4v','video/3gpp':'3gp','video/webm':'webm','video/quicktime':'mov','audio/mpeg':'mp3','audio/mp4':'m4a','audio/wav':'wav'};
  const tempDir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'canvas-social-'));
  try{
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),300000);
    try{
      // Large videos take longer than the 12-second preview default; the
      // controller above is the real 5-minute deadline.
      const response=await publicFetch(mediaUrl,{signal:controller.signal,timeout:300000,referrer:pageUrl,referrerPolicy:'strict-origin-when-cross-origin'});
      if(!response.ok)throw new Error('Download failed ('+response.status+')');
      const type=(response.headers.get('content-type')||'').split(';')[0].trim();
      let ext=extensions[type];
      if(!ext&&type==='application/octet-stream'){const candidate=path.extname(new URL(mediaUrl).pathname).slice(1).toLowerCase();if(['mp4','m4v','3gp','webm','mov','jpg','jpeg','png','gif','webp','mp3','m4a'].includes(candidate))ext=candidate;}
      if(!ext){
        const candidate=path.extname(new URL(mediaUrl).pathname).slice(1).toLowerCase().replace('jpeg','jpg');
        if(['mp4','m4v','3gp','webm','mov','jpg','png','gif','webp','mp3','m4a'].includes(candidate)) ext=candidate;
      }
      if(kind==='video' && !['mp4','m4v','3gp','webm','mov'].includes(ext||'')) throw new Error('No downloadable video file found');
      if(kind==='image' && !['jpg','png','gif','webp','avif'].includes(ext||'')) throw new Error('No downloadable image found');
      const limit=kind==='video'?1024*1024*1024:100*1024*1024;
      if(Number(response.headers.get('content-length'))>limit) throw new Error('Media is too large');
      const safe=(String(title||'Social media').replace(/[\x00-\x1f/\\:*?"<>|]/g,' ').trim().slice(0,120)||'Social media')+'.'+ext;
      const file=path.join(tempDir,safe); let size=0;
      const count=new Transform({transform(chunk,_e,cb){size+=chunk.length; if(size>limit) return cb(new Error('Media is too large')); cb(null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),count,fs.createWriteStream(file),{signal:controller.signal});
      return {file,tempDir};
    }finally{clearTimeout(timer);}
  }catch(e){await fs.promises.rm(tempDir,{recursive:true,force:true}); throw e;}
}
async function importSocialMediaURL(value,folder){
  const resolved=await resolveSocialVideo(value).catch(()=>null);
  if(!resolved?.items?.length) return null;
  const results={imported:0,duplicates:0,errors:[],skipped:0,ids:[]};
  for(const item of resolved.items){
    try{
      const dl=await downloadMediaToTemp(item.mediaUrl,resolved.permalink,item.title||'Post',item.kind==='video'?'video':'image');
      try{
        const imported=await library.importFile(dl.file,folder||null);
        const id=imported.imported||imported.duplicate;
        if(id){
          const metadata={kind:item.kind,mediaUrl:item.mediaUrl,pageUrl:resolved.permalink,pageTitle:item.title||resolved.permalink,sourceUrl:resolved.permalink,title:item.title||'Post',author:item.author||'',description:item.description||'',capturedAt:new Date().toISOString(),...(resolved.notice?{note:resolved.notice}:{})};
          try{library.setCaptureMetadata(id,metadata);}catch{}
          try{if(!library.asset(id).url)library.update(id,{url:resolved.permalink});}catch{}
          if(item.width&&item.height)try{library.setAspectRatios([[id,item.width/item.height]]);}catch{}
          results.ids.push(id);
          if(imported.imported)results.imported++; else results.duplicates++;
        }
      }finally{await fs.promises.rm(dl.tempDir,{recursive:true,force:true});}
    }catch(e){results.errors.push((item.title||'Media')+': '+e.message);} 
  }
  if(!results.ids.length && results.errors.length) return null; // fall back to bookmark
  return results.ids.length?results:null;
}
async function importExtractableVideoURL(value,folder){
  if(!videoDownloader) return null;
  const {extractableVideoURL,isExtractableVideo}=require('./yt-dlp.cjs');
  const raw=webURL(value);
  const target=extractableVideoURL(raw)|| (isExtractableVideo(raw)?raw:'');
  if(!target) return null;
  const tempDir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'canvas-video-'));
  try{
    const file=await videoDownloader.download(target,tempDir,{title:'Video'});
    const destination=folder||null;
    const result=await library.importFile(file,destination);
    const id=result.imported||result.duplicate;
    if(id){
      try{library.setCaptureMetadata(id,{kind:'video',mediaUrl:target,pageUrl:raw,sourceUrl:raw,title:path.basename(file),capturedAt:new Date().toISOString()});}catch{}
      try{if(!library.asset(id).url)library.update(id,{url:raw});}catch{}
    }
    return {imported:result.imported?1:0,duplicates:result.duplicate?1:0,errors:[],skipped:0,ids:id?[id]:[]};
  }finally{await fs.promises.rm(tempDir,{recursive:true,force:true});}
}
async function importURL(value,folder){
  try{
    const video=await importExtractableVideoURL(value,folder);
    if(video) return video;
  }catch(e){
    // Fall through to other handlers; a bad/unsupported extractor result should
    // not prevent saving the link or trying other resolvers.
  }
  const social=await importSocialMediaURL(value,folder).catch(()=>null);
  if(social) return social;
  return bookmarks.save(value,folder);
}
function canvasPNG(value){
 if(typeof value!=='string'||!value.startsWith('data:image/png;base64,')||value.length>350000000)throw Error('Invalid canvas image.');
 const bytes=Buffer.from(value.slice('data:image/png;base64,'.length),'base64');
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid canvas image.');
 return bytes;
}
async function importPaths(paths, folder) {
  return importQueue.enqueue(paths, folder).done;
}

// Appearance preferences are the user's own: the system look is the default and
// any override is stored beside the library, never in the app bundle.
const appearancePrefs={theme:'system'};
function appearancePrefsPath(){return path.join(app.getPath('userData'),'appearance.json');}
function loadAppearancePrefs(){
 try{
  const saved=JSON.parse(fs.readFileSync(appearancePrefsPath(),'utf8'));
  if(saved&&typeof saved==='object'){
   if(['system','light','dark'].includes(saved.theme))appearancePrefs.theme=saved.theme;
  }
 }catch(error){}
 return appearancePrefs;
}
function saveAppearancePrefs(){
 try{fs.mkdirSync(path.dirname(appearancePrefsPath()),{recursive:true});fs.writeFileSync(appearancePrefsPath(),JSON.stringify(appearancePrefs,null,2));}catch(error){}
}
function appearanceState(){
 const prefs=loadAppearancePrefs();
 const systemDark=!!nativeTheme.shouldUseDarkColors;
 const dark=prefs.theme==='dark'?true:prefs.theme==='light'?false:systemDark;
 const highContrast=!!nativeTheme.shouldUseHighContrastColors;
 return {dark,highContrast,theme:prefs.theme};
}
function applyAppearanceWindow(){
 if(!win||win.isDestroyed())return;
 const state=appearanceState();
 // The window is opaque so macOS draws the real window shape and its native
 // shadow. The colour matches the app surface, so a resize never flashes.
 win.setBackgroundColor(state.dark?'#0a0a0a':'#ffffff');
 win.webContents.send('appearance-changed',state);
 if(floatingWindow&&!floatingWindow.isDestroyed())floatingWindow.webContents.send('appearance-changed',state);
}
loadAppearancePrefs();
nativeTheme.themeSource=appearancePrefs.theme;
nativeTheme.on('updated',()=>applyAppearanceWindow());
// A capture can arrive while the window is still loading. The change is then
// remembered here and handed to the view once it is ready, so a file saved
// from the browser shows up straight away instead of after a restart.
const pendingLibraryChanges=new Set();
let pendingLibraryRefreshAll=false;
let lastCaptureAt=0;
function notifyLibraryChanged(ids){
  lastCaptureAt=Date.now();
  const canSend=win&&!win.isDestroyed()&&!win.webContents.isLoading();
  if(!Array.isArray(ids)){
    pendingLibraryRefreshAll=true;
    pendingLibraryChanges.clear();
    if(canSend){pendingLibraryRefreshAll=false;win.webContents.send('library-changed');}
    return;
  }
  if(!pendingLibraryRefreshAll){
    for(const id of ids)pendingLibraryChanges.add(id);
    if(pendingLibraryChanges.size>4000){pendingLibraryRefreshAll=true;pendingLibraryChanges.clear();}
  }
  // The change is only remembered while the view cannot receive it. Once it
  // has been handed over, it must not be replayed later.
  if(canSend){
    if(pendingLibraryRefreshAll){pendingLibraryRefreshAll=false;pendingLibraryChanges.clear();win.webContents.send('library-changed');}
    else{const pending=[...pendingLibraryChanges];pendingLibraryChanges.clear();win.webContents.send('library-changed',pending);}
  }
}
function flushLibraryChanges(){
  if(!win||win.isDestroyed())return;
  if(pendingLibraryRefreshAll){pendingLibraryRefreshAll=false;pendingLibraryChanges.clear();win.webContents.send('library-changed');return;}
  if(!pendingLibraryChanges.size)return;
  const ids=[...pendingLibraryChanges];pendingLibraryChanges.clear();
  win.webContents.send('library-changed',ids);
}
// The window remembers where it was: native apps reopen at the same size and
// place. Saved bounds are checked against the displays that exist now, so a
// window last used on a disconnected monitor comes back on screen rather than
// somewhere off it.
function windowStatePath(){return path.join(app.getPath('userData'),'window-state.json');}
function savedWindowBounds(){
 const fallback={width:1480,height:940};
 let saved;
 try{saved=JSON.parse(fs.readFileSync(windowStatePath(),'utf8'));}catch(error){return fallback;}
 if(!saved||typeof saved!=='object')return fallback;
 const width=Math.max(760,Number(saved.width)||0),height=Math.max(600,Number(saved.height)||0);
 if(!width||!height)return fallback;
 if(!Number.isFinite(saved.x)||!Number.isFinite(saved.y))return {width,height};
 const bounds={x:Math.round(saved.x),y:Math.round(saved.y),width,height};
 // Some of the title bar has to be reachable, not just a sliver of the window.
 const reachable=screen.getAllDisplays().some(display=>{
  const area=display.workArea;
  const overlapX=Math.min(bounds.x+bounds.width,area.x+area.width)-Math.max(bounds.x,area.x);
  const overlapY=Math.min(bounds.y+bounds.height,area.y+area.height)-Math.max(bounds.y,area.y);
  return overlapX>=120&&overlapY>=80;
 });
 return reachable?bounds:{width,height};
}
let windowStateTimer=null;
function saveWindowBounds(){
 if(!win||win.isDestroyed())return;
 // getNormalBounds is the un-maximised frame, so restoring after a zoomed
 // session does not reopen the window filling the screen.
 const bounds=win.getNormalBounds();
 if(!Number.isFinite(bounds.width)||bounds.width<760||bounds.height<600)return;
 try{fs.mkdirSync(path.dirname(windowStatePath()),{recursive:true});fs.writeFileSync(windowStatePath(),JSON.stringify(bounds));}catch(error){}
}
function scheduleWindowBoundsSave(){clearTimeout(windowStateTimer);windowStateTimer=setTimeout(saveWindowBounds,400);}
function createWindow() {
  const appearance=appearanceState();
  // A window that is shown before its first frame is painted flashes the
  // window background. Show it on ready-to-show instead; the test harness keeps
  // an immediately visible window so capturePage stays deterministic.
  win = new BrowserWindow({ ...savedWindowBounds(), minWidth: 760, minHeight: 600, show: testMode, title: 'Canvas Pro', backgroundColor: appearance.dark?'#0a0a0a':'#ffffff', transparent: false, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), autoplayPolicy: 'no-user-gesture-required', contextIsolation: true, nodeIntegration: false, sandbox: true } });
  previewZoomActive=false;
  win.webContents.on('before-input-event',(_event,input)=>{
    win.webContents.setIgnoreMenuShortcuts(previewZoomActive&&(input.meta||input.control)&&['+','=','-','0'].includes(input.key));
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const target=win;
  if(!testMode)target.once('ready-to-show',()=>{if(!target.isDestroyed())target.show();});
  // Native apps tell their content when the window loses focus so the chrome
  // can take on the unfocused look. The page never blurs on its own, because
  // it is still the visible document inside the window.
  target.on('focus',()=>{if(!target.isDestroyed())target.webContents.send('window-focus-changed',true);});
  target.on('blur',()=>{if(!target.isDestroyed())target.webContents.send('window-focus-changed',false);});
  target.on('moved',scheduleWindowBoundsSave);
  target.on('resized',scheduleWindowBoundsSave);
  target.webContents.on('render-process-gone',(_event,details)=>{
    if(shutdownStarted||target.isDestroyed()||details.reason==='clean-exit')return;
    canvasDirty=false;for(const [token,waiter]of canvasFlushWaiters){canvasFlushWaiters.delete(token);waiter.reject(new Error('The app view stopped before the save completed. Reopen the view to inspect your last saved changes.'));}
    const oldPreview=webPreview;webPreview=null;oldPreview?.close().catch(()=>{});
    dialog.showMessageBox(target,{type:'warning',title:'Canvas Pro',message:'The app view stopped unexpectedly.',detail:'Reload to reopen your library. Saved files and canvas changes are kept; edits that had not finished saving may be lost.',buttons:['Reload view','Close window'],defaultId:0,cancelId:1}).then(({response})=>{if(target.isDestroyed()||shutdownStarted)return;if(response===0)target.loadFile(path.join(__dirname,'../src/index.html'));else target.close();}).catch(()=>{if(!target.isDestroyed())target.close();});
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Resizing a hidden-titlebar window on macOS can leave the freshly exposed
  // edge painted with the previous frame for a moment. Ask Chromium for one
  // full repaint once the drag settles so no stale tiles or panel edges are
  // left behind. Throttle it to the end of the gesture, not every frame.
  let resizeRepaint=0;
  target.on('resized',()=>{
    clearTimeout(resizeRepaint);
    resizeRepaint=setTimeout(()=>{if(!target.isDestroyed())target.webContents.invalidate();},160);
  });
  win.on('close',event=>{saveWindowBounds();if(!canvasDirty||shutdownStarted)return;event.preventDefault();const target=win;flushWorkspaces().then(()=>{if(!target.isDestroyed())target.close();}).catch(error=>dialog.showErrorBox('Workspace could not be saved',error.message));});
  win.on('closed',()=>{webPreview?.close();webPreview=null;});
  win.loadFile(path.join(__dirname, '../src/index.html'));
  win.webContents.on('did-finish-load',()=>{
    // ready-to-show is the normal path; this only covers a first paint that
    // never reports itself, so a slow start cannot leave the app invisible.
    if(!testMode&&!win.isDestroyed()&&!win.isVisible())win.show();
    setTimeout(flushLibraryChanges,150);
  });
  if(testMode)global.assetTestWindow=win;
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
  if(process.platform==='darwin'){
    // The About panel is a system surface: give it the real version and the
    // copyright, so About Canvas Pro is not a blank Electron dialog.
    app.setAboutPanelOptions({
      applicationName:'Canvas Pro',
      applicationVersion:require('../package.json').version,
      version:String(require('../package.json').version),
      copyright:'© '+new Date().getFullYear()+' Canvas Pro',
      credits:'A native library and browser capture companion for your Mac.'
    });
  }
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
  if(testMode&&!process.env.ASSET_TEST_CHOOSER)libraryRoot=path.join(app.getPath('userData'),'Library');
  else {
    const legacy=path.join(app.getPath('userData'),'Library');
    while(!libraryRoot){try{const saved=locations.read();if(saved.root){libraryRoot=locations.validate(saved.root);savedLibrary=saved;}else if(fs.existsSync(path.join(legacy,'library.sqlite')))libraryRoot=locations.validate(legacy);}catch(error){dialog.showErrorBox('Library unavailable',error.message+' Your library files have not been moved.');}
      if(!libraryRoot){const answer=await dialog.showMessageBox({type:'question',title:'Welcome to Canvas Pro',message:'Choose your library',detail:'Keep your originals, bookmarks, collections and canvases together in a folder you choose.',buttons:['Create library…','Open existing…','Quit'],cancelId:2});if(answer.response===2){app.quit();return;}try{libraryRoot=await chooseLibrary(answer.response===0?'new':'open');}catch(error){dialog.showErrorBox('Could not open library',error.message);}}
    }
  }
  if(!testMode&&(savedLibrary?.root!==libraryRoot||savedLibrary.recent[0]!==libraryRoot))locations.remember(libraryRoot);
  library = new Library(libraryRoot);
  workbench=new Workbench(library);
  // Fingerprints are filled in quietly in the background: a review should not
  // make someone wait while every picture in the library is decoded, and
  // importing a file should not either. The review dialog polls the pending
  // count, so it can say what it is still looking at.
  let phashSweeping=false;
  const preparePhashes=async()=>{
    if(phashSweeping||!library)return;
    phashSweeping=true;
    try{
      for(;;){
        if(shutdownStarted)return;
        let batch;
        try{batch=library.phashCandidates(12);}catch{return;}
        if(!batch.length)return;
        for(const row of batch){
          let value='';
          try{value=hashFile(nativeImage,library.file(row.id));}catch{value='';}
          try{library.setPhash(row.id,value);}catch{return;}
          // Decoding is synchronous, so yield between pictures: one decode per
          // turn keeps scrolling responsive instead of a dozen in a row.
          await new Promise(resolve=>setTimeout(resolve,40));
        }
      }
    }finally{phashSweeping=false;}
  };
  setTimeout(()=>{preparePhashes().catch(()=>{});},2500);
  originalsWatch=createOriginalsWatch({library,onChange:ids=>notifyLibraryChanged(ids)});
  if(testMode)global.originalsWatch=originalsWatch;
  let switchingLibrary=false;
  async function changeLibrary(mode){if(switchingLibrary)return;switchingLibrary=true;try{await flushWorkspaces();const target=await chooseLibrary(mode);if(!target||target===library.root)return;pendingLibrarySwitch=()=>{locations.remember(target);app.relaunch();};app.quit();}catch(error){dialog.showErrorBox('Could not switch library',error.message);}finally{switchingLibrary=false;}}
  const trusted=event=>{
   // A late IPC can arrive while the window is closing; reading webContents
   // on a destroyed window throws instead of failing the check.
   if(!win||win.isDestroyed())throw new Error('Unavailable outside the library.');
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Unavailable outside the library.');
  };
  ipcMain.handle('library-location',event=>{trusted(event);return ({root:library.root,name:path.basename(library.root).replace(/\.canvaslibrary$/i,''),recent:locations.read().recent||[]});});
  ipcMain.handle('library-switch',(event,mode)=>{trusted(event);if(!['new','open'].includes(mode))throw Error('Invalid library action.');return changeLibrary(mode);});
  canvasStore=new CanvasStore(library);if(testMode)global.canvasTestStore=canvasStore;
  // Chromium's stack is what gets past Cloudflare's TLS fingerprint checks; the
  // guarded Node fetcher stays as a fallback inside previewFetch. Only a
  // source-launched test process may substitute the raw, unguarded fetcher.
  bookmarks=new Bookmarks({library,fetcher:testNetworkBypass?(url,options)=>net.fetch(url,options):previewFetch,onUpdate:(id,info)=>{if(win&&!win.isDestroyed())win.webContents.send('link-info-changed',{id,info});}});
  mediaCache = new MediaCache(library,path.join(__dirname,'../bin/media-tool'));
  importQueue=new ImportQueue({library,onChange:jobs=>{
    if(win&&!win.isDestroyed())win.webContents.send('import-state',jobs);
    const active=jobs.find(j=>['running','cancelling'].includes(j.state));
    sendProgress(active?{name:active.name||'Preparing import…',count:active.processed+1}:null);
  }});
  localModel=new LocalModel({root:testMode&&process.env.ASSET_MODEL_DIR?path.resolve(process.env.ASSET_MODEL_DIR):path.join(app.getPath('userData'),'Local Models'),fetcher:(url,options)=>net.fetch(url,options),onProgress:value=>{if(win&&!win.isDestroyed())win.webContents.send('model-progress',value);}});
  // The models the app can use, each with its own download.
  localModel.define('clip',require('./clip-manifest.json')).define('florence-2',require('./florence-manifest.json'));
  let thermalState=testMode?'unknown':powerMonitor.getCurrentThermalState();
  const canAccelerateIndex=()=>thermalState==='nominal'&&!powerMonitor.isOnBatteryPower()&&powerMonitor.getSystemIdleTime()>=60;
  smartIndex=new SmartIndex({library,thumbnail:async id=>{const a=library.asset(id);if(['url','webloc'].includes(a.ext)){const file=bookmarks.path(id);return fs.existsSync(file)?file:null;}return thumbnail(id);},nativeImage,delay:()=>canAccelerateIndex()?350:650,testMode,onWork:()=>{if(win&&!win.isDestroyed())win.webContents.send('smart-work',smartIndex?.paused?'manual':smartIndex?.powerPause);},onUpdate:value=>{if(win&&!win.isDestroyed())win.webContents.send('smart-changed',value);}});
  if(!testMode&&workbench.pref('indexPaused'))smartIndex.pause(true);
  // Test-only hook: tests drive analysis directly because test mode pauses the
  // background indexer. Not exposed to the renderer in production.
  if(testMode)global.smartAnalyze=id=>smartIndex.analyze(id);
  let indexIdleTimer,updateIndexPower=()=>{};
  if(!testMode){
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
  ipcMain.handle('appearance-state',event=>{trusted(event);return appearanceState();});
  ipcMain.handle('appearance-set',(event,patch)=>{
    trusted(event);
    if(!patch||typeof patch!=='object')throw new Error('Invalid appearance settings.');
    if(['system','light','dark'].includes(patch.theme))appearancePrefs.theme=patch.theme;
    saveAppearancePrefs();
    nativeTheme.themeSource=appearancePrefs.theme;
    applyAppearanceWindow();
    return appearanceState();
  });
  ipcMain.handle('app-version',event=>{trusted(event);return require('../package.json').version;});
  ipcMain.handle('import-state',event=>{trusted(event);return importQueue.snapshot();});
  ipcMain.handle('import-cancel',(event,id)=>{trusted(event);importQueue.cancel(id);return importQueue.snapshot();});
  ipcMain.handle('import-retry',(event,id)=>{trusted(event);return importQueue.retry(id).done;});
  ipcMain.handle('health-start',event=>{trusted(event);return healthService.start();});
  ipcMain.handle('health-cancel',event=>{trusted(event);return healthService.cancel();});

  const symbolRenderer = new SymbolRenderer({
    root: path.join(__dirname, '..'),
    cacheDir: path.join(app.getPath('userData'), 'symbol-cache'),
    helper: path.join(__dirname, '../bin/symbols-tool')
  });
  protocol.handle('symbol', async request => {
    try {
      const u = new URL(request.url);
      if (u.hostname !== 'render') return new Response('', { status: 404 });
      const result = await symbolRenderer.render(u.searchParams);
      if (result.error) return new Response(result.error, { status: result.status });
      return new Response(result.buffer, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
    } catch {
      return new Response('', { status: 404 });
    }
  });

  protocol.handle('asset', async request => {
    try {
      const u = new URL(request.url);
      if(u.hostname==='ai'){const file=localModel.file(decodeURIComponent(u.pathname));return file?await fileResponse(file,request):new Response('',{status:404});}
      const id = u.pathname.slice(1);
      if (!/^[a-f0-9-]{36}$/.test(id)) return new Response('', { status: 400 });
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
      if(u.hostname==='web-image')return await bookmarks.webImage(id,request.signal);
      if(u.hostname==='reader-image'){
        const index=u.searchParams.get('block')||'';
        if(index!=='featured'&&!/^\d{1,4}$/.test(index))return new Response('',{status:400});
        return await bookmarks.readerImage(id,index==='featured'?index:Number(index),request.signal);
      }
      const file = u.hostname==='link-cover'?bookmarks.path(id):u.hostname==='link-icon'?bookmarks.path(id,'icon'):u.hostname === 'preview' ? await thumbnail(id,true) : u.hostname === 'thumb' ? await thumbnail(id,false,u.searchParams.has('gallery')) : u.hostname === 'file' ? library.file(id) : u.hostname === 'art' ? mediaCache.prefix(id)+'.art.jpg' : null;
      return file ? await fileResponse(file, request) : new Response('', { status: 404 });
    } catch { return new Response('', { status: 404 }); }
  });
  const updateProgress=value=>{if(win&&!win.isDestroyed())win.webContents.send('update-progress',value);};
  const getUpdater=()=>updater??=new Updater({
    currentVersion:require('../package.json').version,
    appBundle:path.resolve(app.getPath('exe'),'../../..'),
    // An unpacked Contents/Resources/app folder makes app.isPackaged false in
    // Electron even for a real .app bundle. process.defaultApp is true only
    // when Electron was launched with a source path (`electron .`), so it is
    // the reliable signal for "installed app can replace itself".
    isPackaged: !process.defaultApp,
    fetchImpl:(url,options)=>net.fetch(url,options),
    onProgress:updateProgress,
    quit:()=>app.quit(),
    requireSignedManifest: signedUpdatesRequired(process.env,process.defaultApp)
  });
  ipcMain.handle('floating-player',(event,op,data={})=>{
    // The mini player has its own preload bridge; only accept its commands
    // from that window's main frame, never from arbitrary renderers.
    const mini=floatingWindow&&!floatingWindow.isDestroyed()&&event.sender===floatingWindow.webContents&&event.senderFrame===floatingWindow.webContents.mainFrame;
    if(!mini)trusted(event);
    if(op==='state')return {open:!!floatingWindow&&!floatingWindow.isDestroyed()};
    if(op==='close'){closeFloating();return {closed:true};}
    if(op==='restore'){
      const state=data||{};
      if(win&&!win.isDestroyed())win.webContents.send('floating-restore',state);
      closeFloating();
      if(win&&!win.isDestroyed())win.focus();
      return {restored:true};
    }
    if(op!=='open')throw new Error('Invalid floating player command.');
    const a=library.asset(data.id);
    const ratio=Number.isFinite(data.aspectRatio)&&data.aspectRatio>0?data.aspectRatio:(a.aspectRatio||16/9);
    // Safari-style picture in picture: a small window that starts in the
    // bottom corner of the display the app is on, and stays where it is moved.
    const base=Math.min(440,Math.max(280,Math.round(320*Math.min(1,Math.max(0.45,ratio)))));
    const width=ratio<1?Math.round(base*ratio):base;
    const height=ratio<1?base:Math.round(base/ratio);
    const anchor=win&&!win.isDestroyed()?screen.getDisplayMatching(win.getBounds()):screen.getPrimaryDisplay();
    const area=anchor.workArea;
    const bounds=floatingBounds&&Number.isFinite(floatingBounds.x)&&Number.isFinite(floatingBounds.y)
      ? {...floatingBounds,width,height}
      : {x:area.x+Math.max(16,area.width-width-24),y:area.y+Math.max(16,area.height-height-24),width,height};
    bounds.x=Math.max(area.x,Math.min(bounds.x,area.x+area.width-width));
    bounds.y=Math.max(area.y,Math.min(bounds.y,area.y+area.height-height));
    // Replace any existing mini player before creating the new one. The
    // closing window's handler must not clear the reference to the new one.
    closeFloating();
    data.theme=appearanceState().dark?'dark':'light';
    floatingWindow=new BrowserWindow({
      ...bounds,minWidth:280,minHeight:180,frame:false,transparent:true,alwaysOnTop:true,resizable:true,
      hasShadow:true,title:'Floating video',backgroundColor:'#00000000',
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,autoplayPolicy:'no-user-gesture-required'}
    });
    const floatingWindowRef=floatingWindow;
    floatingWindow.setAspectRatio(ratio);
    floatingWindow.loadFile(path.join(__dirname,'../src/floating-player.html'),{hash:encodeURIComponent(JSON.stringify(data))});
    floatingWindow.on('moved',()=>{if(floatingWindow&&!floatingWindow.isDestroyed())floatingBounds=floatingWindow.getBounds();});
    floatingWindow.on('closed',()=>{
      if(floatingWindow!==floatingWindowRef)return;
      floatingWindow=null;
    });
    if(testMode)global.floatingWindow=floatingWindow;
    return {opened:true};
  });
  ipcMain.handle('update-check',event=>{trusted(event);return getUpdater().check();});
  ipcMain.handle('update-download',event=>{trusted(event);return getUpdater().download();});
  ipcMain.handle('update-install',event=>{trusted(event);return getUpdater().install();});
  ipcMain.handle('show-emoji-picker',event=>{trusted(event);if(process.platform==='darwin'){win.focus();app.showEmojiPanel();}});
  ipcMain.handle('canvas-create',(event,name)=>{trusted(event);return canvasStore.create(name);});
  ipcMain.handle('canvas-get',(event,id)=>{trusted(event);return canvasStore.get(id);});
  ipcMain.handle('canvas-rename',(event,id,name)=>{trusted(event);return canvasStore.rename(id,name);});
  ipcMain.handle('canvas-apply',(event,id,patch)=>{trusted(event);return canvasStore.apply(id,patch);});
  ipcMain.handle('canvas-add-assets',(event,id,ids,point,ratios)=>{trusted(event);return canvasStore.addAssets(id,ids,point,ratios);});
  ipcMain.handle('canvas-add-collection',(event,id,name,point)=>{trusted(event);return canvasStore.addCollection(id,name,point);});
  ipcMain.handle('canvas-menu',(event,id)=>{trusted(event);const board=canvasStore.summary(id);const menu=Menu.buildFromTemplate([{label:board.name,enabled:false},{type:'separator'},{id:'icon',label:'Choose Icon…',click:()=>win.webContents.send('context-action',{action:'choose-icon',key:'canvas:'+id})},{id:'rename',label:'Rename Canvas…',click:()=>win.webContents.send('context-action',{action:'canvas-rename',boardId:id})},{id:'delete',label:'Delete Canvas…',click:()=>win.webContents.send('context-action',{action:'canvas-delete',boardId:id})}]);if(testMode){global.canvasBoardMenu=menu;return;}menu.popup({window:win});});
  ipcMain.handle('canvas-remove',async(event,id)=>{trusted(event);const board=canvasStore.summary(id);const answer=await dialog.showMessageBox(win,{type:'question',message:'Delete “'+board.name+'”?',detail:'This removes the canvas layout, text and shapes. Its library files and collections stay intact.',buttons:['Cancel','Delete Canvas'],defaultId:0,cancelId:0});return answer.response===1?canvasStore.remove(id):{cancelled:true};});
  ipcMain.on('preview-zoom-active',(event,active)=>{
    trusted(event);previewZoomActive=active===true;
    if(!previewZoomActive)event.sender.setIgnoreMenuShortcuts(false);
  });
  ipcMain.on('canvas-dirty',(event,dirty)=>{trusted(event);canvasDirty=!!dirty;});
  ipcMain.on('canvas-flushed',(event,token,error)=>{trusted(event);const pending=canvasFlushWaiters.get(token);if(!pending)return;canvasFlushWaiters.delete(token);if(error)pending.reject(new Error(String(error)));else{canvasDirty=false;pending.resolve();}});
  ipcMain.handle('canvas-clipboard-write',(event,items)=>{trusted(event);if(!Array.isArray(items)||items.length>10000)throw new Error('Invalid canvas selection.');const buffer=Buffer.from(JSON.stringify(items.map(normalizeCanvasItem)));if(buffer.length>5*1024*1024)throw new Error('Copy fewer canvas items at once.');return clipboard.writeText('CanvasProItems\n'+buffer.toString('utf8'));});
  ipcMain.handle('canvas-clipboard-read',async event=>{trusted(event);const text=await clipboard.readText();if(!text.startsWith('CanvasProItems\n')||text.length>5*1024*1024)return null;try{const items=JSON.parse(text.slice(15));return Array.isArray(items)&&items.length<=10000?items.map(normalizeCanvasItem):null;}catch{return null;}});
  ipcMain.handle('canvas-drop-paths',async(event,id,paths,point)=>{trusted(event);canvasStore.summary(id);if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('Choose valid files.');const ids=[],external=[];for(const file of paths){const candidate=path.basename(file).slice(0,36);let asset;try{asset=library.asset(candidate);}catch{}if(asset&&path.resolve(file)===path.resolve(library.root,asset.stored))ids.push(asset.id);else external.push(file);}const result=external.length?await importPaths(external,null):{ids:[],errors:[]};const combined=[...new Set([...ids,...result.ids])];return {...(combined.length?canvasStore.addAssets(id,combined,point):{board:canvasStore.summary(id),items:[]}),importResult:result};});
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
        await fs.promises.writeFile(file,head+data.svg,{mode:0o600});
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
    if(op==='duplicates'){preparePhashes().catch(()=>{});return workbench.duplicates({threshold:data.threshold});}
    if(op==='dismiss-duplicates')return workbench.dismissDuplicates(data.ids);
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
  ipcMain.handle('model-state',(event,name)=>{trusted(event);return localModel.state(String(name||'clip'));});
  ipcMain.handle('model-download',(event,name)=>{trusted(event);return localModel.download(String(name||'clip'));});
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
  ipcMain.handle('smart-caption',(event,id,text)=>{trusted(event);return smartIndex.caption(String(id),String(text||''));});
  ipcMain.handle('smart-next-work',event=>{trusted(event);return {...smartIndex.nextVisualWork(),delay:canAccelerateIndex()?250:650};});
  ipcMain.handle('smart-vector-skip',(event,id)=>{trusted(event);return smartIndex.deferVisual(id);});
  ipcMain.handle('smart-vector',(event,id,vector)=>{trusted(event);return smartIndex.put(id,{vector});});
  ipcMain.handle('link-reader',(event,id)=>{trusted(event);return bookmarks.reader(id);});
  ipcMain.handle('link-info',(event,id,force)=>{trusted(event);return bookmarks.get(id,{force:!!force});});
  ipcMain.handle('web-preview-open',(event,id,token,rect)=>{trusted(event);if(typeof token!=='string'||token.length>100)throw new Error('Invalid preview.');if(!webPreview)webPreview=new WebPreview({electron:require('electron'),window:win,library,resolveLink:id=>bookmarks.resolveURL(id),onSaved:()=>{notifyLibraryChanged();}});if(testMode)global.canvasWebPreview=webPreview;return webPreview.open(id,token,rect);});
  ipcMain.on('web-preview-bounds',(event,token,rect)=>{trusted(event);if(webPreview?.token===token)webPreview.bounds(rect);});
  ipcMain.on('web-preview-close', (event,token)=>{trusted(event);webPreview?.detach(token);});
  ipcMain.handle('web-preview-command',(event,token,command)=>{trusted(event);return webPreview?.command(token,command);});
  ipcMain.handle('web-preview-save',(event,token)=>{trusted(event);return webPreview?.saveCopy(token);});
  ipcMain.handle('capture-assets',(event,ids)=>{
    trusted(event);
    if(!Array.isArray(ids)||ids.length>500||ids.some(id=>typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id)))throw new Error('Invalid captured assets.');
    return library.list(ids);
  });
  // The view tells the app when it is ready to receive changes, and when it
  // comes back to the front. A capture that happened in between is handed
  // over then, so the library never looks out of date.
  ipcMain.handle('capture-sync',(event,seen)=>{
    trusted(event);
    const since=Number.isFinite(seen)?Number(seen):0;
    if(lastCaptureAt>since){flushLibraryChanges();return {pending:true,at:lastCaptureAt};}
    return {pending:false,at:lastCaptureAt};
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
      bookmark:['social','recipe'].includes(String(data.bookmark||''))?String(data.bookmark):'',excludeBookmarks:data.excludeBookmarks===true,
      other:data.other===true,knownExtensions:Array.isArray(data.knownExtensions)?data.knownExtensions.filter(value=>typeof value==='string').slice(0,100):[],
      extensions:Array.isArray(data.extensions)?data.extensions.filter(value=>typeof value==='string').slice(0,100):[],
      matches:Array.isArray(data.matches)?data.matches.filter(value=>typeof value==='string').slice(0,3000):[]});
    if(data.navigation)Object.assign(result,libraryNavigation());
    return result;
  });
  ipcMain.handle('list', (event,limit) => {
    trusted(event);
    const capped=Number.isFinite(limit)?Math.max(1,Math.min(1000,Math.floor(limit))):0;
    return { assets: library.list(null,capped), folders: library.folders(), root: library.root,canvases:canvasStore.list(),folderRecords:library.folderRecords(),prototype:!!process.env.CANVAS_PROTOTYPE,workbench:{icons:workbench.icons()} };
  });
  function checkedAssets(ids){return library.selectedAssets(ids);}
  async function deleteFromTrash(ids,empty=false){
    const records=checkedAssets(ids);if(records.some(a=>!a.trash))throw new Error('Only files in Trash can be permanently deleted.');
    if(workbench.backingUp)throw Error('Wait for the library backup to finish.');
    const count=records.length;const answer=await dialog.showMessageBox(win,{type:'warning',message:empty?'Empty Trash?':`Delete ${count===1?'this file':count+' files'} permanently?`,detail:`This permanently removes ${count===1?'the file and its originals':count+' files and their originals'}, thumbnails, cover artwork, waveforms and cached previews from Canvas Pro’s library. It cannot be undone. Source files outside the library are not removed.`,buttons:['Cancel',empty?'Empty Trash':'Delete Permanently'],defaultId:0,cancelId:0,noLink:true});if(answer.response!==1)return {deleted:0,cancelled:true};
    try{const result=await library.permanentDelete(records.map(a=>a.id),{beforeRemove:async deleting=>{
      await Promise.all([mediaCache.cancelAndDrain(deleting),bookmarks.cancelAndDrain(deleting)]);const set=new Set(deleting);for(let i=thumbnailQueue.length-1;i>=0;i--)if(set.has(thumbnailQueue[i].id)){const [job]=thumbnailQueue.splice(i,1);job.resolve(null);}
      await Promise.allSettled(deleting.map(id=>Promise.all([thumbPending.get(id),thumbPending.get(id+':preview'),thumbPending.get(id+':browser'),...[...previewSizes].map(size=>thumbPending.get(id+':detail-'+size))].filter(Boolean))).filter(Boolean));
    }});for(const id of result.ids){thumbnailMisses.delete(id);thumbnailMisses.delete(id+':preview');for(const size of previewSizes)thumbnailMisses.delete(id+':detail-'+size);}try{await win.webContents.session.clearCache();}catch(e){console.error('Preview cache cleanup:',e.message);}notifyLibraryChanged();return result;}finally{mediaCache.unblock(records.map(a=>a.id));notifyLibraryChanged();}
  }
  ipcMain.handle('delete-permanently',(event,ids)=>{trusted(event);return deleteFromTrash(ids);});
  ipcMain.handle('empty-trash',event=>{trusted(event);const ids=library.db.prepare('SELECT id FROM assets WHERE trash=1').all().map(a=>a.id);return ids.length?deleteFromTrash(ids,true):{deleted:0};});
  ipcMain.handle('rename-collection',(event,oldName,newName)=>{trusted(event);return library.renameCollection(oldName,newName);});
  ipcMain.handle('remove-collection',async(event,name)=>{trusted(event);if(!library.folders().includes(name))throw new Error('Collection not found.');const answer=await dialog.showMessageBox(win,{type:'question',message:'Remove “'+name+'”?',detail:'The collection will be removed. Its files will remain in your library.',buttons:['Cancel','Remove Collection'],defaultId:0,cancelId:0});if(answer.response!==1)return {cancelled:true};library.removeCollection(name);return {removed:true};});
  ipcMain.handle('share-files',(event,ids)=>{trusted(event);const records=checkedAssets(ids);const sharingItem={filePaths:records.map(a=>library.file(a.id))};const menu=new ShareMenu(sharingItem);menu.popup({browserWindow:win});});
  ipcMain.handle('open-file',async(event,id)=>{trusted(event);const error=await shell.openPath(library.file(id));if(error)throw new Error(error);});
  ipcMain.handle('copy-source',(event,id)=>{trusted(event);const url=library.asset(id).url;if(!/^https?:\/\//i.test(url))throw new Error('No web source is saved for this file.');return clipboard.writeText(url);});
  ipcMain.handle('file-context-menu',(event,ids,currentCollection)=>{
    trusted(event);
    const records=checkedAssets(ids).map(a=>({...a,tags:JSON.parse(a.tags),folders:JSON.parse(a.folders)}));
    const template=contextTemplate({assets:records,folders:library.folders(),canvases:canvasStore.list(),currentCollection,platform:process.platform,paths:records.flatMap(a=>{try{return [library.file(a.id)];}catch{return [];}})},payload=>{if(win&&!win.isDestroyed())win.webContents.send('context-action',payload);});
    const menu=Menu.buildFromTemplate(template);if(testMode){global.canvasFileMenu=menu;return template.map(item=>({id:item.id,label:item.label,role:item.role,submenu:item.submenu?.map(sub=>({label:sub.label,type:sub.type}))}));}menu.popup({window:win});
  });
  ipcMain.handle('collection-context-menu',(event,name)=>{trusted(event);if(!library.folders().includes(name))throw new Error('Collection not found.');const menu=Menu.buildFromTemplate([{label:name,enabled:false},{type:'separator'},{label:'Add to Canvas…',click:()=>win.webContents.send('context-action',{action:'canvas-collection',name})},{label:'Choose Icon…',click:()=>win.webContents.send('context-action',{action:'choose-icon',key:'folder:'+library.folderRecords().find(f=>f.name===name).id})},{label:'Rename Collection…',click:()=>win.webContents.send('context-action',{action:'rename-collection',name})},{label:'Remove Collection…',click:()=>win.webContents.send('context-action',{action:'delete-collection',name})}]);if(testMode){global.canvasCollectionMenu=menu;return;}menu.popup({window:win});});
  ipcMain.handle('bulk-update',(event,ids,operation)=>{trusted(event);return workbench.change(ids,()=>library.updateMany(ids,operation),'Edit selection');});
  ipcMain.handle('read-text',async(event,id)=>{trusted(event);const a=library.asset(id);if(!['md','txt','json','csv','css','js','ts','log','xml'].includes(a.ext)||a.size>2*1024*1024)throw new Error('Text preview is unavailable for this file.');return fs.promises.readFile(library.file(id),'utf8');});
  function registerBrowserConnection(){
    const testHome=testMode?process.env.CANVAS_TEST_BROWSER_HOME:null;
    if(process.platform!=='darwin'||process.env.CANVAS_PROTOTYPE||(testMode&&!testHome))return null;
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
  ipcMain.handle('update', (event, id, changes) => {trusted(event);workbench.change([id],()=>library.update(id, changes));const saved=library.asset(id);return {...saved,tags:JSON.parse(saved.tags),folders:JSON.parse(saved.folders)};});
  ipcMain.handle('folder', (event, name) => {trusted(event);return library.addFolder(name);});
  ipcMain.handle('import-dialog', async (event, folder, directory) => {
    trusted(event);
    const r = await dialog.showOpenDialog(win, { properties: directory ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
    return r.canceled ? null : importPaths(r.filePaths, folder);
  });
  ipcMain.handle('import-url',(event,url,folder)=>{trusted(event);return importURL(url,folder);});
  ipcMain.handle('import-paths', (event, paths, folder) => {
    trusted(event);
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('Invalid file paths');
    return importPaths(paths, folder);
  });
  const ratioUpdates=new Map();let ratioTimer;
  function flushRatioUpdates(){if(!ratioUpdates.size)return;const updates=[...ratioUpdates];try{library.setAspectRatios(updates);ratioUpdates.clear();}catch(e){console.error('Could not save aspect ratios:',e);}}
  ipcMain.on('asset-ratio',(event,id,ratio)=>{trusted(event);if(typeof id!=='string'||!Number.isFinite(ratio)||ratio<=0||ratio>=100000)return;ratioUpdates.set(id,ratio);clearTimeout(ratioTimer);ratioTimer=setTimeout(flushRatioUpdates,200);});
  app.on('before-quit',()=>{clearTimeout(ratioTimer);flushRatioUpdates();});
  ipcMain.handle('media-info', (event,id,priority) => {trusted(event);return mediaCache.get(id,!!priority);});
  ipcMain.handle('image-size', (event,id) => {
    trusted(event);
    const a=library.asset(id);
    if(!a||a.trash||library.deleting.has(id))return null;
    const image=nativeImage.createFromPath(library.file(id));
    if(image.isEmpty())return null;
    const {width,height}=image.getSize();
    return width&&height?{width,height}:null;
  });
  ipcMain.on('visible-assets', (event,ids) => { trusted(event); if(Array.isArray(ids)&&ids.length<=300){setVisibleThumbnails(ids);mediaCache.setVisible(ids);bookmarks.setVisible(ids);prepareDragIcons(ids);} });
  // The icon must already exist when the drag starts: macOS ends the drag
  // session as soon as the dragstart event returns, so an await here would
  // leave nothing to drag. The renderer asks for an icon on pointer-down and
  // the visible cards are prepared as they appear; the app icon is the
  // immediate fallback if neither has finished yet.
  let dragFallbackIcon=null;
  function fallbackDragIcon(){
    if(dragFallbackIcon)return dragFallbackIcon;
    for(const file of [path.join(process.resourcesPath,'AssetLibrary.icns'),path.join(app.getAppPath(),'build/AssetLibrary.icns')]){
      const image=nativeImage.createFromPath(file);
      if(!image.isEmpty()){dragFallbackIcon=image;return image;}
    }
    // macOS requires a non-empty image. A transparent pixel is still a valid
    // drag image, though the app icon is normally found first.
    dragFallbackIcon=nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64'));
    return dragFallbackIcon;
  }
  const dragIcons=new Map(),dragIconPending=new Set();
  function dragIcon(file,ext){
    if(dragIcons.has(ext))return dragIcons.get(ext);
    const icon=fallbackDragIcon();
    dragIcons.set(ext,icon);
    app.getFileIcon(file,{size:'normal'}).then(found=>{if(!found.isEmpty())dragIcons.set(ext,found);}).catch(()=>{});
    return icon;
  }
  function prepareDragIcons(ids){
    for(const id of ids){
      if(typeof id!=='string')continue;
      let asset,file;
      try{asset=library.asset(id);if(asset.trash||dragIcons.has(asset.ext)||dragIconPending.has(asset.ext))continue;file=library.file(id);}catch{continue;}
      dragIconPending.add(asset.ext);
      app.getFileIcon(file,{size:'normal'}).then(icon=>{if(!icon.isEmpty())dragIcons.set(asset.ext,icon);}).catch(()=>{}).finally(()=>dragIconPending.delete(asset.ext));
    }
  }
  ipcMain.on('prepare-drag',(event,ids)=>{trusted(event);if(Array.isArray(ids)&&ids.length<=100)prepareDragIcons(ids);});
  ipcMain.on('drag-file', (event,value)=>{
    trusted(event);
    try {
      const ids=Array.isArray(value)?value:[value];
      // Always hand over the original files, never the thumbnails.
      const records=checkedAssets(ids);
      const files=records.map(a=>library.file(a.id));
      if(!files.length)return;
      const icon=dragIcons.get(records[0].ext)||dragIcon(files[0],records[0].ext);
      event.sender.startDrag({file:files[0],files,icon});
    }catch(error){console.error('Drag failed:',error.message);}
  });
  ipcMain.handle('open-link', (event,id) => {trusted(event);const url=new URL(library.asset(id).url);if(['http:','https:'].includes(url.protocol))return shell.openExternal(url.href);});
  ipcMain.handle('paste', async (event, folder) => {
    trusted(event);
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
  ipcMain.handle('copy-files',async(event,ids)=>{
    trusted(event);
    const files=checkedAssets(ids).map(a=>library.file(a.id));
    const script=`ObjC.import('AppKit');const files=${JSON.stringify(files)};const urls=$.NSMutableArray.array;for(const file of files)urls.addObject($.NSURL.fileURLWithPath(file));const p=$.NSPasteboard.generalPasteboard;p.clearContents;p.writeObjects(urls);`;
    const dir=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'canvas-copy-'));try{const file=path.join(dir,'copy.js');await fs.promises.writeFile(file,script);await run('/usr/bin/osascript',['-l','JavaScript',file]);}finally{await fs.promises.rm(dir,{recursive:true,force:true});}
  });
  ipcMain.handle('export-files',async(event,ids)=>{
    trusted(event);
    const assets=checkedAssets(ids);
    const chosen=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory'],buttonLabel:'Export copies'});if(chosen.canceled)return 0;
    for(const a of assets){const base=path.basename(a.name).replace(/[\/\\]/g,'_')||'File';let target=path.join(chosen.filePaths[0],base),counter=1;while(fs.existsSync(target)){const parts=path.parse(base);target=path.join(chosen.filePaths[0],parts.name+' ('+(counter++)+')'+parts.ext);}await fs.promises.copyFile(library.file(a.id),target,fs.constants.COPYFILE_EXCL);}return assets.length;
  });
  ipcMain.handle('reveal', (event, id) => {trusted(event);return shell.showItemInFolder(library.file(id));});
  ipcMain.handle('copy-path', async (event, id) => {
    trusted(event);
    const file = library.file(id);
    clipboard.writeText(file);
    return file;
  });
  ipcMain.handle('quick-look', async (event, id) => {
    trusted(event);
    if (process.platform === 'darwin') win.previewFile(library.file(id), library.asset(id).name);
  });
  ipcMain.handle('show-library', event => {trusted(event);return shell.openPath(library.root);});
  // The app menu is built explicitly rather than with the appMenu role: the
  // role builds its own submenu, which leaves nowhere to put Settings, and
  // macOS expects Settings… with ⌘, above Services.
  const appMenu=process.platform==='darwin'?{
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send('menu-settings') },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }:{ role: 'appMenu' };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    appMenu,
    { label: 'File', submenu: [{label:'New Library…',click:()=>changeLibrary('new')},{label:'Open Library…',click:()=>changeLibrary('open')},{type:'separator'},{ label: 'Import files…', accelerator: 'CmdOrCtrl+O', click: () => openImportWindow().catch(error=>console.error('Import menu:',error.message)) }, { label: 'Show library folder', click: () => shell.openPath(library.root) }, {type:'separator'},{ role: 'close' }] },
    {label:'Edit',submenu:[{label:'Undo',accelerator:'CmdOrCtrl+Z',click:()=>win?.webContents.send('history-command',false)},{label:'Redo',accelerator:'CmdOrCtrl+Shift+Z',click:()=>win?.webContents.send('history-command',true)},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    // The infinite canvas keeps a native accelerator as well as the renderer
    // shortcut: the menu path is guaranteed to fire even when the page has an
    // open popover or a focused control that would otherwise eat the chord.
    {label:'View',submenu:[{label:'Infinite Canvas',accelerator:'Alt+O',click:()=>{try{win?.webContents.executeJavaScript('window.toggleInfiniteCanvas?.()').catch(()=>{});}catch{}}},{type:'separator'},{role:'reload'},{role:'forceReload'},{role:'toggleDevTools'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},
    { role: 'windowMenu' },
    { label: 'Help', role: 'help', submenu: [
      { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => win?.webContents.send('show-shortcuts') },
      { type: 'separator' },
      { label: 'Check for Updates…', click: () => win?.webContents.send('menu-check-updates') }
    ] }
  ]));
  createWindow();
  openFilesReady=true;
  drainOpenFiles();
  setImmediate(()=>originalsWatch.scan());
  let lastFullScan=Date.now();
  app.on('browser-window-focus',()=>{
    const now=Date.now();
    if(now-lastFullScan<60000)return;
    lastFullScan=now;
    originalsWatch.scan();
  });
  powerMonitor.on('resume',()=>{lastFullScan=Date.now();originalsWatch.scan();});
  const bridgeDirectory=(testMode||process.env.CANVAS_PROTOTYPE)?path.join(app.getPath('userData'),'Bridge'):path.join(app.getPath('appData'),'Canvas Pro/Bridge');
  videoDownloader=new YtDlp({root:app.getPath('userData'),fetcher:(url,options)=>net.fetch(url,options)});
  captureBridge=new CaptureBridge({library,directory:bridgeDirectory,fetcher:(url,options)=>net.fetch(url,options),onChange:ids=>notifyLibraryChanged(ids),onStatus:status=>{if(win&&!win.isDestroyed())win.webContents.send('capture-status',status);},videoDownloader,allowPrivateCapture:testNetworkBypass});
  try{await captureBridge.start();}catch(e){console.error('Browser capture bridge:',e.message);}
  setImmediate(()=>{
    try{
      const setup=registerBrowserConnection();
      if(setup?.failures.length)console.error('Browser connection:',setup.failures.join('; '));
    }catch(error){console.error('Browser connection:',error.message);}
  });
  app.on('activate', () => ensureWindow());
}).catch(error=>{
  // Starting up must never fail silently. A library that cannot be opened
  // needs to say so, and the app has to stay alive long enough to show it.
  console.error('Canvas Pro could not start:',error&&error.stack||error);
  try{dialog.showErrorBox('Canvas Pro could not open this library',String(error&&error.message||error));}catch{}
  app.exit(1);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let shutdownStarted=false,shutdownComplete=false;
app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(shutdownStarted)return;shutdownStarted=true;updater?.cancel();closeFloating();
  flushWorkspaces().then(()=>Promise.allSettled([originalsWatch?.close(),bookmarks?.close(),webPreview?.close(),importQueue?.close(),captureBridge?.close(),smartIndex?.close(),localModel?.close(),workbench?.close(),healthService?.cancel(),mediaCache?.cancelAndDrain([...mediaCache.pending.keys()])])).then(()=>{pendingLibrarySwitch?.();pendingLibrarySwitch=null;shutdownComplete=true;app.quit();}).catch(error=>{shutdownStarted=false;dialog.showErrorBox('Workspace could not be saved',error.message);});
});
app.on('will-quit', () => {library?.close();});
module.exports = { importBuffer, importURL };
