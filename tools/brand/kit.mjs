// The brand kit: every banner, lockup and social asset, rendered from static/icon.svg and theme.mjs.
//
//   node tools/brand/kit.mjs            # everything
//   node tools/brand/kit.mjs reddit     # only sizes whose name contains "reddit"
//
// Writes into build/brand/ (gitignored, like build/film/), plus build/brand/index.html - the kit page
// itself, whose palette table is GENERATED from theme.mjs rather than typed out. That is the whole point
// of generating this instead of drawing it: tools/brand/render.mjs exists because six hand copies of the
// mark drifted, and a brand document with hand-typed hex values is the same bug one step further out.
//
// Everything here is Chrome + Google Fonts, exactly as tools/brand/render.mjs renders og.png. It needs a
// network connection for Anton and Inter.
//
// **Sizes are the one thing this file cannot verify.** Each platform's spec is what the platform says it
// is on the day you upload, and several are unreachable from here (Reddit blocks this crawler entirely).
// Every entry carries its source as a comment and `check: true` where it has NOT been confirmed against
// the platform's own current documentation. Check before uploading; a wrong canvas is a cropped logo.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../ui-harness/audit.mjs";
import { PALETTE, THEME } from "../../theme.mjs";
import { kitPage } from "./kit-page.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "build", "brand");
const icon = readFileSync(path.join(root, "static", "icon.svg"), "utf8");
const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
// The mark's own tile is lime. On a lime colourway that disappears, so the glyph is lifted out and
// redrawn on ink - the same trick render.mjs uses for the maskable icon, and the reason it reads the SVG
// rather than keeping a copy.
const glyph = icon.replace(/^[\s\S]*?<rect[^>]*\/>/, "").replace(/<\/svg>\s*$/, "");
const markOn = (tile, stroke) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${tile}"/>`
  + `<g stroke="${stroke}" fill="${stroke}">${glyph.replace(/#101114/gi, stroke)}</g></svg>`;

// ---- the four colourways ---------------------------------------------------------------------------
// Three are the app's own scopes, so an asset always matches a screen somebody can be looking at. The
// fourth is the accent used as a FILL, which is the only way lime is ever allowed to carry a surface -
// never as text on cream, where it measures about 1.2:1 (see "Lime is a fill" in CLAUDE.md).
export const WAYS = {
  cream: { label: "Cream", scope: "light", bg: THEME.light.bg, ink: THEME.light.ink, muted: THEME.light.muted,
    rule: THEME.light.line2, tile: PALETTE.lime, markInk: PALETTE.ink, bar: PALETTE.lime, barInk: PALETTE.ink,
    ghost: "rgba(16,17,20,.055)" },
  navy: { label: "Navy", scope: "dark", bg: THEME.dark.bg, ink: THEME.dark.ink, muted: THEME.dark.muted,
    rule: THEME.dark.line2, tile: PALETTE.lime, markInk: PALETTE.ink, bar: PALETTE.lime, barInk: PALETTE.ink,
    ghost: "rgba(247,244,234,.05)" },
  night: { label: "Night", scope: "night", bg: THEME.night.bg, ink: THEME.night.ink, muted: THEME.night.muted,
    rule: THEME.night.line2, tile: PALETTE.lime, markInk: PALETTE.ink, bar: PALETTE.lime, barInk: PALETTE.ink,
    ghost: "rgba(247,244,234,.045)" },
  lime: { label: "Lime", scope: "light", bg: PALETTE.lime, ink: PALETTE.ink, muted: "#3F4A12",
    rule: "rgba(16,17,20,.22)", tile: PALETTE.ink, markInk: PALETTE.lime, bar: PALETTE.ink, barInk: PALETTE.lime,
    ghost: "rgba(16,17,20,.07)" },
};

// ---- the canvases ----------------------------------------------------------------------------------
// `safe` is the centred box a platform promises to show on every device; content goes inside it and the
// rest is texture. Where a platform publishes no safe area, the layout keeps its own margin.
export const SIZES = [
  // Reddit is unreachable from this environment, so both of these are the widely-cited figures and
  // neither has been confirmed against Reddit's own current help pages.
  { name: "reddit-profile-banner", w: 1920, h: 384, safe: [1180, 384], check: "Reddit profile banner" },
  { name: "reddit-subreddit-banner", w: 1920, h: 384, safe: [1024, 384], check: "Reddit subreddit banner (Reddit crops this one hardest)" },
  { name: "x-header", w: 1500, h: 500, safe: [1200, 380], check: "X/Twitter profile header" },
  // YouTube renders the same image from a TV down to a phone; only the centre box survives all of them.
  { name: "youtube-channel-art", w: 2560, h: 1440, safe: [1546, 423], check: "YouTube channel art + its TV-safe box" },
  { name: "github-social-preview", w: 1280, h: 640, safe: [1120, 540], check: "GitHub repository social preview" },
  { name: "discord-banner", w: 960, h: 540, safe: [860, 460], check: "Discord profile banner" },
  { name: "linkedin-page-cover", w: 1128, h: 191, safe: [1000, 191], check: "LinkedIn page cover" },
  // 1200x630 is the one size here that is NOT guesswork: static/og.png already ships at it and
  // tests/test-build-seo.mjs holds the tags that point at it. This renders the kit's colourway variants;
  // the production link preview stays render.mjs's.
  { name: "open-graph", w: 1200, h: 630, safe: [1040, 540] },
  { name: "square", w: 1080, h: 1080, safe: [920, 920] },
  { name: "story", w: 1080, h: 1920, safe: [920, 1500] },
];

// ---- one layout per shape --------------------------------------------------------------------------
// A 5:1 strip and a 9:16 card cannot share a layout, so the aspect picks one of three. Each is the same
// three elements - lockup, headline, tagline - arranged for the room available.
// Decided by the SAFE box rather than the canvas, because the safe box is the only part guaranteed to be
// on screen. YouTube is the case that proves it: a 2560x1440 canvas is 16:9 and would take the card
// layout, but the box every device actually shows is 1546x423 - a strip - and a card laid out for the
// canvas spills straight out of it. The overflow guard caught exactly that.
const shapeOf = (w, h) => (w / h >= 2.4 ? "strip" : w / h <= 0.9 ? "tall" : "block");

const HEADLINE = "Can you go <span class='bar'>20&ndash;0?</span>";
const TAGLINE = "Spin an era. Draft the greats.";
const URL = "gridspin.app";

function markup(size, way) {
  const [sw, sh] = size.safe;
  const shape = shapeOf(sw, sh);
  // The display face scales off the safe box rather than the canvas: YouTube's 2560x1440 has a 1546x423
  // window, and type sized to the canvas would be unreadable inside it.
  // A strip is limited by its HEIGHT and a card by its WIDTH, so they cannot share a unit: sizing the
  // square's headline off min(w,h) asked for 156px Anton on a nowrap line in a 920px box, which the
  // overflow guard below caught rather than quietly cropping.
  // A strip is normally limited by its height, but a short WIDE safe box runs out of width first: the
  // lockup, rule, gaps and text come to about 3.1 units across, so a 1024px box cannot carry a 384px
  // unit however much vertical room it has. Taking the smaller of the two is what lets one layout serve
  // a 1546x423 YouTube window and a 1024x384 Reddit one without either being hand-tuned.
  const unit = shape === "strip" ? Math.min(sh, sw / 3.1) : Math.min(sw, sh);
  const px = (n) => `${Math.round(n)}px`;
  const m = markOn(way.tile, way.markInk);

  const lockup = `<div class="lock"><img src="${dataUri(m)}" alt=""><span class="word">Gridspin</span></div>`;
  const words = `<div class="right"><p class="q">${HEADLINE}</p><p class="tag">${TAGLINE} &nbsp;&nbsp;<b>${URL}</b></p></div>`;

  const body = shape === "strip"
    ? `${lockup}<div class="rule"></div>${words}`
    : `<div class="stack">${lockup}${words}</div>`;

  return `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@600;700&display=block">
<style>
  body { margin:0; }
  .c { width:${size.w}px; height:${size.h}px; box-sizing:border-box; background:${way.bg}; color:${way.ink};
    position:relative; overflow:hidden; font-family:Inter,sans-serif; }
  .nums { position:absolute; inset:0; font:${px(unit * (shape === "strip" ? 0.68 : 0.42))}/.86 Anton,Impact,sans-serif; color:${way.ghost};
    letter-spacing:.02em; white-space:nowrap; display:flex; align-items:center; justify-content:center; }
  .nums span { padding:0 ${px(unit * 0.07)}; }
  .safe { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:${sw}px; height:${sh}px;
    display:flex; align-items:center; gap:${px(unit * 0.12)};
    ${shape === "strip" ? "" : "flex-direction:column; justify-content:center; text-align:center;"} }
  .stack { display:flex; flex-direction:column; align-items:center; gap:${px(unit * 0.09)}; width:100%; }
  .lock { display:flex; align-items:center; gap:${px(unit * 0.05)}; flex:0 0 auto; }
  .lock img { width:${px(unit * (shape === "strip" ? 0.25 : 0.14))}; height:${px(unit * (shape === "strip" ? 0.25 : 0.14))}; display:block; }
  .word { font:${px(unit * (shape === "strip" ? 0.2 : 0.115))}/1 Anton,Impact,sans-serif; text-transform:uppercase; letter-spacing:.005em; }
  .rule { flex:0 0 auto; width:2px; height:${px(unit * 0.27)}; background:${way.rule}; }
  /* In the card layouts .right sits in a centred COLUMN flex, where flex:1 1 auto sizes it to its own
     content - so .q's max-width measured against 537px rather than the safe box and the headline broke
     early. Stretching it is what makes the max-width mean the safe width. */
  .right { flex:1 1 auto; min-width:0; ${shape === "strip" ? "" : "width:100%;"} }
  /* The strip holds its headline on one line because there is only one line's worth of room; a card lets
     it wrap, which is what keeps the display face big enough to read in a thumbnail. */
  /* .94 on a strip, where the headline is one line; cards need real leading because the bar is drawn
     .1em ABOVE its text box and a tight wrapped line puts the line above straight through it. */
  .q { font:${px(unit * (shape === "strip" ? 0.2 : 0.14))}/${shape === "strip" ? ".94" : "1.14"} Anton,Impact,sans-serif; text-transform:uppercase;
    margin:0 0 ${px(unit * (shape === "strip" ? 0.03 : 0.045))};
    ${shape === "strip" ? "white-space:nowrap;" : `max-width:${sw}px;`}
    /* The lime bar is drawn with inset -.04em so it overhangs the word it highlights, which is the look -
       but it also means the line measures a few px wider than its text. Room for the bleed, rather than a
       tolerance in the guard: a guard with slack in it stops catching the clip it exists for. */
    padding-inline:.06em; }
  .bar { position:relative; display:inline-block; padding:0 .12em; z-index:0; color:${way.barInk}; }
  .bar::before { content:""; position:absolute; inset:.1em -.04em .04em; background:${way.bar};
    transform:skewX(-10deg); z-index:-1; }
  .tag { font-weight:700; font-size:${px(unit * (shape === "strip" ? 0.065 : 0.042))}; color:${way.muted}; margin:0; white-space:nowrap; }
  .tag b { color:${way.ink}; font-weight:700; }
</style></head><body><div class="c">
  <div class="nums"><span>20</span><span>19</span><span>18</span><span>17</span><span>20</span><span>19</span><span>18</span><span>17</span></div>
  <div class="safe">${body}</div>
</div></body></html>`;
}

const only = process.argv.slice(2);
const wanted = only.length ? SIZES.filter((s) => only.some((a) => s.name.includes(a))) : SIZES;
if (!wanted.length) throw new Error(`no size matches ${only.join(" ")} - have: ${SIZES.map((s) => s.name).join(", ")}`);

mkdirSync(outDir, { recursive: true });
const browser = await launch();
const made = [];
try {
  const page = await browser.newPage();
  // The kit page is a document people OPEN SOMEWHERE ELSE - sent to a phone, dropped into a chat - where a
  // relative <img> path to a sibling PNG resolves to nothing and every preview is a broken-image icon. That
  // happened on the first send. So each asset is also shot small and inlined as a JPEG, while the full PNG
  // on disk stays the thing you upload.
  //
  // The small shot is the SAME page at a fractional deviceScaleFactor, not the PNG pushed back through a
  // canvas: the CSS viewport is unchanged so the layout is identical, and nothing large crosses the
  // DevTools protocol. Round-tripping multi-megabyte base64 through page.evaluate wedged the connection
  // and the next screenshot died with 'Page.captureScreenshot timed out'.
  const preview = async (w, h, maxW) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: Math.min(1, maxW / w) });
    const b64 = await page.screenshot({ type: "jpeg", quality: 72, encoding: "base64", clip: { x: 0, y: 0, width: w, height: h } });
    return "data:image/jpeg;base64," + b64;
  };
  for (const size of wanted) {
    for (const [key, way] of Object.entries(WAYS)) {
      await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: size.w >= 2000 ? 1 : 2 });
      // "load", not networkidle0: Google Fonts with display=block leaves a connection open long enough to
      // blow the 30s navigation timeout on the second canvas. It cannot be "domcontentloaded" either -
      // the stylesheet has not been applied by then, so document.fonts has no Anton face to wait ON and
      // load() answers [] immediately. "load" waits for the stylesheet and nothing longer.
      await page.setContent(markup(size, way), { waitUntil: "load" });
      const anton = await page.evaluate(async () => {
        const [a] = await Promise.all([document.fonts.load("80px Anton"), document.fonts.load("700 20px Inter")]);
        await document.fonts.ready;
        return a.length > 0;
      });
      if (!anton) throw new Error("Anton didn't load - the brand kit needs Google Fonts; check the network and rerun");
      await page.evaluate(() => document.querySelector(".lock img").decode());
      // A banner that silently clipped its own URL would look right in this script's output and wrong on
      // the profile, so overflow is a failure rather than a crop.
      const over = await page.evaluate(() => {
        const bad = (el) => el && el.scrollWidth > el.clientWidth + 1;
        return bad(document.querySelector(".q")) || bad(document.querySelector(".tag")) || bad(document.querySelector(".safe"));
      });
      if (over) {
        // Name the element and the two numbers rather than just the canvas: "it overflows" sends you
        // hunting, and the first time this fired the culprit was .q measuring against 537px instead of
        // the safe box, which the bare message would not have shown.
        const why = await page.evaluate(() => {
          const one = (sel) => { const el = document.querySelector(sel); return el ? `${sel} ${el.scrollWidth}/${el.clientWidth}` : `${sel} -`; };
          return [one(".q"), one(".tag"), one(".safe"), one(".lock")].join("  ");
        });
        throw new Error(`${size.name} / ${key}: content overflows its safe box (${size.safe.join("x")}) - ${why}`);
      }
      const file = `${size.name}-${key}.png`;
      writeFileSync(path.join(outDir, file), await page.screenshot({ clip: { x: 0, y: 0, width: size.w, height: size.h } }));
      made.push({ size, key, way, file, preview: await preview(size.w, size.h, 460) });
    }
  }

  // ---- the lockups ---------------------------------------------------------------------------------
  // The mark on its own, on every colourway, at the size a profile picture is actually served.
  for (const [key, way] of Object.entries(WAYS)) {
    for (const px of [512, 192]) {
      await page.setViewport({ width: px, height: px, deviceScaleFactor: 1 });
      await page.setContent(`<html><body style="margin:0;background:${way.bg}">`
        + `<img src="${dataUri(markOn(way.tile, way.markInk))}" width="${px}" height="${px}" style="display:block">`
        + `</body></html>`);
      await page.evaluate(() => document.querySelector("img").decode());
      const file = `mark-${key}-${px}.png`;
      writeFileSync(path.join(outDir, file), await page.screenshot({ clip: { x: 0, y: 0, width: px, height: px } }));
      if (px === 512) made.push({ size: { name: "mark", w: px, h: px }, key, way, file, lockup: true, preview: await preview(px, px, 160) });
    }
  }
} finally {
  await browser.close();
}

writeFileSync(path.join(outDir, "assets.json"), JSON.stringify(
  made.map((m) => ({ file: m.file, size: m.size.name, w: m.size.w, h: m.size.h, way: m.key, check: m.size.check || null })), null, 2));
console.log(`wrote ${made.length} assets into build/brand/`);
writeFileSync(path.join(outDir, "index.html"), kitPage(made));
console.log("wrote build/brand/index.html");
for (const s of wanted) if (s.check) console.log(`  CHECK the spec before uploading: ${s.name} (${s.w}x${s.h}) - ${s.check}`);
