// The canvas must carry a flick the way a hand does: it keeps travelling at
// the speed it was let go at, it settles without overshooting, and it can be
// caught in flight without a jump.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');

const data = fs.mkdtempSync('/private/tmp/canvas-momentum-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = data;
require('../electron/main.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  for (let i = 0; i < 200 && !global.assetTestWindow; i++) await sleep(50);
  const win = global.assetTestWindow;
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const run = source => win.webContents.executeJavaScript(source);
  const cameraX = () => run('Math.round(CanvasWorkspace.doc?.camera?.x ?? NaN)');
  await sleep(900);

  await run(`api.importPaths(['${path.join(__dirname, 'fixtures', 'Landscape.png')}'],null)`);
  await sleep(1200);
  await run(`(async()=>{const board=await api.canvasCreate('Momentum',null);await refresh();await CanvasWorkspace.open(board.id);return true;})()`);
  await sleep(1200);
  await run("CanvasWorkspace.setTool('hand')");
  const origin = await run(`(()=>{const rect=document.querySelector('#canvas-viewport').getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()`);
  const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  const flick = async () => {
    const path_ = [[origin.x, origin.y], [origin.x - 40, origin.y + 8], [origin.x - 110, origin.y + 20], [origin.x - 190, origin.y + 34]];
    send('mouseMove', path_[0][0], path_[0][1]);
    send('mouseDown', path_[0][0], path_[0][1]);
    for (const [x, y] of path_.slice(1)) { send('mouseMove', x, y); await sleep(16); }
    send('mouseUp', path_.at(-1)[0], path_.at(-1)[1]);
  };

  // A flick keeps going after the hand lets go, and it settles.
  await flick();
  const released = await cameraX();
  const samples = [];
  for (let i = 0; i < 14; i++) { samples.push(await cameraX()); await sleep(45); }
  const rest = await cameraX();
  const glide = rest - released;
  assert.ok(glide < -20, `a flick did not carry on (glide ${glide})`);
  assert.equal(await run('!CanvasWorkspace.momentum'), true, 'the glide never settled');
  // It must not overshoot and come back.
  assert.ok(Math.min(...samples) >= rest - 2, 'the glide overshot its resting point');
  console.log('CANVAS_GLIDE_CARRIES_THE_FLICK_OK', JSON.stringify({ released, rest, glide }));

  // Caught in flight, it stops where it is: no jump, no drift.
  await flick();
  await sleep(60);
  const inFlight = await cameraX();
  assert.equal(await run('!!CanvasWorkspace.momentum'), true, 'the glide was not running');
  const grabbed = await run(`(()=>{const rect=document.querySelector('#canvas-viewport').getBoundingClientRect();document.querySelector('#canvas-viewport').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:rect.x+10,clientY:rect.y+10,button:0,pointerId:1,isPrimary:true}));return Math.round(CanvasWorkspace.doc?.camera?.x ?? NaN);})()`);
  await sleep(220);
  const afterCatch = await cameraX();
  assert.equal(await run('!CanvasWorkspace.momentum'), true, 'grabbing the canvas did not stop the glide');
  assert.equal(afterCatch, grabbed, 'the camera jumped when the glide was caught');
  assert.ok(Math.abs(afterCatch - inFlight) < 40, 'the camera kept travelling after it was caught');
  await run(`document.querySelector('#canvas-viewport').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,isPrimary:true,clientX:10,clientY:10}))`);
  await sleep(300);
  console.log('CANVAS_GLIDE_CAN_BE_CAUGHT_OK', JSON.stringify({ inFlight, grabbed, afterCatch }));

  // A slow drag is a drag, not a flick: it must not glide.
  const before = await cameraX();
  send('mouseDown', origin.x, origin.y);
  for (let step = 1; step <= 6; step++) { send('mouseMove', origin.x - step * 12, origin.y); await sleep(90); }
  send('mouseUp', origin.x - 72, origin.y);
  const slowRelease = await cameraX();
  await sleep(700);
  const slowRest = await cameraX();
  assert.ok(slowRest - before < -30, 'the slow drag did not move the canvas');
  assert.equal(slowRest, slowRelease, 'a slow drag glided on its own');
  console.log('CANVAS_SLOW_DRAG_DOES_NOT_GLIDE_OK', JSON.stringify({ before, slowRelease, slowRest }));

  app.quit();
})().catch(error => { console.error('FAILED', error.stack); app.exit(1); });
