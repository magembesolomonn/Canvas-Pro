(function(root){
 const postPaths={
  'x.com': /\/status\/\d+(?:\/|$)/,
  'twitter.com': /\/status\/\d+(?:\/|$)/,
  'instagram.com': /^\/(?:[^/]+\/)?(?:p|reel|tv)\/[^/]+/,
  'reddit.com': /\/comments\/[^/]+/,
  'pinterest.com': /^\/pin\/\d+/,
  'facebook.com': /\/(?:posts|videos|reels?)\/[^/]+|^\/(?:watch\/|story\.php|permalink\.php|photo(?:\.php|\/))$/,
  'tiktok.com': /\/@[^/]+\/(?:video|photo)\/\d+/,
  'threads.com': /\/@[^/]+\/post\/[^/]+/,
  'threads.net': /\/@[^/]+\/post\/[^/]+/,
  'bsky.app': /^\/profile\/[^/]+\/post\/[^/]+/,
  'linkedin.com': /^\/feed\/update\/[^/]+|^\/posts\/[^/]+/,
  'youtube.com': /^\/(?:watch|shorts\/[^/]+|live\/[^/]+)$/
 };
 const platforms=Object.keys(postPaths);
 function postPermalink(value,platform){
  try{
   const url=new URL(value);
   if(url.protocol!=='https:'||platformFor(url.href)!==platform||!postPaths[platform]?.test(url.pathname))return '';
   if(platform==='youtube.com'&&url.pathname==='/watch'&&!url.searchParams.get('v'))return '';
   if(platform==='facebook.com'&&url.pathname==='/watch/'&&!url.searchParams.get('v'))return '';
   return url.href;
  }catch{return '';}
 }
 function platformFor(value){try{const host=new URL(value).hostname;return platforms.find(p=>host===p||host.endsWith('.'+p))||null;}catch{return null;}}
 function direct(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&! /\.(m3u8|mpd|m4s|ts)(?:$)/i.test(u.pathname)?u.href:null;}catch{return null;}}
 // The page shows a resized copy. The original file is asked for instead, so
 // what is saved is full quality and not the thumbnail.
 function originalImage(value){
  const url=direct(value); if(!url) return null;
  try{const parsed=new URL(url);if(/(?:^|\.)pbs\.twimg\.com$/i.test(parsed.hostname)&&parsed.pathname.startsWith('/media/'))parsed.searchParams.set('name','orig');return parsed.href;}catch{return url;}
 }
 // The largest picture the page offers, not the small one it happens to show.
 function largestImage(element){
  if(!element) return null;
  const candidates=[];
  const add=(value,weight)=>{const url=direct(value);if(url)candidates.push({url,weight});};
  const srcset=element.getAttribute?.('srcset')||element.getAttribute?.('data-srcset')||'';
  for(const part of srcset.split(',')){
   const bits=part.trim().split(/\s+/); if(!bits[0])continue;
   const descriptor=bits[1]||'';
   const width=/^(\d+(?:\.\d+)?)w$/i.test(descriptor)?parseFloat(descriptor):0;
   const density=/^(\d+(?:\.\d+)?)x$/i.test(descriptor)?parseFloat(descriptor)*1000:0;
   add(bits[0],Math.max(width,density));
  }
  add(element.getAttribute?.('data-original')||element.getAttribute?.('data-full')||element.getAttribute?.('data-zoom-image')||'',2000);
  add(element.currentSrc||element.src||'',0);
  if(!candidates.length) return null;
  candidates.sort((a,b)=>b.weight-a.weight);
  return originalImage(candidates[0].url);
 }
 function bestVariant(variants){return (variants||[]).filter(v=>/video\/mp4/i.test(v.content_type||v.type||'')||/\.mp4(?:[?#]|$)/i.test(v.url||v.src||'')).sort((a,b)=>(b.bitrate||b.bit_rate||b.width*b.height||0)-(a.bitrate||a.bit_rate||a.width*a.height||0))[0];}
 function twitterMedia(data,base){const result=[];for(const media of data.mediaDetails||[]){const variant=bestVariant(media.video_info?.variants);if(variant)result.push({...base,kind:'video',mediaUrl:variant.url||variant.src,poster:media.media_url_https||'',duration:(media.video_info?.duration_millis||0)/1000});else if(media.type==='photo'&&media.media_url_https)result.push({...base,kind:'image',mediaUrl:media.media_url_https});}if(!result.length){const variant=bestVariant(data.video?.variants);if(variant)result.push({...base,kind:'video',mediaUrl:variant.url||variant.src});}return result;}
 const instagramVideos=new Map();
 function instagramMediaKey(value){
  try{return new URL(value).pathname.split('/').pop();}catch{return '';}
 }
 function rememberInstagramMedia(entries){
  const cdn=value=>{try{const url=new URL(value);return url.protocol==='https:'&&/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname);}catch{return false;}};
  if(!Array.isArray(entries))return;
  for(const entry of entries.slice(0,80)){
   if(!cdn(entry?.video)||!direct(entry.video)||!Array.isArray(entry.posters))continue;
   for(const poster of entry.posters.slice(0,8)){
    const key=cdn(poster)&&instagramMediaKey(poster);
    if(!key)continue;
    instagramVideos.set(key,entry.video);
    if(instagramVideos.size>300)instagramVideos.delete(instagramVideos.keys().next().value);
   }
  }
 }
 function focusedMedia(event){
  const candidates=new Set();
  const hits=document.elementsFromPoint(event.clientX,event.clientY);
  for(const hit of hits){
   if(hit.matches('img,video'))candidates.add(hit);
   const shadowHit=hit.shadowRoot?.elementFromPoint(event.clientX,event.clientY);
   if(shadowHit?.matches('img,video'))candidates.add(shadowHit);
  }
  if(!candidates.size){
   // An overlay can be the only hit when the slide itself ignores pointer events.
   let scope=hits[0]?.parentElement;
   for(let depth=0;scope&&depth<4&&!candidates.size;depth++,scope=scope.parentElement){
    if(scope.matches('body,main'))break;
    for(const media of scope.querySelectorAll('img,video')){
     const box=media.getBoundingClientRect();
     if(box.width>=70&&box.height>=60&&event.clientX>=box.left&&event.clientX<box.right&&
        event.clientY>=box.top&&event.clientY<box.bottom&&
        (media.checkVisibility?.({opacityProperty:true,visibilityProperty:true})??true))candidates.add(media);
    }
   }
  }
  for(const element of candidates){
   const box=element.getBoundingClientRect();
   if(box.width<70||box.height<60||getComputedStyle(element).visibility!=='visible')continue;
   const video=element.localName==='video';
   const source=element.currentSrc||element.src;
   const mediaUrl=video?(direct(source)|| (video&&[...element.querySelectorAll('source')].map(node=>direct(node.src)).find(Boolean))):(largestImage(element)||direct(source));
   const item={kind:video?'video':'image',title:element.alt||document.title,
    pageUrl:location.href,pageTitle:document.title,poster:video?element.poster:'',
    width:video?element.videoWidth:element.naturalWidth,height:video?element.videoHeight:element.naturalHeight};
   if(mediaUrl)return {...item,mediaUrl};
   if(!video&&/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(source))return {...item,dataUrl:source};
   if(video){
    let resolved=instagramVideoForPoster(element.poster);
    if(!resolved&&!element.poster){
     // Some Instagram players put the cover beside the video instead of on it.
     const nearby=[...(element.parentElement?.querySelectorAll('img')||[])].filter(image=>{
      const bounds=image.getBoundingClientRect();
      return Math.abs(bounds.left-box.left)<4&&Math.abs(bounds.top-box.top)<4&&
       Math.abs(bounds.width-box.width)<8&&Math.abs(bounds.height-box.height)<8;
     });
     const matches=new Set(nearby.map(image=>instagramVideoForPoster(image.currentSrc||image.src)).filter(Boolean));
     if(matches.size===1)resolved=matches.values().next().value;
    }
    return resolved?{...item,...resolved}:item;
   }
  }
  return null;
 }
 function instagramVideoForPoster(poster){
  if(platformFor(location.href)!=='instagram.com')return null;
  const target=instagramMediaKey(poster);
  if(instagramVideos.has(target))return {mediaUrl:instagramVideos.get(target)};
  const reel=location.href.match(/\/reel\/([\w-]+)(?:[/?#]|$)/)?.[1];
  if(!target&&!reel)return null;
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let reelId=0n;
  for(const character of reel||'')reelId=reelId*64n+BigInt(alphabet.indexOf(character));
  const mediaId=reel?String(reelId):'';
  for(const script of document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]')){
   const raw=script.textContent;
   if(raw.length>3000000||!(target&&raw.includes(target)||reel&&(raw.includes(reel)||raw.includes(mediaId))))continue;
   let data;
   try{data=JSON.parse(script.textContent);}catch{continue;}
   const queue=[data];
   for(let i=0;i<queue.length&&i<25000;i++){
    const value=queue[i];
    if(!value||typeof value!=='object')continue;
    const images=[value.display_url,value.thumbnail_url,value.thumbnail_src,
     ...(Array.isArray(value.image_versions2?.candidates)?value.image_versions2.candidates.map(entry=>entry?.url):[])];
    if(target&&images.some(url=>instagramMediaKey(url)===target)||reel&&(value.code===reel||value.shortcode===reel||[value.pk,value.id].some(id=>typeof id==='string'&&id.split('_')[0]===mediaId))){
     const variant=bestVariant(value.video_versions);
     const video=direct(value.video_url||variant?.url||variant?.src);
     if(video)return {mediaUrl:video};
     const tracks=instagramDashTracks(value.video_dash_manifest||value.dash_manifest);
     if(tracks)return tracks;
    }
    for(const child of Object.values(value))if(child&&typeof child==='object')queue.push(child);
   }
  }
  return null;
 }
 function instagramDashTracks(manifest){
  if(typeof manifest!=='string'||manifest.length>256000||!manifest.includes('<MPD')||typeof DOMParser==='undefined')return null;
  const doc=new DOMParser().parseFromString(manifest,'application/xml');
  if(doc.querySelector('parsererror,ContentProtection,SegmentTemplate,SegmentList'))return null;
  const options=kind=>[...doc.querySelectorAll('Representation')].filter(rep=>{
   const mime=rep.getAttribute('mimeType')||rep.parentElement?.getAttribute('mimeType')||'';
   const codecs=rep.getAttribute('codecs')||'';
   return mime===kind+'/mp4'&&(kind==='video'?/^avc[13]/i.test(codecs):/^mp4a/i.test(codecs));
  }).sort((a,b)=>Number(b.getAttribute('bandwidth'))-Number(a.getAttribute('bandwidth')));
  const url=rep=>{
   try{
    const u=new URL(rep.querySelector('BaseURL').textContent.trim());
    if(u.protocol!=='https:'||u.username||u.password||!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)||!/\.mp4$/i.test(u.pathname))return '';
    return u.href;
   }catch{return '';}
  };
  const mediaUrl=options('video').map(url).find(Boolean);
  const audioUrl=options('audio').map(url).find(Boolean);
  return mediaUrl&&audioUrl?{mediaUrl,audioUrl}:null;
 }
 function collect(post){
  const platform=platformFor(location.href),title=(post.querySelector('[data-testid="tweetText"],h1,h2,h3')?.textContent||document.title).trim().slice(0,160),base={pageUrl:location.href,pageTitle:document.title,title},items=[],seen=new Set();
  const timestampLinks=[...post.querySelectorAll('time')].map(time=>time.closest('a[href]')).filter(Boolean);
  const links=[...timestampLinks,...post.querySelectorAll('a[href]')];
  const permalink=links.map(link=>postPermalink(link.href,platform)).find(Boolean)
   ||postPermalink(post.getAttribute('permalink')&&new URL(post.getAttribute('permalink'),location.href).href,platform)
   ||postPermalink(location.href,platform)||location.href;
  base.pageUrl=permalink;base.author=post.getAttribute('author')||post.querySelector('[data-testid="User-Name"],a[rel="author"]')?.textContent?.trim().slice(0,300)||'';
  const add=(value,kind,extra={})=>{let url=direct(value);if(!url||seen.has(url)||items.length>=25)return;if(platform==='x.com'||platform==='twitter.com'){const u=new URL(url);if(u.hostname==='pbs.twimg.com'&&u.pathname.startsWith('/media/')){u.searchParams.set('name','orig');url=u.href;}}
   seen.add(url);items.push({...base,kind,...extra,mediaUrl:url});};
  const addImage=(element,extra={})=>{const url=largestImage(element);if(!url||seen.has(url)||items.length>=25)return;seen.add(url);items.push({...base,kind:'image',...extra,mediaUrl:url});};
  const roots=[post];for(let i=0;i<roots.length&&i<300;i++){for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);}const query=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]);const videos=query('video'),hasVideo=videos.length>0||post.getAttribute('post-type')==='video'||!!post.querySelector('shreddit-player,[data-testid="videoPlayer"],[data-testid="videoComponent"]');for(const video of videos){const extra={width:video.videoWidth,height:video.videoHeight,...(Number.isFinite(video.duration)?{duration:video.duration}:{}),poster:video.poster||''};const resolved=direct(video.currentSrc||video.src)?null:instagramVideoForPoster(video.poster);
   add(direct(video.currentSrc||video.src)||resolved?.mediaUrl,'video',{...extra,...(resolved?.audioUrl?{audioUrl:resolved.audioUrl}:{})});for(const source of video.querySelectorAll('source'))add(source.src,'video',extra);}
  for(const e of query('[data-video-url],[video-url],[content-href]')){const value=e.getAttribute('data-video-url')||e.getAttribute('video-url')||e.getAttribute('content-href');if(/\.(mp4|webm|mov)(?:[?#]|$)/i.test(value||''))add(value,'video');}
  // Structured metadata is used only within this post, never another feed item.
  for(const script of query('script[type="application/ld+json"]'))try{const queue=[JSON.parse(script.textContent)];let count=0;while(queue.length&&count++<5000){const value=queue.shift();if(!value||typeof value!=='object')continue;for(const [key,child]of Object.entries(value)){if(typeof child==='object')queue.push(child);else if(typeof child==='string'&&/^(contentUrl|video_url|url)$/.test(key)&&/\.(mp4|webm|mov)(?:[?#]|$)/i.test(child))add(child,'video');}}}catch{}
  const posters=new Set(videos.map(video=>direct(video.poster)).filter(Boolean));
  for(const image of query('img')){const bounds=image.getBoundingClientRect();if(/avatar|profile|emoji|profile_images/i.test((image.alt||'')+' '+image.src)||bounds.width>0&&bounds.width<70||bounds.height>0&&bounds.height<60||image.naturalWidth&&image.naturalWidth<90||image.naturalHeight&&image.naturalHeight<70)continue;if(posters.has(direct(image.currentSrc||image.src)))continue;addImage(image,{alt:image.alt||'',width:image.naturalWidth,height:image.naturalHeight});}
  return {platform,permalink,title,items,hasVideo:hasVideo||items.some(i=>i.kind==='video')};
 }
 const api={platformFor,postPermalink,direct,bestVariant,twitterMedia,collect,focusedMedia,rememberInstagramMedia,originalImage,largestImage};if(typeof module!=='undefined')module.exports=api;else root.CanvasSocialCore=api;
})(globalThis);
