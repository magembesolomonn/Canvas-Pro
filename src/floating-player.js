(() => {
  const video = document.getElementById('video'), seek = document.getElementById('seek');
  let state = {};
  try {
    state = JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'));
    if (!state || typeof state !== 'object') state = {};
  } catch {
    state = {};
  }
  document.body.classList.toggle('light-mode', state.theme !== 'dark');
  window.library.onAppearance(state=>document.body.classList.toggle('light-mode', !state.dark));
  if (!state.id) return;
  video.src = 'asset://file/' + state.id;
  video.muted = !!state.muted;
  video.volume = state.volume ?? 1;
  video.loop = !!state.loop;
  video.playbackRate = state.rate || 1;
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
  const setIcon = (id, name, size = 18) => {
    const node = document.getElementById(id);
    node.replaceChildren(glyph(name, { size }));
  };
  const paint = () => {
    setIcon('play', video.paused ? 'play' : 'pause', 22);
    const play=document.getElementById('play');
    play.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    play.title = video.paused ? 'Play' : 'Pause';
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    seek.value = total ? Math.round(video.currentTime / total * 1000) : 0;
    seek.style.setProperty('--position', Number(seek.value) / 10 + '%');
  };
  setIcon('close', 'close', 15);
  setIcon('back', 'gobackward10', 20);
  setIcon('forward', 'goforward10', 20);
  setIcon('expand', 'expand', 15);
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
    else if (event.code === 'Space' && !event.target.closest?.('button,input')) { event.preventDefault(); video.paused ? video.play() : video.pause(); }
  });
  window.library.onFloatingRestore(() => { if (!video.paused) video.pause(); });
  paint();
})();
