const SidebarUI = (() => {
  const narrow = matchMedia('(max-width: 1040px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let sidebar, activePill, hoverPill, backdrop, edge, handle;
  let frame = 0, hovered = null, pointer = null, drawerOpen = false, gesture = null;
  let compact = localStorage.getItem('hide-sidebar') === 'true';
  const sections = new Map();
  let drawerMotion = [];

  function syncAccessibility() {
    if (!sidebar) return;
    const previewOpen = !$('#preview').hidden;
    sidebar.inert = previewOpen || (narrow.matches ? !drawerOpen : compact);
    $('main').inert = previewOpen || drawerOpen;
    $('#inspector').inert = previewOpen || drawerOpen;
    $('#assistant-dock').inert = drawerOpen;
  }

  function visible(element) {
    return element?.isConnected && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden';
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); });
  }

  function positionPill(pill, target) {
    if (!visible(target) || sidebar.inert) {
      if (!pill.hidden) pill.hidden = true;
      return;
    }
    const bounds = target.getBoundingClientRect(), root = sidebar.getBoundingClientRect();
    pill.style.width = bounds.width + 'px';
    pill.style.height = bounds.height + 'px';
    pill.style.transform = 'translate(' + (bounds.left - root.left) + 'px,' +
      (bounds.top - root.top + sidebar.scrollTop) + 'px)';
    if (pill.hidden) pill.hidden = false;
  }

  function activeTarget() {
    let selected = sidebar.querySelector('#note-pages [aria-current="page"]') ||
      sidebar.querySelector('nav button.active');
    // A selected note is not a visible navigation target once its section is
    // collapsed. Clearing the surface prevents a stale floating highlight.
    if (selected?.closest('#notes-tree:not([open])')) return null;
    if (selected && !visible(selected)) {
      const group = selected.closest('details');
      const summary = group?.querySelector(':scope > summary');
      selected = visible(summary) ? summary : null;
    }
    return selected;
  }

  function paint() {
    if (hovered && !hovered.isConnected && pointer) {
      const target = document.elementFromPoint(pointer.x, pointer.y)?.closest('nav button, #show-settings');
      hovered = target && sidebar.contains(target) ? target : null;
    }
    positionPill(activePill, activeTarget());
    positionPill(hoverPill, hovered);
  }

  function updateSections() {
    for (const section of sidebar.querySelectorAll('.sidebar-section')) {
      const open = sections.get(section.dataset.section);
      if (section.open !== open) section.open = open;
    }
  }

  function syncMode() {
    document.body.classList.toggle('hide-sidebar', compact);
    document.body.classList.toggle('sidebar-drawer-open', drawerOpen);
    const expanded = narrow.matches ? drawerOpen : !compact;
    for (const button of [$('#toggle-sidebar'), $('#show-sidebar')]) {
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-controls', 'app-sidebar');
    }
    $('#toggle-sidebar').setAttribute('aria-pressed', String(expanded));
    if (drawerOpen) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
    backdrop.inert = !drawerOpen;
    updateSections();
    syncAccessibility();
    schedule();
  }

  function stopDrawerMotion() {
    for (const animation of drawerMotion) animation.cancel();
    drawerMotion = [];
  }

  function drawGesture(offset, width) {
    sidebar.style.transform = `translateX(${offset}px)`;
    sidebar.style.visibility = 'visible';
    backdrop.style.opacity = String(1 + offset / width);
    backdrop.style.visibility = 'visible';
  }

  function clearGestureStyles() {
    sidebar.style.transform = '';
    sidebar.style.visibility = '';
    backdrop.style.opacity = '';
    backdrop.style.visibility = '';
  }

  function setDrawer(open, { velocity = 0 } = {}) {
    const bounds = sidebar.getBoundingClientRect();
    const width = bounds.width;
    const from = Math.max(-width, Math.min(0, bounds.left));
    stopDrawerMotion();
    clearGesture();
    document.body.classList.remove('sidebar-dragging');
    clearGestureStyles();
    drawerOpen = narrow.matches && open;
    hovered = null;
    syncMode();
    $(drawerOpen ? '#toggle-sidebar' : '#show-sidebar').focus({ preventScroll: true });

    const target = drawerOpen ? 0 : -width;
    if (reducedMotion.matches || Math.abs(from - target) < 1) return;
    const duration = 220;
    const difference = from - target;
    const sidebarFrames = [], backdropFrames = [];
    // Sample a critically damped spring so release keeps its velocity and
    // the drawer and scrim can settle on the compositor together.
    for (let i = 0; i <= 16; i++) {
      const time = duration * i / 16;
      const position = i === 16 ? target :
        target + (difference + (velocity + .028 * difference) * time) * Math.exp(-.028 * time);
      const offset = Math.max(-width, Math.min(0, position));
      sidebarFrames.push({ transform: `translateX(${offset}px)`, visibility: 'visible' });
      backdropFrames.push({ opacity: 1 + offset / width, visibility: 'visible' });
    }
    drawerMotion = [
      sidebar.animate(sidebarFrames, { duration }),
      backdrop.animate(backdropFrames, { duration })
    ];
  }

  function toggle() {
    stopHover();
    if (narrow.matches) { setDrawer(!drawerOpen); return; }
    compact = !compact;
    localStorage.setItem('hide-sidebar', String(compact));
    hovered = null;
    syncMode();
    $(compact ? '#show-sidebar' : '#toggle-sidebar').focus({ preventScroll: true });
  }

  function trackTarget(event) {
    if (event.type === 'pointerover') pointer = { x: event.clientX, y: event.clientY };
    const target = event.target.closest?.('nav button, #show-settings');
    hovered = target && sidebar.contains(target) ? target : null;
    schedule();
  }

  function endGesture(event, cancel = false) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const { samples, startedOpen, width, offset, moved } = gesture;
    const recent = samples.find(sample => event.timeStamp - sample.time <= 90);
    const elapsed = recent ? event.timeStamp - recent.time : 0;
    const velocity = !cancel && elapsed > 0
      ? Math.max(-2, Math.min(2, (event.clientX - recent.x) / elapsed))
      : 0;
    const projected = offset + velocity * 140;
    const open = cancel || !moved ? startedOpen :
      startedOpen ? projected > -70 : projected > -width + 70;
    setDrawer(open, { velocity });
  }

  function cancelGesture(event) {
    endGesture(event, true);
  }

  function clearGesture() {
    if (!gesture) return;
    gesture = null;
    document.removeEventListener('pointermove', drag, true);
    document.removeEventListener('pointerup', endGesture, true);
    document.removeEventListener('pointercancel', cancelGesture, true);
  }

  function beginGesture(event, capture = event.currentTarget) {
    if (!narrow.matches || event.button !== 0 || gesture) return;
    const bounds = sidebar.getBoundingClientRect();
    const offset = Math.max(-bounds.width, Math.min(0, bounds.left));
    stopDrawerMotion();
    gesture = {
      pointerId: event.pointerId, startX: event.clientX, origin: offset, offset,
      width: bounds.width, startedOpen: drawerOpen, moved: false,
      samples: [{ x: event.clientX, time: event.timeStamp }]
    };
    drawGesture(offset, bounds.width);
    document.body.classList.add('sidebar-dragging');
    capture.setPointerCapture(event.pointerId);
    // Track within the window even if the title bar interrupts pointer capture.
    document.addEventListener('pointermove', drag, true);
    document.addEventListener('pointerup', endGesture, true);
    document.addEventListener('pointercancel', cancelGesture, true);
  }

  function drag(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = event.clientX - gesture.startX;
    if (Math.abs(distance) < 8 && !gesture.moved) return;
    gesture.moved = true;
    gesture.samples = gesture.samples.filter(sample => event.timeStamp - sample.time <= 90);
    gesture.samples.push({ x: event.clientX, time: event.timeStamp });
    const { width, origin } = gesture;
    gesture.offset = Math.max(-width, Math.min(0, origin + distance));
    drawGesture(gesture.offset, width);
  }

  function init() {
    sidebar = $('.sidebar');
    sidebar.id = 'app-sidebar';
    sidebar.setAttribute('aria-label', 'Navigation');
    activePill = el('div', 'sidebar-pill sidebar-active-pill');
    hoverPill = el('div', 'sidebar-pill sidebar-hover-pill');
    for (const pill of [activePill, hoverPill]) {
      pill.hidden = true;
      pill.setAttribute('aria-hidden', 'true');
      sidebar.prepend(pill);
    }
    backdrop = el('button', 'sidebar-backdrop');
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', 'Close navigation');
    backdrop.onclick = () => setDrawer(false);
    edge = el('div', 'sidebar-drawer-edge');
    edge.setAttribute('aria-hidden', 'true');
    handle = el('div', 'sidebar-drawer-handle');
    handle.setAttribute('aria-hidden', 'true');
    sidebar.querySelector('.window-space').append(handle);
    document.body.append(backdrop, edge);
    for (const node of [handle, edge]) node.onpointerdown = beginGesture;
    window.addEventListener('blur', () => {
      if (gesture) setDrawer(gesture.startedOpen);
    });
    // The closing panel is inert. Its visible handle can still be re-grabbed.
    document.addEventListener('pointerdown', event => {
      if (drawerOpen || !drawerMotion[0] || drawerMotion[0].playState !== 'running' ||
          event.target === edge || event.button !== 0) return;
      const bounds = handle.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      event.preventDefault();
      event.stopPropagation();
      beginGesture(event, edge);
    }, true);
    for (const section of sidebar.querySelectorAll('.sidebar-section')) {
      const key = section.dataset.section;
      sections.set(key, localStorage.getItem('sidebar-section-' + key) !== 'false');
      section.addEventListener('toggle', () => {
        if (section.open !== sections.get(key)) {
          sections.set(key, section.open);
          localStorage.setItem('sidebar-section-' + key, String(section.open));
        }
        schedule();
      });
      section.querySelector('.section-add')?.addEventListener('click', event => event.preventDefault());
    }
    $('#toggle-sidebar').onclick = toggle;
    $('#show-sidebar').onclick = toggle;
    sidebar.addEventListener('pointerover', trackTarget);
    sidebar.addEventListener('pointerleave', () => { hovered = null; pointer = null; schedule(); });
    sidebar.addEventListener('focusin', trackTarget);
    sidebar.addEventListener('focusout', event => {
      if (!sidebar.contains(event.relatedTarget)) { hovered = null; schedule(); }
    });
    sidebar.addEventListener('scroll', schedule, { passive: true });
    sidebar.addEventListener('transitionend', event => {
      if (!event.target.classList.contains('sidebar-pill')) schedule();
    });
    sidebar.addEventListener('click', event => {
      // Navigation can replace its button before this event reaches the sidebar.
      const path = event.composedPath();
      if (drawerOpen && path.some(node => node.nodeName === 'NAV') &&
          path.some(node => node.nodeName === 'BUTTON')) setDrawer(false);
    });
    sidebar.addEventListener('keydown', event => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) event.stopPropagation();
    });
    document.addEventListener('keydown', event => {
      if (!drawerOpen || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); setDrawer(false);
      } else if (event.key === 'Tab') {
        const controls = [...sidebar.querySelectorAll('button:not(:disabled),summary')].filter(visible);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus();
        }
      }
    }, true);
    const observer = new MutationObserver(records => {
      if (records.some(record => !record.target.classList?.contains('sidebar-pill'))) schedule();
    });
    observer.observe(sidebar, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class','aria-current','aria-pressed','open'] });
    new ResizeObserver(schedule).observe(sidebar);
    addEventListener('resize', schedule);
    narrow.addEventListener('change', () => {
      drawerOpen = false;
      clearGesture();
      document.body.classList.remove('sidebar-dragging');
      stopDrawerMotion();
      clearGestureStyles();
      syncMode();
      if (sidebar.inert && sidebar.contains(document.activeElement)) $('#show-sidebar').focus();
    });
    syncMode();
  }

  return { init, syncAccessibility };
})();
