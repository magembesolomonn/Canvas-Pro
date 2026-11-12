(()=>{
  if(globalThis.__canvasQuickSaveInstalled) return; globalThis.__canvasQuickSaveInstalled=true;
  const canUseRuntime=()=>{try{return !!(globalThis.chrome?.runtime?.id && globalThis.chrome?.runtime?.sendMessage);}catch{return false;}};
  const abs=v=>{try{return v?new URL(v,location.href).href:''}catch{return ''}};
  const direct=u=>{try{const url=new URL(u,location.href);return /^https?:$/.test(url.protocol)?url.href:''}catch{return ''}};
  const contextInvalidated=e=>/Extension context invalidated/i.test(String(e?.message||e||''));

  function appleVideo(el){
    const v=el?.closest?.('video')||el?.querySelector?.('video')||el;
    const base=v?.getAttribute?.('data-inline-media-basepath');
    if(!base) return '';
    try{const url=new URL(base,location.href); if(url.pathname.includes('/105/media/')) return new URL('large.mp4',url.href.endsWith('/')?url.href:url.href+'/').href;}catch{}
    return '';
  }
  function videoURL(el){
    const v=el?.closest?.('video')||(el?.tagName==='VIDEO'?el:null);
    if(!v) return '';
    const apple=appleVideo(v); if(apple) return apple;
    const src=direct(v.currentSrc||v.src); if(src && !src.startsWith('blob:')) return src;
    for(const s of v.querySelectorAll('source')){
      const u=direct(s.src||s.getAttribute('src')); if(u && !u.startsWith('blob:') && /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(u)) return u;
    }
    const root=v.closest('figure,section,article,div,li')||v.parentElement||document;
    const attrs=['src','data-src','data-url','data-video-url','data-mp4','data-file','content','href'];
    const nodes=[v,...root.querySelectorAll('source,meta,script,a,*')].slice(0,500);
    for(const n of nodes){
      for(const a of attrs){
        const val=(n.getAttribute?.(a)||'').replaceAll('\\/','/');
        if(!val) continue;
        const m=val.match(/https?:\/\/[^\s"'<>]+?\.(?:mp4|m4v|mov|webm)(?:\?[^\s"'<>]*)?/i);
        if(m && !/\.m3u8|\.mpd/i.test(m[0])) return m[0];
      }
      if(n.tagName==='SCRIPT'){
        const t=(n.textContent||'').slice(0,300000).replaceAll('\\/','/');
        if(t.includes('.mp4')||t.includes('/105/media/')){
          const m=t.match(/https?:\/\/[^\s"'<>"]+\/105\/media\/[^\s"'<>"]*?\/(?:large|[^/\s"'<>"]+)\.mp4[^\s"'<>"]*/i) || t.match(/https?:\/\/[^\s"'<>"]+\.mp4(?:\?[^\s"'<>"]*)?/i);
          if(m && !/\.m3u8|\.mpd/i.test(m[0])) return m[0];
        }
      }
    }
    try{
      const entries=performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/\.mp4(?:[?#]|$)/i.test(n)&&!/\.m3u8|\.mpd/i.test(n));
      if(entries.length) return entries[entries.length-1];
    }catch{}
    return '';
  }
  function imageURL(el){
    const img=el?.closest?.('img')||(el?.tagName==='IMG'?el:null);
    if(img){
      const src=abs(img.currentSrc||img.src||img.getAttribute('data-src')||img.getAttribute('data-original'));
      if(src) return {url:src, alt:img.alt||'', width:img.naturalWidth||0, height:img.naturalHeight||0};
    }
    let node=el;
    for(let i=0;i<5&&node;i++,node=node.parentElement){
      try{const bg=getComputedStyle(node).backgroundImage||''; const m=bg.match(/url\(["']?(.+?)["']?\)/); if(m&&m[1]&&m[1]!=='none'&&!m[1].startsWith('data:,')) return {url:abs(m[1]),alt:'',width:0,height:0};}catch{}
    }
    return null;
  }
  function postElement(target){
    const selectors=['article[data-testid="tweet"]','[data-testid="tweet"][role="article"]','article','shreddit-post','[data-testid="post-container"]','[data-test-id="pin"]','[data-test-id="pinWrapper"]','[data-e2e="recommend-list-item-container"]','[data-pressable-container="true"]'];
    for(const s of selectors){ const el=target?.closest?.(s); if(el) return el; }
    return target?.closest?.('[role="article"]');
  }
  function pickMedia(target,point,preferVideo=false){
    const path=(typeof target?.composedPath==='function'?target.composedPath():[target]).filter(Boolean);
    const candidates=[...path];
    if(point && Number.isFinite(point.x)){
      try{ for(const el of document.elementsFromPoint(point.x,point.y)||[]) candidates.push(el, el?.shadowRoot?.elementFromPoint?.(point.x,point.y)); }catch{}
    }
    let imgInfo=null, sawVideo=false, videoEl=null;
    for(const el of candidates){
      const vEl=el?.closest?.('video')||(el?.tagName==='VIDEO'?el:null);
      if(vEl){sawVideo=true; videoEl=videoEl||vEl;}
      const vurl=videoURL(el);
      if(vurl) return {kind:'video', mediaUrl:vurl, title:document.title, poster:abs(vEl?.poster||el?.closest?.('video')?.poster||''), width:vEl?.videoWidth||0, height:vEl?.videoHeight||0, videoEl};
      if(!imgInfo){ const i=imageURL(el); if(i) imgInfo={kind:'image', mediaUrl:i.url, title:i.alt||document.title, alt:i.alt||'', width:i.width, height:i.height, poster:i.url}; }
    }
    if(preferVideo && sawVideo) return {kind:'video', missing:true, videoEl};
    return imgInfo;
  }

  function miniToast(text,ok=true,thumb='',detail=''){
    try{
      let host=document.getElementById('__canvas_qs_toast');
      if(!host){host=document.createElement('div');host.id='__canvas_qs_toast';host.attachShadow({mode:'open'});(document.documentElement||document.body).appendChild(host);} 
      const root=host.shadowRoot; const hasThumb=/^(https?:|data:image\/)/.test(thumb||'');
      root.innerHTML=`<style>:host{all:initial;position:fixed;top:16px;right:16px;z-index:2147483647}.t{display:flex;align-items:center;gap:12px;min-width:220px;max-width:340px;padding:10px 12px;border-radius:14px;color:#f5f5f7;background:rgba(28,28,30,.97);backdrop-filter:blur(18px);border:1px solid ${ok?'rgba(255,255,255,.12)':'rgba(255,110,110,.55)'};box-shadow:0 18px 44px rgba(0,0,0,.34);font:13px/1.4 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}.thumb{width:40px;height:40px;border-radius:10px;object-fit:cover;background:#3a3a3c;flex:none}.thumb[hidden]{display:none}.copy{display:flex;flex-direction:column;gap:1px;min-width:0}.title{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail{font-size:11.5px;color:rgba(245,245,247,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><div class="t"><img class="thumb" ${hasThumb?'':'hidden'} alt=""><div class="copy"><div class="title"></div><div class="detail"></div></div></div>`;
      if(hasThumb){const img=root.querySelector('.thumb'); img.src=thumb; img.referrerPolicy='no-referrer'; img.onerror=()=>img.hidden=true;}
      root.querySelector('.title').textContent=text;
      const d=root.querySelector('.detail'); d.textContent=detail || (ok?'':''); d.style.display=d.textContent?'':'none';
      clearTimeout(host._t); host._t=setTimeout(()=>host.remove(), ok?2500:3800);
    }catch{}
  }

  async function trySocialSave(target){
    const core=globalThis.CanvasSocialCore; if(!core) return false;
    const platform=core.platformFor(location.href); if(!platform) return false;
    const post=postElement(target)||target?.closest?.('main,[role="main"]'); if(!post) return false;
    try{
      const data=core.collect(post);
      if(!data || (!data.items?.length && !data.hasVideo)) return false;
      if(!canUseRuntime()){ miniToast('Reload this page to reconnect', false,'','Extension was reloaded'); return true; }
      await chrome.runtime.sendMessage({type:'social-save', post:data});
      return true;
    }catch(e){
      if(contextInvalidated(e)) miniToast('Reload this page to reconnect', false,'','Extension was reloaded');
      return false;
    }
  }

  async function saveItem(item,target){
    if(!canUseRuntime()){ miniToast('Reload this page to reconnect', false,'','Extension was reloaded'); return; }
    // On social platforms, prefer robust social/post resolution (handles X/reddit/instagram hidden streams)
    if((item?.missing || item?.kind==='video') && await trySocialSave(target)) return;
    if(item?.missing){ miniToast('No downloadable video found', false); return; }
    if(!item?.mediaUrl) return;
    try{
      await chrome.runtime.sendMessage({type:'quick-save', item:{...item, poster:item.poster||'', pageUrl:location.href, pageTitle:document.title}});
    }catch(e){
      if(contextInvalidated(e)) miniToast('Reload this page to reconnect', false,'','Extension was reloaded');
      else miniToast('Could not save', false,'',String(e?.message||e||''));
    }
  }

  async function quickSaveFromEvent(e){
    if(!e.altKey||!e.isTrusted) return false;
    if(!canUseRuntime()){ miniToast('Reload this page to reconnect', false,'','Extension was reloaded'); e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); return true; }
    const point={x:e.clientX??0,y:e.clientY??0};
    const item=pickMedia(e.target,point,true);
    if(item){
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      await saveItem(item, e.target);
      return true;
    }
    // on social platforms, Alt+click should save post media even if no direct element URL found
    if(globalThis.CanvasSocialCore?.platformFor?.(location.href)){
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      const ok=await trySocialSave(e.target);
      if(!ok) miniToast('Could not find media to save', false);
      return true;
    }
    // on non-social pages, try once more with broader discovery (Apple/perf) before giving up
    const broad=pickMedia(e.target,point,false);
    if(broad?.mediaUrl){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); await saveItem(broad,e.target); return true; }
    return false;
  }
  window.addEventListener('contextmenu',e=>{ quickSaveFromEvent(e); },true);
  window.addEventListener('mousedown',e=>{ if(e.altKey && e.button===2) quickSaveFromEvent(e); },true);
  window.addEventListener('auxclick',e=>{ if(e.altKey && e.button===2) quickSaveFromEvent(e); },true);
  window.addEventListener('click',e=>{
    if(!e.altKey||!e.isTrusted||e.button!==0) return;
    quickSaveFromEvent(e);
  },true);

  // Drag and drop saver overlay
  let host=null, inside=0, dragItem=null;
  function mount(){
    if(host||!document.documentElement) return host;
    host=document.createElement('div'); host.id='__canvas_drop_saver';
    host.style.cssText='position:fixed;left:0;right:0;bottom:0;height:0;z-index:2147483646;pointer-events:none';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>:host{all:initial}.wrap{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(14px);opacity:0;transition:opacity .16s ease,transform .16s ease;pointer-events:none}.wrap.show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}.target{display:flex;align-items:center;gap:12px;padding:14px 18px;border-radius:16px;background:rgba(28,28,30,.96);color:#fff;font:600 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 16px 44px #0007;border:1px solid #ffffff24;backdrop-filter:blur(18px);min-width:280px}.target.hot{background:#2f6fdf;border-color:#8ec0ff}.icon{width:30px;height:30px;border-radius:9px;background:#ffffff22;display:grid;place-items:center;flex:none}svg{width:16px;height:16px}.sub{font:12px -apple-system,system-ui;color:#ffffffd8;margin-top:2px;font-weight:500}</style>
    <div class="wrap"><div class="target"><span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19h14"/></svg></span><span><div>Drop to save to Canvas Pro</div><div class="sub">Images and videos</div></span></div></div>`;
    document.documentElement.appendChild(host);
    const wrap=shadow.querySelector('.wrap'), target=shadow.querySelector('.target');
    target.addEventListener('dragenter',e=>{e.preventDefault(); target.classList.add('hot');});
    target.addEventListener('dragover',e=>{e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect='copy'; target.classList.add('hot');});
    target.addEventListener('dragleave',()=>target.classList.remove('hot'));
    target.addEventListener('drop',async e=>{
      e.preventDefault(); e.stopPropagation(); target.classList.remove('hot'); hide();
      let item=dragItem;
      if(!item){
        const uri=(e.dataTransfer?.getData('text/uri-list')||e.dataTransfer?.getData('text/plain')||'').split('\n').find(s=>/^https?:/i.test(s.trim()));
        const html=e.dataTransfer?.getData('text/html')||'';
        const src=(html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]) || (uri?uri.trim():'');
        if(src) item={kind:/\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(src)?'video':'image', mediaUrl:abs(src), title:document.title, poster:abs(src)};
      }
      if(item?.mediaUrl) await saveItem(item, e.target); else miniToast('Drop an image or video', false);
    });
    host._wrap=wrap; host._target=target; return host;
  }
  function show(item){ dragItem=item||dragItem; mount(); host?._wrap?.classList.add('show'); }
  function hide(){ inside=0; dragItem=null; host?._wrap?.classList.remove('show'); host?._target?.classList.remove('hot'); }
  function hasMediaDrag(e){ const t=e?.dataTransfer?.types; if(!t) return false; return [...t].some(x=>/text\/uri-list|text\/plain|text\/html|Files/i.test(x)); }
  document.addEventListener('dragstart',e=>{ if(!e.isTrusted) return; const item=pickMedia(e.target,{x:e.clientX,y:e.clientY}); if(item){ dragItem=item; show(item); } },true);
  document.addEventListener('dragenter',e=>{ if(!e.isTrusted) return; if(!hasMediaDrag(e) && !dragItem) return; inside++; if(!dragItem){ const item=pickMedia(e.target,{x:e.clientX,y:e.clientY}); if(item) dragItem=item; } show(dragItem); },true);
  document.addEventListener('dragleave',e=>{ if(!inside) return; inside=Math.max(0,inside-1); if(inside===0) setTimeout(()=>{ if(inside===0) hide(); },150); },true);
  document.addEventListener('dragend',hide,true);
  document.addEventListener('drop',e=>{ if(e.target!==host && !host?.shadowRoot?.contains(e.target)) hide(); },true);
  window.addEventListener('blur',()=>setTimeout(hide,120));

})();
