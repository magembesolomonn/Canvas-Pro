const SmartSearch=(()=>{
 let worker,modelReady=false,serial=0,pending=new Map(),enabled=localStorage.getItem('local-ai-enabled')!=='false',indexTimer,queryTimer,queryVersion=0;
 let visualQuery='',matches=null,matchedQuery='',status='Local search ready',indexing=false,workChanged=false;
 let workerIdleTimer,waitingForVisualRetry=false;
 let visualMatches=null,visualMode=false,visualVersion=0;
 const indexingPause=delay=>new Promise(resolve=>setTimeout(resolve,delay));
 function releaseIdleWorker(){
   clearTimeout(workerIdleTimer);
   if(!worker||indexing||pending.size)return;
   workerIdleTimer=setTimeout(()=>{
     if(worker&&!indexing&&!pending.size){worker.terminate();worker=null;}
   },60000);
 }
 function call(type,data={}){
   clearTimeout(workerIdleTimer);
   if(!worker){
     worker=new Worker('semantic-worker.js',{type:'module'});
     worker.onmessage=({data})=>{
       const item=pending.get(data.id);
       if(!item)return;
       pending.delete(data.id);
       if(data.error)item.reject(Error(data.error));else item.resolve(data.vector);
       releaseIdleWorker();
     };
     worker.onerror=event=>{
       for(const item of pending.values())item.reject(Error(event.message||'Local model could not start'));
       pending.clear();worker.terminate();worker=null;
     };
   }
   const id=++serial;
   return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,type});worker.postMessage({id,type,...data});});
 }
 function updateStatus(text){status=text;const node=$('#smart-search-status');if(node)node.textContent=text;}
 function start(){
   if(!enabled)return;
   modelReady=true;
   updateVisualButton();
   wakeIndex();
 }
 function wakeIndex(reason){
   if(!enabled||!modelReady)return;
   workChanged=true;
   if(reason&&indexing&&worker&&[...pending.values()].every(item=>item.type!=='text')){
     worker.terminate();worker=null;
     for(const item of pending.values())item.reject(Error('Background indexing paused'));
     pending.clear();
   }
   clearTimeout(indexTimer);
   if(!indexing)indexTimer=setTimeout(index,120);
 }
 async function index(){
   if(!enabled||!modelReady||indexing)return;
   indexing=true;
   let retryAt,modelLoaded=false;
   try{
     while(enabled&&modelReady){
       workChanged=false;
       const work=await api.smartNextWork();
       if(!enabled||!modelReady)break;
       if(workChanged)continue;
       if(work.paused){
         const reason={manual:'manually',battery:'while on battery power',thermal:'while the Mac cools down',active:'until the Mac is idle'}[work.paused];
         updateStatus('Background indexing paused '+reason+' · visual search available');
         break;
       }
       if(!work.ids){
         retryAt=work.retryAt;
         waitingForVisualRetry=!!retryAt;
         updateStatus(retryAt?'Some images could not be indexed · waiting to retry':'Visual search ready · files stay on this Mac');
         break;
       }
       waitingForVisualRetry=false;
       if(!modelLoaded){
         await call('load');
         modelLoaded=true;
         if(workChanged)continue;
       }
       updateStatus('Indexing images locally…');
       for(const id of work.ids){
         if(!enabled||workChanged)break;
         let vector;
         try{vector=await call('image',{assetId:id});}
         catch(error){
           if(!enabled||workChanged)break;
           if(!worker)throw error;
           await api.smartVectorSkip(id);
           if(!workChanged)await indexingPause(work.delay);
           continue;
         }
         if(enabled)await api.smartVector(id,vector);
         if(!workChanged)await indexingPause(work.delay);
       }
     }
   }catch(error){
     if(enabled&&!workChanged)updateStatus('Indexing paused: '+error.message);
   }finally{
     indexing=false;
     releaseIdleWorker();
     if(enabled&&modelReady){
       if(workChanged)wakeIndex();
       else if(retryAt)indexTimer=setTimeout(index,Math.max(0,retryAt-Date.now()));
     }
   }
 }
 function stop(){resetVisualSearch();enabled=false;localStorage.setItem('local-ai-enabled','false');modelReady=false;workChanged=true;clearTimeout(indexTimer);clearTimeout(workerIdleTimer);for(const item of pending.values())item.reject(Error('Visual search paused'));pending.clear();worker?.terminate();worker=null;updateVisualButton();render();updateStatus('Visual search off · text and automatic tags remain searchable');}
 function updateVisualButton(){
   const button=$('#visual-search');
   button.hidden=!enabled||!modelReady||!$('#search').value.trim();
   button.setAttribute('aria-pressed',String(visualMode));
   button.setAttribute('aria-busy',String(!!visualQuery));
 }
 function resetVisualSearch(){
   visualVersion++;
   visualMode=false;
   visualMatches=null;
   visualQuery='';
 }
 // The model on this Mac reads the words as well as the files: the same
 // search also returns the pictures that show what you asked for.
 async function semanticSearch(query,version){
  const current=()=>version===queryVersion&&query===$('#search').value.trim();
  visualMode=true;visualQuery='Looking for images that match…';
  updateVisualButton();updateActivityLabel();
  try{
   const vector=await call('text',{text:query});
   if(!current())return;
   const ids=await api.smartSearch(query,vector);
   if(!current())return;
   visualMatches={query:query.toLowerCase(),ids:new Set(ids)};
   visualQuery=query.toLowerCase();
   render();
  }catch(error){
   if(current()){visualMode=false;visualMatches=null;updateStatus(error.message);render();}
  }finally{
   if(current()){updateVisualButton();updateActivityLabel();}
  }
 }
 function schedule(){
  clearTimeout(queryTimer);
  resetVisualSearch();
  const query=$('#search').value.trim();
  const version=++queryVersion;
  matches=null;matchedQuery='';
  updateVisualButton();updateActivityLabel();
  if(!query)return;
  queryTimer=setTimeout(async()=>{
   try{
    const lexical=await api.smartSearch(query);
    if(version!==queryVersion||query!==$('#search').value.trim())return;
    matches=new Set(lexical);matchedQuery=query;
    if(matches.size)render();
    // The local model waits a moment, so typing stays quick.
    if(enabled&&modelReady)setTimeout(()=>{if(version===queryVersion)semanticSearch(query,version);},180);
   }catch(error){
    if(version===queryVersion)updateStatus(error.message);
   }
  },90);
 }
 async function toggleVisualSearch(){
   const query=$('#search').value.trim();
   if(!enabled||!modelReady||!query)return;
   if(visualMode){
     resetVisualSearch();updateVisualButton();updateActivityLabel();render();return;
   }
   const version=++visualVersion;
   const current=()=>version===visualVersion&&query===$('#search').value.trim();
   visualMode=true;visualQuery='Visual results loading…';
   updateVisualButton();updateActivityLabel();
   try{
     const vector=await call('text',{text:query});
     if(!current())return;
     const ids=await api.smartSearch(query,vector);
     if(!current())return;
     visualMatches={query:query.toLowerCase(),ids:new Set(ids)};
     render();
   }catch(error){
     if(current()){visualMode=false;notify(error.message);}
   }finally{
     if(current()){visualQuery='';updateVisualButton();updateActivityLabel();}
   }
 }
 function includes(a,query){
   return a.searchText.includes(query)||(matchedQuery.toLowerCase()===query&&matches?.has(a.id))||
     (visualMatches?.query===query&&visualMatches.ids.has(a.id));
 }
 function resultIds(query){
   const lexical=matchedQuery.toLowerCase()===query&&matches?[...matches]:[];
   return visualMatches?.query===query?[...new Set([...lexical,...visualMatches.ids])]:lexical;
 }
 let lastIndexState;
 function updateActivityLabel(){
   const button=$('#ai-activity');
   if(!button||!lastIndexState)return;
   const state=lastIndexState,reason=state.paused?'manual':state.powerPause;
   const labels={manual:'Paused manually',battery:'Waiting for power',thermal:'Waiting for Mac to cool',active:'Waiting for 1 minute of idle time'};
   const remaining=Math.max(0,state.total-state.indexed);
   const label=button.querySelector('.ai-activity-label');
   if(label)label.textContent=visualQuery||labels[reason]||(indexing?'Indexing images…':state.running?'Reading files…':remaining?'AI · '+remaining+' left':enabled&&waitingForVisualRetry?'AI · Retry pending':'AI · Ready');
   button.title=remaining+' files left for local analysis'+(modelReady?' · '+state.visualRemaining+' left for visual search':'');
 }
 function init(){
 const visualButton=$('#visual-search');visualButton.append(glyph('sparkles'));visualButton.onclick=toggleVisualSearch;
 const box=el('section','smart-settings');const description=el('p','hint','On-device text recognition, automatic tags and colour palettes. Visual search uses an optional 156 MB CLIP model download; your files and queries stay on this Mac.');const progress=el('p','hint');progress.id='smart-index-progress';const modelStatus=el('p','hint');modelStatus.id='smart-search-status';modelStatus.textContent=status;const download=action('Download local visual model',async()=>{download.disabled=true;try{const model=await api.modelDownload();if(model.ready){enabled=true;localStorage.setItem('local-ai-enabled','true');start();}}finally{download.disabled=false;}});const cancel=action('Cancel download',()=>api.modelCancel());cancel.hidden=true;const pause=action('Pause background indexing',async()=>{const state=await api.smartState(),next=await api.smartPause(!state.paused);pause.textContent=next.paused?'Resume background indexing':'Pause background indexing';});const idle=el('input');idle.type='checkbox';
 const idleLabel=el('label','ai-idle-policy');idleLabel.append(idle,el('span','','Only while idle and plugged in'));
 idle.onchange=()=>safe(async()=>{lastIndexState=await api.smartIdlePolicy(idle.checked);updateActivityLabel();});
 const retry=action('Retry failed indexing',async()=>{await api.workbench('retry-index');});
 // Rows, not a wall of prose: a title, a value, and the actions in one line.
 const row=(title,value)=>{const r=el('div','settings-row settings-row-plain');const copy=el('span','settings-copy');copy.append(el('strong','',title),el('small','settings-subtle',value));r.append(copy);return r;};
 const statusRow=el('div','settings-row settings-row-plain');const statusCopy=el('span','settings-copy');statusCopy.append(el('strong','','Status'));statusRow.append(statusCopy);
 const actions=el('div','settings-row settings-row-actions settings-ai-actions');
 actions.append(download,cancel,pause,retry);
 box.append(row('On-device analysis','Text recognition, automatic tags and colour palettes. Visual search uses an optional 156 MB CLIP model; your files and queries stay on this Mac.'),statusRow,progress,modelStatus,actions,idleLabel);$('#settings-local-intelligence').append(box);
 api.onSmartWork(wakeIndex);
 api.onModelProgress(model=>{download.disabled=model.state==='downloading';cancel.hidden=model.state!=='downloading';download.textContent=model.ready?'Verify / repair local model':'Download local visual model';updateStatus(model.state==='downloading'?'Downloading model · '+Math.round(model.bytes/model.total*100)+'%':model.error||status);});
 api.onSmartChanged(({id,smart,name})=>{const a=assetById.get(id);if(!a)return;a.smart=smart;if(name&&name!==a.name){a.name=name;const card=mounted.get(id);const label=card?.querySelector('.card-name');if(label)label.textContent=name;card?.setAttribute('aria-label',name);}a.searchText=SmartCards.enrichSearch(a);if(SmartCards.isNote(a)){const card=mounted.get(id),surface=card?.querySelector('.card-surface');if(surface&&!surface.querySelector('.smart-note-card')){surface.querySelector('img,.file-placeholder')?.remove();surface.prepend(SmartCards.fileVisual(a));layoutDirty=true;scheduleGallery();}}if(selected===id&&!document.activeElement?.matches('input,textarea,select,[contenteditable=true]'))scheduleInspector();});
 const activity=action('',()=>SettingsUI.open('experimental'));
 activity.id='ai-activity';activity.append(glyph('sparkles'),el('span','ai-activity-label','AI activity'));
 // The footer carries one message. The index status belongs in the sidebar.
 $('.sidebar-bottom').prepend(activity);
 let polling=false,lastPoll=0;
 async function poll(){
   if(polling||document.hidden||(!$('#settings-dialog').open&&Date.now()-lastPoll<10000))return;
   polling=true;lastPoll=Date.now();
   try{
     const state=lastIndexState=await api.smartState();
     idle.checked=state.idleOnly;
     const reason={battery:'On battery power',thermal:'Mac temperature is high',active:'Mac is in use',manual:'Paused manually'}[state.paused?'manual':state.powerPause];
     const remaining=Math.max(0,state.total-state.indexed);
     progress.textContent=(reason|| (indexing?'Indexing images':state.running?'Reading files':remaining?'Waiting to index':'Local analysis complete'))+' · '+remaining+' files left'+(modelReady?' · '+state.visualRemaining+' visual embeddings left':'')+(state.failed?' · '+state.failed+' unavailable':'');
     pause.textContent=state.paused?'Resume background indexing':'Pause background indexing';
     updateActivityLabel();
   }finally{polling=false;}
 }
 // An adaptive poll instead of a fixed 4 second timer: wake up often while the
 // index is working, back off to half a minute when nothing is happening, and
 // stay out of the way entirely while the window is hidden.
 let pollTimer=0;
 function schedulePoll(delay){
   clearTimeout(pollTimer);
   pollTimer=setTimeout(async()=>{await poll().catch(()=>{});schedulePoll(nextDelay());},delay);
 }
 function nextDelay(){
   if(document.hidden)return 30000;
   const state=lastIndexState;
   return state&&(state.running||indexing)?4000:15000;
 }
 schedulePoll(750);
 setTimeout(()=>api.modelState().then(model=>{
   download.textContent=model.ready?'Enable / verify local visual search':'Download local visual model';
   if(enabled){if(model.ready)setTimeout(start,1500);else updateStatus('Local model download needed');}
 }).catch(()=>{}),500);
 }
 async function setEnabled(value){
  if(value===enabled)return enabled;
  if(!value){stop();return false;}
  const model=await api.modelState();
  if(!model.ready){notify('Download the local model first.');return enabled;}
  enabled=true;localStorage.setItem('local-ai-enabled','true');start();updateActivityLabel();return enabled;
 }
 async function ensureVisualModel(){
  const model=await api.modelState();
  if(model.ready)return true;
  notify('Downloading the local visual model…');
  const next=await api.modelDownload();
  if(next&&next.ready){enabled=true;localStorage.setItem('local-ai-enabled','true');start();updateActivityLabel();}
  return !!(next&&next.ready);
 }
 function libraryTags(){
  const set=new Set();
  for(const asset of (typeof assets!=='undefined'?assets:[]))for(const tag of (asset.tags||[]))if(tag&&tag.length<=40)set.add(tag);
  return [...set];
 }
 function similarity(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return 0;
  let sum=0;
  for(let index=0;index<a.length;index++)sum+=a[index]*b[index];
  return sum;
 }
 // Tag suggestions come from the model on this Mac: the picture is compared
 // with the words, and the closest ones are offered. Nothing leaves the Mac.
 async function suggestTags(assetId,onTags){
  if(!enabled||!modelReady){onTags([],'Turn on local intelligence in Settings → Experimental to get tag suggestions.');return;}
  const vector=await call('image',{assetId});
  const candidates=[...new Set([...libraryTags(),...TAG_VOCABULARY])].filter(tag=>tag&&tag.length<=40).slice(0,180);
  const vectors=await call('texts',{texts:candidates});
  const scored=candidates.map((tag,index)=>({tag,score:similarity(vector,vectors?.[index])}))
   .filter(item=>item.score>=0.2)
   .sort((a,b)=>b.score-a.score)
   .slice(0,10);
  onTags(scored.map(item=>item.tag));
 }
 return{init,schedule,includes,call,start,resultIds,setEnabled,ensureVisualModel,suggestTags,get enabled(){return enabled;},get visualModelReady(){return modelReady;}};
})();
