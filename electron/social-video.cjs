const {publicFetch}=require('./public-fetch.cjs');

const platforms=['x.com','twitter.com','instagram.com','reddit.com','pinterest.com','facebook.com','tiktok.com','threads.com','threads.net','bsky.app','linkedin.com','youtube.com'];
const postPaths={
  'x.com': /\/status\/\d+(?:\/|$)/,
  'twitter.com': /\/status\/\d+(?:\/|$)/,
  'instagram.com': /^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/[^/]+/,
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
function platformFor(value){try{const host=new URL(value).hostname;return platforms.find(p=>host===p||host.endsWith('.'+p))||null;}catch{return null;}}
function postPermalink(value,platform){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||platformFor(url.href)!==platform||!postPaths[platform]?.test(url.pathname))return '';
    if(platform==='youtube.com'&&url.pathname==='/watch'&&!url.searchParams.get('v'))return '';
    if(platform==='facebook.com'&&url.pathname==='/watch/'&&!url.searchParams.get('v'))return '';
    url.hash=''; return url.href;
  }catch{return '';}
}
async function readText(url,limit=2*1024*1024,headers){
  const response=await publicFetch(url,{headers});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error('HTTP '+response.status);}
  const reader=response.body.getReader(),chunks=[];let size=0;const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Response too large');chunks.push(decoder.decode(value,{stream:true}));}}finally{await reader.cancel().catch(()=>{});}
  chunks.push(decoder.decode());return chunks.join('');
}
async function readJSON(url,headers){return JSON.parse(await readText(url,2*1024*1024,headers));}
function decodeEntities(value=''){return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,e)=>{if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[e.toLowerCase()]||'';});}
function bestVariant(variants){return (variants||[]).filter(v=>/video\/mp4/i.test(v.content_type||v.type||'')||/\.mp4(?:[?#]|$)/i.test(v.url||v.src||'')).sort((a,b)=>(b.bitrate||b.bit_rate||b.width*b.height||0)-(a.bitrate||a.bit_rate||a.width*a.height||0))[0];}
function twitterMedia(data,base){const result=[];for(const media of data.mediaDetails||[]){const variant=bestVariant(media.video_info?.variants);if(variant)result.push({...base,kind:'video',mediaUrl:variant.url||variant.src,poster:media.media_url_https||'',duration:(media.video_info?.duration_millis||0)/1000,width:media.original_info?.width||0,height:media.original_info?.height||0});else if(media.type==='photo'&&media.media_url_https)result.push({...base,kind:'image',mediaUrl:media.media_url_https,width:media.original_info?.width||0,height:media.original_info?.height||0});}if(!result.length){const variant=bestVariant(data.video?.variants);if(variant)result.push({...base,kind:'video',mediaUrl:variant.url||variant.src});}return result;}
function ogVideos(html,base){const found=[];for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){if(!/(?:og:video(?::url|:secure_url)?|twitter:player:stream)["']/i.test(tag[0]))continue;const value=tag[0].match(/content\s*=\s*["']([^"']+)["']/i)?.[1];if(!value)continue;try{const u=new URL(decodeEntities(value.replaceAll('&amp;','&')),base.pageUrl);if(/^https?:$/.test(u.protocol))found.push(u.href);}catch{}}return [...new Set(found)].slice(0,10).map(mediaUrl=>({...base,kind:'video',mediaUrl}));}
function cleanTitle(value,base){let title=String(value||base||'Post').replace(/\s+/g,' ').trim();if(!title||/^(x|twitter|instagram|reddit|pinterest|tiktok|facebook|threads|bluesky|linkedin|youtube)$/i.test(title))title=base;return title.slice(0,160)||'Post';}

async function resolveSocialVideo(value){
  const platform=platformFor(value); if(!platform) return null;
  const permalink=postPermalink(value,platform)||new URL(value).href;
  const base={pageUrl:permalink,pageTitle:'Post',title:'Post',description:'',author:''};
  let items=[],notice='';
  try{
    // X/Twitter syndication
    if((platform==='x.com'||platform==='twitter.com')){
      const id=new URL(permalink).pathname.match(/\/status\/(\d+)/)?.[1];
      if(id){
        const token=((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'');
        const data=await readJSON('https://cdn.syndication.twimg.com/tweet-result?id='+id+'&token='+token);
        base.title=cleanTitle((data.text||'').split('\n')[0],data.user?.name||'Post');
        base.pageTitle=base.title; base.author=data.user?.name||''; base.description=String(data.text||'').slice(0,2000);
        items=twitterMedia(data,base);
      }
    }
    // Reddit public json
    if(platform==='reddit.com' && !items.some(i=>i.kind==='video')){
      const u=new URL(permalink); if(u.pathname.includes('/comments/')){
        u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'')+'.json';u.searchParams.set('raw_json','1');
        const json=await readJSON(u.href);
        const data=json?.[0]?.data?.children?.[0]?.data,video=data?.secure_media?.reddit_video||data?.media?.reddit_video;
        if(video?.fallback_url){
          notice=video.is_gif?'':'Reddit’s public fallback may not include the separate audio track.';
          base.title=cleanTitle(data.title,'Reddit post'); base.author=data.author||''; base.description=String((data.title||'')+(notice?'\n'+notice:'')).slice(0,2000); base.pageTitle=base.title;
          items=[{...base,kind:'video',mediaUrl:video.fallback_url,width:video.width||0,height:video.height||0,duration:video.duration||0}];
        }
      }
    }
    // Generic og:video fallback (instagram/pinterest/tiktok/facebook/threads/linkedin/youtube etc.)
    if(!items.some(i=>i.kind==='video')){
      try{
        const html=await readText(permalink,2*1024*1024,platform==='instagram.com'?{'User-Agent':'Canvas Pro'}:undefined);
        const titleMatch=html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if(titleMatch) base.title=cleanTitle(decodeEntities(titleMatch[1]),base.title);
        const descMatch=html.match(/<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']+)["']/i);
        if(descMatch) base.description=decodeEntities(descMatch[1]).slice(0,2000);
        const found=ogVideos(html,base);
        if(found.length) items.push(...found);
      }catch{}
    }
  }catch(e){ /* fall through */ }
  // keep only direct downloadable-looking media
  items=items.filter(i=>i?.mediaUrl && /^https?:/i.test(i.mediaUrl) && !/\.(m3u8|mpd)(?:[?#]|$)/i.test(i.mediaUrl));
  const unique=new Map(items.map(i=>[i.mediaUrl,i])); items=[...unique.values()].slice(0,10);
  if(!items.length) return null;
  return {platform,permalink,items,notice};
}

module.exports={resolveSocialVideo,platformFor,postPermalink};
