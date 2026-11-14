// Motion helpers aligned with the app's fluid-interaction goals:
// respond instantly, animate from the current value, preserve velocity,
// stay interruptible, and respect reduced motion.
const Motion = (() => {
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stop(animations) {
    for (const animation of animations || []) {
      try { animation.cancel(); } catch {}
    }
  }

  // Critically damped spring sampled for WAAPI. `from/to` are numbers.
  // `velocity` is in the same units per ms as used by callers.
  function springFrames(from, to, velocity, samples = 18) {
    const difference = from - to;
    const distance = Math.abs(difference);
    const duration = Math.max(180, Math.min(420, 140 + distance * 0.35));
    const omega = 0.028; // ~response tuned for UI panels
    const frames = [];
    for (let i = 0; i < samples; i++) {
      const t = duration * i / (samples - 1);
      const value = i === samples - 1 ? to :
        to + (difference + (velocity + omega * difference) * t) * Math.exp(-omega * t);
      frames.push({ t, value });
    }
    return { frames, duration };
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
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      if (cancelled) return;
      const p = Math.min(1, (now - start) / duration);
      // Interpolate between sampled spring points for smoothness.
      const index = Math.min(frames.length - 2, Math.floor(p * (frames.length - 1)));
      const a = frames[index], b = frames[index + 1];
      const local = b.t === a.t ? 1 : (p * duration - a.t) / (b.t - a.t);
      render(a.value + (b.value - a.value) * ease(Math.max(0, Math.min(1, local))));
      if (p < 1) raf = requestAnimationFrame(step);
      else { render(to); onFinish?.(); }
    };
    raf = requestAnimationFrame(step);
    return { cancel() { cancelled = true; cancelAnimationFrame(raf); } };
  }

  function fadeScaleIn(element, origin, { fromScale = 0.97, fromOpacity = 0.82, duration = 140 } = {}) {
    if (reduced() || !element) return null;
    for (const animation of element.getAnimations()) animation.cancel();
    const bounds = element.getBoundingClientRect(), source = origin?.getBoundingClientRect?.() || origin;
    const x = source ? Math.max(0, Math.min(bounds.width, (source.left ?? 0) + (source.width ?? 0) / 2 - bounds.left)) : bounds.width / 2;
    const y = source ? Math.max(0, Math.min(bounds.height, (source.top ?? 0) + (source.height ?? 0) / 2 - bounds.top)) : 0;
    const transformOrigin = `${x}px ${y}px`;
    return element.animate([
      { transformOrigin, transform: `scale(${fromScale})`, opacity: fromOpacity },
      { transformOrigin, transform: 'none', opacity: 1 }
    ], { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' });
  }

  return { reduced, stop, animateNumber, fadeScaleIn };
})();