const fs = require('node:fs/promises');
const { createWriteStream, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');

const release = 'b12110';
const runtimes = {
  arm64: ['arm64', 16650691, '4f5b8de12e0b9516658ca6a5764c6ffb3d7c659c3dd538556b1413c7b4050662'],
  x64: ['x64', 12388601, 'c8094268b6bf62f4998f0e45656fd9f5e2d4afb6b1cd0044d761db64be1dd47d']
};
const model = {
  url: 'https://huggingface.co/unsloth/functiongemma-270m-it-GGUF/resolve/1de0f7fc7cae0062012c2e91ef02e642c161aa57/functiongemma-270m-it-Q4_K_M.gguf',
  size: 253127904,
  hash: '7474135cf63b5de86bd29d2feb92c644d48e9df5e1ac31550662af373c67d0fc'
};

const tools = {
  collect_files: ['Find files by filename and add them to a new collection. Query is the filename keyword. Name is the new collection title.', ['query', 'name']],
  create_collection: ['Create an empty library collection', 'name'],
  collect_results: ['Create a collection containing the previous search results or selected files', 'name'],
  search_library: ['Find files in the local library by keyword', 'query'],
  open_note: ['Open, show or navigate to a note that already exists by its exact title', 'title'],
  create_note: ['Create a new blank note only if the user asks to make, add or create a new note', 'title'],
  rename_note: ['Rename the note currently open', 'title'],
  tag_selection: ['Add a tag to the selected files', 'tag'],
  trash_selection: ['Move the selected files to Trash', null],
  search_web: ['Look up information online using a web browser', 'query'],
  open_collection: ['Open a named collection that already exists', 'name'],
  add_to_collection: ['Add selected files to an existing named collection', 'name'],
  open_canvas: ['Open a named canvas or moodboard', 'name'],
  create_canvas: ['Create a new named canvas or moodboard', 'name'],
  add_to_canvas: ['Place references to selected library files on an existing canvas', 'name'],
  preview_selection: ['Preview the currently selected file with the app viewer', null],
  set_note_cover: ['Find a library image by filename and use it as the featured image of the open note', 'query'],
  unsupported: ['The request needs more information or cannot be handled by these tools', null]
};

function toolNamesFor(command) {
  if (/\bcollections?\b/i.test(command)) {
    if (/\b(?:open|show|switch|pull up|bring up|existing|already)\b/i.test(command)) return ['open_collection', 'add_to_collection', 'unsupported'];
    return ['collect_files', 'create_collection', 'collect_results', 'unsupported'];
  }
  if (/\b(?:canvas|moodboards?)\b/i.test(command)) return ['open_canvas', 'create_canvas', 'add_to_canvas', 'unsupported'];
  if (/\b(?:cover|featured image)\b/i.test(command)) return ['set_note_cover', 'unsupported'];
  if (/\b(?:preview|play|view)\b/i.test(command) && /\b(?:selected|this)\b/i.test(command)) return ['preview_selection', 'unsupported'];
  return ['search_library', 'open_note', 'create_note', 'rename_note', 'tag_selection', 'trash_selection', 'search_web', 'unsupported'];
}

function promptFor(command, context = {}) {
  const names = toolNamesFor(command);
  const declarations = Object.entries(tools).filter(([name]) => names.includes(name)).map(([name, [description, parameters]]) => {
    const keys = [parameters].flat().filter(Boolean);
    const properties = keys.map(key => key + ':{description:<escape>' + ({ query: 'The search text', name: name.endsWith('collection') && name !== 'open_collection' && name !== 'add_to_collection' || name.startsWith('collect_') ? 'The name of the new collection' : 'The exact name from the request' }[key] || 'Copy the value from the request') + '<escape>,type:<escape>STRING<escape>}').join(',');
    const required = keys.map(key => '<escape>' + key + '<escape>').join(',');
    return '<start_function_declaration>declaration:' + name + '{description:<escape>' + description +
      '<escape>,parameters:{properties:{' + properties + '},required:[' + required +
      '],type:<escape>OBJECT<escape>}}<end_function_declaration>';
  }).join('');
  // Keep the base prompt stable for existing tools. Context only adds bounded facts.
  const contextual = names.some(name => ['add_to_canvas', 'set_note_cover', 'preview_selection'].includes(name));
  const count = Number.isSafeInteger(context?.selectionCount) ? Math.max(0, Math.min(100000, context.selectionCount)) : 0;
  const type = ['image','video','audio','pdf','link','other'].includes(context?.fileType) ? context.fileType : 'unknown';
  const facts = contextual ? '\nCanvas Pro context: ' + count + ' selected files. Selected file type: ' + type +
    '. Note open: ' + (context?.noteOpen === true ? 'yes' : 'no') + '.' : '';
  return '<start_of_turn>developer\nYou are a model that can do function calling with the following functions' +
    declarations + facts + '<end_of_turn>\n<start_of_turn>user\n' + command.replace(/[<>]/g, '') +
    '<end_of_turn>\n<start_of_turn>model\n';
}

function parseCall(output) {
  const call = output.trim().match(/^<start_function_call>call:([a-z_]+)\{([\s\S]*?)\}<end_function_call>(?:<start_function_response>|<end_of_turn>)?(?: \[end of text\])?$/);
  if (!call || !Object.hasOwn(tools, call[1]) || call[1] === 'unsupported') return null;
  const [, action, args] = call;
  const keys = [tools[action][1]].flat().filter(Boolean);
  if (!keys.length) return args.trim() ? null : { action };
  const values = new Map();
  let remaining = args;
  while (remaining) {
    const argument = /^([a-z_]+):<escape>([^<>]{1,500})<escape>(,|$)/.exec(remaining);
    if (!argument || !keys.includes(argument[1]) || values.has(argument[1]) ||
        !validateValue(action, argument[2].trim())) return null;
    values.set(argument[1], argument[2].trim());
    remaining = remaining.slice(argument[0].length);
    if (argument[3] && !remaining) return null;
  }
  if (values.size !== keys.length) return null;
  if (['open_collection','add_to_collection','open_canvas','create_canvas','add_to_canvas'].includes(action) && values.get('name').length > 120) return null;
  if (['collect_files', 'collect_results', 'create_collection'].includes(action)) {
    const name = values.get('name');
    if (name.length > 120) return null;
    return { action: 'collection', value: name, query: values.get('query'), includeFiles: action !== 'create_collection' };
  }
  return { action, value: values.get(keys[0]) };
}

// Keep exact commands predictable and require explicit wording for file removal.
function directCall(command) {
  if (/^(?:help|what (?:can|do) you (?:do|don|support)(?: for me)?|how do i use (?:you|this assistant)|(?:show|list) (?:me )?(?:your )?(?:commands|capabilities))[.!?]*$/i.test(command)) {
    return { action: 'help' };
  }
  if (/^(?:move (?:the )?selected files? to trash|trash (?:the )?selected files?)[.!]?$/i.test(command)) {
    return { action: 'trash_selection' };
  }
  const preview = /^(?:(?:can|could) you )?(?:preview|play|open) (?:this|the selected) (file|image|video|audio|pdf|link)[.!?]?$/i.exec(command);
  if (preview) return { action: 'preview_selection', fileType: preview[1].toLowerCase() };
  const chain = /^(?:find|look for|search for) (?:the )?files (?:named|matching|called) (.+?) (?:and (?:then )?|then )(.+)$/i.exec(command);
  const collectionCommand = (chain?.[2] || command).replace(/[.!]$/, '');
  const add = /(?: and (?:add|put) (?:them|those files|the results|the matches)(?: (?:there|in it|into it|to it))?)$/i;
  const create = /^(?:create|make) (?:a )?(?:new )?collection(?: (?:called|named|titled) (.+))?$/i;
  const put = /^(?:add|put) (?:them|those files|the results|the matches) (?:to|in|into) (?:a )?(?:new )?collection(?: (?:called|named|titled) (.+))?$/i;
  const moveToCollection = put.exec(collectionCommand);
  const createCollection = create.exec(collectionCommand.replace(add, ''));
  if (moveToCollection || createCollection) {
    const clean = value => value?.trim().replace(/^["“](.+)["”]$/, '$1');
    const query = clean(chain?.[1]);
    const value = clean((moveToCollection || createCollection)[1]);
    if ((!value || value.length <= 120 && validateValue('collection', value)) &&
        (!query || validateValue('search_library', query))) {
      return { action: 'collection', value, query, includeFiles: Boolean(chain || moveToCollection || add.test(collectionCommand)) };
    }
  }
  const patterns = {
    set_note_cover: /^use (?:the image )?(.+?) as (?:the |this note.s )?(?:note )?cover[.!?]?$/i,
    open_collection: /^open (?:the )?collection (?:called |named )?(.+?)[.!?]?$/i,
    add_to_collection: /^add (?:these|the selected files) to (?:the )?collection (?:called |named )?(.+?)[.!?]?$/i,
    open_canvas: /^open (?:the )?(?:canvas|moodboard) (?:called |named )?(.+?)[.!?]?$/i,
    create_canvas: /^(?:create|make) (?:a )?(?:new )?(?:canvas|moodboard) (?:called|named|titled) (.+?)[.!?]?$/i,
    add_to_canvas: /^add (?:these|the selected files) to (?:the )?(?:canvas|moodboard) (?:called |named )?(.+?)[.!?]?$/i,
    open_note: /^(?:open|show) (?:(?:the )?note (?:called |titled )?|my )(.+?)(?: note)?[.!]?$/i,
    create_note: /^(?:create|make|add) (?:a )?(?:new )?note (?:called|named|titled) (.+)$/i,
    rename_note: /^rename (?:this|the current|the open) note to (.+)$/i,
    tag_selection: /^tag (?:the )?selected files? (?:with|as) (.+)$/i,
    search_library: /^(?:find|search for) files (?:named|matching|called) (.+)$/i,
    search_web: /^(?:search the web for|look up online) (.+)$/i
  };
  for (const [action, pattern] of Object.entries(patterns)) {
    const value = pattern.exec(command)?.[1]?.trim().replace(/^["“](.+)["”]$/, '$1');
    if (value) return validateValue(action, value);
  }
  return null;
}

function validateValue(action, value) {
  if (!value || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value) ||
      (['create_note','rename_note','tag_selection'].includes(action) && value.length > 120)) return null;
  return { action, value };
}

function runProcess(file, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { signal, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let failure;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 16384) {
        failure = new Error('The local runtime returned too much output.');
        child.kill();
      }
    });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      if (failure) reject(failure);
      else if (code === 0) resolve(stdout);
      else reject(new Error('The local runtime could not finish. Check that your Mac is up to date.'));
    });
  });
}

class Assistant {
  constructor(root) {
    this.root = root;
    this.install = path.join(root, release);
    this.runtime = process.platform === 'darwin' ? runtimes[process.arch] : null;
    this.binary = path.join(this.install, 'llama-' + release, 'llama-completion');
    this.weights = path.join(this.install, 'model.gguf');
    this.received = 0;
    this.error = '';
  }

  state() {
    return {
      folder: this.root,
      status: !this.runtime ? 'unsupported' : this.downloadJob ? 'downloading' :
        existsSync(this.weights) && existsSync(this.binary) ? 'ready' : 'missing',
      received: this.received,
      total: this.runtime ? this.runtime[1] + model.size : 0,
      error: this.error
    };
  }

  download() {
    if (this.state().status !== 'missing') return this.state();
    this.error = '';
    this.received = 0;
    const controller = new AbortController();
    this.downloadController = controller;
    this.downloadJob = this.installFiles(controller.signal).catch(error => {
      if (!controller.signal.aborted) this.error = error.message;
    }).finally(() => { this.downloadJob = this.downloadController = null; });
    return this.state();
  }

  async installFiles(signal) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(this.root)) {
      if (entry.startsWith('.download-')) await fs.rm(path.join(this.root, entry), { recursive: true, force: true });
    }
    signal.throwIfAborted();
    const stage = await fs.mkdtemp(path.join(this.root, '.download-'));
    const [arch, size, hash] = this.runtime;
    const archive = path.join(stage, 'runtime.tgz');
    try {
      await this.fetchFile(model, path.join(stage, 'model.gguf'), signal);
      await this.fetchFile({
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/' + release +
          '/llama-' + release + '-bin-macos-' + arch + '.tar.gz', size, hash
      }, archive, signal);
      await runProcess('/usr/bin/tar', ['-xzf', archive, '-C', stage], signal);
      await fs.unlink(archive);
      await fs.writeFile(path.join(stage, 'NOTICE.txt'),
        'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms\n' +
        'FunctionGemma weights quantized by Unsloth.\n');
      await fs.access(path.join(stage, 'llama-' + release, 'llama-completion'));
      signal.throwIfAborted();
      await fs.rm(this.install, { recursive: true, force: true });
      await fs.rename(stage, this.install);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }

  async fetchFile(file, destination, signal) {
    const transfer = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
    const response = await fetch(file.url, { signal: transfer });
    if (!response.ok || !response.body) throw new Error('Download failed. Please try again.');
    const digest = createHash('sha256');
    let length = 0;
    const self = this;
    await pipeline(response.body, async function* (source) {
      for await (const chunk of source) {
        length += chunk.length;
        if (length > file.size) throw new Error('The download size did not match.');
        self.received += chunk.length;
        digest.update(chunk);
        yield chunk;
      }
    }, createWriteStream(destination, { mode: 0o600, flags: 'wx' }), { signal: transfer });
    if (length !== file.size || digest.digest('hex') !== file.hash) {
      throw new Error('The download could not be verified. Please try again.');
    }
  }

  cancel() { this.downloadController?.abort(); }
  stop() { this.runController?.abort(); }

  async plan(command, context) {
    if (typeof command !== 'string' || !command.trim() || command.length > 1500) throw new Error('Enter a command of up to 1,500 characters.');
    if (this.state().status !== 'ready') throw new Error('Download the assistant in Settings first.');
    if (this.runJob) throw new Error('The assistant is already running.');
    const direct = directCall(command.trim());
    if (direct) return direct;
    const controller = new AbortController();
    this.runController = controller;
    this.runJob = this.infer(command.trim(), AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), context);
    try { return await this.runJob; }
    catch (error) {
      if (controller.signal.aborted) return null;
      if (error.name === 'AbortError') throw new Error('The assistant took too long. Try a shorter command.');
      throw error;
    } finally { this.runJob = this.runController = null; }
  }

  async infer(command, signal, context) {
    const directory = await fs.mkdtemp(path.join(this.root, '.prompt-'));
    try {
      const file = path.join(directory, 'input');
      // The completion CLI trims one final newline from prompt files.
      await fs.writeFile(file, promptFor(command, context) + '\n', { mode: 0o600 });
      const output = await runProcess(this.binary, [
        '-m', this.weights, '-f', file, '-no-cnv', '--no-display-prompt', '--special',
        '-r', '<start_function_response>', '-c', '2048', '-n', '96', '-t', '2', '--device', 'none', '--temp', '0'
      ], signal);
      const plan = parseCall(output);
      if (!plan || plan.action === 'trash_selection') return null;
      const allowed = toolNamesFor(command).map(name =>
        ['collect_files','collect_results','create_collection'].includes(name) ? 'collection' : name);
      if (!allowed.includes(plan.action)) return null;
      if (plan.action === 'collection') {
        // An explicit collection title takes precedence over a title guessed by the model.
        const title = /\bcollection (?:called|named|titled) (.+?)[.!?]?$/i.exec(command)?.[1]
          ?.trim().replace(/^["“](.+)["”]$/, '$1');
        if (title) plan.value = title;
        const refersToFiles = /\b(?:those|the|these|my) (?:results|matches|selected files)\b/i.test(command);
        plan.includeFiles ||= refersToFiles;
        if (plan.value.length > 120 || !validateValue('collection', plan.value)) return null;
      }
      if (plan.value && plan.action !== 'search_web' && !command.toLowerCase().includes(plan.value.toLowerCase())) return null;
      if (plan.query && !command.toLowerCase().includes(plan.query.toLowerCase())) return null;
      return plan;
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }

  async close() {
    this.cancel();
    this.stop();
    await Promise.allSettled([this.downloadJob, this.runJob]);
  }
}

module.exports = { Assistant, promptFor, parseCall };
