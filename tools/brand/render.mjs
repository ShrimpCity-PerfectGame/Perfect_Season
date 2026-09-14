// Renders every raster brand asset from static/icon.svg, so they never drift from the mark:
//
//   node tools/brand/render.mjs
//
// Writes into static/ (build.mjs copies static/ into public/): favicon-32.png, icon-192.png and
// icon-512.png (the mark as drawn), apple-touch-icon.png and icon-maskable-512.png (full-bleed lime,
// because iOS and Android crop icons to their own shapes), and og.png (the 1200x630 link preview).
// Uses the installed Chrome, like tools/ui-harness/audit.mjs. og.png loads Anton and Inter from
// Google Fonts, so it needs a network connection.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../ui-harness/audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = (name) => path.join(root, "static", name);
const icon = readFileSync(out("icon.svg"), "utf8");
// Everything the mark draws on top of its tile: the arrow, its head, the ball and the lace.
const glyph = icon.replace(/^[\s\S]*?<rect[^>]*\/>/, "").replace(/<\/svg>\s*$/, "");
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#B8F500"/>`
  + `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${glyph}</g></svg>`;
const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await launch();
try {
  const page = await browser.newPage();
  async function png(svg, size, file, { transparent }) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${dataUri(svg)}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.evaluate(() => document.querySelector("img").decode());
    writeFileSync(out(file), await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } }));
    console.log(`wrote static/${file}`);
  }
  await png(icon, 32, "favicon-32.png", { transparent: true });
  await png(icon, 192, "icon-192.png", { transparent: true });
  await png(icon, 512, "icon-512.png", { transparent: true });
  // iOS rounds the corners itself; the arrow's tip stays clear of them at this scale.
  await png(fullBleed(1.15), 180, "apple-touch-icon.png", { transparent: false });
  // Android masks to a circle as small as 80% of the tile; scale 1 keeps the glyph inside it.
  await png(fullBleed(1), 512, "icon-maskable-512.png", { transparent: false });

  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@700&display=block">
<style>
  body{margin:0}
  .og{width:1200px;height:630px;box-sizing:border-box;background:#F7F4EA;color:#101114;position:relative;overflow:hidden;
    padding:58px 72px 56px;display:flex;flex-direction:column;justify-content:space-between;font-family:Inter,sans-serif}
  .nums{position:absolute;right:70px;top:34px;font:150px/.9 Anton,Impact,sans-serif;color:rgba(16,17,20,.07);text-align:right}
  .lock{display:flex;align-items:center;gap:22px}
  .lock img{width:104px;height:104px}
  .lock span{font:82px/1 Anton,Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em}
  .q{font:160px/.88 Anton,Impact,sans-serif;text-transform:uppercase}
  .bar{position:relative;display:inline-block;padding:0 .12em;z-index:0}
  .bar::before{content:"";position:absolute;inset:.1em -.04em .02em;background:#B8F500;transform:skewX(-10deg);z-index:-1}
  .tag{font-weight:700;font-size:34px}
</style></head><body><div class="og">
  <div class="nums">20<br>19<br>18</div>
  <div class="lock"><img src="${dataUri(icon)}" alt=""><span>Gridspin</span></div>
  <div class="q">Can you go<br><span class="bar">20–0?</span></div>
  <div class="tag">Spin an era. Draft the greats. Go 20–0.</div>
</div></body></html>`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const anton = await page.evaluate(async () => (await document.fonts.load("80px Anton")).length > 0);
  if (!anton) throw new Error("Anton didn't load - og.png needs Google Fonts; check the network and rerun");
  writeFileSync(out("og.png"), await page.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } }));
  console.log("wrote static/og.png");
} finally {
  await browser.close();
}
