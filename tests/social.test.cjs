const{test}=require('node:test'),assert=require('node:assert/strict');const{platformFor,postPermalink,bestVariant,twitterMedia,direct}=require('../chrome-extension/social-core.js');
test('social adapters constrain origins and reject blob/stream URLs',()=>{assert.equal(platformFor('https://x.com/user/status/123'),'x.com');assert.equal(platformFor('https://www.pinterest.com/pin/123'),'pinterest.com');assert.equal(platformFor('https://x.com.attacker.test/'),null);assert.equal(platformFor('not a URL'),null);assert.equal(direct('blob:https://x.com/a'),null);assert.equal(direct('https://video.test/a.m3u8'),null);assert.equal(direct('https://video.test/file.mp4'),'https://video.test/file.mp4');});
test('X adapter selects the best direct MP4 without collecting quoted posts',()=>{const variants=[{content_type:'application/x-mpegURL',url:'https://video.test/a.m3u8',bitrate:99999},{content_type:'video/mp4',url:'https://video.test/small.mp4',bitrate:100},{content_type:'video/mp4',url:'https://video.test/large.mp4',bitrate:2000}];assert.equal(bestVariant(variants).bitrate,2000);const media=twitterMedia({mediaDetails:[{type:'video',media_url_https:'https://image.test/poster.jpg',video_info:{variants,duration_millis:12500}}],quoted_tweet:{mediaDetails:[{type:'photo',media_url_https:'https://other.test/quoted.jpg'}]}},{title:'Post',pageUrl:'https://x.com/u/status/123'});assert.equal(media.length,1);assert.equal(media[0].mediaUrl,'https://video.test/large.mp4');assert.equal(media[0].duration,12.5);assert.equal(media[0].pageUrl,'https://x.com/u/status/123');});

test('focused social capture selects one slide beneath an overlay and matches blob videos by poster',()=>{
 const rect=()=>({width:500,height:500});
 const image={localName:'img',currentSrc:'https://cdn.example/slide.jpg',matches:()=>true,getBoundingClientRect:rect};
 const video={localName:'video',currentSrc:'blob:https://www.instagram.com/abc',poster:'https://cdn.example/poster.jpg',
   matches:()=>true,getBoundingClientRect:rect,querySelectorAll:()=>[]};
 const overlay={matches:()=>false};
 const metadata={textContent:JSON.stringify([
   {display_url:'https://cdn.example/other.jpg',video_url:'https://cdn.example/wrong.mp4'},
   {display_url:'https://cdn.example/poster.jpg',video_versions:[{url:'https://cdn.example/focused.mp4',width:640,height:640}]}
 ])};
 let underPointer=image;
 const context={
  URL,location:{href:'https://www.instagram.com/p/example/'},
  document:{title:'Carousel',elementsFromPoint:()=>[overlay,underPointer],querySelectorAll:()=>[metadata]},
  getComputedStyle:()=>({visibility:'visible'})
 };
 const fs=require('node:fs');
 require('node:vm').runInNewContext(fs.readFileSync(require.resolve('../chrome-extension/social-core.js'),'utf8'),context);
 const {focusedMedia}=context.CanvasSocialCore;
 assert.equal(focusedMedia({clientX:50,clientY:50}).mediaUrl,image.currentSrc);
 underPointer=video;
 assert.equal(focusedMedia({clientX:50,clientY:50}).mediaUrl,'https://cdn.example/focused.mp4');
 video.poster='https://cdn.example/unknown.jpg';
 assert.equal(focusedMedia({clientX:50,clientY:50}).mediaUrl,undefined);
 video.poster='https://instagram.cdninstagram.com/observed.jpg';
 context.CanvasSocialCore.rememberInstagramMedia([{posters:[video.poster],video:'https://instagram.cdninstagram.com/observed.mp4'}]);
 assert.equal(focusedMedia({clientX:50,clientY:50}).mediaUrl,'https://instagram.cdninstagram.com/observed.mp4');

});

test('social button routes accept individual posts on their own platforms',()=>{
 const manifest=require('../chrome-extension/manifest.json');
 const script=manifest.content_scripts.find(entry=>entry.js.includes('social.js'));
 for(const [domain,path] of [
  ['facebook.com','/watch/?v=123'],['tiktok.com','/@test/video/123'],
  ['threads.com','/@test/post/abc'],['threads.net','/@test/post/abc'],
  ['bsky.app','/profile/test.example/post/abc'],['linkedin.com','/feed/update/urn:li:activity:123'],
  ['youtube.com','/watch?v=abc']
 ]){
  const url='https://www.'+domain+path;
  assert.ok(script.matches.includes('https://*.'+domain+'/*'));
  assert.equal(postPermalink(url,platformFor(url)),url);
  assert.equal(postPermalink(url,'x.com'),'');
  assert.equal(postPermalink('https://'+domain+'/',domain),'');
 }
 assert.equal(postPermalink('https://www.youtube.com/watch','youtube.com'),'');
});
