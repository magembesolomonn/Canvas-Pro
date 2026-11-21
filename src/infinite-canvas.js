const InfiniteCanvas=(()=>{
  const MIN_ZOOM=0.45, MAX_ZOOM=2.6;
  const ROW_PITCH=172, ROW_GAP=3, OVERSCAN=320;
  let root=null,strip=null,pages=[],rowModels=[],layoutCache=[];
  let active=false,pageWidth=1000,sourceHeight=0,groups=1,hasBuilt=false;
  let offsetX=0,offsetY=0,zoom=1,dragging=false,dragStart=null,lastMove=null,moved=false,samples=[];
  let momentumFrame=0,paintFrame=0,vx=0,vy=0;
  let returnView='all',builtFor='',returnState=null,resizeTimer=0;
  const mountedRows=new Map();
  const nodesById=new Map();
  let selectionSnapshot=new Set(),focusSnapshot=null;

  const mod=(value,span)=>((value%span)+span)%span;
  const clampZoom=value=>Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,value));
   const releaseVelocity=(points,axis)=>{
    if(!points||points.length<2)return 0;
    const last=points.at(-1),first=points.find(point=>last.time-point.time<=90)||points[0];
    const elapsed=last.time-first.time;
    return elapsed>0?(last[axis]-first[axis])/elapsed*1000:0;
   };
  const projectMomentum=velocity=>Math.max(-3000,Math.min(3000,velocity))/1000*0.93/(1-0.93);

  function buildModels(){
   const items=assets.filter(a=>!a.trash);
   rowModels=[];layoutCache=[];
   let row=[],total=0;
   const flush=()=>{
    if(!row.length)return;
    const gaps=(row.length-1)*ROW_GAP;
    const scale=Math.max(0,(pageWidth-gaps))/total;
    const model=[];
    let x=0;
    for(const entry of row){
     const width=entry.width*scale;
     model.push({asset:entry.asset,x,width});
     x+=width+ROW_GAP;
    }
    rowModels.push(model);
    layoutCache.push({items:model.map(item=>({id:item.asset.id,x:item.x}))});
    row=[];total=0;
   };
   for(const asset of items){
    const width=Math.max(0.4,asset.aspectRatio||1)*ROW_PITCH;
    row.push({asset,width});
    total+=width;
    if(total>=pageWidth)flush();
   }
   flush();
   if(!rowModels.length){rowModels.push([]);layoutCache.push({items:[]});}
   sourceHeight=Math.max(1,rowModels.length*ROW_PITCH);
  }

  function indexNode(id,node){
   let set=nodesById.get(id);
   if(!set){set=new Set();nodesById.set(id,set);}
   set.add(node);
  }
  function markSelection(node,id){
   const on=selectionSnapshot.has(id);
   node.classList.toggle('selected',on);
   node.classList.toggle('focused',on&&id===focusSnapshot);
   node.setAttribute('aria-selected',String(on));
  }
  function mountRow(key,p,g,r){
   if(mountedRows.has(key))return;
   const page=pages[p],model=rowModels[r];
   if(!page||!model)return;
   const row=el('div','infinite-row');
   row.style.top=(g*sourceHeight+r*ROW_PITCH)+'px';
   row.style.height=ROW_PITCH+'px';
   row.style.width=pageWidth+'px';
   for(const entry of model){
    const asset=entry.asset,node=el('div','infinite-item');
    node.dataset.id=asset.id;
    node.style.width=Math.max(1,entry.width)+'px';
    node.tabIndex=-1;
    node.setAttribute('role','option');
    node.setAttribute('aria-label',asset.name);
    node.title=asset.name;
    markSelection(node,asset.id);
    const image=thumb(asset,'infinite-thumb',false,'eager');
    node.classList.add('awaiting-thumbnail');
    const showThumbnail=()=>node.classList.remove('awaiting-thumbnail');
    image.addEventListener('error',showThumbnail,{once:true});
    image.decode().then(showThumbnail,()=>{
     if(image.complete&&!image.naturalWidth)showThumbnail();
    });
    node.append(image);
    if(showFileNamesEnabled())node.append(el('span','infinite-name',asset.name));
    row.append(node);
    indexNode(asset.id,node);
   }
   page.append(row);
   mountedRows.set(key,row);
  }
  function unmountRow(key){
   const row=mountedRows.get(key);
   if(!row)return;
   for(const node of row.children){
    const set=nodesById.get(node.dataset.id);
    if(set){set.delete(node);if(!set.size)nodesById.delete(node.dataset.id);}
   }
   row.remove();mountedRows.delete(key);
  }
  function clearRows(){
   for(const key of [...mountedRows.keys()])unmountRow(key);
  }

  function build(){
   if(!root||!strip)return;
   const oldSpanX=pageWidth*zoom,oldSpanY=Math.max(1,sourceHeight)*zoom;
   const fx=oldSpanX?offsetX/oldSpanX:0,fy=oldSpanY?offsetY/oldSpanY:0;
   clearRows();
   pageWidth=Math.max(innerWidth/MIN_ZOOM+4,900);
   buildModels();
   groups=2+Math.max(1,Math.ceil(innerHeight/Math.max(1,sourceHeight*MIN_ZOOM)));
   builtFor=itemsSignature();
   strip.replaceChildren();
   pages=[];
   for(const at of [-pageWidth,0,pageWidth]){
    const page=el('div','infinite-page');
    page.style.transform=`translateX(${at}px)`;
    page.style.width=pageWidth+'px';
    page.style.height=(groups*sourceHeight)+'px';
    strip.append(page);pages.push(page);
   }
   if(hasBuilt){offsetX=fx*pageWidth*zoom;offsetY=fy*Math.max(1,sourceHeight)*zoom;}
   hasBuilt=true;
   selectionSnapshot=new Set(typeof selection!=='undefined'?selection.ids:[]);
   focusSnapshot=typeof selected!=='undefined'?selected:null;
   paint();
  }
  function itemsSignature(){
   const n=assets.length;
   let trashed=0;
   for(const a of assets)if(a.trash)trashed++;
   return `${n}:${trashed}:${assets[0]?.id||''}:${assets[n-1]?.id||''}:${Math.max(innerWidth/MIN_ZOOM+4,900)}:${showFileNamesEnabled()}`;
  }

  function paint(){
   if(!strip)return;
   const spanX=Math.max(1,pageWidth*zoom),spanY=Math.max(1,sourceHeight*zoom);
   const wrapX=mod(offsetX,spanX),wrapY=mod(offsetY,spanY);
   strip.style.transform=`translate3d(${-wrapX}px, ${-(sourceHeight*zoom+wrapY)}px, 0) scale(${zoom})`;
   const want=new Set();
   const rowHeight=ROW_PITCH*zoom;
   const base=-sourceHeight*zoom-wrapY;
   for(let g=0;g<groups;g++){
    const groupY=base+g*sourceHeight*zoom;
    const first=Math.max(0,Math.floor((-OVERSCAN-rowHeight-groupY)/rowHeight)-1);
    const last=Math.min(rowModels.length-1,Math.ceil((innerHeight+OVERSCAN-groupY)/rowHeight)+1);
    for(let r=first;r<=last;r++)for(let p=0;p<pages.length;p++)want.add(p+':'+g+':'+r);
   }
   for(const key of [...mountedRows.keys()])if(!want.has(key))unmountRow(key);
   for(const key of want)mountRow(key,...key.split(':').map(Number));
  }
  function requestPaint(){
   if(paintFrame)return;
   paintFrame=requestAnimationFrame(()=>{paintFrame=0;if(active)paint();});
  }
  function cancelPaint(){cancelAnimationFrame(paintFrame);paintFrame=0;}

  function stopMomentum(){cancelAnimationFrame(momentumFrame);momentumFrame=0;vx=vy=0;}
  function glide(){
   vx*=0.93;vy*=0.93;
   offsetX+=vx;offsetY+=vy;
   paint();
   if(Math.abs(vx)+Math.abs(vy)>0.18)momentumFrame=requestAnimationFrame(glide);
   else momentumFrame=0;
  }
  function pushMomentum(x,y){vx=x;vy=y;if(!momentumFrame)momentumFrame=requestAnimationFrame(glide);}

  function show(activeView){
   active=!!activeView;
   if(!root)init();
   root.hidden=!active;
   document.body.classList.toggle('infinite-mode',active);
   if(typeof SidebarUI!=='undefined')SidebarUI.syncAccessibility();
   if(!active){clearTimeout(resizeTimer);stopMomentum();cancelPaint();dragging=false;dragStart=null;root.classList.remove('dragging');clearRows();}
   if(active&&builtFor!==itemsSignature())build();
   if(active)paint();
  }
  function start(){
   returnView=view==='infinite'?returnView:view;
   setView('infinite');
  }
  function toggle(){
   if(view==='infinite')setView(returnView||'all');
   else start();
  }
  function exit(){setView(returnView||'all');}

  function scope(){return assets.filter(a=>!a.trash).slice();}
  function syncSelection(ids,focusId){
   if(!root)return;
   const chosen=ids||(typeof selection!=='undefined'?selection.ids:new Set());
   const focus=focusId!==undefined?focusId:(typeof selected!=='undefined'?selected:null);
   const next=new Set(chosen);
   const changed=[];
   for(const id of selectionSnapshot)if(!next.has(id))changed.push(id);
   for(const id of next)if(!selectionSnapshot.has(id))changed.push(id);
   for(const id of changed){
    const nodes=nodesById.get(id);
    if(nodes)for(const node of nodes)markSelection(node,id);
   }
   if(focus!==focusSnapshot){
    for(const id of [focusSnapshot,focus]){
     if(id==null)continue;
     const nodes=nodesById.get(id);
     if(nodes)for(const node of nodes)node.classList.toggle('focused',next.has(id)&&id===focus);
    }
   }
   selectionSnapshot=next;focusSnapshot=focus;
  }
  function nodesFor(id){return [...(nodesById.get(id)||[])];}
  function bestRect(id){
   let best=null,bestScore=Infinity;
   for(const node of nodesFor(id)){
    const r=node.getBoundingClientRect();
    if(!r.width)continue;
    const score=Math.abs(r.left+r.width/2-innerWidth/2)+Math.abs(r.top+r.height/2-innerHeight/2);
    if(score<bestScore){bestScore=score;best=r;}
   }
   return best;
  }
  function focusSelected(center=false){
   if(!active||typeof selected==='undefined'||!selected)return;
   let best=null,bestScore=Infinity;
   for(const node of nodesFor(selected)){
    const r=node.getBoundingClientRect();
    const score=Math.abs(r.left+r.width/2-innerWidth/2)+Math.abs(r.top+r.height/2-innerHeight/2);
    if(score<bestScore){bestScore=score;best=node;}
   }
   if(!best)return;
   const r=best.getBoundingClientRect();
   const margin=16;
   if(center&&(r.left<margin||r.right>innerWidth-margin||r.top<margin||r.bottom>innerHeight-margin)){
    offsetX-=innerWidth/2-(r.left+r.width/2);
    offsetY-=innerHeight/2-(r.top+r.height/2);
    paint();
   }
   best.focus({preventScroll:true});
  }
  function wallLayout(){return layoutCache;}
  function moveSelection(direction){
   if(!layoutCache.length)return null;
   const dir=String(direction).startsWith('Arrow')?String(direction).slice(5).toLowerCase():direction;
   const layout=wallLayout();
   const currentId=typeof selected!=='undefined'?selected:null;
   let rowIndex=-1,column=-1;
   if(currentId)outer:for(let r=0;r<layout.length;r++)for(let c=0;c<layout[r].items.length;c++)
    if(layout[r].items[c].id===currentId){rowIndex=r;column=c;break outer;}
   if(rowIndex<0){rowIndex=0;column=0;}
   const row=layout[rowIndex];
   if(dir==='right'){
    if(column+1<row.items.length)return row.items[column+1].id;
    return layout[(rowIndex+1)%layout.length].items[0]?.id||null;
   }
   if(dir==='left'){
    if(column>0)return row.items[column-1].id;
    const previous=layout[(rowIndex-1+layout.length)%layout.length];
    return previous.items[previous.items.length-1]?.id||null;
   }
   const target=layout[(rowIndex+(dir==='down'?1:-1)+layout.length)%layout.length];
   if(!target)return null;
   const x=row.items[column]?.x??0;
   let best=target.items[0];
   for(const entry of target.items)if(Math.abs(entry.x-x)<Math.abs(best.x-x))best=entry;
   return best?.id||null;
  }

  function rememberPreview(id){
   if(!active)return;
   returnState={offsetX,offsetY,zoom,id};
   stopMomentum();
  }
  function restorePreview(){
   if(!active||!returnState)return;
   const state=returnState;returnState=null;
   zoom=state.zoom;
   offsetX=state.offsetX;
   offsetY=state.offsetY;
   paint();
   const rect=bestRect(state.id);
   if(!rect)return;
   const margin=24;
   const onScreen=rect.right>margin&&rect.left<innerWidth-margin&&rect.bottom>margin&&rect.top<innerHeight-margin;
   if(onScreen)return;
   offsetX-=innerWidth/2-(rect.left+rect.width/2);
   offsetY-=innerHeight/2-(rect.top+rect.height/2);
   paint();
  }

  function zoomTo(next,clientX,clientY){
   next=clampZoom(next);
   if(next===zoom)return;
   const spanX=Math.max(1,pageWidth*zoom),spanY=Math.max(1,sourceHeight*zoom);
   const wrapX=mod(offsetX,spanX),wrapY=mod(offsetY,spanY);
   const contentX=(clientX+wrapX)/zoom;
   const pageY=(clientY+sourceHeight*zoom+wrapY)/zoom;
   const nextSpanX=Math.max(1,pageWidth*next),nextSpanY=Math.max(1,sourceHeight*next);
   const wrapX2=mod(contentX*next-clientX,nextSpanX);
   const wrapY2=mod(pageY*next-sourceHeight*next-clientY,nextSpanY);
   offsetX=wrapX2+Math.round((offsetX-wrapX2)/nextSpanX)*nextSpanX;
   offsetY=wrapY2+Math.round((offsetY-wrapY2)/nextSpanY)*nextSpanY;
   zoom=next;
   paint();
  }
  function init(){
   root=el('div','infinite-view');root.id='infinite-view';root.hidden=true;
   root.tabIndex=-1;
   root.setAttribute('role','listbox');
   root.setAttribute('aria-label','Infinite canvas');
   strip=el('div','infinite-strip');
   const stage=el('div','infinite-stage');stage.append(strip);
   const exitButton=el('button','infinite-exit','Exit infinite canvas · Esc');
   exitButton.type='button';exitButton.onclick=exit;
   const hint=el('div','infinite-hint','Drag to roam · Scroll in any direction · ⌘/Ctrl + wheel to zoom · ⌥O returns');
   root.append(stage,exitButton,hint);
   document.body.append(root);

   stage.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    e.preventDefault();
    stopMomentum();
    dragStart={x:e.clientX,y:e.clientY,offsetX,offsetY,item:e.target.closest?.('.infinite-item')};
    lastMove=null;moved=false;dragging=true;samples=[];
    root.classList.add('dragging');
    try{stage.setPointerCapture(e.pointerId);}catch{}
   });
   stage.addEventListener('pointermove',e=>{
    if(!dragging||!dragStart)return;
    const dx=e.clientX-dragStart.x,dy=e.clientY-dragStart.y;
    if(!moved&&Math.abs(dx)+Math.abs(dy)>7)moved=true;
    const now=performance.now();
     samples.push({time:now,x:e.clientX,y:e.clientY});
     while(samples.length>2&&now-samples[0].time>90)samples.shift();
     lastMove={dx,dy,at:now};
    offsetX=dragStart.offsetX-dx;
    offsetY=dragStart.offsetY-dy;
    paint();
   });
   const endDrag=e=>{
    if(!dragging)return;
    dragging=false;
    root.classList.remove('dragging');
    try{stage.releasePointerCapture(e.pointerId);}catch{}
    if(moved&&lastMove&&performance.now()-lastMove.at<120)
     pushMomentum(-projectMomentum(releaseVelocity(samples,'x')),-projectMomentum(releaseVelocity(samples,'y')));
    else if(!moved&&dragStart?.item){
     select(dragStart.item.dataset.id);
    }
    dragStart=null;
   };
   stage.addEventListener('pointerup',endDrag);
   stage.addEventListener('pointercancel',endDrag);
   stage.addEventListener('dblclick',e=>{
    const item=e.target.closest?.('.infinite-item')||document.elementFromPoint(e.clientX,e.clientY)?.closest?.('.infinite-item');
    if(!item)return;
    e.preventDefault();
    stopMomentum();
    select(item.dataset.id);
    openPreview(scope());
   });
   addEventListener('pointerup',endDrag);
   addEventListener('pointercancel',endDrag);
   stage.addEventListener('contextmenu',e=>{
    const item=e.target.closest?.('.infinite-item');
    if(!item)return;
    e.preventDefault();
    stopMomentum();
    select(item.dataset.id);
    safe(()=>api.contextMenu([item.dataset.id]));
   });
   stage.addEventListener('wheel',e=>{
    e.preventDefault();stopMomentum();
    const unit=e.deltaMode===1?16:e.deltaMode===2?innerHeight:1;
    if(e.ctrlKey||e.metaKey){
     zoomTo(zoom*Math.exp(-e.deltaY*unit*0.006),e.clientX,e.clientY);
    }else{
     let dx=e.deltaX*unit,dy=e.deltaY*unit;
     if(e.shiftKey&&!dx){dx=dy;dy=0;}
     offsetX+=dx;offsetY+=dy;
     pushMomentum(dx*0.12,dy*0.12);
     requestPaint();
    }
   },{passive:false});
   addEventListener('resize',()=>{
    if(!active)return;
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>{resizeTimer=0;if(active)build();},150);
   });
  }

  return {init,show,toggle,start,exit,scope,rememberPreview,restorePreview,syncSelection,focusSelected,moveSelection,
   model(){return {rows:rowModels.length,pitch:ROW_PITCH,pageWidth,sourceHeight,groups,pageHeight:groups*sourceHeight,period:rowModels.length,mounted:mountedRows.size,effectiveRows:groups*rowModels.length};},
   zoomBy(factor,reset=false){if(!active)return;zoomTo(reset?1:zoom*factor,innerWidth/2,innerHeight/2);},get active(){return active;},get returnView(){return returnView;},get state(){return {offsetX,offsetY,zoom,pageWidth,sourceHeight};}};
 })();
 window.InfiniteCanvas=InfiniteCanvas;
