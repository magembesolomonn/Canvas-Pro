# Library persistence and search

Status: accepted. These decisions were recovered from the working tree during the comment audit. The file headings identify the affected components.

## electron/bookmark-types.cjs

- Link types decide where a saved link lives: social posts are media, recipes are recipes, and the rest stay ordinary web links. A platform counts as social by host, so a profile, a board or a single post all land together.

## electron/bookmarks.cjs

- Bumped whenever extraction starts finding more on a page that used to be a plain link. Previews saved by an older extractor are upgraded on demand when the reader opens them, never in bulk at launch.
- The cover is normally saved to disk during enrichment. If that download failed, the card can still borrow the page's own feature image.

## electron/deletion.cjs

- A damaged staging folder must never stop the app from launching. Skip it and leave its files in place so the pending deletion can be inspected.

## electron/import-queue.cjs

- Finished jobs are kept briefly so the activity view can still show them and they can be retried, but they are pruned at every state change instead of lingering until the next pump. 'cancelling' is still in flight, so it is never pruned and is treated like other cancellable states by the UI.

## electron/import-recovery.cjs

- An incomplete journal precedes the file copy; never guess a deletion path.
- Other live connections may still be importing.

## electron/library.cjs

- A managed original can disappear when someone deletes it in Finder. The record moves to Trash and remembers why, so it can return if the file is put back. This is separate from a file the person moved to Trash here.
- Pixel dimensions are recorded when a picture is imported or first decoded, so File Details never has to decode the original again and the masonry can be laid out at the right shape from the first frame.
- A 64-bit perceptual fingerprint (16 hex characters). NULL means "not looked at yet"; an empty string records a file that could not be decoded, so a review does not retry it forever.
- Fingerprinting walks the remaining images in batches; without a partial index each batch rescans the whole assets table.
- The Movies tracker and the RSS reader were removed. Their tables are dropped so existing libraries do not keep orphaned data around.
- The full-text index is created by the smart index on the same database. A library opened on its own (tests, recovery tools) has no such table, so the caller falls back to a plain column scan.
- An empty needle makes instr() true for every row, so text and semantic results are separate predicates rather than one OR chain.
- The indexed columns of the asset itself are cheap to scan and keep a brand-new file findable before its analysis has run.
- Once the smart index exists, its FTS table already contains the capture text, captions and analysis. A MATCH is far cheaper than a correlated scan of capture_metadata and asset_analysis per row.
- Offset pages shift when a file is imported mid-scroll, which silently skips rows. The default newest-first order therefore continues from the last key it saw instead of counting from the top again.
- Called by the originals watcher. A file deleted in Finder leaves the library: the item goes to Trash, but remembers that it was the file that vanished rather than a choice made here. A file that comes back is restored automatically, so restoring from the macOS Trash is enough.
- Identity belongs to our immutable copy, never to a changing source path.
- The collection may have been renamed while the bytes were copying; follow its id so the file lands in the name it has now.
- Importing the same file again is a way to put a managed original back after it was deleted in Finder. The bytes are already verified here, so link them into place before restoring the record.
- Optional shortcut metadata must never roll back an already committed original.
- URL recovery can retry when the bookmark is opened.
- Recover the journal on the next launch.
- Fingerprints are written by the main process after it decodes a picture. Keeping them out of importFile means importing never waits on a decode.
- Called by the originals watcher in batches. Only rows whose state really changes are written, so a focus scan of a healthy library does no updates.
- Dimensions are learned once, from the import or the first decode, and then read straight from the row. Both the inspector and the gallery use them.

## electron/local-model.cjs

- The models the app can download. Each one lives in its own folder inside the app's model directory and is verified file by file, so a download that stops half way is resumed rather than restarted, and a file that changed upstream is refused.

## electron/originals-watch.cjs

- The library's managed originals can be changed from Finder: someone may delete one, or put it back from the macOS Trash. This watcher keeps the records honest without ever touching the files themselves. A missing file moves its item to Trash; a file that returns restores it.
- A closed window must not stop the watcher.
- A file the person put in Trash here stays there even if it reappears.
- A full pass is used at startup, after sleep and when the window returns to the front. It is one stat per relevant asset and no hashing, but it runs asynchronously in chunks so startup and focus stay responsive. Only rows that can change are visited: a file the person moved to Trash here has trash=1 and missing=0, and nothing a scan sees should undo that. A healthy library therefore costs one stat per visible original, not a SELECT * and a stat for every row.
- The originals live directly inside this folder, so one non-recursive watcher sees every add, delete and restore.
- A later scan still catches any change.
- Watching is an optimisation; scanning is the safety net.

## electron/perceptual-hash.cjs

- Perceptual fingerprints for image files. Two copies of the same photograph usually differ byte for byte: one was resized, re-compressed or saved with different metadata, so the checksum cannot see that they are the same picture. A difference hash can: shrink the image to 9×8 grey pixels, then record whether each pixel is brighter than its left neighbour. That is 64 bits, and two versions of the same picture differ in only a handful of them. The hash is deliberately independent of the visual search model. It needs no download, no index and no GPU: it is decoded once per file and stored in the library, so a review is a set of bit counts rather than image decoding.
- Formats Chromium can decode through nativeImage. SVG, PSD, PDF and videos are not fingerprints: they are documents or timelines, not photographs.
- A photograph that has only been re-encoded stays within a few bits. Six of sixty-four leaves room for a resize and a different JPEG quality without pulling in a different shot of the same subject.
- toBitmap() hands back premultiplied BGRA. A transparent pixel therefore reads as black; composite it over white so cut-out PNGs compare by shape rather than by whatever was behind them.
- Eight 8-bit bands. Two fingerprints within six bits of each other cannot touch all eight, so they always share at least two bands. A library of thousands of pictures therefore compares each fingerprint against a short list rather than against every other picture.

## electron/smart-index.cjs

- macOS can compare sentences on its own. The native helper turns a piece of text into the vector that comparison uses, so documents and notes can be searched in plain language without downloading a model.
- A document is understood in pieces: one vector for the whole file would average a note about files and a note about tomatoes into nothing.
- Sentences first: a paragraph that mixes two subjects is two things, and only one of them is what the reader is looking for.
- The comparison is a dot product, so the vector is normalised once.
- Several texts in one call: a document is a dozen pieces, and a dozen processes for it is a dozen times the work.
- Stored vectors are 512 little-endian floats. Reading them through DataView costs one method call per component; a Float32Array view is direct access. SQLite buffers can begin at any byte offset, so copy when unaligned.
- Text embeddings live beside the visual vector instead of in it: a non-CLIP model in `vector` is invisible to visual search but still blocks visual indexing. Keeping `vector` free lets that work proceed.
- Embedding writes and retry bookkeeping cannot change the searchable text.
- The sentence, understood: compare the words with the documents that macOS embedded. This is what makes a whole sentence findable in a file. A single word is already answered by the full-text index, so the native helper is only started when a phrase can add something.
- The best piece of a file is what matches, not the sum of them.
- The meaning of the query, as macOS understands it. Nothing is embedded when the library holds no documents, so the cost is only paid when it helps.
- A caption is one sentence about a picture. It is stored beside the rest of what is known about the file, so its words can be found by a search.
- Use the description model output to give meaningless/generic names a human-readable title (without touching intentional names).

## electron/smart-language.cjs

- The language of a library. Three questions live here, and they belong together because they are all about words: what a file should be called, what words describe what is inside it, and how a sentence is read when someone searches for it.
- Names that say nothing about what is inside the file. These are the ones that get a real name once the local analysis has read the picture.
- Words a picture answers to that are not in its name: how bright it is and how colourful it is. "dark moody screenshots" needs these to be findable.
- The name the file should have: what the text in it says, or what the model sees in it, and only then the kind of file and the day it arrived.
- A cut-off word at the end of a line is not part of the name.

## electron/workbench.cjs

- A copy with tags, notes or a favourite star is the one worth keeping; after that the larger file wins, then the one that arrived first.
- Groups files whose pictures are the same, not files that merely share a subject. Exact copies are already blocked at import by their checksum, so most groups come from the 64-bit fingerprint: the same photograph saved again, resized, or re-compressed. Nothing is changed here; the review dialog decides what to keep.
- A checksum match is definitive. It is rare, because import refuses bytes it has already seen, but a library restored from a backup can still hold one, and it should not be hidden behind a similarity score.
- "These are not duplicates" is remembered per group. A later third copy makes a new group (and a new token), so the subject can come back when the library actually changes.
