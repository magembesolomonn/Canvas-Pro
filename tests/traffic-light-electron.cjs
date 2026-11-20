// Regression: the macOS traffic lights must never cover the show-sidebar
// button or the Library wordmark, and a live resize must not leave the app
// chrome animating while Chromium is catching up with the window.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('electron');
const profile = fs.mkdtempSync('/private/tmp/canvas-traffic-light-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = profile;
require('../electron/main.cjs');
let win;
const run = code => win.webContents.executeJavaScript(code);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 400; i++) { if (await check()) return; await pause(20); }
  throw Error(label + ' timed out');
}
const toolbar = "(()=>{const bar=$('.filter-bar.library-header');const t=$('#view-title').getBoundingClientRect();const s=$('#show-sidebar').getBoundingClientRect();return {pad:parseFloat(getComputedStyle(bar).paddingLeft),title:t.left,show:s.left,showVisible:getComputedStyle($('#show-sidebar')).display!=='none'};})()";
// trafficLightPosition is y=22 with a ~12px button, so its centre is y=28.
const toggleCentre = selector => run(`(()=>{const r=$('${selector}').getBoundingClientRect();return r.top+r.height/2;})()`);
async function assertAligned(selector, label) {
  const y = await toggleCentre(selector);
  assert.ok(Math.abs(y - 28) <= 2, `${label}: ${selector} centre is ${y}, traffic lights are at 28`);
};

(async () => {
  await app.whenReady();
  win = global.assetTestWindow;
  win.webContents.setBackgroundThrottling(false);
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await until(() => run("!!$('#view-title') && !!$('#show-sidebar')"), 'startup');

  // Wide window: the sidebar occupies the traffic-light band, so the toolbar
  // can keep its normal inset.
  win.setSize(1440, 900);
  await pause(250);
  const wide = await run(toolbar);
  assert.ok(wide.pad < 40, `Wide toolbar should keep the normal inset, got ${wide.pad}`);
  await assertAligned('#toggle-sidebar', 'wide');
  win.setSize(1600, 1000);
  await pause(250);
  await assertAligned('#toggle-sidebar', 'large');

  // Hiding the sidebar at any width hands the top-left corner to the toolbar;
  // it has to start after the traffic lights.
  await run("document.body.classList.add('hide-sidebar')");
  await pause(250);
  const compact = await run(toolbar);
  assert.ok(compact.pad >= 100, `Toolbar must clear the traffic lights, got ${compact.pad}`);
  assert.ok(compact.show >= 100, `Show-sidebar button is under the traffic lights at ${compact.show}`);
  assert.ok(compact.title >= 100, `Library title is under the traffic lights at ${compact.title}`);
  await assertAligned('#show-sidebar', 'hidden sidebar');
  await run("document.body.classList.remove('hide-sidebar')");
  await pause(250);

  // Narrow window: the sidebar is a drawer, so the same safe area applies.
  win.setSize(900, 700);
  await until(() => run("matchMedia('(max-width:1040px)').matches"), 'narrow media query');
  await pause(250);
  const narrow = await run(toolbar);
  assert.ok(narrow.pad >= 100, `Narrow toolbar must clear the traffic lights, got ${narrow.pad}`);
  assert.ok(narrow.showVisible, 'Show-sidebar button must be visible in drawer mode');
  assert.ok(narrow.show >= 100, `Drawer toggle is under the traffic lights at ${narrow.show}`);
  assert.ok(narrow.title >= 100, `Library title is under the traffic lights at ${narrow.title}`);
  await assertAligned('#show-sidebar', 'narrow');
  await run("document.body.classList.add('sidebar-drawer-open')");
  await pause(250);
  await assertAligned('#toggle-sidebar', 'open drawer');
  await run("document.body.classList.remove('sidebar-drawer-open')");
  await pause(250);

  // A resize marks the window while events are arriving, then settles.
  win.setSize(1100, 720);
  await pause(30);
  assert.equal(await run("document.body.classList.contains('resizing')"), true, 'Resize state should be active during a drag');
  await until(() => run("!document.body.classList.contains('resizing')"), 'resize settle');
  console.log('TRAFFIC_LIGHT_AND_RESIZE_STATE_OK');
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
