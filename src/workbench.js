const WorkbenchUI=(()=>{
 // Keep this gate in sync with electron/smart-index.cjs VISUAL_EXTENSIONS.
 const VISUAL_EXTENSIONS=new Set(['jpg','jpeg','jfif','jpe','png','webp','gif','avif','heic','heif','tiff','tif','bmp','svg','psd','eps','pdf','mp4','mov','m4v','webm']);
 const canFindSimilar=a=>!!a&&VISUAL_EXTENSIONS.has(String(a.ext||'').toLowerCase());
 let state={icons:{}},similarIds=null,similarScores=null,title='Similar files',color='',pendingIcons={};
 let dialogSequence=0,similarBusy=false;
 function dialog(title){const d=el('dialog','workbench-dialog'),head=el('div','dialog-heading');const labelId='workbench-dialog-title-'+(++dialogSequence),heading=el('h2','',title);heading.id=labelId;d.setAttribute('aria-labelledby',labelId);const close=action('',()=>d.close());close.setAttribute('aria-label','Close');close.append(glyph('close'));head.append(heading,close);d.append(head);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;}
 function icon(key,fallback='folder'){const choice=state.icons[key];if(choice?.type==='emoji'){const n=el('span','emoji-icon',choice.value);return n;}return glyph(choice?.value||fallback);}
 async function pickIcon(key,onChoose){const value=await EmojiPicker.pick();if(!value)return;const choice={type:'emoji',value};if(onChoose)onChoose(choice);else{state.icons=await api.workbench('icon',{key,icon:choice});renderNav();}}
 function setData(data){if(data)state=data;}
 function reset(){similarIds=null;similarScores=null;color='';title='Similar files';}
 // Colour matching uses CIE Lab distance, not raw RGB. The old rule allowed a
 // distance of 85 per channel, so any file with a dark grey matched a dark
 // swatch and the result looked random. A swatch should mean the same colour,
 // not a colour in the same family: Delta E of 8 covers the palette's own
 // quantisation (5 bits per channel) and nothing more.
 const COLOUR_TOLERANCE=8;
 const rgbCache=new Map(),labCache=new Map();
 function hexToRgb(hex){
  const key=String(hex||'').trim().toLowerCase();
  if(rgbCache.has(key))return rgbCache.get(key);
  const value=key.replace(/^#/,'');
  if(!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(value))return null;
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  const rgb=[parseInt(full.slice(0,2),16),parseInt(full.slice(2,4),16),parseInt(full.slice(4,6),16)];
  rgbCache.set(key,rgb);
  return rgb;
 }
 function rgbToLab(rgb){
  const [r,g,b]=rgb.map(v=>{const c=v/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
  const x=(r*0.4124+g*0.3576+b*0.1805)/0.95047,y=r*0.2126+g*0.7152+b*0.0722,z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const f=v=>v>0.008856?Math.cbrt(v):7.787*v+16/116,fx=f(x),fy=f(y),fz=f(z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
 }
 function hexLab(hex){
  const key=String(hex||'').trim().toLowerCase();
  if(labCache.has(key))return labCache.get(key);
  const rgb=hexToRgb(key);
  if(!rgb)return null;
  const lab=rgbToLab(rgb);
  labCache.set(key,lab);
  return lab;
 }
 function deltaE(a,b){return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);}
 function colourDistance(asset,hex){
  const lab=hexLab(hex);
  if(!lab)return Infinity;
  let best=Infinity;
  for(const entry of asset?.smart?.palette||[]){
   const other=hexLab(entry.hex);
   if(!other)continue;
   const distance=deltaE(lab,other);
   if(distance<best)best=distance;
  }
  return best;
 }
 function colorMatch(a,hex){return colourDistance(a,hex)<=COLOUR_TOLERANCE;}
 function rank(a){return color?colourDistance(a,color):similarScores?-(similarScores.get(a.id)||0):0;}
 function rankOrder(){return !!color||!!similarScores;}
 function accepts(a){return view!=='smart'||((!similarIds||similarIds.has(a.id))&&(!color||colorMatch(a,color)));}
 function showSimilarInLibrary(source,result){
  similarIds=new Set(result.map(r=>r.id));similarScores=new Map(result.map(r=>[r.id,r.score]));title='Similar to '+(source.name||'image');
  // Set the result up before changing views so the single render that follows
  // already has the filter, the ranking and the closest match selected.
  setView('smart',null,false,{keepWorkbench:true,type:'all',pendingSelection:result[0]?.id||null});
 }
 async function similar(id){
  if(similarBusy)return;
  const source=assetById.get(id);
  if(!source)return;
  if(!canFindSimilar(source)){notify('Find similar works with images, PDFs and videos.');return;}
  const button=document.querySelector('.inspector > .find-similar');
  similarBusy=true;
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');button.title='Searching for similar files…';}
  try{
   let result=[];
   try{result=(await api.workbench('similar',{id})).filter(r=>r.score>=0.2);}catch(error){notify(error.message||String(error));return;}
   if(!result.length){
    const [index,installed]=await Promise.all([api.smartState().catch(()=>null),api.modelState('clip').catch(()=>null)]);
    const reason=!installed?.ready?'Install the local visual model in Settings → Search & models, then let the index finish.'
     :index?.visualRemaining?'Still indexing: '+index.visualRemaining+' files left to compare.'
     :'No close matches yet. Let local indexing finish in Settings → Search & models.';
    notify(reason);
    return;
   }
   showSimilarInLibrary(source,result);
  }finally{
   similarBusy=false;
   if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');button.title='';}
  }
 }
 // A colour is a filter, not a report: clicking a swatch takes you to every
 // file that uses that colour, the same way Find similar takes you to the
 // files that look like this one.
 async function findColor(hex){
  if(!hexToRgb(hex))return;
  window.showColorDetails?.(hex);
  // The colour is set after the view changes: switching views clears the
  // filter, and a filter that is cleared shows nothing at all.
  setView('smart');$('#type').value='all';
  color=hex;title='Files with '+hex;
  render();
  // Every file has to be here, not only the page the library was showing.
  await hydrateCatalog();
  const matches=assets.filter(a=>!a.trash&&colorMatch(a,hex));
  title='Files with '+hex+(matches.length?' · '+matches.length:'');
  render();
  if(!matches.length)notify('No indexed file uses that colour yet. Colours are known once the local index has looked at a file.');
 }
 async function history(redo=false){const result=await api.workbench('history',{redo});if(result.changed){await refreshCurrent();notify((redo?'Redid: ':'Undid: ')+result.label);}else notify('No file changes to '+(redo?'redo':'undo')+'.');}
 // The searchable sheet lives with the command palette so both use the same
// list; Settings and ⌘/ route here too.
 function shortcuts(){return window.CommandPalette ? window.CommandPalette.open('shortcuts') : null;}
 async function duplicateReview(){
  const d=dialog('Duplicate review');
  const intro=el('p','hint','Identical files are already stopped at import. These groups are the same picture saved more than once — resized, re-compressed, or exported again. Nothing moves until you choose a copy to keep.');
  const summary=el('p','duplicates-summary');
  const progress=el('p','hint','');
  const list=el('div','duplicates-list');
  d.append(intro,summary,progress,list,el('p','hint','Moving a copy to Trash is undoable with ⌘Z. “Not duplicates” remembers the group and leaves it out of later reviews.'));
  let timer=0;
  const formatDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':date.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});};
  const groupCard=group=>{
    const card=el('div','duplicate-group');
    card.dataset.savings=String(group.savings||0);
    const head=el('div','duplicate-group-head');
    head.append(
      el('strong','duplicate-title',group.members.length+' copies'),
      el('span','duplicate-badge',group.kind==='exact'?'Exact copies':group.similarity+'% the same picture')
    );
    const options=el('div','duplicate-options');
    const name='duplicate-'+group.token;
    for(const member of group.members){
      const label=el('label','duplicate-choice');
      const input=el('input');
      input.type='radio';input.name=name;input.value=member.id;input.checked=member.id===group.keep;
      input.setAttribute('aria-label','Keep '+member.name);
      const frame=el('span','duplicate-thumb');frame.append(thumb(member));
      const fileName=el('strong','duplicate-name',member.name);fileName.title=member.name;
      const meta=el('small','duplicate-meta',[bytes(member.size),formatDate(member.imported)].filter(Boolean).join(' · '));
      const marks=[];
      if(member.favorite)marks.push('★');
      if(member.notes)marks.push('note');
      if(member.tags.length)marks.push(member.tags.length+(member.tags.length===1?' tag':' tags'));
      if(member.folders.length)marks.push(member.folders.length===1?'collection':member.folders.length+' collections');
      if(marks.length)meta.append(' · '+marks.join(' · '));
      label.append(input,frame,fileName,meta);
      options.append(label);
    }
    const actions=el('div','duplicate-actions');
    const remove=action('',()=>{});
    remove.className='primary';
    const dismiss=action('Not duplicates',()=>{});
    const compare=action('Compare',()=>{});
    const refreshButton=()=>{
      const chosen=options.querySelector('input:checked');
      const count=Math.max(0,group.members.length-(chosen?1:0));
      remove.textContent=count===1?'Move 1 copy to Trash':'Move '+count+' copies to Trash';
      remove.disabled=!count;
    };
    options.addEventListener('change',refreshButton);
    refreshButton();
    remove.onclick=async()=>{
      const chosen=options.querySelector('input:checked');
      const keepId=chosen?.value||group.keep;
      const ids=group.members.filter(member=>member.id!==keepId).map(member=>member.id);
      if(!ids.length)return;
      remove.disabled=true;
      try{
        await api.bulkUpdate(ids,{type:'trash',trash:true});
        await refreshCurrent();
        card.remove();
        paintSummary();
        notify((ids.length===1?'1 copy':ids.length+' copies')+' moved to Trash'+(group.savings?' · '+bytes(group.savings)+' freed':'')+' · ⌘Z to undo');
        if(!list.querySelector('.duplicate-group'))list.append(el('p','hint','Nothing else looks duplicated.'));
      }catch(error){
        notify(error.message||String(error));
        if(remove.isConnected)remove.disabled=false;
      }
    };
    dismiss.onclick=async()=>{
      dismiss.disabled=true;
      try{
        await api.workbench('dismiss-duplicates',{ids:group.members.map(member=>member.id)});
        card.remove();
        paintSummary();
        notify('Hidden from future duplicate reviews.');
        if(!list.querySelector('.duplicate-group'))list.append(el('p','hint','Nothing else looks duplicated.'));
      }catch(error){
        notify(error.message||String(error));
        dismiss.disabled=false;
      }
    };
    compare.onclick=()=>{
      const members=group.members.map(member=>assetById.get(member.id)).filter(Boolean);
      if(!members.length)return;
      d.close();
      setView('all');
      selection.clear();
      for(const member of members)selection.ids.add(member.id);
      selection.focus=members[0].id;
      selected=members[0].id;
      renderInspector();
      openPreview(members);
    };
    actions.append(remove,dismiss,compare);
    card.append(head,options,actions);
    return card;
  };
  const paintSummary=()=>{
    const cards=[...list.querySelectorAll('.duplicate-group')];
    if(!cards.length){summary.textContent='';return;}
    const savings=cards.reduce((sum,node)=>sum+Number(node.dataset.savings||0),0);
    summary.textContent=cards.length+(cards.length===1?' group':' groups')+(savings?' · '+bytes(savings)+' can be freed':'');
  };
  const paint=async()=>{
    clearTimeout(timer);
    const result=await api.workbench('duplicates');
    if(!d.isConnected)return;
    list.replaceChildren();
    for(const group of result.groups)list.append(groupCard(group));
    if(!result.groups.length){
      list.append(el('p','hint',result.pending?'Still reading pictures…':'No duplicate pictures found.'));
      if(!result.pending)progress.textContent='Compared '+result.total+(result.total===1?' picture':' pictures')+'.';
    }
    if(result.pending){
      progress.textContent='Reading '+(result.pending===1?'1 more picture':'more pictures')+' · '+result.pending+' left. Results update as they finish.';
      timer=setTimeout(()=>{paint().catch(()=>{});},1500);
    }else if(result.groups.length)progress.textContent='';
    paintSummary();
  };
  d.addEventListener('close',()=>clearTimeout(timer));
  try{await paint();}
  catch(error){summary.textContent='';progress.textContent='';list.replaceChildren(el('p','hint',error.message||String(error)));}
  return d;
 }
 async function recovery(issue){const result=await api.workbench('recover',{id:issue.id});if(result.restored){notify('Original restored. Your tags and canvas placements are preserved.');thumbnailReset(issue.id);await refreshCurrent();renderHealth(await api.startHealth());}}
 function thumbnailReset(id){for(const key of [...linkRequests.keys()])if(key===id)linkRequests.delete(key);}
 async function backupSettings(){const d=dialog('Library backup'),info=await api.workbench('state');d.append(el('p','',info.root),el('p','hint',info.total.n+' files · '+bytes(info.total.bytes||0)),el('p','hint',info.backup?'Last backup: '+new Date(info.backup.at).toLocaleString()+' · '+info.backup.path:'No backup recorded yet.'),el('p','hint','Keep a copy on another disk before resetting your Mac. Open the copied .canvaslibrary folder through Open existing library.'));const check=el('input');check.type='checkbox';check.checked=info.reminders;const label=el('label','tool-field','Remind me after 30 days');label.prepend(check);check.onchange=()=>api.workbench('reminders',{enabled:check.checked});d.append(label,action('Create backup…',async()=>{const button=d.querySelector('button:last-child');button.disabled=true;try{const result=await api.workbench('backup');if(result.at){state.backup=result;notify('Library backup saved.');d.close();}}finally{if(button.isConnected)button.disabled=false;}}));return d;}
 async function created(key,kind){const icon=pendingIcons[kind];if(icon){state.icons=await api.workbench('icon',{key,icon});delete pendingIcons[kind];renderNav();}}
 function init(){for(const [selector,kind]of [['#canvas-name-label','canvas'],['#folder-dialog form','collection'],['#action-form','collection']]){const parent=$(selector);const b=action('Choose icon…',()=>{if(kind==='canvas'&&CanvasWorkspace.dialog?.renameId)return pickIcon('canvas:'+CanvasWorkspace.dialog.renameId);return pickIcon(null,value=>{pendingIcons[kind]=value;b.textContent=value.value;});});b.type='button';b.className='creation-icon';/* In dialogs the icon picker sits on the same line as Cancel and the primary action. */const actions=parent.querySelector('.dialog-actions');if(actions)actions.prepend(b);else parent.append(b);}for(const [selector,name]of [['#close-preview','close'],['#settings-close','close'],['#health-close','close'],['#activity-close','close'],['#canvas-tray-close','close'],['#canvas-zoom-out','minus'],['#canvas-zoom-in','plus'],['#add-canvas','plus'],['#add-folder','plus']]){const n=$(selector);if(n)n.replaceChildren(glyph(name));}const search=$('.search');const searchIcon=search.querySelector('.search-glyph');if(searchIcon){if(!searchIcon.firstChild)searchIcon.append(glyph('search'));}else if(search.firstChild?.nodeType===3)search.firstChild.replaceWith(glyph('search'));api.onHistoryCommand(redo=>{const focused=document.activeElement;if(focused?.matches('input,textarea,[contenteditable=true]')){document.execCommand(redo?'redo':'undo');return;}if(view==='canvas')CanvasWorkspace.undo(redo);else safe(()=>history(redo));});// Settings opens these tools in their own window and comes straight back.
 const fromSettings=fn=>async()=>{const pane=SettingsUI.currentPane;$('#settings-dialog').close();const dialog=await fn();if(dialog&&dialog.addEventListener)dialog.addEventListener('close',()=>SettingsUI.open(pane),{once:true});};
 $('#settings-backup').onclick=fromSettings(backupSettings);
 $('#settings-duplicate-review').onclick=fromSettings(duplicateReview);
 $('#settings-beta').onclick=fromSettings(beta);
 $('#settings-all-shortcuts').onclick=fromSettings(shortcuts);
 document.addEventListener('keydown',e=>{if(!(e.metaKey||e.ctrlKey))return;const typing=e.target.matches?.('input,textarea,select,[contenteditable=true]');if(e.key==='/'&&!typing){e.preventDefault();e.stopImmediatePropagation();shortcuts();}else if(e.key.toLowerCase()==='z'&&!typing&&view!=='canvas'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();safe(()=>history(e.shiftKey));}},true);
 }
 function beta(){
  const d=dialog('Beta testing and feedback');
  d.append(el('p','hint beta-intro','Use a disposable library for destructive tests. Try import, preview, search, canvas edits, backup and reopening on several Apple Silicon Macs. Real testers are still needed before a public launch.'));
  const card=el('div','settings-card beta-checklist');
  const steps=['Create a new library and reopen it','Import images, audio, videos, PDFs and bookmarks','Test shortcuts, undo, selection and duplicate review','Create a canvas; move, resize and export items','Back up, then open the backup as an existing library','Check large-library scrolling and local search','Test light/dark and Reduce Motion'];
  for(const text of steps){
   const row=el('label','settings-row beta-check');
   row.append(el('span','settings-copy',text));
   const check=el('input');check.type='checkbox';row.append(check);
   card.append(row);
  }
  d.append(card);
  const notes=field('','What happened? Include steps, expected result and actual result.',()=>{},true);
  notes.classList.add('beta-notes');
  d.append(notes);
  const save=action('Save feedback report…',async()=>{await api.saveReport({notes:notes.value,checks:[...card.querySelectorAll('.beta-check')].map(row=>({test:row.textContent,passed:row.querySelector('input').checked}))});},'primary');
  const actions=el('div','dialog-actions beta-actions');actions.append(save);d.append(actions);
  return d;
 }
 return{init,created,setData,reset,accepts,rank,rankOrder,colourMatch:colorMatch,icon,pickIcon,similar,canFindSimilar,findColor,recovery,shortcuts,get title(){return title;}};
})();
