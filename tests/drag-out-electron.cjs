const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');
const { Library } = require('../electron/library.cjs');

const data = fs.mkdtempSync('/private/tmp/canvas-drag-out-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = data;
require('../electron/main.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await app.whenReady();
  const win = global.assetTestWindow;
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const run = source => win.webContents.executeJavaScript(source);
  await sleep(900);

  const library = new Library(path.join(data, 'Library'));
  const id = (await library.importFile(path.join(__dirname, 'fixtures', 'Landscape.png'))).imported;
  const original = library.file(id);
  library.close();
  await run('refresh()');
  await sleep(600);

  // Capture the native drag instead of opening a real one. The app must hand
  // over the original file, never a thumbnail or the card's preview image.
  // The icon lookup is deliberately left unresolved: the drag must start
  // immediately rather than waiting for an asynchronous icon.
  let captured = null;
  win.webContents.startDrag = options => { captured = options; };
  app.getFileIcon = () => new Promise(() => {});
  const point = await run(`(() => {
    const rect = document.querySelector('.card[data-id="${id}"]').getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  app.focus({ steal: true });
  win.focus();
  await sleep(150);
  const send = (type, x, y) => win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
  send('mouseDown', point.x, point.y);
  for (let step = 1; step <= 6; step++) {
    send('mouseMove', point.x + step * 14, point.y + step * 10);
    await sleep(45);
  }
  send('mouseUp', point.x + 84, point.y + 60);
  await sleep(700);

  assert.ok(captured, 'dragging a card out did not start a native drag');
  assert.equal(captured.file, original);
  assert.deepEqual(captured.files, [original]);
  assert.ok(captured.icon && !captured.icon.isEmpty(), 'the native drag has no file icon');
  console.log('DRAG_OUT_ORIGINAL_OK');

  // Option-drag is the in-app gesture: it carries the library ids and does not
  // start a Finder drag.
  captured = null;
  const internal = await run(`(() => {
    const transfer = new DataTransfer();
    document.querySelector('.card[data-id="${id}"]').dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer, altKey: true })
    );
    return transfer.getData('application/x-canvaspro-assets');
  })()`);
  assert.deepEqual(JSON.parse(internal), [id]);
  assert.equal(captured, null, 'Option-drag started a Finder drag');
  console.log('DRAG_INTERNAL_OPTION_OK');

  app.quit();
})().catch(error => { console.error('FAILED', error.stack); app.exit(1); });
