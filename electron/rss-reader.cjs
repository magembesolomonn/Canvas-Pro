const crypto = require('node:crypto');
const { publicFetch } = require('./public-fetch.cjs');
const { parseFeed, discoverFeeds, parseSitePage } = require('./rss-engine.cjs');
const { run: runContentWorker } = require('./rss-content-worker.cjs');
const { extract: extractWithTrafilatura } = require('./rss-extractor.cjs');

const BODY_LIMIT = 8 * 1024 * 1024;
const ARTICLE_LIMIT = 300;
const READER_CACHE_LIMIT = 300;
const EXTRACTION_CONCURRENCY = 2;
const MIN_READER_TEXT = 400;
const GOOGLEBOT_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const ARCHIVE_MIRRORS = ['archive.ph', 'archive.is', 'archive.li', 'archive.md', 'archive.vn', 'archive.fo'];
const FEED_PATHS = ['/feed/all/', '/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml'];
const readerTextLength = html =>
  String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;
const looksLikeHTML = body => {
  const sample = String(body || '').slice(0, 4000);
  if (!sample.trim() || sample.includes('\u0000') || /^%PDF-/i.test(sample)) return false;
  return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<article[\s>]|<main[\s>]|<div[\s>]|<p[\s>]/i.test(sample);
};
function betterCandidate(candidate, current) {
  if (!candidate?.readable) return false;
  if (candidate.source !== 'direct' && candidate.textLength < MIN_READER_TEXT) return false;
  if (!current?.readable) return true;
  if (candidate.paywalled !== current.paywalled) return !candidate.paywalled;
  return candidate.textLength > current.textLength;
}
const articleId = (feedId, key) => crypto.createHash('sha256').update(feedId + '\0' + key).digest('hex');
function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function validURL(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a website or feed URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid website or feed URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Feeds must use a public HTTP or HTTPS URL.');
  url.hash = '';
  return url.href;
}
async function readLimited(response, limit = BODY_LIMIT) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) throw new Error('This feed is larger than the 8 MB limit.');
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('This response is larger than the 8 MB limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8').decode(bytes);
}

class RSSService {
  constructor(db, options = {}) {
    this.db = db;
    this.fetch = options.fetcher || publicFetch;
    this.readerProxyCapable = options.readerProxy ?? this.fetch === publicFetch;
    this.extractor = options.extractor || extractWithTrafilatura;
    this.onUpdate = options.onUpdate || (() => {});
    this.minimumHostInterval = options.minimumHostInterval ?? 1000;
    this.extractionQueue = [];
    this.queuedExtractions = new Set();
    this.activeExtractions = new Set();
    this.activeOperations = new Set();
    this.lastExtractionByHost = new Map();
    this.hostQueues = new Map();
    this.closed = false;
    db.exec(`
      CREATE TABLE IF NOT EXISTS rss_feeds (
        id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
        site_url TEXT NOT NULL DEFAULT '', source_kind TEXT NOT NULL DEFAULT 'rss', added_at TEXT NOT NULL,
        last_fetched TEXT, etag TEXT, last_modified TEXT, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS rss_articles (
        id TEXT PRIMARY KEY, feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
        guid TEXT NOT NULL, title TEXT NOT NULL, link TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
        content_html TEXT NOT NULL DEFAULT '', has_full_content INTEGER NOT NULL DEFAULT 0,
        reader_html TEXT NOT NULL DEFAULT '', reader_fetched TEXT, reader_title TEXT NOT NULL DEFAULT '',
        reader_byline TEXT NOT NULL DEFAULT '', reader_description TEXT NOT NULL DEFAULT '',
        reader_published_at TEXT, extraction_status TEXT NOT NULL DEFAULT 'pending',
        extraction_at TEXT, extraction_method TEXT NOT NULL DEFAULT '', extraction_error TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '', image_checked_at TEXT,
        published_at TEXT, first_seen TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
        is_starred INTEGER NOT NULL DEFAULT 0, UNIQUE(feed_id, guid)
      );
      CREATE TABLE IF NOT EXISTS rss_settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rss_articles_feed_date ON rss_articles(feed_id, published_at DESC);
      CREATE INDEX IF NOT EXISTS rss_articles_state_date ON rss_articles(is_read, is_starred, published_at DESC);
    `);
    const feedColumns = db.prepare('PRAGMA table_info(rss_feeds)').all();
    if (!feedColumns.some(column => column.name === 'source_kind'))
      db.exec("ALTER TABLE rss_feeds ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'rss'");
    const articleColumns = db.prepare('PRAGMA table_info(rss_articles)').all();
    for (const [name, definition] of [
      ['image_checked_at', 'TEXT'],
      ['reader_description', "TEXT NOT NULL DEFAULT ''"],
      ['reader_published_at', 'TEXT'],
      ['extraction_status', "TEXT NOT NULL DEFAULT 'pending'"],
      ['extraction_at', 'TEXT'],
      ['extraction_method', "TEXT NOT NULL DEFAULT ''"],
      ['extraction_error', "TEXT NOT NULL DEFAULT ''"]
    ]) {
      if (!articleColumns.some(column => column.name === name))
        db.exec(`ALTER TABLE rss_articles ADD COLUMN ${name} ${definition}`);
    }
    db.exec(`
      UPDATE rss_articles SET extraction_status=CASE
        WHEN reader_html<>'' THEN 'complete'
        WHEN has_full_content=1 THEN 'not_required'
        ELSE 'pending'
      END
      WHERE extraction_status='pending'
    `);
    db.exec("UPDATE rss_articles SET extraction_status='pending' WHERE extraction_status='running'");
    this.upsertArticle = db.prepare(`
      INSERT INTO rss_articles
        (id,feed_id,guid,title,link,author,summary,content_html,has_full_content,image_url,published_at,first_seen,extraction_status)
      VALUES (@id,@feed_id,@guid,@title,@link,@author,@summary,@content_html,@has_full_content,@image_url,@published_at,@first_seen,@extraction_status)
      ON CONFLICT(feed_id,guid) DO UPDATE SET
        title=excluded.title, link=excluded.link, author=excluded.author,
        summary=excluded.summary,
        content_html=CASE WHEN excluded.content_html<>'' THEN excluded.content_html ELSE rss_articles.content_html END,
        has_full_content=excluded.has_full_content,
        extraction_status=CASE
          WHEN rss_articles.reader_html<>'' THEN 'complete'
          WHEN excluded.extraction_status='not_required' THEN 'not_required'
          WHEN rss_articles.extraction_status='not_required' THEN 'pending'
          ELSE rss_articles.extraction_status
        END,
        extraction_error=CASE WHEN excluded.extraction_status='not_required' THEN '' ELSE rss_articles.extraction_error END,
        image_url=CASE WHEN excluded.image_url<>'' THEN excluded.image_url ELSE rss_articles.image_url END,
        published_at=COALESCE(excluded.published_at,rss_articles.published_at)
    `);
  }

  feed(id) {
    const row = this.db.prepare(`
      SELECT f.*, (SELECT COUNT(*) FROM rss_articles a WHERE a.feed_id=f.id AND a.is_read=0) unread_count
      FROM rss_feeds f WHERE f.id=?
    `).get(id);
    if (!row) throw new Error('That feed is no longer in this library.');
    return row;
  }

  feeds() {
    return this.db.prepare(`
      SELECT f.id,f.url,f.title,f.site_url,f.source_kind,f.added_at,f.last_fetched,f.last_error,
        (SELECT COUNT(*) FROM rss_articles a WHERE a.feed_id=f.id AND a.is_read=0) unread_count
      FROM rss_feeds f ORDER BY f.title COLLATE NOCASE
    `).all();
  }

  summary() {
    return this.db.prepare(`
      SELECT COUNT(*) total,
        SUM(is_read=0) unread,
        SUM(is_starred=1) starred,
        SUM(is_read=0 AND date(COALESCE(published_at,first_seen),'localtime')=date('now','localtime')) today
      FROM rss_articles
    `).get();
  }

  automaticExtraction() {
    const row = this.db.prepare("SELECT value FROM rss_settings WHERE key='automatic-extraction'").get();
    return row ? row.value === 'true' : true;
  }

  setAutomaticExtraction(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether to extract full articles automatically.');
    this.db.prepare(`
      INSERT INTO rss_settings(key,value) VALUES('automatic-extraction',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(String(enabled));
    if (enabled) this.queuePendingExtractions();
    else {
      this.extractionQueue.length = 0;
      this.queuedExtractions.clear();
    }
    return { enabled };
  }

  queuePendingExtractions() {
    if (!this.automaticExtraction() || this.closed) return;
    const rows = this.db.prepare(`
      SELECT id FROM rss_articles WHERE link<>'' AND (
        (has_full_content=0 AND reader_html='' AND extraction_status='pending') OR
        (image_url='' AND image_checked_at IS NULL AND link NOT LIKE 'https://news.google.com/rss/articles/%')
      )
      ORDER BY COALESCE(published_at,first_seen) DESC LIMIT 300
    `).all();
    for (const row of rows) this.enqueueExtraction(row.id);
  }

  enqueueExtraction(id, { force = false, prioritize = false } = {}) {
    if (this.closed || (!force && !this.automaticExtraction())) return;
    if (this.queuedExtractions.has(id)) {
      if (prioritize) {
        const index = this.extractionQueue.indexOf(id);
        if (index > 0) this.extractionQueue.unshift(...this.extractionQueue.splice(index, 1));
      }
      return;
    }
    const article = this.db.prepare(`
      SELECT extraction_status,has_full_content,reader_html,link,image_url,image_checked_at
      FROM rss_articles WHERE id=?
    `).get(id);
    if (!article || !article.link || (article.reader_html && !force && (article.image_url || article.image_checked_at))) return;
    const textExtraction = !article.has_full_content && (force || !article.reader_html) &&
      (force || article.extraction_status === 'pending');
    const imageOnly = !textExtraction && !article.image_url && !article.image_checked_at;
    if (!textExtraction && !imageOnly && !force) return;
    if (force && textExtraction) {
      this.db.prepare(`
        UPDATE rss_articles SET extraction_status='pending',extraction_error='',
          extraction_at=NULL,extraction_method='',reader_html='',reader_fetched=NULL,
          reader_title='',reader_byline='',reader_description='',reader_published_at=NULL,
          image_checked_at=NULL
        WHERE id=?
      `).run(id);
    } else if (force) {
      this.db.prepare('UPDATE rss_articles SET image_checked_at=NULL WHERE id=?').run(id);
    }
    this.queuedExtractions.add(id);
    if (prioritize) this.extractionQueue.unshift(id);
    else this.extractionQueue.push(id);
    this.pumpExtractions();
  }

  pumpExtractions() {
    while (!this.closed && this.activeExtractions.size < EXTRACTION_CONCURRENCY && this.extractionQueue.length) {
      const id = this.extractionQueue.shift();
      const task = Promise.resolve().then(() => this.extractArticle(id)).catch(error => {
        console.error('RSS article extraction:', error.message);
      }).finally(() => {
        this.activeExtractions.delete(task);
        this.queuedExtractions.delete(id);
        this.pumpExtractions();
      });
      this.activeExtractions.add(task);
    }
  }

  async waitForHost(url) {
    const host = new URL(url).hostname;
    const previous = this.lastExtractionByHost.get(host) || 0;
    const wait = this.minimumHostInterval - (Date.now() - previous);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastExtractionByHost.set(host, Date.now());
  }

  async extractArticle(id) {
    const article = this.db.prepare('SELECT * FROM rss_articles WHERE id=?').get(id);
    if (!article || !article.link) return;
    const imageOnly = Boolean(article.has_full_content || article.reader_html || article.extraction_status !== 'pending');
    if (!imageOnly) {
      this.db.prepare(`
        UPDATE rss_articles SET extraction_status='running',extraction_error=''
        WHERE id=? AND extraction_status='pending'
      `).run(id);
      if (this.db.prepare('SELECT extraction_status FROM rss_articles WHERE id=?').get(id)?.extraction_status !== 'running') return;
    }
    this.onUpdate();
    let imageCheckedAt = null;
    try {
      const url = validURL(article.link);
      await this.waitForHost(url);
      const errors = [];
      let direct = null, directBody = null;
      try {
        const result = await this.response(url, {});
        const baseURL = result.response.url || url;
        directBody = { body: result.body, baseURL };
        if (!imageOnly) direct = await this.collectCandidate(result.body, baseURL, 'direct');
      } catch (error) {
        errors.push('Direct: ' + String(error.message || error).split('\n')[0].slice(0, 200));
      }
      let best = direct;
      const needsFallback = !imageOnly && (!best || !best.readable || best.paywalled ||
        best.textLength < MIN_READER_TEXT);
      if (needsFallback && this.remoteFallbacksEnabled()) {
        for (const strategy of this.retrievalStrategies(url)) {
          if (best?.readable && !best.paywalled && best.textLength >= 1200) break;
          try {
            const fetched = await strategy.run();
            const candidate = await this.collectCandidate(fetched.body, fetched.baseURL, fetched.source);
            if (betterCandidate(candidate, best)) best = candidate;
          } catch (error) {
            errors.push(strategy.name + ': ' +
              String(error.message || error).split('\n')[0].slice(0, 200));
          }
        }
      }
      const source = best || direct || directBody;
      const pageImageURL = article.image_url || (source
        ? await runContentWorker('image', { html: source.body, url: source.baseURL })
        : '');
      imageCheckedAt = new Date().toISOString();
      this.db.prepare(`
        UPDATE rss_articles SET image_url=CASE WHEN ?<>'' THEN ? ELSE image_url END,image_checked_at=?
        WHERE id=?
      `).run(pageImageURL, pageImageURL, imageCheckedAt, id);
      if (imageOnly) { this.onUpdate(); return; }
      const readable = best?.readable &&
        (best.source === 'direct' || best.textLength >= MIN_READER_TEXT) ? best.readable : null;
      if (!readable) {
        const details = [...(best?.errors || []), ...errors].filter(Boolean).join(' ');
        throw new Error((best?.paywalled
          ? 'The publisher restricts this article and the page did not include readable text.'
          : 'The page did not contain extractable article content.') + (details ? ' ' + details : ''));
      }
      let method = best.method;
      if (best.paywalled || readable.paywalled) method = 'restricted';
      const extractedAt = new Date().toISOString();
      const title = readable.title || '';
      this.db.prepare(`
        UPDATE rss_articles SET reader_html=?,reader_fetched=?,reader_title=?,reader_byline=?,
          reader_description=?,reader_published_at=?,image_url=CASE WHEN ?<>'' THEN ? ELSE image_url END,
          image_checked_at=?,extraction_status='complete',extraction_at=?,extraction_method=?,
          extraction_error=''
        WHERE id=?
      `).run(readable.contentHTML.slice(0, 500000), extractedAt, title, readable.byline || '',
        readable.excerpt || '', readable.publishedAt || null,
        readable.imageURL || '', readable.imageURL || '', extractedAt, extractedAt, method, id);
      this.db.prepare(`
        UPDATE rss_articles SET reader_html='',reader_fetched=NULL,
        extraction_status=CASE WHEN extraction_status='complete' THEN 'pending' ELSE extraction_status END
        WHERE feed_id=? AND reader_html<>'' AND id NOT IN (
          SELECT id FROM rss_articles WHERE feed_id=? AND reader_html<>''
          ORDER BY reader_fetched DESC LIMIT ?
        )
      `).run(article.feed_id, article.feed_id, READER_CACHE_LIMIT);
    } catch (error) {
      const message = String(error.message || error).slice(0, 500);
      const failedAt = new Date().toISOString();
      this.db.prepare(`
        UPDATE rss_articles SET extraction_status=CASE WHEN ?=1 THEN extraction_status ELSE 'failed' END,
          extraction_at=?,
          extraction_method=?,extraction_error=? WHERE id=?
      `).run(Number(imageOnly), failedAt, /publisher restricts this article/i.test(message) ? 'restricted' : '',
        message, id);
      if (!imageCheckedAt) {
        this.db.prepare('UPDATE rss_articles SET image_checked_at=COALESCE(image_checked_at,?) WHERE id=?')
          .run(failedAt, id);
      }
    }
    this.onUpdate();
  }

  readerProxySetting() {
    const row = this.db.prepare("SELECT value FROM rss_settings WHERE key='reader-proxy'").get();
    return row ? row.value === 'true' : true;
  }

  setReaderProxy(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether to use the reader service.');
    this.db.prepare(`
      INSERT INTO rss_settings(key,value) VALUES('reader-proxy',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(String(enabled));
    return { enabled };
  }

  remoteFallbacksEnabled() {
    return this.readerProxyCapable && this.readerProxySetting() &&
      process.env.CANVAS_DISABLE_READER_PROXY !== '1';
  }

  async throttledFetch(host, url, options = {}, gap = 3000) {
    const previous = this.hostQueues.get(host) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    this.hostQueues.set(host, previous.then(() => current, () => current));
    await previous.catch(() => {});
    try {
      return await this.fetch(url, options);
    } finally {
      const timer = setTimeout(release, this.minimumHostInterval ? gap : 0);
      timer.unref?.();
    }
  }

  retrievalStrategies(url) {
    return [
      { name: 'Googlebot', run: () => this.googlebotFetch(url) },
      { name: 'Wayback Machine', run: () => this.waybackFetch(url) },
      { name: 'Jina Reader', run: () => this.readerProxy(url) },
      { name: 'archive.today', run: () => this.archiveFetch(url) }
    ];
  }

  async googlebotFetch(url) {
    const response = await this.fetch(url, {
      headers: { 'User-Agent': GOOGLEBOT_AGENT }, timeout: 15000
    });
    if (!response.ok) throw new Error('Googlebot returned HTTP ' + response.status + '.');
    return { body: await readLimited(response), baseURL: response.url || url, source: 'googlebot' };
  }

  async waybackFetch(url) {
    const target = 'https://web.archive.org/web/2id_/' + encodeURIComponent(url);
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await this.throttledFetch('web.archive.org', target, { timeout: 25000 }, 4000);
      if (response.status !== 429 && response.status !== 503) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.body?.cancel().catch(() => {});
      if (attempt < 2) await new Promise(resolve => setTimeout(
        resolve, Math.min(15000, (retryAfter || 5) * 1000)));
    }
    if (!response.ok) throw new Error('Wayback returned HTTP ' + response.status + '.');
    const body = await readLimited(response);
    if (!/<html/i.test(body) || /Wayback Machine has not archived that URL/i.test(body))
      throw new Error('No Wayback snapshot is available.');
    return { body, baseURL: url, source: 'wayback' };
  }

  async archiveFetch(url) {
    const failures = [];
    const viewer = /webpage capture|All snapshots from host|archive\.today webpage capture/i;
    for (const host of ARCHIVE_MIRRORS) {
      try {
        const response = await this.throttledFetch(
          host, 'https://' + host + '/newest/' + url, { timeout: 8000 }, 1500);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        let body = await readLimited(response);
        if (!/<html/i.test(body) || !/archive\.(?:ph|is|li|md|vn|fo)|archive\.today/i.test(body))
          throw new Error('No snapshot is available.');
        if (viewer.test(body)) {
          const frame = body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
          if (!frame) throw new Error('The archive returned its viewer page instead of the article.');
          const base = response.url || 'https://' + host + '/newest/' + url;
          const frameResponse = await this.throttledFetch(
            host, new URL(frame[1], base).href, { timeout: 10000 }, 1500);
          if (!frameResponse.ok)
            throw new Error('The archive viewer frame returned HTTP ' + frameResponse.status + '.');
          body = await readLimited(frameResponse);
          if (viewer.test(body))
            throw new Error('The archive returned its viewer page instead of the article.');
        }
        return { body, baseURL: url, source: 'archive.today' };
      } catch (error) {
        failures.push(host + ': ' + String(error.message || error).split('\n')[0].slice(0, 80));
      }
    }
    throw new Error(failures.join(' '));
  }

  async readerProxy(url) {
    if (!this.remoteFallbacksEnabled()) throw new Error('Reader proxy is disabled.');
    const response = await this.throttledFetch('r.jina.ai', 'https://r.jina.ai/' + url, {
      headers: { 'X-Return-Format': 'html' },
      timeout: 30000
    }, 3500);
    if (!response.ok) throw new Error('Reader proxy returned HTTP ' + response.status + '.');
    return { body: await readLimited(response), baseURL: url, source: 'jina' };
  }

  async collectCandidate(body, baseURL, source) {
    if (!looksLikeHTML(body)) {
      return {
        body, baseURL, source, paywalled: false, readable: null, method: '',
        errors: ['The response was not an HTML article.'], textLength: 0
      };
    }
    const paywalled = await runContentWorker('paywall', { html: body });
    const extracted = await this.extractReadable(body, baseURL);
    return {
      body, baseURL, source, paywalled,
      readable: extracted.readable, method: extracted.method, errors: extracted.errors,
      textLength: readerTextLength(extracted.readable?.contentHTML)
    };
  }

  async extractReadable(body, url) {
    const errors = [];
    try {
      const primary = await this.extractor(body, url);
      const normalized = await runContentWorker('normalize', { result: primary, html: body, url });
      if (normalized?.contentHTML) return { readable: normalized, method: 'trafilatura', errors };
    } catch (error) {
      errors.push('Trafilatura: ' + String(error.message || error).split('\n')[0].slice(0, 200));
    }
    try {
      const readable = await runContentWorker('readability', { html: body, url });
      if (readable?.contentHTML) return { readable, method: 'readability', errors };
    } catch (error) {
      errors.push('Readability: ' + String(error.message || error).split('\n')[0].slice(0, 200));
    }
    return { readable: null, method: '', errors };
  }

  retryExtraction(id, { refresh = false } = {}) {
    if (typeof refresh !== 'boolean') throw new Error('Invalid article refresh request.');
    const article = this.articleRecord(id);
    if (refresh && article.extraction_status !== 'complete')
      throw new Error('This article has no successful extraction to refresh.');
    if (!refresh && article.extraction_status === 'complete')
      throw new Error('This article is already extracted. Refresh it to retrieve it again.');
    if (refresh) this.db.prepare('UPDATE rss_articles SET extraction_status=? WHERE id=?').run('pending', id);
    else if (article.extraction_status !== 'failed' && article.extraction_status !== 'pending')
      throw new Error('This article is not ready to retry.');
    this.enqueueExtraction(id, { force: true });
    return this.articleRecord(id);
  }

  articles({ filter = 'all', feedId = null, unreadOnly = false } = {}) {
    if (!['all', 'starred', 'today'].includes(filter)) throw new Error('Unknown RSS view.');
    const where = [];
    const params = [];
    if (filter === 'starred') where.push('a.is_starred=1');
    if (filter === 'today') where.push("date(COALESCE(a.published_at,a.first_seen),'localtime')=date('now','localtime')");
    if (feedId) { where.push('a.feed_id=?'); params.push(feedId); }
    if (unreadOnly) where.push('a.is_read=0');
    return this.db.prepare(`
      SELECT a.id,a.feed_id,a.title,a.link,a.author,a.summary,a.image_url,a.published_at,
        a.first_seen,a.is_read,a.is_starred,a.extraction_status,f.title feed_title,f.site_url,f.source_kind
      FROM rss_articles a JOIN rss_feeds f ON f.id=a.feed_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(a.published_at,a.first_seen) DESC LIMIT 300
    `).all(...params);
  }

  async response(url, headers) {
    const response = await this.fetch(url, { headers });
    if (response.status === 304) return { response, body: '' };
    if (!response.ok) throw new Error('The publisher returned HTTP ' + response.status + '.');
    return { response, body: await readLimited(response) };
  }

  async findFeed(origin, discovered = []) {
    const candidates = [...discovered];
    for (const path of FEED_PATHS) {
      const url = new URL(path, origin).href;
      if (!candidates.some(candidate => candidate.url === url)) candidates.push({ url, title: '' });
    }
    const errors = [];
    for (const candidate of candidates.slice(0, 12)) {
      try {
        const result = await this.response(validURL(candidate.url));
        const parsed = parseFeed(result.body, result.response.url || candidate.url);
        if (parsed.valid)
          return { feed: { url: result.response.url || candidate.url, parsed, response: result.response }, errors };
      } catch (error) { errors.push(error); }
    }
    return { feed: null, errors };
  }

  async googleNewsFallback(source, cause) {
    try {
      const googleURL = new URL('https://news.google.com/rss/search');
      googleURL.searchParams.set('q', `site:${source.hostname.replace(/^www\./, '')}`);
      googleURL.searchParams.set('hl', 'en');
      const result = await this.response(googleURL.href);
      const parsed = parseFeed(result.body, result.response.url || googleURL.href);
      if (!parsed.valid || !parsed.items.length)
        throw new Error('Google News returned no articles for this publisher.');
      const sourceItem = parsed.items.find(item => item.sourceURL);
      parsed.title = sourceItem?.sourceName || source.hostname.replace(/^www\./, '');
      parsed.siteURL = sourceItem?.sourceURL || source.origin + '/';
      return { url: result.response.url || googleURL.href, parsed, response: result.response };
    } catch (error) {
      throw new Error(cause.message + ' Google News fallback failed: ' + String(error.message || error));
    }
  }

  async resolveFeed(inputURL) {
    const sourceURL = validURL(inputURL);
    let initial;
    try {
      initial = await this.response(sourceURL);
    } catch (error) {
      const source = new URL(sourceURL);
      if (source.pathname === '/' && source.hostname !== 'news.google.com') {
        const { feed } = await this.findFeed(source.origin);
        if (feed) return feed;
        if (error.message.includes('HTTP 403')) return this.googleNewsFallback(source, error);
      }
      throw error;
    }
    const parsed = parseFeed(initial.body, initial.response.url || sourceURL);
    if (parsed.valid) return { url: initial.response.url || sourceURL, parsed, response: initial.response };

    const base = new URL(initial.response.url || sourceURL);
    const { feed, errors } = await this.findFeed(
      base.origin, discoverFeeds(initial.body, initial.response.url || sourceURL));
    if (feed) return feed;
    if (/text\/html/i.test(initial.response.headers.get('content-type') || '') || /<!doctype html|<html\b/i.test(initial.body))
      return { kind: 'site', url: initial.response.url || sourceURL, parsed: parseSitePage(initial.body, initial.response.url || sourceURL), response: initial.response };
    if (errors.length) throw errors[errors.length - 1];
    throw new Error('No RSS or Atom feed was found at that address.');
  }

  addParsed(url, parsed, response, sourceKind = 'rss') {
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const insertFeed = this.db.prepare(`
      INSERT INTO rss_feeds(id,url,title,site_url,source_kind,added_at,last_fetched,etag,last_modified,last_error)
      VALUES(?,?,?,?,?,?,?,?,?,NULL)
    `);
    const ingest = items => transaction(this.db, () => {
      insertFeed.run(id, url, parsed.title || new URL(url).hostname, parsed.siteURL || '', sourceKind, now,
        now, response.headers.get('etag'), response.headers.get('last-modified'));
      this.ingest(id, items);
    });
    ingest(parsed.items);
    this.queuePendingExtractions();
    this.onUpdate();
    return this.feed(id);
  }

  async add(url) {
    if (this.closed) throw new Error('The RSS reader is closing.');
    const operation = this.resolveAndAdd(url);
    this.activeOperations.add(operation);
    try { return await operation; }
    finally { this.activeOperations.delete(operation); }
  }

  async resolveAndAdd(url) {
    const result = await this.resolveFeed(url);
    const exists = this.db.prepare('SELECT id FROM rss_feeds WHERE url=?').get(result.url);
    if (exists) throw new Error('You are already subscribed to this feed.');
    if (!result.parsed.items.length)
      throw new Error('No recent articles could be found at that website.');
    return this.addParsed(result.url, result.parsed, result.response, result.kind || 'rss');
  }

  ingest(feedId, items) {
    const now = new Date().toISOString();
    for (const item of items.slice(0, 1000)) {
      const guid = String(item.guid || item.link || item.title).slice(0, 2000);
      if (!guid) continue;
      this.upsertArticle.run({
        id: articleId(feedId, guid), feed_id: feedId, guid, title: item.title.slice(0, 500),
        link: item.link, author: item.author.slice(0, 300), summary: item.summary.slice(0, 1200),
        content_html: item.contentHTML.slice(0, 100000), has_full_content: item.hasFullContent ? 1 : 0,
        image_url: item.imageURL, published_at: item.publishedAt, first_seen: now,
        extraction_status: item.hasFullContent || !item.link ? 'not_required' : 'pending'
      });
    }
    this.db.prepare(`
      DELETE FROM rss_articles WHERE feed_id=? AND id NOT IN (
        SELECT id FROM rss_articles WHERE feed_id=?
        ORDER BY COALESCE(published_at,first_seen) DESC LIMIT ?
      )
    `).run(feedId, feedId, ARTICLE_LIMIT);
  }

  async refreshFeed(id) {
    const feed = this.feed(id), headers = {};
    if (feed.source_kind !== 'site') {
      if (feed.etag) headers['If-None-Match'] = feed.etag;
      if (feed.last_modified) headers['If-Modified-Since'] = feed.last_modified;
    }
    try {
      const result = await this.response(feed.url, headers);
      const now = new Date().toISOString();
      if (feed.source_kind === 'site') {
        const parsed = parseSitePage(result.body, result.response.url || feed.url);
        if (!parsed.items.length) throw new Error('No recent article links were found on this website.');
        transaction(this.db, () => {
          this.ingest(id, parsed.items);
          this.db.prepare(`UPDATE rss_feeds SET title=?,site_url=?,last_fetched=?,last_error=NULL WHERE id=?`)
            .run(parsed.title || feed.title, parsed.siteURL || feed.site_url, now, id);
        });
        this.queuePendingExtractions();
        return { id, ok: true };
      }
      if (result.response.status !== 304) {
        const parsed = parseFeed(result.body, result.response.url || feed.url);
        if (!parsed.valid) throw new Error('The subscribed address no longer returns an RSS or Atom feed.');
        transaction(this.db, () => {
          this.ingest(id, parsed.items);
          this.db.prepare(`UPDATE rss_feeds SET title=?,site_url=?,last_fetched=?,etag=?,last_modified=?,last_error=NULL WHERE id=?`)
            .run(parsed.title || feed.title, parsed.siteURL || feed.site_url, now,
              result.response.headers.get('etag') || null, result.response.headers.get('last-modified') || null, id);
        });
      } else {
        this.db.prepare('UPDATE rss_feeds SET last_fetched=?,last_error=NULL WHERE id=?').run(now, id);
      }
      this.queuePendingExtractions();
      return { id, ok: true };
    } catch (error) {
      this.db.prepare('UPDATE rss_feeds SET last_error=? WHERE id=?').run(String(error.message || error).slice(0, 500), id);
      return { id, ok: false, error: String(error.message || error) };
    }
  }

  async refreshAll() {
    if (this.closed) return [];
    const feeds = this.feeds(), results = new Array(feeds.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < feeds.length) {
        const index = cursor++;
        results[index] = await this.refreshFeed(feeds[index].id);
      }
    };
    const refresh = Promise.all(Array.from({ length: Math.min(4, feeds.length) }, worker))
      .then(() => {
        if (feeds.length) this.onUpdate();
        return results;
      });
    this.activeOperations.add(refresh);
    try { return await refresh; }
    finally { this.activeOperations.delete(refresh); }
  }

  start() {
    if (this.timer) return;
    this.queuePendingExtractions();
    this.timer = setInterval(() => {
      this.refreshAll().catch(error => console.error('RSS refresh:', error.message));
    }, 30 * 60 * 1000);
    this.timer.unref();
    this.refreshAll().catch(error => console.error('RSS refresh:', error.message));
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = null;
    this.extractionQueue.length = 0;
    await Promise.allSettled([...this.activeExtractions, ...this.activeOperations]);
  }

  remove(id) {
    const result = transaction(this.db, () => {
      this.db.prepare('DELETE FROM rss_articles WHERE feed_id=?').run(id);
      return this.db.prepare('DELETE FROM rss_feeds WHERE id=?').run(id);
    });
    if (!result.changes) throw new Error('That feed is no longer in this library.');
    this.onUpdate();
  }

  setState(id, state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid article state.');
    const fields = [];
    const values = [];
    if ('read' in state) { if (typeof state.read !== 'boolean') throw new Error('Invalid read state.'); fields.push('is_read=?'); values.push(Number(state.read)); }
    if ('starred' in state) { if (typeof state.starred !== 'boolean') throw new Error('Invalid starred state.'); fields.push('is_starred=?'); values.push(Number(state.starred)); }
    if (!fields.length) throw new Error('Choose a read or starred state.');
    values.push(id);
    const result = this.db.prepare(`UPDATE rss_articles SET ${fields.join(',')} WHERE id=?`).run(...values);
    if (!result.changes) throw new Error('That article is no longer in this library.');
    this.onUpdate();
    return this.articleRecord(id);
  }

  articleRecord(id) {
    const article = this.db.prepare(`
      SELECT a.*,f.title feed_title,f.site_url FROM rss_articles a
      JOIN rss_feeds f ON f.id=a.feed_id WHERE a.id=?
    `).get(id);
    if (!article) throw new Error('That article is no longer in this library.');
    return article;
  }

  read(id) {
    const article = this.articleRecord(id);
    if ((!article.has_full_content && !article.reader_html && article.extraction_status === 'pending') ||
        (!article.image_url && !article.image_checked_at))
      this.enqueueExtraction(id, { prioritize: true });
    return {
      ...article,
      readerHTML: article.reader_html || article.content_html,
      readerTitle: article.reader_title || article.title,
      readerByline: article.reader_byline || article.author,
      readerDescription: article.reader_description,
      readerPublishedAt: article.reader_published_at,
      readerSource: article.extraction_method === 'restricted' ? 'paywall' :
        article.extraction_status === 'complete' ? article.extraction_method : 'feed',
      readerStatus: article.extraction_status,
      readerError: article.extraction_error,
      automaticExtraction: this.automaticExtraction()
    };
  }
}

module.exports = { RSSService, validURL };
