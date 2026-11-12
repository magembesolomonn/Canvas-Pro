// A tight loop for the notes block menu: type "/" in an empty paragraph and
// the block menu must appear.
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, net } = require('electron');
const data = fs.mkdtempSync('/private/tmp/canvas-notes-diag-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = data;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(__dirname, 'fixtures', 'Landscape.png')] });
require('/Users/solomon/Documents/Canvas-Pro/electron/main.cjs');
let win;
const run = source => win.webContents.executeJavaScript(source).catch(error => { console.error(source, '->', error.message); throw error; });
async function until(fn, tries = 600) {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 20)); }
  throw Error('timeout');
}
(async () => {
  await app.whenReady();
  await until(() => global.assetTestWindow);
  win = global.assetTestWindow;
  await until(() => !win.webContents.isLoading());
  // Open the notes workspace the way a person does.
  await run("$('#notes-button')?.click()");
  await until(() => run("!!$('#notes-editor') && !$('#notes-editor').inert"));
  await run(`$('#new-note').click();$('#note-template').value='blank';$('#note-template-form').requestSubmit();`);
  await until(() => run("!$('#note-template-dialog').open && !$('#notes-editor').inert"));
  const state = await run(`(()=>{const active=document.activeElement;const blocks=[...document.querySelectorAll('#note-blocks > *')].map(b=>b.className);return {activeTag:active?.tagName,activeId:active?.id||'',activeName:active?.name||'',activePlaceholder:active?.placeholder||'',activeInEditor:!!active?.closest?.('#notes-editor'),activeInBlocks:!!active?.closest?.('#note-blocks'),activeBlock:active?.closest?.('#note-blocks > *')?.className||null,blocks,paragraphs:document.querySelectorAll('.note-block-paragraph textarea').length};})()`);
  console.log('NOTES_STATE', JSON.stringify(state));
  // Type "/" the way a person does, into the focused field.
  await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))");
  let menu = false;
  try { await until(() => run("!!$('.note-block-menu')"), 100); menu = true; } catch {}
  console.log('NOTES_MENU_ON_ACTIVE', menu);
  // Now focus the paragraph the way a person does, then type "/".
  await run("document.querySelector('.note-block-paragraph textarea')?.focus()");
  await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))");
  let menu2 = false;
  try { await until(() => run("!!$('.note-block-menu')"), 100); menu2 = true; } catch {}
  console.log('NOTES_MENU_ON_PARAGRAPH', menu2);
  // And with a real key press through the browser.
  await run("document.querySelector('.note-block-paragraph textarea')?.focus()");
  win.webContents.sendInputEvent({ type: 'char', keyCode: '/' });
  let menu3 = false;
  try { await until(() => run("!!$('.note-block-menu')"), 150); menu3 = true; } catch {}
  console.log('NOTES_MENU_ON_REAL_KEY', menu3);
  app.quit();
})().catch(error => { console.error('FAILED', error.stack); app.exit(1); });
app.on('quit', () => fs.rmSync(data, { recursive: true, force: true }));
