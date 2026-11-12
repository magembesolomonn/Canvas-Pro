// Reproduces the reported behaviour: a browser capture is written to the
// library, but the running window must show it without being restarted.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-capture-refresh-'+Date.now();
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {app}=require('electron');
const {encodeFrame,frameReader}=require('../electron/framing.cjs');
let server;
require('../electron/main.cjs');
(async()=>{
  await app.whenReady();
  let win=null;
  for(let i=0;i<100&&!win;i++){win=global.assetTestWindow;if(!win)await new Promise(r=>setTimeout(r,50));}
  if(!win) throw new Error('The test window was not created.');
  if(win.webContents.isLoading()) await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  const png=fs.readFileSync(path.join(__dirname,'fixtures/Square.png'));
  server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'image/png','Content-Length':png.length});res.end(png);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const before=await win.webContents.executeJavaScript('assets.length');
  const socketPath=path.join(app.getPath('userData'),'Bridge','capture.sock');
  const {jobId}=await new Promise((resolve,reject)=>{
    const socket=require('node:net').createConnection(socketPath);
    socket.on('error',reject);
    socket.on('connect',()=>{
      socket.on('data',frameReader(message=>{socket.end();resolve(message);},reject));
      socket.write(encodeFrame({version:1,op:'capture',items:[{kind:'image',title:'Refresh probe',mediaUrl:base+'/image.png',pageUrl:base+'/post'}]}));
    });
  });
  assert.equal(jobId!=null,true);
  let job;
  for(let i=0;i<200;i++){
    const message=await new Promise((resolve,reject)=>{
      const socket=require('node:net').createConnection(socketPath);
      socket.on('error',reject);
      socket.on('connect',()=>{
        socket.on('data',frameReader(m=>{socket.end();resolve(m);},reject));
        socket.write(encodeFrame({version:1,op:'status',jobId}));
      });
    });
    job=message.job;
    if(['complete','failed'].includes(job.state)) break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(job.state,'complete',JSON.stringify(job));
  assert.equal(job.imported,1,JSON.stringify(job));
  // The window must show the capture on its own, in the gallery itself.
  let shown=0,rendered=0,count='';
  for(let i=0;i<60;i++){
    const state=await win.webContents.executeJavaScript(`(()=>{const a=assets.find(x=>x.name&&x.name.startsWith('Refresh probe'));const cards=[...document.querySelectorAll('.card')].map(c=>c.textContent||'');return {inList:a?1:0,rendered:cards.some(t=>t.includes('Refresh probe'))?1:0,count:document.querySelector('#count')?document.querySelector('#count').textContent:''};})()`);
    shown=state.inList; rendered=state.rendered; count=state.count;
    if(shown&&rendered) break;
    await new Promise(r=>setTimeout(r,100));
  }
  console.log('CAPTURE_REFRESH',JSON.stringify({before,imported:job.imported,inList:shown,renderedInGallery:rendered,count}));
  assert.equal(shown,1,'The captured file did not reach the window list.');
  assert.equal(rendered,1,'The captured file was not drawn in the gallery.');
  app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);}).finally(async()=>{if(server)await new Promise(r=>server.close(r));fs.rmSync(process.env.AGAGWU_DATA_DIR,{recursive:true,force:true});});
