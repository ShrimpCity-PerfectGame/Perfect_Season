// Cuts the owner's sprite sheets into one neutral sprite per pose: static/cards/<pose>.webp and sprites.json.
// (WebP since v2.24.3: at 640 tall a PNG of this artwork is 400 KB and there are fourteen of them. The browser
// recolours by REGION, so the small colour error a lossy file brings moves nothing - check that again if the
// quality below is ever lowered.)
//
//   node tools/cards/build-sprites.mjs
//
// "Neutral" means still in the sheets' own colours - blue jersey, grey helmet and pants, tan skin - with the
// paper cleared to transparent and the painted jersey number erased. The team's colours and the card's skin tone
// are put on in the BROWSER (card-sprites.mjs), which is why fourteen images serve every one of 3,124 cards and
// there is no file per team. tools/cards/poses.json says which cell of which sheet is which pose.
//
// It needs the installed Chrome (puppeteer-core, as tools/ui-harness/audit.mjs does): the work is pixel work on
// a canvas, and Chrome is the canvas this repo already has. CHROME_PATH overrides where it looks. It is a
// development tool - nothing here ships, only the PNGs it writes.
//
// THE THREE STAGES, and what each is careful about:
//   1. Clear the paper and the soft ground shadow, by flood fill FROM THE EDGES - so the white gloves and
//      cleats, which are paper-coloured but sit inside a black outline, survive. Then split what is left into
//      connected pieces and give each to the grid cell its centre is in, so a neighbour's stray hand that pokes
//      over a cell boundary never rides along.
//   2. Refuse a cell that is two players. (The owner's fifty-pose sheet has several - tackles and blocks - and a
//      two-man sprite cannot be one player's card.) Told by shape: far wider than one player ever is.
//   3. Erase the painted number: white pieces whose surroundings are mostly the jersey. A sheet with blank
//      jerseys simply has none, and that is fine.
//   4. Enlarge, smoothly. The cut-out's edge is a hard yes-or-no per pixel, so enlarging it enlarges the stairs.
//      The silhouette is therefore blurred and re-cut at the new size, which turns stairs into a curve, and the
//      colours are enlarged and then sharpened so the black lines stay crisp instead of going soft.
//   5. Whiten the shaded patches of white kit that poses.json lists under "white". A glove's shadow or a
//      shoe's sole is drawn in the helmet's own grey, and where the outline closes round one the browser has
//      no way to know it is not helmet: it painted the pointing player's fist in the team's second colour.
//      Each entry is the middle of one such patch, in the finished sprite's pixels. An entry that no longer
//      finds its patch stops the build - after a new sheet or a new HEIGHT, look again and re-list them.
//      (tools: paint the helmet colour bright and look for it on a hand or a foot.)
//      And the other way round, under "grey": pants a sheet drew white, or faded most of the way to white, so
//      that pose alone wore white pants while the other thirteen wore the team's. Those are darkened into the
//      helmet's grey. It costs that pose the white edging of its pants stripe, which was the same white.
//      And "mask": eight poses drew the face mask in the helmet's grey and joined to the helmet, so it took the
//      team's second colour while the other six wore a white one. A mask cannot be found as a region - it IS
//      the helmet's region - so it is found by being THIN: inside the box listed, any grey that vanishes when
//      the grey is worn away by MASK_BAR pixels and grown back is a bar, and is whitened. The helmet's shell
//      is far thicker than that and survives.
//
// LOOK AT EVERY IMAGE IT WRITES before committing. A number half-erased, a hole where paper was cleared inside
// a broken outline, a second player's arm - none of those fail a test. tests/test-card-sprites.mjs holds the
// files' shape, not their content.
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

// Every sprite is written this tall. A card draws it at up to 250 CSS pixels, which is 750 real ones on a phone,
// and at 300 tall (the first version) the owner's phone showed every stair in the outline. The sheets only hold
// a player at about 400 pixels, so this is an ENLARGEMENT, and stage 4 is what keeps it from looking like one.
const HEIGHT = 640;
const MAX_ASPECT = 1.25; // wider than this, relative to its height, and a cell is refused as two players
const config = JSON.parse(fs.readFileSync(path.join(root, "tools/cards/poses.json"), "utf8"));
const sheetFiles = Object.fromEntries(Object.entries(config.sheets).map(([id, s]) => [id, { ...s, url: "data:image/png;base64," + fs.readFileSync(path.join(root, "tools/cards", s.file)).toString("base64") }]));

const browser = await puppeteer.launch({ executablePath: exe, headless: "new" });
const page = await browser.newPage();
const result = await page.evaluate(async (sheets, poses, HEIGHT, MAX_ASPECT, whites, greys, masks) => {
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; };
  const median = (xs) => { xs.sort((p, q) => p - q); return xs[xs.length >> 1] ?? 0.5; };

  // --- 1. clear the paper and the ground shadow; split into connected pieces ---
  const cut = {};
  for (const [id, sheet] of Object.entries(sheets)) {
    const img = new Image(); img.src = sheet.url; await img.decode();
    const W = img.width, H = img.height, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data, bg = [d[0], d[1], d[2]];
    const paper = (i) => Math.abs(d[i] - bg[0]) <= 26 && Math.abs(d[i + 1] - bg[1]) <= 26 && Math.abs(d[i + 2] - bg[2]) <= 26;
    const shadow = (i) => { const r = d[i], gg = d[i + 1], bb = d[i + 2], mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb); return mx - mn < 22 && r >= gg && gg >= bb - 2 && mx > 120 && mx < 245 && r - bb > 4; };
    const gone = new Uint8Array(W * H), st = [];
    for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
    while (st.length) { const p = st.pop(); if (gone[p] || !(paper(p * 4) || shadow(p * 4))) continue; gone[p] = 1; const x = p % W; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < W * H - W) st.push(p + W); }
    const lab = new Int32Array(W * H), comps = [];
    for (let p0 = 0; p0 < W * H; p0++) {
      if (gone[p0] || lab[p0]) continue;
      const px = []; let sx = 0, sy = 0; st.push(p0); lab[p0] = comps.length + 1;
      while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0; px.push(p); sx += x; sy += y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (!gone[q] && !lab[q]) { lab[q] = comps.length + 1; st.push(q); } } }
      const col = Math.min(sheet.cols - 1, Math.floor(sx / px.length / (W / sheet.cols)));
      const row = Math.min(sheet.rows - 1, Math.floor(sy / px.length / (H / sheet.rows)));
      comps.push({ px, cell: row * sheet.cols + col });
    }
    cut[id] = { W, d, comps };
  }

  const out = {};
  for (const [pose, [sheetId, cell]] of Object.entries(poses)) {
    const src = cut[sheetId], W = src.W;
    const mine = src.comps.filter((cmp) => cmp.cell === cell && cmp.px.length > 60);
    if (!mine.length) throw new Error(`${pose}: sheet ${sheetId} cell ${cell} is empty`);
    let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
    for (const cmp of mine) for (const p of cmp.px) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, s = new Uint8ClampedArray(w * h * 4);
    for (const cmp of mine) for (const p of cmp.px) { const x = (p % W) - x0, y = ((p / W) | 0) - y0, i = (y * w + x) * 4, j = p * 4; s[i] = src.d[j]; s[i + 1] = src.d[j + 1]; s[i + 2] = src.d[j + 2]; s[i + 3] = 255; }
    const N = w * h, Hh = new Float32Array(N), Ss = new Float32Array(N), Ll = new Float32Array(N);
    for (let p = 0; p < N; p++) { const v = hsl(s[p * 4], s[p * 4 + 1], s[p * 4 + 2]); Hh[p] = v[0]; Ss[p] = v[1]; Ll[p] = v[2]; }
    const on = (p) => s[p * 4 + 3] > 0;
    const blue = (p) => on(p) && Hh[p] > 195 && Hh[p] < 250 && Ss[p] > 0.28 && Ll[p] > 0.12 && Ll[p] < 0.8;
    const white = (p) => on(p) && Ll[p] > 0.86 && Ss[p] < 0.5;
    const label = (test) => { const lab = new Int32Array(N), list = [null], st = []; for (let p0 = 0; p0 < N; p0++) { if (lab[p0] || !test(p0)) continue; const id = list.length, px = []; lab[p0] = id; st.push(p0); while (st.length) { const p = st.pop(), x = p % w; px.push(p); for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < N && !lab[q] && test(q)) { lab[q] = id; st.push(q); } } list.push(px); } return { lab, list }; };

    // --- 2. one player a cell ---
    // Told by SHAPE: a lone player, even diving, is no wider than about 1.15 times his height on these sheets,
    // and a two-man tackle or block is well past that. (Counting helmets was tried first and cannot work: the
    // helmet and the pants are the same grey, so every player in grey pants looked like two.) It is a guard
    // against a wrong cell in poses.json, not a substitute for looking at the contact sheet.
    if (w / h > MAX_ASPECT) throw new Error(`${pose}: sheet ${sheetId} cell ${cell} is ${(w / h).toFixed(2)} times as wide as it is tall - that looks like two players. If it really is one, raise MAX_ASPECT.`);

    // --- 3. erase the painted number, if there is one ---
    const B = label(blue); let jersey = 1; for (let i = 2; i < B.list.length; i++) if (B.list[i].length > B.list[jersey].length) jersey = i;
    if (!B.list[jersey]) throw new Error(`${pose}: no jersey found`);
    const jl = median(B.list[jersey].map((p) => Ll[p])); let jr = 0, jg = 0, jb = 0, jn = 0;
    for (const p of B.list[jersey]) if (Math.abs(Ll[p] - jl) < 0.04) { jr += s[p * 4]; jg += s[p * 4 + 1]; jb += s[p * 4 + 2]; jn++; }
    jr /= jn; jg /= jn; jb /= jn;
    const Wh = label(white); let digits = 0;
    for (let i = 1; i < Wh.list.length; i++) {
      const px = Wh.list[i]; if (px.length < 90) continue;
      let ring = 0, inJersey = 0; const seen = new Set();
      for (const p of px) { const x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (Wh.lab[q] === i || seen.has(q)) continue; seen.add(q); ring++; if (B.lab[q] === jersey) inJersey++; } }
      if (!ring || inJersey / ring <= 0.35) continue;
      digits++;
      for (const p of px) { const x = p % w, y = (p / w) | 0;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; const q = qy * w + qx; if (on(q) && Ll[q] > 0.22) { s[q * 4] = jr; s[q * 4 + 1] = jg; s[q * 4 + 2] = jb; Ll[q] = jl; } } }
    }
    const big = document.createElement("canvas"); big.width = w; big.height = h; big.getContext("2d").putImageData(new ImageData(s, w, h), 0, 0);
    // --- 4. enlarge, smoothly ---
    const tw = Math.round(w * HEIGHT / h), scale = HEIGHT / h, TN = tw * HEIGHT;
    const draw = (blur) => { const cv = document.createElement("canvas"); cv.width = tw; cv.height = HEIGHT; const cg = cv.getContext("2d", { willReadFrequently: true }); cg.imageSmoothingQuality = "high"; if (blur) cg.filter = `blur(${blur}px)`; cg.drawImage(big, 0, 0, tw, HEIGHT); return cg.getImageData(0, 0, tw, HEIGHT).data; };
    // The colours ride on a copy whose paper is BLACK rather than clear, so the outline's own colour runs out
    // past the edge and the new silhouette never uncovers a pale fringe.
    const solid = document.createElement("canvas"); solid.width = w; solid.height = h;
    { const g2 = solid.getContext("2d"); g2.fillStyle = "#101014"; g2.fillRect(0, 0, w, h); g2.drawImage(big, 0, 0); }
    const drawSolid = (blur) => { const cv = document.createElement("canvas"); cv.width = tw; cv.height = HEIGHT; const cg = cv.getContext("2d", { willReadFrequently: true }); cg.imageSmoothingQuality = "high"; if (blur) cg.filter = `blur(${blur}px)`; cg.drawImage(solid, 0, 0, tw, HEIGHT); return cg.getImageData(0, 0, tw, HEIGHT).data; };
    const plain = drawSolid(0), soft = drawSolid(1.1 * scale), edge = draw(0.6 * scale);
    const fin = new Uint8ClampedArray(TN * 4), SHARPEN = 0.6, STEEP = 2.2;
    for (let p = 0; p < TN; p++) {
      const i = p * 4;
      for (let ch = 0; ch < 3; ch++) fin[i + ch] = plain[i + ch] + SHARPEN * (plain[i + ch] - soft[i + ch]);
      fin[i + 3] = Math.max(0, Math.min(255, (edge[i + 3] - 127.5) * STEEP + 127.5));
    }
    // --- 5. whiten the listed patches of white kit ---
    // The same test the browser makes for "grey" (card-sprites.mjs), so a patch here is a region there.
    const wanted = [...(whites[pose] || []).map(([x, y]) => ({ x, y, to: "white", found: false })), ...(greys[pose] || []).map(([x, y]) => ({ x, y, to: "grey", found: false }))];
    if (wanted.length) {
      const grey = new Uint8Array(TN), lt = new Float32Array(TN), seen = new Uint8Array(TN);
      for (let p = 0; p < TN; p++) { if (!fin[p * 4 + 3]) continue; const mx = Math.max(fin[p * 4], fin[p * 4 + 1], fin[p * 4 + 2]), mn = Math.min(fin[p * 4], fin[p * 4 + 1], fin[p * 4 + 2]); lt[p] = (mx + mn) / 510; if (lt[p] > 0.3 && mx - mn < 40) grey[p] = 1; }
      for (let p0 = 0; p0 < TN; p0++) {
        if (!grey[p0] || seen[p0]) continue;
        const px = [p0]; seen[p0] = 1; let sx = 0, sy = 0;
        for (let a = 0; a < px.length; a++) { const p = px[a], x = p % tw; sx += x; sy += (p / tw) | 0; for (const q of [x > 0 ? p - 1 : -1, x < tw - 1 ? p + 1 : -1, p - tw, p + tw]) if (q >= 0 && q < TN && grey[q] && !seen[q]) { seen[q] = 1; px.push(q); } }
        const cx = sx / px.length, cy = sy / px.length;
        const hit = wanted.find((t) => !t.found && (t.to === "grey" || px.length < 9000) && Math.abs(t.x - cx) <= 12 && Math.abs(t.y - cy) <= 12);
        if (!hit) continue;
        hit.found = true;
        // Keep the shading either way. A white: every pixel lands lighter than the browser's line between grey
        // and white. A grey: the lighter half is squeezed into 0.60-0.80, round the helmet's own 0.68 and under
        // the point where the browser starts fading a grey back to white.
        for (const p of px) { const v = 255 * (hit.to === "white" ? 0.89 + 0.09 * lt[p] : lt[p] < 0.5 ? lt[p] : 0.6 + 0.4 * (lt[p] - 0.5)); fin[p * 4] = fin[p * 4 + 1] = fin[p * 4 + 2] = v; }
      }
      const lost = wanted.filter((t) => !t.found);
      if (lost.length) throw new Error(`${pose}: no grey patch at ${lost.map((t) => `${t.x},${t.y}`).join(" or ")} - poses.json's "white" and "grey" lists no longer match the drawing`);
    }
    if (masks[pose]) {
      const [bx0, by0, bx1, by1] = masks[pose], MASK_BAR = 12;
      const grey = new Uint8Array(TN);
      for (let p = 0; p < TN; p++) { if (!fin[p * 4 + 3]) continue; const mx = Math.max(fin[p * 4], fin[p * 4 + 1], fin[p * 4 + 2]), mn = Math.min(fin[p * 4], fin[p * 4 + 1], fin[p * 4 + 2]); if ((mx + mn) / 510 > 0.3 && mx - mn < 40) grey[p] = 1; }
      // steps (8-neighbour) from the nearest pixel of `from`
      const steps = (from) => {
        const D = new Int32Array(TN).fill(1e9), q = [];
        for (let p = 0; p < TN; p++) if (from(p)) { D[p] = 0; q.push(p); }
        for (let a = 0; a < q.length; a++) { const p = q[a], x = p % tw, y = (p / tw) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= tw || Y >= HEIGHT) continue; const r = Y * tw + X; if (D[r] > D[p] + 1) { D[r] = D[p] + 1; q.push(r); } } }
        return D;
      };
      const out = steps((p) => !grey[p]);
      const core = steps((p) => grey[p] && out[p] > MASK_BAR);
      let done = 0;
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const p = y * tw + x;
        if (!grey[p] || core[p] <= MASK_BAR + 1) continue;
        // lighter than where the browser stops fading a grey back to white, so none of the helmet colour lands
        const v = 255 * (0.955 + 0.04 * (Math.max(fin[p * 4], fin[p * 4 + 1], fin[p * 4 + 2]) + Math.min(fin[p * 4], fin[p * 4 + 1], fin[p * 4 + 2])) / 510);
        fin[p * 4] = fin[p * 4 + 1] = fin[p * 4 + 2] = v; done++;
      }
      if (done < 3000) throw new Error(`${pose}: only ${done} pixels of face mask in poses.json's "mask" box - it no longer matches the drawing`);
    }
    const small = document.createElement("canvas"); small.width = tw; small.height = HEIGHT;
    small.getContext("2d").putImageData(new ImageData(fin, tw, HEIGHT), 0, 0);
    out[pose] = { png: small.toDataURL("image/webp", 0.9), w: tw, h: HEIGHT, digits, source: `${sheetId}:${cell}` };
  }
  return out;
}, sheetFiles, config.poses, HEIGHT, MAX_ASPECT, config.white || {}, config.grey || {}, config.mask || {});

const dir = path.join(root, "static/cards");
fs.mkdirSync(dir, { recursive: true });
const meta = {};
for (const [pose, r] of Object.entries(result)) {
  if (!r.png.startsWith("data:image/webp")) throw new Error("this Chrome did not write a WebP");
  fs.writeFileSync(path.join(dir, `${pose}.webp`), Buffer.from(r.png.split(",")[1], "base64"));
  fs.rmSync(path.join(dir, `${pose}.png`), { force: true });
  meta[pose] = { w: r.w, h: r.h };
  console.log(`${pose.padEnd(11)} ${String(r.w).padStart(3)}x${r.h}  from ${r.source}  ${r.digits ? `number erased (${r.digits} piece${r.digits === 1 ? "" : "s"})` : "blank jersey"}`);
}
fs.writeFileSync(path.join(dir, "sprites.json"), `${JSON.stringify(meta)}\n`);

// A contact sheet to LOOK at, on a dark ground so stray paper shows. Not shipped.
fs.mkdirSync(path.join(root, "build"), { recursive: true });
await page.setViewport({ width: 7 * 210, height: 2 * 330, deviceScaleFactor: 2 });
await page.setContent(`<body style="margin:0;background:#24304f;display:grid;grid-template-columns:repeat(7,210px)">` + Object.entries(result).map(([pose, r]) => `<div style="height:330px;position:relative;display:flex;align-items:flex-end;justify-content:center"><img style="height:300px" src="${r.png}"><span style="position:absolute;left:6px;top:4px;color:#fff;font:13px sans-serif">${pose}</span></div>`).join("") + `</body>`);
await page.screenshot({ path: path.join(root, "build/card-sprites-check.png") });
await browser.close();
console.log(`wrote ${Object.keys(result).length} sprites to static/cards/ - now LOOK at build/card-sprites-check.png`);
