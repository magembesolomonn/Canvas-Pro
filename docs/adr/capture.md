# Browser capture and page permissions

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## chrome-extension/activity.js

- Runs in the isolated extension world. Never inserts page-provided HTML. A copy that is placed into a page later than the first one replaces the earlier copy; this counter shows which copies are present.
- The inline copy is tried first: it is immune to the page's own rules about which images may be loaded.
- A capture that never finishes must not leave its card on the page for good. The card goes after a while; a later report re-opens it.

## chrome-extension/collector.css

- The collector is the extension's browser side panel. Chrome and Helium dock it on the right; this inset shell gives the content the same 8px radius as the rest of the extension instead of sitting flush against the browser edge.
- Keep the sticky controls inside the rounded shell while the panel scrolls.
- Light OS appearance uses the popup's light palette so the side panel reads as the same product. Dark above stays the default.

## chrome-extension/popup.css

- Canvas Pro Capture — popup The same system as the desktop app: one neutral palette, paper-white cards on a soft grey window, hairline borders, semibold headings over regular body copy, and one focus colour. Dark mode follows the OS.

## chrome-extension/popup.js

- The same failure can arrive twice: once from the capture record and once from the request that started it. Only one card is shown.
- A toast is a small status card with an icon, a title, an optional detail and an optional remaining-time bar. Duration 0 keeps it until dismissed.
- The popup keeps one plain status line. The capture itself reports on the page, so no card is left behind here.
- Opening the popup grants access to the page behind it. That is the moment a tab which was already open when the extension was updated can receive the current scripts, so Alt+click and drag-and-drop work there again.

## chrome-extension/quick-save.js

- An older copy of this script may still be attached to a page that was open when the extension was updated. Its context is dead, so its calls reject with "Extension context invalidated". Those rejections are noise once this copy is running, so they are silenced instead of surfacing as errors.
- The newest copy takes over: it bumps the generation and rebinds its handlers, so an older copy in the same page stops taking action.
- An empty attribute resolves to the page itself, which is never the file.
- The page shows a resized copy of the picture. The original file is asked for instead, so what is saved is full quality and not the thumbnail.
- A <video> that plays a blob: address is a streaming player; the page keeps the real file in its metadata instead. Ask the shared resolver, which knows how to read VideoObject/og:video without site-specific rules.
- The element directly under the pointer decides what is saved. The first picture or video found in the pointer's own path is the one that was clicked, even when the other kind sits nearby.
- The first media element in the pointer's path is the one that was clicked. A picture under the cursor beats a video that lies behind it.
- A real thumbnail of the thing being saved, drawn in this page so the toast can show the image or a video frame instead of a generic icon.
- a cross-origin picture cannot be read back
- Alt+Right-click on a video opens this instead of saving blind, because a player can offer more than one thing worth keeping. It is the extension's own surface: the browser's menu cannot act on a blob: source.
- The focused media of the last right-click, for the browser's own context menu entry, which cannot see blob: sources.
- The worker asks the page to show progress; this script is on every page. The card it draws is the single toast for a capture, so this script does not add a second one.
- Supported social hosts keep their own focused-media handler, which knows about post galleries. Everywhere else this is the only one, and it is what lets the browser's context menu resolve a streaming video.
- The message never reached the worker, so nothing was reported on the page. Say so here, once.
- A refusal from the worker is already on the page as its own card.
- Alt + Right-click (or Alt + click) saves immediately. The browser's own "save the page" behaviour is suppressed so the extension handles it.
- The pointer may land on the card around a player rather than on the player itself. Only for the Alt gesture: a drag must not pick the page's only video just because it happens to exist.
- A right-click reaches us through contextmenu; listening to the mouse-down as well would save before the menu could be shown.

## chrome-extension/social-core.js

- The page shows a resized copy. The original file is asked for instead, so what is saved is full quality and not the thumbnail.
- Streaming players (Media Source Extensions) show a <video> whose source is a blob: address that nothing outside the page can download. Many of them still publish the real file in declarative metadata, so read that instead of guessing. Cosmetic: no site name appears here.
- A feed can show dozens of players, so a page-level answer is only trusted when the pointer's own container identifies exactly one video. With no container and several videos, saying nothing beats saving the wrong clip.
- One player on the page means the player's own metadata is unambiguous.
- An overlay can be the only hit when the slide itself ignores pointer events.
- Some Instagram players put the cover beside the video instead of on it.
- Structured metadata is used only within this post, never another feed item.

## chrome-extension/worker.js

- Remember only the tabs the person has actually used for capture. Worker wake-ups then re-inject those tabs instead of every open web page.
- The page's own content script shows the toast. Injecting it directly needs permission for that site, which the reader may not have granted, and the toast would then never appear.
- Browser/internal pages may prohibit overlays; the popup retains progress.
- Thumbnails come in two parts: the original address (cheap, and usually allowed by the page) and an inline copy (used when the page's own rules block the address). The toast tries the address first, then the inline copy.
- A page that was already open when the extension updated still runs the old content script, whose extension context is dead ("Extension context invalidated"). Re-injecting the current script restores Alt+click and drag-and-drop there without asking the reader to refresh every tab. A page that was already open when the extension updated still runs the old content script, whose extension context is dead ("Extension context invalidated"). Re-injecting the current scripts restores Alt+click and drag-and-drop there, so the reader does not have to refresh every tab. The capture card lives in activity.js, so it must be injected too: without it the page would save the file and show nothing.
- The worker starts again after every idle period and after every update. That is the moment to put the current scripts back into the pages that were already open, so their quick save keeps working. The sweep is throttled because the worker wakes often.
- A blob: source is a streaming player on any site, not just the supported social ones. Ask the page to resolve the real file from its own metadata.
- "Save image" on a player means its cover, not the video file.
- Opt-in, tab-scoped media observation. No request bodies, cookies or authorization headers are read.
- Reddit/Facebook/YouTube: use yt-dlp extraction for highest quality (and merged A/V).
