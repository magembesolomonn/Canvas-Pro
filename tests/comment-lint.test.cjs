const test = require('node:test');
const assert = require('node:assert/strict');
const { comments, check } = require('../scripts/comment-lint.cjs');

test('comment lint distinguishes source from literal data', () => {
  const source = 'const name = "https://example.com/🎨/*"; // actual';
  assert.deepEqual(comments(source, 'js').map(node => node.text), ['// actual']);
  const html = '<!-- note --><style>a{content:"/*"}/* style */</style><script>let x="//";/* js */</script>';
  assert.deepEqual(comments(html, 'html').map(node => html.slice(node.start, node.end)), ['<!-- note -->', '/* style */', '/* js */']);
  const swift = 'let value = #"// 😀"#\n/* outer /* nested */ still outer */';
  assert.deepEqual(comments(swift, 'swift').map(node => swift.slice(node.start, node.end)), ['/* outer /* nested */ still outer */']);
});

test('comment lint checks scripts evaluated by Electron test helpers', () => {
  const source = 'run(`const name = ${value}; // evaluated\n`); log(`// ordinary data`)';
  assert.deepEqual(comments(source, 'js', 0, true).map(node => source.slice(node.start, node.end)), ['// evaluated']);
});

test('the ratchet rejects substitutions, duplicates and obsolete allowances', () => {
  const entry = { file: 'src/example.js', line: 1, text: '// existing' };
  const baseline = { [JSON.stringify([entry.file, entry.text])]: 1 };
  assert.deepEqual(check([{ ...entry, line: 20 }], baseline), []);
  assert.ok(check([entry, entry], baseline).length);
  assert.ok(check([{ ...entry, text: '// changed' }], baseline).length);
  assert.ok(check([], baseline).length);
});
