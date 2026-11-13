// Cuts the owner's pack pictures out of their paper: static/cards/packs/<pack id>.webp.
//
//   node tools/cards/build-pack-art.mjs
//
// Each source is one foil pack photographed-style on a cream sheet. This clears the sheet to transparent by
// flood fill FROM THE EDGES (so nothing cream-coloured inside the pack's outline is touched), crops to what is
// left, and writes it 480 pixels tall - a pack is drawn at about 200 CSS pixels, so that is sharp on a phone.
//
// Which picture is which pack is the table below, and the ids are card-packs.mjs's. It needs the installed
// Chrome (puppeteer-core), exactly as tools/cards/build-sprites.mjs does, and for the same reason. It is a
// development tool: nothing here ships, only the images it writes.
//
// LOOK AT EVERY IMAGE IT WRITES before committing. A soft shadow left as a fringe, or a bite taken out of a
// pale edge, fails no test - tests/test-card-sprites.mjs holds the files' shape, not their content.
//
// KNOWN, AND THE OWNER'S TO REPLACE: the Standard pack's picture has words painted into it ("FOOTBALL BOOSTER",
// "COMMON TIER") that are not this game's name for anything. It is fine for the test site; a wordless picture
// is owed before production. Replacing a source and re-running this is the whole job.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const puppeteer = require("puppeteer-core");
const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"].filter(Boolean).find((p) => fs.existsSync(p));
if (!exe) throw new Error("No Chrome found - set CHROME_PATH");

const HEIGHT = 480;
const TOLERANCE = 34; // how far from the corner's colour still counts as paper (the shadow is a little darker)
const SOURCES = {
  "pack-standard": "pack-common.jpg",
  "pack-air-raid": "pack-lightning.jpg",
  "pack-legends": "pack-crown.jpg",
};

const browser = await puppeteer.launch({ executablePath: exe, headless: "new" });
const page = await browser.newPage();
const outDir = path.join(root, "static/cards/packs");
fs.mkdirSync(outDir, { recursive: true });
for (const [id, file] of Object.entries(SOURCES)) {
  const url = "data:image/jpeg;base64," + fs.readFileSync(path.join(root, "tools/cards/source", file)).toString("base64");
  const res = await page.evaluate(async (url, HEIGHT, TOLERANCE) => {
    const img = new Image(); img.src = url; await img.decode();
    const W = img.width, H = img.height, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const im = g.getImageData(0, 0, W, H), d = im.data, bg = [d[0], d[1], d[2]];
    const paper = (i) => Math.abs(d[i] - bg[0]) <= TOLERANCE && Math.abs(d[i + 1] - bg[1]) <= TOLERANCE && Math.abs(d[i + 2] - bg[2]) <= TOLERANCE;
    const gone = new Uint8Array(W * H), st = [];
    const push = (x, y) => { const k = y * W + x; if (x >= 0 && y >= 0 && x < W && y < H && !gone[k] && paper(k * 4)) { gone[k] = 1; st.push(k); } };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (st.length) { const k = st.pop(), x = k % W, y = (k / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    let x0 = W, y0 = H, x1 = 0, y1 = 0, kept = 0;
    for (let k = 0; k < W * H; k++) {
      if (gone[k]) { d[k * 4 + 3] = 0; continue; }
      kept++; const x = k % W, y = (k / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    // Soften the cut edge by one pixel so it does not read as scissors on a dark page.
    for (let k = 0; k < W * H; k++) {
      if (gone[k]) continue; const x = k % W, y = (k / W) | 0;
      if ((x > 0 && gone[k - 1]) || (x < W - 1 && gone[k + 1]) || (y > 0 && gone[k - W]) || (y < H - 1 && gone[k + W])) d[k * 4 + 3] = 150;
    }
    g.putImageData(im, 0, 0);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, scale = HEIGHT / ch;
    const out = document.createElement("canvas"); out.width = Math.round(cw * scale); out.height = HEIGHT;
    const og = out.getContext("2d"); og.imageSmoothingQuality = "high";
    og.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
    return { png: out.toDataURL("image/webp", 0.9).split(",")[1], width: out.width, height: out.height, kept: kept / (W * H) };
  }, url, HEIGHT, TOLERANCE);
  // A cut that kept nearly everything cleared no paper; one that kept nearly nothing ate the pack.
  if (res.kept < 0.25 || res.kept > 0.8) throw new Error(`${id}: kept ${(100 * res.kept).toFixed(0)}% of the picture - that is not a pack on a sheet`);
  fs.writeFileSync(path.join(outDir, `${id}.webp`), Buffer.from(res.png, "base64"));
  console.log(`${id}.webp  ${res.width}x${res.height}  (${(100 * res.kept).toFixed(0)}% of the source kept)`);
}
await browser.close();
