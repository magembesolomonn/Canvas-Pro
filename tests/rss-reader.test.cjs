const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { RSSService, validURL } = require('../electron/rss-reader.cjs');
const { parseFeed, discoverFeeds, parseSitePage, readerContent, pageIsPaywalled } = require('../electron/rss-engine.cjs');

const xml = (items = '') => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Field Notes</title><link>https://news.test/</link>${items}</channel></rss>`;
const item = ({ id, title = 'A story', link, date = new Date().toISOString(), content = '<p>Full feed story.</p>', summary = '<p>Short summary.</p>' }) =>
  `<item><guid>${id}</guid><title>${title}</title><link>${link}</link><pubDate>${new Date(date).toUTCString()}</pubDate><description><![CDATA[${summary}]]></description>${content ? `<content:encoded><![CDATA[${content}]]></content:encoded>` : ''}</item>`;
const response = (body, type = 'application/rss+xml', headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': type, ...headers } });
async function waitFor(predicate, message = 'Timed out waiting for article extraction') {
  for (let index = 0; index < 200; index++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

test('parses RSS and Atom feeds, discovers website feeds, and extracts accessible reader content', () => {
  const parsed = parseFeed(xml(item({
    id: 'one', link: 'https://news.test/one',
    content: '<p>' + 'Full story with useful details. '.repeat(12) + '</p><div class="ad-slot">Ad</div><script>unsafe()</script>'
  }) + '<item><guid>two</guid><title>Photo</title><link>https://news.test/two</link><media:thumbnail url="https://news.test/photo.jpg"/></item>'), 'https://news.test/feed.xml');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.title, 'Field Notes');
  assert.equal(parsed.items[0].guid, 'one');
  assert.equal(parsed.items[0].link, 'https://news.test/one');
  assert.equal(parsed.items[0].summary, 'Short summary.');
  assert.equal(parsed.items[0].hasFullContent, true);
  assert.doesNotMatch(parsed.items[0].contentHTML, /<script|ad-slot/i);
  assert.equal(parsed.items[1].imageURL, 'https://news.test/photo.jpg');
  const descriptionOnly = parseFeed(xml(item({
    id: 'description', link: 'https://news.test/description', content: '',
    summary: '<p>' + 'This looks like a complete HTML article description but is still an excerpt. '.repeat(6) + '</p>'
  })), 'https://news.test/feed.xml');
  assert.equal(descriptionOnly.items[0].hasFullContent, false);

  const atom = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>Google News</title><entry><id>tag:news.test,one</id><title>Headline</title><link rel="alternate" href="https://news.test/story"/><summary>Excerpt</summary><published>2025-01-01T10:00:00Z</published></entry></feed>', 'https://news.test/atom.xml');
  assert.equal(atom.valid, true);
  assert.equal(atom.items[0].link, 'https://news.test/story');
  assert.equal(atom.items[0].summary, 'Excerpt');
  const apple = parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><title>Apple Newsroom</title><entry><title>Latest release</title><link href="https://apple.test/story"/><content>Apple announced a new product today.</content><link rel="enclosure" href="https://apple.test/hero.jpg" type="image/jpeg"/></entry></feed>', 'https://apple.test/rss');
  assert.equal(apple.items[0].imageURL, 'https://apple.test/hero.jpg');
  assert.equal(apple.items[0].hasFullContent, false);
  assert.deepEqual(discoverFeeds('<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml" title="Atom"></head></html>', 'https://news.test'), [
    { url: 'https://news.test/atom.xml', title: 'Atom' }
  ]);

  const paragraphs = Array.from({ length: 10 }, (_, index) =>
    `<p>Paragraph ${index} contains original reporting and useful details about this topic.</p>`).join('');
  const readable = readerContent(`<html><head><title>Reader title</title></head><body><main><article><h1>Reader title</h1>${paragraphs}<p><a href="/source">Source</a></p><script>unsafe()</script></article></main></body></html>`, 'https://news.test/story');
  assert.equal(readable.paywalled, false);
  assert.equal(readable.title, 'Reader title');
  const shortArticle = readerContent('<html><body><article><h1>A brief notice</h1><p>A short article with a meaningful but concise update.</p></article></body></html>', 'https://news.test/brief');
  assert.ok(shortArticle.contentHTML);
  assert.equal(readerContent(`<html><head><meta property="og:image" content="/hero.jpg"></head><body><article>${paragraphs}</article></body></html>`, 'https://news.test/story').imageURL, 'https://news.test/hero.jpg');
  assert.match(readable.contentHTML, /href="https:\/\/news\.test\/source"/);
  assert.doesNotMatch(readable.contentHTML, /<script/i);
  assert.equal(readerContent('<html><body><div class="paywall">Subscribe to continue</div></body></html>', 'https://news.test/paid').paywalled, true);
  assert.equal(pageIsPaywalled('<html><body><div class="paywall">Subscribe</div></body></html>'), true);
  const site = parseSitePage('<html><head><title>Journal</title><meta property="og:site_name" content="Field Journal"></head><body><nav><a href="/about">About this site</a></nav><main><article><a href="/stories/first"><img src="/images/first.jpg"><h2>A recent story with a useful headline</h2><p>Article summary.</p><time datetime="2026-04-25T10:00:00Z"></time></a></article></main></body></html>', 'https://journal.test/');
  assert.equal(site.title, 'Field Journal');
  assert.equal(site.items.length, 1);
  assert.equal(site.items[0].link, 'https://journal.test/stories/first');
  assert.equal(site.items[0].imageURL, 'https://journal.test/images/first.jpg');
  const newVision = parseSitePage(
    '<html><head><title>New Vision: Your trusted source for breaking news, analysis, exclusive interviews, headlines, and videos</title></head><body><main><article><h1>Latest story</h1></article></main></body></html>',
    'https://www.newvision.co.ug/'
  );
  assert.equal(newVision.title, 'New Vision');
  assert.equal(require('../electron/rss-engine.cjs').articleImage(
    '<html><head><meta property="og:image" content="/images/hero.jpg"></head><body><article><p>Story</p></article></body></html>',
    'https://news.test/story'
  ), 'https://news.test/images/hero.jpg');
});

test('discovers and stores feeds, deduplicates refreshes, and persists read and star state', async () => {
  const db = new DatabaseSync(':memory:');
  let version = 1;
  const fetcher = async url => {
    if (url === 'https://news.test/') return response('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>', 'text/html');
    return response(xml([
      item({ id: 'one', title: 'First story', link: 'https://news.test/one' }),
      ...(version > 1 ? [item({ id: 'two', title: 'Second story', link: 'https://news.test/two' })] : [])
    ].join('')));
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0, extractor: async () => null });
  try {
    const feed = await service.add('https://news.test/');
    assert.equal(feed.title, 'Field Notes');
    assert.equal(service.articles().length, 1);
    assert.equal(service.feeds()[0].unread_count, 1);

    version = 2;
    await service.refreshAll();
    await service.refreshAll();
    assert.equal(service.articles().length, 2);
    assert.equal(service.articles().filter(article => article.title === 'First story').length, 1);

    const article = service.articles().find(value => value.title === 'First story');
    service.setState(article.id, { read: true, starred: true });
    assert.equal(service.articles({ filter: 'starred' }).length, 1);
    assert.equal(service.articles({ unreadOnly: true }).length, 1);
    assert.equal(service.feeds()[0].unread_count, 1);
    assert.equal(service.summary().total, 2);
    assert.ok(service.summary().today >= 1);

    await assert.rejects(service.add('javascript:alert(1)'), /HTTP or HTTPS/);
    await assert.rejects(service.add('https://user:pass@news.test/feed.xml'), /HTTP or HTTPS/);
    service.remove(feed.id);
    assert.equal(service.feeds().length, 0);
    assert.equal(service.articles().length, 0);
  } finally { await service.close(); db.close(); }
});

test('uses Google News RSS when a publisher blocks its website homepage', async () => {
  const db = new DatabaseSync(':memory:');
  const googleURL = 'https://news.google.com/rss/search?q=site%3Ablocked.test&hl=en';
  const googleFeed = xml('<item><guid>google-story</guid><title>Latest report - Blocked News</title>' +
    '<link>https://news.google.com/rss/articles/story?oc=5</link>' +
    '<description><![CDATA[<p>A feed-provided article preview.</p>]]></description>' +
    '<source url="https://blocked.test/">Blocked News</source></item>');
  const fetcher = async url => {
    if (url === 'https://blocked.test/') return new Response('Blocked', { status: 403 });
    if (url === googleURL) return response(googleFeed);
    throw new Error('Unexpected request: ' + url);
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0 });
  try {
    const feed = await service.add('https://blocked.test/');
    assert.equal(feed.url, googleURL);
    assert.equal(feed.title, 'Blocked News');
    assert.equal(feed.site_url, 'https://blocked.test/');
    assert.equal(feed.source_kind, 'rss');
    const article = service.articles({ feedId: feed.id })[0];
    assert.equal(article.title, 'Latest report - Blocked News');
    assert.equal(service.articleRecord(article.id).extraction_status, 'pending');
    assert.match(service.read(article.id).readerHTML, /feed-provided article preview/);
  } finally { await service.close(); db.close(); }
});

test('reader view falls back to feed text for paywalls and caches accessible article content', async () => {
  const db = new DatabaseSync(':memory:');
  const accessibleParagraphs = Array.from({ length: 10 }, (_, index) =>
    `<p>Accessible article paragraph ${index} includes original reporting and context.</p>`).join('');
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) {
      return response(xml(
        item({ id: 'paid', title: 'Paid story', link: 'https://news.test/paid', content: '', summary: '<p>Available preview.</p>' }) +
        item({ id: 'open', title: 'Open story', link: 'https://news.test/open', content: '', summary: '<p>Open preview.</p>' })
      ));
    }
    if (url.endsWith('/paid')) return response('<html><body><main><div class="paywall">Subscribe to continue reading</div></main></body></html>', 'text/html');
    return response(`<html><head><title>Open title</title><meta property="og:image" content="/open-cover.jpg"></head><body><main><article><h1>Open title</h1>${accessibleParagraphs}</article></main></body></html>`, 'text/html');
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0,
    extractor: async () => { throw new Error('simulated Trafilatura failure'); }
  });
  try {
    await service.add('https://news.test/feed.xml');
    const paid = service.articles().find(article => article.title === 'Paid story');
    await waitFor(() => service.articleRecord(paid.id).extraction_status === 'failed');
    const gated = service.read(paid.id);
    assert.equal(gated.readerSource, 'paywall');
    assert.match(gated.readerHTML, /Available preview/);

    const open = service.articles().find(article => article.title === 'Open story');
    await waitFor(() => service.articleRecord(open.id).extraction_status === 'complete');
    const readable = service.read(open.id);
    assert.equal(readable.readerSource, 'readability');
    assert.match(readable.readerHTML, /Accessible article paragraph/);
    assert.equal(readable.image_url, 'https://news.test/open-cover.jpg');
    const cached = service.read(open.id);
    assert.equal(cached.readerSource, 'readability');
    assert.equal(cached.readerTitle, 'Open title');
  } finally { await service.close(); db.close(); }
});

test('retrieves blocked articles through crawler and archive fallbacks', async () => {
  const db = new DatabaseSync(':memory:');
  const paragraphs = Array.from({ length: 10 }, (_, index) =>
    `<p>Archived full article paragraph ${index} contains original reporting and context.</p>`).join('');
  const seen = [];
  const fetcher = async (url, options = {}) => {
    seen.push({ url, agent: options.headers?.['User-Agent'] || '' });
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'blocked', link: 'https://news.test/blocked', content: '', summary: '<p>Preview only.</p>'
    })));
    if (url === 'https://news.test/blocked')
      return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
    if (url.startsWith('https://web.archive.org/web/2id_/'))
      return response(`<html><head><title>Archived title</title></head><body><article><h1>Archived title</h1>${paragraphs}</article></body></html>`, 'text/html');
    throw new Error('Unexpected request: ' + url);
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0, extractor: async () => null, readerProxy: true
  });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'complete');
    const reader = service.read(article.id);
    assert.match(reader.readerHTML, /Archived full article paragraph/);
    assert.notEqual(reader.readerSource, 'paywall');
    assert.ok(seen.some(request => request.agent.includes('Googlebot')), 'expected a Googlebot attempt');
    assert.ok(seen.some(request => request.url.startsWith('https://web.archive.org/web/2id_/')),
      'expected a Wayback Machine attempt');
  } finally { await service.close(); db.close(); }
});

test('the archive fallback setting can be turned off', async () => {
  const db = new DatabaseSync(':memory:');
  const paragraphs = Array.from({ length: 10 }, (_, index) =>
    `<p>Archived paragraph ${index} contains original reporting and context.</p>`).join('');
  let waybackRequests = 0;
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'blocked', link: 'https://news.test/blocked', content: '', summary: '<p>Preview only.</p>'
    })));
    if (url.startsWith('https://web.archive.org/web/2id_/')) {
      waybackRequests++;
      return response(`<html><body><article>${paragraphs}</article></body></html>`, 'text/html');
    }
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0, extractor: async () => null, readerProxy: true
  });
  try {
    assert.equal(service.setReaderProxy(false).enabled, false);
    assert.equal(service.readerProxySetting(), false);
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'failed');
    assert.equal(waybackRequests, 0);
    assert.equal(service.read(article.id).readerSource, 'feed');
    assert.equal(service.setReaderProxy(true).enabled, true);
  } finally { await service.close(); db.close(); }
});

test('does not cache archive viewer pages as article content', async () => {
  const db = new DatabaseSync(':memory:');
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'blocked', link: 'https://news.test/blocked', content: '', summary: '<p>Available preview.</p>'
    })));
    if (url.startsWith('https://archive.ph/newest/'))
      return response('<html><head><title>archive.today</title></head><body><div>archive.today webpage capture Saved from 7 Nov 2026 All snapshots from host www.news.test</div></body></html>', 'text/html');
    if (url.startsWith('https://web.archive.org/'))
      return new Response('Not archived', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0, extractor: async () => null, readerProxy: true
  });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'failed');
    const reader = service.read(article.id);
    assert.equal(reader.readerSource, 'feed');
    assert.match(reader.readerHTML, /Available preview/);
    assert.match(reader.readerError, /viewer page/i);
  } finally { await service.close(); db.close(); }
});

test('unwraps an archive viewer frame that contains the article', async () => {
  const db = new DatabaseSync(':memory:');
  const paragraphs = Array.from({ length: 10 }, (_, index) =>
    `<p>Archived frame paragraph ${index} contains original reporting and context.</p>`).join('');
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'blocked', link: 'https://news.test/blocked', content: '', summary: '<p>Available preview.</p>'
    })));
    if (url === 'https://archive.ph/newest/https://news.test/blocked')
      return response('<html><head><title>archive.today</title></head><body><div>archive.today webpage capture Saved from 7 Nov 2026 All snapshots from host www.news.test</div><iframe src="/frame/story"></iframe></body></html>', 'text/html');
    if (url === 'https://archive.ph/frame/story')
      return response(`<html><body><article>${paragraphs}</article></body></html>`, 'text/html');
    if (url.startsWith('https://web.archive.org/'))
      return new Response('Not archived', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0, extractor: async () => null, readerProxy: true
  });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'complete');
    assert.match(service.read(article.id).readerHTML, /Archived frame paragraph/);
  } finally { await service.close(); db.close(); }
});

test('does not cache non-HTML responses as article content', async () => {
  const db = new DatabaseSync(':memory:');
  const pdf = '%PDF-1.7\n' + '\u0001\u0002binary\u0003'.repeat(200);
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'pdf', link: 'https://news.test/paper.pdf', content: '', summary: '<p>Paper preview.</p>'
    })));
    if (url === 'https://news.test/paper.pdf')
      return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0, extractor: async () => null, readerProxy: false
  });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'failed');
    const reader = service.read(article.id);
    assert.equal(reader.readerSource, 'feed');
    assert.match(reader.readerHTML, /Paper preview/);
    assert.match(reader.readerError, /not an HTML article/i);
  } finally { await service.close(); db.close(); }
});

test('fetches a featured image from the article page when RSS content is already complete', async () => {
  const db = new DatabaseSync(':memory:');
  let pageRequests = 0, extractionRequests = 0;
  const fullContent = '<p>' + 'This complete RSS article contains useful reporting details. '.repeat(8) + '</p>';
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'featured', link: 'https://news.test/featured', content: fullContent, summary: 'Complete article.'
    })));
    if (url.endsWith('/featured')) {
      pageRequests++;
      return response('<html><head><meta property="og:image" content="/images/featured.jpg"></head><body><article><h1>Featured story</h1></article></body></html>', 'text/html');
    }
    throw new Error('Unexpected request: ' + url);
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0,
    extractor: async () => { extractionRequests++; throw new Error('Full feed content must not be re-extracted.'); }
  });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).image_checked_at);
    const stored = service.articleRecord(article.id);
    assert.equal(stored.image_url, 'https://news.test/images/featured.jpg');
    assert.equal(stored.extraction_status, 'not_required');
    assert.equal(pageRequests, 1);
    assert.equal(extractionRequests, 0);
    assert.match(service.read(article.id).readerHTML, /complete RSS article/);
  } finally { await service.close(); db.close(); }
});

test('finds conventional /rss feeds and subscribes to pages without feeds in reader mode', async () => {
  const db = new DatabaseSync(':memory:');
  let version = 1;
  const paragraphs = '<p>' + 'This article contains enough real text to be extracted cleanly. '.repeat(8) + '</p>';
  const sitePage = () => `<html><head><title>Field Journal</title></head><body><main><article><a href="/stories/first"><h2>First story with a longer headline</h2></a></article>${version > 1 ? '<article><a href="/stories/second"><h2>Second story with a longer headline</h2></a></article>' : ''}</main></body></html>`;
  const fetcher = async url => {
    if (url === 'https://hn.test/') return response('<html><body>Hacker News</body></html>', 'text/html');
    if (url === 'https://hn.test/rss') return response(xml(item({ id: 'hn-1', title: 'Hacker News item', link: 'https://hn.test/story' })));
    if (url === 'https://journal.test/') return response(sitePage(), 'text/html');
    if (url === 'https://journal.test/stories/first')
      return response(`<html><head><title>Reader title</title><meta property="og:image" content="/stories/first-cover.jpg"></head><body><article><h1>Reader title</h1>${paragraphs}</article></body></html>`, 'text/html');
    if (url.startsWith('https://journal.test/stories/'))
      return response(`<html><body><article><h1>Other article</h1>${paragraphs}</article></body></html>`, 'text/html');
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0, extractor: async () => null });
  try {
    const hackerNews = await service.add('https://hn.test/');
    assert.equal(hackerNews.source_kind, 'rss');
    assert.equal(hackerNews.url, 'https://hn.test/rss');

    const journal = await service.add('https://journal.test/');
    assert.equal(journal.source_kind, 'site');
    assert.equal(journal.title, 'Field Journal');
    const first = service.articles({ feedId: journal.id })[0];
    assert.equal(first.title, 'First story with a longer headline');
    await waitFor(() => service.articleRecord(first.id).extraction_status === 'complete');
    const reader = service.read(first.id);
    assert.equal(reader.readerSource, 'readability');
    assert.match(reader.readerHTML, /This article contains enough real text/);
    assert.equal(reader.image_url, 'https://journal.test/stories/first-cover.jpg');

    version = 2;
    await service.refreshAll();
    assert.equal(service.articles({ feedId: journal.id }).length, 2);
    const second = service.articles({ feedId: journal.id }).find(article => article.link.endsWith('/second'));
    await waitFor(() => service.articleRecord(second.id).extraction_status === 'complete');
  } finally { await service.close(); db.close(); }
});

test('uses Apple-style Atom images and opens brief feed summaries in full reader mode', async () => {
  const db = new DatabaseSync(':memory:');
  const paragraphs = '<p>' + 'Apple announced a new product and shared important details today. '.repeat(8) + '</p>';
  const feed = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Apple Newsroom</title><link href="https://apple.test/newsroom/"/><entry><id>story</id><title>Product announcement</title><link href="https://apple.test/newsroom/story"/><content>Apple announced a new product today.</content><link rel="enclosure" href="https://apple.test/newsroom/hero.jpg" type="image/jpeg"/></entry></feed>';
  const fetcher = async url => {
    if (url === 'https://apple.test/newsroom/')
      return response('<html><head><link rel="alternate" type="application/rss+xml" href="/newsroom/rss-feed.rss"></head></html>', 'text/html');
    if (url === 'https://apple.test/newsroom/rss-feed.rss') return response(feed, 'application/atom+xml');
    if (url === 'https://apple.test/newsroom/story')
      return response(`<html><head><title>Product announcement</title><meta property="og:image" content="/newsroom/hero.jpg"></head><body><article><h1>Product announcement</h1>${paragraphs}</article></body></html>`, 'text/html');
    return new Response('Not found', { status: 404 });
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0 });
  try {
    service.setAutomaticExtraction(false);
    const subscription = await service.add('https://apple.test/newsroom/');
    assert.equal(subscription.source_kind, 'rss');
    const article = service.articles({ feedId: subscription.id })[0];
    assert.equal(article.image_url, 'https://apple.test/newsroom/hero.jpg');
    db.prepare('UPDATE rss_articles SET has_full_content=1 WHERE id=?').run(article.id);
    const upgraded = new RSSService(db, { fetcher, minimumHostInterval: 0 });
    assert.equal(upgraded.articleRecord(article.id).has_full_content, 1);
    const reader = upgraded.read(article.id);
    assert.equal(reader.readerSource, 'feed');
    assert.match(reader.readerHTML, /Apple announced a new product today/);
    assert.equal(upgraded.articleRecord(article.id).extraction_status, 'not_required');
    await upgraded.close();
    await service.close();
  } finally { db.close(); }
});

test('extracts excerpt-only articles with Trafilatura, metadata, formatting, and a persistent cache', async () => {
  const db = new DatabaseSync(':memory:');
  const articleHTML = '<html><head><title>Original page</title></head><body><article><h1>Article title</h1>' +
    '<p>A short but complete first paragraph describing the important announcement.</p>' +
    '<p>A second paragraph adds details and context for readers.</p><blockquote>A useful quotation.</blockquote>' +
    '<figure><img src="/hero.jpg" alt="Product"><figcaption>Product caption</figcaption></figure>' +
    '<p><a href="/source">Supporting source</a></p></article></body></html>';
  const outputHTML = '<h2>Announcement</h2><p>A short but complete first paragraph describing the important announcement.</p>' +
    '<p>A second paragraph adds details and context for readers.</p><blockquote>A useful quotation.</blockquote>' +
    '<figure><img src="/hero.jpg" alt="Product"><figcaption>Product caption</figcaption></figure>' +
    '<p><a href="https://publish.test/source">Supporting source</a></p>';
  let pageRequests = 0, extractionRequests = 0;
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'excerpt', title: 'Feed headline', link: 'https://publish.test/story',
      content: '', summary: '<p>A brief RSS description.</p>'
    })));
    if (url.endsWith('/story')) { pageRequests++; return response(articleHTML, 'text/html'); }
    throw new Error('Unexpected request: ' + url);
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0,
    extractor: async () => {
      extractionRequests++;
      return {
        contentHTML: outputHTML, title: 'Extracted title', author: 'A. Writer',
        date: '2025-01-03T12:00:00Z', description: 'Metadata description', imageURL: '/hero.jpg'
      };
    }
  });
  try {
    const feed = await service.add('https://publish.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    assert.ok(['pending', 'running'].includes(article.extraction_status));
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'complete');
    const reader = service.read(article.id);
    assert.equal(reader.readerSource, 'trafilatura');
    assert.equal(reader.readerTitle, 'Extracted title');
    assert.equal(reader.readerByline, 'A. Writer');
    assert.equal(reader.readerPublishedAt, '2025-01-03T12:00:00.000Z');
    assert.equal(reader.readerDescription, 'Metadata description');
    assert.equal(reader.image_url, 'https://publish.test/hero.jpg');
    assert.match(reader.readerHTML, /<blockquote>/);
    assert.match(reader.readerHTML, /<figcaption>Product caption/);
    assert.match(reader.readerHTML, /Supporting source/);
    assert.equal(service.articleRecord(article.id).extraction_method, 'trafilatura');
    assert.equal(pageRequests, 1);
    assert.equal(extractionRequests, 1);
    service.read(article.id);
    assert.equal(pageRequests, 1);
    assert.equal(extractionRequests, 1);
    const previousExtraction = service.articleRecord(article.id).extraction_at;
    await new Promise(resolve => setTimeout(resolve, 5));
    service.retryExtraction(article.id, { refresh: true });
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'complete' &&
      service.articleRecord(article.id).extraction_at !== previousExtraction);
    assert.equal(pageRequests, 2);
    assert.equal(extractionRequests, 2);
  } finally { await service.close(); db.close(); }
});

test('limits concurrent article-page requests to two', async () => {
  const db = new DatabaseSync(':memory:');
  let active = 0, maximum = 0;
  const longText = 'This article paragraph contains enough useful detail to validate extraction completeness. ';
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) {
      const entries = Array.from({ length: 5 }, (_, index) => item({
        id: 'item-' + index, link: `https://news.test/story-${index}`, content: '', summary: 'Preview'
      })).join('');
      return response(xml(entries));
    }
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return response(`<html><body><article><p>${longText.repeat(5)}</p></article></body></html>`, 'text/html');
  };
  const service = new RSSService(db, {
    fetcher, minimumHostInterval: 0,
    extractor: async (_html, url) => ({
      contentHTML: `<p>${longText.repeat(5)}</p>`, title: 'Extracted ' + url
    })
  });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    await waitFor(() => service.articles({ feedId: feed.id }).every(article =>
      service.articleRecord(article.id).extraction_status === 'complete'));
    assert.equal(maximum, 2);
  } finally { await service.close(); db.close(); }
});

test('prioritizes an opened article ahead of queued background extractions', async () => {
  const db = new DatabaseSync(':memory:');
  const waiting = [];
  const fetcher = url => {
    if (url.endsWith('/feed.xml')) {
      const entries = Array.from({ length: 5 }, (_, index) => item({
        id: 'queued-' + index, link: `https://news.test/story-${index}`, content: '', summary: 'Preview'
      })).join('');
      return Promise.resolve(response(xml(entries)));
    }
    return new Promise(resolve => waiting.push(() => resolve(
      new Response('Blocked', { status: 403, headers: { 'content-type': 'text/html' } })
    )));
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0 });
  try {
    service.setAutomaticExtraction(false);
    await service.add('https://news.test/feed.xml');
    service.setAutomaticExtraction(true);
    await waitFor(() => waiting.length === 2);
    const target = service.extractionQueue.at(-1);
    assert.ok(target);
    service.read(target);
    assert.equal(service.extractionQueue[0], target);
  } finally {
    const closing = service.close();
    waiting.forEach(release => release());
    await closing;
    db.close();
  }
});

test('waits for in-flight RSS requests before closing the reader database', async () => {
  const db = new DatabaseSync(':memory:');
  let fetchCount = 0, releaseRequest;
  const feed = xml(item({ id: 'one', link: 'https://news.test/story' }));
  const fetcher = async () => {
    fetchCount++;
    if (fetchCount === 1) return response(feed);
    return new Promise(resolve => { releaseRequest = () => resolve(response(feed)); });
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0 });
  service.setAutomaticExtraction(false);
  try {
    await service.add('https://news.test/feed.xml');
    const refreshing = service.refreshAll();
    await waitFor(() => releaseRequest);
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    releaseRequest();
    await Promise.all([refreshing, closing]);
    assert.equal(closed, true);
    assert.deepEqual(await service.refreshAll(), []);
    await assert.rejects(service.add('https://news.test/feed.xml'), /reader is closing/);
  } finally {
    releaseRequest?.();
    await service.close();
    db.close();
  }
});

test('waits for an in-flight feed discovery before closing the reader database', async () => {
  const db = new DatabaseSync(':memory:');
  let releaseAdd;
  const service = new RSSService(db, {
    fetcher: () => new Promise(resolve => {
      releaseAdd = () => resolve(response(xml(item({ id: 'one', link: 'https://news.test/story' }))));
    }),
    minimumHostInterval: 0
  });
  try {
    const adding = service.add('https://news.test/feed.xml');
    await waitFor(() => releaseAdd);
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    releaseAdd();
    await Promise.all([adding, closing]);
    assert.equal(closed, true);
  } finally {
    releaseAdd?.();
    await service.close();
    db.close();
  }
});

test('keeps complete feed content local and extracts explicitly truncated content', async () => {
  const db = new DatabaseSync(':memory:');
  let articleRequests = 0;
  const full = '<h2>Complete feed article</h2>' + '<p>' + 'This complete feed paragraph contains details. '.repeat(8) + '</p>';
  const truncated = '<p>Part of a story. <a href="https://news.test/story">Read more</a></p>';
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(
      item({ id: 'full', link: 'https://news.test/full', content: full }) +
      item({ id: 'cut', link: 'https://news.test/story', content: truncated })
    ));
    if (url.endsWith('/full')) throw new Error('Complete feed content should not be fetched.');
    if (url.endsWith('/story')) {
      articleRequests++;
      return response('<html><body><article><p>' + 'The extracted continuation includes the entire story. '.repeat(8) + '</p></article></body></html>', 'text/html');
    }
    throw new Error('Unexpected request: ' + url);
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0, extractor: async () => null });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const articles = service.articles({ feedId: feed.id });
    const fullArticle = articles.find(value => value.link.endsWith('/full'));
    const cutArticle = articles.find(value => value.link.endsWith('/story'));
    assert.equal(service.articleRecord(fullArticle.id).extraction_status, 'not_required');
    assert.equal(service.articleRecord(cutArticle.id).has_full_content, 0);
    await waitFor(() => service.articleRecord(cutArticle.id).extraction_status === 'complete');
    assert.equal(articleRequests, 1);
    assert.match(service.read(fullArticle.id).readerHTML, /Complete feed article/);
  } finally { await service.close(); db.close(); }
});

test('supports the persisted extraction setting, retries failures, and avoids automatic retry loops', async () => {
  const db = new DatabaseSync(':memory:');
  let pageRequests = 0;
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'blocked', link: 'https://blocked.test/story', content: '', summary: 'Available excerpt.'
    })));
    pageRequests++;
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0 });
  try {
    assert.equal(service.automaticExtraction(), true);
    service.setAutomaticExtraction(false);
    const feed = await service.add('https://blocked.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pageRequests, 0);
    assert.equal(service.articleRecord(article.id).extraction_status, 'pending');
    service.setAutomaticExtraction(true);
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'failed');
    assert.match(service.articleRecord(article.id).extraction_error, /HTTP 403/);
    assert.equal(pageRequests, 1);
    await service.refreshAll();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pageRequests, 1);
    service.setAutomaticExtraction(false);
    const previousAttempt = service.articleRecord(article.id).extraction_at;
    service.retryExtraction(article.id);
    await waitFor(() => service.articleRecord(article.id).extraction_at !== previousAttempt &&
      service.articleRecord(article.id).extraction_status === 'failed');
    assert.equal(pageRequests, 2);
    const reopened = new RSSService(db, { fetcher, minimumHostInterval: 0 });
    assert.equal(reopened.automaticExtraction(), false);
    await reopened.close();
  } finally { await service.close(); db.close(); }
});

test('falls back for JavaScript-only pages and preserves paywall restrictions', async () => {
  const db = new DatabaseSync(':memory:');
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(
      item({ id: 'js', link: 'https://news.test/js', content: '', summary: 'Javascript preview.' }) +
      item({ id: 'paid', link: 'https://news.test/paid', content: '', summary: 'Subscriber preview.' })
    ));
    if (url.endsWith('/js')) return response('<html><body><div id="app"></div><script>document.write("client side")</script></body></html>', 'text/html');
    return response('<html><body><div class="paywall">Subscribers only. Subscribe to continue reading.</div></body></html>', 'text/html');
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0, extractor: async () => null });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const js = service.articles({ feedId: feed.id }).find(value => value.link.endsWith('/js'));
    const paid = service.articles({ feedId: feed.id }).find(value => value.link.endsWith('/paid'));
    await waitFor(() => ['failed', 'complete'].includes(service.articleRecord(js.id).extraction_status) &&
      service.articleRecord(paid.id).extraction_status === 'failed');
    assert.equal(service.articleRecord(js.id).extraction_status, 'failed');
    assert.equal(service.read(js.id).readerHTML.includes('Javascript preview'), true);
    assert.equal(service.read(paid.id).readerSource, 'paywall');
    assert.equal(service.read(paid.id).readerHTML.includes('Subscriber preview'), true);
    assert.equal(service.articleRecord(paid.id).extraction_method, 'restricted');
  } finally { await service.close(); db.close(); }
});

test('records HTTP 429 as a failed extraction without automatic retries', async () => {
  const db = new DatabaseSync(':memory:');
  let pageRequests = 0;
  const fetcher = async url => {
    if (url.endsWith('/feed.xml')) return response(xml(item({
      id: 'limited', link: 'https://news.test/limited', content: '', summary: 'Available excerpt.'
    })));
    pageRequests++;
    return new Response('Rate limited', { status: 429, headers: { 'content-type': 'text/html' } });
  };
  const service = new RSSService(db, { fetcher, minimumHostInterval: 0 });
  try {
    const feed = await service.add('https://news.test/feed.xml');
    const article = service.articles({ feedId: feed.id })[0];
    await waitFor(() => service.articleRecord(article.id).extraction_status === 'failed');
    assert.match(service.articleRecord(article.id).extraction_error, /HTTP 429/);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pageRequests, 1);
  } finally { await service.close(); db.close(); }
});

test('rejects unsafe URLs before requesting them', () => {
  assert.equal(validURL('https://news.test/feed#latest'), 'https://news.test/feed');
  assert.throws(() => validURL('file:///etc/passwd'), /HTTP or HTTPS/);
  assert.throws(() => validURL('not a URL'), /valid website/);
});
