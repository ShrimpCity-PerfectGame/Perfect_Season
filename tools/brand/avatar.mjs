// The profile picture, for the places that crop to a circle - TikTok, Instagram, X, YouTube.
//
// static/icon.svg cannot be used as-is for these. It is a rounded square with a 3px ink border, and a
// circular crop cuts the corners off and slices that border into four disconnected arcs. The repo
// already meets the same problem on phones, where iOS and Android crop to their own shapes, and solves
// it the same way: icon-maskable-512.png is full-bleed lime with no border and the mark held well
// inside. This is that idea for a circle.
//
// Nothing here REDRAWS the mark - the arrow, the arrowhead, the football and its lace are the paths
// from static/icon.svg and only the frame around them changes. But read that as a promise about care,
// not about mechanism: they are pasted in below as literal strings, so nothing stops this file and the
// icon from disagreeing. tools/brand/render.mjs and tools/app/icons.mjs read static/icon.svg off disk
// and so genuinely cannot drift; this one can, because a `<g>` is scaled around the mark and the navy
// variant inverts its colours, and neither is expressible by re-serving the icon file whole.
//
// The mark is hand-copied in SIX places across five tracked files, which is worth knowing before
// nudging a single coordinate:
//
//   static/icon.svg                 the source of truth, and the only one the two renderers above read
//   perfect-season.jsx              GridspinMark, the header logo
//   tools/brand/avatar.mjs          MARK, and again inside avatarDark with the colours inverted
//   tools/film/spin-an-era.html     inside <g id="mark">, so the film can spin the arrow
//   tools/film/tiktok-ad.html       the same
//
// All six agree character for character as this is written. To find them all again, look for the arrow
// - it is the longest path and the one any edit to the ring would touch:
//
//   git ls-files -z | xargs -0 grep -l "M43.57 18.21"
//
// That lists FILES rather than counting hits, which matters: the line above quotes the path it is
// searching for, so a count would find itself and report seven. The file list is unaffected, because
// the self-match lands in this file, which belongs in the list anyway. A sixth file appearing means a
// seventh copy of the mark exists and this comment is out of date.
//
// The colours are copied too, and they are theme.mjs's: #101114 is PALETTE.ink, #B8F500 PALETTE.lime,
// and the navy #0B1020 is the dark scope's background. theme.mjs is not imported here on purpose -
// this script renders an SVG string for a headless browser rather than running inside the app.
//
//   node tools/brand/avatar.mjs [--size 1024] [--out build/brand]

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SIZE = Number(arg("size", 1024));
const OUT = resolve(arg("out", "build/brand"));

function findChrome() {
  const found = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => p && existsSync(p));
  if (!found) throw new Error("No Chrome found - set CHROME_PATH");
  return found;
}

// The mark's own paths, on a 64 grid, with no rect around them. A hand copy - see the header.
const MARK = `
  <path d="M43.57 18.21A18 18 0 1 1 20.43 18.21" fill="none" stroke="#101114" stroke-width="6" stroke-linecap="round"/>
  <path d="M25.9 12.6 16.2 13.9 22.4 22.2Z" fill="#101114"/>
  <ellipse cx="32" cy="33.5" rx="9.5" ry="6.2" transform="rotate(-35 32 33.5)" fill="#101114"/>
  <path d="M29 35.8 35 31.2" stroke="#B8F500" stroke-width="1.8" stroke-linecap="round"/>`;

// The mark reaches about 24 units from centre on a 64 grid - the arrowhead is its furthest point. A
// circular crop keeps everything inside radius 32, so it already fits; scaling to 0.84 turns "it fits"
// into a ring of lime that reads as deliberate at 40px in a comments list, which is the size that
// actually matters. Anything larger and the arrowhead sits on the crop line.
const SCALE = 0.84;

const avatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#B8F500"/>
  <g transform="translate(32 32) scale(${SCALE}) translate(-32 -32)">${MARK}
  </g>
</svg>`;

// The same mark on navy, for anywhere a lime circle would sit on a light page and shout. The paths are
// spelled out again rather than reusing MARK because every colour in them is inverted, and a MARK with
// its two inks parameterised would be a small template language for the sake of one more variant.
// The cost is the second of this file's two copies: an edit to MARK must be made here as well.
const avatarDark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#0B1020"/>
  <g transform="translate(32 32) scale(${SCALE}) translate(-32 -32)">
    <path d="M43.57 18.21A18 18 0 1 1 20.43 18.21" fill="none" stroke="#B8F500" stroke-width="6" stroke-linecap="round"/>
    <path d="M25.9 12.6 16.2 13.9 22.4 22.2Z" fill="#B8F500"/>
    <ellipse cx="32" cy="33.5" rx="9.5" ry="6.2" transform="rotate(-35 32 33.5)" fill="#B8F500"/>
    <path d="M29 35.8 35 31.2" stroke="#0B1020" stroke-width="1.8" stroke-linecap="round"/>
  </g>
</svg>`;

const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: "shell",
    args: ["--force-device-scale-factor=1", "--disable-lcd-text", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    for (const [svg, name] of [[avatar, "avatar-lime"], [avatarDark, "avatar-navy"]]) {
      for (const size of [SIZE, 200]) {
        await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
        await page.setContent(
          `<html><body style="margin:0"><img src="${uri(svg)}" width="${size}" height="${size}" style="display:block"></body></html>`,
          { waitUntil: "load" },
        );
        const file = `${OUT}/${name}-${size}.png`;
        await page.screenshot({ path: file, type: "png" });
        console.log(`${size}x${size}  ${file}`);
      }
    }
    // A preview of what the circle crop actually keeps, so the framing is checked rather than assumed.
    await page.setViewport({ width: 1040, height: 560, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:#F7F4EA;display:flex;align-items:center;justify-content:center;gap:48px;font:600 15px system-ui;color:#5E5B52">
      ${[[avatar, "lime"], [avatarDark, "navy"]].map(([svg, n]) => `
        <div style="text-align:center">
          <img src="${uri(svg)}" width="360" height="360" style="border-radius:50%;display:block;margin-bottom:14px">
          <div>${n} &middot; as TikTok crops it</div>
          <div style="margin-top:22px;display:flex;gap:14px;align-items:center;justify-content:center">
            ${[96, 56, 40].map((s) => `<img src="${uri(svg)}" width="${s}" height="${s}" style="border-radius:50%">`).join("")}
          </div>
        </div>`).join("")}
    </body></html>`, { waitUntil: "load" });
    await page.screenshot({ path: `${OUT}/avatar-preview.png`, type: "png" });
    console.log(`preview   ${OUT}/avatar-preview.png`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
