# Canvas Pro Capture

A Manifest V3 Chrome extension for the Canvas Pro Mac app. It also passed an isolated Chromium-based Helium test on this Mac.

## Install

Install **Canvas Pro** in Applications and open it once to register the browser connection and install the app-managed extension copy.

1. Open `chrome://extensions` in Chrome or Helium.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `~/Library/Application Support/Canvas Pro/Browser Extension`.
4. Pin **Canvas Pro Capture**, click its toolbar icon and look for **Connected**.

For a development checkout, load the `chrome-extension` folder containing `manifest.json`. The extension ID remains stable because the manifest contains its public key.

If the browser connection needs reinstalling, run `npm run install:extension` from the project root after installing Canvas Pro in Applications. This registers `com.canvaspro.capture` for Chrome and Helium. It does not change browser preferences or automatically enable an extension.

## Capture

- **Post save buttons:** Canvas Pro’s icon appears beside X’s share/bookmark actions, and in the post controls or a small corner button on Instagram, Reddit and Pinterest. One click saves media from that post, with the same right-side activity panel. Feed changes are observed with a debounced observer so newly loaded posts receive a button without duplicates. Browser site access must be allowed for these platforms after reloading the extension.
- Post capture prefers media exposed by that post’s DOM. X can resolve public syndication MP4 variants (highest advertised bitrate); Reddit can resolve its public fallback URL; Instagram/Pinterest try public Open Graph video metadata on the post permalink. These endpoints may refuse access or omit media; the extension reports that failure. It does not read session cookies or bypass private content. Reddit fallback video may omit a separate audio track, and the activity panel identifies this limitation.

- Right-click images, video, audio, links, selected text, or the page to save to Canvas Pro.
- **Capture visible page** saves a screenshot of the current viewport.
- **Capture an area** lets you drag a region; Escape cancels.
- **Find videos & animated media** discovers video/source elements, lazy URLs, media metadata, inline JSON URLs and already-loaded resource URLs. Apple’s `data-inline-media-basepath` showcase format resolves to its public `large.mp4` file. GIFV links on Imgur resolve to MP4. Right-click a blob-backed player to open discovery instead of attempting to download the blob URL.
- **Deep media scan** asks for optional HTTP/HTTPS site access and observes video/GIF response URLs on the selected tab for 30 minutes. Play the media, then choose **Find videos & animated media**. It finds MIME-identified files even without an extension. Stop the scan from the popup; navigating or closing the tab ends it. It does not read cookies, authorization headers, or response bodies.
- Every capture opens a compact **right-side activity panel** with item title, download bytes/size (when reported by the server), library-import phase, saved/duplicate results and errors. Captures remain visible when the popup closes. Screenshots exclude the panel itself. Batch captures show activity on both the source page and picker.
- **Collect images** opens a picker. Filter by width, choose up to 100 and save to a collection.
- **Save page content** saves readable page text (or the current text selection) as a Markdown file, with a source URL and capture time. This is a text snapshot, not an offline copy of the entire website.
- **Save web link** keeps a bookmark.
- Optional extension shortcuts: Option-Shift-S for viewport capture and Option-Shift-C for a region. Change them in the browser extension shortcuts page.

Saved metadata includes source page title/URL, capture time, media URL, author/description/alt text when exposed by the page, and available image/video dimensions and duration. The desktop app extracts additional media properties and shows them in File Details.

Direct HTTP/HTTPS image, audio, PDF and video files are supported. The picker can recover underlying public files when a player uses a blob URL. Pure in-memory blobs, DRM, HLS/DASH segment assembly and media requiring browser authentication cookies are not supported. The extension reports a failure rather than silently saving a bookmark in place of a video. Save the page link or take a screenshot as a fallback. Limits are 1 GB per video, 100 MB per other downloaded media file, 100 items per batch and approximately 20 MB per screenshot. Some browser/internal pages and cross-origin frames restrict inspection.

## Privacy and connection

No account, analytics, cloud service or paid API. Page inspection uses `activeTab`: there is no content script on ordinary websites or required blanket host permission. Small content scripts on X/Twitter, Instagram, Reddit and Pinterest add the post-save button. Deep scanning requests optional site access only when enabled; request observation is restricted in code to the selected tab. A requested capture goes over Chrome native messaging to a user-only Unix socket on the Mac. Downloads retrieve only the requested media. Imported originals are kept in the local library. The host permits only this extension ID and does not expose an HTTP server to webpages.

## Checks

The test suite validates native-message framing, rejected input, streamed file imports, source metadata, screenshot and text captures, duplicate detection and partial failures. `npm run test:browser` creates an isolated Helium profile and a local fixture website, then verifies actual native messaging, image/video downloads, screenshots/crops, page text, collection and the connected popup. Only that disposable test copy receives broad host access so automated fixture inspection does not require a real toolbar click; the shipped extension retains its `activeTab` permission model.

## Update

After updating Canvas Pro, quit and reopen the app, then click **Reload** on Canvas Pro Capture in `chrome://extensions` and refresh open pages. For development updates, run `npm run install:extension` again before reloading the extension.

Social adapter reference: [X extraction implementation maintained by yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py) and [Reddit video fields](https://developers.reddit.com/docs/api/public-api/type-aliases/RedditVideo).
