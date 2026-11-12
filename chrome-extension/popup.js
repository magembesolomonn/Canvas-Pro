const $ = selector => document.querySelector(selector);
let tabId;

const TOAST_GLYPHS = { success: '✓', error: '!', info: 'i' };
const TOAST_TITLES = { success: 'Saved', error: 'Something went wrong', info: 'Canvas Pro' };
const MAX_TOASTS = 3;

// A toast is a small status card with an icon, a title, an optional detail and
// an optional remaining-time bar. Duration 0 keeps it until dismissed.
function toast(message, options = {}) {
  const stack = $('#toasts');
  if (!stack) return { dismiss() {} };
  const type = Object.hasOwn(TOAST_GLYPHS, options.type) ? options.type : 'info';
  const duration = options.duration === 0 ? 0 : Math.max(1200, options.duration || (type === 'error' ? 6000 : 3600));
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.style.setProperty('--toast-duration', `${duration}ms`);

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = TOAST_GLYPHS[type];

  const copy = document.createElement('span');
  copy.className = 'toast-copy';
  const heading = document.createElement('strong');
  heading.textContent = options.title || TOAST_TITLES[type];
  const body = document.createElement('span');
  body.textContent = String(message ?? '');
  copy.append(heading);
  if (body.textContent) copy.append(body);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';

  item.append(icon, copy, close);
  if (duration) {
    const bar = document.createElement('span');
    bar.className = 'toast-progress';
    bar.setAttribute('aria-hidden', 'true');
    item.append(bar);
  }
  stack.append(item);
  while (stack.children.length > MAX_TOASTS) stack.firstElementChild.remove();

  let timer = 0, remaining = duration, started = 0, paused = false, closed = false;
  const dismiss = () => {
    if (closed || !item.isConnected) return;
    closed = true;
    clearTimeout(timer);
    item.classList.add('is-leaving');
    const remove = () => item.remove();
    item.addEventListener('animationend', event => {
      if (event.target === item && event.animationName === 'toast-out') remove();
    });
    setTimeout(remove, 260);
  };
  const start = () => {
    if (!duration || closed) return;
    started = Date.now();
    timer = setTimeout(dismiss, remaining);
  };
  const pause = () => {
    if (!duration || paused || closed) return;
    paused = true;
    remaining = Math.max(0, remaining - (Date.now() - started));
    clearTimeout(timer);
    item.classList.add('is-paused');
  };
  const resume = () => {
    if (!paused || closed) return;
    paused = false;
    item.classList.remove('is-paused');
    start();
  };

  close.addEventListener('click', dismiss);
  item.addEventListener('pointerenter', pause);
  item.addEventListener('pointerleave', resume);
  item.addEventListener('focusin', pause);
  item.addEventListener('focusout', event => {
    if (!item.contains(event.relatedTarget)) resume();
  });
  start();
  return { dismiss };
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Canvas Pro is unavailable');
  return response.result;
}

function hint(text, error = false) {
  const status = $('#status');
  status.textContent = text;
  status.classList.toggle('error', error);
}

function setConnection(state, text) {
  const connection = $('#connection');
  connection.textContent = text;
  connection.classList.toggle('ready', state === 'ready');
  connection.classList.toggle('offline', state === 'offline');
  connection.setAttribute('aria-label', `Connection: ${text}`);
}

function setDeepScan(active) {
  const button = $('#deep-scan');
  button.dataset.watching = String(active);
  button.setAttribute('aria-pressed', String(active));
  button.querySelector('.deep-scan-copy strong').textContent = active
    ? 'Stop deep media scan'
    : 'Enable deep media scan';
  button.querySelector('.deep-scan-copy small').textContent = active
    ? 'Scanning this tab for 30 minutes'
    : 'Find media that loads as you scroll';
}

function captureSummary(result) {
  if (result.imported !== undefined) {
    const failed = result.errors?.length || 0;
    return {
      type: failed ? 'error' : 'success',
      title: failed ? 'Capture finished with errors' : 'Saved to Canvas Pro',
      message: `${result.imported} saved · ${result.duplicates} already in library${failed ? ` · ${failed} failed` : ''}`
    };
  }
  if (result.count !== undefined) {
    return { type: 'info', title: 'Media found', message: `${result.count} images found` };
  }
  return { type: 'success', title: 'Saved to Canvas Pro', message: 'Capture added to your library.' };
}

document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', async () => {
    const action = button.dataset.action;
    const label = button.querySelector('b')?.textContent?.trim() || 'Capture';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    let pending;
    try {
      if (['collect', 'videos'].includes(action)) {
        if (!chrome.sidePanel) throw new Error('Update Chrome to use the media side panel.');
        await chrome.sidePanel.open({ tabId });
      }
      pending = toast(`${label}…`, { type: 'info', title: 'Working', duration: 0 });
      const promise = send({ type: 'action', action, tabId });
      if (action === 'region') {
        await promise;
        window.close();
        return;
      }
      const result = await promise;
      pending.dismiss();
      const summary = captureSummary(result);
      toast(summary.message, { type: summary.type, title: summary.title });
      if (action === 'fullpage') hint('Full page saved to Canvas Pro.');
    } catch (error) {
      pending?.dismiss();
      hint(error.message, true);
      toast(error.message, { type: 'error', title: 'Capture failed' });
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
});

$('#folder').addEventListener('change', () => {
  if (globalThis.chrome?.storage?.local) chrome.storage.local.set({ folder: $('#folder').value });
});

$('#deep-scan').addEventListener('click', async () => {
  const watching = $('#deep-scan').dataset.watching === 'true';
  if (watching) {
    await chrome.storage.session.remove(`media-watch:${tabId}`);
    setDeepScan(false);
    hint('Deep media scan stopped.');
    toast('Deep media scan stopped.', { type: 'info', title: 'Scan stopped' });
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
    if (!granted) {
      hint('Media scan was not enabled. Regular capture still works.', true);
      toast('Media scan was not enabled. Regular capture still works.', { type: 'info', title: 'Scan not enabled' });
      return;
    }
    await send({ type: 'watch-media', tabId });
    setDeepScan(true);
    hint('Scanning this tab for 30 minutes. Play or scroll to the media, then choose Find videos.');
    toast('Scanning this tab for 30 minutes.', { type: 'info', title: 'Deep media scan' });
  } catch (error) {
    hint(error.message, true);
    toast(error.message, { type: 'error', title: 'Deep scan failed' });
  }
});

$('#setup').addEventListener('click', () => {
  if (globalThis.chrome?.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
});

if (globalThis.chrome?.storage?.onChanged) {
  let lastFailure = '';
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes.lastCapture) return;
    const job = changes.lastCapture.newValue;
    if (!job) return;
    // The popup keeps one plain status line. The capture itself reports on
    // the page, so no card is left behind here.
    if (job.state === 'running') {
      hint(`Saving ${job.done || 0} of ${job.total || 1}…`);
      return;
    }
    if (job.state === 'failed') {
      const message = job.errors?.[0] || 'Capture failed';
      hint(message, true);
      const key = `${job.id}:${message}`;
      if (key !== lastFailure) {
        lastFailure = key;
        toast(message, { type: 'error', title: 'Capture failed' });
      }
      return;
    }
    const saved = job.imported || 0;
    const duplicates = job.duplicates || 0;
    hint(saved || duplicates
      ? `${saved} saved${duplicates ? ` · ${duplicates} already in library` : ''}`
      : 'Tip: drag an image to the saver, or Alt+Right-click media to save instantly.');
  });
}

(async () => {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.storage) return;
  try {
    const build = $('#build');
    if (build) build.textContent = 'v' + (chrome.runtime.getManifest?.().version || '?');
  } catch {}
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  const { folder } = await chrome.storage.local.get('folder');
  const watch = (await chrome.storage.session.get(`media-watch:${tabId}`))[`media-watch:${tabId}`];
  if (watch?.expires > Date.now()) setDeepScan(true);

  try {
    const result = await send({ type: 'ping' });
    setConnection('ready', 'Connected');
    for (const name of result.folders || []) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      $('#folder').append(option);
    }
    $('#folder').value = (result.folders || []).includes(folder) ? folder : '';
    await chrome.storage.local.set({ folder: $('#folder').value });
  } catch (error) {
    setConnection('offline', 'Not connected');
    hint('Open Canvas Pro on your Mac to connect.', true);
    toast(error.message, { type: 'error', title: 'Not connected' });
  }

  const { lastCapture } = await chrome.storage.session.get('lastCapture');
  if (lastCapture && lastCapture.state === 'failed') {
    const message = lastCapture.errors?.[0] || 'Last capture failed';
    hint(message, true);
    toast(message, { type: 'error', title: 'Last capture failed' });
  }
})();
