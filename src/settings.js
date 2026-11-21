(function () {
  'use strict';

  const SHORTCUTS = [
    ['⌘ K', 'Open command palette'],
    ['⌘ F', 'Search the library'],
    ['⌘ /', 'Keyboard shortcuts'],
    ['Space', 'Preview the selected file'],
    ['← →', 'Move through the library'],
    ['⌘I', 'Toggle file details'],
    ['⌘S', 'Toggle the sidebar'],
    ['⌘O', 'Import files'],
    ['⌘V', 'Paste files from the clipboard'],
    ['⌘C', 'Copy the selected files'],
    ['⌘A', 'Select all'],
    ['⇧ + arrow', 'Extend selection'],
    ['⌘ + click', 'Toggle individual selection'],
    ['⌘⌫', 'Move the selection to Trash'],
    ['⌘Z', 'Undo the last change'],
    ['⇧⌘Z', 'Redo the last change'],
    ['⌘,', 'Open Settings'],
    ['⌥O', 'Infinite canvas view'],
    ['V / H / T', 'Canvas select / hand / text'],
    ['R / O', 'Canvas rectangle / ellipse'],
    ['⌘0', 'Canvas fit'],
    ['Space + drag', 'Pan canvas'],
    ['↑ ↓ · Return · Esc', 'Command palette: move, choose, close'],
    ['Esc', 'Close the preview']
  ];

  const LICENSES = [
    ['Mozilla Readability', 'Article extraction'],
    ['linkedom', 'HTML parsing'],
    ['Three.js', '3D and design previews'],
    ['web-ifc', 'IFC model viewer'],
    ['Ruffle', 'Flash playback'],
    ['Ghostscript', 'PostScript rendering'],
    ['Transformers.js', 'On-device models'],
    ['ONNX Runtime', 'Model inference'],
    ['fflate', 'Compressed assets']
  ];

  const SettingsUI = {
    panes: new Map(),
    navItems: [],
    titles: new Map(),
    currentPane: 'library',

    init() {
      const dialog = $('#settings-dialog');
      if (!dialog) return;
      for (const pane of dialog.querySelectorAll('.settings-pane')) this.panes.set(pane.dataset.settingsPane, pane);
      for (const chevron of dialog.querySelectorAll('.settings-chevron')) {
        if (!chevron.firstChild) chevron.append(glyph('chevronRight', { size: 14 }));
      }
      for (const item of dialog.querySelectorAll('.settings-nav-item')) {
        const icon = item.querySelector('.settings-nav-icon');
        if (icon) icon.append(glyph(icon.dataset.settingsIcon, { size: 16 }));
        this.navItems.push(item);
        this.titles.set(item.dataset.settingsPane, item.querySelector('.settings-nav-label').textContent);
        item.addEventListener('click', () => this.show(item.dataset.settingsPane));
      }
      const search = $('#settings-search');
      search.closest('.settings-search').querySelector('.settings-search-icon')
        .replaceChildren(glyph('search'));
      search.addEventListener('input', () => this.filter(search.value));
      search.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const first = $('#settings-nav').querySelector('.settings-nav-item:not([hidden])');
        if (first) this.show(first.dataset.settingsPane);
      });

      $('#reveal-library-folder').onclick = () => safe(() => api.showLibrary());
      $('#library-backup').onclick = async () => {
        const button = $('#library-backup');
        button.disabled = true;
        $('#backup-status').textContent = 'Preparing backup…';
        try {
          await api.workbench('backup');
          await this.syncBackup();
        } catch (error) {
          $('#backup-status').textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
      this.buildShortcuts();
      this.buildLicenses();
      this.wireAppearance();
      this.wireRadioKeys('#settings-theme', '[data-theme]');
      api.onAppearance(state => {
        const pane = this.pane('appearance');
        if (pane && !pane.hidden) this.syncAppearance(state);
      });
      this.wireLayouts();
      this.wireRadioKeys('#settings-layouts', '[data-layout]');
      this.wireExperimental();

      $('#settings-infinite').onclick = () => {
        $('#settings-dialog').close();
        window.InfiniteCanvas?.start();
      };
      $('#settings-check-updates').onclick = () => this.checkUpdates();
      $('#settings-licenses-toggle').onclick = event => {
        const card = $('#settings-licenses');
        const open = card.hidden;
        card.hidden = !open;
        event.currentTarget.setAttribute('aria-expanded', String(open));
      };
      this.show('library');
    },

    pane(name) {
      return this.panes.get(name) || null;
    },

    wireRadioKeys(selector, itemSelector) {
      const group = $(selector);
      if (!group) return;
      const items = () => [...group.querySelectorAll(itemSelector)];
      const sync = () => {
        const list = items();
        const checked = list.find(item => item.getAttribute('aria-checked') === 'true') || list[0];
        for (const item of list) item.tabIndex = item === checked ? 0 : -1;
      };
      sync();
      group.addEventListener('keydown', event => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const list = items();
        const index = list.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
          : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next].focus();
        list[next].click();
        sync();
      });
      group.addEventListener('click', () => queueMicrotask(sync));
    },

    open(name) {
      const dialog = $('#settings-dialog');
      if (!dialog.open) dialog.showModal();
      this.show(name || this.currentPane);
      const search = $('#settings-search');
      if (search) search.value = '';
      this.filter('');
    },

    show(name) {
      if (!this.panes.has(name)) name = 'library';
      this.currentPane = name;
      for (const [key, pane] of this.panes) pane.hidden = key !== name;
      for (const item of this.navItems) {
        const active = item.dataset.settingsPane === name;
        item.classList.toggle('active', active);
        if (active) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      }
      $('#settings-title').textContent = this.titles.get(name) || 'Settings';
      $('#settings-scroll').scrollTop = 0;
      this.refresh(name);
    },

    filter(query) {
      const needle = query.trim().toLowerCase();
      let first = null;
      for (const item of this.navItems) {
        const label = item.querySelector('.settings-nav-label').textContent;
        const pane = this.panes.get(item.dataset.settingsPane);
        const body = pane ? pane.textContent : '';
        const hit = !needle || (label + ' ' + body).toLowerCase().includes(needle);
        item.hidden = !hit;
        if (hit && !first) first = item;
      }
      for (const group of document.querySelectorAll('#settings-nav .settings-nav-group')) {
        const visible = [...group.querySelectorAll('.settings-nav-item')].some(item => !item.hidden);
        const title = group.querySelector('.settings-nav-title');
        if (title) title.hidden = !visible;
        group.hidden = !visible;
      }
      if (needle && first) this.show(first.dataset.settingsPane);
      let empty = $('#settings-no-results');
      if (!empty && needle && !first) {
        empty = document.createElement('p');
        empty.id = 'settings-no-results';
        empty.className = 'settings-note';
        empty.textContent = 'No settings found. Try a different search.';
        $('#settings-scroll').append(empty);
      }
      if (empty) empty.hidden = !needle || !!first;
    },

    async syncBackup() {
      const {backup} = await api.workbench('state');
      $('#backup-status').textContent = backup ? new Date(backup.at).toLocaleString() + ' · ' + backup.path : 'No backup recorded for this library.';
    },

    refresh(name) {
      if (name === 'library') {
        safe(async () => {
          const { name, root } = await api.libraryLocation();
          $('#current-library-name').textContent = name;
          $('#current-library-path').textContent = root;
        });
        if (!$('#library-backup').disabled) safe(() => this.syncBackup());
      }
      if (name === 'appearance') this.syncAppearance();
      if (name === 'galleries') this.syncLayouts();
      if (name === 'search-models') safe(() => this.syncExperimental());
      if (name === 'about') this.syncVersion();
    },

    buildShortcuts() {
      const card = $('#settings-shortcuts');
      if (!card) return;
      card.replaceChildren(...SHORTCUTS.map(([keys, label]) => {
        const row = document.createElement('div');
        row.className = 'settings-row settings-row-plain';
        const copy = document.createElement('span');
        copy.className = 'settings-copy';
        const strong = document.createElement('strong');
        strong.textContent = label;
        copy.append(strong);
        const combo = document.createElement('kbd');
        combo.className = 'settings-keys';
        combo.textContent = keys;
        row.append(copy, combo);
        return row;
      }));
    },

    buildLicenses() {
      const card = $('#settings-licenses');
      if (!card) return;
      card.replaceChildren(...LICENSES.map(([name, role]) => {
        const row = document.createElement('div');
        row.className = 'settings-row settings-row-plain';
        const copy = document.createElement('span');
        copy.className = 'settings-copy';
        const strong = document.createElement('strong');
        strong.textContent = name;
        const small = document.createElement('small');
        small.className = 'settings-subtle';
        small.textContent = role;
        copy.append(strong, small);
        row.append(copy);
        return row;
      }));
    },

    wireAppearance() {
      const theme = $('#settings-theme');
      theme.addEventListener('click', event => {
        const button = event.target.closest('[data-theme]');
        if (!button) return;
        this.applyAppearance({ theme: button.dataset.theme });
      });
    },

    async applyAppearance(patch) {
      const state = await api.appearanceSet(patch);
      this.syncAppearance(state);
    },

    async syncAppearance(state) {
      const current = state || await api.appearanceState();
      for (const button of document.querySelectorAll('#settings-theme [data-theme]'))
        button.setAttribute('aria-checked', String(button.dataset.theme === (current.theme || 'system')));
    },

    wireLayouts() {
      const card = $('#settings-layouts');
      card.addEventListener('click', event => {
        const button = event.target.closest('[data-layout]');
        if (!button) return;
        setGalleryLayout(button.dataset.layout);
        this.syncLayouts();
      });
      const names = $('#settings-file-names');
      names.onchange = () => {
        setShowFileNames(names.checked);
        this.syncLayouts();
      };
    },

    syncLayouts() {
      for (const button of document.querySelectorAll('#settings-layouts [data-layout]')) {
        const active = button.dataset.layout === galleryLayout;
        button.setAttribute('aria-checked', String(active));
        button.tabIndex = active ? 0 : -1;
      }
      const names = $('#settings-file-names');
      if (names) names.checked = showFileNamesEnabled();
    },

    wireExperimental() {
      const semantic = $('#settings-semantic');
      const visual = $('#settings-visual-model');
      semantic.onchange = async () => {
        await SmartSearch.setEnabled(semantic.checked);
        this.syncExperimental();
      };
      visual.onchange = async () => {
        if (visual.checked) await SmartSearch.ensureVisualModel();
        this.syncExperimental();
      };
    },

    async syncExperimental() {
      const semantic = $('#settings-semantic');
      const visual = $('#settings-visual-model');
      const ready = (await api.modelState('clip')).ready;
      semantic.checked = SmartSearch.enabled;
      visual.checked = ready;
      visual.disabled = ready;
      $('#settings-visual-row').classList.toggle('is-muted', false);
      $('#settings-visual-note').textContent = ready
        ? 'The visual model is installed on this Mac.'
        : 'Download the visual model (156 MB) for image similarity and tag suggestions.';
    },


    async syncVersion() {
      if (this.version) {
        $('#settings-about-version').textContent = this.version;
        return;
      }
      try {
        this.version = await api.appVersion();
        $('#settings-about-version').textContent = this.version;
      } catch (error) {
        $('#settings-about-version').textContent = 'Version unavailable';
      }
    },

    updateMessage(error) {
      return String(error?.message || error || 'The update could not be completed.')
        .replace(/^Error invoking remote method '[^']+':\s*/, '')
        .replace(/^Error:\s*/, '');
    },

    updateProgress(value) {
      const status = $('#settings-update-status'), bar = $('#settings-update-progress');
      if (!status || !value) return;
      const version = this.pendingUpdateVersion ? ' ' + this.pendingUpdateVersion : '';
      if (value.phase === 'download') {
        const percent = Number.isFinite(value.percent) ? value.percent + '%' : '';
        const received = value.received ? Math.round(value.received / 1048576) + ' MB' : '';
        status.textContent = 'Downloading Canvas Pro' + version + (percent ? ' — ' + percent : received ? ' — ' + received : '') + '…';
        if (bar) {
          bar.hidden = false;
          if (Number.isFinite(value.percent)) bar.value = value.percent;
          else bar.removeAttribute('value');
        }
      } else if (value.phase === 'verify') {
        status.textContent = 'Verifying the update…';
      } else if (value.phase === 'mount') {
        status.textContent = 'Preparing Canvas Pro' + version + '…';
      } else if (value.phase === 'install') {
        status.textContent = 'Installing Canvas Pro' + version + '… The app will restart.';
      } else if (value.phase === 'check') {
        status.textContent = 'Checking GitHub for updates…';
      }
    },

    async checkUpdates() {
      if (this.updating) return;
      const button = $('#settings-check-updates'), status = $('#settings-update-status'), bar = $('#settings-update-progress');
      const updateApi = this.updateApi || api;
      const toast = message => { if (typeof notify === 'function') notify(message); };
      this.updating = true;
      this.pendingUpdateVersion = '';
      button.disabled = true;
      if (bar) {
        bar.hidden = true;
        bar.value = 0;
      }
      toast('Checking for updates…');
      const unsubscribe = updateApi.onUpdateProgress?.(value => {
        this.updateProgress(value);
        const version = this.pendingUpdateVersion ? ' ' + this.pendingUpdateVersion : '';
        if (value?.phase === 'download')
          toast('Downloading Canvas Pro' + version + (Number.isFinite(value.percent) ? ' — ' + value.percent + '%' : '') + '…');
        else if (value?.phase === 'install') toast('Installing Canvas Pro' + version + '… The app will restart.');
      });
      try {
        status.textContent = 'Checking GitHub for updates…';
        await this.syncVersion();
        const update = await updateApi.updateCheck();
        if (!update.available) {
          status.textContent = 'Canvas Pro ' + update.currentVersion + ' is up to date.';
          toast('Canvas Pro ' + update.currentVersion + ' is up to date.');
          return;
        }
        this.pendingUpdateVersion = update.version;
        if (!update.installable) {
          const message = 'Canvas Pro ' + update.version + ' is available, but it cannot install automatically. ' + update.reason;
          status.textContent = message;
          toast(message);
          return;
        }
        status.textContent = 'Downloading Canvas Pro ' + update.version + '…';
        toast('Downloading Canvas Pro ' + update.version + '…');
        await updateApi.updateDownload();
        status.textContent = 'Installing Canvas Pro ' + update.version + '… The app will restart.';
        toast('Installing Canvas Pro ' + update.version + '… The app will restart.');
        await updateApi.updateInstall();
        status.textContent = 'Canvas Pro is restarting with version ' + update.version + '…';
        toast('Canvas Pro is restarting with version ' + update.version + '…');
      } catch (error) {
        status.textContent = this.updateMessage(error);
        toast(status.textContent);
        if (bar) bar.hidden = true;
      } finally {
        this.updating = false;
        this.pendingUpdateVersion = '';
        button.disabled = false;
        unsubscribe?.();
      }
    }
  };

  window.SettingsUI = SettingsUI;
})();
