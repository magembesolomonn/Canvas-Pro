const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app, dialog} = require('electron');

const profile = fs.mkdtempSync('/private/tmp/canvas-reference-workflow-');
process.env.ASSET_TEST_MODE = '1';
process.env.ASSET_TEST_CHOOSER = '1';
process.env.AGAGWU_DATA_DIR = profile;
dialog.showMessageBox = async () => ({response: 0});
dialog.showSaveDialog = async () => ({canceled: false, filePath: path.join(profile, 'Backup.canvaslibrary')});
require('../electron/main.cjs');

async function until(check, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error(message);
}

(async () => {
  await app.whenReady();
  await until(() => global.assetTestWindow, 'Window did not open');
  const win = global.assetTestWindow;
  win.webContents.setBackgroundThrottling(false);
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const run = code => win.webContents.executeJavaScript(code);
  await until(() => run("!$('#empty').hidden && !$('#empty-sample').hidden"), 'Sample action unavailable');
  assert.equal(await run("$('#import-menu-button').textContent.trim()"), '');
  assert.equal(await run("document.body.classList.contains('hide-inspector')"), true);
  await run("$('#empty-sample').click()");
  await until(() => run('CanvasWorkspace.doc?.items.size === 4'), 'Example board did not open');
  await run("$('#canvas-output').click()");
  assert.equal(await run("$('#canvas-output-menu').matches(':popover-open')"), true);
  await run("$('#canvas-save-files').click(); $('.canvas-export-actions .primary').click()");
  await until(() => run("api.list().then(data => data.assets.some(a => a.ext === 'png'))"), 'Snapshot not created');
  await until(() => run("!$('.canvas-export-dialog[open]')"), 'Export dialog stayed open');
  assert.equal(await run(`(()=>{
    localStorage.setItem('settings-design','tasks');
    SettingsUI.open('galleries');
    const search=$('#settings-search');
    search.value='Third-party notices';
    search.dispatchEvent(new Event('input'));
    const title=$('#settings-title').textContent;
    return !$('.settings-design') && title==='About';
  })()`),true);
  await run("SettingsUI.open('library')");
  await until(() => run("$('#current-library-path').textContent === " + JSON.stringify(path.join(profile, 'Library'))), 'Current library path unavailable');
  assert.equal(await run("$('#new-library').checkVisibility() && $('#open-library').checkVisibility()"), true);
  await run("$('#library-backup').click()");
  await until(() => run("$('#backup-status').textContent.includes('Backup.canvaslibrary')"), 'Backup did not complete');
  const {Library} = require('../electron/library.cjs');
  const {CanvasStore} = require('../electron/canvas-store.cjs');
  const copy = path.join(profile, 'Restored.canvaslibrary');
  fs.cpSync(path.join(profile, 'Backup.canvaslibrary'), copy, {recursive: true});
  const restored = new Library(copy);
  try {
    const boards = new CanvasStore(restored);
    assert.equal(boards.get(boards.list()[0].id).items.length, 4);
    const snapshot = restored.list().find(asset => asset.ext === 'png');
    assert.ok(fs.statSync(restored.file(snapshot.id)).size > 0);
  } finally { restored.close(); }
  console.log('DEFAULT_LIBRARY_SAMPLE_EXPORT_BACKUP_RESTORE_OK');
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
app.on('will-quit', () => fs.rmSync(profile, {recursive: true, force: true}));
