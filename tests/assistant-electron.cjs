const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, nativeTheme, shell } = require('electron');

const data = fs.mkdtempSync('/private/tmp/canvas-assistant-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = data;
let revealed;
let web;
shell.openPath = async folder => { revealed = folder; return ''; };
shell.openExternal = async url => { web = url; };
require('../electron/main.cjs');

const run = source => global.assetTestWindow.webContents.executeJavaScript(source);
async function until(check, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Timed out waiting for ' + check);
}

async function ask(command) {
  await run(`$('#assistant-command').value=${JSON.stringify(command)};$('#assistant-form').requestSubmit()`);
  await until(() => run("!$('#assistant-submit').disabled"));
}

(async () => {
  await app.whenReady();
  await until(() => global.assetTestWindow && !global.assetTestWindow.webContents.isLoading());
  const folder = path.join(data, 'Local Models', 'FunctionGemma');
  assert.equal(fs.existsSync(folder), false);
  const launcherSpace = await run(`(() => {
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    $('#assistant-launcher').dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(launcherSpace, false, 'Space on the assistant launcher should activate the button, not trigger the library shortcut');
  await run("$('#assistant-launcher').click()");
  await until(() => run("!$('#assistant-setup').hidden"));
  assert.equal(await run("$('#assistant-form').hidden"), true);
  await assert.rejects(run("api.assistantPlan('Find files named coffee')"), /Download/);
  await run("$('#assistant-setup').click()");
  await until(() => run("$('#assistant-path').textContent.length"));
  assert.equal(await run("$('#assistant-path').textContent"), folder);
  await run("$('#assistant-folder').click()");
  await until(() => revealed === folder);

  if (process.env.CANVAS_TEST_ASSISTANT_DOWNLOAD) {
    await run("$('#assistant-download').click()");
    await until(() => run("!$('#assistant-progress').hidden"));
    await run("$('#assistant-download').click()");
    await until(() => run("api.assistantState().then(state=>state.status==='missing')"));
    assert.deepEqual(fs.readdirSync(folder), []);
    await run("$('#assistant-download').click()");
    await until(() => run("api.assistantState().then(state=>{if(state.error)throw Error(state.error);return state.status==='ready'})"), 360000);
  } else if (process.env.CANVAS_TEST_ASSISTANT_FIXTURE) {
    fs.symlinkSync(path.join(process.env.CANVAS_TEST_ASSISTANT_FIXTURE, 'b12110'), path.join(folder, 'b12110'));
  } else return;
  await until(() => run("!$('#assistant-form').hidden"), 2000).catch(async () => {
    await run("$('#assistant-settings').close();$('#assistant-launcher').click();$('#assistant-launcher').click()");
    await until(() => run("!$('#assistant-form').hidden"));
  });
  await run("$('#assistant-settings').close()");
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await until(() => run(`matchMedia('(prefers-color-scheme: ${theme})').matches`));
    assert.equal(await run(`(() => {
      const bounds = $('#assistant-panel').getBoundingClientRect();
      return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom < innerHeight;
    })()`), true);
  }
  assert.deepEqual(await run("api.assistantPlan('Could you look up coffee in my library?')"), { action: 'search_library', value: 'coffee' });
  assert.equal(await run("api.assistantPlan('Delete everything')"), null);

  await ask('Create a note called Launch Plan');
  assert.equal(await run("$('#assistant-proposal').textContent"), 'Create the note “Launch Plan”?');
  assert.deepEqual(await run('api.notesList()'), []);
  await run("$('#assistant-apply').click()");
  await until(() => run("$('#assistant-message').textContent==='Done.'"));
  assert.equal(await run("$('#note-title').value"), 'Launch Plan');
  await ask('Rename this note to First Release');
  await run("$('#assistant-apply').click()");
  await until(() => run("$('#assistant-message').textContent==='Done.'"));
  assert.equal(await run("$('#note-title').value"), 'First Release');

  await ask('Find files named coffee');
  assert.equal(await run("$('#search').value"), 'coffee');
  await ask('What can you don?');
  assert.match(await run("$('#assistant-message').textContent"), /Find files.*Kendall/);
  const samples = ['Kendall cover.txt', 'kendall notes.txt', 'Other file.txt'];
  for (const name of samples) fs.writeFileSync(path.join(data, name), name);
  await run(`api.importPaths(${JSON.stringify(samples.map(name => path.join(data, name)))}, null)`);
  await until(() => run("api.libraryPage({}).then(page => page.total === 3)"));
  await ask('Find files named Kendall and create a collection called Kendall');
  assert.match(await run("$('#assistant-proposal').textContent"), /add 2 files/);
  assert.deepEqual(await run('api.libraryNavigation().then(result => result.folders)'), []);
  await run("$('#assistant-apply').click()");
  await until(() => run("$('#assistant-message').textContent==='Done.' && view==='folder' && collection==='Kendall'"));
  assert.equal(await run("api.libraryPage({view:'folder',folder:'Kendall'}).then(page=>page.total)"), 2);
  await ask('Find files named Kendall');
  await ask('Create a collection called Kendall Picks and add them there');
  assert.match(await run("$('#assistant-proposal').textContent"), /Kendall Picks.*add 2 files/);
  await run("$('#assistant-discard').click()");
  assert.deepEqual(await run('api.libraryNavigation().then(result => result.folders)'), ['Kendall']);
  await ask('Could you round up the files with Kendall in their names into a new collection named References?');
  assert.match(await run("$('#assistant-proposal').textContent"), /References.*add 2 files.*Kendall/);
  await run("$('#assistant-discard').click()");
  await ask('Make a logo for me');
  assert.match(await run("$('#assistant-message').textContent"), /couldn’t match/);
  await ask('How do I use this assistant?');
  assert.match(await run("$('#assistant-message').textContent"), /Find files/);
  await ask('Open my First Release note');
  assert.equal(await run("!$('#notes-workspace').hidden && $('#note-title').value==='First Release'"), true);
  await ask('Use Other file.txt as the note cover');
  assert.match(await run("$('#assistant-message').textContent"), /No library image/);
  const cover = path.join(__dirname, 'fixtures', 'Landscape.png');
  await run(`api.importPaths([${JSON.stringify(cover)}], null)`);
  await until(() => run("api.libraryPage({extensions:['png']}).then(page => page.total === 1)"));
  await ask('Can you set Landscape.png as the featured image?');
  assert.match(await run("$('#assistant-proposal').textContent"), /Landscape.png.*First Release/);
  await run("$('#assistant-apply').click()");
  await until(() => run("$('#note-cover img')?.naturalWidth > 0"));
  await ask('Could you start a fresh canvas titled Brand Study?');
  assert.match(await run("$('#assistant-proposal').textContent"), /Create the canvas.*Brand Study/);
  await run("$('#assistant-apply').click()");
  await until(() => run("view==='canvas' && CanvasWorkspace.doc?.board.name==='Brand Study'"));
  await ask('Could you show me the collection named Kendall?');
  await until(() => run("view==='folder' && collection==='Kendall' && visible.length===2"));
  await run("select(visible[0].id)");
  await ask('Preview this file');
  assert.equal(await run("$('#preview').hidden"), false);
  await run("closePreview()");
  await ask('Could you place these selected files on the canvas called Brand Study?');
  assert.match(await run("$('#assistant-proposal').textContent"), /Place 1 file.*Brand Study/);
  await run("$('#assistant-apply').click()");
  await until(() => run("view==='canvas' && CanvasWorkspace.doc?.items.size===1"));
  await ask('Search the web for recent movies');
  assert.equal(web, undefined);
  await run("$('#assistant-apply').click()");
  await until(() => Boolean(web));
  assert.equal(new URL(web).searchParams.get('q'), 'recent movies');
})().then(() => console.log('Ask Canvas Pro Electron checks passed.')).catch(error => {
  console.error(error);
  app.once('quit', () => process.exit(1));
}).finally(() => app.quit());
app.once('will-quit', () => fs.rmSync(data, { recursive: true, force: true }));
