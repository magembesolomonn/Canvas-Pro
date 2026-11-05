process.env.ASSET_TEST_MODE = '1';
process.env.AGAGWU_DATA_DIR = '/private/tmp/canvas-rss-test-' + Date.now();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app, net, shell } = require('electron');

const longFeedTitle = 'New Vision: Your trusted source for breaking news, analysis, exclusive interviews, headlines, and videos at newvision.co.ug';
const originalFetch = net.fetch.bind(net);
let openedURL = '';
net.fetch = (url, options) => {
  if (url === 'https://reader.test/') return Promise.resolve(new Response(
    '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>',
    { headers: { 'content-type': 'text/html' } }
  ));
  if (url === 'https://reader.test/feed.xml') return Promise.resolve(new Response(
    `<?xml version="1.0"?><rss version="2.0"><channel><title>${longFeedTitle}</title><link>https://reader.test/</link><item><guid>article-1</guid><title>First article</title><link>https://reader.test/article</link><pubDate>2026-04-25T10:00:00Z</pubDate><description><![CDATA[<p>A short preview.</p>]]></description><content:encoded><![CDATA[<figure><img src="https://reader.test/missing.jpg"></figure><p>Full feed content with <a href="https://reader.test/source">a useful link</a>. ` +
      'This full article contains context and details for readers. '.repeat(8) +
      '</p><script>window.injected=true</script>]]></content:encoded></item></channel></rss>',
    { headers: { 'content-type': 'application/rss+xml' } }
  ));
  return originalFetch(url, options);
};
shell.openExternal = async url => { openedURL = url; };
require('../electron/main.cjs');

let win;
const run = code => win.webContents.executeJavaScript(code);
async function until(predicate, message = 'RSS reader timed out') {
  for (let i = 0; i < 250; i++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

(async () => {
  await app.whenReady();
  await until(() => global.assetTestWindow);
  win = global.assetTestWindow;
  win.setSize(1180, 760);
  await until(() => !win.webContents.isLoading());
  await until(() => run("typeof RSSReader !== 'undefined' && typeof api.rssAddFeed === 'function'"));
  await until(() => run("api.rssExtractionSettings().then(settings=>settings.enabled)"));
  assert.equal(await run("$('#rss-auto-extraction').checked"), true);
  await run("$('#rss-auto-extraction').click()");
  await until(() => run("api.rssExtractionSettings().then(settings=>!settings.enabled)"));
  await run("$('#rss-auto-extraction').click()");
  await until(() => run("api.rssExtractionSettings().then(settings=>settings.enabled)"));
  const errors = [];
  win.webContents.on('console-message', event => {
    if (event.level === 'error' && !event.message.startsWith('Failed to load resource')) errors.push(event.message);
  });

  await run("$('#rss-add-feed').click()");
  assert.equal(await run("$('#rss-feed-dialog').open"), true);
  await run("$('#rss-feed-url').value='https://reader.test';$('#rss-feed-form').requestSubmit()");
  await until(() => run("!$('#rss-feed-dialog').open && $('#rss-navigation').textContent.includes('New Vision')"));
  const feedButtonSelector = `#rss-navigation button[title="${longFeedTitle}"]`;
  assert.equal(await run(`$(${JSON.stringify(feedButtonSelector)}).textContent.includes('New Vision') && !$(${JSON.stringify(feedButtonSelector)}).textContent.includes('trusted source')`), true);
  assert.equal(await run(`$(${JSON.stringify(feedButtonSelector)}+' .rss-nav-icon')?.getAttribute('src')`), 'asset://rss-image/?url='+encodeURIComponent('https://reader.test/favicon.ico'));
  await run(`$(${JSON.stringify(feedButtonSelector)}+' .rss-nav-icon').onerror(new Event('error'))`);
  assert.equal(await run(`$(${JSON.stringify(feedButtonSelector)}+' .rss-nav-mark').classList.contains('rss-nav-mark-failed') && $('#rss-navigation .rss-nav-icon').hidden`), true);
  await until(() => run("$('#rss-articles').textContent.includes('First article')"));
  assert.equal(await run("api.rssArticles({filter:'all'}).then(items=>items[0].image_url.endsWith('/missing.jpg'))"), true);
  await run("$('#rss-articles .rss-article-image')?.dispatchEvent(new Event('error'))");
  await until(() => run("!$('#rss-articles .rss-article-image')"));
  assert.equal(await run("view==='rss' && document.body.classList.contains('rss-active')"), true);
  assert.equal(await run("$('#rss-article-pane')===null && !$('#rss-workspace').hidden"), true);
  assert.equal(await run("getComputedStyle($('#rss-articles')).overflowY==='auto'"), true);

  await run("$('#rss-articles button[role=option]').click()");
  await until(() => run("$('#rss-reader-pane').textContent.includes('Full feed content')"));
  assert.equal(await run("(async()=>{const items=await api.rssArticles({filter:'all'});const article=await api.rssRead(items[0].id);return article.readerStatus==='not_required'})()"), true);
  await run("$('#rss-reader-pane img')?.dispatchEvent(new Event('error'))");
  await until(() => run("!$('#rss-reader-pane img')"));
  assert.equal(await run("!$('#rss-reader-pane script') && $('#rss-reader-pane a[data-source-url]')?.dataset.sourceUrl==='https://reader.test/source'"), true);
  await run("$('#rss-reader-pane .rss-source-link').click()");
  await until(() => openedURL === 'https://reader.test/article');
  await run("$('#rss-reader-pane .rss-icon-button').click()");
  await until(() => run("$('#rss-reader-pane .rss-icon-button').getAttribute('aria-pressed')==='true'"));
  await run("$('#rss-reader-pane .rss-state-button').click()");
  await until(() => run("$('#rss-reader-pane .rss-state-button').textContent==='Mark as read'"));
  assert.equal(await run("document.querySelectorAll('#rss-articles .rss-article').length===1 && $('#rss-reader-pane').textContent.includes('Full feed content')"), true);

  const sizes = await run(`(()=>{const list=$('.rss-article-column').getBoundingClientRect(),reader=$('#rss-reader-pane').getBoundingClientRect();return {list:list.width,reader:reader.width,bottom:reader.bottom,viewport:innerHeight};})()`);
  assert.ok(sizes.list > 240 && sizes.reader > 400 && sizes.bottom <= sizes.viewport + 1);
  fs.writeFileSync('/private/tmp/canvas-rss-reader.png', (await win.webContents.capturePage()).toPNG());
  await run("$('#show-settings').click()");
  await until(() => run("$('#settings-dialog').open && $('#settings-dialog').textContent.includes('Automatically Extract Full Articles')"));
  await new Promise(resolve => setTimeout(resolve, 100));
  const settingsSize = await run("(()=>{const rect=$('#settings-dialog').getBoundingClientRect();return {width:rect.width,height:rect.height,display:getComputedStyle($('#settings-dialog')).display}})()");
  assert.ok(settingsSize.width > 0 && settingsSize.height > 100 && settingsSize.display !== 'none');
  fs.writeFileSync('/private/tmp/canvas-rss-settings.png', (await win.webContents.capturePage()).toPNG());
  await run("$('#settings-close').click()");
  assert.deepEqual(errors, []);

  await run(`window.confirm=()=>true;$(${JSON.stringify(feedButtonSelector)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
  await until(() => global.rssFeedMenu?.items?.length);
  assert.equal(global.rssFeedMenu.items[0].label, `Unsubscribe from “${longFeedTitle}”…`);
  global.rssFeedMenuAction();
  await until(() => run("api.rssFeeds().then(feeds=>feeds.length===0)"));
  await until(() => run(`!$(${JSON.stringify(feedButtonSelector)}) && !$('#rss-remove-feed')`));

  const exited = new Promise(resolve => app.once('will-quit', resolve));
  app.quit();
  await exited;
  fs.rmSync(process.env.AGAGWU_DATA_DIR, { recursive: true, force: true });
  console.log('RSS Electron UI and IPC tests passed.');
})().catch(error => {
  console.error(error);
  app.exit(1);
});
