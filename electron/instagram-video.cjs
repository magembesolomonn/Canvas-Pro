const {publicFetch}=require('./public-fetch.cjs');
const {limited}=require('./bookmarks.cjs');

function instagramPost(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||
    !/(?:^|\.)instagram\.com$/.test(url.hostname))throw new Error('Open an Instagram post to save its video.');
 const match=url.pathname.match(/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/([\w-]+)(?:\/|$)/);
 if(!match)throw new Error('Open the Instagram post directly to save its video.');
 const kind=match[1]==='reels'?'reel':match[1];
 return {embed:'https://www.instagram.com/'+kind+'/'+match[2]+'/embed/',code:match[2],index:url.searchParams.get('img_index')};
}

function imageName(value){
 try{return new URL(value).pathname.split('/').pop();}catch{return '';}
}

function videoFromEmbed(html,post,poster){
 for(const match of html.matchAll(/"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g)){
  let media;
  try{media=JSON.parse(JSON.parse(match[1])).gql_data?.shortcode_media;}catch{continue;}
  if(media?.shortcode!==post.code)continue;
  const slides=media.edge_sidecar_to_children?.edges?.map(edge=>edge.node);
  const posterName=imageName(poster);
  const matching=posterName&&slides?.filter(slide=>[slide?.display_url,slide?.thumbnail_src].some(url=>imageName(url)===posterName));
  const byIndex=/^[1-9]\d*$/.test(post.index||'')?slides?.[Number(post.index)-1]:null;
  const selected=slides?(matching?.length===1?matching[0]:byIndex):media;
  if(!selected?.is_video||!selected.video_url)return null;
  try{
   const url=new URL(selected.video_url);
   if(url.protocol==='https:'&&!url.username&&!url.password&&
      /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)&&/\.mp4$/i.test(url.pathname)){
    return {mediaUrl:url.href,poster:selected.display_url||''};
   }
  }catch{}
  return null;
 }
 return null;
}

async function resolveInstagramVideo(pageUrl,poster){
 const post=instagramPost(pageUrl);
 const response=await publicFetch(post.embed,{headers:{'User-Agent':'Canvas Pro'}});
 const html=(await limited(response,2*1024*1024)).toString('utf8');
 return videoFromEmbed(html,post,poster);
}

module.exports={instagramPost,videoFromEmbed,resolveInstagramVideo};
