const assert = require('node:assert/strict');
const { Assistant, promptFor, parseCall } = require('../../electron/assistant.cjs');
const examples = require('./examples.cjs');

function completion(action, args) {
  const values = Object.entries(args).map(([key, value]) => key + ':<escape>' + value + '<escape>');
  return '<start_function_call>call:' + action + '{' + values.join(',') + '}<end_function_call>';
}

async function main() {
  const [mode, modelRoot] = process.argv.slice(2);
  if (mode === 'export') {
    for (const [request, action, args, context] of examples.train) {
      const prompt = promptFor(request, context);
      if (!prompt.includes('declaration:' + action + '{')) throw new Error('Training tool missing from prompt: ' + request);
      const target = completion(action, args);
      if (action !== 'unsupported') assert.ok(parseCall(target));
      console.log(JSON.stringify({ prompt, completion: target + '<end_of_turn>\n' }));
    }
    return;
  }
  if (mode !== 'eval' || !modelRoot) throw new Error('Use export, or eval followed by the local FunctionGemma folder.');
  const assistant = new Assistant(modelRoot);
  if (assistant.state().status !== 'ready') throw new Error('The local model is not installed in that folder.');
  let passed = 0;
  for (const [request, action, args, context] of examples.eval) {
    const expected = parseCall(completion(action, args));
    // Call inference directly so the exact-phrase shortcuts cannot improve this score.
    const actual = await assistant.infer(request, AbortSignal.timeout(30000), context);
    try {
      assert.deepEqual(actual, expected);
      passed++;
      console.log('PASS', request);
    } catch {
      console.log('MISS', request, JSON.stringify({ actual, expected }));
    }
  }
  console.log(passed + '/' + examples.eval.length + ' model-only plans matched.');
  if (passed !== examples.eval.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
