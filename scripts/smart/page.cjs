const {classifyURL}=require('../../electron/bookmark-types.cjs');
const {parseHTML}=require('linkedom');
const {Readability}=require('@mozilla/readability');
const text=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,4000):'';
const name=value=>typeof value==='string'?text(value):Array.isArray(value)?value.map(name).filter(Boolean).join(', '):text(value?.name||'');
function recipeValues(value){
  const out=[];
  const add=item=>{
    if(item==null)return;
    if(Array.isArray(item)){for(const child of item)add(child);return;}
    if(typeof item==='string'){
      for(const line of item.split(/\r?\n/)){const value=text(line);if(value)out.push(value);}
      return;
    }
    if(typeof item==='object'){
      const steps=item.itemListElement||item.steps;
      if(Array.isArray(steps)){add(steps);return;}
      if(typeof item.text==='string'||typeof item.name==='string')add(item.text??item.name);
    }
  };
  add(value);
  return out;
}
function isoDuration(value){
  const raw=text(value);
  if(!raw)return '';
  if(/^P/i.test(raw))return raw;
  const clock=raw.match(/^(\d+):(\d{1,2})$/);
  if(clock)return 'PT'+clock[1]+'H'+clock[2]+'M';
  const hours=raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i)?.[1];
  const minutes=raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i)?.[1];
  if(!hours&&!minutes)return '';
  return 'PT'+(hours?Math.round(Number(hours))+'H':'')+(minutes?Math.round(Number(minutes))+'M':'');
}
const ingredientSelectors=['[itemprop="recipeIngredient"]','[itemprop="ingredients"]','.wprm-recipe-ingredient','.tasty-recipes-ingredient','.recipe-ingredients li','#recipe-ingredients li','[class*="recipe-ingredient"]','[class*="ingredients"] li'];
const methodSelectors=['[itemprop="recipeInstructions"]','.recipe-instructions','[class*="recipe-instructions"]','.recipe-method','[class*="recipe-method"]','[class*="instructions"]'];
function domRecipe(document,resolve){
  const selector=ingredientSelectors.join(',');
  const roots=[...new Set([...document.querySelectorAll(selector)])].filter(node=>!node.querySelector(selector));
  const ingredients=[];
  for(const node of roots){
    const value=text(node.getAttribute('content')||node.textContent).replace(/^[\s•·*☐☑✓-]+/,'').slice(0,300);
    if(value&&!ingredients.includes(value))ingredients.push(value);
    if(ingredients.length>=100)break;
  }
  const methods=[...new Set([...document.querySelectorAll(methodSelectors.join(','))])];
  const instructions=[];
  for(const method of methods){
    const steps=[...method.querySelectorAll('li,[itemprop="text"],p')];
    for(const step of steps){
      if(step.querySelector('li,[itemprop="text"],p'))continue;
      const value=text(step.getAttribute('content')||step.textContent)
        .replace(/^\s*(?:step\s*)?\d+\s*[.):-]\s*/i,'')
        .slice(0,2000);
      if(value&&!instructions.includes(value))instructions.push(value);
      if(instructions.length>=100)break;
    }
    if(instructions.length>=100)break;
  }
  if(!ingredients.length&&!instructions.length)return null;
  const item=(prop)=>document.querySelector(`[itemprop="${prop}"]`);
  const attr=(prop)=>item(prop)?.getAttribute('content')||item(prop)?.getAttribute('datetime')||item(prop)?.textContent||'';
  const heading=document.querySelector('h1')||item('name');
  const title=text(heading?.textContent)||text(document.title).replace(/\s*\|\s*[^|]+$/,'');
  const image=document.querySelector('img[itemprop="image"],picture img[itemprop="image"]');
  const yieldText=text(attr('recipeYield')||document.querySelector('[class*="yield"]')?.textContent);
  const servings=yieldText.match(/\d+(?:\s*(?:to|-)\s*\d+)?/)?.[0]||'';
  return {
    title,ingredients,instructions,
    description:text(attr('description')||document.querySelector('[itemprop="description"]')?.textContent).slice(0,1500),
    imageURL:resolve(image?.getAttribute('src')||image?.getAttribute('data-src')),
    servings,
    prepTime:isoDuration(attr('totalTime')||attr('cookTime')||attr('prepTime')||[...document.querySelectorAll('time[datetime]')].map(node=>node.getAttribute('datetime')).find(Boolean)),
    rating:attr('ratingValue'),ratingScale:attr('bestRating')
  };
}
function editorialOnly(root){
 const advertising=/(?:^|[\s_-])(?:ad|ads|advert|advertisement|adslot|adunit|ad-container|ad-wrapper|sponsored-content|promoted-content)(?:$|[\s_-])/i;
 for(const node of root.querySelectorAll('[class],[id],[aria-label],[data-ad-slot],[data-ad-unit],[data-ad-client],[data-testid]')){
   const label=['class','id','aria-label','data-testid'].map(attr=>node.getAttribute(attr)||'').join(' ');
   if(advertising.test(label)||node.matches('[data-ad-slot],[data-ad-unit],[data-ad-client]'))node.remove();
 }
}
function readerBlocks(root,resolve){
 const blocks=[],images=new Set();
 const ignored='script,style,nav,aside,footer,form,iframe,button,noscript,[hidden],[aria-hidden="true"]';
 const blockTags=new Set(['h1','h2','h3','h4','h5','h6','p','li','blockquote','pre','figcaption']);
 function addImage(node,caption){
   if(images.size>=80)return;
   const width=Number(node.getAttribute('width')),height=Number(node.getAttribute('height'));
   if((width>0&&width<=32)||(height>0&&height<=32))return;
   const picture=node.closest('picture');
   const candidates=[node,...(picture?.querySelectorAll('source')||[])];
   const variants=candidates.flatMap(item=>['data-srcset','srcset'].flatMap(attr=>(item.getAttribute(attr)||'').split(',').map(value=>{
     const [src,size]=value.trim().split(/\s+/);
     return {src,rank:parseFloat(size)||0};
   }))).sort((a,b)=>Math.abs(a.rank-1000)-Math.abs(b.rank-1000));
   const urls=[node.getAttribute('data-original'),node.getAttribute('data-src'),...variants.map(v=>v.src),node.getAttribute('src')].map(resolve).filter(src=>src&&!/(?:^|\.)(?:doubleclick\.net|googlesyndication\.com|taboola\.com|outbrain\.com)$/i.test(new URL(src).hostname));
   const src=urls[0];
   if(!src)return;
   const key=src.replace(/\/[^/]*w_\d+[^/]*\//,'/').split('?')[0];
   if(images.has(key))return;
   images.add(key);
   blocks.push({type:'image',text:'',sources:[...new Set(urls)].slice(0,4),alt:text(node.getAttribute('alt')),caption});
 }
 function walk(node){
   if(blocks.length>=1000||node.nodeType!==1||node.matches(ignored))return;
   const tag=node.localName;
   if(tag==='figure'){
     const caption=text(node.querySelector('figcaption')?.textContent);
     const photos=[...node.querySelectorAll('img')].filter(img=>!img.closest(ignored));
     photos.forEach((img,i)=>addImage(img,i===photos.length-1?caption:''));
     if(photos.length)return;
   }
   if(tag==='img'){addImage(node,'');return;}
   if(node.matches('[data-reader-product]')){
     blocks.push({type:'product',text:text(node.textContent)});
     return;
   }
   if(!blockTags.has(tag)){for(const child of node.children)walk(child);return;}
   let runs=[];
   const type=tag==='h5'||tag==='h6'?'h4':tag;
   function flush(){
     const value=tag==='pre'?runs.map(run=>run.text).join('').trim().slice(0,4000):text(runs.map(run=>run.text).join(''));
     if(value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069]/g,'').trim())blocks.push({type,text:value,...(runs.some(run=>run.mark)||tag==='pre'?{runs}:{}),...(tag==='li'?{ordered:node.parentElement?.localName==='ol'}:{})});
     runs=[];
   }
   function inline(part,mark){
     if(part.nodeType===3){
       const value=tag==='pre'?part.textContent:part.textContent.replace(/\s+/g,' ');
       if(value)runs.push({text:value.slice(0,4000),mark});
       return;
     }
     if(part.nodeType!==1||part.matches(ignored))return;
     if(part.matches('img,figure,ul,ol')||(part!==node&&tag==='li'&&part.matches('blockquote,pre'))){flush();walk(part);return;}
     if(part.localName==='br'){runs.push({text:'\n'});return;}
     const style={b:'strong',strong:'strong',i:'em',em:'em',code:'code'}[part.localName]||mark;
     for(const child of part.childNodes)inline(child,style);
   }
   inline(node);
   flush();
 }
 for(const child of root.children)walk(child);
 return blocks;
}
function analyzePage(html,url){
 if(typeof html==='string'&&html.length<2048&&/(?:access denied|just a moment|attention required|enable javascript|captcha)/i.test(html)){
  let site='';try{site=new URL(url).hostname.replace(/^www\./,'');}catch{}
  return {type:'webpage',title:'',description:'',imageURL:'',author:'',site,details:{},tags:[],state:'fallback',error:'site blocked automatic preview',trace:html.slice(0,200)};
 }
 const {document}=parseHTML(html);Object.defineProperty(document,'documentURI',{value:url,configurable:true});Object.defineProperty(document,'baseURI',{value:url,configurable:true});
 const meta={};for(const node of document.querySelectorAll('meta[property],meta[name]')){const key=(node.getAttribute('property')||node.getAttribute('name')||'').toLowerCase();if(!meta[key])meta[key]=text(node.getAttribute('content')||'');}
 const resolve=value=>{if(Array.isArray(value))value=value[0];if(value&&typeof value==='object')value=value.contentUrl||value.url||value['@id'];if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(value,url);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
 const objects=[];function visit(obj,depth=0){if(depth>5||objects.length>200||!obj||typeof obj!=='object')return;if(Array.isArray(obj)){for(const item of obj)visit(item,depth+1);return;}if(obj['@type'])objects.push(obj);if(obj['@graph'])visit(obj['@graph'],depth+1);if(obj.mainEntity)visit(obj.mainEntity,depth+1);}
 for(const node of document.querySelectorAll('script[type="application/ld+json"]'))try{visit(JSON.parse(node.textContent.trim().replace(/^\/\*\s*<!\[CDATA\[\s*\*\/\s*|\s*\/\*\s*\]\]>\s*\*\/$/g,'')));}catch{}
 const typeMap={VideoObject:'video',SocialMediaPosting:'social',DiscussionForumPosting:'social',Book:'book',Movie:'movie',TVSeries:'series',TVEpisode:'series',MusicAlbum:'album',MusicRecording:'song',MusicPlaylist:'playlist',Product:'product',Recipe:'recipe',Article:'article',NewsArticle:'article',BlogPosting:'article',ScholarlyArticle:'article'};
 const platform=classifyURL(url);
 const host=new URL(url).hostname.replace(/^www\./,'');
 const amazon=/(^|\.)amazon\.(?:com|co\.uk|ca|de|fr|it|es|in|co\.jp|com\.au)$/.test(host);
 const amazonBook=amazon&&!!document.querySelector('#kindle-reader-api,#ebooksProductTitle,#imgBlkFront,#ebooksImgBlkFront,[id*="isbn13"]');
 const ogBook=/^(?:books?)(?:\.|$)/i.test(meta['og:type']||'')||meta['book:isbn']||meta['books:isbn'];
 const isBook=o=>[].concat(o['@type']).includes('Book');
 const isFilm=o=>[].concat(o['@type']).some(t=>['Movie','TVSeries','TVEpisode'].includes(t));
 const isRecipe=o=>[].concat(o['@type']).includes('Recipe');
 const recipeObject=objects.find(o=>isRecipe(o)&&(recipeValues(o.recipeIngredient).length||recipeValues(o.recipeInstructions).length));
 const obj=objects.find(isBook)||(['movie','series'].includes(platform)&&objects.find(isFilm))||recipeObject||objects.find(o=>[].concat(o['@type']).some(t=>typeMap[t]))||{},schemaType=[].concat(obj['@type']||'').find(t=>typeMap[t]);
 let type=typeMap[schemaType]||platform;
 if(platform==='book'||amazonBook||ogBook||type==='product'&&/\bbooks?\b/i.test(name(obj.category)))type='book';
 if(type==='webpage'&&/article/i.test(meta['og:type']||''))type='article';
 const result={type,title:text(obj.headline||obj.name||meta['og:title']||meta['twitter:title']||document.title),description:text(obj.description||meta['og:description']||meta.description||meta['twitter:description']),imageURL:resolve([].concat(obj.image||obj.thumbnailUrl||[])[0]||meta['og:image:secure_url']||meta['og:image']||meta['twitter:image']),author:name(obj.author||obj.byArtist||meta.author||meta['article:author']),site:text(meta['og:site_name']||new URL(url).hostname),published:text(obj.datePublished||meta['article:published_time']),details:{},tags:[]};
 if(type==='book'&&amazon){
   const cover=document.querySelector('#landingImage,#ebooksImgBlkFront,#imgBlkFront');
   result.title=text(document.querySelector('#productTitle,#ebooksProductTitle')?.textContent)||result.title;
   result.author=[...document.querySelectorAll('#bylineInfo .author a.a-link-normal')].map(a=>text(a.textContent)).filter(Boolean).join(', ')||result.author;
   result.imageURL=resolve(cover?.getAttribute('data-old-hires'))||resolve(cover?.getAttribute('src'))||result.imageURL;
 }
 if(host==='music.apple.com'&&['song','album','playlist','music'].includes(type)){
   const artwork=document.querySelector('[data-testid="container-detail-header"] [data-testid="artwork-component"] picture');
   const variants=[...(artwork?.querySelectorAll('source[type="image/jpeg"][srcset]')||[])].flatMap(source=>source.getAttribute('srcset').split(',')).map(entry=>{
     const [src,width]=entry.trim().split(/\s+/);
     return {src,width:parseInt(width,10)||0};
   }).sort((a,b)=>b.width-a.width);
   const square=variants.map(variant=>resolve(variant.src)).find(src=>/^https:\/\/[^/]+\.mzstatic\.com\//i.test(src));
   if(square)result.imageURL=square;
 }
 if(['imdb.com','letterboxd.com','rottentomatoes.com'].includes(host)&&['movie','series'].includes(platform)){
   const poster=document.querySelector('[data-testid="hero-media__poster"] img, #js-poster-col img[src*="film-poster"], rt-img[slot="posterImage"], rt-img[alt^="Poster for"], img[alt^="Poster for"]');
   const socialPoster=Number(meta['og:image:height'])>Number(meta['og:image:width'])?resolve(meta['og:image']):'';
   result.posterURLs=[...new Set([...([].concat(isFilm(obj)?obj.image||[]:[]).map(resolve)),resolve(poster?.getAttribute('src')||poster?.getAttribute('data-src')),socialPoster].filter(Boolean))];
   const letterboxdTitle=document.querySelector('#js-poster-col [data-item-name]')?.getAttribute('data-item-name');
   result.title=text((isFilm(obj)?obj.name:null)||letterboxdTitle||result.title).replace(/\s*\(\d{4}\)$/, '').replace(/^[\u200b-\u200f]+/,'');
 }
 if(platform==='social'){
   const media=host==='instagram.com'?document.querySelector('img.EmbeddedMediaImage, article img[src*="cdninstagram"]'):host==='reddit.com'?document.querySelector('shreddit-post img[src*="redd.it"], [slot="post-media"] img'):null;
   result.postImageURLs=[resolve(media?.getAttribute('data-src')||media?.getAttribute('src')),...[].concat(obj.image||[]).map(resolve)].filter(Boolean);
 }
 const d=result.details;for(const [k,v]of Object.entries({artist:name(obj.byArtist||obj.inAlbum?.byArtist),album:name(obj.inAlbum),isbn:obj.isbn||meta['books:isbn']||meta['book:isbn'],runtime:obj.duration||obj.timeRequired,year:String(obj.datePublished||obj.dateCreated||'').match(/^\d{4}/)?.[0]||((['movie','series'].includes(platform))?(meta['og:title']||'').match(/\((\d{4})\)/)?.[1]:undefined),contentRating:obj.contentRating,genre:name(obj.genre),director:name(obj.director),rating:obj.aggregateRating?.ratingValue,ratingScale:obj.aggregateRating?.bestRating,author:result.author,brand:name(obj.brand),price:obj.offers?.price||obj.offers?.lowPrice||meta['product:price:amount'],currency:obj.offers?.priceCurrency||meta['product:price:currency'],servings:name(obj.recipeYield),prepTime:obj.totalTime||obj.cookTime,tracks:obj.numTracks||obj.numTracks?.value})){if(v!==undefined&&v!==null&&String(v).length)d[k]=text(String(v)).slice(0,300);}
 if(type==='recipe'){
  let ingredients=recipeValues(obj.recipeIngredient).slice(0,100);
  let instructions=recipeValues(obj.recipeInstructions).slice(0,100);
  const fallback=ingredients.length&&instructions.length?null:domRecipe(document,resolve);
  if(fallback){
   if(!ingredients.length)ingredients=fallback.ingredients;
   if(!instructions.length)instructions=fallback.instructions;
   if(fallback.title&&(!result.title||result.title===result.site))result.title=fallback.title;
   if(fallback.description&&!result.description)result.description=fallback.description;
   if(fallback.imageURL&&!result.imageURL)result.imageURL=fallback.imageURL;
   if(fallback.servings&&!d.servings)d.servings=fallback.servings;
   if(fallback.prepTime&&!d.prepTime)d.prepTime=fallback.prepTime;
   if(fallback.rating&&!d.rating)d.rating=fallback.rating;
   if(fallback.ratingScale&&!d.ratingScale)d.ratingScale=fallback.ratingScale;
  }
  d.ingredients=ingredients;
  d.instructions=instructions;
 }else if(!['book','movie','series'].includes(type)){
  const structured=document.querySelector('[itemtype*="schema.org/Recipe"]');
  const hasIngredients=document.querySelector(ingredientSelectors.join(','));
  const hasMethod=document.querySelector(methodSelectors.join(','));
  if(structured||(document.querySelector('h1')&&hasIngredients&&hasMethod)){
   const fallback=domRecipe(document,resolve);
   if(fallback){
    type='recipe';
    if(fallback.title)result.title=fallback.title;
    if(!result.description)result.description=fallback.description;
    if(!result.imageURL)result.imageURL=fallback.imageURL;
    if(fallback.servings)d.servings=fallback.servings;
    if(fallback.prepTime)d.prepTime=fallback.prepTime;
    if(fallback.rating)d.rating=fallback.rating;
    if(fallback.ratingScale)d.ratingScale=fallback.ratingScale;
    d.ingredients=fallback.ingredients;
    d.instructions=fallback.instructions;
   }
  }
 }
 result.type=type;
 const categories={movie:['movie','film','cinema'],series:['series','tv show','television'],book:['book','reading'],album:['album','music'],song:['song','music','track'],playlist:['playlist','music'],article:['article','reading'],recipe:['recipe','food','cooking'],product:['product','shopping'],social:['social','post'],video:['video']};result.tags=[...new Set([...(categories[type]||[]),...name(obj.genre).split(',').map(t=>t.trim().toLowerCase()).filter(Boolean)])];
 let article,readerRoot;
 const feature=document.querySelector('main');
 const packages=feature?.querySelector('.multi-packages');
 const productSelector='[class*="UnifiedProductCardWrapper-"]';
 const lead=feature?.querySelector('header h1');
 if(type!=='book'&&lead&&packages?.querySelector(productSelector)){
   const root=feature.cloneNode(true);
   const rows=[...root.querySelector('.multi-packages').children];
   rows.filter(row=>!row.querySelector(productSelector)).forEach(row=>row.remove());
   for(const card of root.querySelectorAll(productSelector)){
     const brand=text(card.querySelector('.upc-brandName')?.textContent);
     const product=text(card.querySelector('[class*="UnifiedProductCardName-"]')?.textContent);
     const item=document.createElement('p');
     item.setAttribute('data-reader-product','');
     item.textContent=[brand,product].filter(Boolean).join(' · ');
     if(item.textContent)card.replaceWith(item);else card.remove();
   }
   readerRoot=root;
   article={title:lead.textContent,textContent:root.textContent};
   type='article';
 }
 if(!readerRoot&&['article','webpage'].includes(type)){
   try{
     const clone=document.cloneNode(true);
     editorialOnly(clone);
     Object.defineProperty(clone,'documentURI',{value:url,configurable:true});
     article=new Readability(clone,{charThreshold:250,maxElemsToParse:40000}).parse();
     if(article)readerRoot=parseHTML(article.content).document;
   }catch{}
 }
 if(readerRoot&&(type==='article'||(type==='webpage'&&article.textContent.trim().length>=250))){
   editorialOnly(readerRoot);
   const title=text(article.title||result.title);
   const blocks=readerBlocks(readerRoot,resolve).filter(block=>block.type!=='h1'||block.text!==title);
   if(blocks.length){
     result.article={version:3,featuredImage:result.imageURL,title,author:text(article.byline||result.author),blocks,wordCount:blocks.map(block=>block.text).join(' ').trim().split(/\s+/).length};
     result.type='article';
     result.tags=[...new Set([...result.tags,'article','reading'])];
   }
 }
 return result;}
module.exports={analyzePage,classifyURL};
