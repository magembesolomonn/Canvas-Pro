// One ⌘K surface for commands, navigation and everything in the library.
// Results are assembled from the app's own indexes: the local smart index
// (which already knows names, tags and AI captions), the live catalog,
// canvases and collections. File hits are shown as a grid of previews,
// with a second grid of visually similar frames when a vector is available.
(() => {
  'use strict';

  const PALETTE_ID = 'command-palette';

  let dialog = null;
  let input = null;
  let list = null;
  // A search is kept for 15s after the palette closes, so ⌘K can bring the
  // same results straight back. After the window it resets to Quick actions.
  let rememberedQuery = '';
  let rememberedAt = 0;
  let rememberedScroll = 0;
  let rememberTimer = 0;
  let restoreScroll = 0;
  let sections = [];
  let entries = [];
  let active = -1;
  let sequence = 0;
  let paintTimer = 0;
  let pendingPaint = false;
  let restoreFocus = null;

  const click = selector => document.querySelector(selector)?.click();
  const labelScore = (label, query) => {
    const text = String(label).toLowerCase();
    const at = text.indexOf(query);
    if (at < 0) return 0;
    return at === 0 ? 2 : 1;
  };
  const setSelect = (selector, value) => {
    const node = document.querySelector(selector);
    if (!node || node.value === value) return;
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setZoom = value => {
    const node = document.querySelector('#zoom');
    if (!node) return;
    node.value = String(Math.max(140, Math.min(360, value)));
    node.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const openPane = pane => window.SettingsUI?.open(pane);
  const isChecked = selector => !!document.querySelector(selector)?.checked;
  const toggleSetting = selector => document.querySelector(selector)?.click();

  function commands() {
    const items = [
      { id: 'import', label: 'Import files…', icon: 'importing', keys: '⌘ O', group: 'Actions', run: () => click('#import') },
      { id: 'import-folder', label: 'Import folder…', icon: 'folder', group: 'Actions', run: () => click('#import-folder') },
      { id: 'new-collection', label: 'New collection', icon: 'folderAdd', group: 'Actions', run: () => SidebarUI.inlineCreate('collections') },
      { id: 'new-canvas', label: 'New canvas…', icon: 'canvas', group: 'Actions', run: () => click('#add-canvas') },
      { id: 'duplicate-review', label: 'Duplicate review…', icon: 'duplicates', group: 'Actions', hint: 'Settings Library', keywords: 'duplicates copies', run: () => click('#settings-duplicate-review') },
      { id: 'search', label: 'Search the library', icon: 'search', keys: '⌘ F', group: 'Actions', run: () => { if (view !== 'all') setView('all'); $('#search').focus(); } },
      { id: 'sidebar', label: 'Toggle sidebar', icon: 'sidebar', keys: '⌘ B', group: 'View', run: () => click('#toggle-sidebar') },
      { id: 'inspector', label: 'Toggle file details', icon: 'inspector', keys: '⌘ I', group: 'View', run: () => click('#toggle-inspector') },
      { id: 'infinite-view', label: 'Infinite canvas view', icon: 'canvas', keys: '⌥ O', group: 'View', hint: 'Settings Galleries', keywords: 'cosmos endless pan zoom', run: () => window.toggleInfiniteCanvas?.() },
      { id: 'settings', label: 'Open Settings', icon: 'settings', keys: '⌘ ,', group: 'View', run: () => click('#show-settings') },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', keys: '⌘ /', group: 'View', hint: 'Settings Shortcuts', run: () => openPane('shortcuts') },
      { id: 'appearance-light', label: 'Theme: Light', icon: 'appearance', group: 'Commands', hint: 'Settings Appearance', keywords: 'appearance light mode', run: () => api.appearanceSet({ theme: 'light' }) },
      { id: 'appearance-dark', label: 'Theme: Dark', icon: 'appearance', group: 'Commands', hint: 'Settings Appearance', keywords: 'appearance dark mode', run: () => api.appearanceSet({ theme: 'dark' }) },
      { id: 'appearance-system', label: 'Theme: System', icon: 'appearance', group: 'Commands', hint: 'Settings Appearance', keywords: 'appearance automatic', run: () => api.appearanceSet({ theme: 'system' }) },

      // Library settings.
      { id: 'library-new', label: 'New Library…', icon: 'folder', group: 'Commands', hint: 'Settings Library', run: () => api.switchLibrary('new') },
      { id: 'library-open', label: 'Open Library…', icon: 'folder', group: 'Commands', hint: 'Settings Library', run: () => api.switchLibrary('open') },
      { id: 'library-show', label: 'Show library folder', icon: 'folder', group: 'Commands', hint: 'Settings Library', run: () => api.showLibrary() },
      { id: 'settings-search', label: 'Search settings…', icon: 'settings', group: 'Commands', hint: 'Settings', run: () => { openPane(); requestAnimationFrame(() => document.querySelector('#settings-search')?.focus()); } },

      // Galleries and view options.
      { id: 'layout-masonry', label: 'Gallery layout: masonry', icon: 'layout', group: 'Commands', hint: 'Settings Galleries View', keywords: 'balanced columns', run: () => setGalleryLayout('masonry') },
      { id: 'layout-waterfall', label: 'Gallery layout: waterfall', icon: 'layout', group: 'Commands', hint: 'Settings Galleries View', keywords: 'fill columns in order', run: () => setGalleryLayout('waterfall') },
      { id: 'layout-justified', label: 'Gallery layout: justified', icon: 'layout', group: 'Commands', hint: 'Settings Galleries View', keywords: 'fit items into rows', run: () => setGalleryLayout('justified') },
      { id: 'file-names', label: showFileNamesEnabled() ? 'Hide file names' : 'Show file names', icon: 'heading', group: 'Commands', hint: 'Settings Galleries View', run: () => setShowFileNames(!showFileNamesEnabled()) },
      { id: 'zoom-in', label: 'Make thumbnails larger', icon: 'plusMagnifier', group: 'Commands', hint: 'View Thumbnail size', run: () => setZoom(Number(document.querySelector('#zoom')?.value || 230) + 30) },
      { id: 'zoom-out', label: 'Make thumbnails smaller', icon: 'minusMagnifier', group: 'Commands', hint: 'View Thumbnail size', run: () => setZoom(Number(document.querySelector('#zoom')?.value || 230) - 30) },
      { id: 'zoom-reset', label: 'Reset thumbnail size', icon: 'resetZoom', group: 'Commands', hint: 'View Thumbnail size', run: () => setZoom(230) },
      ...['all', 'image', 'video', 'pdf', 'audio', 'social', 'recipe', 'link', 'other'].map((value, index) => ({
        id: 'type-' + value,
        label: 'Show file type: ' + ['All types', 'Images', 'Videos', 'Documents', 'Audio', 'Social posts', 'Recipes', 'Web links', 'Design & other'][index],
        icon: 'filter', group: 'Commands', hint: 'View File type', run: () => setSelect('#type', value)
      })),
      ...[['new', 'Newest first'], ['old', 'Oldest first'], ['name', 'Name A–Z'], ['size', 'Largest first']].map(([value, label]) => ({
        id: 'sort-' + value, label: 'Sort by: ' + label, icon: 'sort', group: 'Commands', hint: 'View Sort order', run: () => setSelect('#sort', value)
      })),

      // About, extensions and feedback.
      { id: 'updates-check', label: 'Check for updates', icon: 'reload', group: 'Commands', hint: 'Settings About Update', run: () => window.SettingsUI?.checkUpdates() },
      { id: 'licenses', label: 'Third-party notices…', icon: 'about', group: 'Commands', hint: 'Settings About', run: () => { openPane('about'); requestAnimationFrame(() => click('#settings-licenses-toggle')); } },
      { id: 'extension', label: 'Browser capture extension…', icon: 'extensions', group: 'Commands', hint: 'Settings Extensions', run: () => click('#show-extension') },

      // Search and local models.
      { id: 'semantic-toggle', label: isChecked('#settings-semantic') ? 'Turn off semantic search' : 'Turn on semantic search', icon: 'sparkles', group: 'Commands', hint: 'Settings Search & models local AI', run: () => toggleSetting('#settings-semantic') },
      { id: 'visual-model', label: 'Install visual model…', icon: 'sparkles', group: 'Commands', hint: 'Settings Search & models CLIP', run: () => toggleSetting('#settings-visual-model') },
      { id: 'index-pause', label: 'Pause background indexing', icon: 'pauseCircle', group: 'Commands', hint: 'Settings Search & models AI', run: () => api.smartPause(true) },
      { id: 'index-resume', label: 'Resume background indexing', icon: 'playCircle', group: 'Commands', hint: 'Settings Search & models AI', run: () => api.smartPause(false) },
      { id: 'index-idle', label: 'Index only while idle and plugged in', icon: 'retry', group: 'Commands', hint: 'Settings Search & models AI', run: () => api.smartIdlePolicy(true) },
      { id: 'index-anytime', label: 'Index whenever the app is open', icon: 'retry', group: 'Commands', hint: 'Settings Search & models AI', run: () => api.smartIdlePolicy(false) },
      { id: 'index-retry', label: 'Retry failed indexing', icon: 'retry', group: 'Commands', hint: 'Settings Search & models AI', run: () => api.workbench('retry-index') },
      { id: 'model-clip', label: 'Install visual similarity model…', icon: 'sparkles', group: 'Commands', hint: 'Settings Search & models CLIP', run: async () => { const state = await api.modelState('clip'); if (!state.ready) await api.modelDownload('clip'); else openPane('search-models'); } },
      { id: 'model-florence', label: 'Install description model…', icon: 'sparkles', group: 'Commands', hint: 'Settings Search & models Florence', run: async () => { const state = await api.modelState('florence-2'); if (!state.ready) await api.modelDownload('florence-2'); else openPane('search-models'); } }
    ];
    for (const [view, label, icon] of [
      ['all', 'Library', 'archive'], ['favorites', 'Favourites', 'star'],
      ['tags', 'Tags', 'tag'], ['trash', 'Trash', 'trash'],
      ['image', 'Images', 'image'], ['video', 'Videos', 'video'],
      ['audio', 'Audio', 'audio'], ['pdf', 'Documents', 'file'],
      ['link', 'Web links', 'link']
    ]) items.push({ id: 'view-' + view, label: 'Go to ' + label, icon, group: 'Navigate', run: () => setView(view) });

    if ((navStats?.counts.trash || 0) > 0) {
      items.push({ id: 'empty-trash', label: 'Empty Trash…', icon: 'trash', group: 'Actions', run: () => click('#empty-trash') });
    }
    return items;
  }

  function parseQuery(raw) {
    const text = raw.trim();
    const colour = /^(?:color|colour)\s*[:=]?\s*(#[0-9a-f]{3}|#[0-9a-f]{6}|[0-9a-f]{6})$/i.exec(text);
    if (colour) return { query: colour[1].startsWith('#') ? colour[1] : '#' + colour[1], colour: true, tag: false };
    if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(text)) return { query: text, colour: true, tag: false };
    return { query: (text.startsWith('#') ? text.slice(1) : text).trim().toLowerCase(), tag: text.startsWith('#'), colour: false };
  }

  async function fileHits(rawQuery) {
    const { query, tag, colour } = parseQuery(rawQuery);
    if (!query) return [];
    const score = new Map();
    let extra = [];
    try {
      if (query.length >= 2) {
        const ids = await api.smartSearch(query);
        ids.forEach((id, index) => score.set(id, ids.length - index));
        // The gallery can be paged. Pull indexed hits that are not in memory
        // so palette search still covers the whole library.
        const missing = ids.filter(id => !assetById.has(id)).slice(0, 60);
        if (missing.length) extra = await api.captureAssets(missing);
      }
    } catch {}
    const catalog = [...(assets || []), ...extra];
    const seen = new Set();
    const hits = [];
    for (const asset of catalog) {
      if (asset.trash || seen.has(asset.id)) continue;
      seen.add(asset.id);
      const tags = asset.tags || [];
      const text = asset.searchText || SmartCards.enrichSearch(asset);
      let value = score.get(asset.id) || 0;
      if (colour) {
        if (!WorkbenchUI?.colourMatch?.(asset, query)) continue;
        value += 3;
      } else if (tag) {
        if (!tags.some(tag => String(tag).toLowerCase().includes(query))) continue;
        value += 2;
      } else if (text.includes(query)) {
        value = Math.max(value, 1);
        if (asset.name.toLowerCase().includes(query)) value += 2;
        if (tags.some(tag => String(tag).toLowerCase().includes(query))) value += 1;
      }
      if (value) hits.push({ asset, value });
    }
    return hits.sort((a, b) => b.value - a.value).slice(0, 12).map(hit => hit.asset);
  }

  async function build(query) {
    const q = query.toLowerCase();
    if (!q) {
      const quick = ['import', 'new-collection', 'new-canvas', 'duplicate-review', 'shortcuts']
        .map(id => commands().find(item => item.id === id)).filter(Boolean);
      const open = ['view-all', 'view-favorites', 'settings', 'search']
        .map(id => commands().find(item => item.id === id)).filter(Boolean);
      return [
        { header: 'Quick actions', items: quick },
        { header: 'Open', items: open }
      ];
    }

    const sections = [];
    const commandItems = rank(commands(), q);

    if (parseQuery(q).colour) {
      const swatch = el('div', 'command-colours');
      for (const [label, hex] of [['Red', '#e5484d'], ['Orange', '#f76b15'], ['Yellow', '#f5d90a'], ['Green', '#30a46c'], ['Blue', '#0090ff'], ['Purple', '#8e4ec6']]) {
        const chip = el('button', 'command-colour');
        chip.type = 'button';
        chip.title = label + ' · ' + hex;
        chip.setAttribute('aria-label', 'Find files close to ' + label);
        chip.style.background = hex;
        chip.onclick = () => { input.value = hex; paint(); input.focus(); };
        swatch.append(chip);
      }
      sections.push({ header: 'Colours', custom: swatch });
    }

    // Commands come first: the palette is a command surface, so actions stay
    // above the file grid while a query is typed.
    if (commandItems.length) sections.push({ header: 'Commands', items: commandItems });

    const files = await fileHits(q);
    if (files.length) {
      sections.push({ header: 'Files', grid: 'files', items: files.map(asset => ({
        id: 'file-' + asset.id,
        label: asset.name,
        detail: asset.smart?.excerpt || asset.smart?.caption || asset.notes || asset.captureMetadata?.textExcerpt || (asset.tags?.length ? asset.tags.join(', ') : ''),
        asset,
        run: () => window.openPaletteAsset?.(asset) || Promise.resolve()
      })) });
      sections.push({ similar: files[0].id });
    }

    const canvasItems = rank((CanvasWorkspace.boards || []).filter(b => b.name.toLowerCase().includes(q)).map(b => ({
      id: 'canvas-' + b.id, label: b.name, icon: 'canvas', hint: 'Canvas', run: () => CanvasWorkspace.open(b.id)
    })), q);
    if (canvasItems.length) sections.push({ header: 'Canvases', items: canvasItems });

    const folderItems = rank(folders.filter(name => name.toLowerCase().includes(q)).map(name => ({
      id: 'collection-' + name, label: name, icon: 'folder', hint: 'Collection', run: () => setView('folder', name)
    })), q);
    if (folderItems.length) sections.push({ header: 'Collections', items: folderItems });

    const settingsItems = rank([...((window.SettingsUI?.titles || new Map()))].map(([pane, title]) => ({
      id: 'settings-' + pane, label: 'Settings · ' + title, icon: 'settings', hint: 'Settings', run: () => window.SettingsUI.open(pane)
    })), q);
    if (settingsItems.length) sections.push({ header: 'Settings', items: settingsItems });
    return sections;
  }

  function rank(items, query) {
    if (!query) return items.slice();
    return items.map(item => {
      const score = labelScore(item.label, query);
      if (score) return { item, score: score + 1 };
      const words = Array.isArray(item.keywords) ? item.keywords.join(' ') : (item.keywords || '');
      const extra = `${item.hint || ''} ${words}`.toLowerCase();
      return { item, score: extra.includes(query) ? 1 : 0 };
    })
      .filter(entry => entry.score)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .map(entry => entry.item)
      .slice(0, 10);
  }

  function loadSimilar(id, token) {
    api.workbench('similar', { id }).then(ids => {
      if (token !== sequence || !dialog?.open) return;
      const matches = (ids || []).filter(hit => hit.score >= 0.2).map(hit => assetById.get(hit.id)).filter(asset => asset && !asset.trash).slice(0, 8);
      if (!matches.length) return;
      const at = sections.findIndex(section => section.similar === id);
      if (at < 0) return;
      sections[at] = {
        header: 'Visually similar', grid: 'files',
        items: matches.map(asset => ({
          id: 'similar-' + asset.id, label: asset.name, asset,
          run: () => window.openPaletteAsset?.(asset) || Promise.resolve()
        }))
      };
      render();
    }).catch(() => {});
  }

  function fileCard(entry, index) {
    const asset = entry.asset;
    const result = el('div', 'command-result');
    const card = el('button', 'command-card');
    card.type = 'button';
    card.id = 'command-entry-' + index;
    card.dataset.index = String(index);
    card.setAttribute('role', 'option');
    card.setAttribute('aria-label', entry.label);
    card.setAttribute('aria-selected', 'false');
    card.title = entry.detail || entry.label;
    card.append(thumb(asset, 'command-thumb'));
    const foot = el('span', 'command-card-foot');
    foot.append(el('span', 'command-card-name', entry.label));
    result.append(card, foot);
    card.onpointerenter = () => { active = index; mark(); };
    card.onclick = () => run(index);
    return result;
  }

  function mark() {
    if (restoreScroll && list) { list.scrollTop = restoreScroll; restoreScroll = 0; }
    for (const node of list.querySelectorAll('.command-row, .command-card')) {
      node.setAttribute('aria-selected', String(Number(node.dataset.index) === active));
    }
    if (input) {
      if (active >= 0) input.setAttribute('aria-activedescendant', 'command-entry-' + active);
      else input.removeAttribute('aria-activedescendant');
    }
    list.querySelector('.command-row[aria-selected="true"], .command-card[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    // A late async section (visually similar, or a slow file search) must not
    // steal the selection from someone who has already moved down the list.
    // If they have not moved, the first result stays selected: it is the one
    // Enter should run.
    const previous = active > 0 ? entries[active]?.id : null;
    list.replaceChildren();
    entries = [];
    let pendingSimilar = null;
    for (const section of sections) {
      if (section.similar) { pendingSimilar = section.similar; continue; }
      list.append(el('div', 'command-group-title', section.header));
      if (section.custom) { list.append(section.custom); continue; }
      if (section.grid === 'files') {
        const grid = el('div', 'command-grid');
        for (const entry of section.items) {
          const index = entries.length;
          entry.card = true;
          entries.push(entry);
          grid.append(fileCard(entry, index));
        }
        list.append(grid);
        continue;
      }
      for (const entry of section.items) {
        const index = entries.length;
        entries.push(entry);
        const row = el('div', 'command-row');
        row.id = 'command-entry-' + index;
        row.dataset.index = String(index);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        const icon = el('span', 'command-icon');
        icon.append(glyph(entry.icon || 'file', { size: 17 }));
        const text = el('span', 'command-label', entry.label);
        row.append(icon, text);
        if (entry.hint) row.append(el('span', 'command-meta', entry.hint));
        if (entry.keys) row.append(el('kbd', '', entry.keys));
        row.onpointerenter = () => { active = index; mark(); };
        row.onclick = () => run(index);
        list.append(row);
      }
    }
    if (!sections.length || !entries.length && !list.querySelector('.command-grid')) {
      list.append(el('div', 'command-empty', 'Nothing found. Try a file, canvas or command.'));
    }
    const restored = previous ? entries.findIndex(entry => entry.id === previous) : -1;
    active = restored >= 0 ? restored : (entries.length ? 0 : -1);
    mark();
    if (pendingSimilar) loadSimilar(pendingSimilar, sequence);
  }

  function paint(delay = 90) {
    clearTimeout(paintTimer);
    paintTimer = 0;
    pendingPaint = true;
    const current = ++sequence;
    const settle = () => {
      paintTimer = 0;
      build(input.value.trim()).then(items => {
        if (current !== sequence || !dialog?.open) return;
        sections = items;
        pendingPaint = false;
        render();
      }).catch(() => { pendingPaint = false; });
    };
    if (delay > 0) paintTimer = setTimeout(settle, delay);
    else settle();
  }

  function move(delta) {
    if (!entries.length) return;
    const at = active;
    active = at < 0 ? (delta > 0 ? 0 : entries.length - 1) : (at + delta + entries.length) % entries.length;
    mark();
  }

  function run(index) {
    const entry = entries[index];
    if (entry) runEntry(entry);
  }

  function runEntry(entry) {
    if (!dialog?.open) return;
    // The dialog's close event is queued, so an rAF scheduled right now would
    // run before it and the focus restore would steal focus from the action.
    // Attach to close first: the palette's own listener restores focus, then
    // the action runs in the next frame and can focus its own target.
    dialog.addEventListener('close', () => {
      requestAnimationFrame(() => safe(async () => { await entry.run(); }));
    }, { once: true });
    dialog.close();
  }

  function open() {
    if (dialog?.open) {
      input.placeholder = 'Search files, colour, canvases and commands';
      input.setAttribute('aria-label', input.placeholder);
      dialog.setAttribute('aria-label', 'Command palette');
      input.value = '';
      paint();
      input.focus();
      return dialog;
    }
    restoreFocus = document.activeElement;
    dialog = el('dialog', 'command-palette');
    dialog.id = PALETTE_ID;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Command palette');
    const head = el('div', 'command-head');
    const glyphBox = el('span', 'command-search-icon');
    glyphBox.append(glyph('search'));
    input = el('input', 'command-input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Search files, colour, canvases and commands';
    input.setAttribute('aria-label', input.placeholder);
    head.append(glyphBox, input);
    list = el('div', 'command-list');
    list.setAttribute('role', 'listbox');
    const foot = el('div', 'command-foot');
    for (const [key, hint] of [['↑ ↓', 'Move'], ['Return', 'Choose'], ['Esc', 'Close']]) {
      const item = el('span', 'command-foot-item');
      item.append(el('kbd', '', key), document.createTextNode(' ' + hint));
      foot.append(item);
    }
    dialog.append(head, list, foot);
    dialog.addEventListener('close', () => {
      clearTimeout(paintTimer);
      const query = input?.value.trim() || '';
      rememberedQuery = query;
      rememberedAt = query ? Date.now() : 0;
      rememberedScroll = query && list ? list.scrollTop : 0;
      clearTimeout(rememberTimer);
      if (rememberedQuery) rememberTimer = setTimeout(() => {
        rememberedQuery = ''; rememberedAt = 0; rememberedScroll = 0;
      }, 15000);
      if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
      restoreFocus = null;
      dialog?.remove();
      dialog = null;
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    input.addEventListener('input', paint);
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Enter') {
        event.preventDefault();
        if (pendingPaint) { paint(0); return; }
        run(active);
      }
      else if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
      event.stopPropagation();
    });
    // Restore a recent search before the first paint so the same files stay
    // in view when the palette is reopened with ⌘K.
    const fresh = rememberedQuery && Date.now() - rememberedAt < 15000;
    if (fresh) {
      input.value = rememberedQuery;
      restoreScroll = rememberedScroll;
    } else {
      rememberedQuery = ''; rememberedAt = 0; rememberedScroll = 0;
    }
    paint(0);
    input.focus();
    return dialog;
  }

  function close() {
    if (dialog?.open) dialog.close();
  }
  function toggle() {
    if (dialog?.open) close();
    else open();
  }
  document.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Closing a preview here matters: the capture-phase handler would
    // otherwise swallow the app's own handler that closes it.
    if (!dialog?.open && typeof closePreview === 'function' && !$('#preview').hidden) closePreview();
    toggle();
  }, true);

  window.CommandPalette = { open, close, toggle };
})();
