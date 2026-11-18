// One ⌘K surface for commands, navigation and everything in the library.
// Results are assembled from the app's own indexes: the local smart index
// (which already knows names, tags, notes and AI captions), the live catalog,
// canvases, notes and collections. File hits are shown as a grid of previews,
// with a second grid of visually similar frames when a vector is available.
(() => {
  'use strict';

  const PALETTE_ID = 'command-palette';
  const SHORTCUTS = [
    ['Open command palette', '⌘ K'],
    ['Search the library', '⌘ F'],
    ['Keyboard shortcuts', '⌘ /'],
    ['Undo file / canvas change', '⌘ Z'],
    ['Redo', '⇧ ⌘ Z'],
    ['Toggle sidebar', '⌘ B / ⌘ S'],
    ['Toggle file details', '⌘ I'],
    ['Open Settings', '⌘ ,'],
    ['Import files', '⌘ O'],
    ['Select all', '⌘ A'],
    ['Extend selection', '⇧ + arrow'],
    ['Toggle individual selection', '⌘ + click'],
    ['Copy / paste', '⌘ C / ⌘ V'],
    ['Trash selection', '⌘ Delete'],
    ['Preview / close', 'Space / Escape'],
    ['Navigate the library', 'Arrow keys'],
    ['Canvas select / hand / text', 'V / H / T'],
    ['Canvas rectangle / ellipse', 'R / O'],
    ['Canvas fit', '⌘ 0'],
    ['Pan canvas', 'Space + drag'],
    ['Palette: move / choose / close', '↑ ↓ · Return · Esc']
  ];

  let dialog = null;
  let input = null;
  let list = null;
  let mode = 'commands';
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
  let notesPromise = null;
  let restoreFocus = null;

  const click = selector => document.querySelector(selector)?.click();
  const labelScore = (label, query) => {
    const text = String(label).toLowerCase();
    const at = text.indexOf(query);
    if (at < 0) return 0;
    return at === 0 ? 2 : 1;
  };

  function commands() {
    const items = [
      { id: 'import', label: 'Import files…', icon: 'importing', keys: '⌘ O', group: 'Actions', run: () => click('#import') },
      { id: 'import-folder', label: 'Import folder…', icon: 'folder', group: 'Actions', run: () => click('#import-folder') },
      { id: 'new-collection', label: 'New collection', icon: 'folder', group: 'Actions', run: () => SidebarUI.inlineCreate('collections') },
      { id: 'new-note', label: 'New note', icon: 'pencil', group: 'Actions', run: () => SidebarUI.inlineCreate('notes') },
      { id: 'new-canvas', label: 'New canvas…', icon: 'canvas', group: 'Actions', run: () => click('#add-canvas') },
      { id: 'duplicate-review', label: 'Duplicate review…', icon: 'search', group: 'Actions', run: () => click('#settings-duplicate-review') },
      { id: 'backup', label: 'Back up library…', icon: 'export', group: 'Actions', run: () => click('#settings-backup') },
      { id: 'health', label: 'Library health…', icon: 'health', group: 'Actions', run: () => click('#check-library') },
      { id: 'activity', label: 'Import activity…', icon: 'activity', group: 'Actions', run: () => click('#show-activity') },
      { id: 'search', label: 'Search the library', icon: 'search', keys: '⌘ F', group: 'Actions', run: () => { if (view !== 'all') setView('all'); $('#search').focus(); } },
      { id: 'sidebar', label: 'Toggle sidebar', icon: 'sidebar', keys: '⌘ B', group: 'View', run: () => click('#toggle-sidebar') },
      { id: 'inspector', label: 'Toggle file details', icon: 'sidebar', keys: '⌘ I', group: 'View', run: () => click('#toggle-inspector') },
      { id: 'settings', label: 'Open Settings', icon: 'settings', keys: '⌘ ,', group: 'View', run: () => click('#show-settings') },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', keys: '⌘ /', group: 'View', run: () => open('shortcuts') },
      { id: 'appearance-light', label: 'Use light appearance', icon: 'appearance', group: 'View', run: () => api.appearanceSet({ theme: 'light' }) },
      { id: 'appearance-dark', label: 'Use dark appearance', icon: 'appearance', group: 'View', run: () => api.appearanceSet({ theme: 'dark' }) },
      { id: 'appearance-system', label: 'Use system appearance', icon: 'appearance', group: 'View', run: () => api.appearanceSet({ theme: 'system' }) }
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

  function shortcutItems() {
    return SHORTCUTS.map(([label, keys], index) => ({
      id: 'shortcut-' + index, label, keys, icon: 'keyboard', group: 'Shortcuts', run: () => {}
    }));
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
    if (mode === 'shortcuts') {
      const items = rank(shortcutItems(), query.toLowerCase());
      return items.length ? [{ header: 'Shortcuts', items }] : [];
    }
    const q = query.toLowerCase();
    if (!q) {
      const quick = ['import', 'new-collection', 'new-note', 'new-canvas', 'duplicate-review', 'shortcuts']
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

    try {
      notesPromise ||= api.notesList().catch(() => []);
      const notes = await notesPromise;
      const noteItems = rank(notes.filter(n => (n.title || 'Untitled note').toLowerCase().includes(q)).map(n => ({
        id: 'note-' + n.id, label: n.title || 'Untitled note', icon: 'pencil', hint: 'Note', run: () => NotesWorkspace.open(n.id)
      })), q);
      if (noteItems.length) sections.push({ header: 'Notes', items: noteItems });
    } catch {}

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
    return items.map(item => ({ item, score: labelScore(item.label, query) }))
      .filter(entry => entry.score)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .map(entry => entry.item)
      .slice(0, 10);
  }

  function loadSimilar(id, token) {
    api.workbench('similar', { id }).then(ids => {
      if (token !== sequence || !dialog?.open) return;
      const matches = (ids || []).map(hit => assetById.get(hit.id)).filter(asset => asset && !asset.trash).slice(0, 8);
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
        icon.append(glyph(entry.icon || 'file'));
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
      list.append(el('div', 'command-empty', mode === 'shortcuts' ? 'No matching shortcuts.' : 'Nothing found. Try a file, note, canvas or command.'));
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

  function open(nextMode = 'commands') {
    notesPromise = null;
    mode = nextMode === 'shortcuts' ? 'shortcuts' : 'commands';
    if (dialog?.open) {
      const placeholder = mode === 'shortcuts' ? 'Find a shortcut' : 'Search files, colour, notes, canvases and commands';
      input.placeholder = placeholder;
      input.setAttribute('aria-label', placeholder);
      dialog.setAttribute('aria-label', mode === 'shortcuts' ? 'Keyboard shortcuts' : 'Command palette');
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
    dialog.setAttribute('aria-label', mode === 'shortcuts' ? 'Keyboard shortcuts' : 'Command palette');
    const head = el('div', 'command-head');
    const glyphBox = el('span', 'command-search-icon');
    glyphBox.append(glyph('search'));
    input = el('input', 'command-input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = mode === 'shortcuts' ? 'Find a shortcut' : 'Search files, colour, notes, canvases and commands';
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
      rememberedQuery = mode === 'commands' ? query : '';
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
    if (fresh && mode === 'commands') {
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
    else open('commands');
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

  window.CommandPalette = { open, close, toggle, shortcuts: () => open('shortcuts'), SHORTCUTS };
})();
