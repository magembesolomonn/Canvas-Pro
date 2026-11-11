// Link types decide where a saved link lives: social posts are media, recipes
// are recipes, and the rest stay ordinary web links. A platform counts as
// social by host, so a profile, a board or a single post all land together.
const socialHosts=/(^|\.)(x\.com|twitter\.com|instagram\.com|reddit\.com|redd\.it|facebook\.com|fb\.watch|fb\.com|pinterest\.com|pin\.it|tiktok\.com|threads\.net|threads\.com|bsky\.app)$/;
function classifyURL(value){
  let u;
  try{u=new URL(value);}catch{return 'webpage';}
  const host=u.hostname.replace(/^www\./,''),p=u.pathname;
  if(socialHosts.test(host))return 'social';
  if(/(^|\.)(spotify\.com|deezer\.com)$/.test(host)){if(/\/track\//.test(p))return 'song';if(/\/album\//.test(p))return 'album';if(/\/playlist\//.test(p))return 'playlist';}
  if(host==='music.apple.com')return u.searchParams.has('i')?'song':/\/playlist\//.test(p)?'playlist':/\/album\//.test(p)?'album':'music';
  if(/(^|\.)imdb\.com$/.test(host)&&/^\/video\//.test(p))return 'video';
  if(/(^|\.)(imdb\.com|themoviedb\.org|letterboxd\.com)$/.test(host))return /\/tv\//.test(p)?'series':'movie';
  if(host==='rottentomatoes.com'&&/^\/(m|tv)\/[^/]+/.test(p))return p.startsWith('/tv/')?'series':'movie';
  if(host==='goodreads.com'&&/^\/book\/(?:show|editions)\//.test(p)||
     host==='openlibrary.org'&&/^\/(?:books|works)\//.test(p)||
     /^books\.google\.[a-z.]+$/.test(host)&&u.searchParams.has('id')||
     /(^|\.)amazon\.(?:com|co\.uk|ca|de|fr|it|es|in|co\.jp|com\.au)$/.test(host)&&/ebook[^/]*\/dp\/[a-z0-9]{10}\b/i.test(p))return 'book';
  if(host==='linkedin.com'&&/\/(?:posts|pulse|feed\/update)\//.test(p))return 'social';
  if(/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host))return 'video';
  return 'webpage';
}
module.exports={classifyURL};
