const test=require('node:test');
const assert=require('node:assert/strict');
const {originalImage,largestImage,pageVideoMedia}=require('../chrome-extension/social-core.js');

function fakeDocument({scripts=[],videos=[],meta={},links=[]}={}){
 const element={nodeType:1,parentElement:null,querySelectorAll:()=>[]};
 return {
  videos,
  documentElement:element,
  querySelectorAll(selector){
   if(selector.includes('application/ld+json'))return scripts.map(text=>({textContent:text}));
   if(selector==='video')return videos;
   if(selector.includes('link[rel'))return links;
   return [];
  },
  querySelector(selector){
   const match=selector.match(/meta\[property="([^"]+)"\]/);
   if(match&&meta[match[1]])return {getAttribute:()=>meta[match[1]]};
   return null;
  }
 };
}
function videoElement(){return {nodeType:1,tagName:'VIDEO',parentElement:null,querySelectorAll:()=>[]};}

test('a Twitter picture is asked for at its original size',()=>{
  const url=originalImage('https://pbs.twimg.com/media/Abc123.jpg?format=jpg&name=small');
  assert.equal(url,'https://pbs.twimg.com/media/Abc123.jpg?format=jpg&name=orig');
  const medium=originalImage('https://pbs.twimg.com/media/Abc123.jpg?format=jpg&name=medium');
  assert.equal(medium,'https://pbs.twimg.com/media/Abc123.jpg?format=jpg&name=orig');
});

test('an original Twitter picture is left alone',()=>{
  const url=originalImage('https://pbs.twimg.com/media/Abc123.jpg?format=jpg&name=orig');
  assert.equal(url,'https://pbs.twimg.com/media/Abc123.jpg?format=jpg&name=orig');
});

test('other sites keep their own address',()=>{
  const url=originalImage('https://images.example.com/photo.jpg?w=640');
  assert.equal(url,'https://images.example.com/photo.jpg?w=640');
});

test('the largest picture in a source set is chosen',()=>{
  const element={
    getAttribute:name=>({srcset:'https://cdn.example.com/a.jpg 400w, https://cdn.example.com/b.jpg 1600w','data-srcset':null,'data-original':null,'data-full':null,'data-zoom-image':null}[name]??null),
    currentSrc:'https://cdn.example.com/a.jpg',
    src:'https://cdn.example.com/a.jpg'
  };
  assert.equal(largestImage(element),'https://cdn.example.com/b.jpg');
});

test('a data original address wins over the displayed one',()=>{
  const element={
    getAttribute:name=>({srcset:null,'data-srcset':null,'data-original':'https://cdn.example.com/full.jpg','data-full':null,'data-zoom-image':null}[name]??null),
    currentSrc:'https://cdn.example.com/small.jpg',
    src:'https://cdn.example.com/small.jpg'
  };
  assert.equal(largestImage(element),'https://cdn.example.com/full.jpg');
});

test('a picture without a source set is still usable',()=>{
  const element={
    getAttribute:()=>null,
    currentSrc:'https://cdn.example.com/only.jpg',
    src:'https://cdn.example.com/only.jpg'
  };
  assert.equal(largestImage(element),'https://cdn.example.com/only.jpg');
});

test('a picture that is not an address is refused',()=>{
  assert.equal(originalImage('not a url'),null);
  assert.equal(largestImage(null),null);
});

test('a streaming player resolves its real file from VideoObject metadata',()=>{
 global.document=fakeDocument({
  videos:[videoElement()],
  scripts:[JSON.stringify({'@type':'VideoObject',name:'Clip',width:720,height:532,
   thumbnailUrl:'https://cdn.example.com/poster.jpg',
   contentUrl:'https://cdn.example.com/clip.mp4'})]
 });
 const item=pageVideoMedia(videoElement());
 assert.equal(item.mediaUrl,'https://cdn.example.com/clip.mp4');
 assert.equal(item.poster,'https://cdn.example.com/poster.jpg');
 assert.equal(item.width,720);
});

test('an og:video page resolves without structured data',()=>{
 global.document=fakeDocument({
  videos:[videoElement()],
  meta:{'og:video:secure_url':'https://cdn.example.com/page.mp4','og:image':'https://cdn.example.com/page.jpg'}
 });
 const item=pageVideoMedia(videoElement());
 assert.equal(item.mediaUrl,'https://cdn.example.com/page.mp4');
 assert.equal(item.poster,'https://cdn.example.com/page.jpg');
});

test('segment playlists and blob addresses are never treated as a file',()=>{
 global.document=fakeDocument({
  videos:[videoElement()],
  scripts:[JSON.stringify({'@type':'VideoObject',contentUrl:'https://cdn.example.com/master.m3u8'})],
  meta:{'og:video':'https://cdn.example.com/stream.mpd'}
 });
 assert.equal(pageVideoMedia(videoElement()),null);
 assert.equal(pageVideoMedia(videoElement(),'blob:https://example.com/abcd'),null);
});

test('a feed with several videos and no container is left alone',()=>{
 global.document=fakeDocument({
  videos:[videoElement(),videoElement()],
  scripts:[JSON.stringify([{'@type':'VideoObject',contentUrl:'https://cdn.example.com/a.mp4'},{'@type':'VideoObject',contentUrl:'https://cdn.example.com/b.mp4'}])]
 });
 assert.equal(pageVideoMedia(null),null);
});
