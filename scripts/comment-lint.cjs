const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tokenize, isTokenComment } = require('@csstools/css-tokenizer');
const { parse, registerDynamicLanguage } = require('@ast-grep/napi');

registerDynamicLanguage({ swift: require('@ast-grep/lang-swift') });

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(__dirname, 'comment-baseline.json');
const languages = { js: 'js', mjs: 'js', cjs: 'js', swift: 'swift', css: 'css', html: 'html', svg: 'html' };
const generated = new Set(['formats', 'model-worker', 'semantic-worker', 'epub-worker', 'eps-worker'].map(name => 'src/' + name + '.js'));

generated.add('electron/smart-page.cjs');

function comments(source, language, offset = 0, inspectTestScripts = false) {
  if (language === 'css') {
    return tokenize({ css: source }).filter(isTokenComment).map(([, text, start, end]) => ({
      text, start: offset + start, end: offset + end + 1
    }));
  }
  const tree = parse(language, source).root();
  const kinds = language === 'swift' ? ['comment', 'multiline_comment'] : ['comment'];
  const result = [];
  for (const kind of kinds) {
    for (const node of tree.findAll({ rule: { kind } })) {
      const { start, end } = node.range();
      result.push({ start: offset + start.index, end: offset + end.index, text: node.text() });
    }
  }
  if (inspectTestScripts && language === 'js') {
    for (const literal of tree.findAll({ rule: { kind: 'template_string' } })) {
      const call = literal.parent()?.parent();
      if (call?.kind() !== 'call_expression') continue;
      const callee = call.field('function')?.text().split('.').pop();
      if (!['evaluate', 'executeJavaScript', 'evalJS', 'run', 'js'].includes(callee)) continue;
      let script = literal.text().slice(1, -1);
      const start = literal.range().start.index + 1;
      for (const child of literal.children().filter(node => node.kind() === 'template_substitution')) {
        const range = child.range();
        const replacement = '0' + child.text().slice(1).replace(/[^\n]/g, ' ');
        script = script.slice(0, range.start.index - start) + replacement + script.slice(range.end.index - start);
      }
      result.push(...comments(script, 'js', offset + start).filter(entry =>
        source.slice(entry.start - offset, entry.end - offset) === entry.text));
    }
  }
  if (language === 'html') {
    for (const node of tree.findAll({ rule: { kind: 'raw_text' } })) {
      const embedded = node.parent().kind() === 'style_element' ? 'css' : 'js';
      result.push(...comments(node.text(), embedded, offset + node.range().start.index));
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function inventory() {
  const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  const result = [];
  for (const file of new Set(paths.split('\0').sort())) {
    const language = languages[path.extname(file).slice(1)];
    if (!language || generated.has(file) || file.startsWith('src/vendor/') || !fs.existsSync(path.join(root, file))) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    let line = 1;
    let cursor = 0;
    for (const comment of comments(source, language, 0, file.startsWith('tests/'))) {
      line += source.slice(cursor, comment.start).split('\n').length - 1;
      cursor = comment.start;
      result.push({ file, line, ...comment });
    }
  }
  return result;
}

function check(entries, baseline) {
  const remaining = new Map(Object.entries(baseline));
  const errors = [];
  for (const entry of entries) {
    const key = JSON.stringify([entry.file, entry.text]);
    const count = remaining.get(key) || 0;
    if (count) remaining.set(key, count - 1);
    else errors.push(entry.file + ':' + entry.line + ' Remove the new comment or record its rationale in an ADR.');
  }
  for (const [key, count] of remaining) {
    if (count) errors.push('Reduce the obsolete comment allowance for ' + JSON.parse(key)[0]);
  }
  return errors;
}

if (require.main === module) {
  const entries = inventory();
  if (process.argv.includes('--inventory')) console.log(JSON.stringify(entries));
  else {
    const errors = check(entries, JSON.parse(fs.readFileSync(baselinePath, 'utf8')));
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else console.log('Comment lint passed (' + entries.length + ' baseline comments).');
  }
}

module.exports = { comments, check, inventory };
