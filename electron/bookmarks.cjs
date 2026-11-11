const fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {classifyURL}=require('./bookmark-types.cjs');
function smartPage(html,url){return new Promise((resolve,reject)=>{const worker=new Worker(path.join(__dirname,'page-worker.cjs'),{workerData:{html,url},resourceLimits:{maxOldGenerationSizeMb:128}});const timeout=setTimeout(()=>{worker.terminate();reject(Error('Page extraction timed out'));},10000);worker.once('message',value=>{clearTimeout(timeout);worker.terminate();value.error?reject(Error(value.error)):resolve(value);});worker.once('error',error=>{clearTimeout(timeout);reject(error);});});}

function webURL(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Use an HTTP or HTTPS link.');return u.href;}
function decode(value=''){return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,e)=>{if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[e.toLowerCase()]||'';});}
function metadata(html,url){const values=new Map();for(const match of html.matchAll(/<meta\b[^>]*>/gi)){const attrs={};for(const a of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]);const key=(attrs.property||attrs.name||'').toLowerCase();if(key&&!values.has(key))values.set(key,attrs.content||'');}
 const resolve=value=>{if(!value)return '';try{return webURL(new URL(value,url).href);}catch{return '';}};
 let icon='';for(const match of html.matchAll(/<link\b[^>]*>/gi)){const rel=match[0].match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1];if(!/\bicon\b/i.test(rel||''))continue;const href=match[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];if(href){icon=resolve(decode(href));break;}}
 let fallbackImage='';if(!values.get('og:image')&&!values.get('twitter:image'))for(const tag of html.matchAll(/<img\b[^>]*>/gi)){const src=tag[0].match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)?.[1];if(!src||/logo|avatar|emoji|icon|pixel|spacer/i.test(tag[0]))continue;const w=Number(tag[0].match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1]||0),h=Number(tag[0].match(/\bheight\s*=\s*["']?(\d+)/i)?.[1]||0);if(w>=300||h>=200||/hero|featured|cover|banner|article/i.test(tag[0])){fallbackImage=decode(src);break;}}
 const title=values.get('og:title')||values.get('twitter:title')||decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').trim();
 return {title:title.slice(0,300),description:(values.get('og:description')||values.get('description')||values.get('twitter:description')||'').slice(0,1500),imageURL:resolve(values.get('og:image:secure_url')||values.get('og:image')||values.get('twitter:image')||fallbackImage),iconURL:icon||resolve('/favicon.ico'),site:values.get('og:site_name')||new URL(url).hostname};
}
function embedURL(value){const u=new URL(webURL(value)),h=u.hostname.replace(/^www\./,'');if(['youtube.com','m.youtube.com','youtu.be'].includes(h)){const id=h==='youtu.be'?u.pathname.split('/')[1]:u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];if(/^[\w-]{11}$/.test(id||''))return 'https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1';}if(h==='open.spotify.com'&&/^\/(?:intl-[a-z]+\/)?(track|album|playlist)\/[a-zA-Z0-9]+/.test(u.pathname))return 'https://open.spotify.com/embed/'+u.pathname.replace(/^\/intl-[a-z]+\//,'/').slice(1);if(h==='music.apple.com')return 'https://embed.music.apple.com'+u.pathname+u.search;if(h==='vimeo.com'||h==='player.vimeo.com'){const id=u.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/)?.[1];if(id)return 'https://player.vimeo.com/video/'+id+'?autoplay=1';}return u.href;}
function bookmarkPlatform(value){
 const url=new URL(value),host=url.hostname.replace(/^www\./,'');
 const kind=classifyURL(value);
 return {url,host,film:['letterboxd.com','imdb.com','rottentomatoes.com'].includes(host)&&['movie','series'].includes(kind),social:kind==='social',book:kind==='book'||/(^|\.)amazon\.(?:com|co\.uk|ca|de|fr|it|es|in|co\.jp|com\.au)$/.test(host)};
}
function postImages(values,host){
 const unique=new Map();
 for(const value of values){
   if(typeof value!=='string'||!value)continue;
   try{
     const url=new URL(webURL(decode(value)));
     const domain=url.hostname;
     if(['x.com','twitter.com'].includes(host)&&!(domain==='pbs.twimg.com'&&/^\/(?:media|(?:ext_tw_video|amplify_video|tweet_video)_thumb)\//.test(url.pathname)))continue;
     if(host==='instagram.com'&&(!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(domain)||/profile_pic|s150x150/.test(url.href)))continue;
     if(['reddit.com','redd.it'].includes(host)&&!['i.redd.it','preview.redd.it','external-preview.redd.it'].includes(domain))continue;
     const key=domain==='pbs.twimg.com'?url.pathname.replace(/\.(?:jpg|jpeg|png|webp)$/i,''):url.href;
     if(!unique.has(key))unique.set(key,url.href);
   }catch{}
 }
 return [...unique.values()].slice(0,8);
}
async function limited(response,limit){if(!response.ok){await response.body?.cancel();throw new Error('Website returned '+response.status);}const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Preview is too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}return Buffer.concat(chunks,size);}
class Bookmarks{
 constructor({library,fetcher,onUpdate}){Object.assign(this,{library,fetcher,onUpdate});this.pending=new Map();this.queue=[];this.active=0;this.controllers=new Set();this.closed=false;this.waiters=[];this.visible=null;}
 path(id,kind='cover'){return path.join(this.library.root,'thumbnails',id+'.link.'+(kind==='icon'?'icon.png':'cover.jpg'));}
 cached(id){const asset=this.library.asset(id),row=this.library.db.prepare('SELECT json FROM capture_metadata WHERE id=?').get(id),captureMetadata=row?JSON.parse(row.json):{};return {asset,captureMetadata,info:captureMetadata.linkPreview};}
 async save(value,folder){const url=webURL(value),u=new URL(url),dir=await fs.promises.mkdtemp(path.join(this.library.root,'bookmark-'));try{const file=path.join(dir,u.hostname.replace(/[^\w.-]/g,'_')+'.url');await fs.promises.writeFile(file,'[InternetShortcut]\nURL='+url+'\n');const result=await this.library.importFile(file,folder),id=result.imported||result.duplicate;this.library.update(id,{url});this.library.setCaptureMetadata(id,{kind:'bookmark',pageUrl:url,capturedAt:new Date().toISOString()});return {imported:result.imported?1:0,duplicates:result.duplicate?1:0,ids:[id],errors:[],skipped:0};}finally{await fs.promises.rm(dir,{recursive:true,force:true});}}
 setVisible(ids){this.visible=new Set(ids);this.queue=this.queue.filter(job=>{if(job.priority||this.visible.has(job.id))return true;job.resolve(null);this.pending.delete(job.id);return false;});for(const c of this.controllers)if(!c.priority&&!this.visible.has(c.bookmarkId)){c.offscreen=true;c.abort();}}
 async resolveURL(id){const a=this.library.asset(id);if(a.url)return webURL(a.url);if(!['url','webloc'].includes(a.ext)||a.size>1024*1024)throw new Error('This shortcut has no saved website URL.');const text=await fs.promises.readFile(this.library.file(id),'utf8'),value=a.ext==='url'?text.match(/^URL\s*=\s*(.+)$/im)?.[1]:text.match(/<key>URL<\/key>\s*<string>([\s\S]*?)<\/string>/i)?.[1];if(!value)throw new Error('This shortcut has no saved website URL.');const url=webURL(decode(value.trim()));this.library.update(id,{url});return url;}
 get(id,{force=false}={}){if(this.closed)return Promise.resolve(null);let cached;try{cached=this.cached(id);}catch{return Promise.resolve(null);}const {asset,info}=cached;const invalid=()=>({url:asset.url||'',name:asset.name,title:asset.name.replace(/\.(url|webloc)$/i,''),site:'Bookmark',state:'invalid',updatedAt:Date.now(),cover:false,icon:false});if(!asset.url&&['url','webloc'].includes(asset.ext))return this.resolveURL(id).then(()=>this.get(id,{force})).catch(invalid);try{webURL(asset.url);}catch{return Promise.resolve(invalid());}if(!['url','webloc'].includes(asset.ext)||!asset.url||asset.trash)return Promise.resolve(null);const platform=bookmarkPlatform(asset.url);if(!force&&info?.url===asset.url&&(!platform.social||info.type==='social'&&info.smartVersion>=8)&&(platform.host!=='instagram.com'||info.smartVersion>=6)&&(!platform.book||info.smartVersion>=7)&&(!platform.film||info.smartVersion>=9)&&((platform.host==='music.apple.com'||platform.host==='imdb.com'&&info.type==='video')?info.smartVersion>=5:!platform.film&&!platform.social||info.smartVersion>=3)&&Date.now()-info.updatedAt<(info.state==='ready'?7*86400000:3600000))return Promise.resolve({...info,name:asset.name});if(this.pending.has(id))return this.pending.get(id);if(this.queue.length>=40)return Promise.resolve(null);let resolve;const result=new Promise(r=>resolve=r);this.pending.set(id,result);const job={id,resolve,cached,priority:force};if(force)this.queue.unshift(job);else this.queue.push(job);this.pump();return result;}
 pump(){while(!this.closed&&this.active<2&&this.queue.length){const job=this.queue.shift();this.active++;this.enrich(job.cached,job.priority).then(info=>job.resolve(info),()=>job.resolve(null)).finally(()=>{this.pending.delete(job.id);this.active--;this.pump();if(!this.active)for(const done of this.waiters.splice(0))done();});}}
 async image(url,id,kind,signal,responseOverride=null,poster=false){
  if(!url)return false;
  let dir;
  try{
   const response=responseOverride||await this.fetcher(webURL(url),{signal,credentials:'omit'});
   if(!/^image\//i.test(response.headers.get('content-type')||'')){await response.body?.cancel();return false;}
   const bytes=await limited(response,kind==='icon'?512*1024:5*1024*1024);
   signal.throwIfAborted();
   const target=this.path(id,kind),limit=kind==='icon'?'64':'900';
   dir=await fs.promises.mkdtemp(path.join(path.dirname(target),'.link-image-'));
   const input=path.join(dir,'source'),output=path.join(dir,path.basename(target));
   await fs.promises.writeFile(input,bytes,{signal});
   await run(path.join(__dirname,'../bin/media-tool'),['--thumbnail',input,output,limit,'40000000',poster?'portrait':'any'],{signal,timeout:8000,maxBuffer:65536});
   signal.throwIfAborted();
   await fs.promises.rename(output,target);
   return true;
  }catch{return false;}
  finally{if(dir)await fs.promises.rm(dir,{recursive:true,force:true}).catch(()=>{});}
 }
 async enrich({asset,captureMetadata,info:previous},priority=false){const controller=new AbortController();controller.bookmarkId=asset.id;controller.priority=priority;this.controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),12000);let info={url:asset.url,title:captureMetadata.pageTitle||asset.name.replace(/\.(url|webloc)$/i,''),description:captureMetadata.description||'',site:new URL(asset.url).hostname,imageURL:captureMetadata.previewImage||'',iconURL:captureMetadata.siteIcon||new URL('/favicon.ico',asset.url).href,updatedAt:Date.now(),state:'ready',type:captureMetadata.book===true?'book':classifyURL(asset.url),smartVersion:9};let coverResponse,article,posterURLs=[],socialCandidates=[captureMetadata.previewImage],socialURL;
 const platform=bookmarkPlatform(asset.url),{host}=platform;
 if(host==='imdb.com'&&info.type==='video'&&/^www\.imdb\.com$/i.test(info.title))info.title='IMDb trailer';
 const slug=host==='letterboxd.com'&&platform.url.pathname.match(/\/film\/([a-z0-9-]+)(?:\/|$)/i)?.[1];
 const instagramPost=host==='instagram.com'&&platform.url.pathname.match(/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/([\w-]+)(?:\/|$)/);
 const instagramEmbed=instagramPost?'https://www.instagram.com/'+(instagramPost[1]==='reels'?'reel':instagramPost[1])+'/'+instagramPost[2]+'/embed/':'';
 const pageURL=instagramEmbed||(slug?new URL('/film/'+slug+'/',platform.url.origin).href:asset.url);
 if(platform.film){
   const title=info.title.replace(/^.*?review of /i,'').match(/^(.+?)\s*\((\d{4})\)/);
   if(title){info.title=title[1];info.details={year:title[2]};}
 }
 try{if(true){const response=await this.fetcher(pageURL,{signal:controller.signal,credentials:'omit',...(instagramEmbed?{headers:{'User-Agent':'Canvas Pro'}}:{})});const type=response.headers.get('content-type')||'';if(/text\/html|application\/xhtml\+xml/i.test(type)){const html=(await limited(response,3*1024*1024)).toString('utf8'),parsed=metadata(html,response.url||pageURL),smart=await smartPage(html,response.url||pageURL);article=smart.article;delete smart.article;
 if(platform.film)posterURLs=smart.posterURLs||[];
 if(platform.social){
   socialCandidates=[...(smart.postImageURLs||[]),smart.imageURL,parsed.imageURL,captureMetadata.previewImage];
   if(response.url&&classifyURL(response.url)==='social')socialURL=new URL(response.url);
 }
 delete smart.posterURLs;delete smart.postImageURLs;info={...info,...Object.fromEntries(Object.entries(parsed).filter(([,v])=>v)),...Object.fromEntries(Object.entries(smart).filter(([,v])=>v!==''&&v!==undefined))};}else if(/^image\//i.test(type)){info.imageURL=asset.url;coverResponse=response;}else{await response.body?.cancel();}}
 }catch(e){info.state='fallback';info.error=e.message;}
 try{const source=socialURL||platform.url;if(host==='open.spotify.com'&&(!info.imageURL||!info.title||info.title===asset.name.replace(/\.url$/,''))){try{const response=await this.fetcher('https://open.spotify.com/oembed?url='+encodeURIComponent(asset.url),{signal:controller.signal,credentials:'omit'}),data=JSON.parse((await limited(response,256*1024)).toString('utf8'));info.title=data.title||info.title;info.imageURL=data.thumbnail_url||info.imageURL;}catch{}}
 if(platform.social){
   try{
     if(['x.com','twitter.com'].includes(host)){
       const id=source.pathname.match(/\/status\/(\d+)/)?.[1];
       if(id){
         const token=((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'');
         const data=await this.postData('https://cdn.syndication.twimg.com/tweet-result?id='+id+'&token='+token,controller.signal);
         info.author=data.user?.name||info.author;
         info.postText=typeof data.text==='string'?data.text:undefined;
         socialCandidates=[...(data.photos||[]).map(photo=>photo.url),...(data.mediaDetails||[]).map(media=>media.media_url_https),...socialCandidates];
       }
     }else if(['reddit.com','redd.it'].includes(host)){
       const id=source.pathname.match(/\/(?:comments|gallery)\/([a-z0-9]+)/i)?.[1]||(host==='redd.it'?source.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1]:null);
       if(id){
         const data=await this.postData('https://www.reddit.com/comments/'+id+'.json?raw_json=1',controller.signal);
         const post=data[0]?.data?.children?.[0]?.data;
         if(post){
           info.title=post.title||info.title;
           info.author=post.author||info.author;
           info.postText=[post.title,post.selftext].filter(Boolean).join('\n\n').slice(0,12000);
         }
         const gallery=post?.gallery_data?.items?.map(item=>post.media_metadata?.[item.media_id]?.s?.u)||[];
         socialCandidates=[...gallery,post?.url_overridden_by_dest,...(post?.preview?.images||[]).map(img=>img.source?.url),...socialCandidates];
       }
     }else if(instagramEmbed&&!postImages(socialCandidates,host).length){
       const response=await this.fetcher(asset.url,{signal:controller.signal,credentials:'omit'});
       const html=(await limited(response,3*1024*1024)).toString('utf8');
       const parsed=await smartPage(html,asset.url);
       socialCandidates=[...(parsed.postImageURLs||[]),parsed.imageURL,...socialCandidates];
       info.description=parsed.description||info.description;
     }
   }catch{}
   info.type='social';
   if(previous?.url===asset.url&&previous.type==='social'){
     if(!info.description&&info.postText===undefined)info.description=previous.postText||previous.description||'';
     if(!postImages(socialCandidates,host).length)socialCandidates=previous.postImages||[previous.imageURL];
   }
   if(info.postText===undefined){
     const description=info.description.trim();
     const caption=host==='instagram.com'&&description.match(/^[\d,.KM]+ likes?, [\d,.KM]+ comments? - .+?: ["“]([\s\S]*)["”]\.?$/i);
     info.postText=caption?caption[1]:description||(['reddit.com','redd.it'].includes(host)&&info.title!==new URL(asset.url).hostname?info.title:'');
   }
   info.postImages=postImages(socialCandidates,host);
   info.imageURL=info.postImages[0]||'';
 }
 if(platform.film&&host==='imdb.com'&&!posterURLs.length){
   const titleId=platform.url.pathname.match(/^\/title\/(tt\d+)(?:\/|$)/)?.[1];
   if(titleId){
     try{
       const lookup='https://letterboxd.com/imdb/'+titleId+'/';
       const response=await this.fetcher(lookup,{signal:controller.signal,credentials:'omit'});
       const canonical=new URL(response.url||lookup);
       if(canonical.hostname==='letterboxd.com'&&(!response.url||/^\/film\/[^/]+\/$/.test(canonical.pathname))){
         const html=(await limited(response,3*1024*1024)).toString('utf8');
         const film=await smartPage(html,canonical.href);
         posterURLs=film.posterURLs||[];
         if(posterURLs.length){
           info.title=film.title||info.title;
           info.details={...film.details,...info.details};
           info.state='ready';
           delete info.error;
         }
       }else await response.body?.cancel();
     }catch{}
   }
 }
 if(platform.film){
   if (!['movie','series'].includes(info.type)) info.type=classifyURL(asset.url);
   if(captureMetadata.previewImage)posterURLs.push(captureMetadata.previewImage);
   info.imageURL=posterURLs[0]||'';
   if(/^(?:just a moment|403 forbidden|access denied|robot check)[.!…]*$/i.test(info.title)){
     info.title=(captureMetadata.pageTitle||asset.name.replace(/\.(url|webloc)$/i,'')).replace(/^.*?review of /i,'').replace(/\s*\(\d{4}\)$/, '');
   }
 }

 if(captureMetadata.book===true&&['webpage','article','product'].includes(info.type)){
   info.type='book';
   info.title=captureMetadata.pageTitle||info.title;
   info.author=captureMetadata.author||info.author;
   info.imageURL=captureMetadata.previewImage||info.imageURL;
   info.tags=['book','reading'];
   article=null;
 }
 const embed=embedURL(asset.url);if(embed.startsWith('https://www.youtube-nocookie.com/embed/')){const id=embed.split('/embed/')[1].split('?')[0];if(!info.imageURL)info.imageURL='https://i.ytimg.com/vi/'+id+'/hqdefault.jpg';}if(embed.startsWith('https://player.vimeo.com/video/')&&!info.imageURL){try{const response=await this.fetcher('https://vimeo.com/api/oembed.json?url='+encodeURIComponent(asset.url),{signal:controller.signal,credentials:'omit'});const data=JSON.parse((await limited(response,128*1024)).toString('utf8'));info.title=data.title||info.title;info.imageURL=data.thumbnail_url||'';}catch{}}
 if(article&&!article.featuredImage){
   const editorial=article.blocks.find(block=>block.type==='image')?.sources[0];
   if(editorial)info.imageURL=editorial;
 }
 const coverURLs=platform.film?posterURLs:platform.social?info.postImages:[info.imageURL];
 const saveCover=async()=>{
   for(const url of coverURLs){
     if(await this.image(url,asset.id,'cover',controller.signal,coverResponse,platform.film)){
       info.imageURL=url;
       return true;
     }
   }
   if(platform.social&&previous?.url===asset.url&&previous.cover&&coverURLs.includes(previous.imageURL)){
     info.imageURL=previous.imageURL;
     return true;
   }
   return false;
 };
 const saveIcon=async()=>{
   if(await this.image(info.iconURL,asset.id,'icon',controller.signal))return true;
   const fallback=new URL('/favicon.ico',asset.url).href;
   return fallback!==info.iconURL&&this.image(fallback,asset.id,'icon',controller.signal);
 };
 const [cover,icon]=await Promise.all([saveCover(),saveIcon()]);info.cover=cover;info.icon=icon;if(platform.social&&!cover&&!info.postText)info.state='fallback';if(this.closed||controller.offscreen||this.library.deleting.has(asset.id))return null;const now=this.library.asset(asset.id);if(now.url!==asset.url||now.trash)return null;const oldGeneric=asset.name===new URL(asset.url).hostname+'.'+asset.ext;if(oldGeneric&&info.title&&now.name===asset.name)this.library.update(asset.id,{name:info.title+'.'+asset.ext});if(article){const file=path.join(this.library.root,'thumbnails',asset.id+'.reader.json');await fs.promises.writeFile(file+'.tmp',JSON.stringify({...article,featuredImage:article.featuredImage||info.imageURL,url:asset.url}));await fs.promises.rename(file+'.tmp',file);info.article=true;info.wordCount=article.wordCount;}info.excerpt=info.description?.slice(0,600)||'';this.library.setCaptureMetadata(asset.id,{linkPreview:info});const result={...info,name:this.library.asset(asset.id).name};this.onUpdate?.(asset.id,result);return result;
 }finally{clearTimeout(timeout);this.controllers.delete(controller);}}
 async postData(url,signal){
   const response=await this.fetcher(url,{signal,credentials:'omit',headers:{Accept:'application/json'}});
   return JSON.parse((await limited(response,1024*1024)).toString('utf8'));
 }
 async cachedReader(id){
   const {asset,info}=this.cached(id);
   if(asset.trash)return null;
   try{
     const article=JSON.parse(await fs.promises.readFile(path.join(this.library.root,'thumbnails',id+'.reader.json'),'utf8'));
     return (article.url||info?.url)===asset.url?article:null;
   }catch{return null;}
 }
 async reader(id){
   const cached=await this.cachedReader(id);
   if(cached?.version===3)return cached;
   if(this.cached(id).info?.article)await this.get(id,{force:true});
   return await this.cachedReader(id)||cached;
 }
 async readerImage(id,index,signal){
   const article=await this.cachedReader(id);
   let sources;
   if(index==='featured'){
     const {asset,info}=this.cached(id);
     if(asset.trash||info?.type!=='article'||info.url!==asset.url)return new Response(null,{status:404});
     const firstImage=article?.blocks.find(block=>block.type==='image');
     sources=[...new Set([article?.featuredImage,info.imageURL,...(firstImage?.sources||[])].filter(Boolean))];
   }else{
     const block=article?.blocks[index];
     if(block?.type!=='image')return new Response(null,{status:404});
     sources=block.sources;
   }
   return this.publicImage(sources,signal,index==='featured'?20:8);
 }
 async socialImage(id,index,signal){
   const {asset,info}=this.cached(id);
   const source=info?.postImages?.[index];
   if(asset.trash||info?.type!=='social'||info.url!==asset.url||!source)return new Response(null,{status:404});
   return this.publicImage([source],signal,8);
 }
 // The cover is normally saved to disk during enrichment. If that download
 // failed, the card can still borrow the page's own feature image.
 async webImage(id,signal){
   const {asset,info}=this.cached(id);
   if(asset.trash||info?.url!==asset.url||!['webpage','article'].includes(info?.type)||!info.imageURL)return new Response(null,{status:404});
   return this.publicImage([info.imageURL],signal,8);
 }
 async publicImage(sources,signal,megabytes){
   const deadline=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
   for(const source of sources){
     if(deadline.aborted)break;
     try{
       const response=await this.fetcher(webURL(source),{signal:deadline,credentials:'omit'});
       const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
       if(!/^image\/(?:jpeg|png|gif|webp|avif)$/.test(type)){
         await response.body?.cancel();
         continue;
       }
       return new Response(await limited(response,megabytes*1024*1024),{headers:{'Content-Type':type,'Cache-Control':'private, max-age=3600'}});
     }catch{}
   }
   return new Response(null,{status:404});
 }
 async cancelAndDrain(ids){const wanted=new Set(ids);for(const c of this.controllers)if(wanted.has(c.bookmarkId))c.abort();this.queue=this.queue.filter(job=>{if(!wanted.has(job.id))return true;job.resolve(null);this.pending.delete(job.id);return false;});await Promise.allSettled(ids.map(id=>this.pending.get(id)).filter(Boolean));}
 async close(){this.closed=true;for(const job of this.queue.splice(0)){job.resolve(null);this.pending.delete(job.id);}for(const c of this.controllers)c.abort();if(this.active)await new Promise(r=>this.waiters.push(r));}
}
module.exports={Bookmarks,metadata,embedURL,webURL,limited};
