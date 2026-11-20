// Eagle-inspired UI pass: image hover previews, a visible type facet row,
// richer card metadata and an information section for every file type.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { Library } = require('../electron/library.cjs');
const profile = fs.mkdtempSync('/private/tmp/canvas-eagle-ui-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = profile;
const lib = new Library(path.join(profile, 'Library'));
require('../electron/main.cjs');
(async () => {
  const id = (await lib.importFile(path.join(__dirname, 'fixtures', 'Landscape.png'))).imported;
  lib.close();
  await app.whenReady();
  const win = global.assetTestWindow;
  win.webContents.setBackgroundThrottling(false);
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  const run = code => win.webContents.executeJavaScript(code);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (check, label, time = 8000) => {
    const end = Date.now() + time;
    while (Date.now() < end) { if (await check()) return; await wait(40); }
    throw Error('Timed out: ' + label);
  };
  await win.setSize(1400, 900);
  await run('refresh()');
  await until(() => run(`!!mounted.get('${id}')`), 'card mounted');

  // Card metadata reads like a contact sheet: format and weight under the name.
  const detail = await run(`mounted.get('${id}').querySelector('.card-detail').textContent`);
  assert.match(detail, /^PNG · /, 'card metadata should lead with the file format: ' + detail);
  assert.match(detail, /B$/, 'card metadata should end with a file size: ' + detail);

  // A still image gets a delayed, non-interactive hover preview.
  await run(`mounted.get('${id}').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse',bubbles:false}))`);
  await until(() => run(`!$('#hover-preview').hidden`), 'hover preview opens');
  const hover = JSON.parse(await run(`(()=>{const box=$('#hover-preview'),img=box.querySelector('img'),r=box.getBoundingClientRect();return JSON.stringify({src:img.getAttribute('src'),label:box.querySelector('.hover-preview-label').textContent,hidden:box.hidden,aria:box.getAttribute('aria-hidden'),events:getComputedStyle(box).pointerEvents,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,size:[Math.round(r.width),Math.round(r.height)]});})()`));
  assert.equal(hover.aria, 'true');
  assert.equal(hover.events, 'none');
  assert.equal(hover.inside, true, 'hover preview must stay inside the window');
  assert.equal(hover.label, 'Landscape.png');
  assert.match(hover.src, /^asset:\/\/preview\//);
  assert.ok(hover.size[0] <= 480 && hover.size[1] <= 480, 'preview must be capped at 480px');
  await run(`mounted.get('${id}').dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse',bubbles:false}))`);
  assert.equal(await run(`$('#hover-preview').hidden`), true, 'hover preview must close on leave');
  console.log('IMAGE_HOVER_PREVIEW_OK', JSON.stringify(hover));

  // The type facet row drives the same filter as the hidden select and menu.
  await run(`$('#quick-filters [data-quick-type="video"]').click()`);
  assert.equal(await run(`$('#type').value`), 'video');
  assert.equal(await run(`$('#quick-filters [data-quick-type="video"]').getAttribute('aria-pressed')`), 'true');
  assert.equal(await run(`$('#quick-filters [data-quick-type="all"]').getAttribute('aria-pressed')`), 'false');
  assert.equal(await run(`visible.length`), 0);
  await run(`$('#quick-filters [data-quick-type="all"]').click()`);
  await until(() => run(`visible.length===1`), 'type facet restores the library');
  console.log('QUICK_TYPE_FILTER_OK');

  // Every file type gets the same compact information block.
  const inspected = await run(`(()=>{try{select('${id}');renderInspector();return 'ok'}catch(e){return e.message+' | '+e.stack}})()`);
  assert.equal(inspected, 'ok', 'renderInspector failed: ' + inspected);
  const info = JSON.parse(await run(`(()=>{const section=[...document.querySelectorAll('#inspector section')].find(s=>s.querySelector('h3')?.textContent==='Information');const labels=section?[...section.querySelectorAll('dt')].map(dt=>dt.textContent):[];return JSON.stringify({labels});})()`));
  assert.ok(info.labels.includes('Type') && info.labels.includes('Size') && info.labels.includes('Imported') && info.labels.includes('Created'), JSON.stringify(info));
  console.log('INSPECTOR_INFORMATION_OK', JSON.stringify(info));
  app.quit();
})().catch(error => { console.error('EAGLE_UI_FAILED', error); app.exit(1); });
