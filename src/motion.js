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

  // A cubic-bezier can only approximate an ease-out; it cannot carry the
  // spring's momentum or its slight overshoot. Feeding the sampled spring
  // points to CSS `linear()` (supported by Chromium in Electron) reproduces
  // the real curve while keeping this file dependency-free. Sample values
  // are pinned to the 0→1 easing range at the ends; any overshoot in between
  // is kept and left for CSS to clamp (harmless for opacity, a subtle pop
  // for scale).
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
      // The first rAF timestamp can predate performance.now() inside the same
      // frame; clamping keeps the sample index valid and the spring alive.
      const p = Math.max(0, Math.min(1, (now - start) / duration));
      // Interpolate linearly between sampled spring points. The spring model
      // already supplies the curvature; easing again here made numbers land
      // late and overshoot twice.
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

  // Trigger-anchored reveal: a menu, dialog or popover grows out of the
  // control that opened it instead of expanding from its own centre. The
  // one shared helper keeps the spatial relationship identical everywhere.
  function revealFromTrigger(element, trigger, options = {}) {
    if (reduced() || !element) return null;
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const now = performance.now();
    // Two listeners can observe the same open (a pointer handler and the
    // popover's toggle event). One reveal per surface per moment is enough.
    if (element._revealAt && now - element._revealAt < 150) return null;
    element._revealAt = now;

    const source = trigger?.getBoundingClientRect?.() || (typeof trigger?.left === 'number' ? trigger : null);
    let x = bounds.width / 2, y = Math.min(24, bounds.height * 0.18);
    if (source) {
      x = (source.left ?? 0) + (source.width ?? 0) / 2 - bounds.left;
      y = (source.top ?? 0) + (source.height ?? 0) / 2 - bounds.top;
    }
    // Keep the origin on (or just outside) the surface so a distant trigger
    // gives direction without stretching the material into an extreme skew.
    x = Math.max(-12, Math.min(bounds.width + 12, x));
    y = Math.max(-12, Math.min(bounds.height + 12, y));
    const origin = `${x}px ${y}px`, scale = options.scale ?? 0.94, opacity = options.opacity ?? 0.55;

    // Reveal with the sampled spring so the surface settles with the same
    // character as the app's other spring-driven motion. If construction
    // ever yields an empty/malformed string, keep the old bezier working.
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