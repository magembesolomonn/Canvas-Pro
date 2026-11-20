// Native macOS behaviour that is easy to lose in a refactor: the app menu,
// the window's focus state, remembered window bounds, the canvas drag region
// and the cursor convention. Runs in the isolated test profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, Menu } = require('electron');
const profile = fs.mkdtempSync('/private/tmp/canvas-native-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = profile;
require('../electron/main.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await app.whenReady();
  const win = global.assetTestWindow;
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const run = code => win.webContents.executeJavaScript(code);
  for (let i = 0; i < 200 && !(await run("!!document.querySelector('#show-sidebar')")); i++) await pause(20);

  // 1. Settings lives in the app menu with ⌘, and Help exposes the shortcut list.
  const menu = Menu.getApplicationMenu();
  const settings = menu.items[0].submenu.items.find(item => item.label && item.label.startsWith('Settings'));
  assert.ok(settings, 'the app menu must contain Settings…');
  assert.equal(settings.accelerator, 'CmdOrCtrl+,');
  const help = menu.items.find(item => item.label === 'Help');
  assert.ok(help, 'the app must have a Help menu');
  assert.ok(help.submenu.items.some(item => item.accelerator === 'CmdOrCtrl+/'), 'Help must list the shortcuts chord');

  // 2. No accelerator is bound twice, or one of the two silently never fires.
  const seen = new Map();
  const walk = items => {
    for (const item of items) {
      if (item.accelerator) {
        assert.ok(!seen.has(item.accelerator), `${item.accelerator} is bound to both ${seen.get(item.accelerator)} and ${item.label}`);
        seen.set(item.accelerator, item.label);
      }
      if (item.submenu) walk(item.submenu.items);
    }
  };
  walk(menu.items);

  // 3. The menu items reach the renderer.
  win.webContents.send('menu-settings');
  await pause(300);
  assert.equal(await run("document.querySelector('#settings-dialog').open"), true, 'Settings… must open Settings');
  await run("document.querySelector('#settings-dialog').close()");
  win.webContents.send('show-shortcuts');
  await pause(300);
  assert.equal(await run("!!document.querySelector('#command-palette')?.open"), true, 'Keyboard Shortcuts must open the list');
  await run("document.querySelector('#command-palette').close()");

  // 4. The window reports focus, so the chrome can take its unfocused look.
  assert.equal(await run("document.body.classList.contains('window-inactive')"), false);
  win.emit('blur');
  await pause(80);
  assert.equal(await run("document.body.classList.contains('window-inactive')"), true, 'a blurred window must mark itself inactive');
  win.emit('focus');
  await pause(80);
  assert.equal(await run("document.body.classList.contains('window-inactive')"), false, 'a focused window must clear it');

  // 5. Window bounds are remembered.
  win.setBounds({ x: 120, y: 90, width: 1200, height: 800 });
  win.emit('resized');
  await pause(600);
  const saved = JSON.parse(fs.readFileSync(path.join(profile, 'window-state.json'), 'utf8'));
  assert.equal(saved.width, 1200);
  assert.equal(saved.height, 800);

  // 6. A canvas board can still move its window: the toolbar is hidden in that
  // view, so the board has to carry its own drag region, clear of the actions.
  await run("(async()=>{const board=await api.canvasCreate('Drag check');await refresh();CanvasWorkspace.open(board.id);})()");
  await pause(300);
  // With the sidebar visible it carries the window's drag band, so the board
  // stays fully interactive.
  const withSidebar = await run("getComputedStyle($('#canvas-workspace'),'::before').content");
  assert.equal(withSidebar, 'none', 'the board must stay interactive while the sidebar can drag the window');
  // With the sidebar hidden the board is the only place left to grab.
  await run("document.body.classList.add('hide-sidebar')");
  await pause(200);
  const drag = await run(`(()=>{const region=getComputedStyle($('#canvas-workspace'),'::before');const actions=$('.canvas-actions').getBoundingClientRect();return {region:region.webkitAppRegion,height:parseFloat(region.height),actionsRegion:getComputedStyle($('.canvas-actions')).webkitAppRegion};})()`);
  assert.equal(drag.region, 'drag', 'a hidden sidebar must leave the board a drag region');
  assert.ok(drag.height <= 20, `the drag strip must stay thin, got ${drag.height}px`);
  assert.equal(drag.actionsRegion, 'no-drag', 'the canvas actions must stay clickable');
  await run("document.body.classList.remove('hide-sidebar')");

  // 7. Controls use the arrow cursor; the pointing hand is for links only.
  assert.equal(await run("getComputedStyle($('#show-sidebar')).cursor"), 'default');
  assert.equal(await run("getComputedStyle(document.querySelector('#import-menu-button')).cursor"), 'default');

  console.log('NATIVE_MACOS_OK');
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
