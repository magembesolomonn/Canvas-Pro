let importJobs=[],latestHealth={state:'idle'};
const importLabels={queued:'Queued',running:'Importing',cancelling:'Stopping…',cancelled:'Cancelled',completed:'Finished',failed:'Failed',duplicate:'Already in library',importing:'Importing',skipped:'Skipped'};
const flipAnimations=new WeakMap();
function renderImportActivity(jobs=importJobs){
 const previousIds=new Set(importJobs.map(job=>job.id));
 importJobs=jobs;const active=jobs.filter(j=>['queued','running','cancelling'].includes(j.state)).length;
 if(!$('#activity-dialog').open)return;
 const list=$('#import-jobs');
 // FLIP: remember where each existing row was before the list is reordered.
 const animateOrder=matchMedia('(prefers-reduced-motion: no-preference)').matches;
 const firstTops=new Map();
 if(animateOrder)for(const card of list.children)firstTops.set(card,card.getBoundingClientRect().top);
 if(!jobs.length){list.replaceChildren(el('p','hint','Your imports will appear here.'));return;}
 const jobIds=new Set(jobs.map(job=>job.id)), cards=new Map();
 for(const card of [...list.children]){
  if(jobIds.has(card.dataset.jobId))cards.set(card.dataset.jobId,card);
  else card.remove();
 }
 for(const [index,job] of jobs.entries()){
  const card=cards.get(job.id)||el('section','import-job');
  card.dataset.jobId=job.id;
  if(!previousIds.has(job.id)&&matchMedia('(prefers-reduced-motion: no-preference)').matches){
   card.classList.add('is-new');
   const finish=()=>card.classList.remove('is-new');
   card.addEventListener('animationend',finish,{once:true});
   card.addEventListener('animationcancel',finish,{once:true});
  }
  const heading=el('div','job-heading');heading.append(el('strong','',job.state==='completed'&&job.failed?'Finished with errors':importLabels[job.state]||job.state));
  if(['queued','running'].includes(job.state))heading.append(action('Cancel',async()=>renderImportActivity(await api.cancelImport(job.id))));
  else if(job.canRetry)heading.append(action(job.state==='cancelled'?'Retry import':'Retry failed',()=>importing(()=>api.retryImport(job.id))));
  card.replaceChildren(heading,el('p','hint',`${job.imported} imported · ${job.duplicates} already in library${job.failed?' · '+job.failed+' failed':''}${job.skipped?' · '+job.skipped+' skipped':''}`));
  if(job.error)card.append(el('p','import-error',job.error));
  for(const entry of job.entries){const row=el('div','import-entry');row.title=entry.error||entry.path;row.append(el('span','',entry.name),el('span',entry.state==='failed'?'import-failed':'hint',entry.state==='completed'?'Imported':importLabels[entry.state]||entry.state));if(entry.error)row.append(el('small','import-error',entry.error));card.append(row);}
  if(job.processed>job.entries.length)card.append(el('p','hint','Showing the 50 most recent file results.'));
  const current=list.children[index];
  if(current!==card)list.insertBefore(card,current||null);
 }
 // Animate surviving rows from their old positions to the new ones.
 if(animateOrder)for(const card of list.children){
  const first=firstTops.get(card);
  if(first===undefined)continue;
  const delta=first-card.getBoundingClientRect().top;
  if(Math.abs(delta)<0.5)continue;
  flipAnimations.get(card)?.cancel();
  let settled=false;
  const animation=Motion.animateNumber({
   from:delta,to:0,
   render:value=>{card.style.transform=`translateY(${value}px)`;},
   onFinish:()=>{settled=true;card.style.transform='';flipAnimations.delete(card);}
  });
  if(!settled)flipAnimations.set(card,animation);
 }
}
function renderHealth(state=latestHealth){
 latestHealth=state;const running=state.state==='running',result=state.result;
 $('#health-run').disabled=running;$('#health-run').textContent=result?'Check again':'Check originals';$('#health-cancel').hidden=!running;$('#health-progress').hidden=!running;
 $('#health-progress').max=Math.max(1,result?.total||1);$('#health-progress').value=result?.checked||0;
 const summary=$('#health-summary');
 if(state.state==='failed')summary.textContent='The check could not finish. '+state.error;
 else if(state.state==='cancelled')summary.textContent='Check cancelled. Your files were not changed.';
 else if(running)summary.textContent=result?.total?`Checking ${result.checked.toLocaleString()} of ${result.total.toLocaleString()} originals…`:'Starting the check…';
 else if(state.state==='completed')summary.textContent=result.issues.length?`${result.issues.length===1?'1 file needs attention.':result.issues.length.toLocaleString()+' files need attention.'} ${result.healthy.toLocaleString()} ${result.healthy===1?'original matches its record':'originals match their records'}.`:`All ${result.checked.toLocaleString()} originals match their records.`;
 else summary.textContent='Ready to check your library.';
 const list=$('#health-issues');list.replaceChildren();
 const labels={missing:'Missing original',mismatch:'Hash or size differs',unsafe:'Unexpected file location',unreadable:'Could not read file',changed:'Changed during check'};
 for(const issue of (result?.issues||[]).slice(0,100)){const row=el('div','health-issue');row.append(el('strong','',issue.name),el('span','hint',labels[issue.type]||issue.type));row.title=issue.detail;if(issue.type==='missing')row.append(action('Locate original…',()=>WorkbenchUI.recovery(issue)));list.append(row);}
 if(result?.issues.length>100)list.append(el('p','hint','Showing the first 100 issues. No files have been changed.'));
}
function initReliabilityUI(){
 SettingsUI.init();
 $('#show-settings .settings-icon').append(glyph('settings'));
 $('#show-settings').onclick=()=>{stopHover();SettingsUI.open();safe(async()=>{const info=await api.libraryLocation();$('#current-library-name').textContent=info.name;$('#current-library-path').textContent=info.root;});};
 $('#new-library').onclick=()=>safe(()=>api.switchLibrary('new'));$('#open-library').onclick=()=>safe(()=>api.switchLibrary('open'));
 $('#settings-close').onclick=()=>$('#settings-dialog').close();
 $('#activity-close').onclick=()=>$('#activity-dialog').close();
 $('#health-close').onclick=()=>$('#health-dialog').close();$('#health-show-library').onclick=()=>safe(()=>api.showLibrary());
 $('#health-run').onclick=()=>safe(async()=>renderHealth(await api.startHealth()));$('#health-cancel').onclick=()=>safe(async()=>renderHealth(await api.cancelHealth()));
 api.onImportState(renderImportActivity);api.onHealthState(state=>{latestHealth=state;if($('#health-dialog').open)renderHealth(state);});
 safe(async()=>renderImportActivity(await api.importState()));
}
