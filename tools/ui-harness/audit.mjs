// Real-Chrome helpers for auditing the UI harness at phone sizes. Import these from a script, or
// run this file directly for a quick check of one screen:
//
//   node tools/ui-harness/build.mjs
//   node tools/ui-harness/audit.mjs --as player --width 375 --tab Leaderboard --out <dir>
//
// Uses the Chrome already installed on the machine (puppeteer-core, no browser download). Set
// CHROME_PATH to point somewhere else.
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const HARNESS_URL = pathToFileURL(path.join(here, "harness.html")).href;

// Phones from small Android to large iPhone, plus a tablet. Height matters for sticky bars.
export const VIEWPORTS = {
  "320": { width: 320, height: 640 },
  "360": { width: 360, height: 780 },
  "375": { width: 375, height: 667 },
  "390": { width: 390, height: 844 },
  "430": { width: 430, height: 932 },
  "768": { width: 768, height: 1024 },
};

export async function launch() {
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  const executablePath = candidates.find((p) => p && existsSync(p));
  if (!executablePath) throw new Error("No Chrome found - set CHROME_PATH");
  return puppeteer.launch({ executablePath, headless: true });
}

// Opens the harness as a phone: touch, mobile user agent, 2x pixels. Each call gets a fresh
// incognito context, so storage and the seeded mock start clean.
export async function openApp(browser, { as = "player", width = 375, height = 780, howto = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: width < 768, hasTouch: width < 768 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${HARNESS_URL}?as=${as}${howto ? "&howto=1" : ""}`, { waitUntil: "load" });
  await page.waitForSelector(".ps", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(600);
  page.consoleErrors = errors;
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Clicks the first visible button or link whose text matches (exact, or a RegExp).
export async function clickText(page, match) {
  const ok = await page.evaluate((src, isRe) => {
    const re = isRe ? new RegExp(src) : null;
    const el = [...document.querySelectorAll("button, a, [role=button]")].find((b) => {
      const t = b.textContent.trim();
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (re ? re.test(t) : t === src);
    });
    if (el) { el.scrollIntoView({ block: "center" }); el.click(); }
    return !!el;
  }, match instanceof RegExp ? match.source : match, match instanceof RegExp);
  if (!ok) throw new Error(`Nothing clickable matching ${match}`);
  await sleep(500);
}

// Drafts one player: selects the first draftable card and locks him in.
export async function draftOne(page) {
  for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
      if (!card) return false;
      card.querySelector("button.hit").click();
      return true;
    });
    if (done) break;
    await sleep(250);
  }
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll(".drafts button.btn.solid")].find((b) => b.getBoundingClientRect().height > 0)?.click());
  await sleep(700);
}

// Measures common mobile layout problems on whatever is currently on screen. Returns a list of
// findings; a finding is a lead to look at in the screenshot, not automatically a bug.
export async function checkLayout(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
    };
    const label = (el) => {
      const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "";
      return `${el.tagName.toLowerCase()}${cls} "${(el.textContent || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
    };
    const insideScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };

    if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: "page-scrolls-sideways", detail: `document is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport` });

    const all = [...document.querySelectorAll(".ps *")].filter(visible);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !insideScroller(el) && !el.closest(".confetti")) {
        out.push({ kind: "off-screen", detail: `${label(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}` });
      }
      const s = getComputedStyle(el);
      // A visually-hidden element is a 1px box with overflow:hidden holding a whole sentence, which is
      // exactly the shape of a clipped one. Every heading and label the accessibility pass added reads as
      // a clip here, and forty of them drowned the check that is supposed to find a real one.
      const hiddenForScreenReaders = el.clientWidth <= 1 || el.clientHeight <= 1;
      if (!hiddenForScreenReaders && (s.overflow === "hidden" || s.overflowX === "hidden" || s.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 2 && el.childNodes.length && el.textContent.trim()) {
        out.push({ kind: "clipped-text", detail: `${label(el)} content ${el.scrollWidth}px in ${el.clientWidth}px` });
      }
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText && parseFloat(s.fontSize) < 12) out.push({ kind: "tiny-text", detail: `${label(el)} at ${s.fontSize}` });
    }

    const targets = [...document.querySelectorAll(".ps button, .ps a, .ps input, .ps select, .ps textarea, .ps [role=button]")].filter(visible);
    // What a finger can actually hit. Text links and pills keep their look and get an invisible ::after
    // reaching past their edges instead of a min-height (CLAUDE.md, the 1.8.0 phone audit), and
    // getBoundingClientRect cannot see a pseudo-element - so every name on the Leaderboard read as a 17px
    // target, 650 of them in one sweep, and the real ones were lost in the list. This reads the ::after's
    // own insets and grows the box by them, which is what the rule was written to do.
    const hitBox = (el) => {
      const r = el.getBoundingClientRect();
      const a = getComputedStyle(el, "::after");
      if (!a || a.content === "none" || a.position !== "absolute") return { width: r.width, height: r.height };
      const px = (v) => (v && v.endsWith("px") ? parseFloat(v) : 0); // auto, or a percentage, adds nothing we can measure
      const width = Math.max(r.width - px(a.left) - px(a.right), px(a.minWidth));
      return { width, height: r.height - px(a.top) - px(a.bottom) };
    };
    for (const el of targets) {
      const r = hitBox(el);
      if (r.height < 44 || r.width < 44) out.push({ kind: r.height < 24 || r.width < 24 ? "tap-target-under-24px" : "tap-target-under-44px", detail: `${label(el)} is ${Math.round(r.width)}x${Math.round(r.height)}` });
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16) {
        out.push({ kind: "ios-zooms-on-focus", detail: `${label(el)} font-size ${getComputedStyle(el).fontSize} (iOS zooms inputs under 16px)` });
      }
    }
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i], b = targets[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 2 && iy > 2) out.push({ kind: "overlapping-controls", detail: `${label(a)} overlaps ${label(b)} by ${Math.round(ix)}x${Math.round(iy)}` });
      }
    }
    return out;
  });
}

export async function shoot(page, file, { fullPage = true } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage });
  return file;
}

// CLI: one screen at one width.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
  const width = Number(arg("width", 375));
  const browser = await launch();
  try {
    const page = await openApp(browser, { as: arg("as", "player"), width, height: VIEWPORTS[String(width)]?.height || 780 });
    const tab = arg("tab", null);
    if (tab) { await clickText(page, tab); await sleep(1500); }
    const out = arg("out", path.join(process.cwd(), "build", "ui-audit"));
    const file = await shoot(page, path.join(out, `${(tab || "home").toLowerCase()}-${width}.png`));
    console.log(JSON.stringify({ screenshot: file, consoleErrors: page.consoleErrors, findings: await checkLayout(page) }, null, 1));
  } finally {
    await browser.close();
  }
}
