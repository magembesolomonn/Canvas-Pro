// A capture that arrives while a canvas is open must still be in the library
// when the reader goes back to the library. This is the reported "the file
// only shows up after I restart the app" case.
process.env.ASSET_TEST_MODE='1';
process.env.AGAGWU_DATA_DIR='/private/tmp/canvas-capture-canvas-'+Date.now();
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
  const win=global.assetTestWindow;
  if(!win)throw new Error('No window.');
  if(win.webContents.isLoading())await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  const run=code=>win.webContents.executeJavaScript(code);
  // The library view is a paged catalogue. Reach that state the way the app
  // does it: the smart view fills the catalogue, and returning to the library
  // switches back to the paged catalogue.
  await run('hydrateCatalog()');
  await run("setView('all')");
  await run('loadLibraryPage()');
  for(let i=0;i<60;i++){if(await run('pagedCatalog===true&&catalogKey!==""'))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await run('pagedCatalog'),true,'The library is not in paged mode.');
  assert.ok(await run('appliedRefreshVersion===refreshVersion&&appliedRefreshVersion>0'),'The catalogue version counters do not agree.');
  // Open a board exactly the way a reader does, which enters the canvas view.
  const board=await run('api.canvasCreate("Capture view board")');
  const boardId=board&&board.id?board.id:board;
  await run(`CanvasWorkspace.open(${JSON.stringify(boardId)})`);
  for(let i=0;i<60;i++){if(await run(`view==='canvas'`))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await run('view'),'canvas','The canvas view did not open.');
  // The browser saves a picture while the canvas is open.
  const {jobId}=await request(socketPath,{version:1,op:'capture',items:[{kind:'image',title:'Canvas view probe',mediaUrl:base+'/image.png',pageUrl:base+'/post'}]});
  let job;
  for(let i=0;i<200;i++){
    const message=await request(socketPath,{version:1,op:'status',jobId});
    job=message.job;
    if(['complete','failed'].includes(job.state))break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(job.state,'complete',JSON.stringify(job));
  assert.equal(job.imported,1,JSON.stringify(job));
  // Give the renderer time to handle the change while the canvas is open.
  await new Promise(r=>setTimeout(r,600));
  // The reader goes back to the library.
  await run("setView('all')");
  let found=false;
  for(let i=0;i<40;i++){
    found=await run(`assets.some(a=>a.name&&a.name.startsWith('Canvas view probe'))?1:0`);
    if(found)break;
    await new Promise(r=>setTimeout(r,100));
  }
  const rendered=await run(`[...document.querySelectorAll('.card')].some(c=>(c.textContent||'').includes('Canvas view probe'))?1:0`);
  console.log('CAPTURE_CANVAS_VIEW',JSON.stringify({imported:job.imported,inLibrary:found,rendered}));
  assert.equal(found,1,'The capture was lost while a canvas was open.');
  assert.equal(rendered,1,'The capture was not drawn in the gallery.');
  app.quit();
})().catch(error=>{console.error(error.stack);app.exit(1);}).finally(async()=>{if(server)await new Promise(r=>server.close(r));fs.rmSync(process.env.AGAGWU_DATA_DIR,{recursive:true,force:true});});
