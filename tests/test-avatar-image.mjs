// The photo pipeline (avatar-image.mjs) in real Chrome. jsdom has no image decoder or canvas, and what
// matters here only exists in a browser: EXIF orientation, WebP and JPEG encoding, and whether any of
// the original file's metadata - a phone photo's GPS location above all - survives into the upload.
// Every test picture is drawn in the page; the EXIF JPEG gets its bytes built by hand (T.exifSegment).
//
// Uses the installed Chrome like tools/ui-harness/audit.mjs (set CHROME_PATH to use another).
import http from "node:http";
import path from "node:path";
import * as esbuild from "esbuild";
import { launch } from "../tools/ui-harness/audit.mjs";
import { assert, runTest, root } from "./helpers.mjs";
import { AVATAR_MAX_BYTES, AVATAR_TYPES } from "../profile-rules.mjs";

const bundle = await esbuild.build({
  entryPoints: [path.join(root, "avatar-image.mjs")],
  bundle: true, format: "iife", globalName: "AvatarImage", platform: "browser", write: false,
});
const server = http.createServer((req, res) => {
  if (req.url === "/avatar-image.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(bundle.outputFiles[0].text);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><meta charset="utf-8"><body><script src="/avatar-image.js"></script></body>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

// Runs in the page. Pictures are drawn by name (functions can't cross into the page), and inspect()
// decodes a blob back and reads the pixels asked for.
function pageHelpers() {
  const T = (window.T = {});
  T.draw = (w, h, kind) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    const rect = (color, ...r) => { x.fillStyle = color; x.fillRect(...r); };
    if (kind === "columns") { rect("#ff0000", 0, 0, w / 3, h); rect("#00c000", w / 3, 0, w / 3, h); rect("#0000ff", (2 * w) / 3, 0, w / 3 + 1, h); }
    if (kind === "rows") { rect("#ff0000", 0, 0, w, h / 3); rect("#00c000", 0, h / 3, w, h / 3); rect("#0000ff", 0, (2 * h) / 3, w, h / 3 + 1); }
    if (kind === "quadrants") { rect("#ff0000", 0, 0, w / 2, h / 2); rect("#00c000", w / 2, 0, w / 2, h / 2); rect("#0000ff", 0, h / 2, w / 2, h / 2); rect("#ffff00", w / 2, h / 2, w / 2, h / 2); }
    if (kind === "scene") {
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#3155ff");
      g.addColorStop(1, "#ff7043");
      rect(g, 0, 0, w, h);
      rect("#101114", w * 0.45, h * 0.45, w * 0.1, h * 0.1);
    }
    if (kind === "noise") {
      const d = x.createImageData(w, h);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = Math.random() * 256; d.data[i + 1] = Math.random() * 256; d.data[i + 2] = Math.random() * 256; d.data[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
    }
    if (kind === "transparent") { x.fillStyle = "#0000ff"; x.beginPath(); x.arc(w / 2, h / 2, w / 4, 0, Math.PI * 2); x.fill(); }
    // A red 20px block in the top-left corner of blue, to see where orientation puts it.
    if (kind === "corner") { rect("#0000ff", 0, 0, w, h); rect("#ff0000", 0, 0, 20, 20); }
    return c;
  };
  T.file = (w, h, kind, type = "image/png", quality = 0.92) => new Promise((resolve) => T.draw(w, h, kind).toBlob(resolve, type, quality));
  T.bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  T.indexOf = (bytes, pattern) => {
    const p = typeof pattern === "string" ? [...pattern].map((ch) => ch.charCodeAt(0)) : pattern;
    outer: for (let i = 0; i <= bytes.length - p.length; i++) {
      for (let j = 0; j < p.length; j++) if (bytes[i + j] !== p[j]) continue outer;
      return i;
    }
    return -1;
  };
  // An EXIF APP1 segment, big-endian: IFD0 with an orientation tag and a pointer to a GPS IFD holding
  // 40°26'46.38"N 79°58'56.10"W. T.GPS is the latitude's bytes, to look for in an output.
  T.GPS = [0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 1, 0, 0, 0x12, 0x1e, 0, 0, 0, 100];
  T.exifSegment = (orientation) => {
    const tiff = new DataView(new ArrayBuffer(140));
    let p = 0;
    const u8 = (v) => tiff.setUint8(p++, v);
    const u16 = (v) => { tiff.setUint16(p, v); p += 2; };
    const u32 = (v) => { tiff.setUint32(p, v); p += 4; };
    u8(0x4d); u8(0x4d); u16(42); u32(8); // "MM", the TIFF magic number, IFD0 at 8
    u16(2); // IFD0: two entries
    u16(0x0112); u16(3); u32(1); u16(orientation); u16(0); // Orientation, SHORT
    u16(0x8825); u16(4); u32(1); u32(38); // GPSInfo IFD at 38
    u32(0); // no IFD1
    u16(4); // the GPS IFD: four entries
    u16(1); u16(2); u32(2); u8(0x4e); u8(0); u8(0); u8(0); // GPSLatitudeRef "N"
    u16(2); u16(5); u32(3); u32(92); // GPSLatitude, three RATIONALs at 92
    u16(3); u16(2); u32(2); u8(0x57); u8(0); u8(0); u8(0); // GPSLongitudeRef "W"
    u16(4); u16(5); u32(3); u32(116); // GPSLongitude at 116
    u32(0);
    for (const [n, d] of [[40, 1], [26, 1], [4638, 100], [79, 1], [58, 1], [5610, 100]]) { u32(n); u32(d); }
    const body = new Uint8Array(tiff.buffer);
    const seg = new Uint8Array(10 + body.length);
    seg.set([0xff, 0xe1, (seg.length - 2) >> 8, (seg.length - 2) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]); // APP1, length, "Exif\0\0"
    seg.set(body, 10);
    return seg;
  };
  // Inserts segments right after a JPEG's start-of-image marker, where cameras put EXIF.
  T.afterSoi = async (blob, ...segments) => {
    const b = await T.bytes(blob);
    return new Blob([b.subarray(0, 2), ...segments, b.subarray(2)], { type: "image/jpeg" });
  };
  T.inspect = async (blob, points = {}) => {
    const bytes = await T.bytes(blob);
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const x = c.getContext("2d");
    x.drawImage(bitmap, 0, 0);
    const px = {};
    for (const [name, [px0, py0]] of Object.entries(points)) px[name] = [...x.getImageData(px0, py0, 1, 1).data];
    return {
      type: blob.type, size: blob.size, width: bitmap.width, height: bitmap.height, px,
      exif: T.indexOf(bytes, "Exif"), gps: T.indexOf(bytes, T.GPS), icc: Math.max(T.indexOf(bytes, "ICCP"), T.indexOf(bytes, "ICC_PROFILE")),
    };
  };
  T.error = async (promise) => {
    try { await promise; return null; } catch (e) { return e && e.code ? { code: e.code } : { thrown: String(e) }; }
  };
}

const RED = [255, 0, 0], GREEN = [0, 192, 0], BLUE = [0, 0, 255], YELLOW = [255, 255, 0], CREAM = [0xf7, 0xf4, 0xea];
const near = (got, want, tol = 48) => Array.isArray(got) && want.every((v, i) => Math.abs(got[i] - v) <= tol) && (got[3] ?? 255) === 255;
const show = (px) => JSON.stringify(px);
// Every prepared picture: the right type, 256x256, within the limit, and no metadata - no EXIF, no GPS,
// and not the ICC profile Chrome's encoder tags its own output with.
function assertAvatar(out, what) {
  assert(AVATAR_TYPES.includes(out.type) && out.type !== "image/png", `${what}: expected WebP or JPEG, got ${out.type}`);
  assert(out.blobType === out.type, `${what}: the blob's own type (${out.blobType}) should match the returned type (${out.type})`);
  assert(out.width === 256 && out.height === 256, `${what}: expected 256x256, got ${out.width}x${out.height}`);
  assert(out.size > 0 && out.size <= AVATAR_MAX_BYTES, `${what}: expected at most ${AVATAR_MAX_BYTES} bytes, got ${out.size}`);
  assert(out.exif === -1 && out.gps === -1 && out.icc === -1, `${what}: the output still carries metadata (Exif at ${out.exif}, GPS at ${out.gps}, ICC at ${out.icc})`);
}

const browser = await launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
  await page.evaluate(pageHelpers);

  await runTest("a landscape photo: its dimensions, then a centered square as a 256x256 WebP under 256 KB", async () => {
    const out = await page.evaluate(async () => {
      const file = await T.file(900, 500, "columns", "image/jpeg");
      const { source, width, height } = await AvatarImage.loadImage(file);
      const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 200, y: 0, size: 500 });
      // The square runs from x=200 to 700: the red third's last 100px, all of green, blue's first 100px.
      return { loaded: [width, height], blobType: blob.type, ...(await T.inspect(blob, { left: [20, 128], middle: [128, 128], right: [236, 128] })), type };
    });
    assert(out.loaded.join("x") === "900x500", `loadImage should report 900x500, got ${out.loaded.join("x")}`);
    assertAvatar(out, "landscape");
    assert(out.type === "image/webp", `Chrome can encode WebP, so the picture should be WebP, got ${out.type}`);
    assert(near(out.px.left, RED) && near(out.px.middle, GREEN) && near(out.px.right, BLUE), `the crop isn't the centered square: ${show(out.px)}`);
  });

  await runTest("a portrait photo: the crop is in source pixels, not always centered", async () => {
    const out = await page.evaluate(async () => {
      const { source, width, height } = await AvatarImage.loadImage(await T.file(300, 600, "rows"));
      // The bottom half, y=300..600: 100px of green, then 200px of blue.
      const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 0, y: 300, size: 300 });
      return { loaded: [width, height], blobType: blob.type, ...(await T.inspect(blob, { top: [128, 30], bottom: [128, 220] })), type };
    });
    assert(out.loaded.join("x") === "300x600", `expected 300x600, got ${out.loaded.join("x")}`);
    assertAvatar(out, "portrait");
    assert(near(out.px.top, GREEN) && near(out.px.bottom, BLUE), `expected green over blue from the bottom half: ${show(out.px)}`);
  });

  await runTest("a tiny 40x40 picture is scaled up to 256x256", async () => {
    const out = await page.evaluate(async () => {
      const { source } = await AvatarImage.loadImage(await T.file(40, 40, "quadrants"));
      const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 0, y: 0, size: 40 });
      return { blobType: blob.type, ...(await T.inspect(blob, { tl: [60, 60], tr: [196, 60], bl: [60, 196], br: [196, 196] })), type };
    });
    assertAvatar(out, "tiny");
    assert(near(out.px.tl, RED) && near(out.px.tr, GREEN) && near(out.px.bl, BLUE) && near(out.px.br, YELLOW), `quadrants moved: ${show(out.px)}`);
  });

  await runTest("a huge 4000x3000 photo is held at 2048px and still makes a small picture", async () => {
    const out = await page.evaluate(async () => {
      const file = await T.file(4000, 3000, "scene", "image/jpeg", 0.9);
      const { source, width, height } = await AvatarImage.loadImage(file);
      const kept = [source.width, source.height];
      // The biggest centered square, which has the black box in its middle.
      const { blob, type } = await AvatarImage.prepareAvatar(source, { x: (width - height) / 2, y: 0, size: height });
      AvatarImage.releaseImage(source);
      return { loaded: [width, height], kept, released: source.width, blobType: blob.type, ...(await T.inspect(blob, { center: [128, 128] })), type };
    });
    assert(out.loaded.join("x") === "2048x1536" && out.kept.join("x") === "2048x1536", `expected the source kept at 2048x1536 and reported as such, got ${out.loaded.join("x")} (source ${out.kept.join("x")})`);
    assertAvatar(out, "huge");
    assert(near(out.px.center, [0x10, 0x11, 0x14]), `expected the black box in the middle: ${show(out.px)}`);
    assert(out.released === 0, "releaseImage should free the working canvas");
  });

  await runTest("a transparent PNG comes out on cream, not black", async () => {
    const out = await page.evaluate(async () => {
      const { source } = await AvatarImage.loadImage(await T.file(200, 200, "transparent"));
      const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 0, y: 0, size: 200 });
      return { blobType: blob.type, ...(await T.inspect(blob, { corner: [6, 6], center: [128, 128] })), type };
    });
    assertAvatar(out, "transparent");
    assert(near(out.px.corner, CREAM, 12), `the transparent corner should be opaque cream: ${show(out.px)}`);
    assert(near(out.px.center, BLUE), `the circle should stay blue: ${show(out.px)}`);
  });

  // Orientation 6 means "turn 90° clockwise to show": the stored 80x40 picture shows as 40x80, and its
  // stored top-left corner shows top-right.
  const orientedJpeg = async (noBitmap) => page.evaluate(async (noBitmap) => {
    const stored = await T.file(80, 40, "corner", "image/jpeg", 0.95);
    const file = await T.afterSoi(stored, T.exifSegment(6));
    const input = await T.bytes(file);
    const saved = window.createImageBitmap;
    if (noBitmap) window.createImageBitmap = undefined;
    let loaded, prepared;
    try {
      loaded = await AvatarImage.loadImage(file);
      prepared = await AvatarImage.prepareAvatar(loaded.source, { x: 0, y: 0, size: 40 });
    } finally {
      window.createImageBitmap = saved; // inspect() needs it back
    }
    return {
      inputExif: T.indexOf(input, "Exif"), inputGps: T.indexOf(input, T.GPS), loaded: [loaded.width, loaded.height],
      blobType: prepared.blob.type, type: prepared.type,
      ...(await T.inspect(prepared.blob, { topRight: [200, 56], topLeft: [56, 56], bottomRight: [200, 200] })),
    };
  }, noBitmap);

  await runTest("a phone photo's EXIF orientation is applied, and its EXIF and GPS data are gone", async () => {
    const out = await orientedJpeg(false);
    assert(out.inputExif >= 0 && out.inputGps >= 0, "test setup: the input JPEG should carry EXIF with GPS");
    assert(out.loaded.join("x") === "40x80", `orientation 6 should turn 80x40 into 40x80, got ${out.loaded.join("x")}`);
    assertAvatar(out, "EXIF photo");
    assert(near(out.px.topRight, RED) && near(out.px.topLeft, BLUE) && near(out.px.bottomRight, BLUE), `the red corner should be top-right once turned: ${show(out.px)}`);
  });

  await runTest("without createImageBitmap, the <img> route gives the same oriented, metadata-free picture", async () => {
    const out = await orientedJpeg(true);
    assert(out.loaded.join("x") === "40x80", `expected 40x80 from the <img> route, got ${out.loaded.join("x")}`);
    assertAvatar(out, "EXIF photo via <img>");
    assert(near(out.px.topRight, RED) && near(out.px.topLeft, BLUE), `the red corner should be top-right: ${show(out.px)}`);
  });

  await runTest("where WebP can't be encoded (Safari), the picture is a JPEG with no EXIF", async () => {
    const out = await page.evaluate(async () => {
      const real = HTMLCanvasElement.prototype.toBlob;
      // Safari's canvas answers a WebP request with a PNG.
      HTMLCanvasElement.prototype.toBlob = function (cb, type, q) { return real.call(this, cb, type === "image/webp" ? "image/png" : type, q); };
      try {
        const stored = await T.file(640, 480, "scene", "image/jpeg");
        const { source } = await AvatarImage.loadImage(await T.afterSoi(stored, T.exifSegment(1)));
        const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 80, y: 0, size: 480 });
        const bytes = await T.bytes(blob);
        return { blobType: blob.type, type, soi: [bytes[0], bytes[1]], ...(await T.inspect(blob, { center: [128, 128] })) };
      } finally {
        HTMLCanvasElement.prototype.toBlob = real;
      }
    });
    assert(out.type === "image/jpeg", `expected the JPEG fallback, got ${out.type}`);
    assert(out.soi[0] === 0xff && out.soi[1] === 0xd8, "a JPEG starts with FFD8");
    assertAvatar(out, "JPEG fallback");
  });

  await runTest("quality steps down until the picture fits, and gives up with too_big if nothing does", async () => {
    const out = await page.evaluate(async () => {
      const real = HTMLCanvasElement.prototype.toBlob;
      const calls = [];
      // Pads every encoding above a quality with 300 KB, as if the picture were far busier than it is.
      const inflateAbove = (limit) => function (cb, type, q) {
        calls.push(`${type} ${q}`);
        return real.call(this, (b) => cb(b && q > limit ? new Blob([b, new Uint8Array(300000)], { type: b.type }) : b), type, q);
      };
      try {
        const { source } = await AvatarImage.loadImage(await T.file(300, 300, "scene"));
        HTMLCanvasElement.prototype.toBlob = inflateAbove(0.55);
        const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 0, y: 0, size: 300 });
        const stepped = calls.splice(0);
        HTMLCanvasElement.prototype.toBlob = inflateAbove(0);
        const gaveUp = await T.error(AvatarImage.prepareAvatar(source, { x: 0, y: 0, size: 300 }));
        return { blobType: blob.type, type, stepped, gaveUp, tried: calls.length, ...(await T.inspect(blob)) };
      } finally {
        HTMLCanvasElement.prototype.toBlob = real;
      }
    });
    assertAvatar(out, "stepped quality");
    assert(out.stepped.join(",") === "image/webp 0.9,image/webp 0.8,image/webp 0.7,image/webp 0.6,image/webp 0.5",
      `expected WebP at falling qualities until one fit, got ${out.stepped.join(", ")}`);
    assert(out.gaveUp?.code === "too_big", `expected too_big when no quality fits, got ${JSON.stringify(out.gaveUp)}`);
    assert(out.tried === 14, `expected every WebP and then every JPEG quality to be tried, got ${out.tried} attempts`);
  });

  await runTest("even pure noise at full detail fits in 256 KB", async () => {
    const out = await page.evaluate(async () => {
      const { source } = await AvatarImage.loadImage(await T.file(512, 512, "noise"));
      const { blob, type } = await AvatarImage.prepareAvatar(source, { x: 128, y: 128, size: 256 });
      return { blobType: blob.type, type, ...(await T.inspect(blob)) };
    });
    assertAvatar(out, "noise");
  });

  await runTest("stripMetadata drops EXIF, ICC, IPTC and comments from a JPEG, and EXIF, XMP and ICC from a WebP", async () => {
    const out = await page.evaluate(async () => {
      const latin1 = (bytes) => new TextDecoder("latin1").decode(bytes);
      const dims = async (bytes, type) => { const b = await createImageBitmap(new Blob([bytes], { type })); return `${b.width}x${b.height}`; };
      const segment = (marker, text) => {
        const body = new TextEncoder().encode(text);
        return new Uint8Array([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
      };
      // Chrome's own JPEG already carries an ICC profile (APP2); add EXIF, IPTC (APP13) and a comment.
      const ownJpeg = await T.bytes(await T.file(120, 90, "quadrants", "image/jpeg"));
      const jpeg = await T.afterSoi(new Blob([ownJpeg]), T.exifSegment(1), segment(0xed, "Photoshop 3.0 IPTC city"), segment(0xfe, "shot on a phone"));
      const jpegBytes = await T.bytes(jpeg);
      const cleanJpeg = AvatarImage.stripMetadata(jpegBytes, "image/jpeg");
      const jpegNames = ["Exif", "ICC_PROFILE", "Photoshop", "shot on a phone"];

      // Chrome's own WebP is extended (VP8X) with an ICC profile. Rebuild it with EXIF and XMP chunks added
      // after the image, where the format puts them, and the VP8X flags claiming them.
      const ownWebp = await T.bytes(await T.file(120, 90, "quadrants", "image/webp"));
      const chunks = [];
      for (let i = 12; i + 8 <= ownWebp.length;) {
        const id = latin1(ownWebp.subarray(i, i + 4)), size = new DataView(ownWebp.buffer).getUint32(i + 4, true);
        const end = i + 8 + size + (size & 1);
        chunks.push({ id, bytes: ownWebp.slice(i, end) });
        i = end;
      }
      const vp8x = chunks.find((c) => c.id === "VP8X");
      const chunk = (id, data) => {
        const bytes = new Uint8Array(8 + data.length + (data.length & 1));
        bytes.set([...id].map((ch) => ch.charCodeAt(0)));
        new DataView(bytes.buffer).setUint32(4, data.length, true);
        bytes.set(data, 8);
        return bytes;
      };
      if (vp8x) vp8x.bytes[8] |= 0x08 | 0x04;
      const body = [...chunks.map((c) => c.bytes), chunk("EXIF", T.exifSegment(1).subarray(4)), chunk("XMP ", new TextEncoder().encode("<x:xmpmeta>GPS</x:xmpmeta>"))];
      const riff = new Uint8Array(12 + body.reduce((n, b) => n + b.length, 0));
      riff.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
      new DataView(riff.buffer).setUint32(4, riff.length - 8, true);
      let at = 12;
      for (const b of body) { riff.set(b, at); at += b.length; }
      const cleanWebp = AvatarImage.stripMetadata(riff, "image/webp");
      const webpNames = ["EXIF", "Exif", "XMP", "xmpmeta", "ICCP"];
      // Without its sRGB profile a picture must look the same: compare every pixel of each decode.
      const pixels = async (bytes, type) => {
        const b = await createImageBitmap(new Blob([bytes], { type }));
        const c = document.createElement("canvas");
        c.width = b.width;
        c.height = b.height;
        const x = c.getContext("2d");
        x.drawImage(b, 0, 0);
        return x.getImageData(0, 0, b.width, b.height).data;
      };
      const maxDiff = async (a, b, type) => {
        const [pa, pb] = [await pixels(a, type), await pixels(b, type)];
        let max = 0;
        for (let i = 0; i < pa.length; i++) max = Math.max(max, Math.abs(pa[i] - pb[i]));
        return max;
      };
      return {
        colorShift: [await maxDiff(ownJpeg, AvatarImage.stripMetadata(ownJpeg, "image/jpeg"), "image/jpeg"), await maxDiff(ownWebp, AvatarImage.stripMetadata(ownWebp, "image/webp"), "image/webp")],
        ownChunks: chunks.map((c) => c.id),
        jpegHad: jpegNames.filter((s) => latin1(jpegBytes).includes(s)), jpegLeft: jpegNames.filter((s) => latin1(cleanJpeg).includes(s)),
        jpegBefore: await dims(jpegBytes, "image/jpeg"), jpegAfter: await dims(cleanJpeg, "image/jpeg"),
        webpHad: webpNames.filter((s) => latin1(riff).includes(s)), webpLeft: webpNames.filter((s) => latin1(cleanWebp).includes(s)),
        webpBefore: await dims(riff, "image/webp"), webpAfter: await dims(cleanWebp, "image/webp"),
        riffSize: new DataView(cleanWebp.buffer).getUint32(4, true), webpLength: cleanWebp.length, flags: cleanWebp[20],
        junk: [AvatarImage.stripMetadata(new Uint8Array([1, 2, 3, 4, 5]), "image/jpeg"), AvatarImage.stripMetadata(new Uint8Array(30), "image/webp")],
      };
    });
    assert(out.jpegHad.length === 4, `test setup: the JPEG should start with all four kinds of metadata, had ${out.jpegHad.join(", ")}`);
    assert(out.jpegLeft.length === 0, `JPEG metadata left behind: ${out.jpegLeft.join(", ")}`);
    assert(out.jpegBefore === "120x90" && out.jpegAfter === "120x90", `the stripped JPEG should still decode at 120x90, got ${out.jpegAfter}`);
    assert(out.webpHad.length === 5, `test setup: the WebP should start with EXIF, XMP and ICC (chunks ${out.ownChunks.join(", ")}), had ${out.webpHad.join(", ")}`);
    assert(out.webpLeft.length === 0, `WebP metadata left behind: ${out.webpLeft.join(", ")}`);
    assert(out.webpBefore === "120x90" && out.webpAfter === "120x90", `the stripped WebP should still decode at 120x90, got ${out.webpAfter}`);
    assert(out.riffSize === out.webpLength - 8, "the RIFF size should be rewritten to the new length");
    assert((out.flags & 0x2c) === 0, `VP8X should no longer claim ICC, EXIF or XMP, flags ${out.flags}`);
    assert(out.junk.every((j) => j === null), "bytes that aren't a JPEG or WebP should give null");
    assert(out.colorShift.every((d) => d <= 1), `dropping the sRGB profile shouldn't change any pixel, max channel change JPEG ${out.colorShift[0]}, WebP ${out.colorShift[1]}`);
  });

  await runTest("loadImage refuses a file that isn't a picture (unsupported) and one over 25 MB (too_big)", async () => {
    const out = await page.evaluate(async () => ({
      text: await T.error(AvatarImage.loadImage(new File(["just some words"], "notes.txt", { type: "text/plain" }))),
      fake: await T.error(AvatarImage.loadImage(new File([new Uint8Array(4096).fill(7)], "photo.jpg", { type: "image/jpeg" }))),
      nothing: await T.error(AvatarImage.loadImage(null)),
      big: await T.error(AvatarImage.loadImage(new File([new Uint8Array(AvatarImage.MAX_INPUT_BYTES + 1)], "huge.jpg", { type: "image/jpeg" }))),
      limit: AvatarImage.MAX_INPUT_BYTES,
    }));
    assert(out.text?.code === "unsupported", `a text file should be unsupported, got ${JSON.stringify(out.text)}`);
    assert(out.fake?.code === "unsupported", `garbage named .jpg should be unsupported, got ${JSON.stringify(out.fake)}`);
    assert(out.nothing?.code === "unsupported", `no file should be unsupported, got ${JSON.stringify(out.nothing)}`);
    assert(out.big?.code === "too_big", `a file over 25 MB should be too_big, got ${JSON.stringify(out.big)}`);
    assert(out.limit === 25 * 1024 * 1024, "the input limit is 25 MB");
  });
} finally {
  await browser.close();
  server.close();
}

console.log("test-avatar-image.mjs done");
