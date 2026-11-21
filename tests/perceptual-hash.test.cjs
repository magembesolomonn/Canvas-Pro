const {test}=require('node:test'),assert=require('node:assert/strict');
const {DEFAULT_DISTANCE,distance,bands,signature,token}=require('../electron/perceptual-hash.cjs');

test('fingerprint distance counts differing bits',()=>{
  assert.equal(distance('0f0f0f0f0f0f0f0f','0f0f0f0f0f0f0f0f'),0);
  assert.equal(distance('0f0f0f0f0f0f0f0f','0f0f0f0f0f0f0f0e'),1);
  assert.equal(distance('0000000000000000','ffffffffffffffff'),64);
  assert.equal(DEFAULT_DISTANCE,6);
});

test('malformed fingerprints are never mistaken for copies',()=>{
  assert.equal(distance('',''),64);
  assert.equal(distance('abc','abc'),64);
  assert.equal(distance(null,'0f0f0f0f0f0f0f0f'),64);
  assert.equal(distance('0f0f0f0f0f0f0f0f',undefined),64);
  assert.equal(distance('zzzzzzzzzzzzzzzz','zzzzzzzzzzzzzzzz'),64);
});

test('hashing bands guarantee a shared bucket within the distance limit',()=>{
  const base=BigInt('0x0f0f0f0f0f0f0f0f');
  const hex=value=>value.toString(16).padStart(16,'0');
  for(let bit=0;bit<64;bit++)assert.ok(overlap(hex(base),hex(base^(1n<<BigInt(bit)))));
  let state=0x9e3779b9;
  const random=()=>{state=(state*1664525+1013904223)>>>0;return state;};
  for(let trial=0;trial<500;trial++){
    let mask=0n;
    while(bitCount(mask)<6)mask|=1n<<BigInt(random()%64);
    const other=base^mask;
    assert.equal(distance(hex(base),hex(other)),6);
    assert.ok(overlap(hex(base),hex(other)));
  }
});

test('a group token ignores order and duplicates but changes with membership',()=>{
  assert.equal(signature(['b','a','a']),'a:b');
  assert.equal(token(['b','a']),token(['a','b','a']));
  assert.notEqual(token(['a','b']),token(['a','b','c']));
  assert.match(token(['a','b']),/^[0-9a-f]{32}$/);
});

function bitCount(value){let bits=0;while(value){value&=value-1n;bits++;}return bits;}
function overlap(a,b){const left=new Set(bands(a)),right=bands(b);return right.some(band=>left.has(band));}
