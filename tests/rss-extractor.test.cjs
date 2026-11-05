const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extract } = require('../electron/rss-extractor.cjs');

const available = fs.existsSync(path.resolve(__dirname, '../bin/rss-extractor'));
test('bundled Trafilatura extracts the article and preserves headings and paragraphs',
  { skip: !available }, async () => {
    const result = await extract(
      '<html><head><title>Standalone extraction test</title></head><body><article>' +
      '<h1>Test story</h1><p>This paragraph describes the article content in enough detail for a standalone Trafilatura extraction test.</p>' +
      '<p>A second paragraph demonstrates preserved structure and readable formatting.</p></article></body></html>',
      'https://news.test/story'
    );
    assert.match(result.contentHTML, /<h1>Test story/);
    assert.equal((result.contentHTML.match(/<p\b/g) || []).length, 2);
    assert.equal(result.title, 'Test story');
  });
