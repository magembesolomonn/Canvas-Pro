# Desktop lifecycle and platform integration

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## electron/browser-fetch.cjs

- Chromium's network stack sends a real browser TLS/HTTP2 fingerprint, which is what Cloudflare-protected recipe sites require. The raw node:https fetcher in public-fetch.cjs is rejected by them (403/402) even with browser headers. Chromium does not pin DNS the way a custom `lookup` does, so the guard has to happen here instead: every hop is resolved first and refused unless it points at a public address. That keeps the same SSRF rule as public-fetch.cjs while the request itself goes through the browser stack.
- Chromium leaves url empty for a manually followed redirect, and the parser needs the final address to resolve relative images and links.
- Only the prepared module instance is reused; the Electron import stays lazy so unit tests can load this file without an app.
- Chromium is the one that gets past the block, but a machine with a proxy or a broken browser network should still fall back to the guarded Node fetch rather than fail closed. Address refusals are never retried: the Node path enforces the same rule and would reject them too.

## electron/capture-bridge.cjs

- net.fetch follows redirects by default, so a public media URL could 302 to a private address after assertFetchable ran. Follow redirects ourselves and run the same guard on every hop. This does not use previewFetch, whose short timeout would abort large video downloads.
- Instagram's separate audio track keeps redirect:'error' so neither fetch follows a hop. Other media uses the redirect-guarded fetcher above.
- redirect:'error' means there is no redirect chain to re-validate here.

## electron/extension-setup.cjs

- Registration can precede Chrome installation. No browser preferences are edited.

## electron/main.cjs

- Files dropped on the Dock icon, or opened with Canvas Pro from Finder, arrive as open-file events. They are collected until the library is ready, then imported, so a drop during launch is not lost.
- Some formats have no readable pixel size; the inspector hides it.
- A file that vanished is handled by the originals watcher.
- ImageIO can decode image formats whose extension has no Quick Look generator.
- Large videos take longer than the 12-second preview default; the controller above is the real 5-minute deadline.
- Fall through to other handlers; a bad/unsupported extractor result should not prevent saving the link or trying other resolvers.
- Read the pixel size while the import is still fresh, so the gallery can lay the picture out at its real shape and File Details never has to open the original again.
- Appearance preferences are the user's own: the system look is the default and any override is stored beside the library, never in the app bundle.
- The window is opaque so macOS draws the real window shape and its native shadow. The colour matches the app surface, so a resize never flashes.
- A capture can arrive while the window is still loading. The change is then remembered here and handed to the view once it is ready, so a file saved from the browser shows up straight away instead of after a restart.
- The change is only remembered while the view cannot receive it. Once it has been handed over, it must not be replayed later.
- The window remembers where it was: native apps reopen at the same size and place. Saved bounds are checked against the displays that exist now, so a window last used on a disconnected monitor comes back on screen rather than somewhere off it.
- Some of the title bar has to be reachable, not just a sliver of the window.
- getNormalBounds is the un-maximised frame, so restoring after a zoomed session does not reopen the window filling the screen.
- A window that is shown before its first frame is painted flashes the window background. Show it on ready-to-show instead; the test harness keeps an immediately visible window so capturePage stays deterministic.
- Native apps tell their content when the window loses focus so the chrome can take on the unfocused look. The page never blurs on its own, because it is still the visible document inside the window.
- Resizing a hidden-titlebar window on macOS can leave the freshly exposed edge painted with the previous frame for a moment. Ask Chromium for one full repaint once the drag settles so no stale tiles or panel edges are left behind. Throttle it to the end of the gesture, not every frame.
- ready-to-show is the normal path; this only covers a first paint that never reports itself, so a slow start cannot leave the app invisible.
- The About panel is a system surface: give it the real version and the copyright, so About Canvas Pro is not a blank Electron dialog.
- Fingerprints are filled in quietly in the background: a review should not make someone wait while every picture in the library is decoded, and importing a file should not either. The review dialog polls the pending count, so it can say what it is still looking at.
- Decoding is synchronous, so yield between pictures: one decode per turn keeps scrolling responsive instead of a dozen in a row.
- A late IPC can arrive while the window is closing; reading webContents on a destroyed window throws instead of failing the check.
- Chromium's stack is what gets past Cloudflare's TLS fingerprint checks; the guarded Node fetcher stays as a fallback inside previewFetch. Only a source-launched test process may substitute the raw, unguarded fetcher.
- Test-only hook: tests drive analysis directly because test mode pauses the background indexer. Not exposed to the renderer in production.
- An unpacked Contents/Resources/app folder makes app.isPackaged false in Electron even for a real .app bundle. process.defaultApp is true only when Electron was launched with a source path (`electron .`), so it is the reliable signal for "installed app can replace itself".
- The mini player has its own preload bridge; only accept its commands from that window's main frame, never from arbitrary renderers.
- Safari-style picture in picture: a small window that starts in the bottom corner of the display the app is on, and stays where it is moved.
- Replace any existing mini player before creating the new one. The closing window's handler must not clear the reference to the new one.
- Only the newest query matters. Each request carries a token; older work checks it between batches and stops instead of competing for the event loop after the user has typed another letter.
- The view tells the app when it is ready to receive changes, and when it comes back to the front. A capture that happened in between is handed over then, so the library never looks out of date.
- A disk image or a translocated copy has a temporary path. Only a copied app registers the host.
- The size is learned once, at import or from the first thumbnail, and stored on the row. Reading it never decodes the original on the main thread, so arrowing through large files cannot freeze the window.
- The icon must already exist when the drag starts: macOS ends the drag session as soon as the dragstart event returns, so an await here would leave nothing to drag. The renderer asks for an icon on pointer-down and the visible cards are prepared as they appear; the app icon is the immediate fallback if neither has finished yet.
- macOS requires a non-empty image. A transparent pixel is still a valid drag image, though the app icon is normally found first.
- Always hand over the original files, never the thumbnails.
- The app menu is built explicitly rather than with the appMenu role: the role builds its own submenu, which leaves nowhere to put Settings, and macOS expects Settings… with ⌘, above Services.
- The infinite canvas keeps a native accelerator as well as the renderer shortcut: the menu path is guaranteed to fire even when the page has an open popover or a focused control that would otherwise eat the chord.
- Starting up must never fail silently. A library that cannot be opened needs to say so, and the app has to stay alive long enough to show it.

## electron/native-host.cjs

- Native messaging entry point. Stdout is reserved exclusively for Chrome frames.

## electron/public-fetch.cjs

- Match strict-origin-when-cross-origin: the full path only goes back to the same origin, otherwise the receiving server gets just the origin. A secure page never hands its origin to a plain-text destination.
- Lookup filters the actual socket destination, including after redirects.

## electron/symbol-render.cjs

- Renders SF Symbols through AppKit on demand and keeps the results in a disk cache. The cache key includes the OS version, so a system update naturally invalidates old artwork. If the native helper is missing (for example a source checkout that has not run `npm run build:native`), the handler falls back to the checked-in PNG masks.

## electron/test-mode.cjs

- Test-only switches must not be armed by a launch-time environment variable in an installed build. Electron sets process.defaultApp only when launched from a source path (`electron .`), which is how the test suite runs; an installed .app leaves it unset and ignores these switches entirely.
- Installed builds always verify the Ed25519 signature over the checksum manifest. Source-run development keeps the opt-in behavior for local, unsigned test releases.

## electron/update-signing.cjs

- Update release signing. The private key is kept out of the app and out of source control; scripts/sign-update.cjs uses it to sign the checksum file that ships with each GitHub release. The public key below is embedded in the app, so a checksum published without a matching signature is not trusted.
- A general release must be signed with a Developer ID certificate and notarized by Apple; whether to do so is a release decision. Set this to the released app's Developer ID Team ID to enable the extra check. Empty is the default and disables it; the Ed25519 checksum signature is always required.

## electron/updater.cjs

- Canvas Pro updates: find the newest public release on GitHub, download the signed DMG and its checksum, verify both, then hand the app bundle swap to a detached helper that runs after this process exits. Nothing here touches the library; only the .app bundle is replaced.

## electron/web-preview.cjs

- Both loadURL calls below must start from a public address. The test harness may load its local fixture server, as its other fetches do.
- The cached view may be sitting on a page the user clicked into. A reopened bookmark must show its saved source, not that last URL.

## electron/yt-dlp.cjs

- Both helpers are pinned to a version and a byte-for-byte checksum. The app verifies the checksum on every launch and again after each download, so a changed or truncated binary is never executed.
- prefer the post/comments permalink; yt-dlp resolves it to best A/V
- Best quality available, always MP4: prefer H.264 (avc1) video + AAC audio merged to MP4 for maximum quality with broad compatibility. Falls back to best available if needed.
