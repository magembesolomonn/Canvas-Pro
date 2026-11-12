// A capture that arrives while the app is still starting must still appear in
// the library without a restart. This is what happens when the browser
// extension launches Canvas Pro and immediately saves a file.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-capture-startup-'+Date.now();
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),net=require('node:net');
const {app}=require('electron');
const {encodeFrame,frameReader}=require('../electron/framing.cjs');
let server;
require('../electron/main.cjs');
const request=(socketPath,message)=>new Promise((resolve,reject)=>{
  const socket=net.createConnection(socketPath);
  socket.on('error',reject);
  socket.on('connect',()=>{
    socket.on('data',frameReader(m=>{socket.end();resolve(m);},reject));
    socket.write(encodeFrame(message));
  });
});
(async()=>{
  await app.whenReady();
  const socketPath=path.join(app.getPath('userData'),'Bridge','capture.sock');
  for(let i=0;i<200&&!fs.existsSync(socketPath);i++)await new Promise(r=>setTimeout(r,50));
  const png=fs.readFileSync(path.join(__dirname,'fixtures/Square.png'));
  server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length});res.end(png);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  // The capture arrives now, while the window may still be loading.
  const {jobId}=await request(socketPath,{version:1,op:'capture',items:[{kind:'image',title:'Startup probe',mediaUrl:base+'/image.png',pageUrl:base+'/post'}]});
  let job;
  for(let i=0;i<200;i++){
    const message=await request(socketPath,{version:1,op:'status',jobId});
    job=message.job;
    if(['complete','failed'].includes(job.state))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(job.state,'complete',JSON.stringify(job));
  const win=global.assetTestWindow;
  if(!win)throw new Error('No window.');
  if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  let rendered=0,inList=0;
  for(let i=0;i<80;i++){
    const state=await win.webContents.executeJavaScript(`(()=>{const a=assets.find(x=>x.name&&x.name.startsWith('Startup probe'));const cards=[...document.querySelectorAll('.card')].map(c=>c.textContent||'');return {inList:a?1:0,rendered:cards.some(t=>t.includes('Startup probe'))?1:0};})()`);
    inList=state.inList;rendered=state.rendered;
    if(inList&&rendered)break;
    await new Promise(r=>setTimeout(r,100));
  }
  console.log('CAPTURE_STARTUP',JSON.stringify({imported:job.imported,inList,rendered}));
  assert.equal(inList,1,'The capture was lost while the app was starting.');
  assert.equal(rendered,1,'The capture was not drawn in the gallery.');
  app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);}).finally(async()=>{if(server)await new Promise(r=>server.close(r));fs.rmSync(process.env.AGAGWU_DATA_DIR,{recursive:true,force:true});});
