(()=>{
 const platform=CanvasSocialCore.platformFor(location.href);
 if(platform==='instagram.com'){
  window.addEventListener('canvas-instagram-media',event=>{
   if(typeof event.detail!=='string'||event.detail.length>300000)return;
   try{CanvasSocialCore.rememberInstagramMedia(JSON.parse(event.detail));}catch{}
  });
 }
 let focused=null;
 document.addEventListener('contextmenu',event=>{
  if(!event.isTrusted)return;
  focused={at:Date.now(),url:location.href,item:CanvasSocialCore.focusedMedia(event)};
 },true);
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id===chrome.runtime.id&&message.type==='focused-media'){
   respond(focused?.url===location.href&&Date.now()-focused.at<120000?focused.item:null);
   focused=null;
  }
 });
 const x=platform==='x.com'||platform==='twitter.com';
 const selectors={
  'instagram.com':'article',
  'reddit.com':'shreddit-post,.thing[data-fullname],[data-testid="post-container"]',
  'pinterest.com':'[data-test-id="pin"],[data-test-id="pinWrapper"]',
  'facebook.com':'[role="article"],article',
  'tiktok.com':'[data-e2e="recommend-list-item-container"],[data-e2e="feed-video"]',
  'threads.com':'[data-pressable-container="true"],article',
  'threads.net':'[data-pressable-container="true"],article',
  'bsky.app':'[data-testid^="feedItem-by-"],[data-testid^="postThreadItem-by-"]',
  'linkedin.com':'.feed-shared-update-v2,[data-urn^="urn:li:activity:"]',
  'youtube.com':'ytd-reel-video-renderer[is-active],ytd-watch-flexy:not([hidden]) #player-container-inner'
 };
 const selector=x?'article[data-testid="tweet"],[data-testid="tweet"][role="article"]':selectors[platform];
 if(!selector)return;
 const additionalSites=!x&&!['instagram.com','reddit.com','pinterest.com'].includes(platform);
 let scheduled=false;
 const buttons=new WeakMap();
 function install(post){
  if(buttons.get(post)?.isConnected)return;
  if(post.parentElement?.closest(selector))return;
  const host=document.createElement('span');host.dataset.canvasPostSave='';host.style.cssText='display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;vertical-align:middle;z-index:10';buttons.set(post,host);const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>button{all:initial;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;cursor:pointer;transition:background .15s}button:hover{background:#8882}button:focus-visible{outline:2px solid #aaa;outline-offset:2px}button:disabled{opacity:.55;cursor:progress}img{width:21px;height:21px;object-fit:contain}.label{font:11px -apple-system,sans-serif;position:absolute;top:35px;right:0;white-space:nowrap;background:#242424;color:#fff;padding:5px 8px;border-radius:5px;display:none}button:hover+.label{display:block}@media(prefers-reduced-motion:reduce){button{transition:none}}</style><button type="button" aria-label="Save post media to Canvas Pro" title="Save post media to Canvas Pro"><img alt=""></button><span class="label">Save to Canvas Pro</span>';shadow.querySelector('img').src=chrome.runtime.getURL('icons/32.png');const button=shadow.querySelector('button'),label=shadow.querySelector('.label');
  button.onclick=async event=>{event.preventDefault();event.stopPropagation();button.disabled=true;label.textContent='Finding post media…';try{if(!chrome.runtime?.id)throw new Error('Reload this page to reconnect Canvas Pro Capture.');const postData=CanvasSocialCore.collect(post);const response=await chrome.runtime.sendMessage({type:'social-save',post:postData});if(!response?.ok)throw new Error(response?.error||'Canvas Pro is unavailable');label.textContent=response.result.errors?.length?response.result.errors[0]:`${response.result.imported||0} saved · ${response.result.duplicates||0} already in library`;button.title=label.textContent;}catch(error){const msg=/Extension context invalidated/i.test(String(error?.message||error||''))?'Reload this page to reconnect Canvas Pro Capture.':(error?.message||'Could not save this post');label.textContent=msg;button.title=msg;}finally{button.disabled=false;label.style.display='block';setTimeout(()=>{label.style.display='';},5000);}};
  const xAction=x?[...post.querySelectorAll('[data-testid="reply"],[data-testid="retweet"],[data-testid="unretweet"]')]
   .find(action=>action.closest(selector)===post):null;
  const share=!x&&!additionalSites?post.querySelector('shreddit-post-share-button,[data-testid="share-button"],button[aria-label*="Share"],svg[aria-label*="Share"]'):null;
  const actions=xAction?.closest('[role="group"]')||share?.closest('section')||share?.closest('button,a')?.parentElement||share?.parentElement;
  if(actions&&post.contains(actions)){host.style.position='relative';actions.append(host);}else{if(getComputedStyle(post).position==='static')post.style.position='relative';host.style.cssText+=';position:absolute;top:10px;right:10px;background:light-dark(#ffffffe8,#252525e8);border-radius:50%;box-shadow:0 1px 6px #0002';post.append(host);}
 }
 function scan(){
  scheduled=false;
  const posts=[...document.querySelectorAll(selector)];
  const onPost=CanvasSocialCore.postPermalink(location.href,platform);
  if(!posts.length&&onPost&&!x){
   const main=document.querySelector('main,[role="main"]');
   if(main?.querySelector('video')||main&&['instagram.com','pinterest.com'].includes(platform))posts.push(main);
  }
  for(const post of posts){
   if(additionalSites&&!post.querySelector('video,[data-video-url],[video-url],img[src]'))continue;
   if(additionalSites&&!onPost&&![...post.querySelectorAll('a[href]')].some(link=>CanvasSocialCore.postPermalink(link.href,platform)))continue;
   install(post);
  }
 }
 const observer=new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('[data-canvas-post-save],[data-canvas-capture-activity]')))return;if(!scheduled){scheduled=true;setTimeout(scan,250);}});const start=()=>{observer.observe(document.documentElement,{childList:true,subtree:true});scan();};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
