const {test}=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
const http=require('node:http');
const {PassThrough}=require('node:stream');
const {EventEmitter}=require('node:events');
const {isPublicAddress,publicFetch}=require('../electron/public-fetch.cjs');

test('automatic preview URLs reject local, reserved and mapped destinations',async()=>{
  for(const address of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254',
    '172.16.0.1','192.168.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1']){
    assert.equal(isPublicAddress(address),false,address);
  }
  for(const address of ['1.1.1.1','2606:4700::1111'])assert.equal(isPublicAddress(address),true,address);
  for(const url of ['http://localhost/','http://2130706433/','http://[::1]/','file:///etc/hosts']){
    await assert.rejects(publicFetch(url),/public/);
  }
});

test('a referrer is narrowed to its origin when the request crosses hosts',async t=>{
  const dns=require('node:dns');
  t.mock.method(dns,'lookup',(_host,_options,callback)=>callback(null,[{address:'93.184.216.34',family:4}]));
  const calls=[];
  const respondGet=(url,options,respond)=>{
    calls.push({url,options});
    const response=new PassThrough();
    response.statusCode=200;
    response.headers={};
    queueMicrotask(()=>respond(response));
    return new EventEmitter();
  };
  t.mock.method(https,'get',respondGet);
  t.mock.method(http,'get',respondGet);
  const cross=await publicFetch('https://cdn.example.com/cover',{referrer:'https://page.example/post'});
  await cross.body.cancel();
  const same=await publicFetch('https://page.example/image.jpg',{referrer:'https://page.example/post'});
  await same.body.cancel();
  const downgrade=await publicFetch('http://page.example/image.jpg',{referrer:'https://page.example/post'});
  await downgrade.body.cancel();
  assert.equal(calls[0].options.headers.Referer,'https://page.example/');
  assert.equal(calls[1].options.headers.Referer,'https://page.example/post');
  assert.equal(calls[2].options.headers.Referer,undefined);
});

test('a public preview redirect cannot connect to a loopback service',async t=>{
  const get=t.mock.method(https,'get',(_url,_options,respond)=>{
    const response=new PassThrough();
    response.statusCode=302;
    response.headers={location:'http://127.0.0.1:9999/private'};
    queueMicrotask(()=>respond(response));
    return new EventEmitter();
  });
  await assert.rejects(publicFetch('https://example.com/cover'),/public/);
  assert.equal(get.mock.callCount(),1);
});
