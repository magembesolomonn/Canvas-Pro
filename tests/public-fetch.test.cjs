const {test}=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
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
