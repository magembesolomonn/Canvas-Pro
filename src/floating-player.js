(() => {
  const video = document.getElementById('video'), seek = document.getElementById('seek');
  const state = JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'));
  document.body.classList.toggle('light-mode', state.theme !== 'dark');
  window.library.onAppearance(state=>document.body.classList.toggle('light-mode', !state.dark));
  if (!state.id) return;
  video.src = 'asset://file/' + state.id;
  // The floating window is created with no-user-gesture-required autoplay, so
  // it can continue with the original audio state immediately.
  video.muted = !!state.muted;
  video.volume = state.volume ?? 1;
  video.loop = !!state.loop;
  video.playbackRate = state.rate || 1;
  const paths = {
    close: 'M6 6l12 12 M18 6L6 18',
    back: 'M4 4v6h6 M4.6 10a8 8 0 1 1 1.2 7',
    forward: 'M20 4v6h-6 M19.4 10a8 8 0 1 0-1.2 7',
    expand: 'M8 17L17 8 M9 8h8v8',
    play: 'm9 5 11 7-11 7z',
    pause: 'M8 5v14 M16 5v14'
  };
  // Controls fade in on pointer movement and idle out after a beat. The CSS
  // :hover fallback alone flickered because the window is a drag region; the
  // class keeps the reveal stable while the pointer is moving or interacting.
  const card = document.querySelector('.floating-card');
  const HOLD = 1200, LEAVE_GRACE = 320;
  let idleTimer = 0, interacting = false;
  const reveal = () => {
    clearTimeout(idleTimer);
    card.classList.add('controls-visible');
  };
  const scheduleHide = (delay = HOLD) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (interacting || card.matches(':focus-within')) { scheduleHide(); return; }
      card.classList.remove('controls-visible');
    }, delay);
  };
  card.addEventListener('pointerenter', () => { reveal(); scheduleHide(); });
  card.addEventListener('pointermove', () => { reveal(); scheduleHide(); });
  card.addEventListener('pointerleave', () => scheduleHide(LEAVE_GRACE));
  card.addEventListener('pointerdown', () => { interacting = true; reveal(); });
  window.addEventListener('pointerup', () => { interacting = false; scheduleHide(); });
  card.addEventListener('focusin', () => { clearTimeout(idleTimer); card.classList.add('controls-visible'); });
  card.addEventListener('focusout', () => scheduleHide());
  reveal();
  scheduleHide();
  const setIcon = (id, name) => {
    const node = document.getElementById(id);
    node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths[name] + '"></path></svg>';
  };
  const paint = () => {
    setIcon('play', video.paused ? 'play' : 'pause');
    document.getElementById('play').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    seek.value = total ? Math.round(video.currentTime / total * 1000) : 0;
    seek.style.setProperty('--position', Number(seek.value) / 10 + '%');
  };
  setIcon('close', 'close');
  setIcon('back', 'back');
  setIcon('forward', 'forward');
  setIcon('expand', 'expand');
  document.getElementById('close').onclick = () => window.library.floating('close');
  document.getElementById('expand').onclick = () => window.library.floating('restore', { id: state.id, time: video.currentTime, paused: video.paused, rate: video.playbackRate, muted: video.muted, volume: video.volume, loop: video.loop });
  document.getElementById('back').onclick = () => { video.currentTime = Math.max(0, video.currentTime - 10); paint(); };
  document.getElementById('forward').onclick = () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); paint(); };
  document.getElementById('play').onclick = () => video.paused ? video.play() : video.pause();
  seek.oninput = () => { if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value) / 1000 * video.duration; paint(); };
  video.addEventListener('loadedmetadata', () => {
    if (state.time) video.currentTime = state.time;
    if (!state.paused) video.play().catch(()=>{});
    paint();
  });
  video.addEventListener('timeupdate', paint);
  video.addEventListener('play', paint);
  video.addEventListener('pause', paint);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); window.library.floating('close'); }
    else if (event.code === 'Space') { event.preventDefault(); video.paused ? video.play() : video.pause(); }
  });
  window.library.onFloatingRestore(() => { if (!video.paused) video.pause(); });
  paint();
})();
