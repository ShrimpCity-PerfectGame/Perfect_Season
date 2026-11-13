// From the owner's two sprite sheets: cut one pose, erase its painted number, recolour it for a team and a skin tone.
// node build-sprites.mjs <projectRoot> <outDir> <sheet1.png> <sheet2.png>   -> outDir/sprites.js + outDir/check.png
import fs from "fs";
import { createRequire } from "module";
const [,, root, outDir, ...sheets] = process.argv;
const require = createRequire(root + "/package.json");
const puppeteer = require("puppeteer-core");
const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].filter(Boolean).find((p) => fs.existsSync(p));

// card key -> which sheet/cell, the team's jersey colour, what the grey helmet and pants become (null keeps silver), skin
const WANT = {
  jones:     { sheet: 1, cell: 6, a: "#0b162a", metal: null,      skin: "#8d5a3b" },
  henderson: { sheet: 1, cell: 4, a: "#101820", metal: "#d3bc8d", skin: "#7a4a2e" },
  gates:     { sheet: 0, cell: 6, a: "#0080c6", metal: "#ffc20e", skin: "#9c6644" },
  peterson:  { sheet: 1, cell: 1, a: "#4f2683", metal: "#ffc62f", skin: "#6f4329" },
  brady:     { sheet: 0, cell: 1, a: "#002244", metal: null,      skin: "#f0c9a4" },
};

const b = await puppeteer.launch({ executablePath: exe, headless: "new" });
const pg = await b.newPage();
const urls = sheets.map((f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64"));
const result = await pg.evaluate(async (urls, WANT) => {
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; };
  const rgb = (h, s, l) => { h /= 360; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const t = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; }; return [t(h + 1 / 3) * 255, t(h) * 255, t(h - 1 / 3) * 255]; };
  const hex = (x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)];
  const median = (xs) => { xs.sort((p, q) => p - q); return xs[xs.length >> 1] || 0.5; };

  // --- 1. clear the paper and the ground shadow, then split into connected pieces ---
  const cut = [];
  for (const url of urls) {
    const img = new Image(); img.src = url; await img.decode();
    const W = img.width, H = img.height, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const im = g.getImageData(0, 0, W, H), d = im.data, bg = [d[0], d[1], d[2]];
    const paper = (i) => Math.abs(d[i] - bg[0]) <= 26 && Math.abs(d[i + 1] - bg[1]) <= 26 && Math.abs(d[i + 2] - bg[2]) <= 26;
    const shadow = (i) => { const r = d[i], gg = d[i + 1], bb = d[i + 2], mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb); return mx - mn < 22 && r >= gg && gg >= bb - 2 && mx > 120 && mx < 245 && r - bb > 4; };
    const gone = new Uint8Array(W * H), st = [];
    for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
    while (st.length) { const p = st.pop(); if (gone[p] || !(paper(p * 4) || shadow(p * 4))) continue; gone[p] = 1; const x = p % W; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < W * H - W) st.push(p + W); }
    for (let p = 0; p < W * H; p++) if (gone[p]) d[p * 4 + 3] = 0;
    // pieces: each belongs to the cell its centre is in, so a neighbour's stray hand never rides along
    const lab = new Int32Array(W * H), comps = [null];
    for (let p0 = 0; p0 < W * H; p0++) {
      if (gone[p0] || lab[p0]) continue;
      const id = comps.length, px = []; let sx = 0, sy = 0; st.push(p0); lab[p0] = id;
      while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0; px.push(p); sx += x; sy += y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (!gone[q] && !lab[q]) { lab[q] = id; st.push(q); } } }
      comps.push({ px, cell: Math.min(4, Math.floor(sx / px.length / (W / 5))) + 5 * Math.min(1, Math.floor(sy / px.length / (H / 2))) });
    }
    cut.push({ W, H, d, comps });
  }

  // --- 2. one sprite: lift its pieces, find and erase the number, recolour ---
  const out = {};
  for (const key of Object.keys(WANT)) {
    const want = WANT[key], src = cut[want.sheet], W = src.W;
    const mine = src.comps.filter((cmp) => cmp && cmp.cell === want.cell && cmp.px.length > 60);
    let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
    for (const cmp of mine) for (const p of cmp.px) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, s = new Uint8ClampedArray(w * h * 4);
    for (const cmp of mine) for (const p of cmp.px) { const x = (p % W) - x0, y = ((p / W) | 0) - y0, i = (y * w + x) * 4, j = p * 4; s[i] = src.d[j]; s[i + 1] = src.d[j + 1]; s[i + 2] = src.d[j + 2]; s[i + 3] = 255; }
    const N = w * h, H2 = new Float32Array(N), S2 = new Float32Array(N), L2 = new Float32Array(N);
    for (let p = 0; p < N; p++) { const v = hsl(s[p * 4], s[p * 4 + 1], s[p * 4 + 2]); H2[p] = v[0]; S2[p] = v[1]; L2[p] = v[2]; }
    const on = (p) => s[p * 4 + 3] > 0;
    const blue = (p) => on(p) && H2[p] > 195 && H2[p] < 250 && S2[p] > 0.28 && L2[p] > 0.12 && L2[p] < 0.8;
    const white = (p) => on(p) && L2[p] > 0.86 && S2[p] < 0.5;
    const label = (test) => { const lab = new Int32Array(N), list = [null], st = []; for (let p0 = 0; p0 < N; p0++) { if (lab[p0] || !test(p0)) continue; const id = list.length, px = []; lab[p0] = id; st.push(p0); while (st.length) { const p = st.pop(), x = p % w; px.push(p); for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < N && !lab[q] && test(q)) { lab[q] = id; st.push(q); } } list.push(px); } return { lab, list }; };
    const B = label(blue); let jersey = 1; for (let i = 2; i < B.list.length; i++) if (B.list[i].length > B.list[jersey].length) jersey = i;
    const Wh = label(white), digits = [];
    for (let i = 1; i < Wh.list.length; i++) {
      const px = Wh.list[i]; if (px.length < 90) continue;
      let ring = 0, inJersey = 0; const seen = new Set();
      for (const p of px) { const x = p % w, y = (p / w) | 0; for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (Wh.lab[q] === i || seen.has(q)) continue; seen.add(q); ring++; if (B.lab[q] === jersey) inJersey++; } }
      if (ring && inJersey / ring > 0.5) digits.push(px);
    }
    // the jersey's own middle tone, to paint over where the number was
    const jl = median(B.list[jersey].map((p) => L2[p])); let jr = 0, jg = 0, jb = 0, jn = 0;
    for (const p of B.list[jersey]) if (Math.abs(L2[p] - jl) < 0.04) { jr += s[p * 4]; jg += s[p * 4 + 1]; jb += s[p * 4 + 2]; jn++; }
    jr /= jn; jg /= jn; jb /= jn;
    let nx0 = 1e9, ny0 = 1e9, nx1 = 0, ny1 = 0; const cents = [];
    for (const px of digits) { let sx = 0, sy = 0; for (const p of px) { const x = p % w, y = (p / w) | 0; sx += x; sy += y; if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; const q = qy * w + qx; if (on(q) && L2[q] > 0.22) { s[q * 4] = jr; s[q * 4 + 1] = jg; s[q * 4 + 2] = jb; L2[q] = jl; H2[q] = 220; S2[q] = 0.6; } } }
      cents.push([sx / px.length, sy / px.length]); }
    cents.sort((p, q) => p[0] - q[0]);
    const rot = cents.length > 1 ? Math.atan2(cents[cents.length - 1][1] - cents[0][1], cents[cents.length - 1][0] - cents[0][0]) * 180 / Math.PI : 0;
    // recolour: keep every pixel's shading, swap what it is a shade OF
    const A = hsl(...hex(want.a)), M = want.metal ? hsl(...hex(want.metal)) : null, K = hsl(...hex(want.skin));
    const skin = (p) => on(p) && H2[p] > 14 && H2[p] < 42 && S2[p] > 0.28 && L2[p] > 0.45 && L2[p] < 0.85;
    const grey = (p) => on(p) && S2[p] < 0.1 && L2[p] > 0.3 && L2[p] < 0.85;
    const kl = median(Array.from({ length: N }, (_, p) => p).filter(skin).map((p) => L2[p]));
    for (let p = 0; p < N; p++) {
      let c = null;
      if (blue(p)) c = rgb(A[0], A[1], Math.min(0.93, Math.max(0.03, A[2] * L2[p] / jl)));
      else if (skin(p)) c = rgb(K[0], K[1], Math.min(0.95, K[2] * L2[p] / kl));
      else if (M && grey(p)) c = rgb(M[0], M[1], Math.min(0.95, M[2] * L2[p] / 0.68));
      if (c) { s[p * 4] = c[0]; s[p * 4 + 1] = c[1]; s[p * 4 + 2] = c[2]; }
    }
    const big = document.createElement("canvas"); big.width = w; big.height = h; big.getContext("2d").putImageData(new ImageData(s, w, h), 0, 0);
    const th = 300, tw = Math.round(w * th / h), small = document.createElement("canvas"); small.width = tw; small.height = th;
    const sg = small.getContext("2d"); sg.imageSmoothingQuality = "high"; sg.drawImage(big, 0, 0, tw, th);
    out[key] = { src: small.toDataURL("image/png"), ar: +(w / h).toFixed(4), digits: digits.length,
      nx: +(((nx0 + nx1) / 2 / w) * 100).toFixed(2), ny: +(((ny0 + ny1) / 2 / h) * 100).toFixed(2), nh: +((ny1 - ny0 + 1) / h).toFixed(4), nw: +((nx1 - nx0 + 1) / h).toFixed(4), rot: +rot.toFixed(1) };
  }
  return out;
}, urls, WANT);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outDir + "/sprites.js", "var GS_SPRITES = " + JSON.stringify(result) + ";\n");
for (const k of Object.keys(result)) console.log(k, { ...result[k], src: (result[k].src.length / 1024 | 0) + "KB" });
await pg.setViewport({ width: 1500, height: 330, deviceScaleFactor: 1 });
await pg.setContent(`<body style="margin:0;background:#e9e3d3;display:flex">` + Object.keys(result).map((k) => `<div style="width:300px;height:330px;display:flex;align-items:center;justify-content:center"><img style="height:300px" src="${result[k].src}"></div>`).join("") + `</body>`);
await pg.screenshot({ path: outDir + "/check.png" });
await b.close();
