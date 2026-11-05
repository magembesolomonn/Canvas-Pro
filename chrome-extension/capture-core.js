(function(root){
function inspectPage(mode,source=''){
 const getMeta=name=>document.querySelector(`meta[name="${name}"],meta[property="${name}"]`)?.content||'';
 const absolute=value=>{try{return value?new URL(value,location.href).href:'';}catch{return '';}};
 const imdbPoster=/^(www\.)?imdb\.com$/.test(location.hostname)&&location.pathname.startsWith('/title/')
   ?document.querySelector('[data-testid="hero-media__poster"] img'):null;
 const videoPoster=/^(www\.)?imdb\.com$/.test(location.hostname)&&location.pathname.startsWith('/video/')?document.querySelector('video[poster]')?.poster:'';
 const amazon=/(^|\.)amazon\.(?:com|co\.uk|ca|de|fr|it|es|in|co\.jp|com\.au)$/.test(location.hostname);
 const amazonBook=amazon&&!!document.querySelector('#kindle-reader-api,#ebooksProductTitle,#imgBlkFront,#ebooksImgBlkFront,[id*="isbn13"]');
 const book=amazonBook||/^books?(?:\.|$)/i.test(getMeta('og:type'))||!!(getMeta('book:isbn')||getMeta('books:isbn'));
 const cover=amazonBook?document.querySelector('#landingImage,#ebooksImgBlkFront,#imgBlkFront'):null;
 const bookTitle=amazonBook?document.querySelector('#productTitle,#ebooksProductTitle')?.textContent?.trim():'';
 const bookAuthor=amazonBook?[...document.querySelectorAll('#bylineInfo .author a.a-link-normal')].map(a=>a.textContent.trim()).filter(Boolean).join(', '):'';
 const base={pageUrl:location.href,pageTitle:bookTitle||document.title,title:bookTitle||document.title,...(book?{book:true}:{}),description:getMeta('description')||getMeta('og:description'),author:bookAuthor||getMeta('author'),previewImage:absolute(cover?.getAttribute('data-old-hires')||cover?.src||videoPoster||imdbPoster?.currentSrc||imdbPoster?.src||getMeta('og:image')||getMeta('twitter:image')),siteIcon:document.querySelector('link[rel~="icon"]')?.href||''};
 const acceptable=url=>/^(https?:|data:image\/(png|jpeg|webp|gif);base64,)/i.test(url||'');
 if(mode==='discover'||mode==='videos'){
  const items=[],seen=new Set();
  const add=(value,kind,extra={})=>{if(!value||items.length>=500)return;if(/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)){if(mode!=='videos'&&!seen.has(value)){seen.add(value);items.push({...base,kind:'image',...extra,dataUrl:value});}return;}let url;try{url=new URL(value,location.href).href;}catch{return;}if(!/^https?:/i.test(url))return;const pathname=new URL(url).pathname;if(!kind)kind=/\.(mp4|m4v|mov|webm|gifv)(?:$)/i.test(pathname)?'video':/\.(gif|png|jpe?g|webp|avif|svg)(?:$)/i.test(pathname)?'image':null;if(!kind||mode==='videos'&&kind!=='video'&&!/\.gif(?:$)/i.test(pathname))return;if(/(^|\.)imgur\.com$/.test(new URL(url).hostname)&&/\.gifv$/i.test(pathname))url=url.replace(/\.gifv(?=[?#]|$)/i,'.mp4');if(seen.has(url))return;seen.add(url);let name;try{name=decodeURIComponent(pathname.split('/').pop());}catch{}items.push({...base,kind,title:name||base.title,...extra,mediaUrl:url});};
  for(const e of document.querySelectorAll('video,audio')){const kind=e.tagName==='AUDIO'?'audio':'video',extra={width:e.videoWidth||0,height:e.videoHeight||0,...(Number.isFinite(e.duration)?{duration:e.duration}:{}),poster:e.poster||''};add(e.currentSrc||e.src,kind,extra);const appleBase=e.getAttribute('data-inline-media-basepath');if(appleBase){try{const url=new URL(appleBase,location.href);if(url.pathname.startsWith('/105/media/'))add(new URL('large.mp4',url.href.endsWith('/')?url.href:url.href+'/').href,'video',{...extra,title:e.getAttribute('aria-label')||e.id||'Product showcase'});}catch{}}for(const source of e.querySelectorAll('source'))add(source.src,kind,extra);}
  for(const e of document.images){const extra={title:e.alt||base.title,alt:e.alt||'',width:e.naturalWidth||0,height:e.naturalHeight||0};add(e.currentSrc||e.src,'image',extra);for(const key of ['data-src','data-original','data-full','data-zoom-image'])add(e.getAttribute(key),'image',extra);}
  for(const e of document.querySelectorAll('meta[property],meta[name]')){const key=e.getAttribute('property')||e.name;if(/^(og:video(?::url|:secure_url)?|twitter:player:stream)$/.test(key))add(e.content,'video');if(/^(og:image(?::url|:secure_url)?|twitter:image)$/.test(key))add(e.content,'image');}
  for(const entry of performance.getEntriesByType('resource'))add(entry.name);
  // Lazy media and JSON configuration, including Apple's inline media sources.
  for(const e of document.querySelectorAll('*')){if(e.closest('[data-canvas-capture-activity]'))continue;for(const attr of e.attributes){if(!/^(data-|href$|src$|style$)/.test(attr.name))continue;const value=attr.value.replaceAll('\\/','/').replaceAll('&amp;','&');if(/\.(mp4|m4v|mov|webm|gifv|gif|png|jpe?g|webp|avif)(?:[?#]|$)/i.test(value)&&!/[\s"'<>]/.test(value))add(value);for(const match of value.matchAll(/(?:https?:)?\/\/[^\s"'<>),]+|(?:\/|\.\.?\/)[^\s"'<>),]+\.(?:mp4|m4v|mov|webm|gifv|gif|png|jpe?g|webp|avif)(?:\?[^\s"'<>),]*)?/gi))add(match[0]);}
   if(mode!=='videos'){const bg=getComputedStyle(e).backgroundImage;for(const match of bg.matchAll(/url\(["']?(.+?)["']?\)/g))add(match[1],'image');}
  }
  for(const script of document.scripts){const text=script.textContent.slice(0,2000000).replaceAll('\\/','/');for(const match of text.matchAll(/(?:https?:)?\/\/[^\s"'<>]+?\.(?:mp4|m4v|mov|webm|gifv|gif)(?:\?[^\s"'<>]*)?(?=["'\s<]|$)/gi))add(match[0]);}
  return {base,items};
 }
 if(mode==='images'){const seen=new Set(),items=[];for(const image of document.images){const src=image.currentSrc||image.src;if(!acceptable(src)||seen.has(src)||image.naturalWidth<24||image.naturalHeight<24)continue;seen.add(src);let title=image.alt||'Image';if(!image.alt&&!src.startsWith('data:'))try{title=decodeURIComponent(new URL(src,location.href).pathname.split('/').pop()||'Image');}catch{}items.push({...base,kind:'image',title,alt:image.alt,width:image.naturalWidth,height:image.naturalHeight,...(src.startsWith('data:')?{dataUrl:src}:{mediaUrl:src})});if(items.length>=500)break;}return {base,items};}
 if(mode==='content')return {...base,kind:'content',text:(window.getSelection()?.toString().trim()||document.body?.innerText||'').slice(0,2*1024*1024)};
 if(mode==='media'){const element=[...document.querySelectorAll('img,video,audio')].find(e=>(e.currentSrc||e.src)===source);const result={...base};if(element){result.title=element.alt||element.getAttribute('aria-label')||document.title;result.alt=element.alt||'';result.width=element.naturalWidth||element.videoWidth||0;result.height=element.naturalHeight||element.videoHeight||0;if(Number.isFinite(element.duration))result.duration=element.duration;}return result;}
 return base;
}
function chooseURL(info){return info.srcUrl||info.linkUrl||info.pageUrl||'';}
const api={inspectPage,chooseURL};if(typeof module!=='undefined')module.exports=api;else root.CaptureCore=api;
})(globalThis);
