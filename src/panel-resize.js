// Panel resizing: the app sidebar, the Settings rail and File Details all
// share one hairline. Dragging it changes that column's width, the way a
// macOS split view does. The hairline is invisible until the pointer reaches
// it, then it doubles in weight and takes the app's focus grey. Keyboard
// users get the same edge: arrow keys resize, Enter resets, and a small
// readout appears while adjusting.
(() => {
  'use strict';

  const WIDTH_KEY = {
    sidebar: 'panel-width-sidebar',
    inspector: 'panel-width-inspector',
    settings: 'panel-width-settings'
  };
  const MIN = { sidebar: 180, inspector: 220, settings: 160 };
  const MAX = { sidebar: 420, inspector: 460, settings: 360 };
  // The gallery keeps at least this much room no matter how far a rail is
  // dragged, so a split view never eats the library.
  const MAIN_MIN = 380;
  const SNAP = 6;

  const root = document.documentElement;
  const body = document.body;
  const mediaNarrowSidebar = matchMedia('(max-width: 1040px)');
  const mediaNarrowInspector = matchMedia('(max-width: 880px)');
  const panels = new Map();
  let drag = null;
  let refreshFrame = 0;
  let flashTimer = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultWidth(key) {
    if (key === 'sidebar') return innerWidth <= 1200 ? 190 : 214;
    if (key === 'inspector') return (innerWidth <= 1200 ? 240 : 274) - islandGap();
    return 200;
  }

  // The islands keep a margin inside their grid track, so the column is
  // larger than the visible panel. Widths are stored and shown as the panel
  // the user actually sees.
  function islandGap() {
    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--island-gap'));
    return Number.isFinite(gap) ? gap * 2 : 0;
  }

  function paneWidth(key) {
    const panel = panels.get(key);
    if (!panel) return defaultWidth(key);
    const rect = panel.el.getBoundingClientRect();
    return rect.width || 0;
  }

  function maxWidth(key) {
    if (key === 'settings') {
      const dialog = document.querySelector('#settings-dialog');
      const width = dialog?.open ? dialog.clientWidth : 920;
      return Math.max(MIN.settings, Math.min(MAX.settings, width - MAIN_MIN));
    }
    const sidebar = body.classList.contains('hide-sidebar') || mediaNarrowSidebar.matches ? 0 : paneWidth('sidebar');
    const inspector = body.classList.contains('hide-inspector') || mediaNarrowInspector.matches ? 0 : paneWidth('inspector');
    const room = innerWidth - (key === 'sidebar' ? inspector : sidebar) - MAIN_MIN - islandGap() * 2;
    return Math.max(MIN[key], Math.min(MAX[key], room));
  }

  function appModalOpen() {
    return Boolean(document.querySelector('dialog[open]')) ||
      body.classList.contains('sidebar-drawer-open') ||
      !document.querySelector('#preview')?.hidden;
  }

  function visible(key) {
    const panel = panels.get(key);
    if (!panel) return false;
    if (key === 'settings') return Boolean(document.querySelector('#settings-dialog')?.open);
    if (appModalOpen()) return false;
    if (key === 'sidebar') {
      return !body.classList.contains('hide-sidebar') && !mediaNarrowSidebar.matches &&
        panel.el.getBoundingClientRect().width > 40;
    }
    return !body.classList.contains('hide-inspector') &&
      !body.classList.contains('narrow-inspector') &&
      panel.el.getBoundingClientRect().width > 40;
  }

  function syncHandle(panel) {
    const handle = panel.handle;
    if (!visible(panel.key)) {
      handle.hidden = true;
      return;
    }
    handle.hidden = false;
    if (panel.key === 'settings') {
      updateAria(panel, panel.el.getBoundingClientRect().width || defaultWidth('settings'));
      return;
    }
    const rect = panel.el.getBoundingClientRect();
    const edge = panel.side === 'right' ? rect.right : rect.left;
    handle.style.top = Math.round(rect.top) + 'px';
    handle.style.height = Math.round(rect.height) + 'px';
    handle.style.left = (edge - handle.offsetWidth / 2) + 'px';
    updateAria(panel, rect.width);
  }

  function syncAll() {
    for (const panel of panels.values()) syncHandle(panel);
  }

  function updateAria(panel, width) {
    panel.handle.setAttribute('aria-valuemin', String(MIN[panel.key]));
    panel.handle.setAttribute('aria-valuemax', String(Math.round(maxWidth(panel.key))));
    panel.handle.setAttribute('aria-valuenow', String(Math.round(width)));
    panel.handle.setAttribute('aria-valuetext', `${panel.label}, ${Math.round(width)} pixels`);
  }

  function applyWidth(panel, width) {
    const key = panel.key;
    const next = Math.round(clamp(width, MIN[key], maxWidth(key)));
    panel.applied = next;
    if (key === 'sidebar') {
      root.style.setProperty('--sidebar', next + 'px');
      root.style.setProperty('--sidebar-open', next + 'px');
    } else if (key === 'inspector') {
      root.style.setProperty('--inspector', (next + islandGap()) + 'px');
    } else {
      panel.el.style.width = next + 'px';
    }
    updateAria(panel, next);
    return next;
  }

  function refreshApp() {
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      if (typeof renderWindow === 'function') renderWindow();
      window.dispatchEvent(new Event('resize'));
    });
  }

  function snapWidth(key, width) {
    const point = defaultWidth(key);
    return Math.abs(width - point) <= SNAP ? point : width;
  }

  function commit(panel, width) {
    const next = Math.round(clamp(width, MIN[panel.key], maxWidth(panel.key)));
    // Landing on the responsive default is the same as resetting: keeping a
    // custom width that merely copies the default would stop the rail from
    // following the window's own breakpoints.
    if (next === Math.round(defaultWidth(panel.key))) {
      reset(panel);
      return next;
    }
    applyWidth(panel, next);
    panel.custom = next;
    localStorage.setItem(WIDTH_KEY[panel.key], String(next));
    refreshApp();
    syncHandle(panel);
    return next;
  }

  function clearApplied(panel) {
    panel.applied = null;
    if (panel.key === 'sidebar') {
      root.style.removeProperty('--sidebar');
      root.style.removeProperty('--sidebar-open');
    } else if (panel.key === 'inspector') {
      root.style.removeProperty('--inspector');
    } else {
      panel.el.style.removeProperty('width');
    }
    updateAria(panel, panel.el.getBoundingClientRect().width || defaultWidth(panel.key));
    syncHandle(panel);
  }

  function reset(panel) {
    panel.custom = null;
    localStorage.removeItem(WIDTH_KEY[panel.key]);
    panel.handle.style.transform = '';
    clearApplied(panel);
    refreshApp();
  }

  function readout(panel, width) {
    const badge = panel.handle.querySelector('.panel-resizer-badge');
    badge.textContent = Math.round(width) + ' px';
    updateAria(panel, width);
  }

  function flash(panel) {
    clearTimeout(flashTimer);
    for (const other of panels.values()) other.handle.classList.remove('is-flashing');
    panel.handle.classList.add('is-flashing');
    flashTimer = setTimeout(() => panel.handle.classList.remove('is-flashing'), 900);
  }

  function beginDrag(panel, event) {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = panel.el.getBoundingClientRect();
    drag = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: rect.width,
      edge: panel.side === 'right' ? rect.right : rect.left,
      proposed: rect.width,
      moving: false
    };
    panel.handle.classList.add('is-dragging');
    panel.handle.style.transform = '';
    body.classList.add('is-resizing-panel');
    readout(panel, rect.width);
    try { panel.handle.setPointerCapture(event.pointerId); } catch {}
    window.addEventListener('pointermove', moveDrag, true);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', cancelDrag, true);
    event.preventDefault();
    event.stopPropagation();
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { panel } = drag;
    const distance = event.clientX - drag.startX;
    if (!drag.moving && Math.abs(distance) < 2) return;
    drag.moving = true;
    const raw = panel.side === 'right' ? drag.startWidth + distance : drag.startWidth - distance;
    const limit = maxWidth(panel.key);
    const proposed = clamp(snapWidth(panel.key, clamp(raw, MIN[panel.key], limit)), MIN[panel.key], limit);
    drag.proposed = proposed;
    readout(panel, proposed);
    applyWidth(panel, proposed);
    refreshApp();
    syncHandle(panel);
    event.preventDefault();
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { panel, proposed, moving } = drag;
    stopDrag();
    if (!moving) {
      panel.handle.style.transform = '';
      syncHandle(panel);
      return;
    }
    panel.handle.style.transform = '';
    commit(panel, proposed);
  }

  function cancelDrag(event) {
    if (!drag) return;
    if (event && event.pointerId !== drag.pointerId) return;
    const { panel, moving } = drag;
    if (moving) {
      if (panel.custom) applyWidth(panel, panel.custom);
      else clearApplied(panel);
    }
    stopDrag();
    panel.handle.style.transform = '';
    syncHandle(panel);
    refreshApp();
  }

  function stopDrag() {
    drag = null;
    body.classList.remove('is-resizing-panel');
    window.removeEventListener('pointermove', moveDrag, true);
    window.removeEventListener('pointerup', endDrag, true);
    window.removeEventListener('pointercancel', cancelDrag, true);
    for (const panel of panels.values()) {
      panel.handle.classList.remove('is-dragging');
    }
  }

  function onKeydown(panel, event) {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', '0'].includes(key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'Enter' || key === '0') {
      reset(panel);
      flash(panel);
      return;
    }
    const current = panel.applied ?? Math.round(panel.el.getBoundingClientRect().width);
    let next;
    if (key === 'Home') next = MIN[panel.key];
    else if (key === 'End') next = maxWidth(panel.key);
    else {
      const direction = key === 'ArrowRight' ? 1 : -1;
      const step = event.shiftKey ? 24 : 8;
      next = current + (panel.side === 'right' ? direction : -direction) * step;
    }
    commit(panel, next);
    flash(panel);
  }

  function makeHandle(key, el, side, label) {
    const handle = document.createElement('div');
    handle.className = 'panel-resizer';
    handle.dataset.panel = key;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', label);
    if (el.id) handle.setAttribute('aria-controls', el.id);
    handle.tabIndex = 0;
    handle.title = 'Drag to resize · Double-click to reset';
    const badge = document.createElement('span');
    badge.className = 'panel-resizer-badge';
    badge.setAttribute('aria-hidden', 'true');
    handle.append(badge);

    const panel = {
      key,
      el,
      handle,
      side,
      label,
      applied: null,
      custom: null
    };
    panels.set(key, panel);

    handle.addEventListener('pointerdown', event => beginDrag(panel, event));
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      reset(panel);
      flash(panel);
    });
    handle.addEventListener('keydown', event => onKeydown(panel, event));
    return panel;
  }

  function positionSettingsHandle() {
    // The Settings rail's handle lives inside the rail, so the browser keeps
    // it on the edge as the rail changes width. Only the readout needs the
    // current width.
    const panel = panels.get('settings');
    if (panel) updateAria(panel, panel.el.getBoundingClientRect().width || defaultWidth('settings'));
  }

  function init() {
    const sidebar = document.querySelector('.sidebar');
    const inspector = document.querySelector('#inspector');
    const settingsRail = document.querySelector('.settings-sidebar');
    if (!sidebar || !inspector || !settingsRail) return;
    if (!sidebar.id) sidebar.id = 'app-sidebar';
    if (!settingsRail.id) settingsRail.id = 'settings-sidebar';

    const settingsPanel = makeHandle('settings', settingsRail, 'right', 'Resize settings sidebar');
    settingsRail.append(settingsPanel.handle);
    makeHandle('sidebar', sidebar, 'right', 'Resize sidebar');
    makeHandle('inspector', inspector, 'left', 'Resize file details');

    for (const [key, panel] of panels) {
      if (key === 'settings') continue;
      body.append(panel.handle);
    }

    // Restore widths saved by an earlier drag. The Settings rail is restored
    // when its dialog opens so a closed 0-width dialog cannot clamp it.
    for (const [key, panel] of panels) {
      if (key === 'settings') continue;
      const saved = Number(localStorage.getItem(WIDTH_KEY[key]));
      if (Number.isFinite(saved) && saved > 0) {
        panel.custom = Math.round(saved);
        applyWidth(panel, saved);
      }
    }
    const settingsWidth = Number(localStorage.getItem(WIDTH_KEY.settings));
    if (Number.isFinite(settingsWidth) && settingsWidth > 0) {
      settingsPanel.custom = Math.round(settingsWidth);
      settingsRail.style.width = Math.round(settingsWidth) + 'px';
    }

    syncAll();
    positionSettingsHandle();

    const dialog = document.querySelector('#settings-dialog');
    dialog?.addEventListener('toggle', () => {
      const width = Number(localStorage.getItem(WIDTH_KEY.settings));
      if (dialog.open && Number.isFinite(width) && width > 0) applyWidth(settingsPanel, width);
      syncHandle(settingsPanel);
      positionSettingsHandle();
    });

    const observer = new MutationObserver(() => { syncAll(); positionSettingsHandle(); });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    const preview = document.querySelector('#preview');
    if (preview) observer.observe(preview, { attributes: true, attributeFilter: ['hidden'] });

    addEventListener('resize', () => {
      // A live drag already owns the width. The resize event dispatched by
      // its own re-layout must not snap the rail back to the last committed
      // value.
      if (drag) return;
      for (const panel of panels.values()) {
        if (!panel.custom) continue;
        if (panel.key === 'settings' && !document.querySelector('#settings-dialog')?.open) continue;
        applyWidth(panel, panel.custom);
      }
      syncAll();
      positionSettingsHandle();
    });
    mediaNarrowSidebar.addEventListener('change', syncAll);
    mediaNarrowInspector.addEventListener('change', syncAll);
    document.fonts?.ready.then(syncAll);

    // Escape abandons a drag and restores the width it started with.
    addEventListener('keydown', event => {
      if (!drag || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag(null);
    }, true);

    // A programmatic way to reset a rail without a pointer.
    window.PanelResize = {
      reset(key) {
        const panel = panels.get(key);
        if (panel) reset(panel);
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
