// Runs in the Instagram page to observe post data the page has already requested.
(()=>{
 const isPostData=value=>{
  try{
   const url=new URL(value,location.href);
   return url.origin===location.origin&&(/^\/(?:api\/)?graphql(?:\/|$)/.test(url.pathname)||/^\/api\/v1\/(?:media|feed|clips)\//.test(url.pathname));
  }catch{return false;}
 };
 const cdn=value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)?url.href:'';}catch{return '';}
 };
 const publish=data=>{
  const queue=[data],entries=[];
  for(let i=0;i<queue.length&&i<18000&&entries.length<80;i++){
   const item=queue[i];
   if(!item||typeof item!=='object')continue;
   const versions=Array.isArray(item.video_versions)?item.video_versions:[];
   const videos=[{url:item.video_url},...versions].filter(v=>v&&cdn(v.url)&&!/\.(m3u8|mpd|m4s|ts)(?:[?#]|$)/i.test(v.url));
   if(videos.length){
    videos.sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));
    const candidates=Array.isArray(item.image_versions2?.candidates)?item.image_versions2.candidates:[];
    const posters=[item.display_url,item.thumbnail_url,item.thumbnail_src,...candidates.map(c=>c?.url)].map(cdn).filter(Boolean);
    if(posters.length)entries.push({posters:posters.slice(0,8),video:videos[0].url});
   }
   for(const child of Object.values(item))if(child&&typeof child==='object')queue.push(child);
  }
  if(entries.length)window.dispatchEvent(new CustomEvent('canvas-instagram-media',{detail:JSON.stringify(entries)}));
 };
 async function inspect(response){
  if(!response.ok||!isPostData(response.url)||!response.headers.get('content-type')?.includes('json'))return;
  if(Number(response.headers.get('content-length'))>4*1024*1024||!response.body)return;
  const reader=response.clone().body.getReader(),decoder=new TextDecoder();
  let size=0,text='';
  try{
   while(true){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>4*1024*1024)return;
    text+=decoder.decode(value,{stream:true});
   }
   publish(JSON.parse((text+decoder.decode()).replace(/^for\s*\(;;\);\s*/,'')));
  }finally{reader.cancel().catch(()=>{});}
 }
 const originalFetch=window.fetch;
 window.fetch=function(...args){
  const result=originalFetch.apply(this,args);
  if(isPostData(typeof args[0]==='string'||args[0] instanceof URL?args[0]:args[0]?.url)){
   result.then(inspect).catch(()=>{});
  }
  return result;
 };
 const originalOpen=XMLHttpRequest.prototype.open;
 XMLHttpRequest.prototype.open=function(method,url,...args){
  const result=originalOpen.call(this,method,url,...args);
  if(isPostData(url))this.addEventListener('load',()=>{
   if(!isPostData(this.responseURL)||!this.getResponseHeader('content-type')?.includes('json'))return;
   try{
    if(this.responseType==='json')publish(this.response);
    else if((!this.responseType||this.responseType==='text')&&this.responseText.length<=4*1024*1024)publish(JSON.parse(this.responseText.replace(/^for\s*\(;;\);\s*/,'')));
   }catch{}
  },{once:true});
  return result;
 };
})();
