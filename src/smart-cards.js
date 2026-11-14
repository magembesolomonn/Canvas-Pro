const SmartCards=(()=>{
 const filmTypes=['movie','series'],musicTypes=['song','album','playlist','music'];
 const titles={article:'Article',book:'Book',movie:'Film',series:'TV series',song:'Song',album:'Album',playlist:'Playlist',music:'Music',recipe:'Recipe',product:'Product',social:'Post',video:'Video',webpage:'Web link'};
 function info(a){return a.captureMetadata?.linkPreview||{};}
 const socialNames={x:'X',reddit:'Reddit',instagram:'Instagram',facebook:'Facebook',pinterest:'Pinterest',tiktok:'TikTok',threads:'Threads',bluesky:'Bluesky',linkedin:'LinkedIn'};
 function socialPlatform(url){
  try{
   const host=new URL(url).hostname;
   if(/(?:^|\.)(?:x\.com|twitter\.com)$/.test(host))return 'x';
   if(/(?:^|\.)(?:reddit\.com|redd\.it)$/.test(host))return 'reddit';
   if(/(?:^|\.)instagram\.com$/.test(host))return 'instagram';
   if(/(?:^|\.)(?:facebook\.com|fb\.watch|fb\.com)$/.test(host))return 'facebook';
   if(/(?:^|\.)(?:pinterest\.com|pin\.it)$/.test(host))return 'pinterest';
   if(/(?:^|\.)tiktok\.com$/.test(host))return 'tiktok';
   if(/(?:^|\.)threads\.(?:net|com)$/.test(host))return 'threads';
   if(/(?:^|\.)bsky\.app$/.test(host))return 'bluesky';
   if(/(?:^|\.)linkedin\.com$/.test(host))return 'linkedin';
  }catch{}
  return '';
 }
 function isSocialCard(a){return info(a).type==='social'&&!!socialPlatform(a.url);}
 function postText(i){
  return i.postText??i.description??'';
 }
 // A post's words may need more room than the card reserved (a narrow
 // justified row, an old canvas item whose size was never refreshed). Fit the
 // clamp to whole lines so the text ends in an ellipsis on a line boundary
 // instead of being sliced through a row of letters.
 const socialFit=new WeakSet();
 const socialObserver=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{for(const entry of entries)fitSocial(entry.target);}):null;
 function fitSocial(card){
  if(!card?.isConnected)return;
  const p=card.querySelector('.social-card-text');
  if(!p)return;
  const key=card.clientWidth+'x'+card.clientHeight;
  if(card.dataset.fitSize===key)return;
  card.dataset.fitSize=key;
  p.style.webkitLineClamp='';
  p.style.display='';
  const style=getComputedStyle(card),line=parseFloat(getComputedStyle(p).lineHeight)||18;
  const padBottom=parseFloat(style.paddingBottom)||0;
  const offset=p.getBoundingClientRect().top-card.getBoundingClientRect().top;
  const available=card.clientHeight-offset-padBottom;
  const box=Math.min(p.clientHeight||available,available);
  if(box<line)return;
  const cap=card.dataset.postMedia==='1'?3:Infinity;
  const lines=Math.min(cap,Math.max(1,Math.floor((box+1)/line)));
  p.style.display='-webkit-box';
  p.style.webkitBoxOrient='vertical';
  p.style.webkitLineClamp=String(lines);
 }
 function watchSocial(card){
  if(!socialObserver||socialFit.has(card))return;
  socialFit.add(card);
  socialObserver.observe(card);
  requestAnimationFrame(()=>fitSocial(card));
 }
 // The gallery reuses a small pool of cards, so a card that leaves the window
 // must leave the observers too. Otherwise every observed card is kept alive
 // for as long as the library is open.
 function release(node){
  const targets=new Set([node,...(node?.querySelectorAll?.('.smart-note-card,.smart-social-card')||[])]);
  for(const target of targets){
   socialObserver?.unobserve(target);socialFit.delete(target);
   quoteObserver?.unobserve(target);quoteFit.delete(target);
  }
 }
 function paintSocial(node,a,i){
  node.classList.add('smart-social-card');
  const platform=socialPlatform(a.url);
  const icon=el('img','social-card-icon');
  icon.alt=socialNames[platform]||platform;
  icon.src='assets/social/'+platform+'.svg';
  node.append(icon);
  const text=postText(i);
  if(text)node.append(el('p','social-card-text',text));
  const sources=[...new Set([...(i.postImages||[]),...(i.cover&&i.imageURL?[i.imageURL]:[])])].slice(0,4);
  if(!sources.length&&!i.cover){watchSocial(node);return;}
  node.dataset.postMedia='1';
  const media=el('div','social-card-media');
  if(!sources.length)media.append(image(a,'social-card-photo'));
  sources.forEach(source=>{
   const index=i.postImages?.indexOf(source);
   if(i.cover&&source===i.imageURL){media.append(image(a,'social-card-photo'));return;}
   const photo=el('img','social-card-photo');
   photo.alt='Post image '+(index+1);
   photo.loading='lazy';
   photo.decoding='async';
   photo.src='asset://social-image/'+a.id+'?index='+index+'&v='+(i.updatedAt||0);
   photo.onerror=()=>photo.remove();
   media.append(photo);
  });
  node.append(media);
  watchSocial(node);
 }
 function isNote(a){return a.captureMetadata?.kind==='content'||(['txt','md'].includes(a.ext)&&a.smart?.excerpt);}
 function type(a){return kind(a)==='link'?info(a).type||'webpage':a.ext==='pdf'?'book':isNote(a)?(a.captureMetadata?.selection?'quote':'note'):null;}
 // A post is text that reflows: the narrower the card, the more lines it
 // needs, so its height is a function of the width it is drawn at. These
 // numbers mirror the sizing in .smart-link.smart-social-card so the height
 // the layout reserves and the card that is drawn always agree.
 function socialMetrics(width){
  const size=Number.isFinite(width)&&width>0?width:230;
  const clamp=(min,value,max)=>Math.min(max,Math.max(min,value));
  const padding=clamp(8,size*.06,14),icon=clamp(13,size*.08,18),gap=clamp(5,size*.035,8),font=clamp(12,size*.065,15);
  // The words sit beside the icon, so their column is narrower than the card.
  return {padding,icon,gap,font,line:font*1.4,text:Math.max(1,size-padding*2-icon-gap)};
 }
 function socialHeight(a,width){
  const i=info(a),m=socialMetrics(width),text=postText(i);
  const count=i.postImages?.length||Number(!!i.cover);
  const perLine=Math.max(1,Math.floor(m.text/(m.font*.54)));
  const lines=Math.max(1,Math.ceil(text.length/perLine));
  const shown=count?Math.min(lines,3):lines;
  const media=count?m.text*(count>2?.8:.66):0;
  return Math.ceil(m.padding*2+m.icon+m.gap+shown*m.line+(media?media+m.gap:0)+2);
 }
 function ratio(a,width){
  if(isSocialCard(a))return (Number.isFinite(width)&&width>0?width:230)/socialHeight(a,width);
  if(type(a)==='video')return a.aspectRatio||16/9;return ({book:.75,movie:.72,series:.72,song:1,album:1,playlist:1,music:1,social:.9,webpage:1.18,article:1.05,recipe:.86,product:1,quote:.85,note:.9})[type(a)];}
 function image(a,cls='smart-cover'){const img=el('img',cls);img.alt=info(a).title||a.name;img.loading='lazy';img.decoding='async';img.src=kind(a)==='link'?'asset://link-cover/'+a.id+'?v='+(info(a).updatedAt||0):'asset://thumb/'+a.id;img.onload=()=>{if(type(a)==='video'&&img.naturalWidth&&img.naturalHeight)rememberRatio(a,img.naturalWidth/img.naturalHeight);};img.onerror=()=>img.remove();return img;}
 function featuredImage(a,details,cls){
  const img=el('img',cls);
  img.alt=details.title||a.name;
  img.loading='lazy';
  img.decoding='async';
  img.onerror=()=>{
    img.onerror=()=>img.remove();
    if(details.cover)img.src='asset://link-cover/'+a.id+'?v='+(details.updatedAt||0);
    else img.remove();
  };
  img.src='asset://reader-image/'+a.id+'?block=featured&v='+(details.updatedAt||0);
  return img;
 }
 function art(a,t=type(a)){const root=el('div','smart-object smart-object-'+t);if(t==='album'||t==='playlist'||t==='music'){root.append(el('div','smart-vinyl'));const sleeve=el('div','smart-sleeve');if(info(a).cover)sleeve.append(image(a));else sleeve.append(glyph('audio'));root.append(sleeve);}else if(t==='song'){const disc=el('div','smart-disc');if(info(a).cover)disc.append(image(a));else disc.append(glyph('audio'));disc.append(el('div','smart-disc-hole'));root.append(disc);}else if(t==='book'){const book=el('div','smart-book');if(kind(a)!=='link'||info(a).cover)book.append(image(a));else book.append(el('strong','',info(a).title||a.name));root.append(book);}else if(t==='movie'||t==='series'){const poster=el('div','smart-poster');if(info(a).cover)poster.append(image(a));else poster.append(glyph('video'));root.append(poster);}return root;}
 function noteText(a){return a.captureMetadata?.textExcerpt||a.smart?.excerpt||a.name.replace(/\.[^.]+$/,'');}
 // Every quote gets one of eight paper tints. The pick is derived from the id,
 // so a card keeps its colour across launches and layouts.
 function paperFor(a){let hash=0;const id=String(a.id||'');for(let i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))>>>0;return 1+hash%8;}
 // Fit the quote to the card instead of chopping it: start at a comfortable
 // size, shrink a little if needed, and only add an ellipsis when the text is
 // genuinely longer than the card can hold.
 const quoteFit=new WeakSet();
 const quoteObserver=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{for(const entry of entries)fitQuote(entry.target);}):null;
 function fitQuote(card){
  if(!card?.isConnected||card.dataset.fit==='1'&&card.dataset.fitSize===card.clientWidth+'x'+card.clientHeight)return;
  const p=card.querySelector('p');if(!p)return;
  card.dataset.fit='1';card.dataset.fitSize=card.clientWidth+'x'+card.clientHeight;
  p.style.fontSize='';p.style.webkitLineClamp='';p.style.display='';
  let size=15;
  while(size>10.5&&p.scrollHeight>p.clientHeight+1){size-=0.5;p.style.fontSize=size+'px';}
  if(p.scrollHeight>p.clientHeight+1){
   const line=parseFloat(getComputedStyle(p).lineHeight)||size*1.5;
   const lines=Math.max(1,Math.floor(p.clientHeight/line));
   p.style.display='-webkit-box';p.style.webkitBoxOrient='vertical';p.style.webkitLineClamp=String(lines);
  }
 }
 function watchQuote(card){
  if(!quoteObserver||quoteFit.has(card))return;
  quoteFit.add(card);
  quoteObserver.observe(card);
  requestAnimationFrame(()=>fitQuote(card));
 }
 function fileVisual(a){if(isNote(a)){const root=el('div','smart-note-card');root.dataset.paper=String(paperFor(a));root.append(el('span','smart-quote-mark',a.captureMetadata?.selection?'“':'✎'),el('p','',noteText(a)));if(a.captureMetadata?.author)root.append(el('small','',a.captureMetadata.author));watchQuote(root);return root;}if(a.ext==='pdf')return art(a,'book');return null;}
 function siteHost(a){try{return new URL(a.url).hostname.replace(/^www\./,'');}catch{return info(a).site||'Web link';}}
 function monogram(value){return (String(value||'W').trim()[0]||'W').toUpperCase();}
 function faviconNode(a,i,cls){
  if(i.icon){const img=el('img',cls);img.alt='';img.loading='lazy';img.decoding='async';img.src='asset://link-icon/'+a.id+'?v='+(i.updatedAt||0);img.onerror=()=>img.remove();return img;}
  return el('span',cls+' smart-web-monogram',monogram(siteHost(a)));
 }
 function webFallback(a,i){const fallback=el('div','smart-web-fallback');fallback.append(faviconNode(a,i,'smart-web-fallback-icon'));return fallback;}
 // The page's own picture, in order of preference: the copy saved with the
 // link, then a live fetch of the page image, then the site icon alone.
 function webImage(a,i,cls,media){
  const photo=el('img',cls);
  photo.alt=i.title||a.name;photo.loading='lazy';photo.decoding='async';
  const giveUp=()=>{photo.remove();if(media&&!media.childElementCount)media.append(webFallback(a,i));};
  if(i.cover){
   photo.src='asset://link-cover/'+a.id+'?v='+(i.updatedAt||0);
   photo.onerror=()=>{
    photo.remove();
    if(i.imageURL){
     const live=el('img',cls);live.alt=photo.alt;live.loading='lazy';live.decoding='async';
     live.src='asset://web-image/'+a.id+'?v='+(i.updatedAt||0);
     live.onerror=()=>{live.remove();if(media&&!media.childElementCount)media.append(webFallback(a,i));};
     photo.replaceWith(live);
    }else if(media&&!media.childElementCount)media.append(webFallback(a,i));
   };
   return photo;
  }
  if(i.imageURL){
   photo.src='asset://web-image/'+a.id+'?v='+(i.updatedAt||0);
   photo.onerror=giveUp;
   return photo;
  }
  return null;
 }
 // A website card reads like a page, not a database row: the page's own image
 // fills the card, then its title and where it came from sit underneath.
 function paintWebpage(node,a,i){
  node.classList.add('smart-web-card');
  const media=el('div','smart-web-media');
  const photo=webImage(a,i,'smart-web-image',media);
  if(photo)media.append(photo);
  else media.append(webFallback(a,i));
  const footer=el('div','smart-web-footer');
  const domain=siteHost(a);
  const title=i.title||a.name.replace(/\.(url|webloc)$/i,'');
  // A link that never got a page title is named after its own address, so
  // the title would only repeat the line underneath it.
  if(title!==domain)footer.append(el('strong','smart-web-title',title));
  const meta=el('div','smart-web-meta');
  meta.append(faviconNode(a,i,'smart-web-favicon'),el('span','smart-web-domain',domain));
  footer.append(meta);
  node.append(media,footer);
 }
 // A link whose page has not answered yet keeps the card's shape: the site's
 // own mark stands in for the picture and the address sits underneath, so a
 // slow connection shows a calm card instead of a placeholder letter.
 function paintPending(node,a){
  node.className='link-visual smart-link smart-type-webpage smart-web-card';
  node.replaceChildren();
  const i={};
  const media=el('div','smart-web-media');
  media.append(webFallback(a,i));
  const footer=el('div','smart-web-footer');
  const meta=el('div','smart-web-meta');
  meta.append(faviconNode(a,i,'smart-web-favicon'),el('span','smart-web-domain',siteHost(a)));
  footer.append(meta);
  node.append(media,footer);
 }
 function paintRecipe(node,a,i){
  node.classList.add('smart-recipe-card');
  const d=i.details||{};
  const hero=el('div','recipe-card-hero');
  const mark=()=>el('span','recipe-card-mark','Recipe');
  if(i.cover){
   const photo=el('img','recipe-card-image');
   photo.alt=i.title||a.name;photo.loading='lazy';photo.decoding='async';
   photo.src='asset://link-cover/'+a.id+'?v='+(i.updatedAt||0);
   photo.onerror=()=>photo.replaceWith(mark());
   hero.append(photo);
  }else hero.append(mark());
  hero.append(el('span','recipe-card-kind','Recipe'));
  const body=el('div','recipe-card-body');
  body.append(el('h3','recipe-card-title',i.title||a.name));
  const meta=[runtime(d.prepTime),d.servings?(/serv/i.test(d.servings)?d.servings:'Serves '+d.servings):'',d.ingredients?.length?d.ingredients.length+' ingredients':''].filter(Boolean).join(' · ');
  if(meta)body.append(el('p','recipe-card-meta',meta));
  if(d.ingredients?.length){
   const list=el('ul','recipe-card-ingredients');
   for(const value of d.ingredients.slice(0,3))list.append(el('li','',value));
   if(d.ingredients.length>3)list.append(el('li','recipe-card-more','+'+(d.ingredients.length-3)+' more'));
   body.append(list);
  }
  node.append(hero,body);
 }
 function paint(node,a,i=info(a)){const t=i.type||'webpage',film=filmTypes.includes(t),music=musicTypes.includes(t);node.className='link-visual smart-link smart-type-'+t+(film||music||t==='book'?' smart-media-card':'');node.replaceChildren();node.dataset.id=a.id;node.dataset.url=a.url;const heading=el('div','smart-card-heading');heading.append(el('span','smart-kind',titles[t]||'Web link'),el('span','smart-domain',i.site||siteHost(a)));
 if(music||t==='book'){if(i.cover)node.append(image(a,'smart-media-artwork'));else node.append(glyph(t==='book'?'file':'audio'));}
 else if(film){node.append(art(a,t));}
 else if(t==='video'){
   if(i.cover)node.append(image(a));
   else node.append(el('div','smart-video-fallback',i.title||a.name));
   const play=el('span','bookmark-play');play.append(glyph('play'));node.append(play);
 }
 else if(t==='social'&&socialPlatform(a.url))paintSocial(node,a,i);
 else if(t==='social'){node.append(heading,el('strong','smart-social-author',i.author||i.site||'Saved post'),el('p','smart-post-text',i.description||i.title||a.name));if(i.cover)node.append(image(a));}
 else if(t==='recipe')paintRecipe(node,a,i);
 else if(t==='webpage'||t==='article')paintWebpage(node,a,i);
 else{node.append(heading,el('h3','smart-card-title',i.title||a.name));if(i.cover)node.append(image(a));else node.append(el('p','smart-card-excerpt',i.description||'Saved web link'));}
 if(film||music||t==='book'){
   const footer=el('div','smart-media-caption');
   footer.append(el('div','smart-card-caption',i.title||a.name));
   const d=i.details||{};
   const line=[film?d.year:d.artist||d.author,film?'':runtime(d.runtime),d.rating?'★ '+d.rating+(d.ratingScale?'/'+d.ratingScale:''):''].filter(Boolean).join(' · ');
   if(line)footer.append(el('small','smart-card-subtitle',line));
   node.append(footer);
 }
 }
 function runtime(value){if(!value)return '';const m=String(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);return m?[m[1]?m[1]+'h':'',m[2]?m[2]+'m':'',!m[1]&&!m[2]&&m[3]?m[3]+'s':''].filter(Boolean).join(' '):String(value);}
 function renderArticle(a,info,article,web){
  const toolbar=el('div','smart-reader-toolbar');
  toolbar.append(el('span','','Reading mode'),action('View original page',web));
  const reader=el('article','smart-reader');
  const source=el('div','smart-reader-brand');
  if(info.icon){
    const icon=el('img','smart-reader-site-icon');
    icon.alt='';
    icon.src='asset://link-icon/'+a.id+'?v='+(info.updatedAt||0);
    icon.onerror=()=>icon.remove();
    source.append(icon);
  }
  source.append(el('p','smart-reader-source',['Article',info.site].filter(Boolean).join(' / ')));
  reader.append(source,el('h1','smart-reader-title',article.title||info.title));
  const author=article.author||info.author;
  if(author)reader.append(el('p','smart-reader-byline',author));
  const blocks=article.blocks||[];
  const firstImage=blocks.find(block=>block.type==='image');
  const featured=article.featuredImage||info.imageURL;
  const hero=featured||firstImage?.sources?.[0];
  if(hero||info.cover)reader.append(featuredImage(a,info,'smart-reader-cover'));
  const imageKey=url=>url?.match(/\/photos\/([^/]+)\//)?.[1]||url?.split('?')[0];
  let list;
  blocks.forEach((block,index)=>{
    if(block.type==='li'||block.type==='product'){
      const tag=block.ordered?'ol':'ul';
      const cls=block.type==='product'?'smart-reader-products':'smart-reader-list';
      if(list?.localName!==tag||list.className!==cls){
        list=el(tag,cls);
        reader.append(list);
      }
      list.append(el('li','',block.text));
      return;
    }
    list=null;
    if(block.type==='image'){
      if(hero&&block.sources?.some(src=>imageKey(src)===imageKey(hero)))return;
      const figure=el('figure','smart-reader-figure'),img=el('img');
      img.alt=block.alt||'';
      img.loading='lazy';
      img.decoding='async';
      img.onerror=()=>figure.remove();
      img.src='asset://reader-image/'+a.id+'?block='+index+'&v='+(info.updatedAt||0);
      figure.append(img);
      if(block.caption)figure.append(el('figcaption','',block.caption));
      reader.append(figure);
      return;
    }
    const tag=block.type==='h1'?'h2':['h2','h3','h4','p','blockquote','pre'].includes(block.type)?block.type:'p';
    const node=el(tag);
    if(block.runs?.length&&tag!=='pre'){
      for(const run of block.runs){
        if(['strong','em','code'].includes(run.mark))node.append(el(run.mark,'',run.text));
        else node.append(document.createTextNode(run.text));
      }
    }else node.textContent=block.text;
    reader.append(node);
  });
  return [toolbar,reader];
 }
 function recipeChecks(id){try{return new Set(JSON.parse(localStorage.getItem('recipe-checks:'+id)||'[]'));}catch{return new Set();}}
 function saveRecipeChecks(id,set){try{localStorage.setItem('recipe-checks:'+id,JSON.stringify([...set]));}catch{}}
 // A recipe is a page you cook from, not a page you read. The ingredients are
 // a checklist that remembers what you already have, and the method stays
 // beside them instead of running far below the fold.
 function renderRecipe(a,i,web){
  const d=i.details||{};
  const toolbar=el('div','smart-reader-toolbar');
  toolbar.append(el('span','','Recipe'),action('Open original page',web));
  const page=el('article','recipe-page');
  const hero=el('div','recipe-hero');
  if(i.cover)hero.append(image(a,'recipe-hero-image'));
  else{const fallback=el('div','recipe-hero-fallback');fallback.append(glyph('book'));hero.append(fallback);}
  const head=el('header','recipe-head');
  head.append(el('p','recipe-eyebrow',[i.site,'Recipe'].filter(Boolean).join(' · ')));
  head.append(el('h1','recipe-title',i.title||a.name.replace(/\.(url|webloc)$/i,'')));
  if(i.description)head.append(el('p','recipe-description',i.description));
  const meta=el('div','recipe-meta');
  const addMeta=(label,value)=>{if(!value)return;const item=el('span','recipe-meta-item');item.append(el('small','',label),el('span','',value));meta.append(item);};
  addMeta('Time',runtime(d.prepTime));
  addMeta('Serves',d.servings);
  addMeta('Ingredients',d.ingredients?.length?String(d.ingredients.length):'');
  if(meta.childNodes.length)head.append(meta);
  const grid=el('div','recipe-grid');
  if(d.ingredients?.length){
   const ingredients=el('section','recipe-ingredients');
   ingredients.append(el('h2','','Ingredients'));
   const progress=el('p','recipe-progress');
   const checks=recipeChecks(a.id),list=el('div','recipe-checklist');
   const updateProgress=()=>{progress.textContent=checks.size?checks.size+' of '+d.ingredients.length+' ready':'Tick what you already have';};
   d.ingredients.forEach((value,index)=>{
    const row=el('label','recipe-check');
    const input=el('input');input.type='checkbox';input.checked=checks.has(String(index));input.setAttribute('aria-label','Have '+value);
    row.classList.toggle('is-checked',input.checked);
    input.onchange=()=>{const key=String(index);if(input.checked)checks.add(key);else checks.delete(key);row.classList.toggle('is-checked',input.checked);saveRecipeChecks(a.id,checks);updateProgress();};
    row.append(input,el('span','recipe-check-mark'),el('span','recipe-check-text',value));
    list.append(row);
   });
   updateProgress();
   ingredients.append(progress,list);
   ingredients.append(action('Copy shopping list',async()=>{await navigator.clipboard.writeText([i.title||a.name,'',...d.ingredients].filter(Boolean).join('\n'));notify('Shopping list copied');},'recipe-copy'));
   grid.append(ingredients);
  }
  if(d.instructions?.length){
   const method=el('section','recipe-method');
   method.append(el('h2','','Method'));
   const steps=el('ol','recipe-steps');
   d.instructions.forEach(value=>steps.append(el('li','',value)));
   method.append(steps);
   grid.append(method);
  }
  if(!grid.childNodes.length)grid.append(el('p','recipe-empty','This page did not publish its ingredients or method. Open the original page for the full recipe.'));
  page.append(hero,head,grid);
  return [toolbar,page];
 }
 function mount(a){const element=el('div','smart-preview');let disposed=false,child=null,mode='smart';
 const web=()=>{mode='web';child?.dispose();child=mountWebBookmark(a);element.className='smart-preview smart-preview-web';element.replaceChildren(child.element);};
 const show=async i=>{if(disposed||mode==='web')return;child?.dispose();child=null;element.replaceChildren();element.className='smart-preview smart-preview-'+(i.type||'webpage');
  if(i.type==='article'&&i.article){
    const loading=el('p','hint','Preparing reading mode…');
    element.append(loading);
    const article=await api.linkReader(a.id);
    if(disposed||mode==='web')return;
    loading.remove();
    if(article){element.append(...renderArticle(a,i,article,web));return;}
  }
  const t=i.type||'webpage';
  if(t==='webpage'){web();return;}
  if(t==='recipe'){element.append(...renderRecipe(a,i,web));return;}
  const scene=el('div','smart-scene');
  const tone=a.smart?.palette?.[0]?.hex;
  if(tone)element.style.background='linear-gradient(140deg,'+tone+'25,transparent)';
  scene.append(el('div','smart-preview-kind',titles[t]||'Saved link'));
  if(t==='video'){
    const imdb=/^https?:\/\/(?:www\.)?imdb\.com\/video\//i.test(a.url);
    if(i.cover)scene.append(image(a,'smart-video-preview-cover'));
    else{
      const placeholder=el('div','smart-video-preview-placeholder');
      placeholder.append(glyph('video'));
      scene.append(placeholder);
    }
    scene.append(el('h1','smart-preview-title',i.title||a.name),
      action(imdb?'Watch on IMDb':'Play video',imdb?()=>api.openLink(a.id):web));
    element.append(scene);
    return;
  }
  if(musicTypes.includes(t)&&i.cover)scene.append(image(a,'smart-preview-music-artwork'));
  else if(['song','album','playlist','music','movie','series','book'].includes(t))scene.append(art(a,t));
 else if(t==='social'){const post=el('article','smart-social-preview');post.append(el('div','smart-social-brand',i.site||'Saved post'),el('strong','',i.author||''),el('p','',postText(i)||i.title||a.name));if(i.postImages?.length){
   i.postImages.forEach((_,index)=>{
     const photo=el('img','smart-social-photo');
     photo.alt='Post image '+(index+1);
     photo.loading='lazy';
     photo.decoding='async';
     photo.src='asset://social-image/'+a.id+'?index='+index+'&v='+(i.updatedAt||0);
     photo.onerror=()=>{
       if(index===0&&i.cover&&!i.postImages.slice(1).includes(i.imageURL))photo.replaceWith(image(a,'smart-social-photo'));
       else photo.remove();
     };
     post.append(photo);
   });
  }else if(i.cover)post.append(image(a,'smart-social-photo'));scene.append(post);}else{if(i.cover)scene.append(image(a,'smart-product-cover'));scene.append(el('p','smart-description',i.description||''));}
  if(t!=='movie'&&t!=='series')scene.append(el('h1','smart-preview-title',i.title||a.name.replace(/\.url$/,'')));const d=i.details||{},details=el('div','smart-preview-details');for(const [label,value]of [['Artist',d.artist],['Author',d.author],['Director',d.director],['Year',d.year],['Runtime',runtime(d.runtime)],['Rating',d.rating?d.rating+(d.ratingScale?' / '+d.ratingScale:''):''],['Certificate',d.contentRating],['Genre',d.genre],['ISBN',d.isbn],['Price',[d.price,d.currency].filter(Boolean).join(' ')],['Brand',d.brand],['Time',runtime(d.prepTime)],['Serves',d.servings]])if(value){const row=el('span','smart-detail');row.append(el('small','',label),el('span','',value));details.append(row);}if(details.childNodes.length)scene.append(details);
  scene.append(action(['song','album','playlist','music'].includes(t)?'Listen in Canvas Pro':'Open page in Canvas Pro',web));element.append(scene);
 };
 element.append(el('p','hint','Preparing saved link…'));bookmarkInfo(a).then(i=>show(i||info(a))).catch(()=>web());return {element,dispose(){disposed=true;child?.dispose();element.remove();}};
 }
 function mountNote(a){const element=el('div','smart-note-preview'),body=el('article','smart-note-paper');body.dataset.paper=String(paperFor(a));body.append(el('span','smart-quote-mark',a.captureMetadata?.selection?'“':'✎'),el('p','',noteText(a)));element.append(body);let disposed=false;api.readText(a.id).then(value=>{if(disposed)return;const text=value.replace(/^# [^\n]*\n\nSource: [^\n]*\nCaptured: [^\n]*\n\n/,'');body.querySelector('p').textContent=text;if(a.captureMetadata?.author)body.append(el('small','',a.captureMetadata.author));if(a.url)body.append(action('View source in Canvas Pro',()=>{const child=mountWebBookmark({...a,ext:'url'});element.replaceChildren(child.element);element._child=child;}));}).catch(error=>body.append(el('p','hint',error.message)));return{element,dispose(){disposed=true;element._child?.dispose();element.remove();}};}
 function isSelfContained(a){const t=type(a);return isSocialCard(a)||t==='webpage'||t==='article'||t==='recipe';}
 function enrichSearch(a){return [a.name,a.notes,a.url,...a.tags,...a.folders,...(a.smart?.tags||[]),a.smart?.excerpt,a.captureMetadata?.textExcerpt,a.captureMetadata?.pageTitle,a.captureMetadata?.author,JSON.stringify(info(a))].filter(Boolean).join(' ').toLowerCase();}
 function paletteSection(a){const sectionNode=section('Colours'),swatches=el('div','color-palette');const values=a.smart?.palette||[];if(!values.length){sectionNode.append(el('p','hint','Colours appear after local indexing finds a preview.'));const link=el('button','hint-link','Turn on local indexing');link.onclick=()=>safe(()=>SettingsUI.open('experimental'));sectionNode.append(link);return sectionNode;}for(const item of values){const button=el('button','color-swatch');button.style.backgroundColor=item.hex;button.title=item.hex+' · '+item.name;button.setAttribute('aria-label','Find files with '+item.hex);button.title+=' · Click to find matching colours · Option-click to copy';button.onclick=e=>e.altKey?safe(async()=>{await api.copyColor(item.hex);notify(item.hex+' copied');}):safe(()=>WorkbenchUI.findColor(item.hex));swatches.append(button);}sectionNode.append(swatches);return sectionNode;}
 return{type,ratio,isSocialCard,isSelfContained,paint,paintPending,art,fileVisual,isNote,mount,mountNote,enrichSearch,paletteSection,release};
})();
function mountBookmark(a){return SmartCards.mount(a);}
