const linkRequests=new Map();
function bookmarkInfo(a,force=false){
 const existing=linkRequests.get(a.id);
 if(!force&&existing?.url===a.url&&(!existing.expires||existing.expires>Date.now()))return existing.promise;
 const entry={url:a.url};
 entry.promise=api.linkInfo(a.id,force).then(info=>{
  if(info){
   applyBookmarkInfo(a.id,info);
   entry.url=a.url;
   entry.expires=Date.now()+60000;
   if(linkRequests.get(a.id)===entry&&linkRequests.size>256){
    for(const [id,request] of linkRequests){
     if(id!==a.id&&request.expires)linkRequests.delete(id);
     if(linkRequests.size<=256)break;
    }
   }
  }else if(linkRequests.get(a.id)===entry){
   linkRequests.delete(a.id);
   if(mounted.has(a.id)&&!a.trash)setTimeout(()=>{
    if(mounted.has(a.id)&&!linkRequests.has(a.id))bookmarkInfo(a);
   },300);
  }
  return info;
 }).catch(()=>{
  if(linkRequests.get(a.id)===entry)linkRequests.delete(a.id);
  return null;
 });
 linkRequests.set(a.id,entry);
 return entry.promise;
}
function applyBookmarkInfo(id,info){
 const a=assetById.get(id);
 if(!a||a.url&&info.url!==a.url)return;
 const previous=a.captureMetadata?.linkPreview;
 if(previous?.url===info.url&&previous.updatedAt>=info.updatedAt&&a.name===(info.name||a.name))return;
 const ratio=assetRatio(a),social=SmartCards.isSocialCard(a);
 if(!a.url)a.url=info.url;
 a.captureMetadata={...a.captureMetadata,linkPreview:info};
 if(info.name)a.name=info.name;
 if(info.tags)a.smart={...a.smart,tags:[...new Set([...(a.smart?.tags||[]),...info.tags])]};
 a.searchText=SmartCards.enrichSearch(a);
 if(ratio!==assetRatio(a)||social!==SmartCards.isSocialCard(a)){layoutDirty=true;scheduleGallery();}
 const card=mounted.get(id);
 if(card)card._parts.name.textContent=info.title||a.name.replace(/\.(url|webloc)$/i,'');
 if(view==='canvas')CanvasWorkspace.assetChanged(id);
 for(const node of document.querySelectorAll('.link-visual'))if(node.dataset.id===id)paintBookmarkVisual(node,a,info);
}
function paintBookmarkVisual(node,a,info=a.captureMetadata?.linkPreview){
 const version=(info?.updatedAt||0)+':'+(info?.cover||false)+':'+(info?.icon||false);
 if(node.dataset.version===version)return;
 node.dataset.version=version;node.dataset.url=a.url;node.replaceChildren();
 if(info?.type&&typeof SmartCards!=='undefined'){SmartCards.paint(node,a,info);return;}
 let domain='Web link';try{domain=new URL(a.url).hostname.replace(/^www\./,'');}catch{}
 node.append(el('div','link-monogram',domain[0].toUpperCase()));
 if(info?.cover){const image=el('img','link-cover');image.alt=info.title||a.name;image.decoding='async';image.src='asset://link-cover/'+a.id+'?v='+info.updatedAt;image.onerror=()=>image.remove();node.append(image);}
 const footer=el('div','link-site'),icon=el('span','link-site-icon',domain[0].toUpperCase());
 if(info?.icon){const image=el('img');image.alt='';image.src='asset://link-icon/'+a.id+'?v='+info.updatedAt;image.onerror=()=>image.remove();icon.replaceChildren(image);}
 footer.append(icon,el('span','',domain));node.append(footer);node.title=info?.description||a.url;
}
function bookmarkVisual(a){const node=el('div','link-visual');node.dataset.id=a.id;paintBookmarkVisual(node,a);bookmarkInfo(a);return node;}
function mountWebBookmark(a){const token=crypto.randomUUID(),element=el('div','web-bookmark'),toolbar=el('div','web-bookmark-toolbar'),slot=el('div','web-bookmark-slot'),notice=el('p','web-bookmark-notice','Opening website…');let disposed=false,opened=false;
 const command=kind=>api.webCommand(token,kind),back=action('‹',()=>command('back')),forward=action('›',()=>command('forward')),reload=action('↻',()=>command('reload')),address=el('span','web-address',a.url),original=action('Original page',()=>command('original')),save=action('Save a copy',async()=>{save.disabled=true;save.textContent='Saving…';try{await api.webSave(token);notify('Offline page saved to your library.');}finally{if(!disposed){save.disabled=false;save.textContent='Save a copy';}}});
 back.replaceChildren(glyph('chevronLeft'));forward.replaceChildren(glyph('chevronRight'));reload.replaceChildren(glyph('reload'));back.setAttribute('aria-label','Back on website');forward.setAttribute('aria-label','Forward on website');reload.setAttribute('aria-label','Reload website');save.title='Keep a readable offline copy of the loaded page';save.disabled=true;toolbar.append(back,forward,reload,address,original,save,action('Open in browser',()=>api.openLink(a.id)));slot.append(bookmarkVisual(a),notice);element.append(toolbar,slot);
 const rect=()=>{const r=slot.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};let resizeFrame=0;const observer=new ResizeObserver(()=>{if(opened&&!disposed&&!resizeFrame)resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;api.webBounds(token,rect());});});observer.observe(slot);
 const off=api.onWebState(state=>{if(disposed||state.token!==token)return;address.textContent=state.url||a.url;back.disabled=!state.back;forward.disabled=!state.forward;save.disabled=state.loading||!!state.error;notice.textContent=state.error?'This page could not load. Try “Original page” or reload.':'Opening website…';});
 requestAnimationFrame(()=>{if(disposed)return;api.webOpen(a.id,token,rect()).then(()=>{if(disposed){api.webClose(token);return;}opened=true;api.webBounds(token,rect());}).catch(e=>notice.textContent=e.message);});
 return {element,dispose(){disposed=true;observer.disconnect();cancelAnimationFrame(resizeFrame);off();api.webClose(token);element.remove();}};
}
function initBookmarks(){api.onLinkInfo(({id,info})=>applyBookmarkInfo(id,info));api.onWebClose(()=>{if(!$('#preview').hidden)closePreview();});}
