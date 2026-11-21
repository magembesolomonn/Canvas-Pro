# Packaging and local processing

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## native/Analyze.swift

- PNG screenshots can carry text too small for the gallery thumbnail.

## native/Symbols.swift

- Keep the symbol inside the canvas without clipping ascenders/descenders.

## native/Text.swift

- The text understanding helper. macOS already knows how to compare sentences. This tool turns a piece of text into the vector that comparison uses, so the app can search documents and notes in plain language without downloading anything. text-tool embed "some text"   -> the vector, as JSON numbers text-tool dimension           -> how many numbers a vector has
- Several texts at once, one per line, so a whole document is understood in a single call.
- The vector is written as plain numbers: the app stores it beside the picture vectors and compares them with a dot product.

## scripts/build-mac.cjs

- Record what went into this bundle so packaging can prove the native helpers came from the current source tree. Ad-hoc signing changes helper bytes, so a plain source-vs-dist byte comparison is not meaningful.

## scripts/generate-update-key.cjs

- Run once. Keep the private key outside the repository and embed only the printed public key in electron/update-signing.cjs.

## scripts/package-release.cjs

- Same resolution as scripts/sign-update.cjs: never package a release that cannot be signed. No key bytes are read or copied here, only the path.
- Reverse walk: a file deleted from the source must not survive in a release.
- Native helpers are re-signed inside the bundle, so their bytes legitimately differ from bin/. The build manifest records both hashes at build time; check those instead of comparing signed bytes.
- Installed builds require a signed checksum manifest. Sign it here so a release can never be published in a state the app refuses to install; the private key stays outside the app bundle.

## scripts/prototype.cjs

- Source-only prototype. Uses a separate persistent library; never updates an installed app.

## scripts/set-fuses.cjs

- RunAsNode stays enabled because the native messaging host launches this binary with ELECTRON_RUN_AS_NODE=1. Everything else that can be disabled without breaking the unpacked app or the web preview is disabled here.

## scripts/smart/page.cjs

- Recipe JSON-LD nests steps inside HowToSection and writes ingredients as either strings or objects. A flat map loses the nested ones, so both shapes are walked in document order. Newline-joined blobs are split only on lines, where the separation is unambiguous.
- Schema durations are ISO 8601, but recipe microdata often prints "45 mins". Both are normalised to ISO so the card has one formatter.
- A wrapper like .recipe-ingredients also matches the class rule; its text would swallow every ingredient into one line. Keep only leaf entries.
- A nested paragraph inside a step is the same step, not another one.
- An anti-bot interstitial is tiny and full of block copy. Parsing it would produce a one-word title and then look like a real (empty) page. Say what happened instead so the card can offer a retry.
- A recipe page often carries WebPage/Article objects alongside the Recipe. The one with actual ingredients or steps is the card the reader wants.
- Some sites publish Recipe metadata without the actual lists, or publish one half only. The visible microdata fills the gap.
- The rest of the recipe web: no Recipe JSON-LD, but markup with recipe microdata. Only a page that actually yields a list becomes a recipe card; a page that merely says "recipe" stays an article.
- The page's own headline beats a <title> suffix like " | Site".
- The DOM fallback can promote a page to a recipe after the result object was built from the JSON-LD type.
- Shopping lookbooks use a feature grid whose lead and product grouping Readability strips.

## scripts/smart/semantic-worker.mjs

- The worker does three jobs: it embeds a picture, it embeds a sentence, and it describes a picture in one sentence. The first two make search work; the third is what names a file, suggests its tags and makes it findable by what it shows.

## scripts/viewers/epub-worker.mjs

- EPUB archives are decompressed in a disposable worker so a crafted DEFLATE stream cannot block the renderer's main thread. The declared size cap still bounds allocation, and the actual decompressed bytes are checked as well.

## scripts/viewers/formats.mjs

- Inflate in a disposable worker so a forged ZIP header cannot lock the main thread. The worker enforces both the declared-size and actual-size caps.
