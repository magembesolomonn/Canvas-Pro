const $ = s => document.querySelector(s);
const api = window.library;
let assets=[],assetById=new Map(),folders=[],visible=[],selected=null,view='all',collection=null,tagFilter=null,busy=false,toastTimer,layout,frame=0,hoverPlayer=null,previewPlayer=null;
let layoutDirty=true,inspectorFrame=0,previewScope=null,refreshVersion=0,appliedRefreshVersion=0,galleryLayout='masonry',navStats=null,pendingSelection=null;
const selection=new FileSelection();
const mounted=new Map(),cardCleanup=new Map();
let lastVisibleAssets='';
function publishVisibleAssets(ids){
 const key=ids.join(',');
 if(key===lastVisibleAssets)return;
 lastVisibleAssets=key;
 api.visibleAssets(ids);
}
function assetRatio(a){return SmartCards.ratio(a)||a.aspectRatio||(kind(a)==='video'?16/9:kind(a)==='audio'?3.5:kind(a)==='pdf'?.707:kind(a)==='link'?1.6:1);}
function rememberRatio(a,ratio){if(!Number.isFinite(ratio)||ratio<=0||Math.abs((a.aspectRatio||0)-ratio)<.001)return;a.aspectRatio=ratio;layoutDirty=true;scheduleGallery();api.setAspectRatio(a.id,ratio);}
const imageExt=['png','jpg','jpeg','gif','webp','avif','bmp','svg','ico','heic','heif','tiff','tif','eps','jpegxl','jxl','jfif','jpe','insp','psd','psb'];
const videoExt=['mp4','webm','mov','m4v','ogv','mkv','avi','gifv','3gp','3g2','h265','hevc'];
const audioExt=['mp3','wav','ogg','m4a','aac','flac','aiff','aif','oga','opus','alac'];
const kind=a=>imageExt.includes(a.ext)?'image':videoExt.includes(a.ext)?'video':audioExt.includes(a.ext)?'audio':a.ext==='pdf'?'pdf':['webloc','url'].includes(a.ext)?'link':'other';
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function morphSurfaceFrom(surface, origin) {
 for (const animation of surface.getAnimations()) animation.cancel();
 if (!origin.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
 const bounds = surface.getBoundingClientRect();
 if (!bounds.width) return;
 const limit = value => Math.max(-14, Math.min(14, value));
 const x = limit(origin.left + origin.width / 2 - bounds.left - bounds.width / 2);
 const y = limit(origin.top + origin.height / 2 - bounds.top - bounds.height / 2);
 // Animate the live surface so controls are visible and usable from the first frame.
 surface.animate([
  { transform: `translate(${x}px, ${y}px) scale(.97)`, opacity: .82 },
  { transform: 'none', opacity: 1 }
 ], { duration: 170, easing: 'cubic-bezier(.22,1,.36,1)' });
}
document.addEventListener('click',event=>{
 const origin=event.target.closest?.('#add-canvas,#add-folder,#new-note,#new-note-empty,#note-child');
 if(!origin)return;
 const dialog=document.querySelector('#canvas-dialog[open],#folder-dialog[open],#note-template-dialog[open]');
 if(dialog)morphSurfaceFrom(dialog,origin.getBoundingClientRect());
});
function bytes(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';if(n<1073741824)return(n/1048576).toFixed(1)+' MB';return(n/1073741824).toFixed(2)+' GB';}
function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
async function safe(fn){try{return await fn();}catch(e){notify((e.message||String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}}
function viewIdentity(){return JSON.stringify([view,collection,tagFilter,$('#search').value,$('#type').value,$('#sort').value,galleryLayout]);}
const galleryPositions=new Map();
let pendingGalleryPosition=null,lastTagFilter=null;
function rememberGalleryPosition(){
 if(view==='canvas'||view==='notes'||view==='smart'||!layout||layout.items!==visible||pendingGalleryPosition)return;
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
 if(view==='notes'){if(reload){catalogKey='';catalogNavigation=null;}return;}
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
  let rows=data.assets;
  while(!append&&rows.length<Math.min(target,data.total)){
   const next=await api.libraryPage({...query,offset:rows.length,limit:Math.min(500,target-rows.length)});
   if(generation!==catalogGeneration||!pagedCatalog)return;
   if(!next.assets.length)break;
   rows=rows.concat(next.assets);
  }
  if(data.navigation)applyCatalogNavigation(data);
  const prepared=storeCatalogRows(rows);
  if(append){
   const added=prepared.filter(asset=>!assetById.has(asset.id));
   for(const asset of added)assetById.set(asset.id,asset);
   assets=assets.concat(added);
   if(!added.length)catalogTotal=assets.length;
  }else{
   assets=prepared;assetById=new Map(assets.map(asset=>[asset.id,asset]));
   for(const id of linkRequests.keys())if(!assetById.has(id))linkRequests.delete(id);
   catalogTotal=data.total;catalogKey=key;
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
 if(!pagedCatalog)return Promise.resolve();
 temporaryCatalog=true;
 catalogHydration=refresh().finally(()=>catalogHydration=null);
 return catalogHydration;
}
function refreshCurrent(){return pagedCatalog?loadLibraryPage({reload:true}):refresh();}
async function refresh(){
 pagedCatalog=false;catalogGeneration++;catalogLoading=null;catalogNavigation=null;
 const version=++refreshVersion,identity=viewIdentity(),gallery=$('#gallery');
 const anchor=layout?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null;
 const data=await api.list();if(version!==refreshVersion)return;
 appliedRefreshVersion=version;
 const focused=document.activeElement,preserveInspector=$('#inspector').contains(focused)&&focused.matches('input,textarea,select');
 if(data.prototype)document.title='Canvas Pro Prototype';WorkbenchUI.setData(data.workbench);CanvasWorkspace.setList(data.canvases||[],data.folderRecords||[]);assets=data.assets.map(next=>{const old=assetById.get(next.id);return old?Object.assign(old,next):next;});folders=data.folders;navStats=null;assetById=new Map(assets.map(a=>[a.id,a]));for(const id of linkRequests.keys())if(!assetById.has(id))linkRequests.delete(id);
 for(const a of assets)a.searchText=SmartCards.enrichSearch(a);
 renderNav();render({preserveInspector,anchor:identity===viewIdentity()?anchor:null});
}

async function refreshCaptured(ids){
 if(pagedCatalog)return refreshCurrent();
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
function navButton(label,icon,count,active,handler){const b=el('button',active?'active':'');b.append(glyph(icon),el('span','',label),el('span','badge',String(count)));b.title=label;b.setAttribute('aria-label',label);b.onclick=handler;return b;}
function setView(next,folder=null,keepCatalog=false){rememberGalleryPosition();if(view==='notes'&&next!=='notes')safe(NotesWorkspace.flush);WorkbenchUI.reset();if(next!=='canvas'&&view==='canvas')CanvasWorkspace.leave();stopHover();
 if(temporaryCatalog&&!keepCatalog&&!['canvas','smart'].includes(next)){
  temporaryCatalog=false;pagedCatalog=true;catalogKey='';catalogNavigation=null;
 }
view=next;collection=folder;tagFilter=next==='tags'?lastTagFilter:null;pendingSelection=null;selected=null;selection.clear();$('#search').value='';SmartSearch.schedule();if(next!=='notes')restoreGalleryPosition();
 renderNav();render();}
function renderNav(){
 if(!navStats){const counts={all:0,favorites:0,trash:0,image:0,video:0,audio:0,pdf:0,link:0,social:0,recipe:0},tags=new Set(),members=new Map();for(const a of assets){if(a.trash){counts.trash++;continue;}counts.all++;if(a.favorite)counts.favorites++;counts[kind(a)]=(counts[kind(a)]||0)+1;const linkType=SmartCards.type(a);if(linkType==='social'||linkType==='recipe')counts[linkType]=(counts[linkType]||0)+1;for(const t of a.tags)tags.add(t);for(const f of a.folders)members.set(f,(members.get(f)||0)+1);}counts.tags=tags.size;navStats={counts,members};}
 const {counts,members}=navStats,nav=$('#navigation'),folderIds=new Map(CanvasWorkspace.folderRecords.map(folder=>[folder.name,folder.id]));nav.replaceChildren();for(const [key,label,icon]of [['all','Library','archive'],['favorites','Favourites','star'],['tags','Tags','tag'],['trash','Trash','trash']])nav.append(navButton(label,icon,counts[key],view===key,()=>setView(key)));
 const webLinks=Math.max(0,(counts.link||0)-(counts.social||0)-(counts.recipe||0));
 const mediaNav=$('#media-navigation');mediaNav.replaceChildren();for(const [key,label,icon]of [['image','Images','image'],['video','Video','video'],['audio','Audio','audio'],['social','Social','camera'],['recipe','Recipes','book'],['pdf','Documents','file'],['link','Web links','link']])mediaNav.append(navButton(label,icon,key==='link'?webLinks:counts[key],view===key,()=>setView(key)));
 $('#folders').replaceChildren(...folders.map(f=>{const button=navButton(f,'folder',members.get(f)||0,view==='folder'&&collection===f,()=>setView('folder',f));const folderId=folderIds.get(f);if(folderId)button.firstChild.replaceWith(WorkbenchUI.icon('folder:'+folderId));button.oncontextmenu=e=>{e.preventDefault();safe(()=>api.collectionMenu(f));};button.draggable=true;button.ondragstart=e=>{e.dataTransfer.setData('application/x-canvaspro-collection',f);e.dataTransfer.effectAllowed='copy';};button.ondragend=()=>CanvasWorkspace.clearDrag();return button;}));CanvasWorkspace.renderNav();
}
async function setFavorites(ids,favorite){await api.bulkUpdate(ids,{type:'favorite',favorite});if(pagedCatalog)return refreshCurrent();for(const id of ids){const a=assetById.get(id);if(a)a.favorite=favorite?1:0;}navStats=null;renderNav();render();}
function favoriteButton(a){const b=action('',()=>setFavorites([a.id],!a.favorite),'favorite-toggle'+(a.favorite?' is-favorite':''));b.append(glyph('star'));b.setAttribute('aria-label',a.favorite?'Remove from Favourites':'Add to Favourites');b.setAttribute('aria-pressed',String(!!a.favorite));b.title=b.getAttribute('aria-label');b.onclick=event=>{event.stopPropagation();safe(()=>setFavorites([a.id],!a.favorite));};b.ondblclick=event=>event.stopPropagation();return b;}
function placeholder(a){const d=el('div','file-placeholder');d.append(glyph(kind(a)==='link'?'link':kind(a)==='audio'?'audio':kind(a)==='video'?'video':'file'),el('span','',(a.ext||'FILE').toUpperCase()));return d;}
const videoThumbnailQueue=[];let videoThumbnailActive=false;
function queueVideoThumbnail(a,img){videoThumbnailQueue.push({a,img});pumpVideoThumbnails();}
function pumpVideoThumbnails(){if(videoThumbnailActive)return;let job;while((job=videoThumbnailQueue.shift())&&!job.img.isConnected){}if(!job)return;videoThumbnailActive=true;const {a,img}=job,video=document.createElement('video');video.muted=true;video.preload='auto';let done=false;const finish=(data,ratio)=>{if(done)return;done=true;clearTimeout(timer);video.pause();video.removeAttribute('src');video.load();if(img.isConnected){if(data){img.src=data;rememberRatio(a,ratio);api.cacheVideoThumb(a.id,data).catch(()=>{});}else img.replaceWith(placeholder(a));}videoThumbnailActive=false;setTimeout(pumpVideoThumbnails,40);};const timer=setTimeout(()=>finish(),8000);video.onloadeddata=()=>{try{if(!video.videoWidth)return finish();const c=document.createElement('canvas'),scale=Math.min(1,480/Math.max(video.videoWidth,video.videoHeight));c.width=Math.max(1,Math.floor(video.videoWidth*scale));c.height=Math.max(1,Math.floor(video.videoHeight*scale));c.getContext('2d').drawImage(video,0,0,c.width,c.height);finish(c.toDataURL('image/jpeg',.82),video.videoWidth/video.videoHeight);}catch{finish();}};video.onerror=()=>finish();video.src='asset://file/'+a.id;}
function thumb(a,cls='',gallery=false){const img=el('img',cls);img.loading='lazy';img.decoding='async';img.alt=a.name;img.src='asset://thumb/'+a.id+'?v=2'+(gallery?'&gallery':'');img.onload=()=>{if(img.naturalWidth&&img.naturalHeight)rememberRatio(a,img.naturalWidth/img.naturalHeight);};img.onerror=()=>{if(kind(a)!=='video'||img.dataset.fallback){img.replaceWith(placeholder(a));return;}img.dataset.fallback='1';queueVideoThumbnail(a,img);};return img;}
function inspectorPreview(a){
 const frame=el('div','inspector-media');
 if(kind(a)==='audio'){
   frame.classList.add('inspector-audio');frame.append(placeholder(a));
   getMediaInfo(a,true).then(info=>{if(!frame.isConnected||!info.artwork)return;const img=el('img');img.alt='Embedded cover art';img.src='asset://art/'+a.id;img.onerror=()=>frame.replaceChildren(placeholder(a));frame.replaceChildren(img);}).catch(()=>{});
 }else frame.append(kind(a)==='link'?bookmarkVisual(a):SmartCards.fileVisual(a)||thumb(a));
 frame.title='Double-click to preview';frame.ondblclick=()=>openPreview();
 return frame;
}
function stopHover(){if(hoverPlayer){hoverPlayer.dispose();hoverPlayer=null;}}
function unmount(id){if(hoverPlayer?.id===id)stopHover();cardCleanup.get(id)?.();cardCleanup.delete(id);mounted.get(id)?.remove();mounted.delete(id);}
function makeCard(a){const card=el('article','card');card.dataset.id=a.id;card.setAttribute('role','option');card.setAttribute('aria-label',a.name);card.draggable=true;card.title='Drag out to Finder · Option-drag to a Canvas';card.ondragstart=e=>{stopHover();const ids=selection.ids.has(a.id)?selection.values():[a.id];if(e.altKey){e.dataTransfer.setData('application/x-canvaspro-assets',JSON.stringify(ids));e.dataTransfer.effectAllowed='copy';}else{e.preventDefault();safe(()=>api.startDrag(ids));}};card.ondragend=()=>CanvasWorkspace.clearDrag();const surface=el('div','card-surface');const type=kind(a);if(type==='audio')cardCleanup.set(a.id,audioTile(a,surface));else surface.append(type==='link'?bookmarkVisual(a):SmartCards.fileVisual(a)||thumb(a,'',true));
if(!a.trash)surface.append(favoriteButton(a));if(type==='video'||type==='audio'){const duration=el('span','duration');surface.append(duration);getMediaInfo(a).then(info=>{if(info.duration)duration.textContent=timecode(info.duration);});}
card.onpointerenter=e=>{if(type!=='video'&&type!=='audio')return;if(e.pointerType==='touch'||!$('#preview').hidden||selection.ids.size>1)return;stopHover();const player=createPlayer(a,{compact:true,muted:type==='video'});player.id=a.id;hoverPlayer=player;surface.append(player.element);};card.onpointerleave=()=>{if(hoverPlayer?.id===a.id)stopHover();};
const meta=el('div','card-meta'),details=el('div','card-details');details.append(el('span','',a.tags.length?a.tags.length+' tags':''));meta.append(el('span','card-name',a.name),details);card.append(surface,meta);card._parts={
 name:meta.firstChild,detail:details.lastChild,star:surface.querySelector('.favorite-toggle'),
 visual:type==='link'?surface.querySelector('.link-visual'):null
};card.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();stopHover();if(!selection.ids.has(a.id))select(a.id);safe(()=>api.contextMenu(selection.values(),view==='folder'?collection:null));};card.onclick=e=>{if(e.ctrlKey&&navigator.platform.includes('Mac'))return;if(!e.target.closest('.player-controls,.player-wave'))select(a.id,e);};card.ondblclick=e=>{if(!e.target.closest('.player-controls,.player-wave')){select(a.id);openPreview();}};return card;}
function scheduleGallery(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;renderWindow();});}
function renderWindow(anchorOverride=null){if(view==='canvas'||view==='notes')return;
 const gallery=$('#gallery'),layer=$('#gallery-layer'),size=Number($('#zoom').value);
 if(pagedCatalog&&catalogLoading&&catalogLoading.key!==catalogKey)return;
 const restored=pendingGalleryPosition&&pendingGalleryPosition.key===viewIdentity()?pendingGalleryPosition:null;
 if(layoutDirty||!layout||layout.items!==visible||layout.width!==gallery.clientWidth||layout.target!==size||layout.mode!==galleryLayout){
  const anchor=anchorOverride||(layout?.items===visible?AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight):null);
  // Cards with no tags render only a title, so their footer is shorter.
  // Using one fixed footer height for every card leaves uneven blank rows.
  const footerHeight=a=>document.body.classList.contains('hide-file-names')?0:SmartCards.isSelfContained(a)?0:(a.tags?.length?36:22);
  layout=AssetLayout.createLayout(galleryLayout,visible,gallery.clientWidth,size,assetRatio,footerHeight);layoutDirty=false;layer.style.height=layout.height+'px';
  const position=anchor&&layout.byId.get(anchor.id);if(position)gallery.scrollTop=position.y+anchor.offset*(position.width/anchor.width);
 }
 if(restored){
  const anchor=restored.anchor,position=anchor&&layout.byId.get(anchor.id);
  gallery.scrollTop=position?position.y+anchor.offset*(position.width/anchor.width):restored.top;
  pendingGalleryPosition=null;
 }
 if(pagedCatalog&&gallery.scrollTop+gallery.clientHeight>=layout.height-Math.max(200, gallery.clientHeight * 0.15)&&assets.length<catalogTotal)safe(()=>loadLibraryPage({append:true}));
 const indices=AssetLayout.visibleIndices(layout,gallery.scrollTop,gallery.clientHeight),ids=new Set(indices.map(i=>visible[i].id));
 publishVisibleAssets([...ids]);
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
  }
  const chosen=selection.ids.has(a.id),focused=a.id===selected;
  card.classList.toggle('selected',chosen);
  card.classList.toggle('focused',focused);
  if(card.getAttribute('aria-selected')!==String(chosen))card.setAttribute('aria-selected',String(chosen));card.setAttribute('aria-label',chosen?a.name+' (selected)':a.name);
  const parts=card._parts,displayName=parts.visual?(a.captureMetadata?.linkPreview?.title||a.name.replace(/\.(url|webloc)$/i,'')):a.name;
  if(parts.name.textContent!==displayName)parts.name.textContent=displayName;
  if(parts.visual&&parts.visual.dataset.url!==a.url){
   const replacement=bookmarkVisual(a);
   parts.visual.replaceWith(replacement);
   parts.visual=replacement;
  }
  if(parts.star&&parts.star.getAttribute('aria-pressed')!==String(!!a.favorite)){
   parts.star.classList.toggle('is-favorite',!!a.favorite);
   parts.star.setAttribute('aria-pressed',String(!!a.favorite));
   parts.star.setAttribute('aria-label',a.favorite?'Remove from Favourites':'Add to Favourites');
   parts.star.title=parts.star.getAttribute('aria-label');
  }
  const detail=a.tags.length?a.tags.length+' tags':'';
  if(parts.detail.textContent!==detail)parts.detail.textContent=detail;
 }
}
function render(options={}){stopHover();NotesWorkspace.show(view==='notes');
 if(view==='notes'){CanvasWorkspace.show(false);return;}
 if(view==='canvas'){if($('#preview').hidden){visible=[];selection.sync([]);selected=null;}CanvasWorkspace.render();return;}CanvasWorkspace.show(false);
 if(pagedCatalog&&view==='smart'){safe(hydrateCatalog);return;}
 const tags=view==='tags'?(pagedCatalog?catalogNavigation?.tags:[...new Set(assets.filter(a=>!a.trash).flatMap(a=>a.tags))].sort()):null;
 if(tags&&tagFilter&&!tags.includes(tagFilter)){
  tagFilter=lastTagFilter=null;restoreGalleryPosition();
 }
 if(pagedCatalog&&catalogKey!==JSON.stringify(catalogQuery())){safe(loadLibraryPage);return;}
 if(pagedCatalog){visible=assets;selection.sync(visible.map(a=>a.id));selected=selection.focus;}
 else{
 const q=$('#search').value.trim().toLowerCase(),type=$('#type').value;visible=assets.filter(a=>{if(view==='trash'?!a.trash:a.trash)return false;if(!WorkbenchUI.accepts(a))return false;if(view==='folder'&&!a.folders.includes(collection))return false;if(view==='tags'&&!a.tags.length)return false;if(view==='favorites'&&!a.favorite)return false;if(['image','audio','video','pdf'].includes(view)&&kind(a)!==view)return false;if(view==='link'&&(kind(a)!=='link'||['social','recipe'].includes(SmartCards.type(a))))return false;if(['social','recipe'].includes(view)&&SmartCards.type(a)!==view)return false;if(tagFilter&&!a.tags.includes(tagFilter))return false;if(type!=='all'&&(type==='link'?(kind(a)!=='link'||['social','recipe'].includes(SmartCards.type(a))):kind(a)!==type&&SmartCards.type(a)!==type))return false;return !q||SmartSearch.includes(a,q);});
 // Find similar and colour matching both rank the gallery: closest match
 // first, instead of the order the files happened to be imported in.
 if(WorkbenchUI.rankOrder())visible.sort((x,y)=>WorkbenchUI.rank(x)-WorkbenchUI.rank(y));if($('#sort').value==='old')visible.sort((a,b)=>a.imported.localeCompare(b.imported)||(a.importOrder||0)-(b.importOrder||0));if($('#sort').value==='name')visible.sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));if($('#sort').value==='size')visible.sort((a,b)=>b.size-a.size);if(view==='smart'&&WorkbenchUI.rankOrder())visible.sort((a,b)=>WorkbenchUI.rank(a)-WorkbenchUI.rank(b));selection.sync(visible.map(a=>a.id));selected=selection.focus;
 }
if(pendingSelection){const id=pendingSelection;pendingSelection=null;if(selection.index.has(id)){selection.select(id);selected=selection.focus;}}
$('#view-title').textContent=view==='smart'?WorkbenchUI.title:view==='folder'?collection:({all:'Library',favorites:'Favourites',tags:'Tags',trash:'Trash',image:'Images',audio:'Audio',video:'Video',social:'Social',recipe:'Recipes',pdf:'Documents',link:'Web links'})[view];const count=pagedCatalog?catalogTotal:visible.length;$('#count').textContent=count.toLocaleString()+(count===1?' item':' items');const bar=$('#tags-bar');bar.hidden=view!=='tags';bar.replaceChildren();if(view==='tags')for(const tag of tags||[]){const b=el('button',tagFilter===tag?'primary':'',tag);b.onclick=()=>{rememberGalleryPosition();tagFilter=lastTagFilter=tagFilter===tag?null:tag;restoreGalleryPosition();render();};bar.append(b);}renderEmptyState();renderWindow(options.anchor);paintSelection();if(!options.preserveInspector)renderInspector();}
function paintSelection(){for(const [id,card]of mounted){card.classList.toggle('selected',selection.ids.has(id));card.classList.toggle('focused',id===selected);card.setAttribute('aria-selected',String(selection.ids.has(id)));}const count=selection.ids.size;$('#selection-count').textContent=count===0?'':count.toLocaleString()+' selected';}
function select(id,options={}){selection.select(id,options);selected=selection.focus;if(selection.ids.size>1)stopHover();paintSelection();scheduleInspector();}
function scheduleInspector(){if(inspectorFrame)return;inspectorFrame=requestAnimationFrame(()=>{inspectorFrame=0;renderInspector();});}
async function bulkAction(operation){const ids=selection.values();if(!ids.length)return;await api.bulkUpdate(ids,operation);await refreshCurrent();notify(ids.length+' files updated.');}
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
 const collections=section('Add to collection');const choice=el('select');choice.setAttribute('aria-label','Collection for selected files');const first=el('option','','Choose a collection…');first.value='';choice.append(first);for(const folder of folders){const option=el('option','',folder);option.value=folder;choice.append(option);}choice.onchange=()=>{if(choice.value)safe(()=>bulkAction({type:'collection',folder:choice.value}));};collections.append(choice);box.append(collections);
 const canvas=section('Canvas');if(view!=='trash')canvas.append(action('Add to Canvas…',()=>CanvasWorkspace.choose({ids})));box.append(canvas);
 const favourites=section('Favourites');favourites.append(action(items.every(a=>a.favorite)?'Remove from Favourites':'Add to Favourites',()=>setFavorites(ids,!items.every(a=>a.favorite))));box.append(favourites);
 const names=section('Selected files');const list=el('div','selection-names');for(const a of items.slice(0,8))list.append(el('p','',a.name));if(items.length>8)list.append(el('p','hint','and '+(items.length-8)+' more'));names.append(list);box.append(names);
 const actions=el('div','inspector-actions');actions.append(action('Copy '+items.length+' files',async()=>{await api.copyFiles(ids);notify(items.length+' files copied.');}),action('Export copies',async()=>{const count=await api.exportFiles(ids);if(count)notify(count+' copies exported.');}),action(view==='trash'?'Restore selection':'Move selection to Trash',()=>bulkAction({type:'trash',trash:view!=='trash'}),view==='trash'?'':'danger'),action('Share…',()=>api.shareFiles(ids)),...(view==='trash'?[action('Delete Permanently…',()=>deleteSelectedPermanently(ids),'danger')]:[]),action('Clear selection',()=>{selection.clear();selected=null;paintSelection();renderInspector();}));box.append(actions);
}
async function update(changes){const a=current();if(!a)return;const saved=await api.update(a.id,changes);Object.assign(a,saved);a.trash=a.trash?1:0;a.searchText=SmartCards.enrichSearch(a);if(pagedCatalog)return refreshCurrent();navStats=null;renderNav();render();}
function field(value, placeholder, handler, multiline=false) {const input=el(multiline?'textarea':'input'); input.value=value; input.placeholder=placeholder; input.setAttribute('aria-label',placeholder); input.onchange=()=>safe(()=>handler(input.value)); return input;}
function section(title) {const s=el('section');s.append(el('h3','',title));return s;}
function action(text,handler,cls='') {const b=el('button',cls,text); b.onclick=()=>safe(handler);return b;}
function renderInspector() {
  if(view==='canvas'){CanvasWorkspace.renderInspector();return;}
  if(selection.ids.size>1){renderSelectionInspector();return;}
  const box=$('#inspector');box.replaceChildren(el('div','inspector-label','FILE DETAILS'));const a=current();
  if(!a){box.append(el('div','inspector-empty-icon'),el('h3','','File details'),el('p','hint','Select a file to edit its name, notes, tags and collections. Press Space to preview it.'));return;}
  const k=kind(a);
  const similarButton=action('',()=>safe(()=>WorkbenchUI.similar(a.id)),'find-similar');
  similarButton.append(glyph('search'),document.createTextNode('Find similar'));
  // The name is the only thing this row holds now: the star and the file
  // actions moved back to the card and the context menu.
  const nameRow=el('div','inspector-name-row');
  const nameInput=field(a.name,'File name',name=>update({name}));
  nameInput.className='inspector-name-input';
  nameRow.append(nameInput);
  if(a.smart?.caption)box.append(el('p','inspector-caption',a.smart.caption));
  box.append(inspectorPreview(a),similarButton,nameRow);
  // A file note is editable text that exists nowhere else, so it stays here.
  if(a.notes){
    const notes=field(a.notes,'Notes…',notes=>update({notes}),true);
    notes.className='inspector-notes';
    box.append(notes);
  }
  if(k==='image'){box.append(SmartCards.paletteSection(a));}
  else if(k==='video'||k==='audio'){const mediaDetails=el('p','hint','Reading media information…');box.append(mediaDetails);api.mediaInfo(a.id,true).then(info=>{if(selected!==a.id||!mediaDetails.isConnected)return;mediaDetails.textContent=[info.duration?'Duration '+timecode(info.duration):'',info.width&&info.height?info.width+' × '+info.height:'',info.codec||'',info.artist||'',info.album||''].filter(Boolean).join(' · ')||'Media information unavailable';}).catch(()=>mediaDetails.textContent='Media information unavailable');}
  else if(k==='link'&&a.captureMetadata){const metadata=a.captureMetadata;const source=section('Website');const details=el('dl','properties');for(const [label,value]of [['Original URL',metadata.pageUrl],['Website title',metadata.pageTitle],['Domain',metadata.pageUrl?new URL(metadata.pageUrl).hostname:''],['Capture date',metadata.capturedAt?new Date(metadata.capturedAt).toLocaleString():'']])if(value)details.append(el('dt','',label),el('dd','',String(value)));source.append(details);box.append(source);}
  // Tags, with the local model offering words for this picture.
  const tags=el('section');
  const tagHead=el('div','inspector-section-head');
  tagHead.append(el('h3','','Tags'));
  const suggestions=TagSuggestions.mount(a,{add:tag=>update({tags:[...new Set([...a.tags,tag])]})});
  tagHead.append(suggestions.button);
  tags.append(tagHead);
  const chips=el('div','chips');for(const t of a.tags){const chip=el('span','chip',t);chip.append(action('×',()=>update({tags:a.tags.filter(x=>x!==t)})));chips.append(chip);}tags.append(chips);
  const add=field('','Add tags, separated by commas',v=>update({tags:[...a.tags,...v.split(',')]}));add.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add.blur();}};tags.append(add);
  tags.append(suggestions.results);
    box.append(tags);
  const coll=section('Collections'); const assigned=el('div','chips');for(const f of a.folders){const chip=el('span','chip',f);chip.append(action('×',()=>update({folders:a.folders.filter(x=>x!==f)})));assigned.append(chip);}coll.append(assigned);const choose=el('select');choose.setAttribute('aria-label','Add to collection');const first=el('option','','Add to collection…');first.value='';choose.append(first);for(const f of folders.filter(f=>!a.folders.includes(f))){const o=el('option','',f);o.value=f;choose.append(o);}choose.onchange=()=>safe(()=>update({folders:[...a.folders,choose.value]}));coll.append(choose);box.append(coll);
  if(k==='image'){
   const props=section('Image properties'),dl=el('dl','properties'),sizeLabel=el('dt','','Dimensions'),sizeValue=el('dd','','Reading…');
   dl.append(el('dt','','Type'),el('dd','',(a.ext||'File').toUpperCase()),sizeLabel,sizeValue,el('dt','','Imported'),el('dd','',new Date(a.imported).toLocaleDateString()),el('dt','','Created'),el('dd','',new Date(a.created).toLocaleDateString()));
   props.append(dl);box.append(props);
   api.imageSize(a.id).then(size=>{
    if(!sizeValue.isConnected)return;
    if(size?.width&&size?.height)sizeValue.textContent=size.width+' × '+size.height;
    else{sizeLabel.remove();sizeValue.remove();}
   }).catch(()=>{sizeLabel.remove();sizeValue.remove();});
  }
}
function openPreview(scopeOverride=null){stopHover();if(!selected&&visible.length)select(visible[0].id);if(!current())return;previewScope=Array.isArray(scopeOverride)?scopeOverride:selection.ids.size>1?visible.filter(a=>selection.ids.has(a.id)):pagedCatalog?null:visible;$('#preview').hidden=false;$('main').inert=true;$('.sidebar').inert=true;$('#inspector').inert=true;renderPreview();$('#preview').focus({preventScroll:true});}
function closePreview(){previewScope=null;previewPlayer?.dispose();previewPlayer=null;$('#preview').hidden=true;$('#preview-content').replaceChildren();$('main').inert=false;SidebarUI.syncAccessibility();$('#inspector').inert=false;if(view==='canvas'){const item=CanvasWorkspace.doc&&[...CanvasWorkspace.doc.items.values()].find(item=>item.assetId===selected);if(item&&assetById.get(selected)?.trash===0)CanvasWorkspace.select([item.id]);selection.clear();selected=null;CanvasWorkspace.viewport.focus({preventScroll:true});}else{revealGallerySelection();$('#gallery').focus({preventScroll:true});}}
function mountRasterPreview(a,unsupported){
 const element=el('div','raster-preview');
 const image=el('img','image-preview');
 let zoom=1,detail=0,disposed=false,request=0,timer,offset={x:0,y:0},drag=null;
 image.alt=a.name;image.draggable=false;
 image.style.visibility='hidden';
 image.onload=()=>{image.style.visibility='';};
 const cached=mounted.get(a.id)?.querySelector('.card-surface img');
 image.src=cached?.naturalWidth?cached.currentSrc:'asset://thumb/'+a.id+'?v=2&cached';
 element.append(image);
 function paint(){image.style.transform=`translate(${offset.x}px,${offset.y}px) scale(${zoom})`;}
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
 const observer=new ResizeObserver(load);observer.observe(element);
 queueMicrotask(load);
 api.previewZoomActive(true);paint();
 return {element,zoomBy:factor=>setZoom(zoom*factor),resetZoom:()=>setZoom(1),
  dispose(){disposed=true;api.previewZoomActive(false);clearTimeout(timer);observer.disconnect();image.removeAttribute('src');element.remove();}};
}
function renderPreview(){previewPlayer?.dispose();previewPlayer=null;const a=current();if(!a)return;const scope=previewScope||visible;const i=scope.findIndex(x=>x.id===a.id),total=pagedCatalog&&!previewScope?catalogTotal:scope.length;$('#preview').setAttribute('aria-label','Preview: '+a.name);$('#preview-index').textContent=(i+1).toLocaleString()+' / '+total.toLocaleString();$('#previous').disabled=i<=0;$('#next').disabled=i>=total-1;const content=$('#preview-content');content.replaceChildren();const unsupported=()=>{const div=el('div','unsupported');div.append(placeholder(a),el('p','','Open this file with macOS Quick Look.'),action('Quick Look',()=>api.quickLook(a.id)));content.replaceChildren(div);};
if(SmartCards.isNote(a)){previewPlayer=SmartCards.mountNote(a);content.append(previewPlayer.element);}else if(CanvasFormats.supports(a.ext)){previewPlayer=CanvasFormats.mount(a);content.append(previewPlayer.element);}else if(['video','audio'].includes(kind(a))){previewPlayer=createPlayer(a);content.append(previewPlayer.element);}else if(kind(a)==='image'&&/^(png|jpe?g|jfif|jpe|insp|avif|bmp|heic|heif|tiff?)$/.test(a.ext)){previewPlayer=mountRasterPreview(a,unsupported);content.append(previewPlayer.element);}else if(kind(a)==='image'){const img=el('img','image-preview');img.alt=a.name;const nativeOnly=['psd','psb','eps','jpegxl','jxl','insp','heic','heif','tiff','tif'].includes(a.ext);img.src='asset://'+(nativeOnly?'preview':'file')+'/'+a.id;img.onerror=()=>{if(img.parentElement!==content)return;if(img.dataset.nativeAttempt){unsupported();return;}img.dataset.nativeAttempt='1';img.src='asset://preview/'+a.id;};if(nativeOnly)img.dataset.nativeAttempt='1';content.append(img);}else if(kind(a)==='pdf'){const frame=el('iframe');frame.title=a.name;frame.src='asset://file/'+a.id;content.append(frame);}else if(kind(a)==='link'){previewPlayer=mountBookmark(a);content.append(previewPlayer.element);}else if(['md','txt','json','csv','css','js','ts','xml','log'].includes(a.ext)&&a.size<=2*1024*1024){const text=el('pre','text-preview','Loading…');content.append(text);api.readText(a.id).then(value=>{if(text.isConnected)text.textContent=value;}).catch(e=>{text.textContent=e.message;});}else {const img=el('img','image-preview');img.alt=a.name;img.src='asset://preview/'+a.id;img.onerror=()=>{if(img.parentElement!==content)return;unsupported();const message=content.querySelector('.unsupported p');if(message)message.textContent=['swf','epub'].includes(a.ext)?'This format needs a compatible preview plugin. Importing, organizing and exporting remain available.':'No compatible preview decoder is available for this file on this Mac.';};content.append(img);}}
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
 if(isPreview&&previewScope){selected=pool[next].id;selection.focus=selected;paintSelection();}
 else select(pool[next].id,{shiftKey:extend});
 revealGallerySelection();
 if(isPreview)renderPreview();
}
async function importing(operation){const canvasId=view==='canvas'?CanvasWorkspace.doc?.board.id:null;busy++;try{const r=await operation();if(r){if(r.ids?.length)await refreshCaptured(r.ids);else if(!Array.isArray(r.ids))await refreshCurrent();if(canvasId&&r.ids?.length)await CanvasWorkspace.imported(canvasId,r.ids);notify(`${r.imported} imported · ${r.duplicates} duplicates${r.skipped?' · '+r.skipped+' skipped':''}${r.errors.length?'\n'+r.errors.slice(0,3).join('\n'):''}`);}}finally{busy--;if(!busy)$('#status').textContent='All changes saved';}}
function importDialog(directory=false){return safe(()=>importing(()=>api.importDialog(collection,directory)));}
$('#import').onclick=()=>importDialog();$('#import-folder').onclick=()=>importDialog(true);api.onImport(()=>importDialog());api.onProgress(p=>$('#status').textContent=p?'Importing '+p.count+': '+p.name:busy?'Finishing import…':'All changes saved');
$('.search').addEventListener('click',event=>{if(!event.target.closest('button,input'))$('#search').focus();});
$('#search').oninput=()=>{ const gallery=$('#gallery'); const pos=gallery.scrollTop; pendingGalleryPosition={key:viewIdentity(),top:pos,count:visible.length,anchor:AssetLayout.anchorAt(layout,gallery.scrollTop,gallery.clientHeight)};$('#gallery').scrollTop=0;SmartSearch.schedule();render();};$('#type').onchange=()=>{ pendingGalleryPosition=null;$('#gallery').scrollTop=0;pagedCatalog?safe(()=>refreshCurrent()):render();};$('#sort').onchange=()=>{localStorage.setItem('sort-order',$('#sort').value);pendingGalleryPosition=null;$('#gallery').scrollTop=0;pagedCatalog?safe(()=>refreshCurrent()):render();};
function syncMenu(menu,attr,value){if(!menu)return;for(const option of menu.querySelectorAll('['+attr+']'))option.setAttribute('aria-checked',String(option.getAttribute(attr)===String(value)));}
function positionMenu(menu,button){if(!menu||!button||!menu.matches(':popover-open'))return;const rect=button.getBoundingClientRect();menu.style.top=(rect.bottom+8)+'px';menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,rect.right-menu.offsetWidth))+'px';}
for(const [menuId,buttonId] of [['import-menu','import-menu-button']]){
 const menu=document.getElementById(menuId),button=document.getElementById(buttonId);if(!menu||!button)continue;
 menu.addEventListener('toggle',event=>{button.setAttribute('aria-expanded',String(event.newState==='open'));if(event.newState==='open')positionMenu(menu,button);});
 addEventListener('resize',()=>positionMenu(menu,button));
}
const viewMenu=$('#view-menu'),importMenu=$('#import-menu');
if(viewMenu){
 syncMenu(viewMenu,'data-view-type',$('#type').value);
 syncMenu(viewMenu,'data-view-sort',$('#sort').value);
 viewMenu.addEventListener('click',event=>{
  const typeOption=event.target.closest('[data-view-type]');
  const sortOption=event.target.closest('[data-view-sort]');
  if(typeOption){$('#type').value=typeOption.dataset.viewType;syncMenu(viewMenu,'data-view-type',typeOption.dataset.viewType);viewMenu.hidePopover();pagedCatalog?safe(()=>refreshCurrent()):render();return;}
  if(sortOption){$('#sort').value=sortOption.dataset.viewSort;localStorage.setItem('sort-order',sortOption.dataset.viewSort);syncMenu(viewMenu,'data-view-sort',sortOption.dataset.viewSort);viewMenu.hidePopover();pendingGalleryPosition=null;$('#gallery').scrollTop=0;render();}
 });
}
if(importMenu){importMenu.addEventListener('click',event=>{if(event.target.closest('button'))importMenu.hidePopover();});}
$('#gallery').addEventListener('scroll',()=>{stopHover();scheduleGallery();},{passive:true});new ResizeObserver(scheduleGallery).observe($('#gallery'));
$('#zoom').oninput=()=>{stopHover();renderWindow();localStorage.setItem('tile-size',$('#zoom').value);};const savedSize=Number(localStorage.getItem('tile-size'));if(savedSize>=140&&savedSize<=360)$('#zoom').value=savedSize;
$('#show-extension').onclick=()=>safe(()=>api.showExtension());
$('#show-library').onclick=()=>safe(()=>api.showLibrary());$('#toggle-inspector').onclick=()=>{document.body.classList.toggle('hide-inspector');localStorage.setItem('hide-inspector',String(document.body.classList.contains('hide-inspector')));};if(localStorage.getItem('hide-inspector')==='true')document.body.classList.add('hide-inspector');
$('#add-folder').onclick=()=>{$('#folder-dialog').returnValue='';$('#folder-name').value='';$('#folder-dialog').showModal();$('#folder-name').focus();};$('#folder-dialog').addEventListener('close',()=>{if($('#folder-dialog').returnValue==='create')safe(async()=>{await api.addFolder($('#folder-name').value);await refreshCurrent();const f=CanvasWorkspace.folderRecords.find(f=>f.name===$('#folder-name').value.trim());if(f)await WorkbenchUI.created('folder:'+f.id,'collection');});});
$('#previous').replaceChildren(glyph('chevronLeft'));$('#next').replaceChildren(glyph('chevronRight'));$('#close-preview').onclick=closePreview;$('#previous').onclick=()=>move(-1);$('#next').onclick=()=>move(1);
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
document.addEventListener('keydown',e=>{
 const command=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
 const typing=e.target.matches?.('input:not([type="range"]),textarea,select,[contenteditable="true"]');
 const editing=e.target.matches?.('input,textarea,select,[contenteditable="true"],canvas[role="slider"]');
 // Any open dialog or popover owns the keyboard while it is up.
 if(document.querySelector('dialog[open], [popover]:popover-open'))return;
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

 if(!$('#preview').hidden&&command&&previewPlayer&&['+','=','-','0'].includes(key)){
  e.preventDefault();
  if(key==='0'){if(previewPlayer.resetZoom)previewPlayer.resetZoom();}else if(previewPlayer.zoomBy)previewPlayer.zoomBy(key==='-'?1/1.4:1.4);
  else notify(key==='+'||key==='='?'Zoom not available for this preview type':'');
  return;
 }
 if(e.key!=='Escape'&&e.target.closest?.('.canvas-selection-tools'))return;
 if(view==='canvas'&&$('#preview').hidden&&!typing&&['Backspace','Delete'].includes(e.key)){e.preventDefault();if(!e.repeat)CanvasWorkspace.removeSelected();return;}
 if(view==='canvas'&&CanvasWorkspace.keydown(e))return;
 // The thumbnail slider is gone, so the library zooms with the same keys the
 // canvas uses: Command + / - to resize, Command + 0 to reset.
 if(command&&!e.altKey&&!typing&&$('#preview').hidden&&['+','=','-','_','0'].includes(key)){
  const slider=$('#zoom');let size=Number(slider.value);
  if(key==='0')size=230;else if(key==='-'||key==='_')size-=20;else size+=20;
  slider.value=Math.max(140,Math.min(360,size));
  slider.dispatchEvent(new Event('input'));
  e.preventDefault();return;
 }
 if(command&&!e.shiftKey&&!e.altKey&&['s','b'].includes(key)){e.preventDefault();if(!e.repeat)$('#toggle-sidebar').click();return;}
 if(command&&!e.shiftKey&&!e.altKey&&key===','){e.preventDefault();if(!$('#preview').hidden)closePreview();$('#show-settings').click();return;}
  if(view==='notes')return;
 if(command&&['f','k'].includes(key)){e.preventDefault();if(!$('#preview').hidden)closePreview();if(view==='canvas'){CanvasWorkspace.toggleTray(true);$('#canvas-tray-search').focus();}else $('#search').focus();return;}
 if(command&&!e.shiftKey&&!e.altKey&&['Backspace','Delete'].includes(e.key)&&!typing){e.preventDefault();if(!e.repeat)safe(trashSelection);return;}
 if(e.code==='Space'&&e.repeat&&!typing){e.preventDefault();return;}
 if(!$('#preview').hidden&&e.code==='Space'){e.preventDefault();closePreview();return;}
 if(e.code==='Space'&&$('#preview').hidden&&!typing){e.preventDefault();if(hoverPlayer?.id)select(hoverPlayer.id);openPreview();return;}
 if(editing)return;
 if(command&&key==='a'&&$('#preview').hidden){
  e.preventDefault();
  safe(async()=>{if(pagedCatalog&&assets.length<catalogTotal)await hydrateCatalog();selection.all();selected=selection.focus;stopHover();paintSelection();scheduleInspector();});
  return;
 }
 if(e.key==='Escape'&&$('#preview').hidden){selection.clear();selected=null;paintSelection();renderInspector();return;}
 if(command&&key==='i'){e.preventDefault();$('#toggle-inspector').click();return;}
 if(command&&key==='c'&&selected){e.preventDefault();const ids=$('#preview').hidden?selection.values():[selected];safe(async()=>{await api.copyFiles(ids);notify(ids.length+' files copied.');});return;}
 if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();move(['ArrowRight','ArrowDown'].includes(e.key)?1:-1,e.shiftKey,e.key);}

});

document.addEventListener('paste',e=>{if(view==='notes'||e.target.matches('input,textarea,[contenteditable="true"]'))return;e.preventDefault();if(view==='canvas'){if(!$('#preview').hidden)closePreview();safe(()=>CanvasWorkspace.paste());}else safe(()=>importing(()=>api.paste(collection)));});
let dragDepth=0;document.addEventListener('dragenter',e=>{e.preventDefault();if(e.dataTransfer.types.includes('application/x-canvaspro-note'))return;dragDepth++;document.body.classList.add('dragging');});document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('dragleave',()=>{if(dragDepth>0&&--dragDepth===0)document.body.classList.remove('dragging');});document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('dragging');if(view==='notes')return;const paths=[...e.dataTransfer.files].map(f=>api.filePath(f)).filter(Boolean);if(paths.length)safe(()=>importing(()=>api.importPaths(paths,collection)));else{const url=(e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain')).split('\n').find(line=>/^https?:\/\//i.test(line.trim()));if(url)safe(()=>importing(()=>api.importURL(url.trim(),collection)));}});
const brandIcon=el('img');brandIcon.src='assets/app-icon.png';brandIcon.alt='';$('.brand-icon').replaceChildren(brandIcon);$('#toggle-inspector').replaceChildren(glyph('sidebar'));$('#toggle-sidebar').replaceChildren(glyph('sidebar'));$('#show-sidebar').replaceChildren(glyph('sidebar'));$('#view-menu-button').append(glyph('layout'));$('#import-menu-button').append(glyph('plus'));window.addEventListener('blur',stopHover);let captureRefreshTimer,needsFullRefresh=false;
const pendingCaptures=new Set();
api.onLibraryChanged(ids=>{
 if(Array.isArray(ids))for(const id of ids)pendingCaptures.add(id);
 else needsFullRefresh=true;
 clearTimeout(captureRefreshTimer);
 captureRefreshTimer=setTimeout(()=>{
   const changed=[...pendingCaptures],full=needsFullRefresh||changed.length>500||!appliedRefreshVersion||appliedRefreshVersion!==refreshVersion;
   pendingCaptures.clear();needsFullRefresh=false;
   safe(pagedCatalog?refreshCurrent:full?refresh:()=>refreshCaptured(changed));
 },100);
});api.onCaptureStatus(job=>{$('#status').textContent=job.state==='running'?'Browser capture '+job.done+'/'+job.total+(job.bytes?' · '+bytes(job.bytes):''):job.errors.length?'Capture finished with '+job.errors.length+' issue'+(job.errors.length===1?'':'s'):'Saved '+job.imported+' browser captures';});initContextUI();initReliabilityUI();initViewPreferences();initBookmarks();CanvasWorkspace.init();SmartSearch.init();WorkbenchUI.init();NotesWorkspace.init();SidebarUI.init();safe(loadLibraryPage);
