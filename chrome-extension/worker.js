importScripts('capture-core.js','region.js','activity.js','social-core.js');
const HOST='com.canvaspro.capture';
function native(message){return new Promise((resolve,reject)=>chrome.runtime.sendNativeMessage(HOST,{version:1,...message},response=>{const error=chrome.runtime.lastError;if(error){
 const detail=error.message||'';
 const message=/not found|not registered/i.test(detail)?'Open the latest Canvas Pro from Applications once to register browser capture, then reload this extension.':
 /forbidden|access.*denied/i.test(detail)?'This browser blocked the Canvas Pro connection. Reload Canvas Pro Capture from its original folder.':
 'The browser could not start the Canvas Pro connection. Open Canvas Pro from Applications and try again.';
 return reject(new Error(message));
}if(!response?.ok)return reject(new Error(response?.error||'Canvas Pro did not respond.'));resolve(response);}));}
async function badge(text,error=false){await chrome.action.setBadgeText({text});await chrome.action.setBadgeBackgroundColor({color:error?'#a24949':'#3478d5'});}
async function progress(value,tabId){
 await chrome.storage.session.set({lastCapture:value});
 for(const id of new Set((Array.isArray(tabId)?tabId:[tabId]).filter(Boolean))){
  // The page's own content script shows the toast. Injecting it directly needs
  // permission for that site, which the reader may not have granted, and the
  // toast would then never appear.
  try{await chrome.tabs.sendMessage(id,{type:'capture-activity',job:value});continue;}catch{}
  try{await chrome.scripting.executeScript({target:{tabId:id},func:canvasCaptureActivity,args:[value]});}catch{/* Browser/internal pages may prohibit overlays; the popup retains progress. */}
 }
}
// Thumbnails come in two parts: the original address (cheap, and usually
// allowed by the page) and an inline copy (used when the page's own rules
// block the address). The toast tries the address first, then the inline copy.
async function inlineCopy(url){
 try{
   const res=await fetch(url,{credentials:'omit'});
   if(!res.ok) return '';
   const length=Number(res.headers.get('content-length')||0);
   if(length&&length>3*1024*1024) return '';
   const blob=await res.blob();
   if(!/^image\//i.test(blob.type||'')) return '';
   const bitmap=await createImageBitmap(blob);
   const scale=Math.min(1,160/Math.max(bitmap.width,bitmap.height));
   const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   bitmap.close();
   const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg',quality:.82})).arrayBuffer());
   let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
   return 'data:image/jpeg;base64,'+btoa(binary);
 }catch{return '';}
}
async function captureThumbnail(item){
 if(item.thumbnail&&/^data:image\//i.test(item.thumbnail)) return {url:'',data:item.thumbnail.length<400000?item.thumbnail:''};
 const url=item.poster||item.previewImage||(item.kind==='image'?item.mediaUrl:'');
 if(url&&/^data:image\//i.test(url)) return {url:'',data:url.length<300000?url:''};
 if(url&&/^https?:\/\//i.test(url)) return {url,data:await inlineCopy(url)};
 if(item.dataUrl&&['image','screenshot'].includes(item.kind)){
   if(item.dataUrl.length<300000) return {url:'',data:item.dataUrl};
   try{
     const bitmap=await createImageBitmap(await (await fetch(item.dataUrl)).blob());
     const scale=Math.min(1,160/Math.max(bitmap.width,bitmap.height));
     const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
     canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
     bitmap.close();
     const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg',quality:.82})).arrayBuffer());
     let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
     return {url:'',data:'data:image/jpeg;base64,'+btoa(binary)};
   }catch{return {url:'',data:''};}
 }
 return {url:'',data:''};
}
async function sendCapture(items,folder,tabId,notice='',activityId){
 if(!items?.length)throw new Error('No items selected.');
 const id=activityId||crypto.randomUUID(),title=items.length===1?items[0].title:items.length+' captures';
 const previews=await Promise.all(items.map(async item=>{const thumb=await captureThumbnail(item);return {title:item.title,kind:item.kind,thumbnail:thumb.url||'',thumbnailData:thumb.data||'',mediaUrl:item.kind==='image'?item.mediaUrl:'',poster:item.poster||''};}));
 let latest={id,title,kind:items[0].kind,state:'queued',total:items.length,done:0,notice,items:previews};
 await progress(latest,tabId);await badge('…');
 try{const options=await chrome.storage.local.get('folder');const result=await native({op:'capture',items,folder:folder??options.folder??''});
 if(!result?.jobId)throw new Error('Canvas Pro did not accept the capture.');
 for(let attempt=0;attempt<1200;attempt++){const {job}=await native({op:'status',jobId:result.jobId});latest={...job,id,title,kind:items[0].kind,notice,items:previews.map((item,index)=>({...item,state:job.results?.[index]?.state||(index===(job.done||0)?job.phase||'saving':'queued'),error:job.results?.[index]?.error||''}))};await progress(latest,tabId);if(['complete','failed'].includes(job.state)){await badge(job.errors.length?'!':String(job.imported+job.duplicates),!!job.errors.length);return job;}await new Promise(resolve=>setTimeout(resolve,500));}
 throw new Error('Capture is taking longer than expected. Check Canvas Pro.');
 }catch(error){await badge('!',true);await progress({...latest,state:'failed',errors:[error.message]},tabId);throw error;}
}
async function inspect(tabId,mode,source='',frameId){
 const target={tabId};if(Number.isInteger(frameId))target.frameIds=[frameId];else if(['discover','videos'].includes(mode))target.allFrames=true;
 const results=await chrome.scripting.executeScript({target,func:CaptureCore.inspectPage,args:[mode,source]});
 if(['discover','videos'].includes(mode)){const main=results.find(r=>r.frameId===0)?.result||results[0]?.result;if(!main)throw new Error('No accessible page content');return {base:main.base,items:results.flatMap(r=>r.result?.items||[]).slice(0,500)};}return results[0]?.result;
}
async function tabFor(id){const tab=id?await chrome.tabs.get(id):(await chrome.tabs.query({active:true,currentWindow:true}))[0];if(!tab)throw new Error('Open a web page first.');return tab;}
async function baseFor(tab,frameId,source){try{return await inspect(tab.id,'media',source,frameId);}catch{return {pageUrl:tab.url,pageTitle:tab.title,title:tab.title};}}
async function screenshot(tab,rect){const [active]=await chrome.tabs.query({active:true,windowId:tab.windowId});if(active?.id!==tab.id)throw new Error('Return to the page you want to capture and try again.');try{await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>{document.querySelector('[data-canvas-capture-activity]')?.remove();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}});}catch{}let dataUrl=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});let width,height;if(rect){const bitmap=await createImageBitmap(await(await fetch(dataUrl)).blob());const sx=bitmap.width/rect.viewportWidth,sy=bitmap.height/rect.viewportHeight;width=Math.max(1,Math.round(rect.width*sx));height=Math.max(1,Math.round(rect.height*sy));const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').drawImage(bitmap,Math.round(rect.x*sx),Math.round(rect.y*sy),width,height,0,0,width,height);bitmap.close();const buffer=new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer());let binary='';for(let i=0;i<buffer.length;i+=32768)binary+=String.fromCharCode(...buffer.subarray(i,i+32768));dataUrl='data:image/png;base64,'+btoa(binary);}return sendCapture([{kind:'screenshot',title:(tab.title||'Web page')+' screenshot',pageTitle:tab.title,pageUrl:tab.url,dataUrl,...(width?{width,height}:{})}],undefined,tab.id);}
async function region(tab){const token=crypto.randomUUID(),records=(await chrome.storage.session.get('regions')).regions||{};records[token]={tabId:tab.id,url:tab.url,expires:Date.now()+120000};for(const key of Object.keys(records))if(records[key].expires<Date.now())delete records[key];await chrome.storage.session.set({regions:records});await chrome.scripting.executeScript({target:{tabId:tab.id},func:canvasSelectRegion,args:[token]});return {selecting:true};}
async function collect(tab,mode='images',frameId){
 if(!chrome.sidePanel)throw Error('This browser does not support the capture side panel. Use a current Chrome version.');
 let result;try{result=await inspect(tab.id,mode==='images'?'discover':'videos','',frameId);}catch(error){throw new Error('This page does not allow media inspection. '+error.message);}
 const {base}=result;const watched=(await chrome.storage.session.get('media-watch:'+tab.id))['media-watch:'+tab.id];const combined=[...result.items,...(watched?.expires>Date.now()?watched.items.map(item=>({...base,...item})):[])];const seen=new Set();const items=combined.filter(item=>{if(mode==='images'&&item.kind!=='image'||mode==='videos'&&item.kind==='image'&&!/\.gif(?:[?#]|$)/i.test(item.mediaUrl))return false;const key=item.mediaUrl||item.dataUrl;if(seen.has(key))return false;seen.add(key);return true;});
 const id=crypto.randomUUID();const all=await chrome.storage.session.get(null);const expired=Object.keys(all).filter(key=>key.startsWith('collection:')&&Date.now()-all[key].created>3600000);if(expired.length)await chrome.storage.session.remove(expired);
 await chrome.storage.session.set({['collection:'+id]:{base,items,tabId:tab.id,mode,created:Date.now()}});await chrome.storage.session.set({activeCollection:id});return {count:items.length};
}
async function fullPage(tab){
  const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({width:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0,innerWidth),height:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0,innerHeight),vw:innerWidth,vh:innerHeight,devicePixelRatio:window.devicePixelRatio||1,scrollX,scrollY,scrollBehavior:document.documentElement.style.scrollBehavior})});
  if(!result?.width||!result?.height)throw new Error('Could not measure this page.');
  const maxHeight=16000;const height=Math.min(result.height,maxHeight);
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{window.__canvasFullPage={overflow:document.documentElement.style.overflow,behavior:document.documentElement.style.scrollBehavior};document.documentElement.style.scrollBehavior='auto';}});
  const [active]=await chrome.tabs.query({active:true,windowId:tab.windowId});if(active?.id!==tab.id)throw new Error('Return to the page you want to capture and try again.');
  const steps=[];for(let y=0;y<height;y+=Math.max(1,result.vh-20)){steps.push(Math.min(y,height-result.vh));if(y+result.vh>=height)break;}
  const shots=[];
  try{
    for(let i=0;i<steps.length;i++){
      await chrome.scripting.executeScript({target:{tabId:tab.id},func:y=>window.scrollTo(0,y),args:[steps[i]]});
      await new Promise(r=>setTimeout(r, i?350:180));
      const dataUrl=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
      shots.push({y:steps[i],dataUrl});
    }
  }finally{
    await chrome.scripting.executeScript({target:{tabId:tab.id},func:(x,y,orig)=>{document.documentElement.style.overflow=orig?.overflow||'';document.documentElement.style.scrollBehavior=orig?.behavior||'';window.scrollTo(x,y);},args:[result.scrollX,result.scrollY,{overflow:'',behavior:result.scrollBehavior}]});
  }
  const bitmaps=await Promise.all(shots.map(async s=>({y:s.y,bmp:await createImageBitmap(await (await fetch(s.dataUrl)).blob())})));
  const scale=bitmaps[0].bmp.width/result.vw||result.devicePixelRatio||1;
  const canvas=new OffscreenCanvas(Math.round(result.width*scale),Math.round(height*scale));
  const ctx=canvas.getContext('2d');
  for(const s of bitmaps){ctx.drawImage(s.bmp,0,Math.round(s.y*scale));s.bmp.close();}
  const buffer=new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
  let binary='';for(let i=0;i<buffer.length;i+=32768)binary+=String.fromCharCode(...buffer.subarray(i,i+32768));
  return sendCapture([{kind:'screenshot',title:(tab.title||'Web page')+' full page',pageTitle:tab.title,pageUrl:tab.url,dataUrl:'data:image/png;base64,'+btoa(binary),width:canvas.width,height:canvas.height}],undefined,tab.id);
}

async function runAction(action,tabId){const tab=await tabFor(tabId);if(action==='viewport')return screenshot(tab);if(action==='region')return region(tab);if(action==='fullpage')return fullPage(tab);if(action==='collect')return collect(tab);if(action==='videos')return collect(tab,'videos');if(action==='content')return sendCapture([await inspect(tab.id,'content')],undefined,tab.id);if(action==='bookmark')return sendCapture([{...await inspect(tab.id,'media'),kind:'bookmark'}],undefined,tab.id);throw new Error('Unknown capture action');}
chrome.runtime.onInstalled.addListener(()=>{chrome.contextMenus.removeAll(()=>{for(const [id,title,contexts]of [['save-image','Save Image to Canvas Pro...',['image','video']],['video','Download video to Canvas Pro',['video']],['audio','Save audio to Canvas Pro',['audio']],['link','Save link to Canvas Pro',['link']],['selection','Save selected text to Canvas Pro',['selection']],['content','Save page content to Canvas Pro',['page']],['viewport','Capture visible page to Canvas Pro',['page']],['region','Capture an area to Canvas Pro',['page']],['fullpage','Capture full page to Canvas Pro',['page']],['collect','Collect images with Canvas Pro',['page']],['videos','Find videos with Canvas Pro',['page','video']]])chrome.contextMenus.create({id,title,contexts,documentUrlPatterns:['http://*/*','https://*/*']});});reinjectQuickSave();});
// A page that was already open when the extension updated still runs the old
// content script, whose extension context is dead ("Extension context
// invalidated"). Re-injecting the current script restores Alt+click and
// drag-and-drop there without asking the reader to refresh every tab.
// A page that was already open when the extension updated still runs the old
// content script, whose extension context is dead ("Extension context
// invalidated"). Re-injecting the current scripts restores Alt+click and
// drag-and-drop there, so the reader does not have to refresh every tab.
// The capture card lives in activity.js, so it must be injected too: without
// it the page would save the file and show nothing.
const PAGE_SCRIPTS=['activity.js','quick-save.js'];
async function reinjectInto(tabId){
 if(!Number.isInteger(tabId)) return false;
 try{await chrome.scripting.executeScript({target:{tabId},files:PAGE_SCRIPTS});return true;}catch{return false;}
}
async function reinjectQuickSave(){
 let tabs=[];try{tabs=await chrome.tabs.query({});}catch{return;}
 for(const tab of tabs){
  const url=String(tab?.url||tab?.pendingUrl||'');
  if(!/^https?:\/\//i.test(url))continue;
  if(/^https?:\/\/(?:[a-z0-9-]+\.)*(?:chrome|edge|devtools|chrome-extension|about|view-source)\b/i.test(url))continue;
  await reinjectInto(tab.id);
 }
}
if(chrome.runtime.onStartup)chrome.runtime.onStartup.addListener(()=>{reinjectQuickSave();});
// The worker starts again after every idle period and after every update.
// That is the moment to put the current scripts back into the pages that were
// already open, so their quick save keeps working. The sweep is throttled
// because the worker wakes often.
async function refreshStalePages(){
 try{
  const now=Date.now();
  const since=(await chrome.storage.session.get('reinjected-at'))['reinjected-at']||0;
  if(now-since<300000)return;
  await chrome.storage.session.set({'reinjected-at':now});
  await reinjectQuickSave();
 }catch{}
}
refreshStalePages();
async function captureContext(info,tab){
 if(info.menuItemId==='save-image'||(info.menuItemId==='video'&&info.srcUrl?.startsWith('blob:')&&CanvasSocialCore.platformFor(info.frameUrl||tab.url))){
  const item=await chrome.tabs.sendMessage(tab.id,{type:'focused-media'},{frameId:info.frameId??0}).catch(()=>null);
  if(item?.mediaUrl||item?.dataUrl)return sendCapture([item],undefined,tab.id);
  if(item?.kind==='video'&&CanvasSocialCore.platformFor(item.pageUrl)==='instagram.com'){
   const resolved=await native({op:'instagram-video',pageUrl:item.pageUrl,poster:item.poster}).catch(()=>null);
   if(resolved?.item?.mediaUrl)return sendCapture([{...item,...resolved.item}],undefined,tab.id);
  }
  if(item?.kind==='video')throw new Error('This slide does not expose a downloadable video. Try playing it before saving, or use Find videos.');
  if(info.menuItemId==='save-image'&&info.srcUrl){
   const base=await baseFor(tab,info.frameId,info.srcUrl);
   const kind=info.mediaType==='video'?'video':'image';
   return sendCapture([{...base,kind,...(info.srcUrl.startsWith('data:')?{dataUrl:info.srcUrl}:{mediaUrl:info.srcUrl})}],undefined,tab.id);
  }
  throw new Error('Right-click directly on the image or video you want to save.');
 }
if(['viewport','region','fullpage','collect','content','videos'].includes(info.menuItemId))return runAction(info.menuItemId,tab.id);const base=await baseFor(tab,info.frameId,info.srcUrl);if(info.menuItemId==='selection')return sendCapture([{...base,kind:'content',selection:true,title:base.pageTitle+' — selection',text:info.selectionText||''}],undefined,tab.id);if(info.menuItemId==='link')return sendCapture([{...base,kind:'bookmark',book:false,pageUrl:info.linkUrl,title:info.linkUrl,previewImage:'',siteIcon:''}],undefined,tab.id);if(['video','audio'].includes(info.menuItemId)&&(!info.srcUrl||info.srcUrl.startsWith('blob:')))return collect(tab,'videos',info.frameId);return sendCapture([{...base,kind:info.menuItemId,...(info.srcUrl?.startsWith('data:image/')?{dataUrl:info.srcUrl}:{mediaUrl:info.srcUrl})}],undefined,tab.id);}
chrome.contextMenus.onClicked.addListener((info,tab)=>{if(['collect','videos'].includes(info.menuItemId)&&tab?.id&&chrome.sidePanel)chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});if(tab?.id)reinjectInto(tab.id);captureContext(info,tab).catch(async error=>{await badge('!',true);await progress({id:crypto.randomUUID(),state:'failed',errors:[error.message]},tab?.id);});});
chrome.commands.onCommand.addListener(command=>runAction(command==='capture-area'?'region':'viewport').catch(async e=>{await badge('!',true);await progress({state:'failed',errors:[e.message]});}));
chrome.runtime.onMessage.addListener((message,sender,respond)=>{(async()=>{if(sender.id!==chrome.runtime.id)throw new Error('Invalid capture sender');if(message.type==='social-save'){if(!sender.tab||!CanvasSocialCore.platformFor(sender.url))throw new Error('Post capture is available only on supported platforms.');return captureSocial(message.post,sender.tab);}if(message.type==='social-error'){if(!sender.tab||!CanvasSocialCore.platformFor(sender.url))throw new Error('Invalid social capture');await progress({id:crypto.randomUUID(),state:'failed',title:'Post capture',errors:[String(message.error||'Could not save this post').slice(0,500)]},sender.tab.id);return {};}if(['region-result','cancel-region'].includes(message.type)){const records=(await chrome.storage.session.get('regions')).regions||{},record=records[message.token];if(!record||record.tabId!==sender.tab?.id||record.expires<Date.now())throw new Error('This capture selection expired. Try again.');delete records[message.token];await chrome.storage.session.set({regions:records});if(message.type==='cancel-region')return {cancelled:true};const rect=message.rect;if(!rect||Object.values(rect).some(n=>!Number.isFinite(n))||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>rect.viewportWidth+1||rect.y+rect.height>rect.viewportHeight+1)throw new Error('Invalid screenshot region');return screenshot(await tabFor(record.tabId),rect);}
if(message.type==='reinject-quick-save'){const tabId=Number(message.tabId);if(Number.isInteger(tabId))await reinjectInto(tabId);else await reinjectQuickSave();return {reinjected:true};}if(message.type==='quick-save'){if(!sender.tab?.id)throw new Error('Open a web page first.');const item=message.item||{},url=String(item.mediaUrl||item.url||'');if(!/^(https?:|data:image\/)/i.test(url))throw new Error('This item cannot be saved directly.');const kind=item.kind==='video'?'video':'image',base={pageUrl:String(item.pageUrl||sender.tab.url||''),pageTitle:String(item.pageTitle||sender.tab.title||''),title:String(item.title||sender.tab.title||'Saved media').slice(0,160)};const payload={...base,kind,alt:String(item.alt||''),width:Number(item.width)||0,height:Number(item.height)||0,poster:String(item.poster||''),thumbnail:String(item.thumbnail||''),...(url.startsWith('data:')?{dataUrl:url}:{mediaUrl:url})};return sendCapture([payload],undefined,sender.tab.id);}if(!sender.url?.startsWith(chrome.runtime.getURL('')))throw new Error('Capture must be initiated from Canvas Pro.');if(message.type==='watch-media'){const tab=await tabFor(message.tabId);if(!await chrome.permissions.contains({origins:['http://*/*','https://*/*']}))throw new Error('Allow media scanning in the browser first.');await chrome.storage.session.set({['media-watch:'+tab.id]:{expires:Date.now()+1800000,items:[]}});return {watching:true};}if(message.type==='ping')return native({op:'ping'});if(message.type==='action')return runAction(message.action,message.tabId);if(message.type==='save-batch'){const record=(await chrome.storage.session.get('collection:'+message.collectionId))['collection:'+message.collectionId];if(!record||!Array.isArray(message.indices)||!message.indices.length||message.indices.length>100)throw new Error('Choose up to 100 images.');const items=[...new Set(message.indices)].map(i=>record.items[i]);if(items.some(item=>!item))throw new Error('Invalid image selection');return sendCapture(items,message.folder,[record.tabId,sender.tab?.id]);}throw new Error('Unknown message');})().then(result=>respond({ok:true,result}),async error=>{respond({ok:false,error:error.message});});return true;});

// Opt-in, tab-scoped media observation. No request bodies, cookies or authorization headers are read.
const mediaWrites=new Map();
chrome.webRequest.onHeadersReceived.addListener(details=>{
 if(details.tabId<0||details.statusCode<200||details.statusCode>=400)return;
 const type=details.responseHeaders?.find(h=>h.name.toLowerCase()==='content-type')?.value?.split(';')[0].toLowerCase();
 if(!/^(video\/(mp4|webm|quicktime|x-m4v|3gpp)|image\/(gif|apng))$/.test(type||''))return;
 const key='media-watch:'+details.tabId;
 const pending=(mediaWrites.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
  const record=(await chrome.storage.session.get(key))[key];if(!record||record.expires<Date.now())return;
  if(!record.items.some(i=>i.mediaUrl===details.url)){record.items.push({kind:type.startsWith('video/')?'video':'image',mediaUrl:details.url,title:new URL(details.url).pathname.split('/').pop()||'Discovered media'});record.items=record.items.slice(-150);await chrome.storage.session.set({[key]:record});}
 });mediaWrites.set(key,pending);pending.finally(()=>{if(mediaWrites.get(key)===pending)mediaWrites.delete(key);}).catch(()=>{});
},{urls:['http://*/*','https://*/*']},['responseHeaders']);
chrome.tabs.onRemoved.addListener(tabId=>chrome.storage.session.remove('media-watch:'+tabId));
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url)chrome.storage.session.remove('media-watch:'+tabId);});

async function publicText(url){
 const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('The platform did not expose this post’s public media ('+response.status+').');
 const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw new Error('Post metadata is too large.');chunks.push(value);}}finally{await reader.cancel();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
async function publicJSON(url){return JSON.parse(await publicText(url));}
async function captureSocial(post,tab){
 const platform=CanvasSocialCore.platformFor(tab.url),source=post?.permalink;if(!platform||!source||CanvasSocialCore.platformFor(source)!==platform)throw new Error('Could not identify this post. Open it and try again.');
 const base={pageUrl:source,pageTitle:String(tab.title||post.title||'Post'),title:String(post.title||tab.title||'Post').slice(0,160)};let items=(Array.isArray(post.items)?post.items:[]).slice(0,25).filter(i=>['image','video'].includes(i.kind)).map(i=>({...i,...base})),notice='';
 const activityId=crypto.randomUUID();try{await progress({id:activityId,title:base.title,state:'running',phase:'discovering',total:1},tab.id);
 const visibleItems=items.slice();
 try{
 if((platform==='x.com'||platform==='twitter.com')&&!items.some(i=>i.kind==='video')&&(post.hasVideo||!items.length)){
  const id=new URL(source).pathname.match(/\/status\/(\d+)/)?.[1];if(id){const token=((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'');const data=await publicJSON('https://cdn.syndication.twimg.com/tweet-result?id='+id+'&token='+token);items=CanvasSocialCore.twitterMedia(data,{...base,description:data.text||'',author:data.user?.name||''});}
 }
 if(platform==='reddit.com'&&!items.some(i=>i.kind==='video')&&(post.hasVideo||!items.length)){
  const u=new URL(source);if(u.pathname.includes('/comments/')){u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'')+'.json';u.searchParams.set('raw_json','1');const json=await publicJSON(u.href);const data=json?.[0]?.data?.children?.[0]?.data,video=data?.secure_media?.reddit_video||data?.media?.reddit_video;
   if(video?.fallback_url){notice=video.is_gif?'':'Reddit’s public fallback may not include the separate audio track.';items=[{...base,kind:'video',mediaUrl:video.fallback_url,width:video.width,height:video.height,duration:video.duration,author:data.author||'',description:(data.title||'')+(notice?'\n'+notice:'')}];}
  }
 }
 if((platform==='instagram.com'||platform==='pinterest.com')&&!items.some(i=>i.kind==='video')&&post.hasVideo){const html=await publicText(source);const found=[];for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){if(!/(?:og:video(?::url|:secure_url)?|twitter:player:stream)["']/i.test(tag[0]))continue;const value=tag[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1];if(value)found.push(value.replaceAll('&amp;','&'));}items.push(...[...new Set(found)].slice(0,25).map(mediaUrl=>({...base,kind:'video',mediaUrl})));}
 }catch(error){if(!visibleItems.length)throw error;}
 const unique=new Map([...visibleItems,...items].map(item=>[item.mediaUrl||item.dataUrl,item]));
 items=[...unique.values()].slice(0,25);
 if(post.hasVideo&&items.length&&!items.some(item=>item.kind==='video'))notice='Saved available images. This post did not expose a downloadable video.';
 if(!items.length)throw new Error('This post has no public downloadable media exposed. Play the video and try again, or enable deep scan. Private or protected streams may be unavailable.');
 return await sendCapture(items,undefined,tab.id,notice,activityId);
 }catch(error){await progress({id:activityId,title:base.title,state:'failed',errors:[error.message]},tab.id);throw error;}
}
