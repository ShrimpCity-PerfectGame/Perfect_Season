// Walks a film's whole timeline and reports elements that share space when they should not.
//
// Every composition defect found in this ad by eye - the ceiling line printed through a bar's value, the
// ceiling tag printed over it, a wrapped name printed inside its own bar - is a rectangle intersection
// that a machine can find in a second and a person finds one at a time, after rendering, by luck. The
// bars GROW, so a frame that is clean at 6s is not the frame that is wrong: this samples the whole clip.
//
//   node tools/film/overlap.mjs [--film FILE] [--seconds 15] [--step 0.1]
//
// The defaults are the TikTok ad's: 15 seconds, and a 1080x1920 stage. The title sequence is the other
// way up and twice as long, so it wants `--film tools/film/spin-an-era.html --seconds 30`. Read the
// answer on that one as weaker, though, and not because of the viewport: FILLED below is the ad's own
// vocabulary of painted blocks, and of it only `.g` exists in the title sequence, whose roster and reel
// are `.slot` and `.reel-item`. "Text over text" and the scene walk still apply and are worth having;
// "text over block" has almost nothing to measure there. Add the names before trusting a clean run.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FILM = resolve(arg("film", "tools/film/tiktok-ad.html"));
// Given, or asked of the film. The default used to be a flat 15, which is the TikTok cuts' length and
// half the title sequence's - so `overlap.mjs --film spin-an-era.html` silently walked the first half
// of that film and reported clean on the whole of it. Every film publishes window.__duration; nothing
// read it here until v2.21.2, the same gap render.mjs had.
const SECONDS_GIVEN = process.argv.includes("--seconds");
let SECONDS = Number(arg("seconds", 15));
const STEP = Number(arg("step", 0.1));

const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .find((p) => p && existsSync(p));
if (!chrome) throw new Error("No Chrome found - set CHROME_PATH");

const browser = await puppeteer.launch({ executablePath: chrome, headless: "shell", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await page.goto(`${pathToFileURL(FILM).href}?render=1`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

const DUR = await page.evaluate(() => (typeof window.__duration === "number" ? window.__duration : null));
if (!SECONDS_GIVEN && DUR > 0 && DUR !== SECONDS) {
  SECONDS = DUR;
  console.log(`length  ${SECONDS}s from the film's own window.__duration`);
}

const seen = new Map();   // one entry per distinct defect, with the window of time it is on screen
for (let i = 0; i <= Math.round(SECONDS / STEP); i++) {
  const t = Number((i * STEP).toFixed(3));
  const hits = await page.evaluate((time) => {
    window.__seek(time);
    // Blocks that are painted, so text over one is text on top of something.
    // .ceil is deliberately absent: it is a 3px rule the stylesheet paints UNDER every number (z-index),
    // so a value passing over it while a bar grows is a line behind a digit, not a digit with a line
    // through it. That guarantee lives in the CSS and is commented there.
    // `.cell` is tiktok-guess.html's painted block, and it was missing here until v2.21.2. The cost was not
    // theoretical: this tool matched ZERO elements inside that film and still printed "clean", on a frame
    // whose grid had names overflowing into the Team column and a heading drawn in the wrong face. The film
    // with the most text-over-block in the repo was the one least checked. Keep adding the names - the header
    // above already says a clean run means nothing until the film's own vocabulary is in this list.
    const FILLED = ".bar, .card, .stamp, .sl, .g, .cell";
    const vis = (el) => {
      let o = 1, n = el;
      while (n && n !== document.body) { o *= parseFloat(getComputedStyle(n).opacity || "1"); n = n.parentElement; }
      const r = box(el);
      return o > 0.15 && r.width > 1 && r.height > 1;
    };
    // What is actually PAINTED, which is the rectangle a reader sees. The reveal animation slides a line
    // of type inside a clipping box, so its own rect reports it far outside the words on screen - measure
    // that and every reveal in the film reads as a collision it never has.
    const box = (el) => {
      let r = el.getBoundingClientRect();
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (st.overflow === "visible" && st.overflowX === "visible" && st.overflowY === "visible") continue;
        const c = n.getBoundingClientRect();
        r = { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right),
              top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) };
        r.width = r.right - r.left; r.height = r.bottom - r.top;
      }
      return r;
    };
    // Still on its way in or out: anything carrying a transform of its own, or inheriting one.
    const moving = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const tr = getComputedStyle(n).transform;
        if (tr && tr !== "none" && tr !== "matrix(1, 0, 0, 1, 0, 0)") return true;
      }
      return false;
    };
    const hit = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") +
      (el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "") +
      (el.textContent.trim() ? ` "${el.textContent.trim().slice(0, 22)}"` : "");

    const out = [];
    for (const scene of document.querySelectorAll(".scene")) {
      if (parseFloat(getComputedStyle(scene).opacity || "1") < 0.5) continue;   // not the frame on screen
      // The title sequence has no .safe: it is a 16:9 film for a player that covers none of it, so the
      // readable box the ad is built around does not exist there. Absent means "no such rule to check",
      // not zero-sized - measuring a null crashed the whole run on that film, which is how a tool whose
      // usage says [--film FILE] came to work on exactly one of the two.
      const safe = scene.querySelector(".safe");
      const filled = [...scene.querySelectorAll(FILLED)].filter(vis);
      // Text = an element carrying its own words, not a wrapper around more elements.
      const texts = [...scene.querySelectorAll("*")].filter((el) =>
        vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));

      for (const tx of texts) {
        const tb = box(tx);
        // Sitting outside the readable box is a defect - that box is what TikTok's own UI does not cover -
        // but only once the element has ARRIVED. The cards fly apart into place from 26% away and their
        // outer edges are flush with the box, so any entrance at all crosses it: measuring that reports
        // the motion as if it were the composition, and there is no offset that would satisfy it. A
        // non-identity transform is the signal that an element is still moving.
        if (!moving(tx) && safe) {
          const sb = box(safe);
          if (tb.left < sb.left - 0.5 || tb.right > sb.right + 0.5 || tb.top < sb.top - 0.5 || tb.bottom > sb.bottom + 0.5)
            out.push({ kind: "settles outside .safe", a: name(tx), b: scene.id });
        }

        for (const f of filled) {
          if (f === tx || f.contains(tx) && !f.matches(".bar")) continue;  // text inside its own card is fine
          if (f.matches(".bar") && !f.contains(tx) && !tx.closest(".bars")) continue;
          if (tx.contains(f)) continue;
          if (hit(tb, box(f))) out.push({ kind: "text over block", a: name(tx), b: name(f) });
        }
        for (const other of texts) {
          if (other === tx || other.contains(tx) || tx.contains(other)) continue;
          if (hit(tb, box(other))) out.push({ kind: "text over text", a: name(tx), b: name(other) });
        }
      }
    }
    return out;
  }, t);

  for (const h of hits) {
    // "text over text" is symmetric - keep one copy.
    const key = `${h.kind}|${[h.a, h.b].sort().join(" <-> ")}`;
    const e = seen.get(key);
    if (e) e.last = t; else seen.set(key, { ...h, first: t, last: t });
  }
}
// The nflverse attribution has to be ON THE LAST FRAME, not merely in the file. tests/test-film.mjs holds
// the STRING to DATA_CREDIT and checks nothing blanks its element in render mode, but it reads text and so
// cannot see runtime wiring: a mutation that left the string in place and broke the assignment passed it
// clean. This tool already has the film open in a browser at render size, which is the only place that
// question can actually be answered, so it is answered here.
// Seek to the FILM's own duration, not --seconds: the two differ whenever the caller passes a window
// shorter or longer than the clip, and seeking to the wrong one checks a frame the close card is not on.
await page.evaluate((d) => window.__seek(d - 0.05), DUR || SECONDS);
const credit = await page.evaluate(() => {
  const stage = document.querySelector(".stage");
  // Effective opacity up the tree. display:none alone is NOT the test - a scene that is off screen has
  // opacity 0 and display:block, so checking display found the credit at EVERY timestamp and reported
  // "on the last frame" without ever looking at one. That is the same vacuous pass this tool shipped
  // for tiktok-guess.html, now in the check written to stop it.
  const shown = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === "none" || st.visibility === "hidden") return 0;
      o *= parseFloat(st.opacity || "1");
    }
    return o;
  };
  const carriers = [...stage.querySelectorAll("*")]
    .filter((e) => !e.children.length && /nflverse/i.test(e.textContent));
  if (!carriers.length) return { ok: false, why: "no element inside .stage carries the nflverse credit at all" };
  const lit = carriers.filter((e) => shown(e) > 0.5);
  if (!lit.length) return { ok: false, why: "the credit exists but is not VISIBLE on the final frame (opacity 0)" };
  const r = lit[0].getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return { ok: false, why: "the credit element has no size on the final frame" };
  return { ok: true };
});
if (!credit.ok) {
  console.log(`ATTRIBUTION: ${credit.why}`);
  console.log("  CC BY 4.0 asks for it wherever the material is used, and a published video is a use (DATA.md).");
  process.exit(1);
}

await browser.close();

const found = [...seen.values()];
if (!found.length) { console.log(`clean: no overlaps and the credit is on the last frame, across ${SECONDS}s sampled every ${STEP}s`); process.exit(0); }
console.log(`${found.length} defect(s) across ${SECONDS}s sampled every ${STEP}s:\n`);
for (const f of found) console.log(`  [${f.first.toFixed(1)}s-${f.last.toFixed(1)}s] ${f.kind}\n     ${f.a}\n     ${f.b}\n`);
process.exit(1);
