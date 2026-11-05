function noteSpringCheck(label, checked, onChange) {
  const control = el('label', 'note-spring-check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  input.setAttribute('aria-label', label);
  input.onchange = () => onChange(input.checked);

  const namespace = 'http://www.w3.org/2000/svg';
  const tick = document.createElementNS(namespace, 'svg');
  tick.setAttribute('viewBox', '0 0 16 16');
  tick.setAttribute('aria-hidden', 'true');
  const stroke = document.createElementNS(namespace, 'path');
  stroke.setAttribute('d', 'M3.5 8.3 6.5 11.2 12.5 5');
  stroke.setAttribute('pathLength', '1');
  tick.append(stroke);
  control.append(input, tick);
  return control;
}

const NotesWorkspace = (() => {
  const blockTypes = {
    paragraph: 'Paragraph', heading: 'Heading', bullet: 'Bulleted item',
    checklist: 'Checklist item', toggle: 'Toggle', table: 'Table', image: 'Library image', tracker: 'Tracker', reference: 'Link to a page or file'
  };
  const dragType = 'application/x-canvaspro-note';
  let list, note, timer, saving, busy = false, revision = 0, savedRevision = 0;
  let formatTimer, formatOwner, formatHoveredRow, formatPendingRow;
  let coverRevision = 0, dragId, draggedBlock, dropMarker, templateParent;
  const root = () => $('#notes-workspace');
  const status = message => { $('#notes-status').textContent = message; };
  const label = item => item.title.trim() || 'Untitled note';
  const button = (name, run) => {
    const node = el('button', '', name);
    node.type = 'button';
    node.onclick = run;
    return node;
  };
  function picture(item) {
    const img = el('img');
    img.alt = 'Featured image';
    img.decoding = 'async';
    img.src = 'asset://note-cover/' + item.id + '?v=' + coverRevision;
    return img;
  }
  function noteActionsDialog(item) {
    const dialog = el('dialog','note-tracker-dialog');
    dialog.setAttribute('aria-label','Note actions');
    const form = el('form'), input = el('input'), error = el('p','dialog-error');
    input.value = item.emoji;
    input.maxLength = 64;
    input.placeholder = 'Choose or paste an emoji';
    input.setAttribute('aria-label','Note emoji');
    error.setAttribute('role','status');
    let savingEmoji = false;
    async function save(value) {
      if (savingEmoji) return;
      savingEmoji = true;
      try {
        item.emoji = await api.notesEmoji(item.id,value);
        if (note?.id === item.id) note.emoji = item.emoji;
        renderTree();
        dialog.close();
      } catch (failure) {
        error.textContent = failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      } finally { savingEmoji = false; }
    }
    form.onsubmit = event => { event.preventDefault(); save(input.value.trim()); };
    const actions = el('div','dialog-actions');
    const submit = el('button','primary','Save icon');
    submit.type = 'submit';
    if (item.emoji) actions.append(button('Remove icon',()=>save('')));
    actions.append(button('Cancel',()=>dialog.close()),submit);
    const noteActions = el('div','tracker-tools');
    noteActions.append(button('Rename note',()=>{
      dialog.close();
      run(()=>select(item.id)).then(()=>{ if (note?.id===item.id) $('#note-title').select(); });
    }),button('Delete note…',()=>{
      dialog.close();
      deleteNote(item.id);
    }));
    form.append(el('h2','',label(item)),noteActions,input,button('Open Emoji Picker',()=>{
      input.focus();
      safe(()=>api.notesShowEmojiPicker());
    }),error,actions);
    dialog.append(form);
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  }
  function renderTree() {
    const open = view === 'notes';
    if (!list) return;
    const children = new Map();
    for (const item of list) {
      if (!children.has(item.parentId)) children.set(item.parentId,[]);
      children.get(item.parentId).push(item);
    }
    function branch(parentId, depth) {
      return (children.get(parentId)||[]).flatMap(item => {
      const selected = open && note?.id === item.id;
      const entry = button('', () => run(() => select(item.id)));
      entry.className = selected ? 'active' : '';
      if (selected) entry.setAttribute('aria-current', 'page');
      entry.title = label(item);
      entry.style.setProperty('--note-depth', Math.min(depth,5));
      const icon = item.emoji ? el('span','note-emoji',item.emoji) : glyph('file');
      icon.setAttribute('aria-hidden','true');
      entry.append(icon,el('span','',label(item)));
      entry.oncontextmenu = event => {
        event.preventDefault();
        noteActionsDialog(item);
      };
      entry.draggable = true;
      entry.ondragstart = event => {
        dragId = item.id;
        event.dataTransfer.setData(dragType, item.id);
        event.dataTransfer.effectAllowed = 'move';
      };
      entry.ondragend = () => { dragId = null; };
      entry.ondragover = event => {
        if (!dragId || dragId === item.id || list.find(page=>page.id===dragId)?.parentId!==item.parentId) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        entry.classList.add('note-drop-target');
      };
      entry.ondragleave = () => entry.classList.remove('note-drop-target');
      entry.ondrop = event => {
        if (!dragId || list.find(page=>page.id===dragId)?.parentId!==item.parentId) return;
        event.preventDefault();
        event.stopPropagation();
        entry.classList.remove('note-drop-target');
        document.body.classList.remove('dragging');
        const source = dragId;
        if (source !== item.id) run(() => reorder(source, item.id));
      };
      return [entry,...branch(item.id,depth+1)];
      });
    }
    $('#note-pages').replaceChildren(...branch(null,0));
  }
  function show(active) {
    root().hidden = !active;
    document.body.classList.toggle('notes-active', active);
    if (active) $('#view-title').textContent = 'Notes';
    const current = view === 'notes' && active;
    const selected = $('#note-pages [aria-current]');
    if (!current && selected) {
      selected.removeAttribute('aria-current');
      selected.classList.remove('active');
    }
  }
  async function loadList() {
    if (!list) {
      const loaded = await api.notesList();
      list ??= loaded;
    }
    renderTree();
  }
  function enter() {
    if (view !== 'notes') setView('notes');
    $('#notes-tree').open = true;
  }
  function changed() {
    revision++;
    api.notesDirty(true);
    status('Unsaved changes');
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), 350);
  }
  async function flush() {
    clearTimeout(timer);
    if (!note || revision === savedRevision) return;
    if (saving) {
      await saving;
      return flush();
    }
    const snapshotRevision = revision;
    status('Saving…');
    saving = api.notesSave(note.id, { title: note.title, blocks: note.blocks });
    try {
      note.updated = await saving;
      savedRevision = snapshotRevision;
      if (savedRevision === revision) {
        api.notesDirty(false);
        status('Saved');
      }
    } catch (error) {
      status('Couldn’t save. Use Retry save.');
      $('#notes-retry').hidden = false;
      throw error;
    } finally {
      saving = null;
    }
    $('#notes-retry').hidden = true;
  }
  // Serialize page changes so a save can never update a different open draft.
  async function run(fn) {
    if (busy) return;
    busy = true;
    $('#notes-editor').inert = true;
    try { return await fn(); }
    catch (error) { notify(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { busy = false; $('#notes-editor').inert = false; }
  }
  function setNote(item) {
    note = item;
    revision = savedRevision = 0;
    $('#notes-retry').hidden = true;
    status(item ? 'Saved' : '');
    renderTree();
    renderEditor();
  }
  async function select(id) {
    enter();
    await flush();
    await loadList();
    if (id && note?.id !== id) setNote(await api.notesGet(id));
    else if (!note && list.length) setNote(await api.notesGet(list[0].id));
    else renderTree();
  }
  async function reorder(id, target) {
    list = await api.notesReorder(id, target);
    if (note) list.find(item => item.id === note.id).title = note.title;
    renderTree();
    updateMoveButtons();
  }
  function updateMoveButtons() {
    const siblings = list.filter(item=>item.parentId===note?.parentId);
    const position = siblings.findIndex(item => item.id === note?.id);
    $('#note-up').disabled = position <= 0;
    $('#note-down').disabled = position < 0 || position >= siblings.length - 1;
  }
  function movePage(offset) {
    return run(async () => {
      const siblings = list.filter(item=>item.parentId===note.parentId);
      const index = siblings.findIndex(item => item.id === note.id), target = siblings[index + offset];
      if (target) await reorder(note.id, target.id);
    });
  }
  function field(tag, value, name, limit, onInput) {
    const node = el(tag);
    node.value = value;
    node.maxLength = limit;
    node.placeholder = name;
    node.setAttribute('aria-label', name);
    node.oninput = () => { onInput(node.value); changed(); };
    return node;
  }
  function nextEntry(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
    event.preventDefault();
    return !event.repeat;
  }
  function clearBlockMarker() {
    dropMarker?.removeAttribute('data-note-drop');
    dropMarker = null;
  }
  function moveBlock(from, to, dragged = false) {
    if (from === to) return;
    const rows = $('#note-blocks').children;
    const animate = dragged && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = Math.min(from, to), last = Math.max(from, to);
    const positions = new Map();
    if (animate) {
      for (let index = first; index <= last; index++) {
        positions.set(note.blocks[index], rows[index].getBoundingClientRect().top);
      }
    }
    const [block] = note.blocks.splice(from, 1);
    note.blocks.splice(to, 0, block);
    changed();
    // Only these rows have changed indices. Other blocks keep their DOM and state.
    for (let index = first; index <= last; index++) {
      rows[index].replaceWith(blockNode(note.blocks[index], index));
    }
    if (animate) {
      const offsets = note.blocks.slice(first, last + 1).map((item, index) =>
        positions.get(item) - rows[first + index].getBoundingClientRect().top);
      offsets.forEach((offset, index) => {
        if (offset) rows[first + index].animate(
          [{ transform: 'translateY(' + offset + 'px)' }, { transform: 'translateY(0)' }],
          { duration: 150, easing: 'cubic-bezier(.23,1,.32,1)' }
        );
      });
    }
    rows[to].querySelector('summary').focus({ preventScroll: true });
  }
  function enableBlockDrag(row, grip, index) {
    grip.draggable = true;
    grip.ondragstart = event => {
      draggedBlock = index;
      event.dataTransfer.setData(dragType, 'block');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setDragImage(row, 20, 14);
    };
    grip.ondragend = () => { draggedBlock = undefined; clearBlockMarker(); };
    row.ondragover = event => {
      if (draggedBlock === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      if (dropMarker !== row) clearBlockMarker();
      dropMarker = row;
      const bounds = row.getBoundingClientRect();
      row.dataset.noteDrop = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
    };
    row.ondragleave = event => {
      if (dropMarker === row && !row.contains(event.relatedTarget)) clearBlockMarker();
    };
    row.ondrop = event => {
      if (draggedBlock === undefined || dropMarker !== row) return;
      event.preventDefault();
      event.stopPropagation();
      const from = draggedBlock;
      const boundary = index + Number(row.dataset.noteDrop === 'after');
      draggedBlock = undefined;
      clearBlockMarker();
      moveBlock(from, boundary - Number(from < boundary), true);
    };
  }
  function tableBlock(block, index) {
    const wrapper = el('div', 'notes-table-wrap'), table = el('table');
    const head = table.createTHead(), body = table.createTBody();
    block.rows.forEach((row, r) => {
      const line = (r ? body : head).insertRow();
      row.forEach((value, c) => {
        const cell = el(r ? 'td' : 'th');
        if (!r) cell.scope = 'col';
        const input = field('textarea', value, r ? 'Row '+r+', '+(block.rows[0][c] || 'column '+(c+1)) : 'Column '+(c+1), 1000, next => { row[c] = next; });
        input.onkeydown = event => {
          if (!nextEntry(event) || block.rows.length >= 100) return;
          block.rows.splice(r + 1, 0, row.map(() => ''));
          redrawBlock(index);
          $('#note-blocks').children[index].querySelector('table').rows[r + 1].cells[0].firstChild.focus();
        };
        cell.append(input);
        line.append(cell);
      });
      if (r) {
        const remove = button('×', () => { block.rows.splice(r, 1); redrawBlock(index); });
        remove.setAttribute('aria-label', 'Remove row '+r);
        line.insertCell().append(remove);
      }
    });
    const controls = el('div', 'notes-table-actions');
    const addRow = button('Add row', () => { block.rows.push(block.rows[0].map(() => '')); redrawBlock(index); });
    addRow.disabled = block.rows.length >= 100;
    const addColumn = button('Add column', () => { block.rows.forEach(row => row.push('')); redrawBlock(index); });
    addColumn.disabled = block.rows[0].length >= 8;
    const removeColumn = button('Remove last column', () => { block.rows.forEach(row => row.pop()); redrawBlock(index); });
    removeColumn.disabled = block.rows[0].length <= 1;
    const convert = button('Convert to tracker…',()=>run(async()=>{
      if (!window.confirm('Convert this table? The first column becomes the record title and remaining columns become text fields.')) return;
      await flush();
      const updated = await api.noteTracker('convert',note.id,null,index);
      note.blocks = updated.blocks;
      renderBlocks();
    }));
    controls.append(addRow, addColumn, removeColumn, convert);
    wrapper.append(table, controls);
    return wrapper;
  }
  function nextBlock(block) {
    if (block.type === 'tracker') return {...structuredClone(block),id:crypto.randomUUID()};
    if (block.type === 'table') return {type:'table',rows:[block.rows[0].slice(),block.rows[0].map(()=> '')]};
    if (block.type === 'image' || block.type === 'reference') return {...block};
    const next = {...block,text:''};
    if (block.type === 'checklist') next.checked = false;
    if (block.type === 'toggle') next.body = '';
    return next;
  }
  function insertNext(index, block, selector = 'textarea,input:not([type="checkbox"])') {
    if (note.blocks.length >= 250) return;
    note.blocks.splice(index + 1,0,block);
    changed();
    renderBlocks();
    const row = $('#note-blocks').children[index + 1];
    const input = row.querySelector(selector);
    (input || row).focus();
    if (input?.setSelectionRange) input.setSelectionRange(0,0);
  }
  function splitOnEnter(input, block, index, property, selector) {
    input.onkeydown = event => {
      if (!nextEntry(event) || note.blocks.length >= 250) return;
      const next = block.type === 'heading' ? {type:'paragraph',text:''} : nextBlock(block);
      next[property] = input.value.slice(input.selectionEnd);
      block[property] = input.value.slice(0,input.selectionStart);
      insertNext(index,next,selector);
    };
  }
  function setFormatOwner(row) {
    formatOwner = row;
    document.querySelectorAll('.note-format-toolbar').forEach(toolbar => {
      toolbar.classList.toggle('is-visible',toolbar.closest('.note-block') === row);
    });
  }
  function scheduleFormatToolbar(row) {
    clearTimeout(formatTimer);
    formatPendingRow = row;
    setFormatOwner(null);
    formatTimer = setTimeout(() => {
      if (formatPendingRow !== row || formatHoveredRow !== row || !row.isConnected) return;
      formatPendingRow = null;
      setFormatOwner(row);
    },600);
  }
  function focusFormatToolbar(row) {
    clearTimeout(formatTimer);
    formatPendingRow = null;
    setFormatOwner(row);
  }
  function leaveFormatToolbar(row, relatedTarget) {
    if (relatedTarget && row.contains(relatedTarget)) return;
    if (formatHoveredRow === row) formatHoveredRow = null;
    if (formatPendingRow === row) {
      clearTimeout(formatTimer);
      formatPendingRow = null;
    }
    if (formatOwner === row && !row.contains(document.activeElement)) setFormatOwner(null);
  }
  function focusBlock(index) {
    const row = $('#note-blocks').children[index];
    const input = row?.querySelector('textarea,input:not([type="checkbox"])');
    (input || row)?.focus();
  }
  function removeBlock(index) {
    const block = note.blocks[index];
    if (!block) return;
    if (block.type === 'tracker' && !window.confirm('Remove this tracker and all its records?')) return;
    note.blocks.splice(index, 1);
    if (!note.blocks.length) note.blocks.push({type:'paragraph',text:''});
    changed();
    renderBlocks();
    focusBlock(Math.min(index,note.blocks.length-1));
  }
  function showBlockPicker(index, replace = false) {
    if (note.blocks.length >= 250 && !replace) return;
    const dialog = el('dialog','note-tracker-dialog');
    dialog.setAttribute('aria-label','Insert a block');
    const search = el('input');
    search.placeholder = 'Find a block…';
    search.setAttribute('aria-label','Find a block');
    const choices = el('div','tracker-reference-results');
    function update() {
      choices.replaceChildren(...Object.entries(blockTypes)
        .filter(([,name])=>name.toLowerCase().includes(search.value.toLowerCase()))
        .map(([type,name])=>button(name,()=>{dialog.close();addBlock(type,index,replace); })));
    }
    search.oninput = update;
    search.onkeydown = event=>{if(event.key==='Enter'){event.preventDefault();choices.firstChild?.click();}};
    dialog.append(search,choices,button('Cancel',()=>dialog.close()));
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});
    document.body.append(dialog);
    update();
    dialog.showModal();
    search.focus();
  }
  function headingSettings(block, input, actions) {
    const size = el('input');
    size.type = 'number';
    size.min = 12;
    size.max = 72;
    size.step = 1;
    size.value = block.fontSize || 21;
    size.setAttribute('aria-label','Heading size');
    const color = el('input');
    color.type = 'color';
    color.setAttribute('aria-label','Heading color');
    function paint() {
      input.style.fontSize = block.fontSize ? block.fontSize+'px' : '';
      input.style.color = block.color || '';
      color.value = block.color || getComputedStyle(document.body).getPropertyValue('--text').trim();
    }
    size.onchange = () => {
      if (!size.value || !size.checkValidity()) { size.value = block.fontSize || 21; return; }
      block.fontSize = size.valueAsNumber;
      paint();
      changed();
    };
    color.oninput = () => {
      block.color = color.value;
      input.style.color = block.color;
      changed();
    };
    const sizeLabel = el('label','note-heading-setting','Size');
    const colorLabel = el('label','note-heading-setting','Color');
    sizeLabel.append(size);
    colorLabel.append(color);
    actions.append(sizeLabel,colorLabel,button('Reset heading style',()=>{
      delete block.fontSize;
      delete block.color;
      size.value = 21;
      paint();
      changed();
    }));
    paint();
  }
  function applyTextStyle(block, input) {
    input.style.textAlign = block.align || 'left';
    input.style.fontWeight = block.bold ? '700' : '';
  }
  function formatToolbar(block, index, input) {
    const toolbar = el('div', 'note-format-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Text formatting');
    const type = el('select');
    type.setAttribute('aria-label', 'Text style');
    type.append(new Option('Paragraph', 'paragraph'));
    for (let level = 1; level <= 6; level++) type.append(new Option('Heading ' + level, 'heading-' + level));
    type.value = block.type === 'heading' ? 'heading-' + (block.headingLevel || 2) : 'paragraph';
    type.onchange = () => {
      if (type.value === 'paragraph') {
        block.type = 'paragraph';
        delete block.headingLevel;
      } else {
        block.type = 'heading';
        block.headingLevel = Number(type.value.slice(-1));
        // A heading level is a semantic default; preserve any user-set size.
        if (!block.fontSize) block.fontSize = [0, 32, 27, 23, 20, 18, 16][block.headingLevel];
      }
      redrawBlock(index);
      const replacement = $('#note-blocks').children[index]?.querySelector('textarea,input:not([type="checkbox"])');
      replacement?.focus();
    };
    const bold = button('B', () => {
      block.bold = !block.bold;
      bold.setAttribute('aria-pressed', String(Boolean(block.bold)));
      applyTextStyle(block, input);
      changed();
    });
    bold.className = 'note-format-bold';
    bold.setAttribute('aria-label', 'Bold');
    bold.setAttribute('aria-pressed', String(Boolean(block.bold)));
    const alignment = el('div', 'note-format-align');
    for (const [value, name, glyph] of [['left', 'Align left', '≡'], ['center', 'Align center', '≡'], ['right', 'Align right', '≡']]) {
      const control = button(glyph, () => {
        block.align = value;
        alignment.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.align === value)));
        applyTextStyle(block, input);
        changed();
      });
      control.dataset.align = value;
      control.className = 'note-format-' + value;
      control.setAttribute('aria-label', name);
      control.setAttribute('aria-pressed', String((block.align || 'left') === value));
      alignment.append(control);
    }
    toolbar.append(type, bold, alignment);
    return toolbar;
  }
  function blockNode(block, index) {
    const row = el('div', 'note-block note-block-'+block.type), content = el('div', 'note-block-content');
    const embedded = ['tracker','reference','table','image'].includes(block.type);
    let toolbar;
    let heading;
    if (embedded) {
      row.tabIndex = 0;
      row.setAttribute('aria-label',blockTypes[block.type]+' block');
      row.onkeydown = event => {
        if (event.target===row && !event.metaKey && !event.ctrlKey && !event.altKey &&
            ['Backspace','Delete'].includes(event.key)) {
          event.preventDefault();
          if (!event.repeat) removeBlock(index);
          return;
        }
        if (event.target===row && nextEntry(event)) insertNext(index,nextBlock(block),':scope > .note-block-content > input');
      };
    }
    if (block.type === 'tracker') content.append(NoteTrackers.mount(block,note.id,changed,flush));
    else if (block.type === 'reference') content.append(button('↗ '+block.label,()=>safe(()=>{
      if (block.kind==='note') return run(()=>select(block.id));
      if (block.kind==='canvas') return CanvasWorkspace.open(block.id);
      return api.openFile(block.id);
    })));
    else if (block.type === 'table') content.append(tableBlock(block, index));
    else if (block.type === 'image') {
      const img = el('img', 'note-inline-image');
      img.src = 'asset://preview/' + block.assetId;
      img.alt = block.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = () => img.replaceWith(el('p', 'hint', 'Image unavailable: ' + block.name));
      content.append(img);
    }
    else {
      const input = field(block.type === 'heading' ? 'input' : 'textarea', block.text, blockTypes[block.type], 20000, next => { block.text = next; });
      splitOnEnter(input,block,index,'text');
      if (block.type === 'heading') heading = input;
      if (block.type === 'paragraph') input.placeholder = 'Write here. Type / for blocks or @ for links.';
      if (block.type === 'heading' || block.type === 'paragraph') applyTextStyle(block, input);
      if (block.type === 'toggle') {
        const detail = el('div', 'note-toggle'), toggle = button(block.open ? '▾' : '▸', () => {
          block.open = !block.open;
          toggle.textContent = block.open ? '▾' : '▸';
          toggle.setAttribute('aria-expanded', String(block.open));
          body.hidden = !block.open;
          changed();
        });
        const body = field('textarea', block.body, 'Toggle content', 20000, next => { block.body = next; });
        splitOnEnter(body,block,index,'body',':scope > .note-block-content > textarea');
        body.hidden = !block.open;
        toggle.setAttribute('aria-label', 'Toggle content');
        toggle.setAttribute('aria-expanded', String(block.open));
        detail.append(toggle, input);
        content.append(detail, body);
      } else {
        if (block.type === 'bullet') {
          const bullet = el('span', 'note-bullet', '•');
          bullet.setAttribute('aria-hidden', 'true');
          content.append(bullet);
        }
        if (block.type === 'checklist') {
          content.append(noteSpringCheck('Mark checklist item complete', block.checked, checked => {
            block.checked = checked;
            changed();
          }));
        }
        content.append(input);
      }
    }
    const controls = el('details', 'note-block-actions'), summary = el('summary', '', '⠿');
    summary.title = 'Drag to move or click for block actions';
    summary.setAttribute('aria-label', 'Actions for '+blockTypes[block.type].toLowerCase());
    controls.append(summary);
    const actions = el('div');
    if (heading) headingSettings(block,heading,actions);
    const add = button('Add another block',()=>insertNext(index,nextBlock(block),embedded?':scope > .note-block-content > input':undefined));
    add.disabled = note.blocks.length >= 250;
    actions.append(add);
    for (const [name, offset] of [['Move up', -1], ['Move down', 1]]) {
      const move = button(name, () => moveBlock(index, index + offset));
      move.disabled = !note.blocks[index + offset];
      actions.append(move);
    }
    actions.append(button('Remove block', () => removeBlock(index)));
    controls.append(actions);
    enableBlockDrag(row, summary, index);
    if (block.type === 'heading' || block.type === 'paragraph') {
      toolbar = formatToolbar(block, index, content.querySelector('textarea,input'));
      row.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        formatHoveredRow = row;
        scheduleFormatToolbar(row);
      });
      row.addEventListener('pointerleave', event => leaveFormatToolbar(row,event.relatedTarget));
      row.addEventListener('focusin', () => focusFormatToolbar(row));
      row.addEventListener('focusout', event => {
        if (!row.contains(event.relatedTarget) && formatHoveredRow !== row && formatOwner === row) setFormatOwner(null);
      });
      row.append(toolbar, content, controls);
    }
    else row.append(content, controls);
    return row;
  }
  function redrawBlock(index) {
    changed();
    $('#note-blocks').children[index].replaceWith(blockNode(note.blocks[index], index));
  }
  function renderBlocks() {
    $('#note-blocks').replaceChildren(...note.blocks.map(blockNode));
    $('#note-add-paragraph').disabled = note.blocks.length >= 250;
  }
  function renderCover() {
    $('#note-cover').replaceChildren(...(note.hasCover ? [picture(note)] : []));
    $('#note-cover').hidden = !note.hasCover;
    $('#note-cover-add').textContent = note.hasCover ? 'Change featured image' : 'Add featured image';
    $('#note-cover-remove').hidden = !note.hasCover;
  }
  function renderEditor() {
    $('#notes-empty').hidden = !!note;
    $('#notes-editor').hidden = !note;
    if (!note) return;
    $('.notes-page-menu').open = false;
    const trail = [];
    for (let parent = list.find(item=>item.id===note.parentId); parent; parent=list.find(item=>item.id===parent.parentId)) {
      const id = parent.id;
      trail.unshift(button(label(parent),()=>run(()=>select(id))));
    }
    $('#note-breadcrumbs').replaceChildren(...trail);
    $('#note-breadcrumbs').hidden = !trail.length;
    $('#note-title').value = note.title;
    renderCover();
    renderBlocks();
    updateMoveButtons();
    root().scrollTop = 0;
  }
  function pickImage(allowLocal, importThumbnail = false, title = 'Choose a library image') {
    const dialog = $('#note-image-dialog'), search = $('#note-image-search');
    const results = $('#note-image-results'), more = $('#note-image-more'), message = $('#note-image-status');
    const browse = $('#note-image-browse');
    const cancel = $('#note-image-cancel');
    let generation = 0, offset = 0, total = 0, timer, selection = null, importingImage = false;
    async function load(append = false) {
      const request = ++generation;
      more.hidden = true;
      if (!append) {
        offset = 0;
        results.replaceChildren();
      }
      message.textContent = 'Loading images…';
      try {
        const page = await api.libraryPage({ extensions: imageExt, query: search.value.trim(), offset, limit: 48 });
        if (request !== generation || !dialog.open) return;
        for (const asset of page.assets) {
          const choice = button('', () => { selection = asset; dialog.close(); });
          const img = el('img');
          img.alt = '';
          img.src = 'asset://thumb/' + asset.id;
          img.loading = 'lazy';
          img.decoding = 'async';
          choice.append(img, el('span', '', asset.name));
          choice.title = asset.name;
          results.append(choice);
        }
        total = page.total ?? total;
        offset += page.assets.length;
        more.hidden = offset >= total || !page.assets.length;
        message.textContent = offset ? '' : 'No images found in this library.';
      } catch {
        if (request === generation && dialog.open) message.textContent = 'Couldn’t load library images.';
      }
    }
    $('#note-image-title').textContent = title;
    search.value = '';
    search.oninput = () => {
      generation++;
      clearTimeout(timer);
      results.replaceChildren();
      more.hidden = true;
      timer = setTimeout(load, 160);
    };
    more.onclick = () => load(true);
    browse.hidden = !allowLocal && !importThumbnail;
    browse.textContent = importThumbnail ? 'Import from Downloads…' : 'Choose from Mac…';
    browse.onclick = async () => {
      if (!importThumbnail) { selection = 'mac'; dialog.close(); return; }
      importingImage = true;
      generation++;
      clearTimeout(timer);
      search.disabled = results.inert = more.disabled = browse.disabled = cancel.disabled = true;
      message.textContent = 'Choose an image to add to All files.';
      try {
        const asset = await api.noteImportThumbnail(imageExt);
        if (asset) {
          selection = asset;
          safe(() => refreshCaptured([asset.id]));
          dialog.close();
        } else load();
      } catch (error) {
        message.textContent = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      } finally {
        importingImage = false;
        search.disabled = results.inert = more.disabled = browse.disabled = cancel.disabled = false;
      }
    };
    cancel.onclick = () => dialog.close();
    dialog.oncancel = event => { if (importingImage) event.preventDefault(); };
    return new Promise(resolve => {
      dialog.addEventListener('close', () => { clearTimeout(timer); resolve(selection); }, { once: true });
      dialog.showModal();
      search.focus();
      load();
    });
  }
  function cover(remove, asset = null, targetId = null) {
    return run(async () => {
      if (targetId && (view !== 'notes' || note?.id !== targetId)) return false;
      const selection = asset || (remove ? true : await pickImage(true));
      if (!selection) return;
      const source = selection === true ? true : selection === 'mac' ? false : selection.id;
      const result = await api.notesCover(note.id, source);
      if (result === null) return;
      note.hasCover = result;
      list.find(item => item.id === note.id).hasCover = result;
      coverRevision++;
      renderCover();
      renderTree();
      return true;
    });
  }
  function init() {
    $('#notes-editor').addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z' ||
          !event.target.matches('input:not([type="checkbox"]),textarea,[contenteditable="true"]')) return;
      event.preventDefault();
      document.execCommand(event.shiftKey ? 'redo' : 'undo');
    });
    $('#notes-tree').ontoggle = () => { if ($('#notes-tree').open) safe(loadList); };
    $('#note-template-form').onsubmit = event => {
      event.preventDefault();
      run(async () => {
        await flush();
        const item = await api.notesCreate($('#note-template').value, templateParent);
        list = await api.notesList();
        enter();
        setNote(item);
        $('#note-template-dialog').close();
        return true;
      }).then(created => { if (created) $('#note-title').select(); });
    };
    for (const id of ['new-note', 'new-note-empty']) {
      $('#'+id).onclick = () => { templateParent = null; $('#note-template-dialog').showModal(); };
    }
    $('#note-child').onclick = () => {
      templateParent = note.id;
      $('.notes-page-menu').open = false;
      $('#note-template-dialog').showModal();
    };
    $('#note-template-cancel').onclick = () => $('#note-template-dialog').close();
    $('#note-title').oninput = event => {
      note.title = event.target.value;
      list.find(item => item.id === note.id).title = note.title;
      const entry = $('#note-pages [aria-current]');
      if (entry) { entry.title = label(note); entry.lastChild.textContent = label(note); }
      changed();
    };
    $('#notes-retry').onclick = () => safe(flush);
    $('#note-up').onclick = () => movePage(-1);
    $('#note-down').onclick = () => movePage(1);
    $('#note-cover-add').onclick = () => cover(false);
    $('#note-cover-remove').onclick = () => cover(true);
    $('#note-delete').onclick = () => deleteNote(note.id);
    $('#note-add-paragraph').onclick = () => addBlock('paragraph',note.blocks.length);
    $('#note-insert-block').onclick = () => showBlockPicker(note.blocks.length);
    $('#note-insert-link').onclick = () => addBlock('reference',note.blocks.length);
    $('#note-blocks').addEventListener('keydown',event=>{
      if (!event.isComposing && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey &&
          ['Backspace','Delete'].includes(event.key) &&
          event.target.matches('.note-block textarea,.note-block input:not([type="checkbox"]):not([type="color"]):not([type="number"])') &&
          !event.target.closest('.notes-table-wrap,.note-tracker') &&
          event.target.value === '' && event.target.selectionStart === 0 && event.target.selectionEnd === 0) {
        event.preventDefault();
        removeBlock([...$('#note-blocks').children].indexOf(event.target.closest('.note-block')));
        return;
      }
      if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
          !event.target.matches('.note-block-paragraph textarea') || event.target.value || !['/','@'].includes(event.key)) return;
      event.preventDefault();
      const index = [...$('#note-blocks').children].indexOf(event.target.closest('.note-block'));
      if (event.key==='@') { addBlock('reference',index,true); return; }
      showBlockPicker(index,true);
    });
  }
  function deleteNote(id) {
    return run(async()=>{
      await flush();
      if (!await api.notesRemove(id)) return;
      const index = list.findIndex(item=>item.id===id);
      list = await api.notesList();
      if (note?.id!==id) { renderTree(); return; }
      setNote(null);
      const next = list[Math.min(index,list.length-1)];
      if (next) setNote(await api.notesGet(next.id));
    });
  }
  function addBlock(type, index, replace = false) {
    return run(async()=>{
      if (!replace && note.blocks.length>=250) return;
      const asset = type === 'image' ? await pickImage(false) : null;
      const reference = type === 'reference' ? await NoteTrackers.pickReference({notes:list}) : null;
      if (type==='image'&&!asset || type==='reference'&&!reference) return;
      let block;
      if (asset) block = {type,assetId:asset.id,name:asset.name.slice(0,500)};
      else if (reference) block = {type,...reference};
      else if (type==='tracker') block = await api.noteTracker('new');
      else if (type==='table') block = {type,rows:[['Column 1','Column 2'],['','']]};
      else block = {type,text:'',...(type==='toggle'?{body:'',open:true}:{})};
      note.blocks.splice(index,Number(replace),block);
      changed();
      renderBlocks();
      return true;
    }).then(added=>{
      if (!added) return;
      const row = $('#note-blocks').children[index];
      (row?.querySelector('textarea,input:not([type="checkbox"])') || row?.querySelector('button'))?.focus();
    });
  }

  function assistantWrite(title, target = null) {
    return run(async () => {
      await flush();
      if (target) {
        if (view !== 'notes' || note?.id !== target.id || note.title !== target.title) return false;
        note.title = title;
        list.find(item => item.id === note.id).title = title;
        changed();
        await flush();
        renderTree();
        $('#note-title').value = title;
      } else {
        const item = await api.notesCreate('blank', null, title);
        list = await api.notesList();
        enter();
        setNote(item);
      }
      return true;
    });
  }

  return {
    init, show, flush, pickThumbnail: title => pickImage(false, true, title),
    open: id => run(async () => { await select(id); return note?.id === id; }),
    active: () => view === 'notes' && note ? { id: note.id, title: note.title } : null,
    assistantWrite, setCoverFromLibrary: (id, assetId) => cover(false, { id: assetId }, id)
  };
})();
