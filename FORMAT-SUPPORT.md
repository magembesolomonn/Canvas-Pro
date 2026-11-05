# Canvas Pro preview formats

All file types can be imported, tagged, collected, exported and stored without changing their originals. Preview support is separate from storage support.

| Format | Preview implementation and limits |
| --- | --- |
| PSD / PSB | In-app flattened image preview using macOS, up to 1800 px; no layer editing. PSD fixture verified. |
| AVIF, JFIF, JPE | Image viewer with native decoding fallback. |
| JPEG XL (`jxl`, `jpegxl`) | macOS ImageIO / native image preview; depends on macOS decoder availability. |
| EPS | Bundled Ghostscript WebAssembly rasterizer in a disposable worker, with a 15-second decoding limit. No external application required. |
| INSP | Standard JPEG-compatible INSP images decode directly; other variants depend on native macOS decoding. |
| H.265 / HEVC | Video playback in a supported container such as MP4 or MOV, subject to the Mac's hardware/OS decoder. Raw `.h265` / `.hevc` streams may need conversion to MP4. |
| GIFV, 3GP | Video player; GIFV must contain actual playable video bytes, not an HTML redirect page. Codec support depends on Chromium/macOS. |
| SWF | Bundled Ruffle engine, loaded on demand. Compatibility depends on Ruffle's Flash feature support. External scripts, URLs and networking are restricted. |
| EPUB | Built-in offline chapter reader. Reflowable text and embedded raster images; no DRM, scripts or fixed-layout fidelity guarantee. |
| HTML / MHTML | Static, sanitized offline content reader. Scripts and remote content are disabled. HTML folder sidecar resources aren't copied automatically. MHTML extracts embedded raster images and the first HTML body. |
| 3DS, 3MF, DAE, PLY, STL, GLB | Interactive local 3D preview: orbit, pan and zoom. Geometry/material support depends on the loader; external sidecar textures aren't loaded. GLB with unsupported compression extensions may need re-exporting. |
| IFC | Interactive geometry preview using bundled web-ifc. Not a BIM property editor. |

The 3D and document engines are loaded only when their files are opened. Interactive files are limited to 150 MB, EPUB archive expansion to 100 MB total / 32 MB per entry. Original files remain available for export if a preview cannot be decoded.

Small isolated fixtures verify PSD, HTML, MHTML, EPUB, EPS, all seven listed 3D formats and SWF. These verify integration and representative decoding, not every variant of each format. AFX, EVA and VAP were excluded at the user's request.

Rebuild local viewer bundles after changing `scripts/viewers/formats.mjs` with `npm run build:viewers`. Engines: Three.js (MIT), fflate (MIT), web-ifc (MPL-2.0), Ruffle (MIT/Apache-2.0), Ghostscript WASM (AGPL-3.0); notices are packaged in `src/vendor`.

Decoder source: [Ghostscript WASM](https://github.com/jsscheller/ghostscript-wasm), [web-ifc](https://github.com/ThatOpen/engine_web-ifc), [Three.js](https://github.com/mrdoob/three.js), [Ruffle](https://github.com/ruffle-rs/ruffle), [fflate](https://github.com/101arrowz/fflate). Installed versions are pinned in package-lock.json.

## Reliability release 0.7.0

STL, PLY, 3DS and IFC decoding runs in disposable background workers. Closing or changing the preview terminates its worker. These decoders limit decoded geometry to 256 MB and 50,000 meshes, with a 60-second decoding limit. GLB, DAE and 3MF retain their existing renderer loaders. Native waveform generation already runs out of process; queued analysis now prioritizes previews and cancels offscreen background jobs.
