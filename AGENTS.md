# Canvas Pro — project instructions

## What this is
Electron 45 desktop app, vanilla JS/CSS (no React, no build step for the renderer).
- Main process: `electron/main.cjs`; preload bridge: `electron/preload.cjs`.
- Renderer entry: `src/index.html`, `src/app.js`; global motion helper:
  `src/motion.js` (global `Motion`, loaded before the other scripts).
- Styles load in this order: `style.css` → `sidebar.css` → `islands.css` →
  `select.css`. `islands.css` overrides theme tokens, so check it before
  editing colours in `style.css`.
- The main window's `backgroundColor` must match `--window-surface`
  (`#0a0a0a` dark / `#ffffff` light). Keep them in sync.

## Do not edit
- `src/vendor/**`, `src/formats.js`, `src/model-worker.js`,
  `src/semantic-worker.js`, `src/epub-worker.js`, `src/eps-worker.js` —
  vendored or generated bundles.
- `dist/` and `.updates/` — build output. Rebuild instead (see below).
- `audits/update-signing.key` — private release key; use `CANVAS_UPDATE_KEY`.

## Verify after a change
- Always: `npm run check` and `npm test` (140 tests).
- UI work: also run the matching `npx electron tests/*-electron.cjs`.
  Useful ones: `ui-audit-electron.cjs`, `bookmark-workflows-electron.cjs`,
  `preferences-electron.cjs`, `infinite-canvas-electron.cjs`,
  `capture-startup-electron.cjs`.
- Packaging: `npm run build:mac` refuses to overwrite an existing bundle —
  move `dist/Canvas Pro.app` aside first. Native helpers are ad-hoc signed
  inside the bundle, so verify them with `native-manifest.json`, not a raw
  byte comparison.

## Code conventions
- Motion tokens: `--ease-out`, `--duration-instant` (100ms),
  `--duration-fast` (150ms), `--duration-normal` (220ms). Prefer them over
  one-off durations.
- Animate only `transform` and `opacity`. No `width`/`height`/`margin`
  transitions. Popovers and dialogs use `Motion.revealFromTrigger`.
- Every animation must be guarded by `prefers-reduced-motion` (CSS) or
  `Motion.reduced()` (JS).
- Light mode is a token set on `body.light-mode`, not an inversion. Never
  hardcode a dark-theme colour without a light-mode counterpart.
- IPC handlers must validate the sender with `trusted(event)` and validate
  URLs with the public-host guards (`browser-fetch.cjs`, `public-fetch.cjs`).
  Follow redirects manually and re-validate every hop.

## Working with agents
- For audits: read-only, report severity + exact `file:line` + quoted code +
  real-world failure mode. Verify callers before claiming a bug.
- Before large edits, agree on a plan and explicit file ownership when
  parallelising.
- After fixes, re-run the verify commands above and report the output.
- Do not commit unless the user asks.
