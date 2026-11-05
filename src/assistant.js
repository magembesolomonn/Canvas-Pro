(() => {
  const panel = $('#assistant-panel');
  const launcher = $('#assistant-launcher');
  const eyes = launcher.querySelector('.assistant-eyes');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const settings = $('#assistant-settings');
  const field = $('#assistant-command');
  const form = $('#assistant-form');
  const message = $('#assistant-message');
  const review = $('#assistant-review');
  const download = $('#assistant-download');
  const progress = $('#assistant-progress');
  let pending, timer, busy = false, stopped = false;

  function describeError(error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  function clearReview() {
    pending = null;
    review.hidden = true;
  }

  function setBusy(value, canStop = false) {
    busy = value;
    field.readOnly = value;
    $('#assistant-submit').disabled = value;
    $('#assistant-submit').setAttribute('aria-label', value && canStop ? 'Working' : 'Send command');
    $('#assistant-stop').hidden = !value || !canStop;
    $('#assistant-apply').disabled = value;
  }

  function refresh(state) {
    clearTimeout(timer);
    const { status, total, received, folder, error } = state;
    const ready = status === 'ready';
    const downloading = status === 'downloading';
    const size = Math.round(total / 1000000);
    const percent = total ? Math.floor(100 * received / total) : 0;
    $('#assistant-path').textContent = folder;
    progress.hidden = !downloading;
    progress.max = total || 1;
    progress.value = received;
    download.hidden = ready || status === 'unsupported';
    download.disabled = false;
    download.textContent = downloading ? 'Cancel download' : error ? 'Retry download' : 'Download';
    $('#assistant-install-status').textContent = ready ? 'Installed on this Mac.' :
      status === 'unsupported' ? 'This Mac cannot run the local assistant.' :
      downloading ? (percent >= 100 ? 'Verifying and installing…' : 'Downloading… ' + percent + '%') :
      error || ('Optional download · ' + size + ' MB');
    form.hidden = !ready;
    $('#assistant-setup').hidden = ready || status === 'unsupported';
    if (!ready) message.textContent = downloading ? 'The model is downloading.' :
      status === 'unsupported' ? 'The local assistant is unavailable on this Mac.' :
      'Download FunctionGemma in Settings to use the assistant.';
    else if (!busy && !field.value) message.textContent = '';
    if (downloading && (settings.open || !panel.hidden)) {
      timer = setTimeout(() => api.assistantState().then(refresh).catch(showError), 600);
    }
  }

  function showError(error) {
    (settings.open ? $('#assistant-install-status') : message).textContent = describeError(error);
  }

  let openRequest = 0;
  async function setOpen(open) {
    const request = ++openRequest;
    const origin=(open?launcher:panel).getBoundingClientRect();
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (!open) { morphSurfaceFrom(launcher,origin);launcher.focus();return; }
    const close = $('#assistant-close');
    if (form.hidden && $('#assistant-setup').hidden && !message.textContent) {
      message.textContent = 'Checking local model…';
    }
    const focusComposer = () => (!form.hidden ? field : $('#assistant-setup').hidden ? close : $('#assistant-setup')).focus();
    morphSurfaceFrom(panel, origin);
    focusComposer();
    const initialFocus = document.activeElement;
    try {
      const state = await api.assistantState();
      if (request !== openRequest) return;
      refresh(state);
      if (document.activeElement === initialFocus || !panel.contains(document.activeElement) &&
          initialFocus !== close && !initialFocus.checkVisibility()) focusComposer();
    } catch (error) {
      if (request === openRequest) showError(error);
    }
  }

  async function openSettings() {
    openSettingsTool('#assistant-settings');
    try { refresh(await api.assistantState()); }
    catch (error) { showError(error); }
  }

  function searchLibrary(query) {
    $('#type').selectedIndex = 0;
    setView('all');
    $('#search').value = query;
    $('#search').dispatchEvent(new Event('input'));
  }

  async function proposedAction({ action, value, query, includeFiles, fileType }, context) {
    const quote = text => '“' + text + '”';
    const { note, ids } = context;
    switch (action) {
      case 'help':
        message.textContent = [
          'Find files: “Find files named Kendall”',
          'Organize: “Find files named Kendall and create a collection called Kendall”',
          'Collections: “Open collection References” or “Add these to collection References”',
          'Canvases: “Create a canvas named Moodboard” or “Add these to canvas Moodboard”',
          'Preview: “Preview this file”',
          'Note covers: “Use Sunset.png as the note cover”',
          'Notes: “Create a note called Ideas”, “Open my Ideas note”, or “Rename this note to Plans”',
          'Selected files: “Tag the selected files with design” or “Move the selected files to Trash”',
          'Web: “Search the web for recent movies”'
        ].join('\n');
        break;
      case 'collection': {
        const term = query || (includeFiles && context.search);
        const targets = term ? await api.assistantFilenameMatches(term) : includeFiles ? ids : [];
        const name = value || term;
        if (!name || name.length > 120) throw new Error('Include a collection name, for example “Create a collection called Kendall”.');
        if (includeFiles && !targets.length) throw new Error(term ? 'No filenames match ' + quote(term) + '.' : 'Search by filename or select the files first.');
        const label = targets.length
          ? 'Create ' + quote(name) + ' and add ' + targets.length + (targets.length === 1 ? ' file' : ' files') +
            (term ? ' with ' + quote(term) + ' in the filename?' : ' from your selection?')
          : 'Create the empty collection ' + quote(name) + '?';
        return { label, apply: async () => {
          await api.assistantCreateCollection(context.root, name, targets);
          $('#type').selectedIndex = 0;
          setView('folder', name);
          await refreshCurrent();
          return true;
        } };
      }
      case 'open_collection':
      case 'add_to_collection': {
        const matches = folders.filter(name => name.toLowerCase() === value.toLowerCase());
        if (matches.length !== 1) throw new Error(matches.length ? 'Several collections match that name.' : 'No collection has that name.');
        const name = matches[0];
        if (action === 'open_collection') {
          $('#type').selectedIndex = 0;
          setView('folder', name);
          message.textContent = 'Opened ' + quote(name) + '.';
          break;
        }
        if (!ids.length) throw new Error('Select the files you want to add first.');
        return {
          label: 'Add ' + ids.length + (ids.length === 1 ? ' file' : ' files') + ' to ' + quote(name) + '?',
          apply: async () => {
            await api.bulkUpdate(ids, { type: 'collection', folder: name });
            $('#type').selectedIndex = 0;
            setView('folder', name);
            await refreshCurrent();
            return true;
          }
        };
      }
      case 'open_canvas':
      case 'add_to_canvas': {
        const matches = CanvasWorkspace.boards.filter(board => board.name.toLowerCase() === value.toLowerCase());
        if (matches.length !== 1) throw new Error(matches.length ? 'Several canvases match that name.' : 'No canvas has that name.');
        const board = matches[0];
        if (action === 'open_canvas') {
          await CanvasWorkspace.open(board.id);
          message.textContent = 'Opened ' + quote(board.name) + '.';
          break;
        }
        if (!ids.length) throw new Error('Select the library files you want to add first.');
        return {
          label: 'Place ' + ids.length + (ids.length === 1 ? ' file' : ' files') + ' on ' + quote(board.name) + '?',
          apply: async () => { await CanvasWorkspace.addAssets(board.id, ids, null, true); return true; }
        };
      }
      case 'create_canvas':
        return {
          label: 'Create the canvas ' + quote(value) + '?',
          apply: async () => {
            const board = await api.canvasCreate(value);
            CanvasWorkspace.updateSummary(board);
            await CanvasWorkspace.open(board.id);
            return true;
          }
        };
      case 'preview_selection':
        if (ids.length !== 1 || selection.focus !== ids[0]) throw new Error('Select one library file to preview.');
        if (fileType && fileType !== 'file' && context.fileType !== fileType) throw new Error('Select a ' + fileType + ' file first.');
        openPreview();
        message.textContent = 'Opened the file preview.';
        break;
      case 'set_note_cover': {
        if (!note) throw new Error('Open the note that needs a cover first.');
        const matches = await api.assistantFilenameMatches(value, imageExt);
        if (matches.length !== 1) throw new Error(matches.length ? 'Several images match. Use the full filename.' : 'No library image matches that filename.');
        return {
          label: 'Use the image matching ' + quote(value) + ' as the cover of ' + quote(note.title || 'Untitled') + '?',
          apply: () => NotesWorkspace.setCoverFromLibrary(note.id, matches[0])
        };
      }
      case 'create_note':
        return { label: 'Create the note ' + quote(value) + '?', apply: () => NotesWorkspace.assistantWrite(value) };
      case 'rename_note':
        if (!note) throw new Error('Open the note you want to rename first.');
        return { label: 'Rename ' + quote(note.title || 'Untitled') + ' to ' + quote(value) + '?', apply: () => NotesWorkspace.assistantWrite(value, note) };
      case 'tag_selection':
      case 'trash_selection': {
        if (!ids.length) throw new Error('Select the files you want to change first.');
        const count = ids.length + (ids.length === 1 ? ' file' : ' files');
        const trash = action === 'trash_selection';
        const operation = trash ? { type: 'trash', trash: true } : { type: 'tags', tags: [value] };
        return {
          label: trash ? 'Move ' + count + ' to Trash?' : 'Add ' + quote(value) + ' to ' + count + '?',
          apply: async () => { await api.bulkUpdate(ids, operation); await refreshCurrent(); return true; }
        };
      }
      case 'search_web':
        return {
          label: 'Send ' + quote(value) + ' to DuckDuckGo and open it in your browser?',
          apply: async () => { await api.assistantWeb(value); return true; }
        };
      case 'open_note': {
        const notes = await api.notesList();
        const matches = notes.filter(item => item.title.toLowerCase() === value.toLowerCase());
        if (matches.length !== 1) throw new Error(matches.length ? 'Several notes share that title. Open the one you want from the sidebar.' : 'No note has that title. Try the exact title.');
        if (!await NotesWorkspace.open(matches[0].id)) throw new Error('The note could not be opened.');
        message.textContent = 'Opened ' + quote(matches[0].title) + '.';
        break;
      }
      case 'search_library':
        searchLibrary(value);
        message.textContent = 'Searching the library for ' + quote(value) + '.';
        break;
    }
  }

  // Update only when the pointer moves, with no animation loop at rest.
  let eyeFrame = 0, pointerX, pointerY;
  function centerEyes() {
    cancelAnimationFrame(eyeFrame);
    eyeFrame = 0;
    eyes.style.transform = '';
  }
  window.addEventListener('pointermove', event => {
    if (!panel.hidden || event.pointerType === 'touch' || reducedMotion.matches) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (eyeFrame) return;
    eyeFrame = requestAnimationFrame(() => {
      eyeFrame = 0;
      const { left, top, width, height } = launcher.getBoundingClientRect();
      if (!width) return;
      const x = pointerX - left - width / 2;
      const y = pointerY - top - height / 2;
      const scale = 5 / Math.max(55, Math.hypot(x, y));
      eyes.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
    });
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', centerEyes);
  window.addEventListener('blur', centerEyes);
  reducedMotion.addEventListener('change', centerEyes);

  launcher.onclick = () => setOpen(panel.hidden);
  $('#assistant-close').onclick = () => setOpen(false);
  panel.onkeydown = event => {
    event.stopPropagation();
    if (event.key === 'Escape') setOpen(false);
  };
  $('#assistant-setup').onclick = openSettings;
  $('#show-assistant-settings').onclick = openSettings;
  $('#assistant-settings-close').onclick = () => settings.close();
  settings.addEventListener('close', () => {
    if (settings.dataset.fromSettings === 'true') {
      settings.dataset.fromSettings = 'false';
      $('#settings-dialog').showModal();
      $('#show-assistant-settings').focus();
    } else if (!panel.hidden) $('#assistant-setup').focus();
  });
  $('#assistant-terms').onclick = () => api.assistantTerms().catch(showError);
  $('#assistant-folder').onclick = () => api.assistantFolder().catch(showError);
  download.onclick = async () => {
    download.disabled = true;
    try {
      const state = await api.assistantState();
      if (state.status === 'downloading') await api.assistantCancel();
      refresh(state.status === 'downloading' ? await api.assistantState() : await api.assistantDownload());
    } catch (error) { showError(error); download.disabled = false; }
  };

  field.addEventListener('input', clearReview);
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!busy) form.requestSubmit();
    }
  });
  $('#assistant-stop').onclick = () => { stopped = true; api.assistantStop().catch(showError); };
  form.onsubmit = async event => {
    event.preventDefault();
    const command = field.value.trim();
    if (!command || busy) return;
    clearReview();
    const context = { note: NotesWorkspace.active(), ids: view === 'trash' ? [] : selection.values(),
      search: view === 'all' ? $('#search').value.trim() : '', fileType: current() ? kind(current()) : null };
    stopped = false;
    setBusy(true, true);
    message.textContent = 'Interpreting your request…';
    try {
      const { root } = await api.libraryLocation();
      const plan = stopped ? null : await api.assistantPlan(command, {
        selectionCount: context.ids.length, fileType: context.fileType, noteOpen: Boolean(context.note)
      });
      if (stopped) { message.textContent = 'Stopped.'; return; }
      if (!plan) {
        message.textContent = 'I couldn’t match that request to an action. Ask “What can you do?” for examples.';
        return;
      }
      if ((await api.libraryLocation()).root !== root) throw new Error('The library changed. Submit the command again.');
      const proposal = await proposedAction(plan, { ...context, root });
      if (proposal) {
        pending = { ...proposal, root };
        message.textContent = 'Review this action before continuing.';
        $('#assistant-proposal').textContent = proposal.label;
        review.hidden = false;
      }
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  $('#assistant-discard').onclick = () => { clearReview(); message.textContent = 'Cancelled.'; field.focus(); };
  $('#assistant-apply').onclick = async () => {
    const proposal = pending;
    if (!proposal || busy) return;
    clearReview();
    setBusy(true);
    try {
      if ((await api.libraryLocation()).root !== proposal.root) throw new Error('The library changed. Submit the command again.');
      if (!await proposal.apply()) throw new Error('The original target is unavailable. Submit the command again.');
      message.textContent = 'Done.';
    } catch (error) { showError(error); }
    finally { setBusy(false); field.focus(); }
  };
})();
