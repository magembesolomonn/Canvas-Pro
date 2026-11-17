// Perceptual fingerprints for image files.
//
// Two copies of the same photograph usually differ byte for byte: one was
// resized, re-compressed or saved with different metadata, so the checksum
// cannot see that they are the same picture. A difference hash can: shrink
// the image to 9×8 grey pixels, then record whether each pixel is brighter
// than its left neighbour. That is 64 bits, and two versions of the same
// picture differ in only a handful of them.
//
// The hash is deliberately independent of the visual search model. It needs
// no download, no index and no GPU: it is decoded once per file and stored in
// the library, so a review is a set of bit counts rather than image decoding.
const fs = require('node:fs');
const crypto = require('node:crypto');

// Formats Chromium can decode through nativeImage. SVG, PSD, PDF and videos
// are not fingerprints: they are documents or timelines, not photographs.
const HASHED_EXTENSIONS = ['jpg', 'jpeg', 'jfif', 'jpe', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'tiff', 'tif', 'bmp'];
const HASHED_SQL = HASHED_EXTENSIONS.map(ext => `'${ext}'`).join(',');
// A photograph that has only been re-encoded stays within a few bits. Six of
// sixty-four leaves room for a resize and a different JPEG quality without
// pulling in a different shot of the same subject.
const DEFAULT_DISTANCE = 6;
const MAX_BYTES = 96 * 1024 * 1024;

function luminance(bmp, index, alpha) {
  // toBitmap() hands back premultiplied BGRA. A transparent pixel therefore
  // reads as black; composite it over white so cut-out PNGs compare by shape
  // rather than by whatever was behind them.
  const blue = bmp[index], green = bmp[index + 1], red = bmp[index + 2];
  const value = 0.114 * blue + 0.587 * green + 0.299 * red;
  return alpha >= 255 ? value : value + 255 * (1 - alpha / 255);
}

function hashFile(nativeImage, file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return '';
    const image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return '';
    const small = image.resize({ width: 9, height: 8, quality: 'good' });
    const { width, height } = small.getSize();
    if (width < 9 || height < 8) return '';
    const bmp = small.toBitmap();
    let hex = '', nibble = 0, bits = 0, previous = null;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) {
        const index = (y * width + x) * 4;
        const value = luminance(bmp, index, bmp[index + 3]);
        if (x > 0) {
          nibble = (nibble << 1) | (value > previous ? 1 : 0);
          if (++bits === 4) { hex += nibble.toString(16); nibble = 0; bits = 0; }
        }
        previous = value;
      }
    }
    return hex.length === 16 ? hex : '';
  } catch {
    return '';
  }
}

function distance(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 64;
  let value = BigInt('0x' + a) ^ BigInt('0x' + b);
  let bits = 0;
  while (value) { value &= value - 1n; bits++; }
  return bits;
}

// Eight 8-bit bands. Two fingerprints within six bits of each other cannot
// touch all eight, so they always share at least two bands. A library of
// thousands of pictures therefore compares each fingerprint against a short
// list rather than against every other picture.
function bands(hash) {
  const value = typeof hash === 'string' && hash.length === 16 ? hash : '';
  return Array.from({ length: 8 }, (_, index) => index + ':' + value.slice(index * 2, index * 2 + 2));
}

function signature(ids) {
  return [...new Set(ids.map(String))].sort().join(':');
}

function token(ids) {
  return crypto.createHash('sha256').update(signature(ids)).digest('hex').slice(0, 32);
}

module.exports = { HASHED_EXTENSIONS, HASHED_SQL, DEFAULT_DISTANCE, hashFile, distance, bands, signature, token };
