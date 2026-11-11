# Canvas Pro


## Run

### Build from a clean clone

On an Apple Silicon Mac with Node.js, Python 3.9+, and Xcode Command Line Tools installed:

```sh
git clone <repository-url> canvas-pro
cd canvas-pro
npm ci
npm run build:native
npm start
```


## Import and browse

- **Import files / ⌘O:** select multiple files of any type.
- **Folder ↓:** recursively import a folder. Hidden entries and symbolic links inside folders are skipped.
- **Drag and drop:** drop files or folders onto the library.
- **⌘C / Copy file:** copy the selected managed original as a real macOS file, ready to paste into Finder or another app.
- **⌘V:** paste files copied in Finder or an image copied to the clipboard. Text inputs retain normal paste behavior.
- **Space:** open or close a preview of the selected file.
- **Arrow keys:** move through the current filtered and sorted list, including while the preview is open. Up/down step one item, rather than one visual masonry row.
- **Escape:** close preview. **⌘K:** focus search.
- **Quick Look:** use macOS preview for formats that the built-in viewer cannot display. The in-app preview provides consistent next/previous navigation.

## Files and metadata

All file types can be imported. Built-in previews cover browser-supported images, audio, videos, and PDFs. Actual playback depends on codec support. macOS Quick Look provides thumbnails for additional formats when a suitable system provider is installed. Proprietary design files may have no preview; the app displays their extension and keeps their original bytes. It does not edit design documents.

Imports copy originals, never move source files. SHA-256 detects exact duplicates. Importing a duplicate into another collection adds the existing item to that collection. Tags, collection memberships, names, notes, source URL, ratings and Trash state are stored in SQLite. Favourites means a rating of four or five stars. Renaming changes the display name; the managed original retains its storage identifier.

The library is in Electron's application-data directory (normally `~/Library/Application Support/Asset Library/Library`). Use **Library on this Mac** to find the actual location. It contains `originals/`, `thumbnails/`, and `library.sqlite`. Quit the app before copying the entire Library folder as a backup. Never edit the managed originals or database directly. **Export copy** saves an individual original to a chosen location. Trash is reversible; there is no permanent-delete operation yet.

## Finding files

- **Search:** the search field matches words in names, text and metadata. When the on-device model is installed, the same search also returns the pictures that show what you asked for — everything runs on this Mac.
- **Find similar:** File Details → Find similar opens the library filtered to the files that look like the one you picked, closest first.
- **Colours:** clicking a colour in File Details → Colours opens the library filtered to every file that uses that colour, closest first. It is a filter, not a report.
- **Suggested tags:** the sparkles button next to Tags asks the on-device model for words for that picture. Pick the ones you want and they type themselves into the tag field; press Return to add them. Nothing leaves the Mac.
- The sidebar lists Library, Favourites, Tags and Trash. There is no Untagged or Uncategorized view: filter the library by tag or collection instead.
- **Names:** a file whose name says nothing — image.jpeg, Screenshot 2026-11-11 at 10.23.45, IMG_1234 — is renamed once the local analysis has read it. The text recognised in the picture is used first, then what the model sees in it, and only then the kind of file and the day it arrived. The managed original keeps its own name on disk; the library shows the real one.

## Notes, quotes and appearance

Notes live in their own workspace. A note is a list of blocks: paragraphs, headings, bulleted items, checklist items, toggles, tables, trackers, library images and links to other pages or files. Press **Enter** in an empty bullet, checklist item or toggle to return to a plain paragraph. Type **/** in an empty paragraph for the block menu, or **@** to link to a page or file. There is no row of add buttons; the menu is the way in.

Pasted text is saved as a quote and shown on a card with the whole excerpt, shrinking slightly and only then adding an ellipsis. Every card draws one of eight muted paper tints, chosen from the item's identifier so a card keeps its colour. The full preview uses the same tint.

Tracker tables use the app's own calendar for date and month fields: a popover with the usual arrows, months and days, in the app's material, instead of the browser's date control. The stored value stays in the format the tracker keeps ("YYYY-MM" and "YYYY-MM-DD").

The note page sits on the window's own background in both light and dark appearance, so there is no second slab of colour behind the text. File Details shows the preview, the name, notes, tags, collections and properties; the star is on the card and in the right-click menu, and **Copy Path** is in the right-click menu.

There is no chat assistant and no star rating. The star on a card marks a Favourite; finding similar images, colour palettes, automatic tags and text search come from the on-device model in Settings → Experimental.

## Validation

`npm run check` checks JavaScript syntax. `npm test` verifies byte-preserving import, exact duplicate detection, cross-collection duplicate membership, metadata persistence, rating validation and reversible Trash.
Manual acceptance checklist:

1. Import images, video, PDF and a proprietary design file; confirm thumbnails or clear placeholders.
2. Copy two files in Finder and paste into the app; copy an image from another app and paste it too.
3. Select a file, press Space, then Left/Right; confirm each preview follows the filtered list. Test audio/video playback and PDF pages.
4. Open native Quick Look on a design file with a system preview provider.
5. Edit notes and paste text there; ensure it does not trigger a file import.
6. Add tags and collections, rate a file, filter, search, then restart and verify persistence.
7. Move to Trash and restore; verify original source and managed file still exist.

## Later work

Colour extraction/search, browser capture extension, multi-selection and bulk edits, similar-image matching, richer design-format providers, progress cancellation, library location switching, signed installers and automatic backups remain future work. This initial version is not full Eagle feature parity.


## Media and performance update (0.2)

The existing app can be updated in place with `npm run update:mac`. Quit and reopen it afterwards. This replaces only app code, keeps rollback code under `.updates/`, and leaves the asset library intact. Recompile the native media helper with `npm run build:media` if its Swift source changes. `npm run build:mac` includes that helper in a fresh bundle.

- Paste supports Electron 45's asynchronous clipboard API, copied images, Finder files, direct web media URLs and website bookmarks. Recognized media downloads have a 100 MB limit. Other/unavailable web links are retained as `.webloc` bookmarks with their source URL; pages are never executed inside the app.
- Audio/video cards play on hover. Video hover playback is muted; audio hover playback is audible. Leaving the card, scrolling, opening a full preview or switching app stops hover playback. Only one hover player is active.
- Space opens an autoplaying custom player. Audio uses embedded cover artwork when present plus a real decoded waveform; without artwork, the waveform is the primary visual. Click/drag the waveform or timeline to seek. Video has a custom timeline, mute, volume and fullscreen controls. Escape or Space closes the preview, including after scrubbing. Left/right navigates files; arrow keys inside sliders adjust their values.
- The gallery mounts only the viewport plus nearby rows. Selection uses keyed cards rather than rebuilding the library. Thumbnail work runs with at most two tasks; native audio/video analysis runs in a separate process with one active task and a bounded background queue. Thumbnails, waveforms and artwork are cached under the library. Initial analysis takes longer than cached browsing, especially with long media. Metadata for thousands of assets is still loaded into memory; this is not a promise of unlimited scale.
- Drag a card to Finder or another app to copy its managed original. The details pane can be hidden with its toolbar button or Command-I. Reduced-motion, reduced-transparency and increased-contrast settings are respected.

Run `npm run test:integration` on this Mac for isolated Electron checks using sample files from the existing library. It creates disposable test libraries in `/private/tmp`, never modifies the real library or clipboard, and does not replace manual testing of native Finder drag/drop.

Measured on the development Mac: 10,007 test assets, 15 mounted cards at the test window size, approximately 1.1 ms average and 1.7 ms maximum over 30 sampled gallery-window updates. These measure JavaScript window updates, not end-to-end scrolling frame rate. Integration checks passed for video autoplay/seek, audio cover art and 512-sample waveform data, no-cover waveform fallback, hover start/stop, and image/link imports. Unit checks cover range requests, virtual-window bounds, clipboard decoding and library integrity.

Design guidance: https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md

## Masonry and app icon update (0.3)

The gallery now packs cards into masonry columns using their own image/video aspect ratios. Thumbnail dimensions are detected on load and cached in SQLite's additive `aspect_ratios` table. Existing originals and metadata remain intact. Audio with cover artwork uses square cards; audio without artwork uses a wider waveform card. Until a thumbnail is available, a temporary default ratio is used; the gallery then adjusts while keeping a nearby item anchored. Extreme aspect ratios are preserved rather than cropped to a uniform frame.

Masonry positions are cached between scroll events. Viewport lookup uses binary search in each column, and only cards near the viewport are mounted. Zoom, resize, filtering and ratio changes recompute positions; zoom keeps the current item anchored. Tests cover varied aspect ratios, non-overlapping columns, persisted ratios and bounded viewport mounting across 10,000 assets. The Mac integration check verified actual 2:3, 1:1 and 16:9 thumbnail sizes and preserved the scroll anchor during zoom.

The provided blue folder-and-slider artwork has been adapted into `src/assets/app-icon.png` (1024×1024, transparent margins), with the full 16–1024 pixel Mac icon family in `assets/AssetLibrary.icns`. The Dock and in-app branding use the artwork; the bundle's `CFBundleIconFile` uses the `.icns`. Run `npm run build:icon` after replacing the master PNG, then `npm run update:mac`. Restart the app after an update. Existing app code, icon and Info.plist are backed up under `.updates/`.


## Canvas Pro and browser capture update (0.4)

The installed app is now **Canvas Pro.app** in Applications. Its bundle identifier stays stable and it reuses the existing `~/Library/Application Support/Asset Library/Library` whenever that library exists, so renaming does not create an empty collection. Fresh installs use Canvas Pro application data. Quit and reopen after updating. Previous app code remains under `.updates/`.

### Selection and motion

Click selects one file; Command-click toggles individual files. Shift-click and Shift-arrow extend a range from the anchor; reversing the arrow shrinks it. Up/down follows a masonry column. Command-A selects the filtered view, Escape clears it. Multiple selections stack up to five previews in File Details and provide combined size/types, file names, bulk tag additions, collection assignment, ratings, reversible Trash/restore, copying, export and multi-file Finder drag. Space previews selected files as a group; close it to keep the selection. Bulk operations are transactional and preserve unrelated metadata.

The left toolbar button or Command-B hides the sidebar. Command-I still hides File Details. Sidebar visibility and tile size are remembered. Motion uses short, interruptible opacity/transform transitions for panels, controls and selection stacks, respecting reduced-motion settings. Selection paints only mounted cards and coalesces details rendering per animation frame. SQLite import ordering is indexed, asset lookups/updates reuse statements, captures stream to disk outside the UI path, and background capture refresh preserves text edits already in progress.

### Browser extension

See `chrome-extension/README.md` for setup and feature details. The extension supports contextual image/video/audio saving, links, selected text, readable page content, viewport/region screenshots and a batch-image picker. Captures include source metadata, and native media analysis adds duration, dimensions and embedded title/artist/album information when available. The extension communicates over native messaging and a user-only Unix socket, not an exposed local web server. It can open Canvas Pro when you initiate a capture. It does not defeat DRM or download browser-only/HLS/DASH/authenticated streams.

Run `npm run install:extension` to register the native host and copy the unpacked extension to `~/Library/Application Support/Canvas Pro/Browser Extension`. The user then loads that folder in Chrome or Helium's Extensions page; browser activation is never done by editing preferences. `npm run update:mac` now targets the installed app first and retains the Canvas Pro name. The project bundle can be updated by passing its path to the update script.

### Verification

15 unit checks cover storage integrity, duplicate races/restoring trashed imports, transactional bulk actions, selection semantics, masonry bounds, byte-range requests, clipboard decoding, native frames and capture validation/provenance. Isolated Mac UI checks use 10,012 assets and verify shift selection growth/shrinkage, Command-click, stacked details, bulk tags, sidebar expansion, media autoplay/seek, hover lifecycle, cached ratios and zoom anchoring. Window updates stayed below 2 ms in sampled warm-cache passes; this is JavaScript update timing, not a blanket frame-rate guarantee. Browser integration tests verify the extension/native host with a disposable local fixture profile; the user's actual extension still needs the one-time Load unpacked action.


## Context menus and Trash (0.5)

Right-click a file to open its native Mac context menu. Right-clicking a selected file preserves the whole selection; right-clicking an unselected file selects only that file. The menu offers preview, single-file rename/open, tags, add/new/remove collections, ratings, copy, export, Show in Finder, source website/URL copy and the native macOS Share submenu. Share destinations are chosen by the user; opening the menu does not automatically transmit files. The large preview supports the same file context menu. Collection sidebar items have rename/remove menus. Removing a collection preserves its files.

Trash has a macOS empty Trash icon and explanatory copy. Move to Trash remains a reversible database flag. In Trash, Restore, Delete Permanently and Empty Trash are available. Permanent deletion and Empty Trash always require a native confirmation with Cancel selected by default. The latter affects all files in Trash, even when a filter hides some of them, and the confirmation gives the full count.

Permanent deletion removes the library's managed original when no other record references it, UUID-associated thumbnails, media-v1/media-v2 (and matching future version) waveform/artwork/poster caches, aspect-ratio/capture metadata and the asset record. Native media work is cancelled/drained first to prevent cache files reappearing. The app's web preview cache is cleared afterwards. Import-source files and unrelated library assets remain untouched. Files outside the managed library are rejected as deletion targets.

Files are briefly staged inside `.deletion-staging` with a journal before the database transaction commits, then unlinked. Failed transactions restore staged files and keep the Trash records. On restart, interrupted uncommitted staging is restored; committed staging is removed. This is application crash recovery, not secure disk erasure or deletion of external backups/exported copies.

`npm run test:trash` runs a disposable-file Electron test of right-click selection, native menu construction, tagging/collections, cancellation, permanent cleanup and Empty Trash. Unit tests additionally cover out-of-library path rejection, rollback, startup recovery on both sides of commit, and keeping original import sources. No files in the actual user library are deleted by these tests.

### 0.5.1 — Hover video and selection polish

Video hover controls overlay the picture without changing its aspect ratio. Moving the cursor across a hovered video scrubs continuously; clicking the picture keeps autoplay running. The preview toolbar no longer includes Quick Look, sidebar toggles use rounded split-panel icons, and selected cards and keyboard focus use light grey. Opening a preview focuses its dialog instead of highlighting Close.

Validated with 23 unit tests and the isolated Electron smoke test, including cursor seeks at 20%, 50%, and 80%, full-height hover video geometry, autoplay, preview focus, and a virtualized 10,000-item gallery.

### 0.5.2 — Audio and inspector sizing

Shorter waveforms, embedded audio cover art or a fallback audio icon in file details, natural image sizing in the inspector, and a single subtle focus border around the search control. Verified with isolated Electron integration and clipboard tests, including artwork, missing artwork, waveform height and inspector image proportions.

### 0.5.3 — Audio hover and Space

Audio hover displays embedded artwork or the audio icon above its timeline, without a waveform. Space opens the hovered audio preview even when its timeline has focus. Verified by the isolated integration and clipboard suites, including focused timeline keyboard dispatch.

### 0.6.0 — Format viewers and restrained glass

Subtle sheen, translucent preview controls and thin highlights, with reduced-transparency and high-contrast fallbacks. Heavy viewers load only when needed. Added native PSD previews, local EPS decoding, offline EPUB/HTML/MHTML reading, SWF via bundled Ruffle, and interactive 3DS/3MF/DAE/IFC/PLY/STL/GLB viewing. More image/video extensions route to their appropriate decoder. See [FORMAT-SUPPORT.md](FORMAT-SUPPORT.md) for precise compatibility and limits.

Validated with 23 unit tests, playback/selection/clipboard integration tests, native context/Trash checks, and fixtures for PSD, EPS, JPEG-compatible INSP, EPUB, HTML, MHTML, SWF and all seven model types. No user library files were modified by testing.

### 0.7.0 — Reliability and speed

Fixed all seven findings from the 2 November audit: imported-file identity now comes from the managed snapshot; transient metadata failures can recover; large selections share a consistent backend contract; Import recreates a closed Mac window; MHTML resolves relative embedded images; held Space no longer toggles preview repeatedly; and saved tag normalization is reflected immediately.

New sidebar controls:

- **Import activity:** queue additional file/folder imports, see recent per-file outcomes, cancel jobs and retry failures. Cancelling stops further work and cleans up an unfinished managed snapshot; an OS file-copy call may finish before cancellation takes effect. Activity is retained for the current app session; retrying a cancelled folder safely deduplicates files already imported.
- **Library health:** run or cancel a background, read-only scan of originals for missing files, changed hashes/sizes and unsafe paths. It never repairs, deletes or rewrites originals or database records. Checks include files in Trash. The panel shows up to 100 issues.

STL/PLY/3DS/IFC decoding now runs in cancellable workers, reducing the initial viewer bundle from 4,354,315 to 753,057 bytes (82.7%). Background media analysis gives previews priority and cancels offscreen gallery work. Gallery refresh preserves its visible anchor, and shutdown drains active file writers before closing SQLite.

Validation: 35 unit tests, eight release regressions, real Electron health/import/cancellation tests, the playback and clipboard suites, 14 format fixtures with model-worker cancellation checks, native context/Trash tests, and isolated browser-extension capture. All testing uses temporary libraries and copies of fixtures. No personal assets were repaired or deleted.

Run `npm run test:reliability` for the release regressions and new UI flows. Historical audit evidence remains unchanged in `audits/2026-11-02`; current regression evidence is under `tests/regressions/evidence`.

### 0.7.1 — Minimal preview and Settings

Removed the preview filename/header strip and side-mounted arrows. A bottom-centred navigation row now shows previous, item number / total, and next, with a quiet close control in the top-right corner. Space, Escape, arrow-key browsing and media playback remain available.

The sidebar now has one Settings entry with a gear icon. Import activity, Library health, Browser capture extension and Library on this Mac live in Settings. Closing the activity or health tool returns to Settings when opened from there. Verified with the actual preview geometry/navigation and Settings-to-tool-to-Settings flows, plus playback and clipboard integration checks.

### 0.8.0 — Mac shortcuts, gallery layouts and sidebar glass

- Command–Delete / Command–Backspace moves selected files to Trash. It does not permanently delete files, and text fields retain their normal editing behavior.
- Command–S toggles the sidebar; Command–B remains an alias. Command–F searches (Command–K also works), and Command–Comma opens Settings. Existing import, copy, paste, select-all and preview shortcuts remain available. Settings contains a keyboard shortcut reference.
- The four-square toolbar button opens a keyboard-accessible layout picker: Masonry balances column heights, Waterfall fills columns in sequence, and Justified fits media into rows. All preserve media proportions and virtualize large libraries. View choice and sort order persist across restarts.
- Oldest first sorts by original import time, with insertion order breaking same-timestamp ties; Newest first uses the reverse chronology.
- The Mac sidebar now uses native vibrancy with a restrained translucent tint. The content area remains opaque for readability. Reduce Transparency and high-contrast settings disable the native effect.

Validated with 10,000-item geometry/virtualization tests, real Electron Mac-key events, reversible bulk Trash operations, text-field protection, layout-menu keyboard controls, stable import sorting, persisted preferences and reduced-transparency rendering. Run `npm run test:preferences` for the isolated application checks.

Native material APIs: [Electron window vibrancy](https://www.electronjs.org/docs/latest/api/browser-window) and [native theme/accessibility preferences](https://www.electronjs.org/docs/latest/api/native-theme).

## 0.8.1 — Capture activity and deeper media discovery

The browser extension (0.5.0) now shows a right-side, isolated capture activity panel. Native capture jobs expose the active item, received/expected bytes and import phase. The media picker discovers lazy sources, metadata, JSON URLs and loaded resources, with an opt-in, tab-scoped MIME scan for extensionless public video/GIF files. Apple inline showcase base paths resolve to public MP4s. GIF bytes and animation are preserved; source-page metadata stays attached. Capture requests send the source Referer to sites that require it, without reading browser credentials.

Reload the unpacked extension in the browser and reopen the desktop app. Public media download is supported; DRM, authenticated-only downloads and HLS/DASH assembly remain unsupported. See [extension usage](chrome-extension/README.md). Browser request observation follows the [Chrome webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest) permission model.

Supported social feeds also receive a Canvas Pro post-save icon. Captures are scoped to the clicked post, preserve its permalink, and use public metadata fallbacks when a visible player has no direct URL. Dynamic post insertion is debounced and does not add duplicate controls. Platform endpoints can change; authenticated or protected-only media may remain unavailable.

## 0.8.2 — Twitter download repair

Removed the raw Referer header that Chromium rejected with `net::ERR_BLOCKED_BY_CLIENT`; capture requests now use RequestInit referrer options. A real Electron-network regression test covers source-page URLs, image and video downloads, redirects, duplicates and HTTP failures (`npm run test:capture`). The reported CultureCrave post was tested live with its public 1080p video and image in an isolated library. Successful activity rows disappear after two seconds, and the panel closes when no rows remain; failures stay visible with a clear “Capture failed” label.

## 0.8.3 — Compact library toolbar

The sidebar control sits at the top of the sidebar. A reopen control stays available beside the title when the sidebar is hidden, with Command–S retained. Import folder/files, details, gallery layout and thumbnail size are centred on the same row as type/sort filters and search at normal window widths. The top chrome shrinks from 124 to 88 pixels; narrow galleries keep all controls available on a second row. Verified at the 960-pixel minimum window width and with the existing Electron shortcut/layout suite.

## 0.9.0 — Favourites, collections and rich bookmarks

- An explicit star on cards, in File Details and in the context menu adds/removes Favourites. Bulk selection is supported; star ratings are independent. Existing four/five-star favourites are preserved once during schema migration.
- Fixed the collection context menu dispatching removal to the selected-file handler with no selected IDs. Collection create/rename/remove and membership changes are validated. Cancelling a previously used New Collection dialog no longer repeats its create action.
- Paste/drop HTTP(S) links to save portable `.url` files immediately, without waiting for a page fetch. Existing `.webloc` files remain readable, including lazy recovery of missing URL metadata. Direct copied image bytes still import as images; pasted URL text becomes a bookmark.
- Bookmark covers, titles and site icons use Open Graph/Twitter metadata or a suitable hero image, with locally cached images and a domain fallback. The extension (0.5.2) can supply metadata from the visited page, preserving exposed social covers when anonymous fetching is limited. Sites that withhold metadata or require login may only show their title/domain/icon.
- Opening a bookmark creates a sandboxed in-app web view on demand, separate from the privileged library UI. YouTube and Vimeo URLs route to their embedded players; a real YouTube sample was verified playing. Vimeo's tested DRM-protected sample cannot play in this Electron build; provider restrictions, DRM or login may require the explicit Open in browser action. New windows and automatic downloads are blocked in the preview.
- Save a copy in the web preview stores a self-contained MHTML archive in the same collections, readable through the existing offline reader. It captures the loaded page; it is not an offline video download.
- Performance: no web-view creation at launch; two metadata jobs at a time, capped queue, offscreen cancellation, week-long successful preview cache and failure cooldown. Navigation counts use one pass, and existing gallery cards/images survive metadata edits. A local fixture with 10,000 assets and 200 collections measured ~102 ms refresh and ~5 ms mean collection switching, with 12 mounted cards and one web contents before preview. These are fixture timings, not a guarantee for all libraries/sites.

Validation details: [workflow audit](audits/2026-11-03-workflows.md). Quit/reopen the app and reload the extension to use this release.

## 0.10.0 — Open canvases

Create a named board with **Canvas +** in the sidebar. Select library files and choose **Add to Canvas** from File Details or the right-click menu. Drag files onto a sidebar board, or open a board's Library tray to drag files, bookmarks and collections into place. Normal file dragging targets boards; Option-drag retains Finder export.

Boards support moving and resizing multiple items, editable text, rectangles, ellipses, colours, undo/redo and duplication. Corners preserve proportions; hold Shift for free resizing. Use Space-drag or the Hand tool to pan, pinch to zoom and Command–0 to fit. V/H/T/R/O select the tools; Command–D duplicates. Delete removes board items without trashing the underlying files. Collections remain linked when renamed, and boards reference existing originals rather than copying them.

Layouts save automatically, including when closing or quitting immediately after an edit. Failed saves retain edits and expose Retry. Media plays on request, with one active player; detailed offscreen elements are removed. A lightweight overview replaces distant cards when zoomed out. The workspace has no fixed page boundary, while practical capacity still depends on the Mac and media.

Validation: 56 unit tests, real Electron board editing/import/clipboard/persistence checks, immediate close/quit and failed-save recovery, plus a 10,000-item board fixture. Run `npm run test:canvas`. Undo history is bounded and retained for the current cached board session.

## 0.11.0 — Libraries and canvas refinement

On a new installation, choose **Create library** or **Open existing**. Returning installations retain their current library. **File → New Library / Open Library** and the Library section in Settings let you choose another folder. Switching saves canvas edits, drains active work and restarts the app; it does not relocate or merge originals. Open the folder containing `library.sqlite` and `originals`. New libraries use a new `.canvaslibrary` folder; existing folders are never overwritten. Missing or incompatible libraries prompt for another location instead of silently creating an empty replacement. Keep the entire library folder together when moving or backing it up, with Canvas Pro closed.

The canvas library tray now uses each image/video's proportions and virtualizes its columns. Command-click toggles multiple files; Shift-click selects a range. Drag the selection together, with a file-count badge. Videos preview on hover and release on leaving; playing board videos remain draggable, including in group selections. Pointer-position scrubbing is disabled on the board and tray; use the timeline controls. Library-gallery hover scrubbing remains available. Video players have a persistent Loop toggle.

New/edited text boxes fit their contents. Existing items have **Fit text to content** and **Fit frame to media** actions in the inspector. A move cursor identifies draggable canvas content. Original-file lookup rejects paths or symbolic links that escape the library's originals directory.

Validation includes 59 unit tests, native first-launch/create/cancel/switch/relaunch flows, generated-video hover/loop/multi-drag checks, natural tray proportions, text bounds, canvas lifecycle/persistence and existing playback/bookmark/Trash/preferences/import/health regressions. `npm run test:libraries` and `npm run test:canvas` use temporary libraries.

## 0.11.1 — Audit fixes

Fixed bookmark-import cleanup deleting a committed original after optional metadata failed, damaged-preference recovery, missing-original context menus, and collection renames during queued imports/browser downloads. Run `npm run test:audit` for the targeted regressions. The broader audit and concrete public-launch blockers are in [ship readiness](audits/2026-11-03-ship-readiness.md). This development-signed, Apple Silicon build is not yet a general-public distribution release.

## 0.11.2 — Crash recovery

Added a recovery prompt after an unexpected app-view crash, regeneration of damaged media metadata caches, and journals to clean incomplete imports after force quit while retaining committed originals. Fixed stale canvas text in the inspector. Run `npm run test:stress` for isolated intentional process-kill, disk-full, rapid-navigation and renderer-crash tests. Details and limits: [crash stress report](audits/2026-11-03-crash-stress.md). Unsaved edits may be lost in a crash; saved data recovery is what these tests verify.

### Smart content and local search (0.12)

Bookmarks now use public page metadata to distinguish articles, books, films and TV, music, recipes, products and social posts. Books and PDFs use a book treatment; songs use discs, albums use sleeves and records. Available ratings, runtime, authors and prices come from the source, not generated guesses. Missing or protected metadata falls back to a normal bookmark. Music and video providers can require an internet connection or login for playback.

Reader mode saves extracted article text into the library's thumbnails folder and renders it without page scripts, advertising or popups. It works offline after extraction, with a cached cover; it does not archive every embedded image. Blocked pages can use public web archives or the reader service when that setting is enabled. Selected text and local text files have note/quote previews. Originals remain portable files.

Settings → Local intelligence controls background indexing and the optional approximately 156 MB visual model download. OCR, image classification, palettes and text search run locally; CLIP adds descriptive image search. No files or search queries are uploaded. Recognition is probabilistic and works best with English descriptions. Automatic tags are separate from your manual tags. PDFs index up to their first 15 pages. New files become searchable progressively as background indexing completes; you can pause it. Model files are verified against pinned checksums and are stored in Application Support, separately from the library. They can be downloaded again after resetting a Mac.

Visual model: [Xenova CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32), MIT license, revision `6b7c523703ae26e39be4b03774966f8571c7f523`. Reader extraction uses Mozilla Readability; inference uses Transformers.js and ONNX Runtime. Bundled notices are in `src/vendor`.

Light mode uses two colours: `#FFFFFF` for panels, cards, fields, menus and sheets, and `#F5F5F7` for the window behind them, selected rows and the strips inside a sheet. Menus follow the Finder: a plain white sheet, plain text, thin rules between the groups, a checkmark for the chosen item, and no accent colour. Type is the system font at 13px, corners are 10px for a window, 8px for a card and 6px for a button or field, and motion uses one curve (`--ease-out`) at 150ms and 250ms.

Canvas Pro follows macOS light/dark appearance. Video previews fit each file's actual aspect ratio; black pixels encoded into a source video remain part of that video.

Build additions: `npm run build:smart`, `npm run build:analysis`. Integration verification: `npm run test:smart` (expects the verified test model in `/private/tmp/canvas-smart-model`) and `electron tests/video-aspect-electron.cjs`.

### Current source prototype (not packaged)

Run `npm run prototype` for a separate persistent prototype profile and blank library in `.prototype/`. This leaves the installed app and your regular library alone. No new DMG or extension ZIP has been built for this iteration. Load `chrome-extension/` unpacked in a test browser profile to try the browser side panel (Chrome 116+).

The prototype adds file undo/redo, palette colour matching, visual find-similar, a searchable shortcut reference, optional backup reminders, library backup and hash-verified missing-original recovery. File undo covers metadata and collection membership, not permanent deletion or imported file bytes. Identical imports are already deduplicated by hash; visual similarity requires completed local indexing and remains a review aid, not proof of duplication.

Create a collection/canvas with an optional macOS symbol or single emoji; change it later from its context menu. Icon choices and backup preferences live in the portable library database. PNG and PDF canvas exports support the whole board or a selection, with cached media stills; PDF text and shapes remain vectors. Very large boards must be exported in smaller selections.

The unpacked extension collects images/videos in a native side panel rather than a new tab. Scan loaded media is opt-in; play/scroll the source page to discover more direct media requests, or refresh the panel. Downloads show light-blue progress and per-file saved/duplicate/failed results. Protected or unsupported streams can still fail. Thumbnail fallback uses browser decoding when the macOS decoder cannot provide a poster; unsupported codecs cannot be guaranteed a preview.

A local beta-test checklist and feedback-report export are in Settings. Real people testing on multiple Apple Silicon Macs remain necessary before a public release; the app does not contact testers or send feedback automatically.

Implementation references: [Apple system symbols](https://developer.apple.com/documentation/appkit/nsimage/init(systemsymbolname:accessibilitydescription:)), [Chrome side panels](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [Electron PDF export](https://www.electronjs.org/docs/latest/api/structures/print-to-pdf-options).
