# Open comment-audit issues

Repository-local issue records. GitHub publication is pending authentication.

## 1. Give bookmark extraction versions and visual-search eligibility a single source of truth

The renderer and main process independently declare EXTRACTOR_VERSION in src/bookmarks.js and electron/bookmarks.cjs and the visual extension list in src/workbench.js and electron/smart-index.cjs. Updating only one side can leave old bookmark previews in place or offer a similarity action for a format the indexer skips. Expose the canonical values to both consumers and test stale preview refresh and eligibility through their public entry points.

## 2. Invalidate the infinite wall when interior assets change

src/infinite-canvas.js uses itemsSignature() to decide whether to rebuild an active wall. The signature includes the count, trash count, first and last IDs, width, and name visibility. A middle item can change identity, order, or aspect ratio without changing those fields. Track a relevant catalog or layout revision and add a regression that changes an interior item while retaining both endpoints and total count. Preserve the large-library view-switch performance budget.

## 3. Consolidate full-player control styles across appearances

src/style.css contains overlapping player-controls rules that rely on selector weight, !important declarations, and source order to override earlier capsule styling. Consolidate the rules by player mode and theme. Verify preview, canvas, and compact gallery controls with both appearances, including keyboard focus, seek, and volume.
