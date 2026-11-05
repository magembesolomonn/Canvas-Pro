const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, dialog, nativeTheme, net } = require('electron');
const { DatabaseSync } = require('node:sqlite');

const data = fs.mkdtempSync('/private/tmp/canvas-notes-');
process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = data;
dialog.showOpenDialog = async (_window, options) => {
  const thumbnail = options?.title === 'Import a thumbnail';
  if (thumbnail) assert.equal(options.defaultPath, app.getPath('downloads'));
  return {canceled:false,filePaths:[path.join(__dirname,'fixtures',thumbnail?'Portrait.png':'Landscape.png')]};
};
const fetch = net.fetch.bind(net);
net.fetch = (url,options) => {
  if (url==='https://www.rottentomatoes.com/m/moon')
    return Promise.resolve(new Response('<rt-img slot="posterImage" src="https://example.test/moon.jpg"></rt-img><script type="application/ld+json">{"@type":"Movie","name":"Moon","datePublished":"2009-01-01"}</script>',{headers:{'content-type':'text/html'}}));
  if (url==='https://example.test/moon.jpg')
    return Promise.resolve(new Response(fs.readFileSync(path.join(__dirname,'fixtures/Portrait.png')),{headers:{'content-type':'image/png'}}));
  return fetch(url,options);
};
require('../electron/main.cjs');

let win;
const run = source => win.webContents.executeJavaScript(source).catch(error => { console.error(source); throw error; });
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Timed out waiting for the notes workspace');
}
async function create(template) {
  await run(`$('#new-note').click();$('#note-template').value=${JSON.stringify(template)};$('#note-template-form').requestSubmit();`);
  await until(() => run("!$('#note-template-dialog').open && !$('#notes-editor').inert"));
}
(async () => {
  await app.whenReady();
  await until(() => global.assetTestWindow);
  win = global.assetTestWindow;
  await until(() => !win.webContents.isLoading());
  await until(() => run("typeof NotesWorkspace !== 'undefined' && typeof catalogTotal === 'number'"));
  await run("$('#open-notes').click()");
  await until(() => run("!$('#notes-workspace').hidden && !$('#notes-editor').inert"));
  assert.equal(await run("$('#notes-tree').open && !$('#notes-empty').hidden"), true);
  await run("$('#new-note').click();$('#note-template').focus()");
  assert.ok(await run("$('#note-template-form .dialog-actions').getBoundingClientRect().top - $('#note-template').getBoundingClientRect().bottom >= 16"));
  await run("$('#note-template-dialog').close()");
  await create('finance');
  const finance = await run("api.notesList().then(list=>list[0].id)");
  assert.equal(await run("document.querySelectorAll('.note-tracker').length"), 2);
  await run("$('#note-block-type').value='table';$('#note-add-block').click()");
  await until(() => run("!!$('.notes-table-actions')"));
  await run("$('.notes-table-actions button').click()");
  assert.equal(await run("$('.note-block-table table tbody').rows.length"), 2);
  await run("$('.note-toggle button').click();const input=$('.note-block-toggle textarea[aria-label=\"Toggle content\"]');input.value='Invoice 202';input.dispatchEvent(new Event('input'));");
  assert.equal(await run(`(() => {
    const cell = $('.note-block-table tbody textarea');
    cell.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    return $('.note-block-table tbody').rows.length === 3 &&
      document.activeElement === $('.note-block-table tbody').rows[1].cells[0].firstChild;
  })()`), true);
  win.setSize(960, 600);
  await until(() => run("innerHeight<650"));
  assert.equal(await run(`(() => {
    const workspace = $('#notes-workspace');
    for (let i = 0; i < 10; i++) $('.notes-table-actions button').click();
    workspace.scrollTop = workspace.scrollHeight;
    return workspace.scrollTop > 0 && workspace.getBoundingClientRect().bottom <= innerHeight &&
      $('#note-add-block').getBoundingClientRect().bottom <= workspace.getBoundingClientRect().bottom;
  })()`), true);
  await run("$('#note-cover-add').click();$('#note-image-browse').click()");
  await until(() => run("$('#note-cover img')?.naturalWidth>0"));
  const image = path.join(__dirname, 'fixtures/Landscape.png');
  await run(`api.importPaths([${JSON.stringify(image)}], null)`);
  await until(() => run("api.libraryPage({extensions:['png']}).then(page=>page.total>0)"));
  await run("$('#note-cover-add').click()");
  await until(() => run("!!$('#note-image-results button')"));
  const oldCover = await run("$('#note-cover img').src");
  await run("$('#note-image-results button').click()");
  await until(async () => await run("$('#note-cover img').src") !== oldCover);
  await until(() => run("!$('#notes-editor').inert && $('#note-cover img')?.naturalWidth>0"));
  await run("$('#note-block-type').value='image';$('#note-add-block').click()");
  await until(() => run("!!$('#note-image-results button')"));
  await run("$('#note-image-results button').click()");
  await until(() => run("$('#note-blocks .note-inline-image')?.naturalWidth>0"));

  await until(() => run("$('#note-cover img')?.naturalWidth>0"));
  assert.equal(await run("!!$('#note-pages img')"),false);
  await run("$('#note-pages button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
  await run(`(() => {
    const form = $('dialog[aria-label="Note actions"] form');
    form.querySelector('input').value='🎬';
    form.requestSubmit();
  })()`);
  await until(() => run("$('#note-pages .note-emoji')?.textContent==='🎬'"));
  assert.equal(await run("$('#note-cover img').naturalWidth>0"),true);
  await create('youtube');
  await run("[...$('.note-tracker').querySelectorAll('button')].find(button=>button.textContent==='Table').click()");
  await until(() => run("!!$('.tracker-results table')"));
  await run("[...$('.note-tracker').querySelectorAll('button')].find(button=>button.textContent==='New record').click()");
  await until(() => run("!!$('.tracker-record-panel .tracker-thumbnail-choice')"));
  await run("$('.tracker-record-panel .tracker-thumbnail-choice').click()");
  await until(() => run("$('#note-image-results img')?.naturalWidth>0"));
  await run("$('#note-image-results button').click()");
  await until(() => run("$('.tracker-thumbnail-choice img')?.naturalWidth>0"));
  await run("$('.tracker-thumbnail-choice').click();$('#note-image-browse').click()");
  await until(() => run("$('.tracker-thumbnail-choice').textContent.includes('Portrait.png')"));
  await run("$('.tracker-record-panel input[aria-label=Title]').value='Thumbnail test';$('.tracker-record-panel form').requestSubmit()");
  await until(() => run("$('.tracker-thumbnail-cell img')?.naturalWidth>0"));
  assert.equal(await run("api.libraryPage({view:'all',query:'Portrait.png'}).then(page=>page.assets.some(asset=>asset.name==='Portrait.png'))"),true);
  await run("$('.tracker-results tbody button').click()");
  await until(() => run("$('.tracker-thumbnail-choice img')?.naturalWidth>0"));
  await run("$('.tracker-record-panel').close()");
  await run("$('.tracker-thumbnail-cell').click()");
  await until(() => run("[...document.querySelectorAll('#note-image-results button')].some(button=>button.title==='Landscape.png')"));
  await run("[...document.querySelectorAll('#note-image-results button')].find(button=>button.title==='Landscape.png').click()");
  await until(() => run("$('.tracker-thumbnail-cell')?.title==='Landscape.png' && $('.tracker-thumbnail-cell img')?.naturalWidth>0"));
  await run(`(() => {
    const table = [...$('.note-tracker').querySelectorAll('button')].find(button=>button.textContent==='Table');
    table.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    const dialog = $('dialog[aria-label="Tracker view settings"][open]');
    dialog.querySelector('input').value='Production table';
    [...dialog.querySelectorAll('button')].find(button=>button.textContent==='Save view').click();
  })()`);
  await until(() => run("$('.note-tracker button[aria-pressed=true]')?.textContent==='Production table'"));
  await run(`(() => {
    const board = [...$('.note-tracker').querySelectorAll('button')].find(button=>button.textContent==='Board');
    board.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
    const dialog = $('dialog[aria-label="Tracker view settings"][open]');
    const original = window.confirm;
    try {
      window.confirm=()=>true;
      [...dialog.querySelectorAll('button')].find(button=>button.textContent==='Delete view…').click();
    } finally { window.confirm=original; }
  })()`);
  await until(() => run("$('.tracker-thumbnail-cell')?.title==='Landscape.png' && ![...$('.note-tracker').querySelectorAll('button')].some(button=>button.textContent==='Board')"));
  console.log('YOUTUBE_THUMBNAIL_REPLACEMENT_AND_VIEW_SETTINGS_OK');


  assert.equal(await run("document.querySelectorAll('#note-blocks input[type=checkbox]').length"), 4);
  assert.equal(await run(`(() => {
    const first = $('.note-block-checklist textarea');
    first.setSelectionRange(first.value.length, first.value.length);
    first.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    const inserted = $('.note-block-checklist + .note-block-checklist');
    return inserted.contains(document.activeElement) && !inserted.querySelector('input').checked;
  })()`), true);
  assert.equal(await run(`(async () => {
    $('#note-block-type').value = 'bullet';
    $('#note-add-block').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const bullet = $('.note-block-bullet textarea');
    bullet.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    const blocks = $('#note-blocks'), last = blocks.lastElementChild;
    const transfer = new DataTransfer();
    last.querySelector('summary').dispatchEvent(new DragEvent('dragstart', {dataTransfer: transfer}));
    const first = blocks.firstElementChild;
    first.dispatchEvent(new DragEvent('dragover', {dataTransfer: transfer, clientY: first.getBoundingClientRect().top}));
    first.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer}));
    return blocks.firstElementChild.matches('.note-block-bullet') &&
      blocks.lastElementChild.matches('.note-block-bullet') && !blocks.querySelector('[data-note-drop]');
  })()`), true);
  await run("$('#note-blocks input[type=checkbox]').click();$('#note-up').click();");
  await until(() => run("$('#note-pages button:first-child').textContent==='YouTube workspace'"));
  await create('product');
  assert.equal(await run("$('#note-blocks input[aria-label=Heading]').value"), 'Product spec');
  assert.deepEqual(await run(`(() => {
    const row = $('.note-block-heading');
    row.querySelector('details').open = true;
    const size = row.querySelector('[aria-label="Heading size"]');
    size.value = '32';
    size.dispatchEvent(new Event('change'));
    const color = row.querySelector('[aria-label="Heading color"]');
    color.value = '#3377aa';
    color.dispatchEvent(new Event('input'));
    const input = row.querySelector('[aria-label=Heading]');
    input.setSelectionRange(7,7);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return [...document.querySelectorAll('.note-block-heading input[aria-label=Heading]')].slice(0,2)
      .map(input=>[input.value,input.style.fontSize,input.style.color]);
  })()`),[['Product','32px','rgb(51, 119, 170)'],[' spec','32px','rgb(51, 119, 170)']]);
  assert.equal(await run(`(() => {
    const paragraph = $('.note-block-paragraph textarea');
    paragraph.setSelectionRange(paragraph.value.length,paragraph.value.length);
    paragraph.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return document.activeElement.closest('.note-block').classList.contains('note-block-paragraph') &&
      document.activeElement.value==='';
  })()`),true);
  assert.equal(await run(`(() => {
    const row = $('.note-block-toggle');
    const input = row.querySelector('textarea');
    input.setSelectionRange(input.value.length,input.value.length);
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return !!$('.note-block-toggle + .note-block-toggle');
  })()`),true);

  await run("$('#navigation button').click()");
  assert.equal(await run("$('#notes-workspace').hidden && !document.body.classList.contains('notes-active')"), true);
  await run("Array.from($('#note-pages').children).find(row=>row.title==='Finance tracker').click()");
  await until(() => run("$('#note-title').value==='Finance tracker' && !$('#notes-editor').inert"));
  await until(() => run("$('#note-blocks .note-inline-image')?.naturalWidth>0"));
  assert.equal(await run("$('.note-block-toggle textarea[aria-label=\"Toggle content\"]').value"), 'Invoice 202');
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    await until(() => run(`document.body.classList.contains('light-mode')===${theme === 'light'}`));
    assert.equal(await run("getComputedStyle($('#gallery')).display==='none' && $('#note-title').getBoundingClientRect().height>0"), true);
  }
  await run("$('#note-title').value='Studio finances';$('#note-title').dispatchEvent(new Event('input'));");
  win.close();
  await until(() => win.isDestroyed());
  const database = new DatabaseSync(path.join(data, 'Library/library.sqlite'), { readOnly: true });
  try {
    const saved = database.prepare('SELECT title, emoji, length(cover) AS bytes FROM workspace_notes WHERE id=?').get(finance);
    assert.equal(saved.title, 'Studio finances');
    assert.ok(saved.bytes > 0);
    assert.equal(saved.emoji, '🎬');
    const ordered = database.prepare('SELECT title, blocks FROM workspace_notes ORDER BY position').all();
    assert.deepEqual(ordered.map(note => note.title), ['YouTube workspace', 'Studio finances', 'Product workspace']);
    assert.equal(JSON.parse(ordered[0].blocks).find(block => block.type === 'checklist').checked, true);
    const tracker = JSON.parse(ordered[0].blocks).find(block=>block.type==='tracker');
    assert.deepEqual(tracker.views.map(view=>view.name),['Production table']);
    const headings = JSON.parse(ordered[2].blocks).filter(block=>block.type==='heading');
    assert.equal(headings[1].fontSize,32);
    assert.equal(headings[1].color,'#3377aa');


  } finally { database.close(); }
  app.emit('activate');
  await until(() => global.assetTestWindow !== win);
  win = global.assetTestWindow;
  await until(() => !win.webContents.isLoading());
  await run("$('#open-notes').click()");
  await until(() => run("$('#note-title').value==='YouTube workspace'"));
  assert.equal(await run("$('#note-blocks input[type=checkbox]').checked"), true);
  await create('movies');
  await until(() => run("!!$('.tracker-gallery')"));
  await run("[...$('.note-tracker').querySelectorAll('button')].find(b=>b.textContent==='New record').click()");
  await until(() => run("!!$('.tracker-record-panel[open]')"));
  await run(`(() => {
    const form = $('.tracker-record-panel form');
    const source = form.querySelector('[aria-label=Source]');
    source.value = 'https://www.rottentomatoes.com/m/moon';
    const transfer = new DataTransfer();
    transfer.setData('text/plain',source.value);
    source.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true}));
    form.querySelector('[aria-label="Record notes"]').value = 'Practical model reference';
  })()`);
  await until(() => run("$('.tracker-record-panel [aria-label=Title]').value==='Moon' && $('.tracker-thumbnail-choice img')?.naturalWidth>0"));
  await run("$('.tracker-thumbnail-choice').click()");
  await until(() => run("$('#note-image-results img')?.naturalWidth>0"));
  assert.equal(await run("$('#note-image-title').textContent"),'Choose a poster');
  await run("$('#note-image-cancel').click();$('.tracker-record-panel form').requestSubmit()");
  console.log('MOVIE_LINK_PASTE_AND_VISUAL_POSTER_PICKER_OK');
  await until(() => run("$('.tracker-gallery .tracker-card')?.textContent.includes('Moon')"));
  await run("[...$('.note-tracker').querySelectorAll('button')].find(b=>b.textContent==='+ View').click()");
  await run(`(() => {
    const dialog = $('dialog[aria-label="Add tracker view"]');
    dialog.querySelector('select').value='board';
    [...dialog.querySelectorAll('button')].find(button=>button.textContent==='Add view').click();
  })()`);
  await until(() => run("!!$('.tracker-board .tracker-card')"));
  await run(`(() => {
    const transfer = new DataTransfer();
    $('.tracker-board .tracker-card').dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer}));
    $('.tracker-board').children[1].dispatchEvent(new DragEvent('drop',{dataTransfer:transfer}));
  })()`);
  await until(() => run("$('.tracker-board').children[1].querySelector('.tracker-card')?.textContent.includes('Moon')"));
  await until(() => run("[...$('.note-tracker').querySelectorAll('button')].some(b=>b.textContent==='Undo move'&&!b.hidden)"));
  await run("[...$('.note-tracker').querySelectorAll('button')].find(b=>b.textContent==='Undo move').click()");
  await until(() => run("$('.tracker-board').children[0].querySelector('.tracker-card')?.textContent.includes('Moon')"));
  await run("$('.tracker-board .tracker-card').click()");
  await until(() => run("$('.tracker-record-panel textarea')?.value==='Practical model reference'"));
  await run("$('.tracker-record-panel').close();$('#note-child').click();$('#note-template').value='blank';$('#note-template-form').requestSubmit();");
  await until(() => run("$('#note-title').value==='Untitled note' && $('#note-breadcrumbs button')?.textContent==='Movies & Series'"));
  await run("$('.note-block-paragraph textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}))");
  assert.equal(await run("!!$('dialog[aria-label=\"Insert a block\"][open]')"),true);
  await run("$('dialog[aria-label=\"Insert a block\"]').close();$('.note-block-paragraph textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'@',bubbles:true}))");
  await until(() => run("!!$('dialog[open] .tracker-reference-results button')"));
  await run("[...$('dialog[open] .tracker-reference-results').children].find(b=>b.textContent==='Movies & Series').click()");
  await until(() => run("!!$('.note-block-reference button')"));
  await run("$('#note-block-type').value='table';$('#note-add-block').click()");
  await until(() => run("!!$('.note-block-table')"));
  await run(`(() => {
    const input = $('.note-block-table tbody textarea');
    input.value = 'Converted example';
    input.dispatchEvent(new Event('input'));
    window.confirm = () => true;
    [...$('.note-block-table').querySelectorAll('button')].find(b=>b.textContent==='Convert to tracker…').click();
  })()`);
  await until(() => run("$('.tracker-results')?.textContent.includes('Converted example')"));
  console.log('NOTES_TRACKER_BOARD_UNDO_RECORD_DETAILS_AND_SUBPAGE_OK');
  console.log('NOTES_TEMPLATES_REORDER_COVERS_AND_CLOSE_FLUSH_OK');
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(data, { recursive: true, force: true }));
