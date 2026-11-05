const {test}=require('node:test'),assert=require('node:assert/strict');const {CaptureBridge}=require('../electron/capture-bridge.cjs');
test('closing capture bridge drains active work and prevents new or queued work',async()=>{
 const library={folders:()=>[]};const bridge=new CaptureBridge({library,directory:'/private/tmp/unused-capture-fixture',fetcher:fetch});let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let saves=0;bridge.save=async()=>{saves++;entered();await gate;return {imported:'fixture'};};
 bridge.handle({version:1,op:'capture',items:[{kind:'bookmark',pageUrl:'https://example.test',title:'one'}]});await started;bridge.handle({version:1,op:'capture',items:[{kind:'bookmark',pageUrl:'https://example.test/two',title:'two'}]});let closed=false;const done=bridge.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false,'Shutdown must wait for the active save');release();await done;assert.equal(saves,1);assert.throws(()=>bridge.handle({version:1,op:'capture',items:[{kind:'bookmark',pageUrl:'https://example.test',title:'three'}]}),/closing/);
});

test('closing capture bridge disconnects an idle browser client', {timeout:2000}, async()=>{
 const fs=require('node:fs/promises'),net=require('node:net'),path=require('node:path');
 const directory=await fs.mkdtemp('/private/tmp/canvas-bridge-');
 const bridge=new CaptureBridge({library:{},directory,fetcher:fetch});
 let client;
 try{
  await bridge.start();
  client=net.createConnection(path.join(directory,'capture.sock'));
  await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
  const disconnected=new Promise(resolve=>client.once('close',resolve));
  await bridge.close();
  await disconnected;
 }finally{
  client?.destroy();
  await fs.rm(directory,{recursive:true,force:true});
 }
});
