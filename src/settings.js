// Settings controller: a two-pane preferences window in the macOS System
// Settings idiom — a searchable rail on the left, one focused pane on the right.
(function () {
  'use strict';

  const SHORTCUTS = [
    ['⌘K', 'Search the library'],
    ['Space', 'Preview the selected file'],
    ['← →', 'Move through the library'],
    ['⌘I', 'Toggle file details'],
    ['⌘B', 'Toggle the sidebar'],
    ['⌘O', 'Import files'],
    ['⌘V', 'Paste files from the clipboard'],
    ['⌘⌫', 'Move the selection to Trash'],
    ['⌘Z', 'Undo the last change'],
    ['⇧⌘Z', 'Redo the last change'],
    ['⌘,', 'Open Settings'],
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
    currentPane: 'general',

    init() {
      const dialog = $('#settings-dialog');
      if (!dialog) return;
      for (const pane of dialog.querySelectorAll('.settings-pane')) this.panes.set(pane.dataset.settingsPane, pane);
      for (const item of dialog.querySelectorAll('.settings-nav-item')) {
        const icon = item.querySelector('.settings-nav-icon');
        if (icon) icon.append(glyph(icon.dataset.settingsIcon));
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
        const first = this.navItems.find(item => !item.hidden);
        if (first) this.show(first.dataset.settingsPane);
      });

      this.buildShortcuts();
      this.buildLicenses();
      this.wireAppearance();
      // The switches describe the resolved appearance, so they follow a theme
      // change made from this pane without waiting for it to be reopened.
      api.onAppearance(state => {
        const pane = this.pane('appearance');
        if (pane && !pane.hidden) this.syncAppearance(state);
      });
      this.wireLayouts();
      this.wireExperimental();

      $('#settings-new-collection').onclick = () => $('#add-folder').click();
      $('#settings-import-files').onclick = () => importDialog();
      $('#settings-check-updates').onclick = () => this.checkUpdates();
      $('#settings-licenses-toggle').onclick = event => {
        const card = $('#settings-licenses');
        const open = card.hidden;
        card.hidden = !open;
        event.currentTarget.setAttribute('aria-expanded', String(open));
      };
      this.show('general');
    },

    pane(name) {
      return this.panes.get(name) || null;
    },

    open(name) {
      const dialog = $('#settings-dialog');
      if (!dialog.open) dialog.showModal();
      if (name) this.show(name);
      const search = $('#settings-search');
      if (search) search.value = '';
      this.filter('');
    },

    show(name) {
      if (!this.panes.has(name)) name = 'general';
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

    // The rail filters as you type and jumps straight to the first match.
    // Rows count as matches too, so “health” finds the Media pane.
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
    },

    refresh(name) {
      if (name === 'appearance') this.syncAppearance();
      if (name === 'collections') this.syncCollections();
      if (name === 'galleries') this.syncLayouts();
      if (name === 'experimental') this.syncExperimental();
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
      $('#settings-glass').onchange = event => this.applyAppearance({ glass: event.target.checked ? 'on' : 'off' });
      $('#settings-transparency').onchange = event => this.applyAppearance({ transparency: event.target.checked ? 'on' : 'off' });
    },

    async applyAppearance(patch) {
      const state = await api.appearanceSet(patch);
      this.syncAppearance(state);
    },

    async syncAppearance(state) {
      const current = state || await api.appearanceState();
      for (const button of document.querySelectorAll('#settings-theme [data-theme]'))
        button.setAttribute('aria-checked', String(button.dataset.theme === (current.theme || 'system')));
      const glass = $('#settings-glass');
      glass.checked = !!current.nativeGlass;
      // Native glass is a dark-appearance material; in light mode the switch
      // would otherwise look off and snap back after every click.
      glass.disabled = !current.dark;
      const glassCopy = glass.closest('.settings-row')?.querySelector('small');
      if (glassCopy) glassCopy.textContent = current.dark
        ? 'Let the sidebar and window blur with the desktop.'
        : 'Native glass is available in dark appearance.';
      $('#settings-transparency').checked = !!current.reducedTransparency;
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
      for (const button of document.querySelectorAll('#settings-layouts [data-layout]'))
        button.setAttribute('aria-checked', String(button.dataset.layout === galleryLayout));
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

    syncExperimental() {
      const semantic = $('#settings-semantic');
      const visual = $('#settings-visual-model');
      const ready = SmartSearch.visualModelReady;
      semantic.checked = SmartSearch.enabled;
      visual.checked = ready;
      visual.disabled = !semantic.checked && !ready;
      $('#settings-visual-row').classList.toggle('is-muted', !semantic.checked && !ready);
      $('#settings-visual-note').textContent = ready
        ? 'The visual model is installed on this Mac.'
        : 'Runs entirely on your Mac. Images are never uploaded.';
    },

    syncCollections() {
      const card = $('#settings-collections');
      if (!card) return;
      const names = Array.isArray(folders) ? folders : [];
      if (!names.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-row settings-row-plain';
        const copy = document.createElement('span');
        copy.className = 'settings-copy';
        const strong = document.createElement('strong');
        strong.textContent = 'No collections yet';
        const small = document.createElement('small');
        small.className = 'settings-subtle';
        small.textContent = 'Group related files to find them faster';
        copy.append(strong, small);
        empty.append(copy);
        card.replaceChildren(empty);
        return;
      }
      card.replaceChildren(...names.map(name => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'settings-row settings-row-button';
        const copy = document.createElement('span');
        copy.className = 'settings-copy';
        const strong = document.createElement('strong');
        strong.textContent = name;
        copy.append(strong);
        const chevron = document.createElement('span');
        chevron.className = 'settings-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '›';
        button.append(copy, chevron);
        button.onclick = () => {
          $('#settings-dialog').close();
          setView('folder', name);
        };
        return button;
      }));
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
      this.updating = true;
      this.pendingUpdateVersion = '';
      button.disabled = true;
      if (bar) {
        bar.hidden = true;
        bar.value = 0;
      }
      const unsubscribe = updateApi.onUpdateProgress?.(value => this.updateProgress(value));
      try {
        status.textContent = 'Checking GitHub for updates…';
        await this.syncVersion();
        const update = await updateApi.updateCheck();
        if (!update.available) {
          status.textContent = 'Canvas Pro ' + update.currentVersion + ' is up to date.';
          return;
        }
        this.pendingUpdateVersion = update.version;
        if (!update.installable) {
          status.textContent = 'Canvas Pro ' + update.version + ' is available, but it cannot install automatically. ' + update.reason;
          return;
        }
        status.textContent = 'Downloading Canvas Pro ' + update.version + '…';
        await updateApi.updateDownload();
        status.textContent = 'Installing Canvas Pro ' + update.version + '… The app will restart.';
        await updateApi.updateInstall();
        status.textContent = 'Canvas Pro is restarting with version ' + update.version + '…';
      } catch (error) {
        status.textContent = this.updateMessage(error);
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
