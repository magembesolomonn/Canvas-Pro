// Runs in the isolated extension world. Never inserts page-provided HTML.
function canvasCaptureActivity(job,mount){
  let host=(mount||document).querySelector('[data-canvas-capture-activity]');
  if(!host){
    host=document.createElement('div'); host.dataset.canvasCaptureActivity='';
    if(!mount) host.style.cssText='all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;pointer-events:none';
    const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>:host{all:initial}*{box-sizing:border-box}
      .stack{display:flex;flex-direction:column;gap:10px;align-items:flex-end}
      .toast{position:relative;display:flex;align-items:center;gap:12px;width:min(340px,calc(100vw - 32px));padding:10px 12px 12px;color:#f5f5f7;background:rgba(28,28,30,.97);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 44px rgba(0,0,0,.34),0 2px 8px rgba(0,0,0,.2);font:13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;overflow:hidden;pointer-events:auto;animation:toast-in .22s cubic-bezier(.22,1,.36,1) both}
      .toast.leaving{animation:toast-out .18s ease both}
      .thumb{width:40px;height:40px;border-radius:10px;object-fit:cover;background:#3a3a3c;flex:none}
      .thumb[hidden]{display:none}
      .icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.10);flex:none}
      .icon svg{width:18px;height:18px;opacity:.95}
      .copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
      .title{font-weight:600;font-size:13px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .detail{font-size:11.5px;color:rgba(245,245,247,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .bar{position:absolute;left:0;right:0;bottom:0;height:2px;background:rgba(255,255,255,.22);transform-origin:left center;opacity:1}
      .toast.done .bar,.toast.failed .bar{display:none}
      .toast.failed{border-color:rgba(255,110,110,.55)}
      .toast.failed .icon{background:rgba(255,90,90,.18);color:#ff9a9a}
      .embedded .stack{align-items:stretch}
      .embedded .toast{width:100%}
      @keyframes toast-in{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes toast-out{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-6px) scale(.985)}}
    </style><div class="stack" role="status" aria-live="polite"></div>`;
    (mount||document.documentElement).append(host);
  }
  const root=host.shadowRoot;
  let row=[...root.querySelectorAll('.toast')].find(r=>r.dataset.id===job.id);
  if(!row){
    row=document.createElement('div'); row.className='toast'; row.dataset.id=job.id;
    row.innerHTML=`<div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></svg></div><img class="thumb" hidden alt=""><div class="copy"><div class="title"></div><div class="detail"></div></div><div class="bar"></div>`;
    root.querySelector('.stack').prepend(row);
  }
  const done=['complete','failed'].includes(job.state);
  row.classList.toggle('done', done && job.state!=='failed');
  row.classList.toggle('failed', job.state==='failed');
  const icon=row.querySelector('.icon'), thumb=row.querySelector('.thumb'), titleEl=row.querySelector('.title'), detailEl=row.querySelector('.detail'), bar=row.querySelector('.bar');
  const active=(job.items||[])[Math.min(job.done||0, Math.max(0,(job.items||[]).length-1))] || (job.items||[])[0];
  const src=job.thumbnail || active?.thumbnail || active?.poster || (active?.kind==='image' ? active?.mediaUrl : '');
  if(src && /^(https?:\/\/|data:image\/)/i.test(src)){
    if(thumb.dataset.source!==src){thumb.dataset.source=src; thumb.src=src;}
    thumb.hidden=false; icon.style.display='none';
    thumb.onerror=()=>{thumb.hidden=true; icon.style.display='grid';};
  } else { thumb.hidden=true; icon.style.display='grid'; }
  const kind=(job.kind || active?.kind || (job.title||'').toLowerCase().includes('video') ? (job.kind||active?.kind||'video') : (job.kind||active?.kind||'image'));
  const label = kind==='bookmark'||kind==='link' ? 'Link' : kind==='video' ? 'Video' : kind==='content' ? 'Page content' : kind==='screenshot' ? 'Screenshot' : 'Image';
  let headline;
  if(job.state==='failed') headline='Save failed';
  else if(done) headline = label+' saved to Canvas Pro';
  else if(job.phase==='discovering') headline='Finding media…';
  else if(job.phase==='importing') headline='Adding to Canvas Pro…';
  else headline=`Saving ${label.toLowerCase()}…`;
  titleEl.textContent = headline;
  let detail = '';
  if(job.state==='failed') detail = job.errors?.[0] || job.error || 'Something went wrong';
  else if(done){
    if((job.total||1)>1) detail = `${job.imported||0} saved · ${job.duplicates||0} already in library`;
    else detail = (active?.title || job.title || job.currentTitle || '').toString();
  } else {
    if((job.total||1)>1) detail = `Item ${Math.min((job.done||0)+1,job.total||1)} of ${job.total}`;
    else detail = (active?.title || job.title || job.currentTitle || 'Saving to your library').toString();
  }
  detailEl.textContent = detail;
  detailEl.style.display = detail ? '' : 'none';
  if(!done){
    const progress = job.total ? Math.max(0.08, Math.min(0.95, ((job.done||0) + (job.phase==='importing'?0.8:0.25)) / Math.max(1,job.total))) : 0.35;
    bar.style.transform = `scaleX(${progress})`;
  } else { bar.style.transform='scaleX(1)'; }
  clearTimeout(row._dismiss);
  if(!mount){
    if(done){
      row._dismiss=setTimeout(()=>{ row.classList.add('leaving'); setTimeout(()=>{ row.remove(); if(!root.querySelector('.toast')) host.remove(); }, 180); }, 2200);
    } else {
      row._dismiss=setTimeout(()=>{ /* keep visible while active, safety */ }, 12000);
    }
  }
}
