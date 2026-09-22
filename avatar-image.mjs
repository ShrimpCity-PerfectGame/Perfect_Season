// Turning a chosen photo into the picture that gets uploaded: decode it, crop the square the player
// framed, draw it at 256x256 and encode it as WebP (JPEG where the browser can't make WebP), under
// 256 KB. Redrawing on a canvas leaves the file's metadata behind, including a phone photo's GPS
// location. The encoders add some of their own, though - Chrome tags every canvas WebP and JPEG with
// an ICC color profile - so stripMetadata takes the encoded bytes back down to just the picture.
// Browser-only (canvas). Contract: PROFILES.md.
//
//   loadImage(file)             -> Promise<{ source, width, height }>  rejects { code: "unsupported" | "too_big" }
//   prepareAvatar(source, crop) -> Promise<{ blob, type }>            crop = { x, y, size } in source pixels
//   releaseImage(source)        frees a source's memory once the picker is done with it
import { AVATAR_SIZE, AVATAR_MAX_BYTES, AVATAR_TYPES } from "./profile-rules.mjs";

// The biggest file the picker will take. This is the file's SIZE, and it is the only size checked before
// the picture is decoded - which is a known, accepted hole, deliberately left open.
//
// A picture's pixels are not its bytes. An image format compresses flat colour to almost nothing, so a PNG or
// WebP of a page or two can declare 30,000 x 30,000 and decode to about 3.6 GB of pixels - a "decompression
// bomb". Neither route below can see that coming: createImageBitmap decodes and then reports a size, and the
// <img> fallback does the same. Nothing in a browser reliably reads an image's dimensions without decoding it
// (WebCodecs' ImageDecoder can, and is not everywhere), so closing this would mean parsing the headers of
// PNG, JPEG, WebP, GIF and AVIF by hand, in every build, for a picture the player chose themselves.
//
// What it costs if someone does it: their own tab runs out of memory and the browser ends it. Theirs and
// nobody else's, and they have to go and make the file first. There is no other way in - a picture reaches
// this only through the player's own file picker; no address, no link and no other player can hand one over,
// nothing has been uploaded at the point it would happen (prepareAvatar has not run), and no server anywhere
// in this game decodes an image at all. Reloading the page is the whole of the recovery.
//
// So: accepted and written down, rather than fixed. If it ever needs fixing, ImageDecoder's track size is
// the cheap half and the header parsers are the rest.
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export { AVATAR_SIZE, AVATAR_MAX_BYTES, AVATAR_TYPES };

// A loaded photo is kept at most this big on its longest side. A 12-megapixel phone photo held at
// full size is 48 MB of pixels that the picker would redraw on every drag, and nobody can frame a
// 256px picture more precisely than 2048px lets them. width and height always describe the source
// loadImage hands back, so a crop in its pixels is still exact.
export const WORKING_EDGE = 2048;
// No canvas made along the way is bigger than this: iOS Safari refuses canvases over about 16.7
// million pixels (drawing into one silently does nothing).
const MAX_CANVAS_EDGE = 4096;
// Transparent pixels are laid on the app's cream, so a transparent PNG doesn't come out black as a
// JPEG, or as a see-through WebP that looks different on every background. The picker's preview
// uses it too.
export const BACKDROP = "#F7F4EA";
const QUALITIES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

const failure = (code) => ({ code });

export async function loadImage(file) {
  if (!file || typeof file.size !== "number") throw failure("unsupported");
  // Before decoding anything: a 60 MB file shouldn't be read into memory just to be refused.
  if (file.size > MAX_INPUT_BYTES) throw failure("too_big");
  const bitmap = await decodeBitmap(file);
  if (bitmap) {
    const fit = fitWithin(bitmap.width, bitmap.height, WORKING_EDGE);
    if (!fit) return { source: bitmap, width: bitmap.width, height: bitmap.height };
    try {
      return { source: resample(bitmap, 0, 0, bitmap.width, bitmap.height, fit.width, fit.height), ...fit };
    } catch (e) {
      throw failure("unsupported");
    } finally {
      bitmap.close();
    }
  }
  return decodeWithImg(file);
}

// createImageBitmap applies the EXIF orientation itself when asked, and decodes off the main thread.
// Returns null where it's missing or refuses the file (older Safari rejects the options), so the
// <img> route gets a try.
async function decodeBitmap(file) {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bitmap.width > 0 && bitmap.height > 0) return bitmap;
    bitmap.close();
  } catch (e) {
    // fall through to the <img> route
  }
  return null;
}

// The fallback: an <img> (browsers apply EXIF orientation to images since 2020), copied straight into
// a canvas so the object URL can be let go - the canvas, not the element, becomes the source.
async function decodeWithImg(file) {
  let url = null;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!(w > 0 && h > 0)) throw new Error("no size");
    const fit = fitWithin(w, h, WORKING_EDGE) || { width: w, height: h };
    return { source: resample(img, 0, 0, w, h, fit.width, fit.height), ...fit };
  } catch (e) {
    throw failure("unsupported");
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

// The size that fits w x h inside edge on its longest side, or null if it already does.
function fitWithin(w, h, edge) {
  const scale = edge / Math.max(w, h);
  if (scale >= 1) return null;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// The crop is square and inside the picture; anything else (a rounding error, a bad value) is pulled
// back in rather than refused, and a missing crop means the biggest centered square.
function clampCrop(crop, width, height) {
  const short = Math.min(width, height);
  const size = Math.min(short, Math.max(1, Number(crop?.size) || short));
  const clamp = (v, max) => Math.min(max, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : max / 2));
  return { x: clamp(crop?.x, width - size), y: clamp(crop?.y, height - size), size };
}

export async function prepareAvatar(source, crop) {
  const width = source?.naturalWidth || source?.width || 0;
  const height = source?.naturalHeight || source?.height || 0;
  if (!(width > 0 && height > 0)) throw failure("unsupported");
  const { x, y, size } = clampCrop(crop, width, height);
  let canvas;
  try {
    canvas = resample(source, x, y, size, size, AVATAR_SIZE, AVATAR_SIZE, BACKDROP);
  } catch (e) {
    throw failure("unsupported");
  }
  let encoded = false;
  try {
    for (const type of ["image/webp", "image/jpeg"]) {
      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, type, quality);
        // A browser that can't make this type hands back a PNG instead; move on to the next type.
        if (!blob || blob.type !== type) break;
        encoded = true;
        if (blob.size > AVATAR_MAX_BYTES) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // A structure the parser doesn't recognize is kept as the encoder made it: it came from a
        // canvas, so it can't be carrying anything from the original file.
        const clean = stripMetadata(bytes, type) || bytes;
        if (clean.length <= AVATAR_MAX_BYTES) return { blob: new Blob([clean], { type }), type };
      }
    }
  } finally {
    canvas.width = 0;
  }
  throw failure(encoded ? "too_big" : "unsupported");
}

export function releaseImage(source) {
  try {
    if (typeof source?.close === "function") source.close();
    else if (source && typeof source.getContext === "function") source.width = 0;
  } catch (e) {
    // already released
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch (e) {
      resolve(null); // a canvas the browser won't read back
    }
  });
}

function newCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

// Draws the sx,sy,sw,sh part of src at w x h. Big reductions go in halving steps: one drawImage from a
// 2000px square straight down to 256px skips most of the pixels, which leaves hair and text jagged in
// browsers whose "high" smoothing isn't a true averaging filter.
function resample(src, sx, sy, sw, sh, w, h, backdrop) {
  let from = src, fx = sx, fy = sy, fw = sw, fh = sh;
  while (fw >= w * 2 && fh >= h * 2) {
    let nw = Math.ceil(fw / 2), nh = Math.ceil(fh / 2);
    const over = Math.max(nw, nh) / MAX_CANVAS_EDGE;
    if (over > 1) { nw = Math.ceil(nw / over); nh = Math.ceil(nh / over); }
    const step = newCanvas(Math.max(w, nw), Math.max(h, nh));
    step.ctx.drawImage(from, fx, fy, fw, fh, 0, 0, step.canvas.width, step.canvas.height);
    if (from !== src) from.width = 0;
    from = step.canvas; fx = 0; fy = 0; fw = step.canvas.width; fh = step.canvas.height;
  }
  const out = newCanvas(w, h);
  if (backdrop) {
    out.ctx.fillStyle = backdrop;
    out.ctx.fillRect(0, 0, w, h);
  }
  out.ctx.drawImage(from, fx, fy, fw, fh, 0, 0, w, h);
  if (from !== src) from.width = 0;
  return out.canvas;
}

// ---------- Metadata ----------
// The encoded bytes without any metadata: returns a new Uint8Array, or null when the bytes aren't a
// JPEG or WebP structure this understands. Exported for the tests. Dropping the ICC profile doesn't
// change the colors: the canvas is sRGB, and an untagged picture is shown as sRGB.
export function stripMetadata(bytes, type) {
  if (type === "image/jpeg") return stripJpeg(bytes);
  if (type === "image/webp") return stripWebp(bytes);
  return null;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// JPEG segments that describe the photo rather than draw it: APP1 (EXIF, which is where GPS lives, and
// XMP), APP2-APP13 (ICC profiles, IPTC, camera makers' data), APP15 and comments. APP0 (JFIF) and
// APP14 (Adobe) stay, since decoders read them to get the colors right.
const isJpegMetadata = (marker) => (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe;

function stripJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const keep = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    let m = i + 1;
    while (b[m] === 0xff) m++; // fill bytes before a marker
    const marker = b[m];
    if (marker === undefined) return null;
    if (marker === 0xd9) { keep.push(b.subarray(i, m + 1)); return concat(keep); } // end of image
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { keep.push(b.subarray(i, m + 1)); i = m + 1; continue; } // no length
    if (m + 2 >= b.length) return null;
    const length = (b[m + 1] << 8) | b[m + 2];
    let end = m + 1 + length;
    if (length < 2 || end > b.length) return null;
    if (marker === 0xda) {
      // A scan's compressed data runs to the next marker: an FF that isn't a stuffed FF00 or a restart.
      while (end < b.length && !(b[end] === 0xff && b[end + 1] !== 0x00 && !(b[end + 1] >= 0xd0 && b[end + 1] <= 0xd7))) end++;
    }
    if (!isJpegMetadata(marker)) keep.push(b.subarray(i, end));
    i = end;
  }
  return concat(keep); // no end marker; keep what's there, like decoders do
}

// WebP keeps metadata in its own chunks. VP8X's flags say which are present, so those bits are cleared too.
const WEBP_METADATA = new Set(["EXIF", "XMP ", "ICCP"]);
const VP8X_METADATA_FLAGS = 0x20 | 0x08 | 0x04; // ICC profile, EXIF, XMP

function stripWebp(b) {
  const tag = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  const u32 = (at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  if (b.length < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const riffEnd = Math.min(b.length, 8 + u32(4));
  const keep = [b.subarray(0, 12)];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const id = tag(i), size = u32(i + 4);
    if (i + 8 + size > riffEnd) return null;
    const end = Math.min(riffEnd, i + 8 + size + (size & 1)); // chunks are padded to an even length
    if (!WEBP_METADATA.has(id)) keep.push(b.subarray(i, end));
    i = end;
  }
  if (keep.length === 1) return null;
  const out = concat(keep);
  const riffSize = out.length - 8;
  out[4] = riffSize & 0xff; out[5] = (riffSize >> 8) & 0xff; out[6] = (riffSize >> 16) & 0xff; out[7] = (riffSize >>> 24) & 0xff;
  if (out.length >= 21 && String.fromCharCode(out[12], out[13], out[14], out[15]) === "VP8X") out[20] &= ~VP8X_METADATA_FLAGS;
  return out;
}
