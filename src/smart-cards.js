const SmartCards=(()=>{
 const filmTypes=['movie','series'],musicTypes=['song','album','playlist','music'];
 const titles={article:'Article',book:'Book',movie:'Film',series:'TV series',song:'Song',album:'Album',playlist:'Playlist',music:'Music',recipe:'Recipe',product:'Product',social:'Post',video:'Video',webpage:'Web link'};
 function info(a){return a.captureMetadata?.linkPreview||{};}
 function socialPlatform(url){
  try{
   const host=new URL(url).hostname;
   if(/(?:^|\.)(?:x\.com|twitter\.com)$/.test(host))return 'x';
   if(/(?:^|\.)(?:reddit\.com|redd\.it)$/.test(host))return 'reddit';
   if(/(?:^|\.)instagram\.com$/.test(host))return 'instagram';
  }catch{}
  return '';
 }
 function isSocialCard(a){return info(a).type==='social'&&!!socialPlatform(a.url);}
 function postText(i){
  return i.postText??i.description??'';
 }
 function paintSocial(node,a,i){
  node.classList.add('smart-social-card');
  const platform=socialPlatform(a.url);
  const icon=el('img','social-card-icon');
  icon.alt={x:'X',reddit:'Reddit',instagram:'Instagram'}[platform];
  icon.src='assets/social/'+platform+'.svg';
  node.append(icon);
  const text=postText(i);
  if(text)node.append(el('p','social-card-text',text));
  const sources=[...new Set([...(i.postImages||[]),...(i.cover&&i.imageURL?[i.imageURL]:[])])].slice(0,4);
  if(!sources.length&&!i.cover)return;
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
 }
 function isNote(a){return a.captureMetadata?.kind==='content'||(['txt','md'].includes(a.ext)&&a.smart?.excerpt);}
 function type(a){return kind(a)==='link'?info(a).type||'webpage':a.ext==='pdf'?'book':isNote(a)?(a.captureMetadata?.selection?'quote':'note'):null;}
 function ratio(a){
  if(isSocialCard(a)){
   const i=info(a),length=postText(i).length,count=i.postImages?.length||Number(!!i.cover);
   if(count>2)return .8;
   if(count)return length ? .95 : 1.1;
   if(length>350)return .85;
   return length>100 ? 1.3 : 2.2;
  }
  if(type(a)==='video')return a.aspectRatio||16/9;return ({book:.75,movie:.72,series:.72,song:1,album:1,playlist:1,music:1,social:.9,article:1.05,recipe:.9,product:1,quote:.85,note:.9})[type(a)];}
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
 function fileVisual(a){if(isNote(a)){const root=el('div','smart-note-card');root.append(el('span','smart-quote-mark',a.captureMetadata?.selection?'“':'✎'),el('p','',noteText(a)));if(a.captureMetadata?.author)root.append(el('small','',a.captureMetadata.author));return root;}if(a.ext==='pdf')return art(a,'book');return null;}
 function paint(node,a,i=info(a)){const t=i.type||'webpage',film=filmTypes.includes(t),music=musicTypes.includes(t);node.className='link-visual smart-link smart-type-'+t+(film||music||t==='book'?' smart-media-card':'');node.replaceChildren();node.dataset.id=a.id;node.dataset.url=a.url;const heading=el('div','smart-card-heading');heading.append(el('span','smart-kind',titles[t]||'Web link'),el('span','smart-domain',i.site||(()=>{try{return new URL(a.url).hostname;}catch{return 'Web link';}})()));
 if(music||t==='book'){if(i.cover)node.append(image(a,'smart-media-artwork'));else node.append(glyph(t==='book'?'file':'audio'));}
 else if(film){node.append(art(a,t));}
 else if(t==='video'){
   if(i.cover)node.append(image(a));
   else node.append(el('div','smart-video-fallback',i.title||a.name));
   const play=el('span','bookmark-play');play.append(glyph('play'));node.append(play);
 }
 else if(t==='social'&&socialPlatform(a.url))paintSocial(node,a,i);
 else if(t==='social'){node.append(heading,el('strong','smart-social-author',i.author||i.site||'Saved post'),el('p','smart-post-text',i.description||i.title||a.name));if(i.cover)node.append(image(a));}
 else{node.append(heading,el('h3','smart-card-title',i.title||a.name));if(t==='article'&&(i.imageURL||i.article))node.append(featuredImage(a,i,'smart-cover'));else if(i.cover)node.append(image(a));else node.append(el('p','smart-card-excerpt',i.description||'Saved web link'));}
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
  if(t==='recipe'){const recipe=el('div','smart-recipe');if(d.ingredients?.length){recipe.append(el('h2','','Ingredients'));for(const value of d.ingredients)recipe.append(el('p','','• '+value));}if(d.instructions?.length){recipe.append(el('h2','','Method'));d.instructions.forEach((value,n)=>recipe.append(el('p','',(n+1)+'. '+value)));}scene.append(recipe);}
  scene.append(action(['song','album','playlist','music'].includes(t)?'Listen in Canvas Pro':'Open page in Canvas Pro',web));element.append(scene);
 };
 element.append(el('p','hint','Preparing saved link…'));bookmarkInfo(a).then(i=>show(i||info(a))).catch(()=>web());return {element,dispose(){disposed=true;child?.dispose();element.remove();}};
 }
 function mountNote(a){const element=el('div','smart-note-preview'),body=el('article','smart-note-paper');body.append(el('span','smart-quote-mark',a.captureMetadata?.selection?'“':'✎'),el('p','',noteText(a)));element.append(body);let disposed=false;api.readText(a.id).then(value=>{if(disposed)return;const text=value.replace(/^# [^\n]*\n\nSource: [^\n]*\nCaptured: [^\n]*\n\n/,'');body.querySelector('p').textContent=text;if(a.captureMetadata?.author)body.append(el('small','',a.captureMetadata.author));if(a.url)body.append(action('View source in Canvas Pro',()=>{const child=mountWebBookmark({...a,ext:'url'});element.replaceChildren(child.element);element._child=child;}));}).catch(error=>body.append(el('p','hint',error.message)));return{element,dispose(){disposed=true;element._child?.dispose();element.remove();}};}
 function enrichSearch(a){return [a.name,a.notes,a.url,...a.tags,...a.folders,...(a.smart?.tags||[]),a.smart?.excerpt,a.captureMetadata?.textExcerpt,a.captureMetadata?.pageTitle,a.captureMetadata?.author,JSON.stringify(info(a))].filter(Boolean).join(' ').toLowerCase();}
 function paletteSection(a){const sectionNode=section('Colours'),swatches=el('div','color-palette');const values=a.smart?.palette||[];if(!values.length){sectionNode.append(el('p','hint','Colours appear after local indexing finds a preview.'));return sectionNode;}for(const item of values){const button=el('button','color-swatch');button.style.backgroundColor=item.hex;button.title=item.hex+' · '+item.name;button.setAttribute('aria-label','Copy '+item.hex);button.title+=' · Click to find matching colours · Option-click to copy';button.onclick=e=>e.altKey?safe(async()=>{await api.copyColor(item.hex);notify(item.hex+' copied');}):WorkbenchUI.findColor(item.hex);swatches.append(button);}sectionNode.append(swatches);return sectionNode;}
 return{type,ratio,isSocialCard,paint,art,fileVisual,isNote,mount,mountNote,enrichSearch,paletteSection};
})();
function mountBookmark(a){return SmartCards.mount(a);}
