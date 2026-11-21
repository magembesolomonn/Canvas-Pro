# Regression coverage and test isolation

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## tests/audit-regressions.test.cjs

- Same 5ms polling cadence as before, with a deadline so a stalled bridge fails instead of hanging.

## tests/browser-extension.cjs

- Only this isolated test copy receives fixture-host access. The shipped manifest uses activeTab.
- A stand-in for yt-dlp: platform posts are served by the fixture video instead of downloading from the real site.
- A new CDP target can be inspected before its document exists.
- Observe a real MIME-only video request after arming this tab; no filename extension. A storage write alone does not arm the webRequest listener; the worker learns about armed tabs through rehydrateWatchedTabs (or the watch-media message). Exercise that path so the fixture matches real usage.
- This test host has no yt-dlp binary. Simulate the extractor finding no direct file for Reddit so those posts use the ordinary capture path.
- Fulfil only test documents at platform origins. No real social account/profile is opened.
- Alt + Right-click saves straight away, with no menu and no download. A real browser input event is used, so the page sees a trusted gesture.
- Drag and drop saves the dropped picture through the extension. Real drag events are used, so the page sees the gesture a person makes.

## tests/canvas-electron.cjs

- Disposable libraries and fixture server only. Clipboard calls are stubbed; the user's clipboard is untouched.
- Each gesture starts on empty board. The old offsets stepped only 55px, so the list gesture began inside the sticky note drawn just before it and the pointer landed on that note's text editor instead of the canvas. A 2x2 grid keeps every gesture clear of the items already placed.
- Large board: one tiny original referenced 10000 times. No duplicate file imports or autoplay.

## tests/capture-canvas-view-electron.cjs

- The library view is a paged catalogue. Reach that state the way the app does it: the smart view fills the catalogue, and returning to the library switches back to the paged catalogue.

## tests/capture-network-electron.cjs

- Exercise the production bridge with Electron net.fetch, not Node's different fetch implementation.
- A foreign HTTPS source reproduces the exact invalid-referrer failure from Twitter.

## tests/capture.test.cjs

- Keep the 5ms polling cadence, but never let a stalled job hang node:test.

## tests/extension-media.test.cjs

- Twitter always names a size in the address, so the upgrade must replace that name rather than look for a missing one.

## tests/infinite-canvas-electron.cjs

- With the side islands over the wall, the viewer backdrop must cover the whole window; otherwise the island margins expose moving wall items.

## tests/infinite-perf-electron.cjs

- Performance regression coverage for the virtualised infinite wall. The wall used to materialise every item nine times (45,000 DOM nodes for a 5,000-item library), which made wheel frames take ~100 ms and selection ~18 ms. These thresholds are deliberately generous enough for CI jitter but still fail hard if the wall stops virtualising or selection rescans the DOM.

## tests/invariants.test.cjs

- The band index is what keeps duplicate review fast. If this invariant breaks, real duplicates stop being found and nothing reports an error.

## tests/native-macos-electron.cjs

- 2. No accelerator is bound twice, or one of the two silently never fires.
- 6. A canvas board can still move its window: the toolbar is hidden in that view, so the board has to carry its own drag region, clear of the actions.
- With the sidebar visible it carries the window's drag band, so the board stays fully interactive.
- With the sidebar hidden the board is the only place left to grab.

## tests/navigation-canvas-electron.cjs

- The same patience as the canvas suite: a busy machine needs more than five seconds to open the editor.
- Switching views restores the saved scroll position asynchronously, so the value read straight after `loaded` can still be the pre-restore one. Wait for the position to stop moving before asserting on it.
- Re-entering edit mode by double-click puts the caret where the click landed, so collapse it to the end before typing. Otherwise the text is inserted at the click point and the "ends with" assertion is a coin flip.

## tests/perceptual-hash.test.cjs

- Every single-bit neighbour must share a band, and so must every pair that differs in six bits: eight bands of eight bits means seven differing bits are needed to empty the intersection.

## tests/preferences-electron.cjs

- The gallery pages its catalog, so the library total is tracked separately from the rendered page.

## tests/reliability-electron.cjs

- The library is snapshotted here, once the app has finished starting: the originals watcher moves a deleted file to Trash when it boots, and that is the app working as designed. The health check below must change nothing.

## tests/smoke-electron.cjs

- Synthetic metadata reuses one tiny managed image; only this isolated database is populated.
- Artwork-specific hover checks require an M4A fixture; the WAV fallback is covered below.

## tests/symbol-render.test.cjs

- The fallback must not be cached as a native render, or a later helper build would never be used.

## tests/traffic-light-electron.cjs

- trafficLightPosition is y=22 with a ~12px button, so its centre is y=28.
- Wide window: the sidebar occupies the traffic-light band, so the toolbar can keep its normal inset.
- Hiding the sidebar at any width hands the top-left corner to the toolbar; it has to start after the traffic lights.
- Narrow window: the sidebar is a drawer, so the same safe area applies.

## tests/ui-audit-electron.cjs

- One rule between the two stat groups; the Nearby colours section paints its own, so adding another divider here double-ruled the panel.
- Menu rows are contiguous within and between groups, so the pointer never travels over pixels that belong to no row. The highlight itself is inset.

## tests/update-signing.test.cjs

- The helper pins its own public key. Point its key loader at a temporary public key so the real verify function is exercised end to end without ever using the release private key.

## tests/updater.test.cjs

- The detached helper calls quit asynchronously; wait for the event instead of guessing a fixed delay (flaky under load).

## tests/workbench.test.cjs

- The .txt files are outside the fingerprint formats, so only real pictures are ever queued; a NULL fingerprint is pending work.

## Browser-executed test scripts

- Stub the Reddit extractor result so the post-discovery scenario can run without downloading video.
- Poll for selection after Show in Library loads the paged catalog.
- Measure the preview footer after its reveal settles. Image load alone can precede the final layout.
