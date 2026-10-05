// The brand kit document, generated rather than written - for the reason at the top of kit.mjs: a brand
// page with hand-typed hex values drifts from the app the moment a token moves, and nothing tells you.
// Every swatch is read out of theme.mjs at render time, the attribution out of site-pages.mjs, and the
// gallery is built from the files kit.mjs actually wrote in that run.
import { PALETTE, THEME } from "../../theme.mjs";
import { DATA_CREDIT } from "../../site-pages.mjs";

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Relative luminance and contrast, so the page can STATE a ratio rather than assert a vibe - and so the
// one rule that matters most here, "lime is a fill, never text on cream", carries its own evidence.
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (hex) => {
  const n = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const r2 = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
};

const swatch = (name, hex) =>
  `<div class="sw"><div class="chip" style="background:${hex}"></div><b>${esc(name)}</b><code>${esc(hex)}</code></div>`;

const scopeRow = (label, t) => `<section class="scope">
    <h3>${esc(label)} <span class="muted">&mdash; ${Object.keys(t).length} tokens</span></h3>
    <div class="sws">${["bg", "surface", "surface2", "line", "line2", "ink", "muted", "accent", "accentInk", "win", "loss"]
      .map((k) => swatch(k, t[k])).join("")}</div>
    <div class="sws">${["qb", "rb", "wr", "te", "flex"].map((k) => swatch(k.toUpperCase(), t[k])).join("")}</div>
    <p class="note">Ink on background <b>${r2(t.ink, t.bg)}:1</b> &middot; muted on background
      <b>${r2(t.muted, t.bg)}:1</b> &middot; accent ink on background <b>${r2(t.accentInk, t.bg)}:1</b>.
      WCAG AA for body text is 4.5:1.</p>
  </section>`;

// Every line is something the game actually says - the page title, an og:description, two stored outcome
// strings from game-logic.mjs, and the button labels. None of it is copy invented for a deck.
const QUOTES = [
  ["The tagline", "Spin an era. Draft the greats. Go 20–0.", "og:description, page.html"],
  ["The search title", "Gridspin – Football Draft Game: Can You Go 20–0?", "<title>, page.html"],
  ["The best thing it can tell you", "Perfect season. 20–0.", "a stored outcome, game-logic.mjs"],
  ["The worst", "Missed the playoffs", "a stored outcome, game-logic.mjs"],
  ["Big moments get playful wording", "Start my season 🏈 · 🔒 Lock in · Run it back 🔁", "the design system"],
  ["Everyday controls stay plain", "Refresh · Log in · Cancel · Reset", "the design system"],
];

export function kitPage(assets) {
  const gallery = assets.filter((a) => !a.lockup).map((a) => `<figure>
      <img src="${a.file}" alt="" loading="lazy">
      <figcaption><b>${esc(a.size.name)}</b>
        <span class="muted">${a.size.w}&times;${a.size.h} &middot; ${esc(a.way.label)}</span>
        ${a.size.check ? `<span class="warn">check the spec</span>` : ""}</figcaption>
    </figure>`).join("");

  const marks = assets.filter((a) => a.lockup).map((a) => `<figure class="markfig" style="background:${a.way.bg}">
      <img src="${a.file}" alt="" width="128" height="128">
      <figcaption style="color:${a.way.ink}">${esc(a.way.label)}</figcaption></figure>`).join("");

  const credit = DATA_CREDIT.before + DATA_CREDIT.source.text + DATA_CREDIT.middle
    + DATA_CREDIT.licence.text + DATA_CREDIT.after;

  const quotes = QUOTES.map(([k, v, src]) =>
    `<tr><td class="muted">${esc(k)}</td><td><b>${esc(v)}</b></td><td class="muted src">${esc(src)}</td></tr>`).join("");

  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gridspin Brand Kit</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&display=swap">
<style>
  :root { --bg:${THEME.light.bg}; --surface:${THEME.light.surface}; --line:${THEME.light.line};
    --line2:${THEME.light.line2}; --ink:${THEME.light.ink}; --muted:${THEME.light.muted};
    --accent:${PALETTE.lime}; --accent-ink:${THEME.light.accentInk}; --warn:${THEME.light.te}; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:${THEME.night.bg}; --surface:${THEME.night.surface}; --line:${THEME.night.line};
    --line2:${THEME.night.line2}; --ink:${THEME.night.ink}; --muted:${THEME.night.muted};
    --accent-ink:${THEME.night.accentInk}; --warn:${THEME.night.te}; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter,system-ui,sans-serif;
    font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:1060px; margin:0 auto; padding:30px 16px 72px; }
  h1 { font-family:Anton,Impact,sans-serif; font-weight:400; text-transform:uppercase;
    font-size:clamp(34px,7vw,54px); line-height:.98; margin:0 0 8px; }
  h2 { font-family:Anton,Impact,sans-serif; font-weight:400; text-transform:uppercase; font-size:26px;
    margin:44px 0 6px; padding-top:18px; border-top:2px solid var(--ink); }
  h3 { font-size:13px; letter-spacing:.1em; text-transform:uppercase; margin:18px 0 10px; }
  p { max-width:72ch; } .muted { color:var(--muted); } .lede { color:var(--muted); max-width:72ch; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
  .warn { display:inline-block; background:var(--warn); color:#fff; border-radius:4px;
    padding:1px 6px; font-size:11px; font-weight:700; letter-spacing:.03em; }
  .sws { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:10px; }
  .sw { width:106px; } .sw .chip { height:48px; border:1px solid var(--line2); border-radius:8px; }
  .sw b { display:block; font-size:12.5px; margin-top:5px; } .sw code { color:var(--muted); }
  .scope { background:var(--surface); border:1px solid var(--line); border-radius:12px;
    padding:14px 16px; margin-bottom:14px; }
  .note { font-size:13px; color:var(--muted); margin:6px 0 0; max-width:72ch; }
  table { border-collapse:collapse; width:100%; font-size:14px; }
  td { border-top:1px solid var(--line); padding:9px 10px 9px 0; vertical-align:top; }
  td.src { font-size:12px; }
  .gal { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:16px; }
  .gal img { width:100%; display:block; border:1px solid var(--line2); border-radius:8px; background:var(--surface); }
  figure { margin:0; }
  figcaption { font-size:12.5px; margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .marks { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
  .markfig { border:1px solid var(--line2); border-radius:10px; padding:14px; text-align:center; }
  .markfig img { display:block; border-radius:10px; } .markfig figcaption { justify-content:center; }
  .rules li { margin-bottom:7px; max-width:72ch; }
  .typerow { display:flex; align-items:baseline; gap:16px; border-top:1px solid var(--line);
    padding:12px 0; flex-wrap:wrap; }
  .typerow .spec { font-size:12.5px; color:var(--muted); max-width:62ch; }
  .big { font-family:Anton,Impact,sans-serif; font-weight:400; text-transform:uppercase; }
</style>
<div class="wrap">
<h1>Gridspin brand kit</h1>
<p class="lede">Generated by <code>node tools/brand/kit.mjs</code> from <code>static/icon.svg</code>,
  <code>theme.mjs</code> and <code>site-pages.mjs</code>. Nothing on this page is typed out by hand, so it
  cannot quietly disagree with the game. Re-run it after any change to the palette or the mark.</p>

<h2>The mark</h2>
<p class="lede">A re-spin arrow wrapped around a football. It is <code>static/icon.svg</code> and nothing
  else &mdash; every raster in this kit is rendered from that one file.</p>
<div class="marks">${marks}</div>
<ul class="rules">
  <li><b>Clear space</b> is a quarter of the tile's width on every side. Nothing enters it.</li>
  <li><b>Smallest size is 24px.</b> Below that the lace inside the ball closes up and the mark reads as a blob.</li>
  <li><b>Two colourings only</b>: ink on lime, or lime on ink. Never recolour the glyph, stretch it, rotate
    it, add a shadow, or set it over a photograph.</li>
  <li><b>No club imagery, anywhere.</b> No team logos, helmets or wordmarks in any asset. The data builders
    drop nflverse's NFL-CDN headshot URLs on purpose and a test asserts none ship.</li>
</ul>

<h2>Colour</h2>
<p class="lede">Three scopes carrying the same token names: <b>light</b> (cream, the default),
  <b>dark</b> (the navy play screen) and <b>night</b> (the true-black leaderboard). An asset lives in one
  scope; it does not borrow a colour from another.</p>
<h3>Core palette</h3>
<div class="sws">${Object.entries(PALETTE).map(([k, v]) => swatch(k, v)).join("")}</div>
<p class="note"><b>Lime is a fill, never text on cream.</b> ${PALETTE.lime} on ${THEME.light.bg} measures
  <b>${r2(PALETTE.lime, THEME.light.bg)}:1</b>, far under the 4.5:1 AA floor. For accent-coloured words use
  <code>accentInk</code> &mdash; game blue on cream, lime only in the dark scopes.</p>
${scopeRow("Light (cream)", THEME.light)}
${scopeRow("Dark (navy)", THEME.dark)}
${scopeRow("Night (black)", THEME.night)}

<h2>Type</h2>
<div class="typerow"><span class="big" style="font-size:46px">Anton</span>
  <span class="spec">Display only: headlines, scores, the wordmark. Uppercase, tight leading (.9&ndash;.98).
    One weight, and it needs no other.</span></div>
<div class="typerow"><span style="font-size:30px;font-weight:700">Inter</span>
  <span class="spec">Everything else. 700 for labels and taglines, 400 for body. Never under 16px in an
    input &mdash; iOS zooms anything smaller.</span></div>
<p class="note">Both load from Google Fonts. Fallbacks are
  <code>Impact, "Arial Narrow Bold", sans-serif</code> for Anton and the system stack for Inter.</p>

<h2>Voice</h2>
<table>${quotes}</table>
<p class="note">Labels are authored in sentence case and uppercased in CSS, so screen readers and tests see
  ordinary text. Playful wording is for big moments only; everyday controls stay plain.</p>

<h2>Assets</h2>
<p class="lede">Every canvas in four colourways. <span class="warn">check the spec</span> marks a size this
  kit could not confirm against the platform's own current documentation &mdash; confirm it before
  uploading, because a wrong canvas is a cropped logo. Content sits inside each platform's safe box and the
  edges carry texture only, so a crop loses nothing that matters.</p>
<div class="gal">${gallery}</div>

<h2>Attribution</h2>
<p>${esc(credit)}</p>
<p class="note">That sentence is a licence term rather than a preference: ${esc(DATA_CREDIT.source.text)}
  ships under ${esc(DATA_CREDIT.licence.text)}, which wants the creator named, the material and the licence
  linked, and changes indicated. It belongs on anything that publishes the game's numbers.</p>
</div>`;
}
