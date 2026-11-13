const WorkbenchUI=(()=>{
 let state={icons:{}},similarIds=null,similarScores=null,title='Similar files',color='',pendingIcons={};
 const symbols=['folder','canvas','star','heart','lightbulb','briefcase','paintbrush','camera','book','leaf','sparkles','house','flag','archive','image','video','audio'];
 function dialog(title){const d=el('dialog','workbench-dialog'),head=el('div','dialog-heading');const close=action('',()=>d.close());close.setAttribute('aria-label','Close');close.append(glyph('close'));head.append(el('h2','',title),close);d.append(head);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;}
 function icon(key,fallback='folder'){const choice=state.icons[key];if(choice?.type==='emoji'){const n=el('span','emoji-icon',choice.value);return n;}return glyph(choice?.value||fallback);}
 async function pickIcon(key,onChoose){const d=dialog('Choose an icon'),grid=el('div','icon-picker');for(const name of symbols){const b=action('',async()=>{const value={type:'symbol',value:name};if(onChoose)onChoose(value);else state.icons=await api.workbench('icon',{key,icon:value});d.close();renderNav();});b.title=name;b.append(glyph(name));grid.append(b);}d.append(grid,el('p','hint','Choose a symbol, or type an emoji. Use Control–Command–Space to open the macOS emoji picker.'));const input=el('input');input.placeholder='Emoji';input.maxLength=20;input.setAttribute('aria-label','Emoji');d.append(input,action('Use emoji',async()=>{const value=input.value.trim();if(!value||! /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value)||[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].length!==1){notify('Choose an emoji.');return;}const choice={type:'emoji',value};if(onChoose)onChoose(choice);else state.icons=await api.workbench('icon',{key,icon:choice});d.close();renderNav();}));}
 function setData(data){if(data)state=data;}
 function reset(){similarIds=null;similarScores=null;color='';}
 // Colour matching uses CIE Lab distance, not raw RGB. The old rule allowed a
 // distance of 85 per channel, so any file with a dark grey matched a dark
 // swatch and the result looked random. A swatch should mean the same colour,
 // not a colour in the same family: Delta E of 8 covers the palette's own
 // quantisation (5 bits per channel) and nothing more.
 const COLOUR_TOLERANCE=8;
 function hexToRgb(hex){
  const value=String(hex||'').trim().replace(/^#/,'');
  if(!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(value))return null;
  const full=value.length===3?value.split('').map(c=>c+c).join(''):value;
  return [parseInt(full.slice(0,2),16),parseInt(full.slice(2,4),16),parseInt(full.slice(4,6),16)];
 }
 function rgbToLab(rgb){
  const [r,g,b]=rgb.map(v=>{const c=v/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
  const x=(r*0.4124+g*0.3576+b*0.1805)/0.95047,y=r*0.2126+g*0.7152+b*0.0722,z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const f=v=>v>0.008856?Math.cbrt(v):7.787*v+16/116,fx=f(x),fy=f(y),fz=f(z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
 }
 function deltaE(a,b){return Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2);}
 function colourDistance(asset,hex){
  const target=hexToRgb(hex);
  if(!target)return Infinity;
  const lab=rgbToLab(target);
  let best=Infinity;
  for(const entry of asset?.smart?.palette||[]){
   const rgb=hexToRgb(entry.hex);
   if(!rgb)continue;
   const distance=deltaE(lab,rgbToLab(rgb));
   if(distance<best)best=distance;
  }
  return best;
 }
 function colorMatch(a,hex){return colourDistance(a,hex)<=COLOUR_TOLERANCE;}
 function rank(a){return color?colourDistance(a,color):similarScores?-(similarScores.get(a.id)||0):0;}
 function rankOrder(){return !!color||!!similarScores;}
 function accepts(a){return view!=='smart'||((!similarIds||similarIds.has(a.id))&&(!color||colorMatch(a,color)));}
 function matchGrid(items,onOpen){
  const grid=el('div','similar-grid');
  for(const item of items){
   const asset=assetById.get(item.id);
   if(!asset)continue;
   const cell=el('button','similar-cell');
   cell.type='button';
   cell.title=asset.name;
   cell.append(thumb(asset));
   if(item.badge){const badge=el('span','similar-badge',item.badge);cell.append(badge);}
   cell.onclick=()=>onOpen(asset);
   grid.append(cell);
  }
  return grid;
 }
 function openMatchPanel(title,subtitle,items,footerActions){
  const d=dialog(title);
  d.classList.add('similar-panel');
  d.append(el('p','hint',subtitle));
  d.append(matchGrid(items,asset=>{d.close();setView('all');select(asset.id);}));
  const actions=typeof footerActions==='function'?footerActions(d):footerActions;
  if(actions.length){const footer=el('div','similar-footer');for(const item of actions)footer.append(item);d.append(footer);}
  return d;
 }
 function showSimilarInLibrary(source,result){
  setView('smart');$('#type').value='all';similarIds=new Set(result.map(r=>r.id));similarScores=new Map(result.map(r=>[r.id,r.score]));title='Similar to '+(source.name||'image');
  // Select the closest match once the gallery has its rows, so the file
  // viewer opens on it and the arrows stay inside the similar set.
  pendingSelection=result[0]?.id||null;render();
 }
 async function similar(id){
  const source=assetById.get(id);
  if(!source)return;
  let result=[];
  try{result=(await api.workbench('similar',{id})).filter(r=>r.score>=0.2);}catch(error){notify(error.message||String(error));return;}
  if(!result.length){
   const [index,installed]=await Promise.all([api.smartState().catch(()=>null),api.modelState('clip').catch(()=>null)]);
   const reason=!installed?.ready?'Install the local visual model in Settings → Experimental, then let the index finish.'
    :index?.visualRemaining?'Still indexing: '+index.visualRemaining+' files left to compare.'
    :'No close matches yet. Enable local visual search in Settings → Experimental and let the index finish.';
   notify(reason);
   return;
  }
  showSimilarInLibrary(source,result);
 }
 // A colour is a filter, not a report: clicking a swatch takes you to every
 // file that uses that colour, the same way Find similar takes you to the
 // files that look like this one.
 async function findColor(hex){
  if(!hexToRgb(hex))return;
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
 function shortcuts(){const d=dialog('Keyboard shortcuts'),input=field('','Find a shortcut',()=>{}),list=el('div');const values=[['Undo file / canvas change','⌘ Z'],['Redo','⇧ ⌘ Z'],['Sidebar','⌘ B / ⌘ S'],['Search','⌘ F / ⌘ K'],['Settings','⌘ ,'],['Import files','⌘ O'],['File details','⌘ I'],['Select all','⌘ A'],['Extend selection','⇧ + arrow'],['Toggle individual selection','⌘ + click'],['Copy / paste','⌘ C / ⌘ V'],['Trash selection','⌘ Delete'],['Preview / close','Space / Escape'],['Navigate','Arrow keys'],['Canvas select / hand / text','V / H / T'],['Canvas rectangle / ellipse','R / O'],['Canvas fit','⌘ 0'],['Pan canvas','Space + drag'],['This shortcut reference','⌘ /']];const paint=()=>{list.replaceChildren();for(const [name,key]of values.filter(r=>r.join(' ').toLowerCase().includes(input.value.toLowerCase()))){const row=el('div','shortcut-row');row.append(el('span','',name),el('kbd','',key));list.append(row);}};input.oninput=paint;d.append(input,list);paint();input.focus();}
 async function duplicateReview(){const d=dialog('Duplicate review');d.append(el('p','hint','Identical imports are already prevented by file hashes. Review visually similar items before moving any to Trash. Nothing is removed automatically.'));const loading=el('p','hint','Comparing indexed images locally…');d.append(loading);const exact=await api.workbench('duplicates');loading.textContent=exact.length?exact.length+' candidate pairs · check visually before removing anything.':'No duplicate candidates found in the available index.';for(const group of exact){const row=el('div','review-row');for(const record of group){const a=assetById.get(record.id);if(a){const b=action('',()=>{d.close();setView('all');selection.clear();for(const record of group)selection.ids.add(record.id);selection.focus=group[0].id;selected=group[0].id;renderInspector();openPreview(group.map(v=>assetById.get(v.id)).filter(Boolean));});b.title=a.name;b.append(thumb(a));row.append(b);}}row.append(el('span','',group[1].score?'Visually similar · '+Math.round(group[1].score*100)+'%':'Identical file hash'));d.append(row);}const candidates=current()?[current()]:assets.filter(a=>kind(a)==='image'&&!a.trash&&a.smart?.state==='indexed').slice(0,30);if(!candidates.length)d.append(el('p','hint','Select an indexed image to find similar files. Enable local visual search first.'));for(const a of candidates){const row=el('div','review-row');row.append(thumb(a),el('span','',a.name),action('Compare similar',async()=>{d.close();await similar(a.id);}));d.append(row);}}
 async function recovery(issue){const result=await api.workbench('recover',{id:issue.id});if(result.restored){notify('Original restored. Your tags and canvas placements are preserved.');thumbnailReset(issue.id);await refreshCurrent();renderHealth(await api.startHealth());}}
 function thumbnailReset(id){for(const key of [...linkRequests.keys()])if(key===id)linkRequests.delete(key);}
 async function backupSettings(){const d=dialog('Library backup'),info=await api.workbench('state');d.append(el('p','',info.root),el('p','hint',info.total.n+' files · '+bytes(info.total.bytes||0)),el('p','hint',info.backup?'Last backup: '+new Date(info.backup.at).toLocaleString()+' · '+info.backup.path:'No backup recorded yet.'),el('p','hint','Keep a copy on another disk before resetting your Mac. Open the copied .canvaslibrary folder through Open existing library.'));const check=el('input');check.type='checkbox';check.checked=info.reminders;const label=el('label','tool-field','Remind me after 30 days');label.prepend(check);check.onchange=()=>api.workbench('reminders',{enabled:check.checked});d.append(label,action('Create backup…',async()=>{const button=d.querySelector('button:last-child');button.disabled=true;try{const result=await api.workbench('backup');if(result.at){state.backup=result;notify('Library backup saved.');d.close();}}finally{if(button.isConnected)button.disabled=false;}}));}
 async function created(key,kind){const icon=pendingIcons[kind];if(icon){state.icons=await api.workbench('icon',{key,icon});delete pendingIcons[kind];renderNav();}}
 function init(){for(const [selector,kind]of [['#canvas-name-label','canvas'],['#folder-dialog form','collection'],['#action-form','collection']]){const parent=$(selector);const b=action('Choose icon…',()=>{if(kind==='canvas'&&CanvasWorkspace.dialog?.renameId)return pickIcon('canvas:'+CanvasWorkspace.dialog.renameId);return pickIcon(null,value=>{pendingIcons[kind]=value;b.textContent=value.type==='emoji'?value.value:'Icon: '+value.value;});});b.type='button';b.className='creation-icon';/* In dialogs the icon picker sits on the same line as Cancel and the primary action. */const actions=parent.querySelector('.dialog-actions');if(actions)actions.prepend(b);else parent.append(b);}for(const [selector,name]of [['#close-preview','close'],['#settings-close','close'],['#health-close','close'],['#activity-close','close'],['#canvas-tray-close','close'],['#canvas-zoom-out','minus'],['#canvas-zoom-in','plus'],['#add-canvas','plus'],['#add-folder','plus'],['#new-note','plus']]){const n=$(selector);if(n)n.replaceChildren(glyph(name));}const search=$('.search');const searchIcon=search.querySelector('.search-glyph');if(searchIcon){if(!searchIcon.firstChild)searchIcon.append(glyph('search'));}else if(search.firstChild?.nodeType===3)search.firstChild.replaceWith(glyph('search'));api.onHistoryCommand(redo=>{const focused=document.activeElement;if(focused?.matches('input,textarea,[contenteditable=true]')){document.execCommand(redo?'redo':'undo');return;}if(view==='canvas')CanvasWorkspace.undo(redo);else if(view!=='notes')safe(()=>history(redo));});// Settings opens these tools in their own window and comes straight back.
 const fromSettings=fn=>async()=>{const pane=SettingsUI.currentPane;$('#settings-dialog').close();const dialog=await fn();if(dialog&&dialog.addEventListener)dialog.addEventListener('close',()=>SettingsUI.open(pane),{once:true});};
 $('#settings-backup').onclick=fromSettings(backupSettings);
 $('#settings-duplicate-review').onclick=fromSettings(duplicateReview);
 $('#settings-beta').onclick=fromSettings(beta);
 $('#settings-all-shortcuts').onclick=fromSettings(shortcuts);
 document.addEventListener('keydown',e=>{if(!(e.metaKey||e.ctrlKey))return;const typing=e.target.matches?.('input,textarea,select,[contenteditable=true]');if(e.key==='/'&&!typing){e.preventDefault();e.stopImmediatePropagation();shortcuts();}else if(e.key.toLowerCase()==='z'&&!typing&&view!=='canvas'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopImmediatePropagation();safe(()=>history(e.shiftKey));}},true);
 }
 function beta(){const d=dialog('Beta testing and feedback');d.append(el('p','hint','Use a disposable library for destructive tests. Try import, preview, search, canvas edits, backup and reopening on several Apple Silicon Macs. Real testers are still needed before a public launch.'));const steps=['Create a new library and reopen it','Import images, audio, videos, PDFs and bookmarks','Test shortcuts, undo, selection and duplicate review','Create a canvas; move, resize and export items','Back up, then open the backup as an existing library','Check large-library scrolling and local search','Test light/dark and Reduce Motion'];for(const text of steps){const l=el('label','tool-field'),check=el('input');check.type='checkbox';l.append(check,document.createTextNode(text));d.append(l);}const notes=field('','What happened? Include steps, expected result and actual result.',()=>{},true);d.append(notes,action('Save feedback report…',async()=>{await api.saveReport({notes:notes.value,checks:[...d.querySelectorAll('label')].map(l=>({test:l.textContent,passed:l.querySelector('input').checked}))});}));}
 return{init,created,setData,reset,accepts,rank,rankOrder,icon,pickIcon,similar,findColor,recovery,shortcuts,get title(){return title;}};
})();
