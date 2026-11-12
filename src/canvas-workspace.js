const CanvasWorkspace=(()=>{
 const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 // Where a flick would come to rest. Apple's projection: the distance a
 // gesture keeps travelling as it slows, so the glide ends where the hand
 // was heading rather than where it let go. The rate is gentler than a
 // scroll's, so a board glides a little further and then settles.
 const projectMomentum=(velocity,rate=0.97)=>(velocity/1000)*rate/(1-rate);
 const releaseVelocity=(samples,axis)=>{
  if(!samples||samples.length<2)return 0;
  const last=samples.at(-1);
  const first=samples.find(sample=>last.time-sample.time<=90)||samples[0];
  const elapsed=last.time-first.time;
  if(elapsed<=0)return 0;
  return (last[axis]-first[axis])/elapsed*1000;
 };
 class Workspace{
  constructor(){this.boards=[];this.folderRecords=[];this.documents=new Map();this.doc=null;this.nodes=new Map();this.tool='select';this.frame=0;this.generation=0;this.space=false;this.activePlayer=null;this.trayTab='files';this.traySelection=new Set();this.trayNodes=new Map();this.momentum=null;this.momentumFrame=0;}
  init(){this.root=$('#canvas-workspace');this.viewport=$('#canvas-viewport');this.world=$('#canvas-world');this.overview=$('#canvas-overview');this.context=this.overview.getContext('2d');this.frameNode=el('div','canvas-selection-frame');for(const corner of ['nw','ne','sw','se']){const handle=el('span','canvas-resize-handle handle-'+corner);handle.dataset.resize=corner;handle.setAttribute('aria-label','Resize selection');this.frameNode.append(handle);}this.world.append(this.frameNode);
   for(const b of document.querySelectorAll('[data-canvas-tool]')){if(!b.textContent)b.append(glyph({select:'cursor',hand:'hand',text:'text',rectangle:'rectangle',ellipse:'ellipse',draw:'pencil',arrow:'arrow',sticky:'sticky',list:'list'}[b.dataset.canvasTool]));b.onclick=()=>this.setTool(b.dataset.canvasTool);}
   this.selectionTools=el('div','canvas-selection-tools');
   this.selectionTools.setAttribute('role','toolbar');this.selectionTools.setAttribute('aria-label','Selection actions');
   this.selectionTools.hidden=true;this.viewport.append(this.selectionTools);
   this.snapGuides={x:el('div','canvas-snap-guide snap-x'),y:el('div','canvas-snap-guide snap-y')};
   for(const guide of Object.values(this.snapGuides)){guide.hidden=true;this.viewport.append(guide);}
   $('#canvas-save-files').onclick=()=>CanvasExport.choose(true);
   $('#canvas-export').onclick=()=>CanvasExport.choose();
   $('#canvas-undo').append(glyph('undo'));$('#canvas-redo').append(glyph('redo'));$('#canvas-undo').onclick=()=>this.undo();$('#canvas-redo').onclick=()=>this.undo(true);$('#canvas-zoom-in').onclick=()=>this.zoom(1.25);$('#canvas-zoom-out').onclick=()=>this.zoom(.8);$('#canvas-fit').onclick=()=>this.fit();$('#canvas-library').onclick=event=>this.toggleTray($('#canvas-tray').hidden,event.detail>0?event.currentTarget:null);$('#canvas-empty-library').onclick=event=>this.toggleTray(true,event.detail>0?event.currentTarget:null);$('#canvas-tray-close').onclick=()=>this.toggleTray(false);
   $('#canvas-tray').addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    this.toggleTray(false);
   });
$('#canvas-import').onclick=()=>importDialog();$('#canvas-retry').onclick=()=>safe(()=>this.flushAll());$('#add-canvas').onclick=()=>this.choose({forceNew:true});
   this.viewport.addEventListener('dblclick',e=>this.doubleClick(e));this.viewport.addEventListener('pointerdown',e=>this.pointerDown(e));this.viewport.addEventListener('pointermove',e=>this.pointerMove(e));this.viewport.addEventListener('pointerup',e=>this.pointerUp(e));this.viewport.addEventListener('pointercancel',()=>this.cancelGesture());this.viewport.addEventListener('wheel',e=>this.wheel(e),{passive:false});this.viewport.oncontextmenu=e=>{e.preventDefault();const world=this.point(e),hit=this.doc?.index.hit(world.x,world.y);if(hit&&!this.doc.selection.has(hit.id))this.select([hit.id]);this.showItemMenu(e);};
   this.viewport.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';};this.viewport.ondrop=e=>this.drop(e,this.doc?.board.id,this.point(e));this.resizeObserver=new ResizeObserver(()=>this.schedule());this.resizeObserver.observe(this.viewport);document.addEventListener('keyup',e=>{if(e.code==='Space'&&this.space){e.preventDefault();this.space=false;this.viewport.classList.remove('space-pan');if(view==='canvas'&&!this.spaceDragged&&!this.gesture)this.previewSelected();}});window.addEventListener('blur',()=>{this.space=false;this.viewport.classList.remove('space-pan');if(this.gesture)this.finishGesture();});
   $('#canvas-dialog-cancel').onclick=()=>$('#canvas-dialog').close();$('#canvas-target').onchange=()=>this.updateDialog();$('#canvas-dialog-form').onsubmit=e=>{e.preventDefault();safe(()=>this.submitDialog());};let searchTimer;$('#canvas-tray-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>this.refreshTray(),70);};for(const b of document.querySelectorAll('[data-canvas-tab]'))b.onclick=()=>{this.trayTab=b.dataset.canvasTab;this.refreshTray();};$('#canvas-tray-scroll').onscroll=()=>this.renderTray();
   api.onCanvasFlush(async token=>{const surfaces=[$('main'),$('.sidebar'),$('#inspector')],previous=surfaces.map(node=>node.inert);try{this.finishGesture();document.activeElement?.blur();for(const surface of surfaces)surface.inert=true;await Promise.all([this.flushAll(),NotesWorkspace.flush()]);surfaces.forEach((node,i)=>node.inert=previous[i]);api.canvasFlushed(token,null);}catch(error){surfaces.forEach((node,i)=>node.inert=previous[i]);api.canvasFlushed(token,error.message);}});
  }
  setList(boards,folders){this.boards=boards||this.boards;this.folderRecords=folders||this.folderRecords;}
  renderNav(){const nav=$('#canvas-navigation');nav.replaceChildren();for(const board of this.boards){const button=navButton(board.name,'canvas',board.itemCount||0,view==='canvas'&&this.doc?.board.id===board.id,()=>safe(()=>this.open(board.id)));button.dataset.canvasId=board.id;button.firstChild.replaceWith(WorkbenchUI.icon('canvas:'+board.id,'canvas'));button.oncontextmenu=e=>{e.preventDefault();safe(()=>api.canvasMenu(board.id));};button.ondragover=e=>{e.preventDefault();e.stopPropagation();button.classList.add('canvas-drop-target');};button.ondragleave=()=>button.classList.remove('canvas-drop-target');button.ondrop=e=>{button.classList.remove('canvas-drop-target');this.drop(e,board.id,null,true);};nav.append(button);}}
  updateSummary(board){const i=this.boards.findIndex(b=>b.id===board.id);if(i<0)this.boards.push(board);else this.boards[i]={...this.boards[i],...board};const doc=this.documents.get(board.id);if(doc)doc.board={...doc.board,...board};this.renderNav();if(view==='canvas'&&this.doc?.board.id===board.id)$('#view-title').textContent=board.name;}
  makeDocument(board){return {board,items:new Map(board.items.map(item=>[item.id,item])),index:new CanvasGeometry.SpatialIndex(board.items),camera:{...board.viewport},selection:new Set(),undo:[],redo:[],pending:new Map(),removed:new Set(),cameraDirty:false,savePromise:null,error:'',maxZ:board.items.reduce((n,item)=>Math.max(n,item.z),0)};}
  async open(id){
   const generation=++this.generation,previousView=view;
   rememberGalleryPosition();
   await hydrateCatalog();
   if(generation!==this.generation||view!==previousView)return;this.stopMomentum();this.finishGesture();this.finishText();if(!$('#preview').hidden)closePreview();if(this.doc)safe(()=>this.flush(this.doc));stopHover();this.stopPlayer();this.clearNodes();this.doc=null;pendingGalleryPosition=null;view='canvas';collection=null;selection.clear();selected=null;visible=[];this.show(true);$('#view-title').textContent=this.boards.find(b=>b.id===id)?.name||'Canvas';let doc=this.documents.get(id);if(!doc){const board=await api.canvasGet(id);if(generation!==this.generation||view!=='canvas')return;doc=this.makeDocument(board);this.documents.set(id,doc);}if(generation!==this.generation||view!=='canvas')return;this.clearNodes();this.doc=doc;doc.used=Date.now();this.setTool('select');this.reconcileAssets();this.renderNav();renderNav();this.renderInspector();this.refreshTray();this.schedule();this.viewport.focus({preventScroll:true});this.trimDocuments();}
  trimDocuments(){if(this.documents.size<=3)return;for(const [id,doc]of [...this.documents].sort((a,b)=>(a[1].used||0)-(b[1].used||0))){if(this.documents.size<=3)break;if(doc===this.doc||doc.pending.size||doc.removed.size||doc.cameraDirty||doc.savePromise)continue;this.documents.delete(id);}}
  show(show){if(show){if(!$('#notes-workspace').hidden)safe(NotesWorkspace.flush);NotesWorkspace.show(false);}this.root.hidden=!show;document.body.classList.toggle('canvas-active',show);$('#gallery').hidden=show;$('.filter-bar').hidden=show;$('#tags-bar').hidden=show||view!=='tags';$('#empty').hidden=show||visible.length>0;this.root.hidden=!show;const hint=$('footer>span:last-child');hint.textContent=show?'Space + drag · Pan    Pinch · Zoom    ⌘Z · Undo':'Space Preview    ← → Navigate    ⌘V Paste';}
  leave(){this.generation++;this.stopMomentum();this.finishGesture();this.finishText();if(this.doc)safe(()=>this.flush(this.doc));this.stopPlayer();this.show(false);this.clearNodes();this.doc=null;}
  render(){if(!this.doc)return;this.show(true);$('#view-title').textContent=this.doc.board.name;this.reconcileAssets();this.renderInspector();this.refreshTray();this.schedule();}
  reconcileAssets(){if(!this.doc)return;for(const item of this.doc.items.values()){if(item.assetId&&!assetById.has(item.assetId))item.assetId=null;if(item.collectionId&&!this.folderRecords.some(f=>f.id===item.collectionId))item.collectionId=null;}for(const [id,node]of this.nodes){const item=this.doc.items.get(id);if(item&&(node._asset!==item.assetId||node._folder!==item.collectionId||item.kind==='collection')){this.removeNode(id);}}}
  clearNodes(){for(const id of [...this.nodes.keys()])this.removeNode(id);this.trayNodes.clear();$('#canvas-tray-items')?.replaceChildren();if(this.overviewHasMarks){
    this.context.clearRect(0,0,this.overview.width,this.overview.height);
    this.overviewHasMarks=false;
   }}
  removeNode(id){if(this.activePlayer?.nodeId===id)this.stopPlayer();this.nodes.get(id)?.remove();this.nodes.delete(id);}
  stopPlayer(){this.activePlayer?.dispose();this.activePlayer=null;}
  setTool(tool){this.tool=tool;for(const b of document.querySelectorAll('[data-canvas-tool]'))b.setAttribute('aria-pressed',String(b.dataset.canvasTool===tool));this.viewport.dataset.tool=tool;}
  rect(){return this.viewport.getBoundingClientRect();}
  local(e){const r=this.rect();return {x:e.clientX-r.x,y:e.clientY-r.y};}
  point(e){return CanvasGeometry.screenToWorld(this.local(e),this.doc?.camera||{x:0,y:0,zoom:1});}
  inset(){return $('#canvas-tray').hidden?0:Math.min($('#canvas-tray').offsetWidth+24,this.rect().width/2);}
  center(){const r=this.rect();return CanvasGeometry.screenToWorld({x:(r.width+this.inset())/2,y:r.height/2},this.doc.camera);}
  schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;if(view==='canvas'&&this.doc)this.paint();});}
  paint(){const doc=this.doc,r=this.rect();if(r.width<1||r.height<1)return;const camera=doc.camera,z=camera.zoom;this.world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${z})`;this.viewport.style.backgroundSize=(24*z)+'px '+(24*z)+'px';this.viewport.style.backgroundPosition=camera.x+'px '+camera.y+'px';$('#canvas-fit').textContent=(z<.1?(z*100).toFixed(1):Math.round(z*100))+'%';const area={x:(-camera.x-80)/z,y:(-camera.y-80)/z,width:(r.width+160)/z,height:(r.height+160)/z},candidates=doc.index.query(area),cx=(r.width/2-camera.x)/z,cy=(r.height/2-camera.y)/z;
   const detailed=candidates.filter(item=>item.data.width*z>=18||doc.selection.has(item.id)).sort((a,b)=>Number(doc.selection.has(b.id))-Number(doc.selection.has(a.id))||((a.data.x-cx)**2+(a.data.y-cy)**2)-((b.data.x-cx)**2+(b.data.y-cy)**2)).slice(0,160),ids=new Set(detailed.map(item=>item.id));for(const id of this.nodes.keys())if(!ids.has(id))this.removeNode(id);for(const item of detailed){let node=this.nodes.get(item.id);if(!node){node=this.makeNode(item);this.nodes.set(item.id,node);this.world.insertBefore(node,this.frameNode);}const d=item.data,key=[d.x,d.y,d.width,d.height,item.z].join(':');if(node._rect!==key){node._rect=key;Object.assign(node.style,{left:d.x+'px',top:d.y+'px',width:d.width+'px',height:d.height+'px',zIndex:String(item.z)});}node.classList.toggle('selected',doc.selection.has(item.id));node.style.setProperty('--canvas-scale',String(z));this.paintNode(node,item);}
   this.paintOverview(candidates,ids,r);this.paintFrame();$('#canvas-empty').hidden=doc.items.size>0||!$('#canvas-tray').hidden;this.updateSaveState();this.sendVisible();
  }
  paintOverview(items, detailed, bounds) {
   const hasMarks = items.some(item => !detailed.has(item.id));
   if (!hasMarks && !this.overviewHasMarks) return;

   const ratio = Math.min(2, devicePixelRatio || 1);
   const width = Math.ceil(bounds.width * ratio), height = Math.ceil(bounds.height * ratio);
   const resized = this.overview.width !== width || this.overview.height !== height;
   if (resized) {
    this.overview.width = width;
    this.overview.height = height;
   }

   const context = this.context, camera = this.doc.camera;
   context.setTransform(ratio, 0, 0, ratio, 0, 0);
   if (!resized) context.clearRect(0, 0, bounds.width, bounds.height);
   this.overviewHasMarks = hasMarks;
   if (!hasMarks) return;
   for (const item of items) {
    if (detailed.has(item.id)) continue;
    const data = item.data;
    context.fillStyle = item.kind === 'shape' ? data.color : this.doc.selection.has(item.id) ? '#9a9da3' : '#4b5058';
    const x = data.x * camera.zoom + camera.x, y = data.y * camera.zoom + camera.y;
    const w = Math.max(1, data.width * camera.zoom), h = Math.max(1, data.height * camera.zoom);
    if (item.kind === 'shape' && data.shape === 'ellipse') {
     context.beginPath();
     context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
     context.fill();
    } else context.fillRect(x, y, w, h);
   }
  }
  paintFrame(){const items=[...this.doc.selection].map(id=>this.doc.items.get(id)).filter(Boolean),b=CanvasGeometry.bounds(items);this.frameNode.hidden=!b;
   this.selectionTools.hidden=!b||!!this.gesture||!!this.editing;
   if(!b)return;
   const locked=items.some(item=>item.data.locked);
   this.frameNode.classList.toggle('locked',locked);
   if(!this.selectionTools.hidden){
    const {camera}=this.doc,r=this.rect();
    const x=b.x*camera.zoom+camera.x,y=b.y*camera.zoom+camera.y,bottom=y+b.height*camera.zoom;
    const offscreen=x>r.width||x+b.width*camera.zoom<0||y>r.height||bottom<0;
    this.selectionTools.hidden=offscreen;
    if(!offscreen){
     this.selectionTools.style.left=Math.max(8,Math.min(r.width-this.selectionTools.offsetWidth-8,x))+'px';
     this.selectionTools.style.top=Math.max(8,Math.min(r.height-38,y>45?y-37:bottom+8))+'px';
    }
   }Object.assign(this.frameNode.style,{left:b.x+'px',top:b.y+'px',width:b.width+'px',height:b.height+'px'});this.frameNode.style.setProperty('--canvas-scale',String(this.doc.camera.zoom));}
  playNode(item,node,hover=false){if(this.activePlayer?.nodeId===item.id){if(!hover)this.activePlayer.hover=false;return;}const a=assetById.get(item.assetId);if(!a)return;this.stopPlayer();const player=createPlayer(a,{compact:true,muted:hover,scrubHover:false});player.nodeId=item.id;player.hover=hover;this.activePlayer=player;node.querySelector('.board-node-content').append(player.element);}
  makeNode(item){const node=el('div','board-node board-'+(item.kind==='text'?'text-item':item.kind));node.dataset.itemId=item.id;node.setAttribute('role','group');node._asset=item.assetId;node._folder=item.collectionId;const content=el('div','board-node-content');node.append(content);if(item.kind==='asset'){const a=assetById.get(item.assetId);if(a){const image=kind(a)==='link'?bookmarkVisual(a):thumb(a,'',true);if(image.tagName==='IMG')image.addEventListener('load',()=>{const current=this.doc?.items.get(item.id);if(!current?.data.autoSize||current.data.locked||!node.isConnected||!image.naturalWidth||!image.naturalHeight)return;current.data={...current.data,height:Math.max(8,Math.min(100000,current.data.width*image.naturalHeight/image.naturalWidth)),autoSize:false};this.doc.index.update(current);this.stage(this.doc,[current]);if(this.doc.items.size===1&&!this.gesture)this.fit([current.id]);this.renderInspector();this.schedule();});content.append(image);node.setAttribute('aria-label',a.name);const label=el('span','board-file-label',this.assetLabel(a));node.append(label);if(['video','audio'].includes(kind(a))){const play=el('button','board-play');play.append(glyph('play'));play.title='Play '+kind(a);play.setAttribute('aria-label','Play '+a.name);play.onclick=e=>{e.stopPropagation();this.stopPlayer();this.playNode(item,node,false);};node.append(play);if(kind(a)==='video'){node.onpointerenter=e=>{if(e.pointerType!=='touch'&&!this.gesture)this.playNode(item,node,true);};node.onpointerleave=()=>{if(this.activePlayer?.nodeId===item.id&&this.activePlayer.hover&&!this.gesture)this.stopPlayer();};}}if(a.trash)node.append(el('span','board-file-state','In Trash'));}else{content.append(glyph('file'),el('span','',item.data.label||'Missing file'));content.classList.add('board-missing');}}
   else if(item.kind==='collection'){const folder=this.folderRecords.find(f=>f.id===item.collectionId);content.classList.add('board-folder');content.append(glyph('folder'),el('strong','',folder?.name||item.data.label||'Collection'),el('span','',folder?((navStats?.members.get(folder.name)||0)+' files · Double-click to open'):'Collection removed'));node.setAttribute('aria-label',folder?.name||'Removed collection');}
   else if(['draw','arrow'].includes(item.data.shape)){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');
    svg.classList.add('board-stroke');path.setAttribute('fill','none');path.setAttribute('stroke-width','3');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');
    svg.append(path);content.append(svg);node.setAttribute('aria-label',item.data.shape==='draw'?'Drawing':'Arrow');
   }
   else{const text=el('div','board-text');text.setAttribute('role','textbox');text.setAttribute('aria-label',item.kind==='text'?'Canvas text':item.data.shape==='section'?'Section name':'Shape text');text.setAttribute('aria-multiline','true');text.spellcheck=false;content.append(text);text.oninput=()=>{const current=this.doc?.items.get(item.id);if(!current)return;if(!this.editing)this.editing={id:item.id,doc:this.doc,before:clone(current),element:text};current.data.text=text.innerText.slice(0,20000);this.fitText(current);if(['sticky','list'].includes(current.data.shape))current.data.height=Math.min(100000,Math.max(current.data.height,text.scrollHeight));this.doc.index.update(current);this.schedule();this.stage(this.doc,[current],[],false);const field=$('#inspector textarea[aria-label="Canvas text"]');if(this.doc.selection.size===1&&this.doc.selection.has(item.id)&&field&&document.activeElement!==field)field.value=current.data.text;};text.onblur=()=>{if(this.editing?.element===text)this.finishText();};text.onpaste=e=>{e.preventDefault();e.stopPropagation();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));};text.onkeydown=e=>{if(item.data.shape==='list'&&e.key==='Enter'&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){
     e.preventDefault();document.execCommand('insertText',false,'\n• ');return;
   }if(e.key==='Escape'||e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.stopPropagation();text.blur();this.viewport.focus();}};}
   return node;
  }
  assetLabel(asset){
    const info=asset.captureMetadata?.linkPreview;
    return (['movie','series'].includes(info?.type)&&info.title)||asset.name;
  }
  assetChanged(id){const a=assetById.get(id);if(!a)return;const tray=this.trayNodes.get(id)?.querySelector('.canvas-tray-name');if(tray)tray.textContent=a.name;this.schedule();}
  paintNode(node,item){const d=item.data;if(item.kind==='asset'){const a=assetById.get(item.assetId),label=node.querySelector('.board-file-label');if(a&&label&&label.textContent!==this.assetLabel(a))label.textContent=this.assetLabel(a);}node.setAttribute('aria-selected',String(this.doc.selection.has(item.id)));node.classList.toggle('board-locked',!!d.locked);if(item.kind==='text'||item.kind==='shape'){const content=node.firstChild,text=content.querySelector('.board-text');
    if(!text){
     const path=content.querySelector('path');
     if(path&&(node._stroke!==d.points||node._strokeSize!==d.width+':'+d.height)){
      path.setAttribute('d',CanvasGeometry.strokePath(d));node._stroke=d.points;node._strokeSize=d.width+':'+d.height;
     }
     if(path)path.setAttribute('stroke',d.color);
     return;
    }
    content.className='board-node-content'+(item.kind==='shape'?' board-shape board-shape-'+d.shape:'');content.style.backgroundColor=item.kind==='shape'&&!['line','section'].includes(d.shape)?d.color:'transparent';content.style.color=item.kind==='shape'?d.color:'inherit';text.style.color=item.kind==='text'?(d.color.toLowerCase()==='#e8e8e8'?'var(--text)':d.color):d.textColor;text.style.fontSize=d.fontSize+'px';if(document.activeElement!==text&&text.textContent!==d.text)text.textContent=d.text;}}
  select(ids){if(!this.doc)return;this.finishText();const groups=new Set(ids.map(id=>this.doc.items.get(id)?.data.groupId).filter(Boolean));
   this.doc.selection=new Set(ids.filter(id=>this.doc.items.has(id)));
   if(groups.size)for(const item of this.doc.items.values())if(groups.has(item.data.groupId))this.doc.selection.add(item.id);this.renderInspector();this.schedule();}
  selectedItems(){return this.doc?[...this.doc.selection].map(id=>this.doc.items.get(id)).filter(Boolean):[];}
  paintSelectionTools(items){
   this.selectionTools.replaceChildren();
   if(!items.length)return;
   const locked=items.some(item=>item.data.locked);
   this.selectionTools.append(action(locked?'Unlock':'Lock',()=>this.setLocked(!locked)));
   if(locked)return;
   if(items.length===1&&this.hasText(items[0]))this.selectionTools.append(action('Edit text',()=>this.editText(items[0].id)));
   const grouped=items.some(item=>item.data.groupId);
   const units=this.selectionUnits();
   if(grouped)this.selectionTools.append(action('Ungroup',()=>this.setGroup(null)));
   if(units.length>=2){
    this.selectionTools.append(action('Group',()=>this.setGroup(crypto.randomUUID())));
    const align=el('select');align.setAttribute('aria-label','Align and distribute selection');
    for(const [value,label] of [['','Align…'],['left','Align left'],['center','Align horizontal centers'],['right','Align right'],['top','Align top'],['middle','Align vertical centers'],['bottom','Align bottom'],['horizontal','Distribute horizontal gaps'],['vertical','Distribute vertical gaps']]){
     if(units.length<3&&['horizontal','vertical'].includes(value))continue;
     const option=el('option','',label);option.value=value;align.append(option);
    }
    align.onchange=()=>{if(align.value)this.alignSelection(align.value);};
    this.selectionTools.append(align);
   }
   if(!items.some(item=>item.data.shape==='section'))this.selectionTools.append(action('Section',()=>this.addSection()));
  }
  setLocked(locked){
   this.commit(this.selectedItems().map(item=>({...clone(item),data:{...item.data,locked}})),[],null,true);
  }
  setGroup(groupId){
   const items=this.selectedItems();
   if(items.some(item=>item.data.locked))return;
   this.commit(items.map(item=>({...clone(item),data:{...item.data,groupId}})));
  }
  selectionUnits(){
   const units=new Map();
   for(const item of this.selectedItems()){
    const key=item.data.groupId||item.id;
    if(!units.has(key))units.set(key,[]);
    units.get(key).push(item);
   }
   return [...units.values()].map(items=>({items,bounds:CanvasGeometry.bounds(items)}));
  }
  alignSelection(mode){
   const units=this.selectionUnits();
   if(units.length<2||units.some(unit=>unit.items.some(item=>item.data.locked)))return;
   const b=CanvasGeometry.bounds(units.map(unit=>unit.bounds));
   const distribute=['horizontal','vertical'].includes(mode);
   if(distribute&&units.length<3)return;
   const axis=['left','center','right','horizontal'].includes(mode)?'x':'y',size=axis==='x'?'width':'height';
   const fraction=['center','middle'].includes(mode)?.5:['right','bottom'].includes(mode)?1:0;
   if(distribute)units.sort((a,b)=>a.bounds[axis]-b.bounds[axis]);
   const gap=(b[size]-units.reduce((n,unit)=>n+unit.bounds[size],0))/(units.length-1);
   let position=b[axis];
   const changes=units.flatMap(unit=>{
    const target=distribute?position:b[axis]+(b[size]-unit.bounds[size])*fraction;
    position+=unit.bounds[size]+gap;
    const delta=target-unit.bounds[axis];
    return unit.items.map(item=>({...clone(item),data:{...item.data,[axis]:item.data[axis]+delta}}));
   });
   this.commit(changes);
  }
  addSection(point=this.center()){
   const items=this.selectedItems();
   if(items.some(item=>item.data.locked||item.data.shape==='section'))return;
   const bounds=CanvasGeometry.bounds(items),groupId=crypto.randomUUID();
   const area=bounds?{x:bounds.x-24,y:bounds.y-42,width:bounds.width+48,height:bounds.height+66}:{...point,width:360,height:240};
   const item={id:crypto.randomUUID(),kind:'shape',assetId:null,collectionId:null,z:-1,data:{...area,shape:'section',text:'Untitled section',fontSize:18,color:'#727988',textColor:'#929baa',groupId}};
   for(const other of this.doc.items.values())item.z=Math.min(item.z,other.z-1);
   this.commit([item,...items.map(old=>({...clone(old),data:{...old.data,groupId}}))]);
   this.select([item.id]);
   requestAnimationFrame(()=>this.editText(item.id,true));
  }
  snapshot(items){return new Map(items.map(item=>[item.id,clone(item)]));}
  history(doc,before,after){if([...new Set([...before.keys(),...after.keys()])].every(id=>same(before.get(id),after.get(id))))return;const bytes=JSON.stringify([...before.values()]).length+JSON.stringify([...after.values()]).length;doc.undo.push({before,after,bytes});let total=doc.undo.reduce((n,h)=>n+(h.bytes||0),0);while(doc.undo.length>1&&(doc.undo.length>100||total>12*1024*1024))total-=doc.undo.shift().bytes||0;doc.redo=[];}
  fitText(item){if(item.kind!=='text')return;const d=item.data,probe=el('div','board-text text-measure');probe.textContent=d.text||' ';Object.assign(probe.style,{fontSize:d.fontSize+'px',width:'max-content',maxWidth:'1000px',minWidth:'24px'});document.body.append(probe);const rect=probe.getBoundingClientRect();d.width=Math.max(24,Math.ceil(rect.width)+1);d.height=Math.max(16,Math.ceil(rect.height));probe.remove();}
  commit(upserts=[],removes=[],before=null,allowLocked=false){const doc=this.doc;if(!doc)return;
   if(!allowLocked){upserts=upserts.filter(item=>!doc.items.get(item.id)?.data.locked);removes=removes.filter(id=>!doc.items.get(id)?.data.locked);}
   if(!upserts.length&&!removes.length)return;
   before=before||this.snapshot([...upserts.map(i=>doc.items.get(i.id)),...removes.map(id=>doc.items.get(id))].filter(Boolean));for(const item of upserts){const old=before.get(item.id);if(item.kind==='text'&&(!old||old.data.text!==item.data.text||old.data.fontSize!==item.data.fontSize))this.fitText(item);doc.items.set(item.id,item);doc.index.update(item);doc.maxZ=Math.max(doc.maxZ,item.z);}for(const id of removes){doc.items.delete(id);doc.index.remove(id);doc.selection.delete(id);}this.history(doc,before,this.snapshot(upserts));this.stage(doc,upserts,removes);this.renderInspector();this.schedule();}
  stage(doc,upserts=[],removes=[],camera=true){for(const item of upserts){doc.pending.set(item.id,clone(item));doc.removed.delete(item.id);}for(const id of removes){doc.pending.delete(id);doc.removed.add(id);}if(!upserts.length&&!removes.length&&camera)doc.cameraDirty=true;doc.error='';clearTimeout(doc.saveTimer);doc.saveTimer=setTimeout(()=>safe(()=>this.flush(doc)),250);this.markDirty();this.updateSaveState();}
  markDirty(){const dirty=[...this.documents.values()].some(d=>d.pending.size||d.removed.size||d.cameraDirty||d.savePromise)||!!this.gesture?.mutated;if(dirty!==this.dirtyFlag){this.dirtyFlag=dirty;api.canvasDirty(dirty);}}
  async flush(doc){clearTimeout(doc.saveTimer);if(doc.savePromise){await doc.savePromise;if(doc.savePromise||doc.pending.size||doc.removed.size||doc.cameraDirty)return this.flush(doc);return;}if(!doc.pending.size&&!doc.removed.size&&!doc.cameraDirty)return;const upsert=[...doc.pending.values()].map(clone),remove=[...doc.removed],camera=doc.cameraDirty?{...doc.camera}:null;doc.pending.clear();doc.removed.clear();doc.cameraDirty=false;doc.savePromise=api.canvasApply(doc.board.id,{upsert,remove,...(camera?{viewport:camera}:{})}).then(board=>{doc.error='';this.updateSummary(board);}).catch(error=>{if(/Canvas not found/i.test(error.message||'')){this.forget(doc);return;}for(const item of upsert)if(!doc.pending.has(item.id)&&!doc.removed.has(item.id))doc.pending.set(item.id,item);for(const id of remove)if(!doc.pending.has(id))doc.removed.add(id);if(camera)doc.cameraDirty=true;doc.error=error.message;throw error;});this.markDirty();try{await doc.savePromise;}finally{doc.savePromise=null;this.markDirty();this.updateSaveState();}if(doc.pending.size||doc.removed.size||doc.cameraDirty)return this.flush(doc);}
  // The canvas was deleted while its board was open. There is nothing left to
  // save, so the board is let go instead of failing every save and keeping
  // the app from closing.
  forget(doc){doc.pending.clear();doc.removed.clear();doc.cameraDirty=false;doc.error='';this.documents.delete(doc.board.id);this.boards=this.boards.filter(board=>board.id!==doc.board.id);if(this.doc===doc){this.doc=null;setView('all');}this.renderNav();this.updateSaveState();}
  async flushAll(){this.finishGesture();this.finishText();for(const doc of this.documents.values())await this.flush(doc);this.markDirty();}
  updateSaveState(){if(!this.doc)return;const d=this.doc;$('#canvas-save-state').textContent=this.gesture?.mutated?'Editing…':d.error?'Not saved':d.savePromise||d.pending.size||d.removed.size||d.cameraDirty?'Saving…':'Saved';$('#canvas-retry').hidden=!d.error;$('#canvas-undo').disabled=!d.undo.length;$('#canvas-redo').disabled=!d.redo.length;}
  undo(redo=false){const doc=this.doc;if(!doc)return;this.finishText();const source=redo?doc.redo:doc.undo,target=redo?doc.undo:doc.redo,change=source.pop();if(!change)return;target.push(change);const wanted=redo?change.after:change.before,other=redo?change.before:change.after,upserts=[...wanted.values()].map(clone),removes=[...other.keys()].filter(id=>!wanted.has(id));for(const item of upserts){doc.items.set(item.id,item);doc.index.update(item);}for(const id of removes){doc.items.delete(id);doc.index.remove(id);}doc.selection=new Set(upserts.map(i=>i.id));this.stage(doc,upserts,removes);this.renderInspector();this.schedule();}
  removeSelected(){const ids=[...this.doc.selection];if(ids.length)this.commit([],ids);}
  duplicate(items=this.selectedItems(),point=null){if(!items.length)return;const b=CanvasGeometry.bounds(items),offset=point?{x:point.x-b.x,y:point.y-b.y}:{x:30,y:30};const groups=new Map();
   for(const {data} of items)if(data.groupId&&!groups.has(data.groupId))groups.set(data.groupId,crypto.randomUUID());
   const copies=items.slice().sort((a,b)=>a.z-b.z).map(old=>({...clone(old),id:crypto.randomUUID(),z:++this.doc.maxZ,data:{...old.data,x:old.data.x+offset.x,y:old.data.y+offset.y,locked:false,groupId:groups.get(old.data.groupId)}}));this.commit(copies);this.select(copies.map(i=>i.id));}
  add(kind,point=this.center(),shape='rectangle'){const item={id:crypto.randomUUID(),kind,z:++this.doc.maxZ,assetId:null,collectionId:null,data:{x:point.x,y:point.y,width:kind==='text'?300:240,height:kind==='text'?90:160,text:kind==='text'?'Your idea here':shape==='sticky'?'Your note':shape==='list'?'• First item':'',fontSize:kind==='text'?28:18,color:kind==='text'?'#e8e8e8':'#e4d6b6',textColor:'#252525',shape,label:''}};this.commit([item]);this.select([item.id]);return item;}
  hasText(item){return item.kind==='text'||item.kind==='shape'&&!['draw','arrow'].includes(item.data.shape);}
  doubleClick(e){
   if(!this.doc||this.tool!=='select'||e.target.closest('button,.player-controls,[data-resize],[contenteditable="true"]'))return;
   const point=this.point(e),node=e.target.closest('[data-item-id]');
   const item=node?this.doc.items.get(node.dataset.itemId):this.doc.index.hit(point.x,point.y);
   if(!item)return;
   e.preventDefault();
   if(this.hasText(item))this.editText(item.id);
   else if(item.kind==='asset')this.previewItem(item.id);
   else if(item.kind==='collection'){
    const folder=this.folderRecords.find(folder=>folder.id===item.collectionId);
    if(folder)setView('folder',folder.name);
   }
  }
  editText(id,selectAll=false){
   const item=this.doc?.items.get(id);
   if(!item||item.data.locked||!this.hasText(item)||this.editing?.id===id)return;
   if(!this.nodes.has(id))this.paint();
   const text=this.nodes.get(id)?.querySelector('.board-text');if(!text)return;
   this.finishText();
   this.editing={id,doc:this.doc,before:clone(item),element:text};
   text.contentEditable='true';text.focus({preventScroll:true});
   const range=document.createRange();range.selectNodeContents(text);
   if(!selectAll)range.collapse(false);
   else if(item.data.shape==='list'&&text.firstChild?.nodeType===Node.TEXT_NODE&&text.textContent.startsWith('• '))range.setStart(text.firstChild,2);
   const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
   this.schedule();
  }
  finishText(){
   const edit=this.editing;if(!edit)return;
   this.editing=null;edit.element.contentEditable='false';
   const item=edit.doc.items.get(edit.id);
   if(item)this.history(edit.doc,new Map([[edit.id,edit.before]]),this.snapshot([item]));
   this.updateSaveState();this.schedule();
  }
  pointerDown(e){if(!this.doc||this.gesture||e.button>1||e.target.closest('button,input,textarea,[contenteditable="true"],.player-controls'))return;e.preventDefault();this.viewport.focus({preventScroll:true});this.finishText();this.stopMomentum();const point=this.point(e),local=this.local(e),resize=e.target.closest('[data-resize]')?.dataset.resize,hit=this.doc.index.hit(point.x,point.y);this.viewport.setPointerCapture(e.pointerId);
   if(e.button===1||this.tool==='hand'||this.space){this.gesture={type:'pan',pointer:e.pointerId,start:local,camera:{...this.doc.camera},mutated:false,samples:[{x:local.x,y:local.y,time:e.timeStamp}]};return;}
   if(resize&&this.doc.selection.size&&!this.selectedItems().some(item=>item.data.locked)){const items=this.selectedItems();this.gesture={type:'resize',pointer:e.pointerId,start:point,bounds:CanvasGeometry.bounds(items),before:this.snapshot(items),corner:resize,mutated:false};return;}
   if(this.tool==='text'){const item=this.add('text',point);this.setTool('select');requestAnimationFrame(()=>this.editText(item.id,true));return;}
   if(['sticky','list'].includes(this.tool)){
    const shape=this.tool,item=this.add('shape',point,shape);
    this.setTool('select');requestAnimationFrame(()=>this.editText(item.id,true));return;
   }
   if(['draw','arrow'].includes(this.tool)){
    const item={id:crypto.randomUUID(),kind:'shape',assetId:null,collectionId:null,z:++this.doc.maxZ,data:{x:point.x,y:point.y,width:8,height:8,shape:this.tool,color:'#55a2f5',points:[[.5,.5]]}};
    this.doc.items.set(item.id,item);this.doc.index.update(item);this.doc.selection=new Set([item.id]);
    this.gesture={type:'stroke',pointer:e.pointerId,item,points:[point],mutated:true};
    this.markDirty();this.schedule();return;
   }
   if(this.tool==='rectangle'||this.tool==='ellipse'){const item={id:crypto.randomUUID(),kind:'shape',assetId:null,collectionId:null,z:++this.doc.maxZ,data:{x:point.x,y:point.y,width:8,height:8,shape:this.tool,text:'',fontSize:18,color:'#e4d6b6',textColor:'#252525',label:''}};this.doc.items.set(item.id,item);this.doc.index.update(item);this.doc.selection=new Set([item.id]);this.gesture={type:'create',pointer:e.pointerId,start:point,item,mutated:true};this.markDirty();this.schedule();return;}
   if(hit){if(e.metaKey||e.ctrlKey){const selected=new Set(this.doc.selection);if(selected.has(hit.id)){
    for(const id of selected)if(id===hit.id||hit.data.groupId&&this.doc.items.get(id)?.data.groupId===hit.data.groupId)selected.delete(id);
   }else selected.add(hit.id);this.select([...selected]);}else if(e.shiftKey)this.select([...this.doc.selection,hit.id]);else if(!this.doc.selection.has(hit.id))this.select([hit.id]);if(this.doc.selection.has(hit.id)&&!this.selectedItems().some(item=>item.data.locked))this.gesture={type:'move',pointer:e.pointerId,start:point,before:this.snapshot(this.selectedItems()),bounds:CanvasGeometry.bounds(this.selectedItems()),mutated:false};}
   else{const base=e.shiftKey||e.metaKey?new Set(this.doc.selection):new Set();this.select([...base]);this.gesture={type:'marquee',pointer:e.pointerId,start:local,base};$('#canvas-marquee').hidden=false;}
  }
  pointerMove(e){const g=this.gesture;if(!g||g.pointer!==e.pointerId||!this.doc)return;const doc=this.doc,point=this.point(e),local=this.local(e);if(g.type==='pan'){const dx=local.x-g.start.x,dy=local.y-g.start.y;doc.camera={...g.camera,x:Math.max(-1e9,Math.min(1e9,g.camera.x+dx)),y:Math.max(-1e9,Math.min(1e9,g.camera.y+dy))};if(Math.abs(dx)+Math.abs(dy)>3){g.mutated=true;this.spaceDragged=true;doc.cameraDirty=true;this.markDirty();}g.samples.push({x:local.x,y:local.y,time:e.timeStamp});if(g.samples.length>8)g.samples.shift();}
   else if(g.type==='move'){let dx=point.x-g.start.x,dy=point.y-g.start.y;if(!g.mutated&&(Math.abs(dx)+Math.abs(dy))*doc.camera.zoom<3)return;g.mutated=true;this.viewport.classList.add('moving-items');
    const snapped=this.snapToItems(g,{...g.bounds,x:g.bounds.x+dx,y:g.bounds.y+dy},e.altKey);
    dx+=snapped.dx;dy+=snapped.dy;
    for(const [id,old]of g.before){const item=doc.items.get(id);if(!item)continue;item.data={...item.data,x:old.data.x+dx,y:old.data.y+dy};doc.index.update(item);}this.markDirty();}
   else if(g.type==='resize'){
    const b=g.bounds,west=g.corner.includes('w'),north=g.corner.includes('n'),dx=point.x-g.start.x,dy=point.y-g.start.y;
    let w=Math.max(16,b.width+(west?-dx:dx)),h=Math.max(16,b.height+(north?-dy:dy));
    if(!e.shiftKey){const scale=Math.max(w/b.width,h/b.height);w=b.width*scale;h=b.height*scale;}
    const corner={x:west?b.x+b.width-w:b.x+w,y:north?b.y+b.height-h:b.y+h,width:0,height:0};
    const {dx:snapX,dy:snapY,guides}=this.snapToItems(g,corner,e.altKey);
    if(e.shiftKey){
     w=Math.max(16,w+(west?-snapX:snapX));h=Math.max(16,h+(north?-snapY:snapY));
    }else{
     const axis=guides.x!==undefined&&(guides.y===undefined||Math.abs(snapX)<=Math.abs(snapY))?'x':'y';
     const scale=axis==='x'?(w+(west?-snapX:snapX))/b.width:(h+(north?-snapY:snapY))/b.height;
     const fitted=Math.max(16/b.width,16/b.height,scale);
     w=b.width*fitted;h=b.height*fitted;
    }
    if(Math.abs((west?b.x+b.width-w:b.x+w)-guides.x)>.001)delete guides.x;
    if(Math.abs((north?b.y+b.height-h:b.y+h)-guides.y)>.001)delete guides.y;
    this.showSnapGuides(guides);
    const x=west?b.x+b.width-w:b.x,y=north?b.y+b.height-h:b.y,sx=w/b.width,sy=h/b.height;for(const [id,old]of g.before){const item=doc.items.get(id);if(!item)continue;item.data={...old.data,autoSize:false,x:x+(old.data.x-b.x)*sx,y:y+(old.data.y-b.y)*sy,width:Math.max(8,Math.min(100000,old.data.width*sx)),height:Math.max(8,Math.min(100000,old.data.height*sy))};if(item.kind==='text')item.data.fontSize=Math.max(8,Math.min(200,old.data.fontSize*Math.min(sx,sy)));doc.index.update(item);}g.mutated=true;this.markDirty();}
   else if(g.type==='stroke'){
    const d=g.item.data,last=g.points.at(-1);
    if(d.shape==='arrow'){
     const snap=this.snapToItems(g,{...point,width:0,height:0},e.altKey);
     g.points[1]={x:point.x+snap.dx,y:point.y+snap.dy};

    }
    else if(Math.hypot(point.x-last.x,point.y-last.y)*doc.camera.zoom>=2){
     if(g.points.length<2048)g.points.push(point);else g.points[g.points.length-1]=point;
    }
    const box=CanvasGeometry.bounds(g.points.map(p=>({...p,width:0,height:0})));
    const pad=d.shape==='arrow'?12:4,width=box.width+2*pad,height=box.height+2*pad;
    if(width<=100000&&height<=100000){
     Object.assign(d,{x:box.x-pad,y:box.y-pad,width,height,points:g.points.map(p=>[(p.x-box.x+pad)/width,(p.y-box.y+pad)/height])});
     doc.index.update(g.item);
    }
   }
   else if(g.type==='create'){const item=g.item;item.data={...item.data,x:Math.min(g.start.x,point.x),y:Math.min(g.start.y,point.y),width:Math.max(8,Math.abs(point.x-g.start.x)),height:Math.max(8,Math.abs(point.y-g.start.y))};doc.index.update(item);}
   else if(g.type==='marquee'){const x=Math.min(g.start.x,local.x),y=Math.min(g.start.y,local.y),width=Math.abs(local.x-g.start.x),height=Math.abs(local.y-g.start.y);Object.assign($('#canvas-marquee').style,{left:x+'px',top:y+'px',width:width+'px',height:height+'px'});const a=CanvasGeometry.screenToWorld({x,y},doc.camera),items=doc.index.query({...a,width:width/doc.camera.zoom,height:height/doc.camera.zoom});const ids=new Set([...g.base,...items.map(item=>item.id)]),groups=new Set([...ids].map(id=>doc.items.get(id)?.data.groupId).filter(Boolean));
    if(groups.size)for(const item of doc.items.values())if(groups.has(item.data.groupId))ids.add(item.id);
    doc.selection=ids;}
   this.schedule();
  }
  snapToItems(gesture,rect,bypass){
   if(bypass)return {dx:0,dy:0,guides:{}};
   if(!gesture.snapTargets){
    const r=this.rect(),{camera,index}=this.doc;
    const visible={...CanvasGeometry.screenToWorld({x:0,y:0},camera),width:r.width/camera.zoom,height:r.height/camera.zoom};
    gesture.snapTargets=index.query(visible).filter(item=>!gesture.before?.has(item.id)&&gesture.item?.id!==item.id);
   }
   return CanvasGeometry.snap(rect,gesture.snapTargets,8/this.doc.camera.zoom);
  }
  showSnapGuides(guides={}){
   const cam=this.doc.camera;
   for(const [axis,guide] of Object.entries(this.snapGuides)){
    guide.hidden=guides[axis]===undefined;
    if(!guide.hidden)guide.style[axis==='x'?'left':'top']=(guides[axis]*cam.zoom+cam[axis])+'px';
   }
  }
  pointerUp(e){
   if(this.gesture&&this.gesture.pointer!==e.pointerId)return;
   // Pointer moves can be coalesced. Commit the release position for item drags.
   if(this.gesture?.type==='move'||this.gesture?.type==='stroke')this.pointerMove(e);
   const gesture=this.gesture;
   this.finishGesture();
   // A flick keeps travelling. The glide carries the hand's speed, so there
   // is no seam between the drag and the movement that follows it.
   if(gesture?.type==='pan'&&gesture.mutated)this.glide(gesture);
   try{this.viewport.releasePointerCapture(e.pointerId);}catch{}
  }
  // The glide ends where the hand was heading, and it can be caught at any
  // point: grabbing the canvas stops it and continues from where it is.
  glide(gesture){
   if(!this.doc||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
   const velocityX=releaseVelocity(gesture.samples,'x'),velocityY=releaseVelocity(gesture.samples,'y');
   const speed=Math.hypot(velocityX,velocityY);
   if(speed<140)return;
   const travelX=projectMomentum(velocityX),travelY=projectMomentum(velocityY);
   if(Math.abs(travelX)+Math.abs(travelY)<8)return;
   const start={x:this.doc.camera.x,y:this.doc.camera.y};
   const targetX=start.x+travelX,targetY=start.y+travelY;
   const omega=0.028;
   this.momentum={targetX,targetY,differenceX:start.x-targetX,differenceY:start.y-targetY,velocityX:velocityX/1000,velocityY:velocityY/1000,omega,started:performance.now()};
   const step=()=>{
    const glide=this.momentum;
    if(!glide||!this.doc)return;
    const elapsed=performance.now()-glide.started;
    const x=glide.targetX+(glide.differenceX+(glide.velocityX+glide.omega*glide.differenceX)*elapsed)*Math.exp(-glide.omega*elapsed);
    const y=glide.targetY+(glide.differenceY+(glide.velocityY+glide.omega*glide.differenceY)*elapsed)*Math.exp(-glide.omega*elapsed);
    this.doc.camera={...this.doc.camera,x,y};
    this.stage(this.doc);
    this.schedule();
    if(Math.abs(glide.targetX-x)<0.4&&Math.abs(glide.targetY-y)<0.4&&elapsed>120){this.momentum=null;return;}
    this.momentumFrame=requestAnimationFrame(step);
   };
   this.momentumFrame=requestAnimationFrame(step);
  }
  stopMomentum(){
   if(this.momentumFrame)cancelAnimationFrame(this.momentumFrame);
   this.momentumFrame=0;this.momentum=null;
  }
  finishGesture(){const g=this.gesture;if(!g||!this.doc)return;this.gesture=null;this.showSnapGuides();this.viewport.classList.remove('moving-items');if(this.activePlayer?.hover&&!this.nodes.get(this.activePlayer.nodeId)?.matches(':hover'))this.stopPlayer();$('#canvas-marquee').hidden=true;if(g.type==='move'||g.type==='resize'){if(g.mutated)this.commit([...g.before.keys()].map(id=>this.doc.items.get(id)).filter(Boolean),[],g.before);}else if(g.type==='create'){if(g.item.data.width<16&&g.item.data.height<16){g.item.data.width=240;g.item.data.height=160;}this.commit([g.item],[],new Map());this.setTool('select');}else if(g.type==='stroke'){
    const arrow=g.item.data.shape==='arrow';
    const [start,end]=g.points;
    if(!arrow||end&&Math.hypot(end.x-start.x,end.y-start.y)*this.doc.camera.zoom>=3)this.commit([g.item],[],new Map());
    else{this.doc.items.delete(g.item.id);this.doc.index.remove(g.item.id);this.doc.selection.delete(g.item.id);}
    if(arrow)this.setTool('select');
   }else if(g.type==='pan'&&g.mutated)this.stage(this.doc);this.markDirty();this.renderInspector();this.schedule();}
  cancelGesture(){const g=this.gesture;if(!g||!this.doc)return;if(g.before)for(const item of g.before.values()){this.doc.items.set(item.id,clone(item));this.doc.index.update(this.doc.items.get(item.id));}if(['create','stroke'].includes(g.type)){this.doc.items.delete(g.item.id);this.doc.index.remove(g.item.id);this.doc.selection.delete(g.item.id);}if(g.type==='pan'){this.doc.camera=g.camera;this.stage(this.doc);}this.gesture=null;this.showSnapGuides();this.viewport.classList.remove('moving-items');$('#canvas-marquee').hidden=true;this.markDirty();this.schedule();}
  wheel(e){if(!this.doc)return;e.preventDefault();if(this.gesture)return;this.stopMomentum();const doc=this.doc;if(e.ctrlKey||e.metaKey)doc.camera=CanvasGeometry.zoomAt(doc.camera,this.local(e),doc.camera.zoom*Math.exp(-e.deltaY*.008));else{doc.camera.x=Math.max(-1e9,Math.min(1e9,doc.camera.x-(e.shiftKey?e.deltaY:e.deltaX)));doc.camera.y=Math.max(-1e9,Math.min(1e9,doc.camera.y-(e.shiftKey?0:e.deltaY)));}this.stage(doc);this.schedule();}
  zoom(factor){if(!this.doc)return;this.stopMomentum();const r=this.rect();this.doc.camera=CanvasGeometry.zoomAt(this.doc.camera,{x:r.width/2,y:r.height/2},this.doc.camera.zoom*factor);this.stage(this.doc);this.schedule();}
  fit(ids=null){if(!this.doc)return;this.stopMomentum();const r=this.rect(),items=ids?ids.map(id=>this.doc.items.get(id)).filter(Boolean):[...this.doc.items.values()];const inset=this.inset();this.doc.camera=CanvasGeometry.fit(items,r.width-inset,r.height);this.doc.camera.x+=inset;this.stage(this.doc);this.schedule();}
  keydown(e){if(view!=='canvas'||!this.doc||!$('#preview').hidden||e.target.closest?.('dialog'))return false;const command=e.metaKey||e.ctrlKey,key=e.key.toLowerCase(),typing=e.target.closest?.('input,textarea,select,[contenteditable="true"],.canvas-selection-tools');if(typing)return false;let handled=true;if(command&&key==='a')this.select([...this.doc.items.keys()]);else if(command&&key==='z'){if(!e.repeat)this.undo(e.shiftKey);}else if(command&&key==='g'){if(e.shiftKey)this.setGroup(null);else if(this.selectionUnits().length>=2)this.setGroup(crypto.randomUUID());}else if(command&&key==='d'){if(!e.repeat)this.duplicate();}else if(command&&key==='c'){if(!e.repeat&&this.doc.selection.size)safe(()=>api.canvasClipboardWrite(this.selectedItems()));}else if(command&&key==='0')this.fit();else if(command&&['+','='].includes(key))this.zoom(1.2);else if(command&&key==='-')this.zoom(1/1.2);else if(command&&['f','k'].includes(key)){this.toggleTray(true);$('#canvas-tray-search').focus();}else if(['Backspace','Delete'].includes(e.key)){if(!e.repeat)this.removeSelected();}else if(e.key==='Escape'){if(this.gesture)this.cancelGesture();else{this.select([]);this.setTool('select');}}else if(e.code==='Space'){if(!e.repeat){this.space=true;this.spaceDragged=false;this.viewport.classList.add('space-pan');}}else if(!command&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){const n=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-n:e.key==='ArrowRight'?n:0,dy=e.key==='ArrowUp'?-n:e.key==='ArrowDown'?n:0;this.commit(this.selectedItems().map(item=>({...clone(item),data:{...item.data,x:item.data.x+dx,y:item.data.y+dy}})));}else if(!command&&['v','h','t','r','o','p','a','n','l'].includes(key)){this.setTool({v:'select',h:'hand',t:'text',r:'rectangle',o:'ellipse',p:'draw',a:'arrow',n:'sticky',l:'list'}[key]);}else if(e.key==='Enter'){const item=this.selectedItems()[0];if(this.doc.selection.size===1&&['text','shape'].includes(item?.kind))this.editText(item.id);else this.previewSelected();}else handled=false;if(handled)e.preventDefault();return handled;}
  revealPreviewAsset(id){
   const doc=this.doc;if(!doc)return;
   const item=[...doc.items.values()].find(item=>item.assetId===id);if(!item)return;
   const {x,y,width,height}=item.data,{zoom}=doc.camera,rect=this.rect(),inset=this.inset();
   const centerX=doc.camera.x+(x+width/2)*zoom,centerY=doc.camera.y+(y+height/2)*zoom;
   if(centerX>=inset&&centerX<=rect.width&&centerY>=0&&centerY<=rect.height)return;
   doc.camera.x+=(rect.width+inset)/2-centerX;
   doc.camera.y+=rect.height/2-centerY;
   this.stage(doc);this.schedule();
  }
  verticalPreviewNeighbor(id,pool,step){
   const items=[...this.doc.items.values()].filter(item=>item.assetId);
   const origin=items.find(item=>item.assetId===id)?.data;if(!origin)return id;
   const allowed=new Set(pool.map(asset=>asset.id));
   const x=origin.x+origin.width/2,y=origin.y+origin.height/2;
   let best=id,distance=Infinity;
   for(const {assetId,data:d} of items){
    if(assetId===id||!allowed.has(assetId))continue;
    const dy=(d.y+d.height/2-y)*step;if(dy<=0)continue;
    const score=dy+2*Math.abs(d.x+d.width/2-x);
    if(score<distance){best=assetId;distance=score;}
   }
   return best;
  }
  previewSelected(){const item=this.selectedItems().find(item=>item.kind==='asset'&&assetById.has(item.assetId));if(item)this.previewItem(item.id);}
  previewItem(id){const item=this.doc.items.get(id),a=assetById.get(item?.assetId);if(!a)return;this.finishGesture();this.stopPlayer();const chosen=this.selectedItems().filter(i=>i.assetId&&assetById.has(i.assetId)).map(i=>i.assetId);const ids=chosen.length>1&&chosen.includes(a.id)?chosen:[...this.doc.items.values()].map(i=>i.assetId).filter(id=>id&&assetById.has(id)&&!assetById.get(id).trash);if(!ids.includes(a.id))ids.unshift(a.id);selection.sync([...new Set(ids)]);selection.select(a.id);selected=a.id;openPreview([...new Set(ids)].map(id=>assetById.get(id)));}
  showItemMenu(e){$('#canvas-item-menu')?.remove();const menu=el('div','canvas-item-menu');menu.id='canvas-item-menu';menu.setAttribute('popover','auto');const count=this.doc.selection.size,point=this.point(e);const selected=this.selectedItems(),hasFiles=selected.some(item=>item.kind==='asset'&&assetById.has(item.assetId));const prefix=hasFiles?[[count>1?'Preview files':'Preview',()=>this.previewSelected()]]:count===1&&this.hasText(selected[0])&&!selected[0].data.locked?[['Edit text',()=>this.editText(selected[0].id)]]:count===1&&selected[0]?.collectionId?[['Open collection',()=>{const f=this.folderRecords.find(f=>f.id===selected[0].collectionId);if(f)setView('folder',f.name);}]]:[];const entries=count?[...prefix,['Duplicate',()=>this.duplicate()],['Bring to front',()=>this.commit(this.selectedItems().map(item=>({...clone(item),z:++this.doc.maxZ})))],['Send to back',()=>{let z=0;for(const item of this.doc.items.values())z=Math.min(z,item.z);z-=count;this.commit(this.selectedItems().map(item=>({...clone(item),z:z++})));}],['Remove from canvas',()=>this.removeSelected()]]:[['Add text',()=>{const item=this.add('text',point);requestAnimationFrame(()=>this.editText(item.id,true));}],['Named section',()=>this.addSection(point)],['Add rectangle',()=>this.add('shape',point)],['Add ellipse',()=>this.add('shape',point,'ellipse')],['Browse library',()=>this.toggleTray(true)],['Fit content',()=>this.fit()]];const dividerBefore=count?new Set(['Duplicate','Remove from canvas']):new Set(['Browse library']);for(const [label,fn]of entries){const button=action(label,()=>{menu.hidePopover();fn();});if(dividerBefore.has(label))button.classList.add('menu-separator-before');menu.append(button);}document.body.append(menu);menu.showPopover();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,e.clientX))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,e.clientY))+'px';menu.addEventListener('toggle',ev=>{if(ev.newState==='closed')menu.remove();});}
  renderInspector(){if(!this.doc||view!=='canvas')return;const box=$('#inspector'),items=this.selectedItems();this.paintSelectionTools(items);box.replaceChildren(el('div','inspector-label','CANVAS'));if(!items.length){box.append(el('h2','canvas-inspector-title',this.doc.board.name),el('p','hint',this.doc.items.size+' items · Your files stay in the library.'),action('Browse library',()=>this.toggleTray(true)),action('Rename canvas',()=>this.rename(this.doc.board.id)));const tools=section('Add to canvas');tools.append(action('Named section',()=>this.addSection()));box.append(tools,el('p','hint','Drag to select. Hold Space or use the hand tool to move around. Pinch to zoom. Resize from a corner; hold Shift for free sizing.'));const danger=section('This canvas');danger.append(action('Delete canvas…',()=>this.removeBoard(this.doc.board.id),'danger'));box.append(danger);return;}
   box.append(el('h2','canvas-inspector-title',items.length===1?(items[0].kind==='asset'?assetById.get(items[0].assetId)?.name||items[0].data.label:items[0].kind==='collection'?this.folderRecords.find(f=>f.id===items[0].collectionId)?.name||items[0].data.label:items[0].kind==='text'?'Text':'Shape'):items.length+' items selected'));const b=CanvasGeometry.bounds(items),geometry=section('Position & size'),grid=el('div','canvas-geometry');for(const [key,label]of [['x','X'],['y','Y'],['width','Width'],['height','Height']]){const fieldLabel=el('label','',label),input=el('input');input.type='number';input.disabled=items.some(item=>item.data.locked);input.step='1';input.value=Math.round(b[key]);input.setAttribute('aria-label','Canvas '+label.toLowerCase());input.onchange=()=>{const value=input.valueAsNumber;if(!Number.isFinite(value)||(['width','height'].includes(key)&&value<8)){input.value=Math.round(b[key]);return;}let changes;if(key==='x'||key==='y'){const delta=value-b[key];changes=items.map(item=>({...clone(item),data:{...item.data,[key]:item.data[key]+delta}}));}else{const scale=value/b[key];changes=items.map(item=>({...clone(item),data:{...item.data,autoSize:false,x:key==='width'?b.x+(item.data.x-b.x)*scale:item.data.x,y:key==='height'?b.y+(item.data.y-b.y)*scale:item.data.y,[key]:Math.max(8,Math.min(100000,item.data[key]*scale))}}));}this.commit(changes);};fieldLabel.append(input);grid.append(fieldLabel);}geometry.append(grid);box.append(geometry);
   const styled=items.filter(item=>!item.data.locked&&['text','shape'].includes(item.kind));
   if(styled.length){
    const style=section('Style'),color=el('input');
    color.type='color';color.value=styled[0].data.color.slice(0,7);color.setAttribute('aria-label','Canvas color');
    color.onchange=()=>this.commit(styled.map(item=>({...clone(item),data:{...item.data,color:color.value}})));
    const editable=styled.filter(item=>!['draw','arrow'].includes(item.data.shape));
    const label=styled.every(item=>item.kind==='text')?'Text color':!editable.length?'Stroke color':'Color';
    style.append(el('p','hint',label),color);
    const shapes=editable.filter(item=>item.kind==='shape');
    if(shapes.length){
     const ink=el('input');ink.type='color';ink.value=shapes[0].data.textColor;ink.setAttribute('aria-label','Shape text color');
     ink.onchange=()=>this.commit(shapes.map(item=>({...clone(item),data:{...item.data,textColor:ink.value}})));
     style.append(el('p','hint','Text color'),ink);
    }
    if(editable.length){
     const size=el('input');size.type='number';size.min='8';size.max='200';size.value=editable[0].data.fontSize;
     size.setAttribute('aria-label','Canvas font size');
     size.onchange=()=>{
      const value=Number(size.value);
      if(value>=8&&value<=200)this.commit(editable.map(item=>({...clone(item),data:{...item.data,fontSize:value}})));
     };
     style.append(el('p','hint','Text size'),size);
     if(items.length===1){
      const item=editable[0];
      style.append(field(item.data.text,'Canvas text',value=>this.commit([{...clone(item),data:{...item.data,text:value.slice(0,20000)}}]),true));
     }
    }
    box.append(style);
   }
   const actions=section('Selection');if(items.length===1&&items[0].kind==='text')actions.append(action('Fit text to content',()=>{const item=clone(items[0]);this.fitText(item);this.commit([item]);}));if(items.length===1&&items[0].assetId){const a=assetById.get(items[0].assetId);if(a&&['image','video'].includes(kind(a)))actions.append(action('Fit frame to media',()=>{const item=clone(items[0]),image=this.nodes.get(item.id)?.querySelector('img'),ratio=a.aspectRatio||(image?.naturalWidth/image?.naturalHeight);if(ratio>0){item.data.height=Math.max(8,Math.min(100000,item.data.width/ratio));item.data.autoSize=false;this.commit([item]);}else notify('The media preview is still loading. Try again in a moment.');}));}if(items.length===1&&items[0].collectionId){const folder=this.folderRecords.find(f=>f.id===items[0].collectionId);if(folder)actions.append(action('Open collection',()=>setView('folder',folder.name)));}if(items.length===1&&items[0].assetId){actions.append(action('Preview file',()=>this.previewSelected()),action('Show in library',()=>{const id=items[0].assetId;$('#type').selectedIndex=0;setView('all',null,true);select(id);revealGallerySelection();}));}actions.append(action('Duplicate',()=>this.duplicate()),action('Fit selection',()=>this.fit(items.map(i=>i.id))),action('Remove from canvas',()=>this.removeSelected(),'danger'));box.append(actions,el('p','hint','Removing items here only changes this canvas. Library originals are kept.'));
  }
  choose({ids=[],collectionName=null,forceNew=false,renameId=null}={}){this.dialog={ids:[...ids],collectionName,renameId};const select=$('#canvas-target');select.replaceChildren();for(const board of this.boards){const option=el('option','',board.name);option.value=board.id;select.append(option);}const fresh=el('option','','New canvas…');fresh.value='';select.append(fresh);select.value=forceNew||!this.boards.length?'':this.doc?.board.id||this.boards[0].id;$('#canvas-dialog-title').textContent=renameId?'Rename canvas':ids.length||collectionName?'Add to Canvas':'New canvas';$('#canvas-dialog-description').textContent=ids.length?ids.length+' files will be referenced here. Originals stay in your library.':collectionName?'Add a live link to “'+collectionName+'”.':'A place for your ideas, saved on this Mac.';$('#canvas-name').value=renameId?this.boards.find(b=>b.id===renameId)?.name||'':'Untitled canvas';$('#canvas-dialog-error').textContent='';this.updateDialog();$('#canvas-dialog').showModal();if(!$('#canvas-name-label').hidden){$('#canvas-name').focus();$('#canvas-name').select();}else select.focus();}
  updateDialog(){if(!this.dialog)return;const add=!!(this.dialog.ids.length||this.dialog.collectionName),rename=!!this.dialog.renameId;$('#canvas-target-label').hidden=!add||rename;$('#canvas-name-label').hidden=add&&!rename&&!!$('#canvas-target').value;$('#canvas-name').required=!$('#canvas-name-label').hidden;$('#canvas-dialog-save').textContent=rename?'Save name':add?'Add to canvas':'Create canvas';}
  async submitDialog(){const state=this.dialog;if(!state)return;const button=$('#canvas-dialog-save');button.disabled=true;try{if(state.renameId){await this.flushAll();const board=await api.canvasRename(state.renameId,$('#canvas-name').value);this.updateSummary(board);$('#canvas-dialog').close();if(this.doc?.board.id===board.id)this.renderInspector();return;}let id=$('#canvas-target-label').hidden?'':$('#canvas-target').value;if(!id){const board=await api.canvasCreate($('#canvas-name').value);this.updateSummary(board);id=board.id;this.newIconKey='canvas:'+id;}$('#canvas-dialog').close();if(state.ids.length)await this.addAssets(id,state.ids,null,true);else if(state.collectionName)await this.addCollection(id,state.collectionName,null,true);else await this.open(id);if(this.newIconKey){const key=this.newIconKey;this.newIconKey=null;await WorkbenchUI.created(key,'canvas');}}catch(error){$('#canvas-dialog-error').textContent=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');if(!$('#canvas-dialog').open)notify(error.message);}finally{button.disabled=false;}}
  rename(id){this.choose({renameId:id});}
  async removeBoard(id){const doc=this.documents.get(id);if(doc)await this.flush(doc);const result=await api.canvasRemove(id);if(result.cancelled)return;if(this.doc?.board.id===id)setView('all');this.documents.delete(id);this.boards=this.boards.filter(b=>b.id!==id);this.renderNav();notify('Canvas deleted. Your library files are kept.');}
  async acceptAdded(id,result,open=false){
   this.updateSummary(result.board);
   const cached=this.documents.get(id);
   if(cached){
    for(const item of result.items){
     cached.items.set(item.id,item);
     cached.index.update(item);
     cached.maxZ=Math.max(cached.maxZ,item.z);
    }
    this.history(cached,new Map(),this.snapshot(result.items));
   }
   if(open)await this.open(id);
   if(this.doc?.board.id===id&&view==='canvas'){
    const doc=this.doc, itemIds=result.items.map(item=>item.id);
    if(!cached)this.history(doc,new Map(),this.snapshot(result.items));
    this.select(itemIds);
    if(open)this.fit(itemIds);
    this.schedule();
    if(matchMedia('(prefers-reduced-motion: no-preference)').matches){
     requestAnimationFrame(()=>{
      if(this.doc!==doc||view!=='canvas')return;
      for(const itemId of itemIds){
       const node=this.nodes.get(itemId);
       if(!node)continue;
       node.classList.add('just-added');
       const finish=()=>node.classList.remove('just-added');
       node.addEventListener('animationend',finish,{once:true});
       node.addEventListener('animationcancel',finish,{once:true});
      }
     });
    }
   }
   notify(result.items.length+' '+(result.items.length===1?'item':'items')+' added to Canvas.');
  }
  async addAssets(id,ids,point=null,open=false){if(!ids.length)return;const doc=this.documents.get(id);if(doc)await this.flush(doc);const ratios={};for(const assetId of ids){const a=assetById.get(assetId);const type=a&&SmartCards.type(a);if(['movie','series'].includes(type))ratios[assetId]=2/3;else if(['song','album','playlist','music'].includes(type))ratios[assetId]=1;else if(a?.aspectRatio)ratios[assetId]=a.aspectRatio;}const result=await api.canvasAddAssets(id,ids,point,ratios);await this.acceptAdded(id,result,open);}
  async addCollection(id,name,point=null,open=false){const doc=this.documents.get(id);if(doc)await this.flush(doc);await this.acceptAdded(id,await api.canvasAddCollection(id,name,point),open);}
  async imported(id,ids){if(ids?.length)await this.addAssets(id,[...new Set(ids)],this.doc?.board.id===id?this.center():null,false);}
  clearDrag(){dragDepth=0;document.body.classList.remove('dragging');for(const node of document.querySelectorAll('.canvas-drop-target'))node.classList.remove('canvas-drop-target');}
  async drop(e,id,point=null,open=false){if(!id)return;e.preventDefault();e.stopPropagation();this.clearDrag();const data=e.dataTransfer,raw=data.getData('application/x-canvaspro-assets'),folder=data.getData('application/x-canvaspro-collection'),paths=[...data.files].map(f=>api.filePath(f)).filter(Boolean),url=(data.getData('text/uri-list')||data.getData('text/plain')).split('\n').find(s=>/^https?:\/\//i.test(s.trim()));safe(async()=>{if(raw){let ids;try{ids=JSON.parse(raw);}catch{throw Error('Could not read the dragged files.');}await this.addAssets(id,ids,point,open);}else if(folder)await this.addCollection(id,folder,point,open);else if(paths.length){const doc=this.documents.get(id);if(doc)await this.flush(doc);const result=await api.canvasDropPaths(id,paths,point);await refresh();if(!result.items.length){notify(result.importResult?.errors[0]||'No files were imported.');return;}await this.acceptAdded(id,result,open);if(result.importResult?.errors.length)notify(result.importResult.errors[0]);}else if(url){const result=await api.importURL(url.trim(),null);await refresh();await this.addAssets(id,result.ids,point,open);}});}
  async paste(){if(!this.doc)return;const doc=this.doc,templates=await api.canvasClipboardRead();if(templates?.length){if(this.doc!==doc)return;this.duplicate(templates,this.center());return;}const result=await api.paste(null);await refresh();if(result?.ids?.length)await this.addAssets(doc.board.id,[...new Set(result.ids)],this.doc===doc?this.center():null);else if(result?.errors?.length)notify(result.errors[0]);}
  toggleTray(open = $('#canvas-tray').hidden, trigger = null) {
   const tray = $('#canvas-tray'), button = $('#canvas-library');
   const restoreFocus = !open && tray.contains(document.activeElement);
   if (this.activePlayer?.tray) this.stopPlayer();
   tray.hidden = !open;
   button.setAttribute('aria-expanded', String(open));
   if (open) {
    this.refreshTray();
    if (trigger) revealFromTrigger(tray, trigger);
   } else {
    for (const animation of tray.getAnimations()) animation.cancel();
    this.trayNodes.clear();
    $('#canvas-tray-items').replaceChildren();
    this.sendVisible();
    if (restoreFocus) button.focus({ preventScroll: true });
   }
   this.schedule();
  }
  refreshTray(){if($('#canvas-tray').hidden||!this.doc)return;if(this.activePlayer?.tray)this.stopPlayer();for(const b of document.querySelectorAll('[data-canvas-tab]'))b.setAttribute('aria-pressed',String(b.dataset.canvasTab===this.trayTab));const q=$('#canvas-tray-search').value.trim().toLowerCase();this.trayData=this.trayTab==='collections'?this.folderRecords.filter(f=>!q||f.name.toLowerCase().includes(q)):assets.filter(a=>!a.trash&&(this.trayTab!=='links'||kind(a)==='link')&&(!q||a.searchText?.includes(q)));$('#canvas-tray-scroll').scrollTop=0;this.trayNodes.clear();this.trayLayout=null;this.traySelection=new Set([...this.traySelection].filter(id=>this.trayData.some(a=>a.id===id)));$('#canvas-tray-items').replaceChildren();this.renderTray();}
  selectTray(id,e){const ids=this.trayData.map(a=>a.id);if(e.shiftKey&&this.trayAnchor){const a=ids.indexOf(this.trayAnchor),b=ids.indexOf(id);this.traySelection=new Set(ids.slice(Math.min(a,b),Math.max(a,b)+1));}else if(e.metaKey||e.ctrlKey){this.traySelection.has(id)?this.traySelection.delete(id):this.traySelection.add(id);this.trayAnchor=id;}else{this.traySelection=new Set([id]);this.trayAnchor=id;}this.renderTray();}
  renderTray(){if($('#canvas-tray').hidden||!this.doc)return;const scroller=$('#canvas-tray-scroll'),layer=$('#canvas-tray-items'),folders=this.trayTab==='collections',width=scroller.clientWidth;
   if(!this.trayLayout||this.trayLayout.width!==width){if(folders){const positions=this.trayData.map((item,index)=>({index,id:item.id,x:0,y:index*68,width,height:68,surfaceHeight:40}));this.trayLayout={width,positions,columnItems:[positions],height:positions.length*68};}else{const columns=[[],[]],heights=[0,0],tile=(width-8)/2,positions=[];this.trayData.forEach((item,index)=>{const column=heights[0]<=heights[1]?0:1,ratio=item.aspectRatio||(kind(item)==='video'?16/9:1),surfaceHeight=Math.max(12,Math.min(600,tile/ratio)),p={index,id:item.id,x:column*(tile+8),y:heights[column],width:tile,surfaceHeight,height:surfaceHeight+29};positions.push(p);columns[column].push(p);heights[column]+=p.height+8;});this.trayLayout={width,positions,columnItems:columns,height:Math.max(...heights)};}}
   const indices=AssetLayout.visibleIndices(this.trayLayout,scroller.scrollTop,scroller.clientHeight,160),keys=new Set();layer.style.height=Math.max(1,this.trayLayout.height)+'px';for(const i of indices){const item=this.trayData[i],p=this.trayLayout.positions[i],key=item.id;keys.add(key);let node=this.trayNodes.get(key);if(!node){node=el('div','canvas-tray-item'+(folders?' canvas-tray-folder':''));node.draggable=true;node.dataset.assetId=folders?'':item.id;node.onclick=e=>this.selectTray(key,e);if(folders){node.append(glyph('folder'),el('span','',item.name));node.ondragstart=e=>{e.dataTransfer.setData('application/x-canvaspro-collection',item.name);e.dataTransfer.effectAllowed='copy';};node.ondblclick=()=>safe(()=>this.addCollection(this.doc.board.id,item.name,this.center()));}else{const image=kind(item)==='link'?bookmarkVisual(item):thumb(item,'',true),frame=el('div','canvas-tray-image');frame.append(image);node.append(frame,el('span','canvas-tray-name',item.name));if(kind(item)==='video'){node.onpointerenter=e=>{if(e.pointerType==='touch')return;this.stopPlayer();const player=createPlayer(item,{compact:true,muted:true,scrubHover:false});player.nodeId='tray-'+key;player.tray=true;player.hover=true;this.activePlayer=player;frame.append(player.element);};node.onpointerleave=()=>{if(this.activePlayer?.nodeId==='tray-'+key)this.stopPlayer();};}if(image.tagName==='IMG')image.addEventListener('load',()=>{if(image.naturalWidth&&image.naturalHeight&&!item.aspectRatio){item.aspectRatio=image.naturalWidth/image.naturalHeight;this.trayLayout=null;this.renderTray();}},{once:true});node.ondragstart=e=>{this.stopPlayer();if(!this.traySelection.has(key))this.traySelection=new Set([key]);const ids=[...this.traySelection];e.dataTransfer.setData('application/x-canvaspro-assets',JSON.stringify(ids));e.dataTransfer.effectAllowed='copy';const badge=el('div','canvas-drag-badge','＋ '+ids.length+' '+(ids.length===1?'file':'files'));document.body.append(badge);e.dataTransfer.setDragImage(badge,12,12);setTimeout(()=>badge.remove(),0);this.renderTray();};node.ondblclick=()=>safe(()=>this.addAssets(this.doc.board.id,this.traySelection.has(key)?[...this.traySelection]:[key],this.center()));}node.title=item.name;node.ondragend=()=>this.clearDrag();this.trayNodes.set(key,node);layer.append(node);}node.setAttribute('aria-selected',String(this.traySelection.has(key)));Object.assign(node.style,{left:p.x+'px',top:p.y+'px',width:p.width+'px',height:p.height+'px'});const frame=node.querySelector('.canvas-tray-image');if(frame)frame.style.height=p.surfaceHeight+'px';}for(const [key,node]of this.trayNodes)if(!keys.has(key)){if(this.activePlayer?.nodeId==='tray-'+key)this.stopPlayer();node.remove();this.trayNodes.delete(key);}this.sendVisible();}
  sendVisible(){
   if(!this.doc||view!=='canvas')return;
   const ids=new Set([...this.nodes.values()].map(node=>node._asset).concat([...this.trayNodes.values()].map(node=>node.dataset.assetId)).filter(Boolean));
   publishVisibleAssets([...ids]);
  }
 }
 return new Workspace();
})();
