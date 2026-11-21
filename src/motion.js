const Motion = (() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stop(animations) {
    for (const animation of animations || []) {
      try { animation.cancel(); } catch {}
    }
  }

  function springFrames(from, to, velocity, samples = 18) {
    const difference = from - to;
    const distance = Math.abs(difference);
    const duration = Math.max(180, Math.min(420, 140 + distance * 0.35));
    const omega = 0.028;
    const frames = [];
    for (let i = 0; i < samples; i++) {
      const t = duration * i / (samples - 1);
      const value = i === samples - 1 ? to :
        to + (difference + (velocity + omega * difference) * t) * Math.exp(-omega * t);
      frames.push({ t, value });
    }
    return { frames, duration };
  }

  function springEasing(velocity = 0.05, samples = 18) {
    const { frames, duration } = springFrames(0, 1, velocity, samples);
    if (!frames || frames.length < 2) return { easing: '', duration };
    const first = frames[0].value, last = frames[frames.length - 1].value;
    const span = last - first;
    const points = frames.map(({ value }) => {
      const normalized = span === 0 ? 0.5 : (value - first) / span;
      return Number.isFinite(normalized) ? normalized.toFixed(4) : '0';
    });
    return { easing: `linear(${points.join(', ')})`, duration };
  }

  function animateNumber({ from, to, velocity = 0, render, onFinish }) {
    if (reduced() || Math.abs(from - to) < 0.5) {
      render(to);
      onFinish?.();
      return { cancel() {} };
    }
    const { frames, duration } = springFrames(from, to, velocity);
    const start = performance.now();
    let raf = 0, cancelled = false;
    const step = now => {
      if (cancelled) return;
      const p = Math.max(0, Math.min(1, (now - start) / duration));
      const index = Math.min(frames.length - 2, Math.floor(p * (frames.length - 1)));
      const a = frames[index], b = frames[index + 1];
      const local = b.t === a.t ? 1 : (p * duration - a.t) / (b.t - a.t);
      render(a.value + (b.value - a.value) * Math.max(0, Math.min(1, local)));
      if (p < 1) raf = requestAnimationFrame(step);
      else { render(to); onFinish?.(); }
    };
    raf = requestAnimationFrame(step);
    return { cancel() { cancelled = true; cancelAnimationFrame(raf); } };
  }

  function revealFromTrigger(element, trigger, options = {}) {
    if (reduced() || !element) return null;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const now = performance.now();
    if (element._revealAt && now - element._revealAt < 150) return null;
    element._revealAt = now;

    const source = trigger?.getBoundingClientRect?.() || (typeof trigger?.left === 'number' ? trigger : null);
    let x = bounds.width / 2, y = Math.min(24, bounds.height * 0.18);
    if (source) {
      x = (source.left ?? 0) + (source.width ?? 0) / 2 - bounds.left;
      y = (source.top ?? 0) + (source.height ?? 0) / 2 - bounds.top;
    }
    x = Math.max(-12, Math.min(bounds.width + 12, x));
    y = Math.max(-12, Math.min(bounds.height + 12, y));
    const origin = `${x}px ${y}px`, scale = options.scale ?? 0.94, opacity = options.opacity ?? 0.55;

    const spring = springEasing();
    const easing = /^linear\(\s*-?\d*\.?\d+(?:\s*,\s*-?\d*\.?\d+)+\s*\)$/.test(spring.easing)
      ? spring.easing
      : 'cubic-bezier(.22, 1, .36, 1)';

    for (const animation of element.getAnimations()) animation.cancel();
    return element.animate([
      { transformOrigin: origin, transform: `scale(${scale})`, opacity },
      { transformOrigin: origin, transform: 'none', opacity: 1 }
    ], { duration: options.duration ?? spring.duration, easing });
  }

  const fadeScaleIn = (element, origin, options = {}) =>
    revealFromTrigger(element, origin, { scale: options.fromScale ?? 0.97, opacity: options.fromOpacity ?? 0.82, duration: options.duration ?? 140 });

  return { reduced, stop, animateNumber, revealFromTrigger, fadeScaleIn };
})();