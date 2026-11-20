// The infinite view is a justified wall of items that wraps on both axes, so
// there is no edge to reach. The navigation panels stay above it: items pass
// behind them while panning. Motion is 1:1 with the pointer or trackpad and
// coasts briefly when released, like a native scroll view.
const InfiniteCanvas=(()=>{
 const MIN_ZOOM=0.45, MAX_ZOOM=2.6;
 let root=null,strip=null,pages=[],items=[];
 let active=false,pageWidth=1000,sourceHeight=0,hasBuilt=false;
 // Offsets are measured in screen pixels. paint() wraps them by the scaled
 // page size, which keeps drag and trackpad motion exactly 1:1 at every zoom.
 let offsetX=0,offsetY=0,zoom=1,dragging=false,dragStart=null,lastMove=null,moved=false,samples=[];
 let momentumFrame=0,vx=0,vy=0;
 let returnView='all',builtFor='',returnState=null,resizeTimer=0;

 const mod=(value,span)=>((value%span)+span)%span;
 const clampZoom=value=>Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,value));
  // A fling follows the speed of the last ~90 ms, not the whole drag: using
  // total displacement made even a slow 100 px drag coast over 1000 px.
  const releaseVelocity=(points,axis)=>{
   if(!points||points.length<2)return 0;
   const last=points.at(-1),first=points.find(point=>last.time-point.time<=90)||points[0];
   const elapsed=last.time-first.time;
   return elapsed>0?(last[axis]-first[axis])/elapsed*1000:0;
  };
  const projectMomentum=velocity=>Math.max(-3000,Math.min(3000,velocity))/1000*0.93/(1-0.93);

 function makePage(page){
  const source=[];
  let row=[],total=0;
  const flush=()=>{
   if(!row.length)return;
   // Scale the row to fill the page exactly, which is what makes it justified.
   // The 3px gaps are part of the page width, otherwise neighbouring pages
   // would overlap by the total gap width.
   const gaps=(row.length-1)*3;
   const scale=Math.max(0,(pageWidth-gaps))/total;
   const line=el('div','infinite-row');
   for(const entry of row){
    const node=el('div','infinite-item');
    node.dataset.id=entry.asset.id;
    node.style.width=Math.max(1,entry.width*scale)+'px';
    node.tabIndex=-1;
    node.setAttribute('role','option');
    node.setAttribute('aria-selected','false');
    node.setAttribute('aria-label',entry.asset.name);
    node.append(thumb(entry.asset,'infinite-thumb'));
    if(showFileNamesEnabled())node.append(el('span','infinite-name',entry.asset.name));
    node.title=entry.asset.name;
    line.append(node);
   }
   source.push(line);
   row=[];total=0;
  };
  for(const asset of items){
   const width=Math.max(0.4,asset.aspectRatio||1)*172;
   row.push({asset,width});
   total+=width;
   if(total>=pageWidth)flush();
  }
  flush();
  if(!source.length)source.push(el('div','infinite-row'));
  for(const line of source)page.append(line);

  // Measure the real row pitch instead of assuming it. The wall repeats every
  // sourceHeight pixels; if the CSS row height ever changes, the wrap still
  // stays seamless.
  const first=source[0].offsetHeight;
  const measured=source.length>1?source[1].offsetTop-source[0].offsetTop:first;
  const pitch=measured>4?measured:172;
  sourceHeight=Math.max(1,pitch*source.length);
  page.style.width=pageWidth+'px';

  // One copy above and enough below to cover the window at the smallest zoom,
  // so the copy that scrolls in is always identical to the one that left.
  const groups=2+Math.max(1,Math.ceil(innerHeight/Math.max(1,sourceHeight*MIN_ZOOM)));
  for(let i=0;i<groups-1;i++){
   const clone=source.map(line=>line.cloneNode(true));
   if(i===0)page.prepend(...clone);
   else page.append(...clone);
  }
  page.style.height=(groups*sourceHeight)+'px';
  return page;
 }

 function build(){
  if(!root||!strip)return;
  // Rebuilding while more of the library loads must not teleport the wall:
  // keep the same fraction of the old and new scaled tiling.
  const oldSpanX=pageWidth*zoom,oldSpanY=Math.max(1,sourceHeight)*zoom;
  const fx=oldSpanX?offsetX/oldSpanX:0,fy=oldSpanY?offsetY/oldSpanY:0;
  // Wide enough that three pages cover the window even at the smallest zoom.
  pageWidth=Math.max(innerWidth/MIN_ZOOM+4,900);
  items=assets.filter(a=>!a.trash);
  builtFor=itemsSignature();
  strip.replaceChildren();
  pages=[];
  for(const at of [-pageWidth,0,pageWidth]){
   const page=el('div','infinite-page');
   page.style.transform=`translateX(${at}px)`;
   // Attach before filling so row pitch can be measured from real layout.
   strip.append(page);pages.push(page);
   makePage(page);
  }
  if(hasBuilt){offsetX=fx*pageWidth*zoom;offsetY=fy*Math.max(1,sourceHeight)*zoom;}
  hasBuilt=true;
  syncSelection();
  paint();
 }
 function itemsSignature(){return assets.filter(a=>!a.trash).map(a=>a.id).join(',')+'|'+Math.max(innerWidth/MIN_ZOOM+4,900)+'|'+showFileNamesEnabled();}

 function paint(){
  if(!strip)return;
  const spanX=Math.max(1,pageWidth*zoom),spanY=Math.max(1,sourceHeight*zoom);
  const wrapX=mod(offsetX,spanX),wrapY=mod(offsetY,spanY);
  strip.style.transform=`translate3d(${-wrapX}px, ${-(sourceHeight*zoom+wrapY)}px, 0) scale(${zoom})`;
 }

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
  // The gallery is hidden behind the wall but stays in the accessibility tree.
  // Sync it whenever the mode changes so leaving the wall restores the library
  // instead of leaving it inert (and unclickable) afterwards.
  if(typeof SidebarUI!=='undefined')SidebarUI.syncAccessibility();
  if(!active){clearTimeout(resizeTimer);stopMomentum();dragging=false;dragStart=null;root.classList.remove('dragging');}
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

 function scope(){return items.slice();}
 function syncSelection(ids,focusId){
  if(!root)return;
  const chosen=ids||(typeof selection!=='undefined'?selection.ids:new Set());
  const focus=focusId!==undefined?focusId:(typeof selected!=='undefined'?selected:null);
  for(const node of root.querySelectorAll('.infinite-item')){
   const on=chosen.has(node.dataset.id);
   node.classList.toggle('selected',on);
   node.classList.toggle('focused',on&&node.dataset.id===focus);
   node.setAttribute('aria-selected',String(on));
  }
 }
 function bestRect(id){
  let best=null,bestScore=Infinity;
  for(const node of root.querySelectorAll('.infinite-item')){
   if(node.dataset.id!==id)continue;
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
  for(const node of root.querySelectorAll('.infinite-item')){
   if(node.dataset.id!==selected)continue;
   const r=node.getBoundingClientRect();
   const score=Math.abs(r.left+r.width/2-innerWidth/2)+Math.abs(r.top+r.height/2-innerHeight/2);
   if(score<bestScore){bestScore=score;best=node;}
  }
  if(!best)return;
  // Keyboard navigation centres an item that moved off-screen; returning from
  // the viewer must not shift the wall beyond the exact restore.
  const r=best.getBoundingClientRect();
  const margin=16;
  if(center&&(r.left<margin||r.right>innerWidth-margin||r.top<margin||r.bottom>innerHeight-margin)){
   offsetX-=innerWidth/2-(r.left+r.width/2);
   offsetY-=innerHeight/2-(r.top+r.height/2);
   paint();
  }
  best.focus({preventScroll:true});
 }
 // Arrow-key navigation follows the wall layout rather than the hidden
 // gallery: lateral keys walk a row, vertical keys pick the nearest column in
 // the neighbouring row.
 function wallLayout(){
  const page=pages[1]||pages[0];
  if(!page)return [];
  return [...page.querySelectorAll('.infinite-row')].map(row=>({
   items:[...row.querySelectorAll('.infinite-item')].map(node=>({id:node.dataset.id,x:node.offsetLeft+node.offsetWidth/2}))
  })).filter(row=>row.items.length);
 }
 function moveSelection(direction){
  if(!items.length)return null;
  const layout=wallLayout();
  if(!layout.length)return null;
  const currentId=typeof selected!=='undefined'?selected:null;
  let rowIndex=-1,column=-1;
  if(currentId)outer:for(let r=0;r<layout.length;r++)for(let c=0;c<layout[r].items.length;c++)
   if(layout[r].items[c].id===currentId){rowIndex=r;column=c;break outer;}
  if(rowIndex<0){rowIndex=0;column=0;}
  const row=layout[rowIndex];
  if(direction==='right'){
   if(column+1<row.items.length)return row.items[column+1].id;
   return layout[(rowIndex+1)%layout.length].items[0]?.id||null;
  }
  if(direction==='left'){
   if(column>0)return row.items[column-1].id;
   const previous=layout[(rowIndex-1+layout.length)%layout.length];
   return previous.items[previous.items.length-1]?.id||null;
  }
  const target=layout[(rowIndex+(direction==='down'?1:-1)+layout.length)%layout.length];
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
  offsetX=state.offsetX;offsetY=state.offsetY;
  paint();
  // If the opened item is still on screen, leave the wall exactly where it
  // was. Only nudge it back when it drifted out of view.
  const rect=bestRect(state.id);
  if(!rect)return;
  const margin=24;
  const onScreen=rect.right>margin&&rect.left<innerWidth-margin&&rect.bottom>margin&&rect.top<innerHeight-margin;
  if(onScreen)return;
  offsetX-=innerWidth/2-(rect.left+rect.width/2);
  offsetY-=innerHeight/2-(rect.top+rect.height/2);
  paint();
 }

  // Zoom around a screen point, keeping whatever is under it in place. The
  // same helper serves ctrl/pinch wheel and the keyboard zoom shortcuts.
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
   // Thumbnails are plain images; without this a real mouse drag starts the
   // browser's native image drag and the wall stops receiving pointer moves.
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
   // Both axes are screen pixels: the transform translates in screen space.
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
    // A click only picks the item. Opening is a deliberate double-click or
    // Space, exactly as it is in the library grid.
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
  // Capture can be lost when a native drag or another window takes the
  // pointer. The window fallback releases the wall instead of leaving it
  // stuck in the dragging state.
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
    paint();
   }
  },{passive:false});
  // Resizing fires continuously while the window is dragged. Rebuilding the
  // three tiled pages re-creates thousands of nodes, so wait until the drag
  // settles instead of doing it on every frame.
  addEventListener('resize',()=>{
   if(!active)return;
   clearTimeout(resizeTimer);
   resizeTimer=setTimeout(()=>{resizeTimer=0;if(active)build();},150);
  });
 }

 return {init,show,toggle,start,exit,scope,rememberPreview,restorePreview,syncSelection,focusSelected,moveSelection,zoomBy(factor,reset=false){if(!active)return;zoomTo(reset?1:zoom*factor,innerWidth/2,innerHeight/2);},get active(){return active;},get returnView(){return returnView;},get state(){return {offsetX,offsetY,zoom,pageWidth,sourceHeight};}};
})();
window.InfiniteCanvas=InfiniteCanvas;
