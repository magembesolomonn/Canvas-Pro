// The picture that is saved must be the original file, not the small copy the
// page happens to show. A regression test for the "saves a low resolution
// picture" report.
const test=require('node:test');
const assert=require('node:assert/strict');
const {originalImage,largestImage}=require('../chrome-extension/social-core.js');

test('a Twitter picture is asked for at its original size',()=>{
  // Twitter always names a size in the address, so the upgrade must replace
  // that name rather than look for a missing one.
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
