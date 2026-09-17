// Draws the Android app's launcher icons and splash screens from static/icon.svg, the same mark the site uses,
// so the app can never ship Capacitor's default logo or drift from the brand:
//
//   node tools/app/icons.mjs
//
// It replaces every PNG the Capacitor template put in android/app/src/main/res, at exactly the size that file
// already is, and sets the adaptive icon's background to lime. Re-runnable, and safe after `npx cap sync`.
// Uses the installed Chrome, like tools/brand/render.mjs (which renders the site's own icons the same way).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../ui-harness/audit.mjs";
import { PALETTE } from "../../theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const res = path.join(root, "android/app/src/main/res");
if (!existsSync(res)) {
  console.error("No android/app/src/main/res - run `npx cap add android` first.");
  process.exit(1);
}

const icon = readFileSync(path.join(root, "static/icon.svg"), "utf8");
// Everything the mark draws on top of its tile: the arrow, its head, the ball and the lace.
const glyph = icon.replace(/^[\s\S]*?<rect[^>]*\/>/, "").replace(/<\/svg>\s*$/, "");
const svg = (inner, bg) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
  + (bg ? `<rect width="64" height="64" fill="${bg}"/>` : "") + inner + `</svg>`;
const scaled = (s) => `<g transform="translate(32 32) scale(${s}) translate(-32 -32)">${glyph}</g>`;
// The launcher icon: the mark's own lime tile, full bleed, because Android crops it to its own shape.
const launcher = svg(scaled(1), PALETTE.lime);
// An adaptive icon's outer sixth is cropped on every side and the shape can be a circle, so the glyph sits in
// the middle two thirds - the safe zone - and the lime comes from the background layer instead.
const foreground = svg(scaled(0.62), null);
const dataUri = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
// A PNG's width and height, straight out of its header, so each file is redrawn at the size it already is.
const dimensions = (file) => {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const browser = await launch();
let written = 0;
try {
  const page = await browser.newPage();
  // `art` is drawn to fill a square of `size`; a splash is that square centred on the page's cream.
  async function png(file, { w, h }, art, { transparent = false, square = Math.min(w, h), background = "transparent" } = {}) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:${background};display:grid;place-items:center;width:${w}px;height:${h}px">`
      + `<img src="${dataUri(art)}" width="${square}" height="${square}" style="display:block"></body></html>`);
    await page.evaluate(() => document.querySelector("img").decode());
    writeFileSync(file, await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } }));
    written++;
  }

  for (const dir of readdirSync(res).filter((d) => d.startsWith("mipmap") || d.startsWith("drawable"))) {
    for (const name of readdirSync(path.join(res, dir)).filter((f) => f.endsWith(".png"))) {
      const file = path.join(res, dir, name);
      const size = dimensions(file);
      if (name.startsWith("ic_launcher_foreground")) await png(file, size, foreground, { transparent: true });
      else if (name.startsWith("ic_launcher")) await png(file, size, launcher);
      // The splash screen: the mark on the site's cream, a third of the short side, so it reads on any shape.
      else if (name.startsWith("splash")) await png(file, size, launcher, { background: PALETTE.cream, square: Math.round(Math.min(size.w, size.h) / 3) });
    }
  }
} finally {
  await browser.close();
}

// The adaptive icon's background layer, behind the foreground above.
writeFileSync(path.join(res, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PALETTE.lime}</color>\n</resources>\n`);
console.log(`Drew ${written} icons and splash screens from static/icon.svg, and set the icon background to ${PALETTE.lime}.`);
