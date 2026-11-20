// Performance regression coverage for the virtualised infinite wall.
// The wall used to materialise every item nine times (45,000 DOM nodes for a
// 5,000-item library), which made wheel frames take ~100 ms and selection
// ~18 ms. These thresholds are deliberately generous enough for CI jitter but
// still fail hard if the wall stops virtualising or selection rescans the DOM.
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = '/private/tmp/canvas-infinite-perf-' + Date.now();
const path = require('node:path'), fs = require('node:fs'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { app } = require('electron');
const ROOT = path.join(__dirname, '..');
const { Library } = require(path.join(ROOT, 'electron/library.cjs'));
const lib = new Library(path.join(process.env.AGAGWU_DATA_DIR, 'Library'));
const png = fs.readFileSync(path.join(__dirname, 'fixtures/Portrait.png'));
fs.mkdirSync(path.join(lib.root, 'originals'), { recursive: true });
fs.writeFileSync(path.join(lib.root, 'originals', 'fixture.png'), png);
const insert = lib.db.prepare('INSERT INTO assets(id,name,ext,size,hash,stored,created,imported) VALUES(?,?,?,?,?,?,?,?)');
const N = 2000;
for (let i = 0; i < N; i++) insert.run(crypto.randomUUID(), 'Image ' + i + '.png', 'png', png.length, 'h' + i, 'originals/fixture.png', '2020-01-01', '2020-01-01');
lib.close();
require(path.join(ROOT, 'electron/main.cjs'));
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await app.whenReady();
  const win = global.assetTestWindow;
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  const run = s => win.webContents.executeJavaScript(s);
  await win.setSize(1400, 900);
  await run('refresh()');

  const built = JSON.parse(await run(`(()=>{
    const t=performance.now();InfiniteCanvas.start();const start=Math.round(performance.now()-t);
    return JSON.stringify({start,nodes:document.querySelectorAll('.infinite-item').length});
  })()`));
  await wait(100);
  const settled = JSON.parse(await run('JSON.stringify({nodes:document.querySelectorAll(".infinite-item").length,model:InfiniteCanvas.model()})'));
  console.log('WALL_BUILD', JSON.stringify({ ...built, ...settled }));
  assert.ok(built.start < 150, 'Building the wall took too long: ' + built.start + 'ms');
  assert.ok(settled.nodes < 2000, 'The wall materialised ' + settled.nodes + ' nodes; it must virtualise rows');
  assert.equal(settled.model.pitch, 172);
  assert.equal(settled.model.pageHeight, settled.model.effectiveRows * settled.model.pitch);

  const selectMs = await run(`(()=>{const t=performance.now();for(let i=0;i<40;i++)select(visible[i].id);return +((performance.now()-t)/40).toFixed(2)})()`);
  console.log('WALL_SELECT_MS', selectMs);
  assert.ok(selectMs < 3, 'Selecting a wall item scans the DOM: ' + selectMs + 'ms');

  const frames = JSON.parse(await run(`(async()=>{
    const gaps=[];let last=performance.now(),n=0;const stage=document.querySelector('.infinite-stage');
    await new Promise(res=>{function tick(ts){gaps.push(ts-last);last=ts;stage.dispatchEvent(new WheelEvent('wheel',{deltaY:14,clientX:700,clientY:450,bubbles:true,cancelable:true}));if(++n<60)requestAnimationFrame(tick);else res();}requestAnimationFrame(tick);});
    gaps.sort((a,b)=>a-b);return JSON.stringify({median:+gaps[30].toFixed(1),p95:+gaps[57].toFixed(1)});
  })()`));
  console.log('WALL_WHEEL_FRAMES', JSON.stringify(frames));
  assert.ok(frames.median < 30, 'Wheel frames are stuttering: median ' + frames.median + 'ms');
  assert.ok(frames.p95 < 50, 'Wheel frames are stuttering: p95 ' + frames.p95 + 'ms');

  const recycled = JSON.parse(await run(`(async()=>{
    const out=[];for(let i=0;i<4;i++){
      InfiniteCanvas.exit();await new Promise(r=>setTimeout(r,40));
      const hidden=document.querySelectorAll('.infinite-item').length;
      InfiniteCanvas.start();await new Promise(r=>setTimeout(r,40));
      out.push({hidden,active:document.querySelectorAll('.infinite-item').length});
    }
    return JSON.stringify(out);
  })()`));
  console.log('WALL_RECYCLING', JSON.stringify(recycled));
  for (const cycle of recycled) {
    assert.equal(cycle.hidden, 0, 'Leaving the wall keeps ' + cycle.hidden + ' nodes alive');
    assert.ok(cycle.active < 2000, 'Re-entering the wall re-created too many nodes: ' + cycle.active);
  }
  console.log('INFINITE_PERF_OK');
  app.quit();
})().catch(e => { console.error('INFINITE_PERF_FAILED', e.stack); app.exit(1); });
setTimeout(() => app.exit(2), 60000);
