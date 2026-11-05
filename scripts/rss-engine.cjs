const { parseHTML, DOMParser } = require('linkedom');
const { Readability } = require('@mozilla/readability');

const localName = node => (node?.localName || node?.tagName || '').toLowerCase().split(':').pop();
const child = (node, name) => [...(node?.children || [])].find(item => localName(item) === name);
const children = (node, name) => [...(node?.children || [])].filter(item => localName(item) === name);
const text = (node, limit = 100000) => String(typeof node === 'string' ? node : node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, limit);
function resolveURL(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim(), base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function htmlText(value) {
  if (!value) return '';
  try { return text(parseHTML('<html><body>' + value + '</body></html>').document.body); }
  catch { return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
}
function imageSource(node) {
  const set = node?.getAttribute('srcset') || node?.getAttribute('data-srcset') || '';
  return node?.getAttribute('src') || node?.getAttribute('data-src') ||
    node?.getAttribute('data-lazy-src') || node?.getAttribute('data-original') ||
    set.split(',')[0].trim().split(/\s+/)[0] || '';
}
function imageFrom(html, base) {
  if (!html) return '';
  try {
    const document = parseHTML('<html><body>' + html + '</body></html>').document;
    for (const image of document.querySelectorAll('img[src],img[data-src],img[data-lazy-src],img[data-original],img[srcset],img[data-srcset]')) {
      const source = imageSource(image);
      const dimensions = ['width', 'height'].map(name => Number(image.getAttribute(name) || 0));
      const label = [image.getAttribute('alt'), image.getAttribute('class'), image.getAttribute('id')].join(' ');
      if (!source || /logo|avatar|emoji|icon|pixel|spacer|tracking/i.test(label) ||
          dimensions.every(value => value > 0 && value < 100)) continue;
      const url = resolveURL(source, base);
      if (url) return url;
    }
    return '';
  } catch { return ''; }
}
function articleImage(source, url) {
  try {
    const document = parseHTML(source).document;
    const metadataImage = document.querySelector(
      'meta[property="og:image:secure_url"],meta[property="og:image"],meta[name="twitter:image"],meta[name="twitter:image:src"],meta[itemprop="image"]'
    )?.getAttribute('content') || document.querySelector('link[rel="image_src"]')?.getAttribute('href');
    const article = document.querySelector('[itemprop="articleBody"],article,[role="article"]') ||
      document.querySelector('main') || document.body;
    return resolveURL(metadataImage, url) || imageFrom(article?.innerHTML || '', url);
  } catch { return ''; }
}
function siteTitle(value, fallback) {
  const title = text(value, 300) || fallback;
  const concise = title.match(/^([^:|]{2,45})\s*[:|]\s+\S/);
  return concise ? concise[1].trim() : title;
}
function cleanContent(html) {
  if (!html) return '';
  try {
    const document = parseHTML('<html><body>' + html + '</body></html>').document;
    for (const node of document.querySelectorAll('script,style,form,iframe,button,nav,aside,footer,noscript,[hidden],[aria-hidden="true"]')) node.remove();
    const advertising = /(?:^|[\s_-])(?:ad|ads|advert|advertisement|adslot|adunit|sponsored-content|promoted-content)(?:$|[\s_-])/i;
    for (const node of document.querySelectorAll('[class],[id],[aria-label],[data-ad-slot],[data-ad-unit]')) {
      const label = ['class', 'id', 'aria-label'].map(key => node.getAttribute(key) || '').join(' ');
      if (advertising.test(label) || node.matches('[data-ad-slot],[data-ad-unit]')) node.remove();
    }
    return document.body.innerHTML;
  } catch { return ''; }
}
function articleQuality(html, source) {
  if (!html) return false;
  const content = parseHTML('<html><body>' + html + '</body></html>').document.body;
  const articleText = text(content, 100000);
  const paragraphs = content.querySelectorAll('p').length;
  if (articleText.length >= 250 || (articleText.length >= 120 && paragraphs >= 2)) return true;
  const sourceDocument = parseHTML(source).document;
  const articleMetadata = /article/i.test(sourceDocument.querySelector('meta[property="og:type"]')?.getAttribute('content') || '') ||
    sourceDocument.querySelector('meta[property="article:published_time"],meta[name="author"],meta[itemprop="datePublished"]');
  const semantic = sourceDocument.querySelector('[itemprop="articleBody"],article,[role="article"]') ||
    (articleMetadata ? sourceDocument.querySelector('main') : null);
  if (!semantic || articleText.length < 20 || !content.querySelector('p')) return false;
  const sourceText = text(semantic, 100000);
  return sourceText.length >= 20 && articleText.length / sourceText.length >= 0.6;
}
function normalizeExtractedArticle(result, source, url) {
  const contentHTML = cleanContent(result?.contentHTML || '');
  if (!articleQuality(contentHTML, source)) return null;
  let publishedAt = null;
  if (result.date) {
    const time = Date.parse(result.date);
    if (Number.isFinite(time)) publishedAt = new Date(time).toISOString();
  }
  return {
    title: text(result.title, 500),
    byline: text(result.author, 300),
    excerpt: text(result.description, 1200),
    publishedAt,
    imageURL: resolveURL(result.imageURL, url) || articleImage(source, url) || imageFrom(contentHTML, url),
    contentHTML: contentHTML.slice(0, 1000000)
  };
}
function parseFeed(source, baseURL) {
  const document = new DOMParser().parseFromString(source, 'text/xml');
  const root = document.documentElement;
  const rootName = localName(root);
  if (!['rss', 'rdf', 'feed'].includes(rootName)) return { valid: false, items: [] };
  const channel = child(root, 'channel') || root;
  const atomLink = node => {
    const links = [...(node?.querySelectorAll('link') || [])];
    return links.find(link => !link.getAttribute('rel') || link.getAttribute('rel') === 'alternate') || links[0];
  };
  const feedLink = atomLink(channel);
  const feed = {
    valid: true,
    title: text(child(channel, 'title'), 300) || new URL(baseURL).hostname,
    siteURL: resolveURL(feedLink?.getAttribute('href') || text(feedLink), baseURL),
    items: []
  };
  const entries = rootName === 'feed'
    ? children(root, 'entry')
    : [...channel.querySelectorAll('item')];
  for (const entry of entries.slice(0, 1000)) {
    const atom = localName(entry) === 'entry';
    const linkNode = atom ? atomLink(entry) : child(entry, 'link');
    const link = resolveURL(linkNode?.getAttribute('href') || text(linkNode), baseURL);
    const source = child(entry, 'source');
    const guid = text(child(entry, atom ? 'id' : 'guid'), 2000) || link;
    const full = child(entry, 'encoded') || (atom ? child(entry, 'content') : null);
    const excerpt = child(entry, 'description') || child(entry, 'summary');
    const fullHTML = full?.textContent || '';
    const summaryHTML = excerpt?.textContent || '';
    const mediaElements = [...entry.querySelectorAll('*')];
    const enclosure = mediaElements.find(node => ['enclosure', 'content'].includes(localName(node)) &&
      (node.getAttribute('type') || '').startsWith('image/')) ||
      mediaElements.find(node => localName(node) === 'link' &&
        (node.getAttribute('rel') || '').split(/\s+/).includes('enclosure') &&
        (node.getAttribute('type') || '').startsWith('image/'));
    const media = mediaElements.find(node => localName(node) === 'thumbnail');
    const imageURL = resolveURL(enclosure?.getAttribute('url') || enclosure?.getAttribute('href') || media?.getAttribute('url'), baseURL) ||
      imageFrom(fullHTML || summaryHTML, link || baseURL);
    const dateNode = child(entry, 'published') || child(entry, 'updated') || child(entry, 'pubdate') || child(entry, 'date');
    const published = Date.parse(text(dateNode, 100));
    const author = text(child(entry, 'creator') || child(entry, 'author'), 300);
    const contentHTML = cleanContent(fullHTML || summaryHTML);
    const summary = htmlText(summaryHTML || fullHTML).slice(0, 1200);
    const fullText = htmlText(fullHTML);
    const clearlyTruncated = /(?:read more|continue reading|keep reading|view full article|\.{3,}|…)\s*(?:<\/(?:a|p|div|span)>\s*)*$/i.test(fullHTML) ||
      /(?:read-more|continue-reading|truncated|teaser)/i.test(full?.getAttribute('class') || '');
    const isFull = Boolean(full && fullText.length && !clearlyTruncated &&
      (fullText.length >= 250 || /<(?:h[1-6]|blockquote|ul|ol|li|figure|table)\b/i.test(fullHTML) ||
        (parseHTML('<html><body>' + fullHTML + '</body></html>').document.querySelectorAll('p').length >= 2)));
    const title = text(child(entry, 'title'), 500);
    if (!title && !link) continue;
    feed.items.push({
      guid: guid || (title + '|' + (Number.isFinite(published) ? published : '')),
      title: title || link,
      link,
      sourceName: text(source, 300),
      sourceURL: resolveURL(source?.getAttribute('url'), baseURL),
      author,
      summary,
      contentHTML: contentHTML.slice(0, 100000),
      hasFullContent: isFull,
      imageURL,
      publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null
    });
  }
  return feed;
}
function discoverFeeds(source, baseURL) {
  const document = parseHTML(source).document;
  return [...document.querySelectorAll('link[rel][href]')]
    .filter(node => (node.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('alternate') &&
      /(?:rss|atom|xml)/i.test(node.getAttribute('type') || ''))
    .map(node => ({
      url: resolveURL(node.getAttribute('href'), baseURL),
      title: text(node.getAttribute('title'), 200)
    }))
    .filter(item => item.url)
    .slice(0, 8);
}
function parseSitePage(source, pageURL) {
  const document = parseHTML(source).document;
  const base = new URL(pageURL);
  const title = siteTitle(
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
      document.querySelector('title')?.textContent,
    base.hostname
  );
  const asArticle = article => ({
    guid: pageURL,
    title: article.title || title,
    link: pageURL,
    author: article.byline || '',
    summary: article.excerpt || htmlText(article.contentHTML).slice(0, 1200),
    contentHTML: article.contentHTML,
    hasFullContent: true,
    imageURL: article.imageURL || '',
    publishedAt: null
  });
  const article = readerContent(source, pageURL);
  const pathDepth = base.pathname.split('/').filter(Boolean).length;
  if ((/article/i.test(document.querySelector('meta[property="og:type"]')?.getAttribute('content') || '') ||
      document.querySelector('meta[property="article:published_time"]') ||
      (pathDepth > 1 && document.querySelector('article h1,main h1'))) && article.contentHTML)
    return { valid: true, title, siteURL: pageURL, items: [asArticle(article)] };
  const items = [], seen = new Set();
  for (const anchor of document.querySelectorAll('a[href]')) {
    const link = resolveURL(anchor.getAttribute('href'), pageURL);
    if (!link || seen.has(link)) continue;
    const target = new URL(link);
    if (target.origin !== base.origin || target.pathname === base.pathname) continue;
    if (anchor.closest('nav,header,footer,[role="navigation"]')) continue;
    const card = anchor.closest('article,[class*="article"],[class*="story"],[class*="post"],[class*="card"],[data-article]');
    const context = card || anchor;
    const label = text(card?.querySelector('h1,h2,h3,h4') || anchor.querySelector('h1,h2,h3,h4') || anchor, 500) ||
      text(anchor.querySelector('img')?.getAttribute('alt'), 500);
    if (!label || label.length < 10) continue;
    const published = Date.parse(context?.querySelector('time[datetime]')?.getAttribute('datetime') || '');
    seen.add(link);
    items.push({
      guid: link,
      title: label,
      link,
      author: '',
      summary: text(context, 1200).replace(label, '').trim(),
      contentHTML: '',
      hasFullContent: false,
      imageURL: imageFrom(context?.innerHTML || '', pageURL),
      publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null
    });
    if (items.length >= 100) break;
  }
  if (items.length) return { valid: true, title, siteURL: pageURL, items };

  if (!article.contentHTML) return { valid: true, title, siteURL: pageURL, items: [] };
  return {
    valid: true,
    title,
    siteURL: pageURL,
    items: [asArticle(article)]
  };
}
function isPaywalled(document, content) {
  const tier = [...document.querySelectorAll('meta[property="article:content_tier"],meta[name="content-access"]')]
    .map(node => (node.getAttribute('content') || '').toLowerCase()).join(' ');
  if (/paid|subscriber|premium|metered|subscription/.test(tier)) return true;
  if (document.querySelector('[data-paywall],#paywall,.paywall,[class*="paywall"],[id*="paywall"]')) return true;
  return /\bsubscribe to (?:continue|keep) reading\b|\bsubscription required to read\b|\bsubscribers only\b/i.test(content);
}
function pageIsPaywalled(source) {
  const document = parseHTML(source).document;
  return isPaywalled(document, document.body?.textContent || '');
}
function readerContent(source, url) {
  const document = parseHTML(source).document;
  Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
  Object.defineProperty(document, 'baseURI', { value: url, configurable: true });
  const sourceImage = articleImage(source, url);
  if (isPaywalled(document, document.body?.textContent || '')) return { paywalled: true, imageURL: sourceImage };
  let article;
  try {
    const clone = document.cloneNode(true);
    Object.defineProperty(clone, 'documentURI', { value: url, configurable: true });
    Object.defineProperty(clone, 'baseURI', { value: url, configurable: true });
    article = new Readability(clone, { charThreshold: 0, maxElemsToParse: 40000 }).parse();
  } catch { return { paywalled: false, contentHTML: '', imageURL: sourceImage }; }
  if (!article?.content) return { paywalled: false, contentHTML: '', imageURL: sourceImage };
  const content = parseHTML('<html><body>' + article.content + '</body></html>').document;
  for (const node of content.querySelectorAll('script,style,form,iframe,button,nav,aside,footer,noscript,[hidden],[aria-hidden="true"]')) node.remove();
  const adPattern = /(?:^|[\s_-])(?:ad|ads|advert|advertisement|adslot|adunit|sponsored-content|promoted-content)(?:$|[\s_-])/i;
  for (const node of content.querySelectorAll('[class],[id],[aria-label],[data-ad-slot],[data-ad-unit]')) {
    const label = ['class', 'id', 'aria-label'].map(key => node.getAttribute(key) || '').join(' ');
    if (adPattern.test(label) || node.matches('[data-ad-slot],[data-ad-unit]')) node.remove();
  }
  if (!articleQuality(content.body.innerHTML, source)) return { paywalled: false, contentHTML: '', imageURL: sourceImage };
  const published = Date.parse(
    document.querySelector('meta[property="article:published_time"],meta[name="date"],meta[itemprop="datePublished"]')?.getAttribute('content') ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') || ''
  );
  return {
    paywalled: false,
    title: text(article.title, 500),
    byline: text(article.byline, 300),
    excerpt: text(article.excerpt, 1200),
    publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
    imageURL: sourceImage || imageFrom(article.content, url),
    contentHTML: content.body.innerHTML.slice(0, 1000000)
  };
}

module.exports = { parseFeed, discoverFeeds, parseSitePage, readerContent, pageIsPaywalled, normalizeExtractedArticle, articleImage };
