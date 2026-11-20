const $ = s => document.querySelector(s);
const api = window.library;
let assets=[],assetById=new Map(),folders=[],visible=[],selected=null,view='all',collection=null,tagFilter=null,busy=false,toastTimer,layout,frame=0,hoverPlayer=null,previewPlayer=null;
let layoutDirty=true,inspectorFrame=0,previewScope=null,refreshVersion=0,appliedRefreshVersion=0,galleryLayout='masonry',navStats=null,pendingSelection=null;
let colorFocus=null;
const selection=new FileSelection();
const mounted=new Map(),cardCleanup=new Map();
let lastVisibleAssets='';
function publishVisibleAssets(ids){
 const key=ids.join(',');
 if(key===lastVisibleAssets)return;
 lastVisibleAssets=key;
 api.visibleAssets(ids);
}
function assetRatio(a,width){return SmartCards.ratio(a,width)||a.aspectRatio||(kind(a)==='video'?16/9:kind(a)==='audio'?3.5:kind(a)==='pdf'?.707:kind(a)==='link'?1.6:1);}
function rememberRatio(a,ratio){if(!Number.isFinite(ratio)||ratio<=0||Math.abs((a.aspectRatio||0)-ratio)<.001)return;a.aspectRatio=ratio;layoutDirty=true;scheduleGallery();safe(()=>api.setAspectRatio(a.id,ratio));}
// The gallery footer is the file name plus, when present, the tag count.
// These match the line heights in .card-name and .card-details.
const CARD_NAME_FOOTER=21, CARD_DETAIL_FOOTER=13;
function galleryCardFooterHeight(a){
 if(!showFileNamesEnabled()||kind(a)==='link')return 0;
 return CARD_NAME_FOOTER+CARD_DETAIL_FOOTER;
}
const imageExt=['png','jpg','jpeg','gif','webp','avif','bmp','svg','ico','heic','heif','tiff','tif','eps','jpegxl','jxl','jfif','jpe','insp','psd','psb'];
const videoExt=['mp4','webm','mov','m4v','ogv','mkv','avi','gifv','3gp','3g2','h265','hevc'];
const audioExt=['mp3','wav','ogg','m4a','aac','flac','aiff','aif','oga','opus','alac'];
const kind=a=>imageExt.includes(a.ext)?'image':videoExt.includes(a.ext)?'video':audioExt.includes(a.ext)?'audio':a.ext==='pdf'?'pdf':['webloc','url'].includes(a.ext)?'link':'other';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
// macOS inserts the chosen emoji into whatever editable field has focus. A
// one-pixel capture field lets the real Apple picker do the choosing, with no
// second dialog of our own in front of it.
const EmojiPicker=(()=>{
 let field, pending=null;
 // The macOS picker inserts into whichever field has focus. While a modal
 // dialog owns the keyboard everything outside it is inert, so the capture
 // field must live inside the open dialog or focus() would silently fail.
 function release(){if(field){field.value='';field.remove();field=null;}}
 function finish(value){
  const done=pending;pending=null;
  if(field)field.blur();
  release();
  if(done)done(value);
 }
 function capture(){
  if(field&&field.isConnected)return field;
  release();
  const host=document.querySelector('dialog[open]')||document.body;
  field=el('input','emoji-capture');
  field.type='text';
  field.autocomplete='off';
  field.tabIndex=-1;
  field.setAttribute('aria-label','Emoji');
  host.append(field);
  field.addEventListener('input',()=>{
   if(!pending)return;
   const value=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(field.value)].pop()?.segment;
   if(value)finish(value);
  });
  field.addEventListener('blur',()=>{if(pending)finish(null);});
  return field;
 }
 function pick(){
  return new Promise(resolve=>{
   const node=capture();
   node.value='';
   pending=resolve;
   node.focus({preventScroll:true});
   safe(()=>api.showEmojiPicker());
  });
 }
 return {pick};
})();
// Every surface that opens from a control remembers where the gesture began.
// Dialogs, popovers and the preview all reveal from that same trigger instead
// of scaling from the centre of the surface.
let lastTrigger=null,lastTriggerAt=0,lastPointer=null;
document.addEventListener('pointerdown',event=>{
 lastPointer={x:event.clientX,y:event.clientY};
 lastTrigger=event.target.closest?.('button,summary,[role="menuitem"],[data-canvas-tool],.card,.select-trigger')||event.target;
 lastTriggerAt=performance.now();
},true);
function revealTrigger(){
 if(lastTrigger?.isConnected&&performance.now()-lastTriggerAt<2000)return lastTrigger;
 return document.activeElement instanceof HTMLElement?document.activeElement:null;
}
const nativeShowModal=HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal=function(...args){
 nativeShowModal.apply(this,args);
 Motion.revealFromTrigger(this,revealTrigger());
};
document.addEventListener('toggle',event=>{
 if(event.newState!=='open')return;
 const surface=event.target;
 if(!(surface instanceof HTMLElement)||!surface.matches('[popover]'))return;
 // A context menu opens at the pointer, so its trigger is a point, not a button.
 const trigger=surface.id==='canvas-item-menu'&&lastPointer
  ?{left:lastPointer.x,top:lastPointer.y,width:0,height:0}:revealTrigger();
 Motion.revealFromTrigger(surface,trigger);
},true);
function bytes(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';if(n<1073741824)return(n/1048576).toFixed(1)+' MB';return(n/1073741824).toFixed(2)+' GB';}
// A contact sheet needs to be scannable without opening each file: format,
// weight and tag count live under the name, the way an asset manager does it.
function cardDetail(a){const bits=[(a.ext||'file').toUpperCase()];if(Number(a.size)>0)bits.push(bytes(a.size));if(a.tags?.length)bits.push(a.tags.length+(a.tags.length===1?' tag':' tags'));return bits.join(' · ');}
function notify(message){clearTimeout(toastTimer);const toast=$('#toast');toast.textContent=message;toast.hidden=false;Motion.fadeScaleIn(toast,null,{fromScale:0.96,fromOpacity:0.5,duration:180});toastTimer=setTimeout(()=>{toast.hidden=true;},5500);}
async function safe(fn){try{return await fn();}catch(e){notify((e.message||String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}}
function viewIdentity(){return JSON.stringify([view,collection,tagFilter,$('#search').value,$('#type').value,$('#sort').value,galleryLayout]);}
const galleryPositions=new Map();
let pendingGalleryPosition=null,lastTagFilter=null,restoreHoldUntil=0;
function rememberGalleryPosition(){
 if(view==='canvas'||view==='infinite'||view==='smart'||!layout||layout.items!==visible||pendingGalleryPosition)return;
 if(pagedCatalog&&catalogKey!==JSON.stringify(catalogQuery()))return;
 const gallery=$('#gallery'),key=viewIdentity();
 galleryPositions.delete(key);
 galleryPositions.set(key,{top:gallery.scrollTop,count:visible.length,anchor:AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight)});
 if(galleryPositions.size>40)galleryPositions.delete(galleryPositions.keys().next().value);
}
function restoreGalleryPosition(){
 const key=viewIdentity(),saved=galleryPositions.get(key);
 pendingGalleryPosition=saved?{key,...saved}:pendingGalleryPosition||null;
 $('#gallery').scrollTop=0;
}
const catalogPageSize=120;
let pagedCatalog=true,catalogKey='',catalogTotal=0,catalogLoading=null,catalogGeneration=0,catalogNavigation=null,catalogHydration=null,temporaryCatalog=false;
function catalogQuery(){
 const sets={image:imageExt,video:videoExt,audio:audioExt,pdf:['pdf'],link:['url','webloc']};
 const type=$('#type').value;
 const viewExt=sets[view],typeExt=sets[type];
 const extensions=viewExt&&typeExt?viewExt.filter(ext=>typeExt.includes(ext)):viewExt||typeExt||[];
 const query=$('#search').value.trim().toLowerCase();
 const bookmark=['social','recipe'].includes(view)?view:['social','recipe'].includes(type)?type:'';
 const excludeBookmarks=!bookmark&&(view==='link'||type==='link');
 return {view,folder:collection,tag:tagFilter,sort:$('#sort').value,query,matches:SmartSearch.resultIds(query),bookmark,excludeBookmarks,
  extensions:viewExt&&(type==='other'||typeExt&&!extensions.length)?['']:extensions,
  other:type==='other'&&!viewExt,knownExtensions:Object.values(sets).flat()};
}
function storeCatalogRows(rows){
 return rows.map(next=>{
  const old=assetById.get(next.id),asset=old?Object.assign(old,next):next;
  asset.searchText=SmartCards.enrichSearch(asset);return asset;
 });
}
function applyCatalogNavigation(data){
 catalogNavigation=data.navigation;
 folders=data.folders;
 if(data.prototype)document.title='Canvas Pro Prototype';
 WorkbenchUI.setData(data.workbench);
 CanvasWorkspace.setList(data.canvases||[],data.folderRecords||[]);
 const counts={image:0,video:0,audio:0,pdf:0,link:0,social:0,recipe:0,...data.navigation.counts,tags:data.navigation.tags.length};
 for(const item of data.navigation.extensions){const type=kind(item);counts[type]=(counts[type]||0)+item.count;}
 for(const item of data.navigation.linkTypes||[])counts[item.type]=item.count;
 navStats={counts,members:new Map(data.navigation.members)};
 renderNav();
}
async function loadLibraryPage({append=false,reload=false}={}){
 if(!pagedCatalog||view==='canvas'||view==='smart')return;
 const query=catalogQuery(),key=JSON.stringify(query);
 if(append&&(!catalogKey||catalogKey!==key||catalogLoading||assets.length>=catalogTotal))return;
 if(!append&&!reload&&catalogLoading?.key===key)return catalogLoading.promise;
 const generation=++catalogGeneration,offset=append?assets.length:0;
 const gallery=$('#gallery'),anchor=layout&&catalogKey===key?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null;
 const restored=pendingGalleryPosition?.key===viewIdentity()?pendingGalleryPosition.count:0;
 const target=Math.max(catalogPageSize,restored,reload&&catalogKey===key?assets.length:0);
 const request={key};
 request.promise=(async()=>{
  const data=await api.libraryPage({...query,offset,limit:append?catalogPageSize:Math.min(500,target),navigation:reload});
  if(generation!==catalogGeneration||!pagedCatalog)return;
  let rows=data.assets||[],serverTotal=data.total;
  if(append){
   let added=storeCatalogRows(rows).filter(asset=>!assetById.has(asset.id));
   let nextOffset=offset+rows.length;
   // Offset pages can shift and return rows already loaded; skip duplicate
   // windows instead of truncating the catalog and hiding later items.
   while(!added.length&&rows.length&&serverTotal!=null&&nextOffset<serverTotal){
    const next=await api.libraryPage({...query,offset:nextOffset,limit:catalogPageSize});
    if(generation!==catalogGeneration||!pagedCatalog)return;
    serverTotal=next.total??serverTotal;
    rows=next.assets||[];
    nextOffset+=rows.length;
    added=storeCatalogRows(rows).filter(asset=>!assetById.has(asset.id));
    if(!rows.length)break;
   }
   if(data.navigation)applyCatalogNavigation(data);
   if(added.length){
    for(const asset of added)assetById.set(asset.id,asset);
    assets=assets.concat(added);
   }
   if(serverTotal!=null)catalogTotal=serverTotal;
   if(!added.length&&!rows.length&&serverTotal!=null)catalogTotal=assets.length;
  }else{
   const limitTarget=Math.min(target,serverTotal??target);
   while(rows.length<limitTarget){
    const next=await api.libraryPage({...query,offset:rows.length,limit:Math.min(500,limitTarget-rows.length)});
    if(generation!==catalogGeneration||!pagedCatalog)return;
    serverTotal=next.total??serverTotal;
    if(!next.assets?.length)break;
    rows=rows.concat(next.assets);
   }
   if(data.navigation)applyCatalogNavigation(data);
   const prepared=storeCatalogRows(rows);
   assets=prepared;assetById=new Map(assets.map(asset=>[asset.id,asset]));
   for(const id of linkRequests.keys())if(!assetById.has(id))linkRequests.delete(id);
   catalogTotal=serverTotal;catalogKey=key;
  }
  const focused=document.activeElement;
  render({anchor,preserveInspector:append||$('#inspector').contains(focused)&&focused.matches('input,textarea,select')});
  if(!catalogNavigation)requestAnimationFrame(()=>setTimeout(()=>safe(async()=>{
   if(!pagedCatalog||catalogNavigation)return;
   const navigation=await api.libraryNavigation();
   if(pagedCatalog&&!catalogNavigation)applyCatalogNavigation(navigation);
  }),0));
 })();
 catalogLoading=request;
 try{return await request.promise;}finally{if(catalogLoading===request)catalogLoading=null;}
}
function hydrateCatalog(){
 if(catalogHydration)return catalogHydration;
 // The wall needs the full library even when a prior full refresh left the
 // paged catalog off.
 temporaryCatalog=true;
 // Load the whole library for the unbounded wall. Going through refresh()
 // here would re-enter render() -> hydrateCatalog() and keep replacing the
 // asset set, so update the catalog directly and ask the wall to rebuild.
 catalogHydration=(async()=>{
  const data=await api.list();
  if(!data?.assets)return;
  assets=data.assets.map(next=>{const old=assetById.get(next.id);return old?Object.assign(old,next):next;});
  assetById=new Map(assets.map(a=>[a.id,a]));
  for(const a of assets)a.searchText=SmartCards.enrichSearch(a);
  catalogTotal=assets.length;
  // This replaces the whole catalog, so it is a refresh as far as the capture
  // counters are concerned. Without this, captures after the wall has been
  // opened see stale counters and force a needless full refresh.
  appliedRefreshVersion=++refreshVersion;
  if(view==='infinite'){
   window.InfiniteCanvas?.show(true);
   const wall=window.InfiniteCanvas?.scope()||[];
   visible=wall;selection.sync(wall.map(a=>a.id));selected=selection.focus;
  }
 })().finally(()=>catalogHydration=null);
 return catalogHydration;
}
function refreshCurrent(){return pagedCatalog?loadLibraryPage({reload:true}):refresh();}
async function refresh(){
 const wasPaged=pagedCatalog;
 pagedCatalog=false;catalogGeneration++;catalogLoading=null;catalogNavigation=null;
 try{
  const version=++refreshVersion,identity=viewIdentity(),gallery=$('#gallery');
  const anchor=layout?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null;
  const data=await api.list(500);const navigation=await api.libraryNavigation();if(version!==refreshVersion)return;applyCatalogNavigation(navigation);
  appliedRefreshVersion=version;
  const focused=document.activeElement,preserveInspector=$('#inspector').contains(focused)&&focused.matches('input,textarea,select');
  assets=data.assets.map(next=>{const old=assetById.get(next.id);return old?Object.assign(old,next):next;});assetById=new Map(assets.map(a=>[a.id,a]));for(const id of linkRequests.keys())if(!assetById.has(id))linkRequests.delete(id);
  for(const a of assets)a.searchText=SmartCards.enrichSearch(a);
  render({preserveInspector,anchor:identity===viewIdentity()?anchor:null});
 }catch(error){
  pagedCatalog=wasPaged;
  throw error;
 }
}

async function refreshCaptured(ids){
 if(!appliedRefreshVersion||appliedRefreshVersion!==refreshVersion||ids.length>500)return refresh();
 if(!ids.length)return;
 const version=refreshVersion;
 const changed=await api.captureAssets(ids);
 if(version!==refreshVersion)return refresh();
 const gallery=$('#gallery'),anchor=layout&&gallery.scrollTop>0?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null;
 const added=[];
 for(const next of changed){
   const existing=assetById.get(next.id);
   const asset=existing?Object.assign(existing,next):next;
   asset.searchText=SmartCards.enrichSearch(asset);
   if(!existing){assetById.set(asset.id,asset);added.push(asset);}
 }
 if(added.length){
   assets=added.concat(assets).sort((a,b)=>b.imported.localeCompare(a.imported)||(b.importOrder||0)-(a.importOrder||0));
 }
 navStats=null;
 renderNav();
 render({anchor,preserveInspector:$('#inspector').contains(document.activeElement)&&document.activeElement.matches('input,textarea,select')});
}

function current(){return selection.ids.size?assetById.get(selected):null;}
function navButton(label,icon,count,active,handler){const b=el('button',active?'active':'');b.append(glyph(icon,{size:16}),el('span','',label));/* A row without a count has no badge at all. */if(count!==null&&count!==undefined)b.append(el('span','badge',String(count)));b.title=label;b.setAttribute('aria-label',label);b.onclick=handler;return b;}
function setView(next,folder=null,keepCatalog=false,options={}){if(!$('#preview').hidden&&next!==view)closePreview();rememberGalleryPosition();if(!options.keepWorkbench)WorkbenchUI.reset();if(next!=='canvas'&&next!=='infinite'&&view==='canvas')CanvasWorkspace.leave();stopHover();
 if(temporaryCatalog&&!keepCatalog&&!['canvas','smart','infinite'].includes(next)){
  temporaryCatalog=false;pagedCatalog=true;catalogKey='';catalogNavigation=null;
 }
view=next;collection=folder;tagFilter=next==='tags'?lastTagFilter:null;pendingSelection=options.pendingSelection||null;selected=null;selection.clear();$('#search').value='';if(options.type)$('#type').value=options.type;else $('#type').value='all';syncViewMenu();restoreGalleryPosition();
 renderNav();render();
 // SmartSearch.schedule() calls render() synchronously for an empty query.
 // Calling it here, after the saved position is pending, lets the first
 // catalogue page be sized to include that position instead of firing off a
 // 120-item request that clamps and discards it.
 SmartSearch.schedule();}
function renderNav(){
 if(!navStats){const counts={all:0,favorites:0,trash:0,image:0,video:0,audio:0,pdf:0,link:0,social:0,recipe:0},tags=new Set(),members=new Map();for(const a of assets){if(a.trash){counts.trash++;continue;}counts.all++;if(a.favorite)counts.favorites++;counts[kind(a)]=(counts[kind(a)]||0)+1;const linkType=SmartCards.type(a);if(linkType==='social'||linkType==='recipe')counts[linkType]=(counts[linkType]||0)+1;for(const t of a.tags)tags.add(t);for(const f of a.folders)members.set(f,(members.get(f)||0)+1);}counts.tags=tags.size;navStats={counts,members};}
 const {counts,members}=navStats,nav=$('#navigation'),folderIds=new Map(CanvasWorkspace.folderRecords.map(folder=>[folder.name,folder.id]));nav.replaceChildren();for(const [key,label,icon]of [['all','Library','library'],['favorites','Favourites','star'],['tags','Tags','tag'],['trash','Trash','trash']])nav.append(navButton(label,icon,counts[key],view===key,()=>setView(key)));
 const webLinks=Math.max(0,(counts.link||0)-(counts.social||0)-(counts.recipe||0));
 const mediaNav=$('#media-navigation');mediaNav.replaceChildren();for(const [key,label,icon]of [['image','Images','image'],['video','Video','video'],['audio','Audio','audio'],['social','Social','camera'],['recipe','Recipes','book'],['pdf','Documents','docText'],['link','Web links','link']])mediaNav.append(navButton(label,icon,key==='link'?webLinks:counts[key],view===key,()=>setView(key)));
 $('#folders').replaceChildren(...folders.map(f=>{const button=navButton(f,'folder',members.get(f)||0,view==='folder'&&collection===f,()=>setView('folder',f));const folderId=folderIds.get(f);if(folderId)button.firstChild.replaceWith(WorkbenchUI.icon('folder:'+folderId));button.oncontextmenu=e=>{e.preventDefault();safe(()=>api.collectionMenu(f));};button.draggable=true;button.ondragstart=e=>{e.dataTransfer.setData('application/x-canvaspro-collection',f);e.dataTransfer.effectAllowed='copy';};button.ondragend=()=>CanvasWorkspace.clearDrag();return button;}));CanvasWorkspace.renderNav();
}
async function setFavorites(ids,favorite){await api.bulkUpdate(ids,{type:'favorite',favorite});if(pagedCatalog)return refreshCurrent();for(const id of ids){const a=assetById.get(id);if(a)a.favorite=favorite?1:0;}navStats=null;renderNav();render();}
function favoriteButton(a){const b=action('',()=>setFavorites([a.id],!a.favorite),'favorite-toggle'+(a.favorite?' is-favorite':''));b.append(glyph(a.favorite?'starFill':'star'));b.setAttribute('aria-label',a.favorite?'Remove from Favourites':'Add to Favourites');b.setAttribute('aria-pressed',String(!!a.favorite));b.title=b.getAttribute('aria-label');b.onclick=event=>{event.stopPropagation();safe(()=>setFavorites([a.id],!a.favorite));};b.ondblclick=event=>event.stopPropagation();return b;}
function placeholder(a){const d=el('div','file-placeholder');d.append(glyph(kind(a)==='link'?'link':kind(a)==='audio'?'audio':kind(a)==='video'?'video':'file'),el('span','',(a.ext||'FILE').toUpperCase()));return d;}
function thumb(a,cls='',gallery=false){const img=el('img',cls);img.loading='lazy';img.decoding='async';img.alt=a.name;img.src='asset://thumb/'+a.id+'?v=2'+(gallery?'&gallery':'');img.onload=()=>{if(img.naturalWidth&&img.naturalHeight)rememberRatio(a,img.naturalWidth/img.naturalHeight);};img.onerror=()=>{img.replaceWith(placeholder(a));};return img;}
function inspectorPreview(a){
 const frame=el('div','inspector-media');
 if(kind(a)==='audio'){
   frame.classList.add('inspector-audio');frame.append(placeholder(a));
   getMediaInfo(a,true).then(info=>{if(!frame.isConnected||!info.artwork)return;const img=el('img');img.alt='Embedded cover art';img.src='asset://art/'+a.id;img.onerror=()=>frame.replaceChildren(placeholder(a));frame.replaceChildren(img);}).catch(()=>{});
 }else frame.append(kind(a)==='link'?bookmarkVisual(a):SmartCards.fileVisual(a)||thumb(a));
 frame.title='Double-click to preview';frame.ondblclick=()=>openPreview();
 return frame;
}
let hoverIntent=null,imageHover=null;
function hideImageHover(){
 if(imageHover?.timer)clearTimeout(imageHover.timer);
 imageHover=null;
 const box=$('#hover-preview');
 if(box&&!box.hidden){box.hidden=true;box.querySelector('img').removeAttribute('src');}
}
// Eagle-style glance preview: after one 200ms beat, float the full image in
// whichever side of the tile has the most room. It is an aria-hidden overlay,
// so the grid keeps focus and the pointer can pass straight through it.
function showImageHover(a,card){
 const box=$('#hover-preview');
 if(!box||!card.isConnected)return;
 const rect=card.getBoundingClientRect(),pad=16,gap=10;
 const room={right:innerWidth-rect.right-pad,left:rect.left-pad,bottom:innerHeight-rect.bottom-pad,top:rect.top-pad};
 const side=Object.entries(room).sort((one,two)=>two[1]-one[1])[0][0];
 const horizontal=side==='left'||side==='right';
 const availW=horizontal?room[side]:innerWidth-pad*2, availH=horizontal?innerHeight-pad*2:room[side];
 if(availW<120||availH<120)return;
 const ratio=Math.min(4,Math.max(.25,assetRatio(a,rect.width)||1));
 let width=Math.min(480,availW,availH*ratio),height=width/ratio;
 if(height>availH){height=availH;width=height*ratio;}
 let left=side==='right'?rect.right+gap:side==='left'?rect.left-gap-width:rect.left+rect.width/2-width/2;
 let top=side==='bottom'?rect.bottom+gap:side==='top'?rect.top-gap-height:rect.top+rect.height/2-height/2;
 left=Math.max(pad,Math.min(innerWidth-width-pad,left));
 top=Math.max(pad,Math.min(innerHeight-height-pad,top));
 const img=box.querySelector('img'),label=box.querySelector('.hover-preview-label');
 box.style.left=Math.round(left)+'px';box.style.top=Math.round(top)+'px';
 img.style.width=Math.round(width)+'px';img.style.height=Math.round(height)+'px';
 label.textContent=a.name;
 img.dataset.fallback='';
 img.onerror=()=>{if(img.dataset.fallback)return;img.dataset.fallback='1';img.src='asset://thumb/'+a.id+'?v=2';};
 img.src='asset://preview/'+a.id;
 box.hidden=false;
 Motion.fadeScaleIn(box,card);
}
function stopHover(){if(hoverIntent){clearTimeout(hoverIntent.timer);hoverIntent=null;}if(hoverPlayer){hoverPlayer.dispose();hoverPlayer=null;}hideImageHover();}
function unmount(id){if(hoverIntent?.id===id){clearTimeout(hoverIntent.timer);hoverIntent=null;}if(hoverPlayer?.id===id)stopHover();if(imageHover?.id===id)hideImageHover();cardCleanup.get(id)?.();cardCleanup.delete(id);const card=mounted.get(id);if(card)SmartCards.release(card);card?.remove();mounted.delete(id);}
function makeCard(a){const card=el('article','card');card.id='gallery-option-'+a.id;card.dataset.id=a.id;card.setAttribute('role','option');card.setAttribute('aria-label',a.name);card.draggable=true;card.title='Drag out to Finder · Option-drag to a Canvas';card.onpointerdown=e=>{if(e.button===0&&e.pointerType!=='touch')api.prepareDrag(selection.ids.has(a.id)?selection.values():[a.id]);};card.ondragstart=e=>{stopHover();const ids=selection.ids.has(a.id)?selection.values():[a.id];if(e.altKey){e.dataTransfer.setData('application/x-canvaspro-assets',JSON.stringify(ids));e.dataTransfer.effectAllowed='copy';}else{e.preventDefault();safe(()=>api.startDrag(ids));}};card.ondragend=()=>CanvasWorkspace.clearDrag();const surface=el('div','card-surface');const type=kind(a);if(type==='audio')cardCleanup.set(a.id,audioTile(a,surface));else surface.append(type==='link'?bookmarkVisual(a):SmartCards.fileVisual(a)||thumb(a,'',true));
// The drag hint is useful on a still card, but a native tooltip lingers over
// video and GIF previews right where the scrub bar appears. Hide it while the
// pointer is on their picture and bring it back on the filename.
if(type==='video'||type==='audio'||a.ext==='gif'||a.ext==='gifv'){const hint=card.title;surface.addEventListener('pointerenter',()=>{card.title='';});surface.addEventListener('pointerleave',()=>{card.title=hint;});}
if(!a.trash)surface.append(favoriteButton(a));if(type==='video'||type==='audio'){const duration=el('span','duration');surface.append(duration);getMediaInfo(a).then(info=>{if(info.duration)duration.textContent=timecode(info.duration);}).catch(()=>{});}
card.onpointerenter=e=>{
 if(e.pointerType==='touch'||!$('#preview').hidden||selection.ids.size>1)return;
 if(type==='video'||type==='audio'){
  if(hoverIntent?.id===a.id)return;
  stopHover();
  hoverIntent={id:a.id,timer:setTimeout(()=>{if(hoverIntent?.id!==a.id||!card.isConnected||!$('#preview').hidden||selection.ids.size>1)return;hoverIntent=null;const player=createPlayer(a,{compact:true,muted:type==='video'});player.id=a.id;hoverPlayer=player;surface.append(player.element);},180)};
  return;
 }
 if(type==='link'||SmartCards.isNote(a)||a.noPreview)return;
 if(imageHover?.id===a.id)return;
 hideImageHover();
 imageHover={id:a.id,timer:setTimeout(()=>{if(imageHover?.id!==a.id||!card.isConnected||!$('#preview').hidden||selection.ids.size>1)return;imageHover=null;showImageHover(a,card);},200)};
};card.onpointerleave=()=>{if(hoverIntent?.id===a.id){clearTimeout(hoverIntent.timer);hoverIntent=null;}if(hoverPlayer?.id===a.id)stopHover();if(imageHover?.id===a.id){clearTimeout(imageHover.timer);imageHover=null;}hideImageHover();};
const meta=el('div','card-meta'),details=el('div','card-details');details.append(el('span','card-detail',cardDetail(a)));meta.append(el('span','card-name',a.name),details);card.append(surface,meta);card._parts={
 name:meta.firstChild,detail:details.lastChild,star:surface.querySelector('.favorite-toggle'),
 visual:type==='link'?surface.querySelector('.link-visual'):null
};card.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();stopHover();if(!selection.ids.has(a.id))select(a.id);safe(()=>api.contextMenu(selection.values(),view==='folder'?collection:null));};card.onclick=e=>{if(e.ctrlKey&&navigator.platform.includes('Mac'))return;if(!e.target.closest('.player-controls,.player-wave'))select(a.id,e);};card.ondblclick=e=>{if(!e.target.closest('.player-controls,.player-wave')){select(a.id);openPreview();}};return card;}
function scheduleGallery(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;renderWindow();});}
function renderWindow(anchorOverride=null){if(view==='canvas'||view==='infinite')return;
 const gallery=$('#gallery'),layer=$('#gallery-layer'),size=Number($('#zoom').value);
 if(pagedCatalog&&catalogLoading&&catalogLoading.key!==catalogKey)return;
 const restored=pendingGalleryPosition&&pendingGalleryPosition.key===viewIdentity()?pendingGalleryPosition:null;
 if(layoutDirty||!layout||layout.items!==visible||Math.abs(layout.width-gallery.clientWidth)>1||layout.target!==size||layout.mode!==galleryLayout){
  const anchor=anchorOverride||(layout?.items===visible?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null);
  // Cards with no tags render only a title, so their footer is shorter.
  // Using one fixed footer height for every card leaves uneven blank rows.
  // Cards with names hidden take no footer room; when names are shown the
  // layout reserves the footer's real height so the next row starts below it.
  const footerHeight=galleryCardFooterHeight;
  layout=AssetLayout.createLayout(galleryLayout,visible,gallery.clientWidth,size,assetRatio,footerHeight);layoutDirty=false;layer.style.height=layout.height+'px';
  // While a saved position is being restored, thumbnails that finish loading
  // can change tile heights. Keep the restored offset instead of sliding the
  // gallery to follow a different anchor, or the view jumps after coming back.
  const position=anchor&&layout.byId.get(anchor.id);if(position&&performance.now()>=restoreHoldUntil)gallery.scrollTop=position.y+anchor.offset*(position.width/anchor.width);
 }
 let pendingShortfall=false;
 if(restored){
  const anchor=restored.anchor,position=anchor&&layout.byId.get(anchor.id);
  const target=position?position.y+anchor.offset*(position.width/anchor.width):restored.top;
  const maxScroll=Math.max(0,layout.height-gallery.clientHeight);
  // Switching views reloads the paged catalogue from its first page. The
  // saved place can sit below the rows loaded so far, and the browser would
  // clamp the scroll and lose it for good. Hold on to the pending position
  // until the catalogue is tall enough, and bring in the missing pages.
  if(target>maxScroll+2&&pagedCatalog&&assets.length<catalogTotal){
   pendingShortfall=true;
   if(!catalogLoading)safe(()=>loadLibraryPage({append:true}));
  }else{
   gallery.scrollTop=Math.min(target,maxScroll);
   pendingGalleryPosition=null;
   restoreHoldUntil=performance.now()+1200;
  }
 }
 if(pagedCatalog&&!pendingShortfall&&gallery.scrollTop+gallery.clientHeight>=layout.height-Math.max(200, gallery.clientHeight * 0.15)&&assets.length<catalogTotal)safe(()=>loadLibraryPage({append:true}));
 const indices=AssetLayout.visibleIndices(layout,gallery.scrollTop,gallery.clientHeight),visibleList=indices.map(i=>visible[i].id),ids=new Set(visibleList);
 publishVisibleAssets(visibleList);
 for(const id of mounted.keys())if(!ids.has(id))unmount(id);
 for(const i of indices){
  const a=visible[i],position=layout.positions[i];
  let card=mounted.get(a.id);
  if(!card){card=makeCard(a);mounted.set(a.id,card);layer.append(card);}
  if(card._position!==position){
   card._position=position;
   card.style.width=position.width+'px';
   card.style.transform=`translate(${position.x}px,${position.y}px)`;
   card.style.setProperty('--surface-height',position.surfaceHeight+'px');
   card.style.setProperty('--card-width',position.width+'px');
  }
  const chosen=selection.ids.has(a.id),focused=a.id===selected;
  card.classList.toggle('selected',chosen);
  card.classList.toggle('focused',focused);
  if(card.getAttribute('aria-selected')!==String(chosen))card.setAttribute('aria-selected',String(chosen));card.setAttribute('aria-label',chosen?a.name+' (selected)':a.name);
  const parts=card._parts,displayName=parts.visual?(a.captureMetadata?.linkPreview?.title||a.name.replace(/\.(url|webloc)$/i,'')):a.name;
  if(parts.name.textContent!==displayName)parts.name.textContent=displayName;
  if(parts.visual&&parts.visual.dataset.url!==a.url){
   const replacement=bookmarkVisual(a);
   SmartCards.release(parts.visual);
   parts.visual.replaceWith(replacement);
   parts.visual=replacement;
  }
  if(parts.star&&parts.star.getAttribute('aria-pressed')!==String(!!a.favorite)){
   parts.star.classList.toggle('is-favorite',!!a.favorite);
   parts.star.setAttribute('aria-pressed',String(!!a.favorite));
   parts.star.setAttribute('aria-label',a.favorite?'Remove from Favourites':'Add to Favourites');
   parts.star.title=parts.star.getAttribute('aria-label');
  }
  const detail=cardDetail(a);
  if(parts.detail.textContent!==detail)parts.detail.textContent=detail;
 }
  // Cards are positioned with transforms, so DOM order otherwise stays in
  // import order after sorting. Keep the listbox's reading order in sync with
  // the visual order without re-mounting cards on every scroll frame.
  const ordered=indices.map(i=>mounted.get(visible[i].id)).filter(Boolean);
  if(ordered.length===layer.childElementCount&&ordered.some((card,i)=>layer.children[i]!==card)){
   const top=gallery.scrollTop;
   layer.replaceChildren(...ordered);
   if(gallery.scrollTop!==top)gallery.scrollTop=top;
  }
  $('#gallery').setAttribute('aria-activedescendant',selected?'gallery-option-'+selected:'');
}
// The canonical filter for the current view/collection/tag/search/type. render()
// uses it to build `visible`; Select All reuses it after hydration so it spans
// the whole library rather than just the loaded page.
function filteredAssets(records){
 const q=$('#search').value.trim().toLowerCase(),type=$('#type').value;
 const list=records.filter(a=>{if(view==='trash'?!a.trash:a.trash)return false;if(!WorkbenchUI.accepts(a))return false;if(view==='folder'&&!a.folders.includes(collection))return false;if(view==='tags'&&!a.tags.length)return false;if(view==='favorites'&&!a.favorite)return false;if(['image','audio','video','pdf'].includes(view)&&kind(a)!==view)return false;if(view==='link'&&(kind(a)!=='link'||['social','recipe'].includes(SmartCards.type(a))))return false;if(['social','recipe'].includes(view)&&SmartCards.type(a)!==view)return false;if(tagFilter&&!a.tags.includes(tagFilter))return false;if(type!=='all'&&(type==='link'?(kind(a)!=='link'||['social','recipe'].includes(SmartCards.type(a))):kind(a)!==type&&SmartCards.type(a)!==type))return false;return !q||SmartSearch.includes(a,q);});
 // Find similar and colour matching both rank the gallery: closest match
 // first, instead of the order the files happened to be imported in.
 if(WorkbenchUI.rankOrder())list.sort((x,y)=>WorkbenchUI.rank(x)-WorkbenchUI.rank(y));if($('#sort').value==='old')list.sort((a,b)=>a.imported.localeCompare(b.imported)||(a.importOrder||0)-(b.importOrder||0));if($('#sort').value==='name')list.sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));if($('#sort').value==='size')list.sort((a,b)=>b.size-a.size);
 return list;
}
function render(options={}){stopHover();
 if(view==='canvas'){if($('#preview').hidden){visible=[];selection.sync([]);selected=null;}InfiniteCanvas.show(false);CanvasWorkspace.render();return;}CanvasWorkspace.show(false);
 if(view==='infinite'){$('#view-title').textContent='Infinite canvas';safe(hydrateCatalog);InfiniteCanvas.show(true);const wall=window.InfiniteCanvas?.scope()||[];visible=wall;/* The wall is its own set of items, independent of the library view it was opened from. Keeping that view's selection index would make clicks on wall items outside it fall back to whatever was selected before. */selection.sync(wall.map(a=>a.id));selected=selection.focus;InfiniteCanvas.syncSelection();return;}InfiniteCanvas.show(false);
 if(pagedCatalog&&view==='smart'){safe(hydrateCatalog);return;}
 const tags=view==='tags'?(pagedCatalog?catalogNavigation?.tags:[...new Set(assets.filter(a=>!a.trash).flatMap(a=>a.tags))].sort()):null;
 if(tags&&tagFilter&&!tags.includes(tagFilter)){
  tagFilter=lastTagFilter=null;restoreGalleryPosition();
 }
 if(pagedCatalog&&catalogKey!==JSON.stringify(catalogQuery())){safe(loadLibraryPage);return;}
 if(pagedCatalog){visible=assets;selection.sync(visible.map(a=>a.id));selected=selection.focus;}
 else{
 visible=filteredAssets(assets);
 selection.sync(visible.map(a=>a.id));selected=selection.focus;
 }
if(pendingSelection){const id=pendingSelection;pendingSelection=null;if(selection.index.has(id)){selection.select(id);selected=selection.focus;}}
$('#view-title').textContent=view==='smart'?WorkbenchUI.title:view==='folder'?collection:({all:'Library',favorites:'Favourites',tags:'Tags',trash:'Trash',image:'Images',audio:'Audio',video:'Video',social:'Social',recipe:'Recipes',pdf:'Documents',link:'Web links'})[view];const count=pagedCatalog?catalogTotal:visible.length;$('#count').textContent=count.toLocaleString()+(count===1?' item':' items');const bar=$('#tags-bar');bar.hidden=view!=='tags';bar.replaceChildren();if(view==='tags')for(const tag of tags||[]){const b=el('button',tagFilter===tag?'primary':'',tag);b.onclick=()=>{rememberGalleryPosition();tagFilter=lastTagFilter=tagFilter===tag?null:tag;restoreGalleryPosition();render();};bar.append(b);}renderEmptyState();renderWindow(options.anchor);paintSelection();if(!options.preserveInspector)renderInspector();}
function paintSelection(){for(const [id,card]of mounted){card.classList.toggle('selected',selection.ids.has(id));card.classList.toggle('focused',id===selected);card.setAttribute('aria-selected',String(selection.ids.has(id)));}const count=selection.ids.size;$('#selection-count').textContent=count===0?'':count.toLocaleString()+' selected';$('#gallery').setAttribute('aria-activedescendant',selected?'gallery-option-'+selected:'');}
function select(id,options={}){if(colorFocus&&!options.keepColorFocus)colorFocus=null;selection.select(id,options);selected=selection.focus;if(selection.ids.size>1)stopHover();paintSelection();if(view==='infinite')window.InfiniteCanvas?.syncSelection(selection.ids,selected);scheduleInspector();}
// Selecting a colour turns File Details into a colour report. Selecting an
// item again leaves the report and restores the ordinary file details.
function showColorDetails(hex){colorFocus={hex};renderInspector();}
function scheduleInspector(){if(inspectorFrame)return;inspectorFrame=requestAnimationFrame(()=>{inspectorFrame=0;renderInspector();});}
async function bulkAction(operation){const ids=selection.values();if(!ids.length)return;await api.bulkUpdate(ids,operation);await refreshCurrent();const count=ids.length+' '+(ids.length===1?'file':'files');notify(operation.type==='trash'?(operation.trash?'Moved '+count+' to Trash.':'Restored '+count+'.'):'Updated '+count+'.');}
function renderSelectionInspector(){
 const box=$('#inspector'),ids=selection.values(),items=ids.map(id=>assetById.get(id)).filter(Boolean);box.replaceChildren(el('div','inspector-label','SELECTION'));
 const stack=el('div','selection-stack');
 // The newest selection is the subject: it is the one fully visible in the
 // middle of the stack, and the files selected before it recede behind it.
 // The old fan ran the other way — the first pick sat highest on screen and
 // the file you had just added was pushed down and out of the way.
 const recent=items.slice(-5);
 for(const [i,a]of recent.entries()){
  const depth=recent.length-1-i;
  const face=el('div','stack-card'+(depth===0?' stack-card-lead':''));
  face.style.setProperty('--depth',String(depth));
  face.style.zIndex=String(10-depth);
  face.append(kind(a)==='link'?bookmarkVisual(a):thumb(a));
  stack.append(face);
 }box.append(stack,el('h2','selection-title',items.length.toLocaleString()+' files selected'),el('p','hint',new Set(items.map(a=>a.ext)).size+' file types'));
 const tags=section('Add tags to all');const tagInput=field('','Tags, separated by commas',async value=>{const list=value.split(',').map(t=>t.trim()).filter(Boolean);if(list.length)await bulkAction({type:'tags',tags:list});});tagInput.id='bulk-tags';tagInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();tagInput.blur();}};tags.append(tagInput);box.append(tags);
 const collections=section('Add to collection');const choice=field('','Collection name, then Enter',async text=>{const name=text.trim();if(!name)return;if(!folders.includes(name)){folders.push(name);folders.sort((one,two)=>one.localeCompare(two));await api.addFolder(name);}await bulkAction({type:'collection',folder:name});});choice.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();choice.blur();}};collections.append(choice);box.append(collections);
 const canvas=section('Canvas');if(view!=='trash')canvas.append(action('Add to Canvas…',()=>CanvasWorkspace.choose({ids})));box.append(canvas);
 const favourites=section('Favourites');favourites.append(action(items.every(a=>a.favorite)?'Remove from Favourites':'Add to Favourites',()=>setFavorites(ids,!items.every(a=>a.favorite))));box.append(favourites);
 const names=section('Selected files');const list=el('div','selection-names');for(const a of items.slice(0,8))list.append(el('p','',a.name));if(items.length>8)list.append(el('p','hint','and '+(items.length-8)+' more'));names.append(list);box.append(names);
 const actions=el('div','inspector-actions');actions.append(action('Copy '+items.length+' files',async()=>{await api.copyFiles(ids);notify(items.length+' files copied.');}),action('Export copies',async()=>{const count=await api.exportFiles(ids);if(count)notify(count+' copies exported.');}),action(view==='trash'?'Restore selection':'Move selection to Trash',()=>bulkAction({type:'trash',trash:view!=='trash'}),view==='trash'?'':'danger'),action('Share…',()=>api.shareFiles(ids)),...(view==='trash'?[action('Delete Permanently…',()=>deleteSelectedPermanently(ids),'danger')]:[]),action('Clear selection',()=>{selection.clear();selected=null;paintSelection();renderInspector();}));box.append(actions);
}
async function update(changes,{repaint=true}={}){const a=current();if(!a)return;const saved=await api.update(a.id,changes);Object.assign(a,saved);a.trash=a.trash?1:0;a.searchText=SmartCards.enrichSearch(a);if(pagedCatalog)return refreshCurrent();navStats=null;renderNav();/* A panel that must stay put, because a list is open in it, still gets its
 cards repainted: the card carries a file's tag count. */if(repaint)render();else renderWindow();}
function field(value, placeholder, handler, multiline=false) {const input=el(multiline?'textarea':'input'); input.value=value; input.placeholder=placeholder; input.setAttribute('aria-label',placeholder); input.onchange=()=>safe(()=>handler(input.value)); return input;}
// Existing names that match what is being typed, offered as chips under the
// field. Choosing one runs the field's own change handler, so adding a tag or
// collection works exactly as if it had been typed and confirmed.
function entrySuggestions(input, choices) {
  const list=el('div','entry-suggestions');
  list.setAttribute('role','listbox');
  list.setAttribute('aria-label','Existing matches');
  list.hidden=true;
  function close(){list.hidden=true;list.replaceChildren();}
  function paint(){
    const query=input.value.trim().toLowerCase();
    if(!query){close();return;}
    const matches=choices().filter(name=>name.toLowerCase().includes(query)).slice(0,6);
    if(!matches.length){close();return;}
    list.replaceChildren(...matches.map(name=>{
      const option=el('button','entry-suggestion',name);
      option.type='button';
      option.setAttribute('role','option');
      option.title='Add “'+name+'”';
      // Keep focus in the field until the choice has been applied.
      option.onmousedown=event=>event.preventDefault();
      option.onclick=()=>{
        input.value=name;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        close();
      };
      return option;
    }));
    list.hidden=false;
  }
  input.addEventListener('input',paint);
  input.addEventListener('focus',paint);
  input.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==input)close();},120));
  return list;
}
function knownTags() {
  if(pagedCatalog&&catalogNavigation?.tags)return catalogNavigation.tags;
  return [...new Set(assets.filter(a=>!a.trash).flatMap(a=>a.tags))].sort((one,two)=>one.localeCompare(two));
}
function section(title) {const s=el('section');s.append(el('h3','',title));return s;}
function action(text,handler,cls='') {const b=el('button',cls,text); b.onclick=()=>safe(handler);return b;}
function removeAction(handler){const b=action('',handler);b.append(glyph('close',{size:12}));b.setAttribute('aria-label','Remove');return b;}
function renderInspector() {
  if(view==='canvas'){CanvasWorkspace.renderInspector();return;}
  if(selection.ids.size>1){renderSelectionInspector();return;}
  const box=$('#inspector');
  if(colorFocus){box.replaceChildren(el('div','inspector-label','COLOUR DETAILS'));renderColorDetails(box);return;}
  box.replaceChildren(el('div','inspector-label','FILE DETAILS'));const a=current();
  if(!a){const emptyIcon=el('div','inspector-empty-icon');emptyIcon.append(glyph('docText',{size:40}));box.append(emptyIcon,el('h3','','File details'),el('p','hint','Select a file to edit its name, notes, tags and collections. Press Space to preview it.'));return;}
  const k=kind(a);
  const similarButton=WorkbenchUI.canFindSimilar(a)?action('',()=>safe(()=>WorkbenchUI.similar(a.id)),'find-similar'):null;
  if(similarButton){similarButton.append(glyph('findSimilar'),document.createTextNode('Find similar'));}
  // The name is the only thing this row holds now: the star and the file
  // actions moved back to the card and the context menu.
  const nameRow=el('div','inspector-name-row');
  const nameInput=field(a.name,'File name',name=>update({name}));
  nameInput.className='inspector-name-input';
  nameRow.append(nameInput);
  if(a.smart?.caption)box.append(el('p','inspector-caption',a.smart.caption));
  box.append(inspectorPreview(a),...(similarButton?[similarButton]:[]),nameRow);
  // A file note is editable text that exists nowhere else, so it stays here.
  // A note is editable text that exists nowhere else. Always expose the field,
  // including on a fresh file, so the first note can be added from the UI.
  const notes=field(a.notes||'','Notes…',notes=>update({notes}),true);
  notes.className='inspector-notes';
  box.append(notes);
  if(k==='image'){box.append(SmartCards.paletteSection(a));}
  else if(k==='video'||k==='audio'){const mediaDetails=el('p','hint','Reading media information…');box.append(mediaDetails);api.mediaInfo(a.id,true).then(info=>{if(selected!==a.id||!mediaDetails.isConnected)return;mediaDetails.textContent=[info.duration?'Duration '+timecode(info.duration):'',info.width&&info.height?info.width+' × '+info.height:'',info.codec||'',info.artist||'',info.album||''].filter(Boolean).join(' · ')||'Media information unavailable';}).catch(()=>mediaDetails.textContent='Media information unavailable');}
  else if(k==='link'&&a.captureMetadata){const metadata=a.captureMetadata;const source=section('Website');const details=el('dl','properties');for(const [label,value]of [['Original URL',metadata.pageUrl],['Website title',metadata.pageTitle],['Domain',metadata.pageUrl?new URL(metadata.pageUrl).hostname:''],['Capture date',metadata.capturedAt?new Date(metadata.capturedAt).toLocaleString():'']])if(value)details.append(el('dt','',label),el('dd','',String(value)));source.append(details);box.append(source);}
  // Tags are typed, not chosen from a list: the field below takes one word or
  // several separated by commas and saves them on Enter or when it loses
  // focus. The words this file already carries sit above it as chips.
  const tags=el('section');
  const tagHead=el('div','inspector-section-head');
  tagHead.append(el('h3','','Tags'));
  let tagWords=[...a.tags];
  const tagChips=el('div','chips');
  function tagChip(word){
    const chip=el('span','chip',word);
    chip.append(removeAction(()=>{
      tagWords=tagWords.filter(one=>one!==word);
      chip.remove();
      tagChips.hidden=!tagWords.length;
      update({tags:tagWords},{repaint:false});
    }));
    return chip;
  }
  function addTags(text){
    const words=text.split(',').map(word=>word.trim()).filter(Boolean);
    const added=[...new Set(words)].filter(word=>!tagWords.includes(word));
    if(!added.length)return;
    tagWords=[...tagWords,...added];
    for(const word of added)tagChips.append(tagChip(word));
    tagChips.hidden=false;
    // Saving leaves the panel alone, so the field keeps the cursor and a
    // second word can be typed straight away.
    update({tags:tagWords},{repaint:false});
  }
  const tagInput=field('','Add tags, separated by commas',text=>{addTags(text);tagInput.value='';});
  tagInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addTags(tagInput.value);tagInput.value='';}};
  const tagMatches=entrySuggestions(tagInput,knownTags);
  const suggestions=TagSuggestions.mount(a,{add:word=>addTags(word)});
  tagHead.append(suggestions.button);
  for(const word of tagWords)tagChips.append(tagChip(word));
  tagChips.hidden=!tagWords.length;
  tags.append(tagHead,tagChips,tagInput,tagMatches,suggestions.results);
  box.append(tags);
  // A collection is typed too: a name the library knows joins it to the file,
  // a new name becomes a collection and is added in the same breath.
  const coll=section('Collections');
  let collNames=[...a.folders];
  const collChips=el('div','chips');
  function collChip(name){
    const chip=el('span','chip',name);
    chip.append(removeAction(()=>{
      collNames=collNames.filter(one=>one!==name);
      chip.remove();
      collChips.hidden=!collNames.length;
      update({folders:collNames},{repaint:false});
    }));
    return chip;
  }
  function addCollection(text){
    const name=text.trim();
    if(!name||collNames.includes(name))return;
    // A name the library does not know yet is created first, so the sidebar
    // lists it straight away.
    if(!folders.includes(name)){
      folders.push(name);folders.sort((one,two)=>one.localeCompare(two));
      safe(()=>api.addFolder(name));
    }
    collNames=[...collNames,name];
    collChips.append(collChip(name));
    collChips.hidden=false;
    update({folders:collNames},{repaint:false});
  }
  const collInput=field('','Add to collection, then Enter',text=>{addCollection(text);collInput.value='';});
  collInput.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();addCollection(collInput.value);collInput.value='';}};
  const collMatches=entrySuggestions(collInput,()=>folders);
  for(const name of collNames)collChips.append(collChip(name));
  collChips.hidden=!collNames.length;
  coll.append(collChips,collInput,collMatches);
  box.append(coll);
  // One compact information section for every file type. Eagle keeps these
  // facts visible without opening a second window; a contact sheet is no
  // place to guess a file's format or weight.
  const when=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleDateString():'—';};
  const props=section('Information'),dl=el('dl','properties');
  dl.append(el('dt','','Type'),el('dd','',(a.ext||'File').toUpperCase()),el('dt','','Size'),el('dd','',Number(a.size)>0?bytes(a.size):'—'),el('dt','','Imported'),el('dd','',when(a.imported)),el('dt','','Created'),el('dd','',when(a.created)));
  props.append(dl);box.append(props);
  if(k==='image'){
   const label=el('dt','','Dimensions'),value=el('dd','','Reading…');
   dl.append(label,value);
   api.imageSize(a.id).then(size=>{
    if(!value.isConnected)return;
    if(size?.width&&size?.height)value.textContent=size.width+' × '+size.height;
    else{label.remove();value.remove();}
   }).catch(()=>{label.remove();value.remove();});
  }
}
function renderColorDetails(box){
  const hex=colorFocus.hex;
  const matches=assets.filter(a=>!a.trash&&WorkbenchUI.colourMatch(a,hex));
  const size=matches.reduce((n,a)=>n+(Number(a.size)||0),0);
  const count=type=>type==='gif'?matches.filter(a=>a.ext==='gif').length:matches.filter(a=>kind(a)===type).length;
  const card=el('div','color-detail-card');
  card.append(el('div','color-detail-swatch'));
  card.lastChild.style.backgroundColor=hex;
  const label=el('div','color-detail-label');
  label.append(el('span','',hex.toUpperCase()));
  const copy=el('button','color-detail-copy','⧉');
  copy.type='button';
  copy.title='Copy '+hex;
  copy.setAttribute('aria-label','Copy '+hex);
  copy.onclick=()=>safe(async()=>{await api.copyColor(hex);notify(hex+' copied');});
  label.append(copy);
  card.append(label);
  box.append(card);

  const stats=el('div','color-detail-stats');
  const row=(name,value)=>{const line=el('div','color-stat');line.append(el('span','',name),el('span','',String(value)));stats.append(line);};
  row('ITEMS',matches.length);
  row('SIZE',bytes(size));
  const types=el('div','color-detail-types');
  for(const [name,value] of [['IMAGES',count('image')],['GIFS',count('gif')],['VIDEOS',count('video')],['LINKS',count('link')]]){
    const line=el('div','color-stat');line.append(el('span','',name),el('span','',String(value)));types.append(line);
  }
  // The Nearby colours section paints its own hairline. Adding a divider here
  // as well drew two rules a few pixels apart.
  box.append(stats,el('div','color-detail-divider'),types);

  const nearby=section('Nearby colours');
  const rgb=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
  const base=rgb(hex);
  const between=(a,b)=>{const x=rgb(a),y=rgb(b);return (x[0]-y[0])**2+(x[1]-y[1])**2+(x[2]-y[2])**2;};
  const distance=value=>between(value,hex);
  // Every indexed image contributes its palette; the closest colours win, and
  // near-duplicates are skipped so the strip shows a real variety rather than
  // ten shades of the same colour.
  const colors=new Map();
  for(const a of assets){
   if(a.trash)continue;
   for(const entry of a.smart?.palette||[])if(entry.hex&&entry.hex.toLowerCase()!==hex.toLowerCase())colors.set(entry.hex.toLowerCase(),entry.hex);
  }
  const chosen=[];
  for(const value of [...colors.values()].sort((a,b)=>distance(a)-distance(b))){
   if(chosen.every(one=>between(one,value)>900))chosen.push(value);
   if(chosen.length===10)break;
  }
  const swatches=el('div','color-palette');
  for(const value of chosen){
    const button=el('button','color-swatch');
    button.type='button';
    button.style.backgroundColor=value;
    button.title=value;
    button.setAttribute('aria-label','Show files with '+value);
    button.onclick=()=>safe(()=>WorkbenchUI.findColor(value));
    swatches.append(button);
  }
  if(!swatches.childElementCount)swatches.append(el('p','hint','No nearby colours are indexed yet.'));
  nearby.append(swatches);
  box.append(nearby);
}
function openPreview(scopeOverride=null){stopHover();if(!selected&&visible.length)select(visible[0].id);if(!current())return;const wall=view==='infinite'?window.InfiniteCanvas?.scope():null;if(view==='infinite')window.InfiniteCanvas?.rememberPreview(selected);previewScope=Array.isArray(scopeOverride)?scopeOverride:wall||(selection.ids.size>1?visible.filter(a=>selection.ids.has(a.id)):pagedCatalog?null:visible);$('#preview').hidden=false;document.body.classList.add('preview-open');$('main').inert=true;renderPreview();const card=mounted.get(selected);Motion.revealFromTrigger($('#preview .preview-body'),card?.isConnected?card:revealTrigger());$('#preview').focus({preventScroll:true});}
function closePreview(){previewScope=null;previewPlayer?.dispose();previewPlayer=null;$('#preview').hidden=true;const infinite=view==='infinite';if(infinite)window.InfiniteCanvas?.restorePreview();document.body.classList.remove('preview-open');$('#preview-content').replaceChildren();$('main').inert=false;scheduleInspector();SidebarUI.syncAccessibility();if(view==='canvas'){const item=CanvasWorkspace.doc&&[...CanvasWorkspace.doc.items.values()].find(item=>item.assetId===selected);if(item&&assetById.get(selected)?.trash===0)CanvasWorkspace.select([item.id]);selection.clear();selected=null;CanvasWorkspace.viewport.focus({preventScroll:true});}else if(infinite){window.InfiniteCanvas?.syncSelection();window.InfiniteCanvas?.focusSelected();}else{revealGallerySelection();$('#gallery').focus({preventScroll:true});}}
function mountRasterPreview(a,unsupported){
 const element=el('div','raster-preview');
 const image=el('img','image-preview');
 let zoom=1,detail=0,disposed=false,request=0,timer,offset={x:0,y:0},drag=null;
 image.alt=a.name;image.draggable=false;
 image.style.visibility='hidden';
 image.onload=()=>{image.style.visibility='';fit();};
 // The picture, not the stage, wears the rounded corners: size the element to
 // the fitted photograph so its radius sits on the photo's own edges instead
 // of in the empty letterbox around it.
 function fit(){
  if(!image.naturalWidth||!image.naturalHeight)return;
  const width=element.clientWidth,height=element.clientHeight;
  if(!width||!height)return;
  const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight);
  image.style.width=Math.max(1,Math.round(image.naturalWidth*scale))+'px';
  image.style.height=Math.max(1,Math.round(image.naturalHeight*scale))+'px';
 }
 const cached=mounted.get(a.id)?.querySelector('.card-surface img');
 image.src=cached?.naturalWidth?cached.currentSrc:'asset://thumb/'+a.id+'?v=2&cached';
 element.append(image);
 // Scrubbing a picture is only useful if it can be reached: the controls
 // zoom in and out, and the picture can then be pulled around by hand.
 const controls=el('div','raster-preview-controls');
 const zoomOut=el('button','raster-preview-button','\u2212'),zoomLabel=el('span','raster-preview-zoom','100%'),zoomIn=el('button','raster-preview-button','+');
 zoomOut.setAttribute('aria-label','Zoom out');zoomIn.setAttribute('aria-label','Zoom in');
 zoomOut.onclick=event=>{event.stopPropagation();setZoom(zoom/1.4);};
 zoomIn.onclick=event=>{event.stopPropagation();setZoom(zoom*1.4);};
 controls.append(zoomOut,zoomLabel,zoomIn);
 element.append(controls);
 function paint(){image.style.transform=`translate(${offset.x}px,${offset.y}px) scale(${zoom})`;zoomLabel.textContent=Math.round(zoom*100)+'%';zoomOut.disabled=zoom<=1.01;zoomIn.disabled=zoom>=7.99;}
 function load(){
  if(disposed)return;
  const rect=element.getBoundingClientRect(),wanted=Math.max(rect.width,rect.height)*Math.min(devicePixelRatio||1,2)*zoom;
  const size=[960,1800,3200,4096].find(size=>size>=wanted)||4096;
  if(size<=detail)return;
  detail=size;
  const src='asset://image-detail/'+a.id+'?size='+size,token=++request;
  const next=new Image();
  next.onload=()=>{
   if(disposed||token!==request)return;
   image.onerror=null;
   image.src=next.src;
  };
  next.onerror=()=>{
   if(disposed||token!==request||image.naturalWidth)return;
   image.onerror=()=>{if(!disposed)unsupported();};
   image.src='asset://preview/'+a.id;
  };
  next.src=src;
 }
 function setZoom(value,point){
  const previous=zoom;
  zoom=Math.max(1,Math.min(8,value));
  if(zoom===1)offset={x:0,y:0};
  else if(point){
   const rect=element.getBoundingClientRect(),ratio=zoom/previous;
   const x=point.clientX-rect.left-rect.width/2,y=point.clientY-rect.top-rect.height/2;
   offset={x:x+(offset.x-x)*ratio,y:y+(offset.y-y)*ratio};
  }
  paint();clearTimeout(timer);timer=setTimeout(load,90);
 }
 element.addEventListener('wheel',event=>{
  if(!event.ctrlKey&&!event.metaKey&&zoom===1)return;
  event.preventDefault();
  if(event.ctrlKey||event.metaKey)setZoom(zoom*Math.exp(-event.deltaY*.008),event);
  else{offset.x-=event.deltaX;offset.y-=event.deltaY;paint();}
 },{passive:false});
 element.addEventListener('pointerdown',event=>{
  if(zoom===1||event.button!==0)return;
  drag={id:event.pointerId,x:event.clientX-offset.x,y:event.clientY-offset.y};
  element.setPointerCapture(event.pointerId);
 });
 element.addEventListener('pointermove',event=>{
  if(drag?.id!==event.pointerId)return;
  offset={x:event.clientX-drag.x,y:event.clientY-drag.y};paint();
 });
 element.addEventListener('lostpointercapture',()=>drag=null);
 const observer=new ResizeObserver(()=>{fit();load();});observer.observe(element);
 queueMicrotask(()=>{fit();load();});
 api.previewZoomActive(true);paint();
 return {element,zoomBy:factor=>setZoom(zoom*factor),resetZoom:()=>setZoom(1),
  dispose(){disposed=true;api.previewZoomActive(false);clearTimeout(timer);observer.disconnect();image.removeAttribute('src');element.remove();}};
}
function renderPreview(){previewPlayer?.dispose();previewPlayer=null;const a=current();if(!a)return;const scope=previewScope||visible;const i=scope.findIndex(x=>x.id===a.id),total=pagedCatalog&&!previewScope?catalogTotal:scope.length;$('#preview').setAttribute('aria-label','Preview: '+a.name);$('#preview-index').textContent=(i+1).toLocaleString()+' / '+total.toLocaleString();$('#previous').disabled=i<=0;$('#next').disabled=i>=total-1;
  // Disabling the focused arrow drops focus to <body> while the modal is open.
  // Keep it inside the dialog by handing focus to its opposite control.
  const arrow=document.activeElement;
  if(arrow===$('#previous')&&$('#previous').disabled)($('#next').disabled?$('#close-preview'):$('#next')).focus({preventScroll:true});
  else if(arrow===$('#next')&&$('#next').disabled)($('#previous').disabled?$('#close-preview'):$('#previous')).focus({preventScroll:true});
  const content=$('#preview-content');content.replaceChildren();const unsupported=()=>{const div=el('div','unsupported');div.append(placeholder(a),el('p','','Open this file with macOS Quick Look.'),action('Quick Look',()=>api.quickLook(a.id)));content.replaceChildren(div);};
if(SmartCards.isNote(a)){previewPlayer=SmartCards.mountNote(a);content.append(previewPlayer.element);}else if(CanvasFormats.supports(a.ext)){previewPlayer=CanvasFormats.mount(a);content.append(previewPlayer.element);}else if(['video','audio'].includes(kind(a))){previewPlayer=createPlayer(a);content.append(previewPlayer.element);}else if(kind(a)==='image'&&/^(png|jpe?g|jfif|jpe|insp|avif|bmp|heic|heif|tiff?)$/.test(a.ext)){previewPlayer=mountRasterPreview(a,unsupported);content.append(previewPlayer.element);}else if(kind(a)==='image'){const img=el('img','image-preview');img.alt=a.name;const nativeOnly=['psd','psb','eps','jpegxl','jxl','insp','heic','heif','tiff','tif'].includes(a.ext);img.src='asset://'+(nativeOnly?'preview':'file')+'/'+a.id;img.onerror=()=>{if(img.parentElement!==content)return;if(img.dataset.nativeAttempt){unsupported();return;}img.dataset.nativeAttempt='1';img.src='asset://preview/'+a.id;};if(nativeOnly)img.dataset.nativeAttempt='1';content.append(img);}else if(kind(a)==='pdf'){const frame=el('iframe');frame.title=a.name;frame.src='asset://file/'+a.id;content.append(frame);}else if(kind(a)==='link'){previewPlayer=mountBookmark(a);content.append(previewPlayer.element);}else if(['md','txt','json','csv','css','js','ts','xml','log'].includes(a.ext)&&a.size<=2*1024*1024){const text=el('pre','text-preview','Loading…');content.append(text);api.readText(a.id).then(value=>{if(text.isConnected)text.textContent=value;}).catch(e=>{text.textContent=e.message;});}else {const img=el('img','image-preview');img.alt=a.name;img.src='asset://preview/'+a.id;img.onerror=()=>{if(img.parentElement!==content)return;unsupported();const message=content.querySelector('.unsupported p');if(message)message.textContent=['swf','epub'].includes(a.ext)?'This format needs a compatible preview plugin. Importing, organizing and exporting remain available.':'No compatible preview decoder is available for this file on this Mac.';};content.append(img);}}
// Palette hits can come from the paged catalog and may not be in memory. Put
// the returned asset in the map before selecting it, then open it so a click
// in the palette actually shows the file instead of only highlighting a card.
async function openPaletteAsset(asset){
 if(!asset)return;
 const currentAsset=assetById.get(asset.id);
 const merged=currentAsset?Object.assign(currentAsset,asset):asset;
 if(!currentAsset)assetById.set(asset.id,merged);
 if(!merged.searchText)merged.searchText=SmartCards.enrichSearch(merged);
 // Clear any previous preview and selection so the clicked file is the one
 // shown, not the last one viewed from the palette.
 if(!$('#preview').hidden)closePreview();
 selection.clear();selected=null;
 if(view!=='all')setView('all');
 select(asset.id);
 revealGallerySelection();
 openPreview();
}
function revealGallerySelection(){
 if(!selected)return;
 if(view==='canvas'){CanvasWorkspace.revealPreviewAsset(selected);return;}
 if(!layout||layout.items!==visible)renderWindow();
 const p=layout?.byId.get(selected);if(!p)return;
 const gallery=$('#gallery'),bottom=p.y+p.height;
 if(p.y<gallery.scrollTop)gallery.scrollTop=p.y;
 else if(bottom>gallery.scrollTop+gallery.clientHeight)gallery.scrollTop=Math.max(p.y,bottom-gallery.clientHeight);
 scheduleGallery();
}
// Show a file in the library from somewhere else in the app (a canvas, a
// bookmark). The catalogue is paged, so the file is often not loaded yet and
// select() would silently do nothing. Load the catalogue first, then select.
async function revealAssetInLibrary(id){
 if(!id)return;
 // Switching the view starts a page load. Selecting before it finishes is
 // pointless: the load replaces the catalogue and clears the selection. Wait
 // for the catalogue to go quiet, then load the whole library and select.
 const quiet=async()=>{
  for(let i=0;i<200;i++){
   if(!catalogLoading&&!catalogHydration)return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 };
 await quiet();
 if(!assets.some(a=>a.id===id))await refresh();
 await quiet();
 if(!assets.some(a=>a.id===id)&&pagedCatalog)await refreshCurrent();
 await quiet();
 // render() returns early when the page key is stale, so selection.index can
 // still be missing the file even though it is loaded.
 if(!selection.index.has(id)&&assets.some(a=>a.id===id))selection.sync(assets.map(a=>a.id));
 select(id);
 revealGallerySelection();
}
window.revealAssetInLibrary=revealAssetInLibrary;
function move(delta,extend=false,direction=''){
 const isPreview=!$('#preview').hidden,pool=isPreview?(previewScope||visible):visible;if(!pool.length)return;
 const scope=isPreview?previewScope:null;
 const i=scope?scope.findIndex(a=>a.id===selected):(selection.index.get(selected)??-1),vertical=['ArrowUp','ArrowDown'].includes(direction);
 let next=Math.max(0,Math.min(pool.length-1,i<0?0:i+delta));
 if(vertical&&i>=0){
  if(view==='canvas')next=pool.findIndex(a=>a.id===CanvasWorkspace.verticalPreviewNeighbor(selected,pool,delta));
  else{
   if(!layout||layout.items!==visible)renderWindow();
   const candidate=layout&&AssetLayout.verticalNeighbor(layout,selected,delta);
   next=scope?scope.findIndex(a=>a.id===visible[candidate]?.id):(candidate??i);
  }
  if(next<0)next=i;
 }
 if(pagedCatalog&&delta>0&&next===i&&pool.length<catalogTotal&&(!isPreview||!previewScope)){
  const focus=selected;
  safe(async()=>{const previous=pool.length;await (catalogLoading?.promise||loadLibraryPage({append:true}));if(selected===focus&&visible.length>previous)move(delta,extend,direction);});
  return;
 }
 if(next===i)return;
 if(isPreview&&previewScope){selected=pool[next].id;selection.focus=selected;paintSelection();scheduleInspector();}
 else select(pool[next].id,{shiftKey:extend});
 revealGallerySelection();
 if(isPreview)renderPreview();
}
async function importing(operation){const canvasId=view==='canvas'?CanvasWorkspace.doc?.board.id:null;busy++;try{const r=await operation();if(r){if(r.ids?.length)await refreshCaptured(r.ids);else if(!Array.isArray(r.ids))await refreshCurrent();if(canvasId&&r.ids?.length)await CanvasWorkspace.imported(canvasId,r.ids);notify(`${r.imported} imported · ${r.duplicates} ${r.duplicates===1?'duplicate':'duplicates'}${r.skipped?' · '+r.skipped+' skipped':''}${r.errors.length?'\n'+r.errors.slice(0,3).join('\n'):''}`);}}finally{busy--;}}
function importDialog(directory=false){return safe(()=>importing(()=>api.importDialog(collection,directory)));}
$('#import').onclick=()=>importDialog();$('#import-folder').onclick=()=>importDialog(true);api.onImport(()=>importDialog());api.onProgress(p=>{if(p)notify('Importing '+p.count+': '+p.name);});
$('.search').addEventListener('click',event=>{if(!event.target.closest('button,input'))$('#search').focus();});
$('#search').oninput=()=>{ const gallery=$('#gallery'); const pos=gallery.scrollTop; pendingGalleryPosition={key:viewIdentity(),top:pos,count:visible.length,anchor:AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight)};$('#gallery').scrollTop=0;SmartSearch.schedule();render();};$('#type').onchange=()=>{ syncViewMenu();pendingGalleryPosition=null;$('#gallery').scrollTop=0;pagedCatalog?safe(()=>refreshCurrent()):render();};$('#sort').onchange=()=>{localStorage.setItem('sort-order',$('#sort').value);syncViewMenu();pendingGalleryPosition=null;$('#gallery').scrollTop=0;pagedCatalog?safe(()=>refreshCurrent()):render();};
$('#quick-filters').addEventListener('click',event=>{const chip=event.target.closest('[data-quick-type]');if(!chip)return;$('#type').value=chip.dataset.quickType;syncViewMenu();$('#type').dispatchEvent(new Event('change'));});
function syncMenu(menu,attr,value){if(!menu)return;for(const option of menu.querySelectorAll('['+attr+']'))option.setAttribute('aria-checked',String(option.getAttribute(attr)===String(value)));}
function syncViewMenu(){const value=$('#type').value;for(const chip of document.querySelectorAll('#quick-filters [data-quick-type]'))chip.setAttribute('aria-pressed',String(chip.dataset.quickType===value));if(typeof viewMenu==='undefined'||!viewMenu)return;syncMenu(viewMenu,'data-view-type',value);syncMenu(viewMenu,'data-view-sort',$('#sort').value);}
function positionMenu(menu,button){if(!menu||!button||!menu.matches(':popover-open'))return;const rect=button.getBoundingClientRect();menu.style.top=(rect.bottom+8)+'px';menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,rect.right-menu.offsetWidth))+'px';}
for(const menu of document.querySelectorAll('[popover][role="menu"]')){
 const button=document.querySelector('[popovertarget="'+menu.id+'"]');
 const items=()=>[...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')].filter(el=>!el.hidden&&!el.disabled);
 menu.addEventListener('toggle',event=>{
  if(button)button.setAttribute('aria-expanded',String(event.newState==='open'));
  if(event.newState==='open'){positionMenu(menu,button);const list=items();list.forEach((el,i)=>el.tabIndex=i===0?0:-1);list[0]?.focus();}
 });
 if(button)addEventListener('resize',()=>positionMenu(menu,button));
 menu.addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  const list=items();if(!list.length)return;
  event.preventDefault();
  const index=list.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowDown'?1:-1)+list.length)%list.length;
  list.forEach((el,i)=>el.tabIndex=i===next?0:-1);list[next].focus();
 });
}
const viewMenu=$('#view-menu'),importMenu=$('#import-menu');
if(viewMenu){
 syncViewMenu();
 viewMenu.addEventListener('click',event=>{
  const typeOption=event.target.closest('[data-view-type]');
  const sortOption=event.target.closest('[data-view-sort]');
  if(typeOption){$('#type').value=typeOption.dataset.viewType;syncViewMenu();viewMenu.hidePopover();pagedCatalog?safe(()=>refreshCurrent()):render();return;}
  if(sortOption){$('#sort').value=sortOption.dataset.viewSort;localStorage.setItem('sort-order',sortOption.dataset.viewSort);syncMenu(viewMenu,'data-view-sort',sortOption.dataset.viewSort);viewMenu.hidePopover();pendingGalleryPosition=null;$('#gallery').scrollTop=0;render();}
 });
}
if(importMenu){importMenu.addEventListener('click',event=>{if(event.target.closest('button'))importMenu.hidePopover();});}
$('#gallery').addEventListener('scroll',()=>{stopHover();scheduleGallery();},{passive:true});
let lastGalleryWidth=0;
new ResizeObserver(entries=>{
  // Setting the layer height can change the scrollbar, which re-fires this
  // observer with the same width. Rebuilding the masonry for a subpixel
  // change re-places every visible card and makes the field shake while a
  // window corner is being dragged.
  const width=entries[0]?.contentRect.width??$('#gallery').clientWidth;
  if(Math.abs(width-lastGalleryWidth)<1)return;
  lastGalleryWidth=width;
  scheduleGallery();
}).observe($('#gallery'));
// Thumbnail zoom springs from the value actually on screen, so repeated
// presses retarget mid-flight instead of waiting for a fixed animation.
let zoomAnimation=null,zoomDisplay=230,zoomTarget=230,zoomVelocity=0,zoomLastAt=0;
const savedSize=Number(localStorage.getItem('tile-size'));if(savedSize>=140&&savedSize<=360)$('#zoom').value=savedSize;
zoomDisplay=Number($('#zoom').value)||230;zoomTarget=zoomDisplay;
function paintZoom(){stopHover();renderWindow();}
function setZoomSize(target){
 const slider=$('#zoom');
 target=Math.max(140,Math.min(360,Math.round(target)));
 const from=zoomDisplay,now=performance.now();
 const step=target-zoomTarget;zoomTarget=target;
 zoomVelocity=(step||target-from)/Math.max(1,now-zoomLastAt);zoomLastAt=now;
 if(zoomAnimation)zoomAnimation.cancel();
 zoomAnimation=Motion.animateNumber({
  from,to:target,velocity:zoomVelocity,
  render:value=>{zoomDisplay=Math.max(140,Math.min(360,value));slider.value=String(zoomDisplay);paintZoom();},
  onFinish:()=>{zoomAnimation=null;zoomVelocity=0;localStorage.setItem('tile-size',String(target));}
 });
}
$('#zoom').oninput=()=>setZoomSize(Number($('#zoom').value)||230);
$('#show-extension').onclick=()=>safe(()=>api.showExtension());
$('#show-library').onclick=()=>safe(()=>api.showLibrary());
// The details panel needs room. Under 880px it would take a third of the
// window and leave the gallery one narrow column, so it steps aside and
// returns as a sheet over the gallery instead of a column beside it.
const narrowInspectorWidth=880;
let narrowPanelOpen=false;
function closeNarrowInspector(){
 if(!narrowPanelOpen)return;
 narrowPanelOpen=false;
 document.body.classList.remove('narrow-panel-open');
 $('#narrow-inspector-close')?.remove();
}
function ensureNarrowClose(){
 if(!narrowPanelOpen||!document.body.classList.contains('narrow-inspector')||$('#narrow-inspector-close'))return;
 const close=el('button','narrow-inspector-close');close.id='narrow-inspector-close';
 close.setAttribute('aria-label','Close file details');close.title='Close file details';
 close.append(glyph('close'));close.onclick=closeNarrowInspector;document.body.append(close);
}
function applyNarrowLayout(){
 const narrow=innerWidth<=narrowInspectorWidth;
 document.body.classList.toggle('narrow-inspector',narrow);
 if(!narrow)closeNarrowInspector();
 document.body.classList.toggle('narrow-panel-open',narrow&&narrowPanelOpen);
 ensureNarrowClose();
}
applyNarrowLayout();
addEventListener('resize',applyNarrowLayout);
// A live resize is a burst of resize events. While the native window is being
// dragged by an edge, Chromium is often a frame behind the window; animating
// the rails and blurring large layers at the same time turns that lag into
// visible jitter and stale tiles. Freeze the chrome until the drag settles,
// then render once more so the settled frame is painted top to bottom.
let resizeSettle=0;
function endResize(){
  clearTimeout(resizeSettle);
  document.body.classList.remove('resizing');
  renderWindow();
}
addEventListener('resize',event=>{
  // Panel drags dispatch a synthetic resize to refresh the layout; that is
  // not a window drag and should not freeze the chrome or force a repaint.
  if(event.isTrusted===false)return;
  document.body.classList.add('resizing');
  clearTimeout(resizeSettle);
  resizeSettle=setTimeout(endResize,140);
},{passive:true});
$('#toggle-inspector').onclick=()=>{
 if(document.body.classList.contains('narrow-inspector')){
  narrowPanelOpen=!narrowPanelOpen;
  document.body.classList.toggle('narrow-panel-open',narrowPanelOpen);
  ensureNarrowClose();
  return;
 }
 document.body.classList.toggle('hide-inspector');
 localStorage.setItem('hide-inspector',String(document.body.classList.contains('hide-inspector')));
};
if(localStorage.getItem('hide-inspector')==='true')document.body.classList.add('hide-inspector');
$('#add-folder').onclick=()=>SidebarUI.inlineCreate('collections');$('#folder-dialog').addEventListener('close',()=>{if($('#folder-dialog').returnValue==='create')safe(async()=>{const name=$('#folder-name').value.trim();await api.addFolder(name);await refreshCurrent();const f=CanvasWorkspace.folderRecords.find(f=>f.name===name);if(f)await WorkbenchUI.created('folder:'+f.id,'collection');});});
$('#previous').replaceChildren(glyph('chevronLeft'));$('#next').replaceChildren(glyph('chevronRight'));$('#close-preview').onclick=closePreview;$('#previous').onclick=()=>move(-1);$('#next').onclick=()=>move(1);
// Clicking the empty surface of the viewer dismisses it, like the Cosmos
// lightbox. Clicks on the media or its controls keep their own behaviour.
$('#preview').addEventListener('click',event=>{
 const target=event.target;
 if(target===$('#preview')||target.classList.contains('preview-body')||target.id==='preview-content'||target.classList.contains('raster-preview'))closePreview();
});
let trashingPreview=false;
async function trashSelection(){
 const preview=$('#preview'),inViewer=!preview.hidden;
 if(inViewer&&trashingPreview)return;
 const ids=(inViewer?[selected]:selection.values()).filter(id=>id&&assetById.has(id)&&!assetById.get(id).trash);
 if(!ids.length){if(selection.ids.size)notify('These files are already in Trash.');return;}
 stopHover();
 if(!inViewer){
  await api.bulkUpdate(ids,{type:'trash',trash:true});await refreshCurrent();
 }else{
  trashingPreview=true;
  const id=ids[0],scope=previewScope,pool=scope||visible,index=pool.findIndex(a=>a.id===id);
  const forward=pool.slice(index+1).map(a=>a.id),previous=pool.slice(0,index).reverse().map(a=>a.id);
  try{
   await api.bulkUpdate(ids,{type:'trash',trash:true});
   await refreshCurrent();
   if(!preview.hidden&&previewScope===scope){
    if(scope)previewScope=scope.filter(a=>a.id!==id&&assetById.has(a.id));
    const candidates=previewScope||visible;
    const available=new Set(candidates.map(a=>a.id));
    const next=forward.find(id=>available.has(id))||(!scope&&candidates[index]?.id)||previous.find(id=>available.has(id))||candidates[0]?.id;
    if(next){
     if(view==='canvas')selection.sync(previewScope.map(a=>a.id));
     select(next);revealGallerySelection();renderPreview();
    }else closePreview();
   }
  }finally{trashingPreview=false;}
 }
 notify(ids.length+' '+(ids.length===1?'file':'files')+' moved to Trash.');
}
let infiniteToggleAt=0;
function toggleInfiniteCanvas(){
 // The native menu accelerator and the renderer shortcut can both observe the
 // same key press; ignore a second toggle within a moment.
 const now=performance.now();
 if(now-infiniteToggleAt<120)return;
 infiniteToggleAt=now;
 if(!$('#preview').hidden)closePreview();
 window.InfiniteCanvas?.toggle();
}
window.toggleInfiniteCanvas=toggleInfiniteCanvas;
document.addEventListener('keydown',e=>{
 const command=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
 const typing=e.target.matches?.('input:not([type="range"]),textarea,select,[contenteditable="true"]');
 const editing=e.target.matches?.('input,textarea,select,[contenteditable="true"],canvas[role="slider"]');
 // ⌥O toggles the infinite canvas. On macOS Option+O produces "ø", so match
 // the physical KeyO as well as the character. This is handled before the
 // dialog guard so it still works with Settings open.
 if(e.altKey&&!command&&!e.shiftKey&&!e.repeat&&(e.code==='KeyO'||key==='o'||key==='ø')){
  e.preventDefault();e.stopPropagation();
  document.querySelector('dialog[open]')?.close();
  toggleInfiniteCanvas();
  return;
 }
 // A modal dialog owns the keyboard while it is up. Open popovers keep their
 // own key handlers and must not swallow global shortcuts.
 if(document.querySelector('dialog[open]'))return;
 // ⌘K is the one command entry point, including from inside the canvas where
// CanvasWorkspace otherwise claims the same chord for its tray search.
 if(command&&key==='k'&&!e.altKey){e.preventDefault();if(!$('#preview').hidden)closePreview();window.CommandPalette?.open('commands');return;}
 if(e.code==='Space'&&e.target.closest?.('button,summary,input[type="checkbox"],input[type="radio"]'))return;
 const preview = $('#preview');
 if (!preview.hidden && e.key === 'Tab') {
  const controls = [...preview.querySelectorAll('button, input, select, textarea, a[href], iframe, [tabindex]')]
   .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.checkVisibility({visibilityProperty:true}));
  const current = document.activeElement;
  const first = controls[0], last = controls.at(-1);
  if (!controls.includes(current) || current === (e.shiftKey ? first : last)) {
   e.preventDefault();
   (e.shiftKey ? last : first)?.focus();
  }
  return;
 }
 if (!preview.hidden && e.key === 'Escape') {
  e.preventDefault();
  closePreview();
  return;
 }
 if(view==='infinite'&&e.key==='Escape'){e.preventDefault();InfiniteCanvas.exit();return;}
 if(view==='infinite'&&$('#preview').hidden&&['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){
  e.preventDefault();
  const id=window.InfiniteCanvas?.moveSelection(e.key);
  if(id){select(id);window.InfiniteCanvas?.focusSelected(true);}
  return;
 }

 if(!$('#preview').hidden&&command&&previewPlayer&&['+','=','-','0'].includes(key)){
  e.preventDefault();
  if(key==='0'){if(previewPlayer.resetZoom)previewPlayer.resetZoom();}else if(previewPlayer.zoomBy)previewPlayer.zoomBy(key==='-'?1/1.4:1.4);
  else notify('Zoom not available for this preview type');
  return;
 }
 if(e.key!=='Escape'&&e.target.closest?.('.canvas-selection-tools'))return;
 if(view==='canvas'&&$('#preview').hidden&&!typing&&['Backspace','Delete'].includes(e.key)){e.preventDefault();if(!e.repeat)CanvasWorkspace.removeSelected();return;}
 if(view==='canvas'&&CanvasWorkspace.keydown(e))return;
 // The thumbnail slider is gone, so the library zooms with the same keys the
 // canvas uses: Command + / - to resize, Command + 0 to reset.
 if(command&&!e.altKey&&!typing&&$('#preview').hidden&&['+','=','-','_','0'].includes(key)){
  if(view==='infinite'){
   e.preventDefault();
   if(key==='0')window.InfiniteCanvas?.zoomBy(1,true);
   else window.InfiniteCanvas?.zoomBy(key==='-'||key==='_'?1/1.25:1.25);
   return;
  }
  if(key==='0')setZoomSize(230);
  else setZoomSize(zoomTarget+(key==='-'||key==='_'?-30:30));
  e.preventDefault();return;
 }
 // ⌘B toggles the sidebar. ⌘S used to do the same, which meant the one chord
 // every Mac user presses to save silently hid the sidebar instead.
 if(command&&!e.shiftKey&&!e.altKey&&key==='b'&&!editing){e.preventDefault();if(!e.repeat)$('#toggle-sidebar').click();return;}
 if(command&&!e.shiftKey&&!e.altKey&&key===','){e.preventDefault();if(!$('#preview').hidden)closePreview();$('#show-settings').click();return;}
 if(command&&key==='f'){e.preventDefault();if(!$('#preview').hidden)closePreview();if(view==='canvas'){CanvasWorkspace.toggleTray(true);$('#canvas-tray-search').focus();}else $('#search').focus();return;}
 if(command&&!e.shiftKey&&!e.altKey&&['Backspace','Delete'].includes(e.key)&&!typing){e.preventDefault();if(!e.repeat)safe(trashSelection);return;}
 if(e.code==='Space'&&e.target.matches?.('input[type="range"]'))return;
 if(e.code==='Space'&&e.repeat&&!typing){e.preventDefault();return;}
 if(!$('#preview').hidden&&e.code==='Space'){e.preventDefault();closePreview();return;}
 if(e.code==='Space'&&$('#preview').hidden&&!typing){e.preventDefault();if(hoverPlayer?.id)select(hoverPlayer.id);openPreview();return;}
 if(editing)return;
 if(command&&key==='a'&&$('#preview').hidden){
  e.preventDefault();
  safe(async()=>{
   if(pagedCatalog&&assets.length<catalogTotal)await hydrateCatalog();
   // Hydration fills `assets` with the whole library but only re-syncs
   // selection.order for the infinite wall. Outside the wall, re-sync from
   // the full set matching the current view/filter instead of the loaded page.
   if(pagedCatalog&&!['infinite','canvas'].includes(view))selection.sync(filteredAssets(assets).map(a=>a.id));
   selection.all();selected=selection.focus;stopHover();paintSelection();scheduleInspector();
  });
  return;
 }
 if(e.key==='Escape'&&narrowPanelOpen){e.preventDefault();closeNarrowInspector();return;}
 if(e.key==='Escape'&&$('#preview').hidden){selection.clear();selected=null;paintSelection();renderInspector();return;}
 if(command&&key==='i'){e.preventDefault();$('#toggle-inspector').click();return;}
 if(command&&key==='c'&&selected){e.preventDefault();const ids=$('#preview').hidden?selection.values():[selected];safe(async()=>{await api.copyFiles(ids);notify(ids.length+' files copied.');});return;}
 if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();move(['ArrowRight','ArrowDown'].includes(e.key)?1:-1,e.shiftKey,e.key);}

});

document.addEventListener('paste',e=>{if(document.querySelector('dialog[open]')||e.target.matches('input,textarea,[contenteditable="true"]'))return;e.preventDefault();if(view==='canvas'){if(!$('#preview').hidden)closePreview();safe(()=>CanvasWorkspace.paste());}else safe(()=>importing(()=>api.paste(collection)));});
let dragDepth=0;document.addEventListener('dragenter',e=>{e.preventDefault();dragDepth++;document.body.classList.add('dragging');});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(dragDepth>0&&--dragDepth===0)document.body.classList.remove('dragging');});document.addEventListener('drop',e=>{e.preventDefault();if(document.querySelector('dialog[open]')){dragDepth=0;document.body.classList.remove('dragging');return;}dragDepth=0;document.body.classList.remove('dragging');const paths=[...e.dataTransfer.files].map(f=>api.filePath(f)).filter(Boolean);if(paths.length)safe(()=>importing(()=>api.importPaths(paths,collection)));else{const url=(e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain')).split('\n').find(line=>/^https?:\/\//i.test(line.trim()));if(url)safe(()=>importing(()=>api.importURL(url.trim(),collection)));}});
const brandIcon=el('img');brandIcon.src='assets/app-icon.png';brandIcon.alt='';$('.brand-icon').replaceChildren(brandIcon);$('#toggle-inspector').replaceChildren(glyph('sidebar'));$('#toggle-sidebar').replaceChildren(glyph('sidebar'));$('#show-sidebar').replaceChildren(glyph('sidebar'));$('#view-menu-button').append(glyph('viewOptions'));$('#import-menu-button').append(glyph('plus'));window.addEventListener('blur',stopHover);let captureRefreshTimer,needsFullRefresh=false;
const pendingCaptures=new Set();
library.onFloatingRestore(state=>safe(async()=>{
 if(!document.querySelector('#preview').hidden)closePreview();
 const asset=assetById.get(state.id)||(await api.captureAssets([state.id]))[0];
 if(asset){
  if(!assetById.has(asset.id))assetById.set(asset.id,asset);
  selection.clear();selected=null;select(asset.id);openPreview();
  const player=previewPlayer;
  if(player?.media){
   player.media.currentTime=state.time||0;
   player.media.playbackRate=state.rate||1;
   player.media.muted=!!state.muted;
   player.media.volume=state.volume??1;
   player.media.loop=!!state.loop;
   if(!state.paused)player.media.play().catch(()=>{});
  }
 }
}));
api.onLibraryChanged(ids=>{
 if(Array.isArray(ids))for(const id of ids)pendingCaptures.add(id);
 else needsFullRefresh=true;
 clearTimeout(captureRefreshTimer);
 captureRefreshTimer=setTimeout(()=>{
   const changed=[...pendingCaptures],full=needsFullRefresh||changed.length>500||!appliedRefreshVersion||appliedRefreshVersion!==refreshVersion;
   pendingCaptures.clear();needsFullRefresh=false;
   safe(full?refresh:()=>refreshCaptured(changed));
 },100);
});api.onCaptureStatus(job=>{if(job.state==='running')return;notify(job.errors.length?'Capture finished with '+job.errors.length+' issue'+(job.errors.length===1?'':'s'):'Saved '+job.imported+' browser captures');});initContextUI();initReliabilityUI();initViewPreferences();syncViewMenu();initBookmarks();CanvasWorkspace.init();SmartSearch.init();WorkbenchUI.init();SidebarUI.init();safe(loadLibraryPage);
// A capture that arrived while this view was loading, or while the window was
// in the background, is picked up here so the library is never out of date.
let lastCaptureSeen=0;
async function syncCaptures(){
 try{
  const result=await api.captureSync(lastCaptureSeen);
  if(!result?.pending)return;
  lastCaptureSeen=result.at||Date.now();
  await refreshCurrent();
 }catch{}
}
window.addEventListener('focus',()=>{safe(syncCaptures);});
// The menu owns Settings, Help and Check for Updates so those commands exist
// where a Mac user looks for them, with the accelerators macOS expects.
api.onMenuSettings?.(()=>{safe(()=>{if(!$('#preview').hidden)closePreview();$('#show-settings').click();});});
api.onShowShortcuts?.(()=>{safe(()=>WorkbenchUI.shortcuts());});
api.onCheckUpdates?.(()=>{safe(()=>{$('#show-settings').click();SettingsUI.open('about');});});
// Native apps draw their chrome differently when the window is not the active
// one. The page never blurs by itself, so the main process reports it.
api.onWindowFocus?.(focused=>{document.body.classList.toggle('window-inactive',!focused);});
setTimeout(()=>{safe(syncCaptures);},600);
