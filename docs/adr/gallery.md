# Gallery, canvas and selection

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## src/app.js

- The gallery footer is the file name plus, when present, the tag count. These match the line heights in .card-name and .card-details.
- macOS inserts the chosen emoji into whatever editable field has focus. A one-pixel capture field lets the real Apple picker do the choosing, with no second dialog of our own in front of it.
- The macOS picker inserts into whichever field has focus. While a modal dialog owns the keyboard everything outside it is inert, so the capture field must live inside the open dialog or focus() would silently fail.
- Every surface that opens from a control remembers where the gesture began. Dialogs, popovers and the preview all reveal from that same trigger instead of scaling from the centre of the surface.
- A context menu opens at the pointer, so its trigger is a point, not a button.
- A key continues after the last row no matter how many imports arrived. The offset retry is only needed for the sort orders that have no key.
- A loaded page is a refresh as far as capture counters go, so the first browser capture does not force the whole catalogue out of paging.
- The wall needs the full library even when a prior full refresh left the paged catalog off.
- Load the whole library for the unbounded wall. Going through refresh() here would re-enter render() -> hydrateCatalog() and keep replacing the asset set, so update the catalog directly and ask the wall to rebuild.
- Hydrate in bounded pages. One IPC response containing every row (with parsed tags, capture JSON and analysis JSON) made a large library freeze for seconds when the wall or a smart view opened.
- This replaces the whole catalog, so it is a refresh as far as the capture counters are concerned. Without this, captures after the wall has been opened see stale counters and force a needless full refresh.
- Library views are paged. Replacing the catalogue with a 500-item snapshot here silently stranded everything older, and paging never resumed. Reload the first page instead so the catalogue stays live and unbounded.
- SmartSearch.schedule() calls render() synchronously for an empty query. Calling it here, after the saved position is pending, lets the first catalogue page be sized to include that position instead of firing off a 120-item request that clamps and discards it.
- The drag hint is useful on a still card, but a native tooltip lingers over video and GIF previews right where the scrub bar appears. Hide it while the pointer is on their picture and bring it back on the filename.
- Cards with no tags render only a title, so their footer is shorter. Using one fixed footer height for every card leaves uneven blank rows. Cards with names hidden take no footer room; when names are shown the layout reserves the footer's real height so the next row starts below it.
- While a saved position is being restored, thumbnails that finish loading can change tile heights. Keep the restored offset instead of sliding the gallery to follow a different anchor, or the view jumps after coming back.
- Switching views reloads the paged catalogue from its first page. The saved place can sit below the rows loaded so far, and the browser would clamp the scroll and lose it for good. Hold on to the pending position until the catalogue is tall enough, and bring in the missing pages.
- Cards are positioned with transforms, so DOM order otherwise stays in import order after sorting. Keep the listbox's reading order in sync with the visual order without re-mounting cards on every scroll frame.
- The canonical filter for the current view/collection/tag/search/type. render() uses it to build `visible`; Select All reuses it after hydration so it spans the whole library rather than just the loaded page.
- The tag chips are a filter bar, not a document: rebuilding every button on each search keystroke made a large tag set churn the DOM. Reuse the nodes and only repaint the pressed state unless the tag set itself changed.
- The wall is its own set of items, independent of the library view it was opened from. Keeping that view's selection index would make clicks on wall items outside it fall back to whatever was selected before.
- The newest selection is the subject: it is the one fully visible in the middle of the stack, and the files selected before it recede behind it. The old fan ran the other way — the first pick sat highest on screen and the file you had just added was pushed down and out of the way.
- A panel that must stay put, because a list is open in it, still gets its cards repainted: the card carries a file's tag count.
- Existing names that match what is being typed, offered as chips under the field. Choosing one runs the field's own change handler, so adding a tag or collection works exactly as if it had been typed and confirmed.
- Keep the note field available for a fresh file so users can write their first note in File Details.
- Saving leaves the panel alone, so the field keeps the cursor and a second word can be typed straight away.
- The Nearby colours section paints its own hairline. Adding a divider here as well drew two rules a few pixels apart.
- Every indexed image contributes its palette; the closest colours win, and near-duplicates are skipped so the strip shows a real variety rather than ten shades of the same colour.
- The picture, not the stage, wears the rounded corners: size the element to the fitted photograph so its radius sits on the photo's own edges instead of in the empty letterbox around it.
- Disabling the focused arrow drops focus to <body> while the modal is open. Keep it inside the dialog by handing focus to its opposite control.
- Palette hits can come from the paged catalog and may not be in memory. Put the returned asset in the map before selecting it, then open it so a click in the palette actually shows the file instead of only highlighting a card.
- Show a file in the library from somewhere else in the app (a canvas, a bookmark). The catalogue is paged, so the file is often not loaded yet and select() would silently do nothing. Load the catalogue first, then select.
- Switching the view starts a page load. Selecting before it finishes is pointless: the load replaces the catalogue and clears the selection. Wait for the catalogue to go quiet, then load the whole library and select.
- render() returns early when the page key is stale, so selection.index can still be missing the file even though it is loaded.
- Setting the layer height can change the scrollbar, which re-fires this observer with the same width. Rebuilding the masonry for a subpixel change re-places every visible card and makes the field shake while a window corner is being dragged.
- Thumbnail zoom springs from the value actually on screen, so repeated presses retarget mid-flight instead of waiting for a fixed animation.
- The details panel needs room. Under 880px it would take a third of the window and leave the gallery one narrow column, so it steps aside and returns as a sheet over the gallery instead of a column beside it.
- A live resize is a burst of resize events. While the native window is being dragged by an edge, Chromium is often a frame behind the window; animating the rails and blurring large layers at the same time turns that lag into visible jitter and stale tiles. Freeze the chrome until the drag settles, then render once more so the settled frame is painted top to bottom.
- Panel drags dispatch a synthetic resize to refresh the layout; that is not a window drag and should not freeze the chrome or force a repaint.
- Clicking the empty surface of the viewer dismisses it, like the Cosmos lightbox. Clicks on the media or its controls keep their own behaviour.
- The native menu accelerator and the renderer shortcut can both observe the same key press; ignore a second toggle within a moment.
- ⌥O toggles the infinite canvas. On macOS Option+O produces "ø", so match the physical KeyO as well as the character. This is handled before the dialog guard so it still works with Settings open.
- A modal dialog owns the keyboard while it is up. Open popovers keep their own key handlers and must not swallow global shortcuts.
- ⌘K is the one command entry point, including from inside the canvas where CanvasWorkspace otherwise claims the same chord for its tray search.
- Hydration fills `assets` with the whole library but only re-syncs selection.order for the infinite wall. Outside the wall, re-sync from the full set matching the current view/filter instead of the loaded page.
- A capture that arrived while this view was loading, or while the window was in the background, is picked up here so the library is never out of date.
- The menu owns Settings, Help and Check for Updates so those commands exist where a Mac user looks for them, with the accelerators macOS expects.
- Native apps draw their chrome differently when the window is not the active one. The page never blurs by itself, so the main process reports it.

## src/bookmarks.js

- A newer extractor version can arrive for an unchanged, already-cached preview (no refetch). Updating metadata is enough; avoid layout/paint churn while scrolling through many saved links.

## src/canvas-workspace.js

- A repaint runs for every visible node on every frame. Writing a style that already has that value still invalidates the element, so only touch what actually changed.
- Where a flick would come to rest. Apple's projection: the distance a gesture keeps travelling as it slows, so the glide ends where the hand was heading rather than where it let go. The rate is gentler than a scroll's, so a board glides a little further and then settles.
- The Library button leaves focus on the viewport, so Escape from there never reaches the tray's own handler. Close it wherever focus sits.
- The tray tiles are absolutely positioned from the scroller's width, so a window resize (or a panel drag) has to invalidate that cached layout.
- A wheel or a glide changes the camera many times a second. The camera is one value, so keep the dirty flag fresh but let a single debounced save cover the whole burst instead of re-arming the timer on every frame.
- The canvas was deleted while its board was open. There is nothing left to save, so the board is let go instead of failing every save and keeping the app from closing.
- Pointer moves can be coalesced. Commit the release position for item drags.
- A flick keeps travelling. The glide carries the hand's speed, so there is no seam between the drag and the movement that follows it.
- The glide ends where the hand was heading, and it can be caught at any point: grabbing the canvas stops it and continues from where it is.
- render() calls this on every board repaint. Reuse the tray when its data has not changed: rebuilding the tiles (and resetting the scroll position) each time makes a repaint tear down work the compositor already did.

## src/infinite-canvas.js

- The infinite view is a justified wall of items that wraps on both axes, so there is no edge to reach. The navigation panels stay above it: items pass behind them while panning. Motion is 1:1 with the pointer or trackpad and coasts briefly when released, like a native scroll view. Only the rows near the viewport are materialised. The wall's geometry is a pure function of `assets` and the viewport, so the rest of the tiling (three pages, measured row pitch, wrapped offsets) is kept as data and row DOM is mounted or recycled as the view moves. A 5,000-item library used to create 45,000 nodes; it now keeps a few hundred at any time.
- Offsets are measured in screen pixels. paint() wraps them by the scaled page size, which keeps drag and trackpad motion exactly 1:1 at every zoom.
- A fling follows the speed of the last ~90 ms, not the whole drag: using total displacement made even a slow 100 px drag coast over 1000 px.
- Scale the row to fill the page exactly, which is what makes it justified. The 3px gaps are part of the page width, otherwise neighbouring pages would overlap by the total gap width.
- Keep tile geometry available for panning and selection. Paint the tile only when its artwork (or its real fallback) can be shown.
- Rebuilding while more of the library loads must not teleport the wall: keep the same fraction of the old and new scaled tiling.
- Wide enough that three pages cover the window even at the smallest zoom.
- Rows are absolutely positioned, so the page needs an explicit width to keep its bounding box (and the seamless tiling) at every zoom.
- Mount only rows whose screen rectangle can be seen. All three pages keep the same rows so the tiling stays seamless at every wrapped position.
- The gallery is hidden behind the wall but stays in the accessibility tree. Sync it whenever the mode changes so leaving the wall restores the library instead of leaving it inert (and unclickable) afterwards.
- Keyboard navigation centres an item that moved off-screen; returning from the viewer must not shift the wall beyond the exact restore.
- Arrow-key navigation follows the wall layout rather than the hidden gallery: lateral keys walk a row, vertical keys pick the nearest column in the neighbouring row. The layout is cached when the wall is built.
- The global key handler passes KeyboardEvent.key ("ArrowRight"); other callers may use the short form. Accept both so horizontal arrows really walk the row instead of falling through to the vertical branch.
- If the opened item is still on screen, leave the wall exactly where it was. Only nudge it back when it drifted out of view.
- Zoom around a screen point, keeping whatever is under it in place. The same helper serves ctrl/pinch wheel and the keyboard zoom shortcuts.
- Thumbnails are plain images; without this a real mouse drag starts the browser's native image drag and the wall stops receiving pointer moves.
- A click only picks the item. Opening is a deliberate double-click or Space, exactly as it is in the library grid.
- Capture can be lost when a native drag or another window takes the pointer. The window fallback releases the wall instead of leaving it stuck in the dragging state.
- Resizing fires continuously while the window is dragged. Rebuilding the tiling re-creates rows, so wait until the drag settles instead of doing it on every frame.
- Geometry data for tests and diagnostics: DOM rows are virtualised, so the stable model is exposed here instead of being inferred from mounted nodes.

## src/media.js

- A priority request supersedes a non-priority one that is still in flight (typically a deferred lookup). Fall through to start a fresh priority request and replace the in-flight entry, so the player never waits on the slow deferred request. The identity checks below still keep the old request from overwriting the cache or deleting the replacement entry.
- Give the controls room on very narrow videos while keeping the picture at its natural ratio.

## src/smart-cards.js

- A post's words may need more room than the card reserved (a narrow justified row, an old canvas item whose size was never refreshed). Fit the clamp to whole lines so the text ends in an ellipsis on a line boundary instead of being sliced through a row of letters.
- The gallery reuses a small pool of cards, so a card that leaves the window must leave the observers too. Otherwise every observed card is kept alive for as long as the library is open.
- A post whose metadata fetch failed has no text and no images. Fall back to something identifiable instead of an icon-only blank tile.
- A post is text that reflows: the narrower the card, the more lines it needs, so its height is a function of the width it is drawn at. These numbers mirror the sizing in .smart-link.smart-social-card so the height the layout reserves and the card that is drawn always agree.
- The words sit beside the icon, so their column is narrower than the card.
- Every quote gets one of eight paper tints. The pick is derived from the id, so a card keeps its colour across launches and layouts.
- Fit the quote to the card instead of chopping it: start at a comfortable size, shrink a little if needed, and only add an ellipsis when the text is genuinely longer than the card can hold.
- The page's own picture, in order of preference: the copy saved with the link, then a live fetch of the page image, then the site icon alone.
- A link that never got a page title is named after its own address, so the title would only repeat the line underneath it.
- A link whose page has not answered yet keeps the card's shape: the site's own mark stands in for the picture and the address sits underneath, so a slow connection shows a calm card instead of a placeholder letter.
- Recipe sites publish schema durations as ISO 8601, often with date components (P0Y0M0DT0H45M0.000S) rather than PT45M. Parse the whole value instead of showing it verbatim.
- A recipe is a page you cook from, not a page you read. The ingredients are a checklist that remembers what you already have, and the method stays beside them instead of running far below the fold.

## src/smart-search.js

- Keep search predictable: lexical/FTS (and indexed text/description fields) drive typed results. Automatic visual-vector merging is disabled because it can surface unrelated matches and hide what the user typed.
- The panel is not redrawn under the pointer: a field with the caret in it, or a list of choices that is open, owns the panel until it is done.
- An adaptive poll instead of a fixed 4 second timer: wake up often while the index is working, back off to half a minute when nothing is happening, and stay out of the way entirely while the window is hidden.
- A caption is one sentence about a picture, written by the description model. It is kept beside the file so its words can be found by a search, and it is what names the file and suggests its tags.
- Tag suggestions come from the model on this Mac: the picture is compared with the words, and the closest ones are offered. Nothing leaves the Mac.
- The words the caption used are the best guesses the model has made about this picture, so they are the first candidates.
- Compare with text embeddings in small batches so the worker stays responsive.

## src/tag-suggestions.js

- Tag suggestions from the model on this Mac. The inspector asks this module for a control and a place to show the answers. The module owns the request, the wording and the chips; it only needs to be told how to add a tag. Nothing leaves the Mac: the picture and the words are compared by the local model.
- A description of the picture is better than a fixed word list, so it is written first when the file has not been described yet.

## src/workbench.js

- Colour matching uses CIE Lab distance, not raw RGB. The old rule allowed a distance of 85 per channel, so any file with a dark grey matched a dark swatch and the result looked random. A swatch should mean the same colour, not a colour in the same family: Delta E of 8 covers the palette's own quantisation (5 bits per channel) and nothing more.
- Set the result up before changing views so the single render that follows already has the filter, the ranking and the closest match selected.
- The colour is set after the view changes: switching views clears the filter, and a filter that is cleared shows nothing at all.
- The searchable sheet lives with the command palette so both use the same list; Settings and ⌘/ route here too.
