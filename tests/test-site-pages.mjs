// The pages search engines can read (site-pages.mjs, CLAUDE.md "Search engines"), from the app's side: landing
// on /how-to-play opens the rules and landing on /leaderboard opens the Leaderboard, each keeping its address
// while it's on screen and tidying back to "/" when you leave; the footer links to both with real addresses a
// crawler can follow; and the rules the dialog shows are word for word the rules the built page carries, so the
// two can never drift apart. tests/test-build-seo.mjs checks the built HTML itself.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";
import {
  HOWTO_STEPS, HOWTO_NOTE, SITE_PAGES, parseSitePath, HOWTO_PATH, BOARD_PATH, PRIVACY_CONTACT,
  TERMS_PATH, TERMS_STATE, TERMS_AGE, TERMS_LAW_UNSET, SITE_PAGE_BY_ID,
} from "../site-pages.mjs";
import { readFileSync as readSrc } from "node:fs";

let app = null;
async function close() {
  if (!app) return;
  // Imported here, not at the top: react-dom must load after setupDom() (see tests/helpers.mjs).
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
// A fresh page at `url`, with How to play already seen - so an open dialog is the address's doing, not a
// first visit's.
async function open(url, storage = makeStorage()) {
  await close();
  setupDom(url);
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  app = await mount();
  await flush(4);
  return app.container;
}
async function until(cond, what, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}
const rules = (c) => c.querySelector('[role="dialog"][aria-labelledby="howto-title"]');
const onTab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.getAttribute("aria-current") === "page")?.textContent.startsWith(label);
const tab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
const footer = (c) => c.querySelector("footer.sitefoot");
const flat = (s) => s.replace(/\s+/g, " ").trim();
// A step of the shared copy as plain words, the way the dialog and the built page both read.
const stepText = (step) => flat(step.map((p) => (typeof p === "string" ? p : p.text)).join(""));

await runTest("the addresses name their pages, trailing slash or not", async () => {
  assert(parseSitePath(HOWTO_PATH) === "howto" && parseSitePath(`${HOWTO_PATH}/`) === "howto", "the rules' address");
  assert(parseSitePath(BOARD_PATH) === "board" && parseSitePath(`${BOARD_PATH}/`) === "board", "the Leaderboard's address");
  assert(parseSitePath("/") === null && parseSitePath("/u/someone") === null && parseSitePath("/c/ABC123") === null, "nothing else is a page of its own");
  assert(SITE_PAGES.every((p) => p.nav && p.title && p.description && p.h1 && p.intro.length), "every page has its link text, title, description and words");
});

await runTest("/how-to-play opens the rules over Modes and keeps its address; closing them goes back to /", async () => {
  const c = await open(`http://localhost${HOWTO_PATH}`);
  await until(() => rules(c), () => `the rules, got: ${text(c).slice(0, 150)}`);
  assert(window.location.pathname === HOWTO_PATH, `the address stays ${HOWTO_PATH} while they're open, got ${window.location.pathname}`);
  assert(onTab(c, "Modes"), "the screen underneath is Modes");
  await click(findButtonByText(rules(c), "Got it, let's draft"));
  await flush(2);
  assert(!rules(c), "the rules close");
  assert(window.location.pathname === "/", `closing them returns to /, got ${window.location.pathname}`);
});

await runTest("the rules on screen are the rules the built page carries", async () => {
  const c = await open(`http://localhost${HOWTO_PATH}`);
  await until(() => rules(c), "the rules");
  const steps = [...rules(c).querySelectorAll("ol li")].map((li) => flat(li.textContent));
  assert(steps.length === HOWTO_STEPS.length, `${HOWTO_STEPS.length} steps, got ${steps.length}`);
  HOWTO_STEPS.forEach((step, i) => assert(steps[i] === stepText(step), `step ${i + 1} matches the shared copy:\n  app  ${steps[i]}\n  copy ${stepText(step)}`));
  assert(flat(rules(c).querySelector("p.small").textContent) === flat(HOWTO_NOTE), "the grading note matches");
  // The bold pieces still render as <b>, and "20-0" still can't break across lines.
  assert(rules(c).querySelectorAll("ol li b").length >= HOWTO_STEPS.length, "each step still has its bold pieces");
  assert(rules(c).querySelector("ol li b .nowrap")?.textContent === "20–0", "20-0 stays on one line");
});

await runTest("/leaderboard opens the Leaderboard and keeps its address; leaving it returns to /", async () => {
  const c = await open(`http://localhost${BOARD_PATH}`);
  await until(() => onTab(c, "Leaderboard"), () => `the Leaderboard, got: ${text(c).slice(0, 150)}`);
  assert(window.location.pathname === BOARD_PATH, `the address stays ${BOARD_PATH}, got ${window.location.pathname}`);
  assert(window.history.state?.ps === "view" && window.history.state?.view === "board", `the entry says which screen it is, got ${JSON.stringify(window.history.state)}`);
  assert(!rules(c), "no rules dialog on this one");

  await click(tab(c, "Modes"));
  await flush(2);
  assert(window.location.pathname === "/" && window.history.state?.view === "home", `leaving goes back to /, got ${window.location.pathname} ${JSON.stringify(window.history.state)}`);
  await click(tab(c, "Leaderboard"));
  await flush(2);
  assert(window.location.pathname === BOARD_PATH, `and the tab takes that address again, got ${window.location.pathname}`);
});

await runTest("a trailing slash opens the same page", async () => {
  const c = await open(`http://localhost${BOARD_PATH}/`);
  await until(() => onTab(c, "Leaderboard"), "the Leaderboard");
  const c2 = await open(`http://localhost${HOWTO_PATH}/`);
  await until(() => rules(c2), "the rules");
});

await runTest("an address that names no screen still tidies to /", async () => {
  // A challenge link (/c/CODE) hands its boards to Modes and drops the address, and an address under /u/
  // that isn't a username is Modes too.
  const c = await open("http://localhost/c/ABC123");
  await until(() => onTab(c, "Modes"), "Modes");
  assert(window.location.pathname === "/", `a challenge link tidies to /, got ${window.location.pathname}`);
  const c2 = await open("http://localhost/u/");
  await until(() => onTab(c2, "Modes"), "Modes");
  assert(window.location.pathname === "/", `so does /u/, got ${window.location.pathname}`);
});

await runTest("Modes ends with the brand and real links to both pages, which open in place", async () => {
  const c = await open("http://localhost/");
  await until(() => footer(c), () => `the footer, got: ${text(c).slice(-150)}`);
  assert(/Gridspin is a free football draft game/.test(flat(footer(c).textContent)), `the brand in plain words, got: ${flat(footer(c).textContent)}`);
  const links = [...footer(c).querySelectorAll("a")];
  assert(links.length === SITE_PAGES.length && SITE_PAGES.every((p) => links.some((a) => a.getAttribute("href") === p.path && a.textContent === p.nav)),
    `an <a href> per page, got ${links.map((a) => `${a.getAttribute("href")}:${a.textContent}`).join(", ")}`);

  // The app takes the click: the rules open over Modes, with no navigation.
  await click(links.find((a) => a.getAttribute("href") === HOWTO_PATH));
  await until(() => rules(c), "the rules from the footer");
  assert(window.location.pathname === "/", `an overlay doesn't change the address, got ${window.location.pathname}`);
  await click(findButtonByText(rules(c), "Got it, let's draft"));
  await flush(2);

  await click([...footer(c).querySelectorAll("a")].find((a) => a.getAttribute("href") === BOARD_PATH));
  await until(() => onTab(c, "Leaderboard"), "the Leaderboard from the footer");
  assert(window.location.pathname === BOARD_PATH, `the Leaderboard's own address, got ${window.location.pathname}`);
  assert(!footer(c), "the footer belongs to Modes, not every screen");
});

await runTest("the privacy page is a page, not a screen: the app lets the browser go there", async () => {
  const c = await open("http://localhost/");
  await until(() => footer(c), () => `the footer, got: ${text(c).slice(-150)}`);
  const link = [...footer(c).querySelectorAll("a")].find((a) => a.getAttribute("href") === "/privacy");
  assert(link && link.textContent === "Privacy", `the footer links it, got ${link && link.textContent}`);

  // Nothing in the app answers that address, so the click is the browser's to follow - unlike the rules and
  // the Leaderboard, which the app takes and opens in place.
  const clicked = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(clicked);
  assert(!clicked.defaultPrevented, "the app doesn't take the click");
  assert(parseSitePath("/privacy") === null, "and no screen claims the address");

  const page = SITE_PAGES.find((p) => p.id === "privacy");
  assert(page.standalone === true, "which is why it is built without the bundle");
  // The one thing on the page that has to be true of the site itself: somewhere to write to.
  assert(page.sections.some(([, ps]) => ps.some((t) => t.includes(PRIVACY_CONTACT))), "it says where to write about your data");
});


// The terms of use (v2.19.3). Until then /terms was a live 404: nothing stated the rules the word filter
// and the Reports queue enforce, nothing said coins have no cash value, and nothing reserved the right to
// close an account - which is why moderation could rename and clear but not ban. There was no document to
// ban anyone under.
await runTest("the terms page exists, says the things it has to, and is built to be read without the game", async () => {
  const page = SITE_PAGE_BY_ID.terms;
  assert(page, "there is a terms page at all");
  assert(page.path === TERMS_PATH && TERMS_PATH === "/terms", `at /terms: ${TERMS_PATH}`);
  // Words only, like the privacy policy: a page of rules has to read with JavaScript off.
  assert(page.standalone === true, "built without the bundle");
  assert(parseSitePath(TERMS_PATH) === null, "and no screen in the app claims the address");

  const said = page.sections.flatMap(([heading, ps]) => [heading, ...ps]).join(" ");
  // Each of these is a promise the site actually makes, and the reason the page exists at all.
  const mustSay = [
    [`aged ${TERMS_AGE} and over`, "who may play"],
    ["have no cash value", "that coins are a score and not money"],
    ["not affiliated with, endorsed by, or sponsored by the National Football League", "that the NFL has nothing to do with it"],
    ["close an account", "that an account can be closed - the thing moderation had no document for"],
    [PRIVACY_CONTACT, "somewhere to write"],
  ];
  for (const [needle, why] of mustSay) {
    assert(said.includes(needle), `it says ${why}: looked for ${JSON.stringify(needle)}`);
  }
});

// The gate. A terms page is the one page where shipping a placeholder is worse than shipping a day late, so
// the suite stays red until the owner names the law that governs it.
await runTest("the terms name the law that governs them", async () => {
  assert(typeof TERMS_STATE === "string" && TERMS_STATE.trim().length > 0,
    "TERMS_STATE in site-pages.mjs is still empty - the owner has to name the US state before this ships");
  const said = SITE_PAGE_BY_ID.terms.sections.flatMap(([, ps]) => ps).join(" ");
  assert(!said.includes(TERMS_LAW_UNSET), "and the page no longer carries the not-set sentence");
  assert(said.includes(`State of ${TERMS_STATE}`), `it names the state: ${TERMS_STATE}`);
});

// Two live pages that disagree about who may play are worse than either alone.
await runTest("the privacy policy and the terms agree about age", async () => {
  const inPage = (id) => SITE_PAGE_BY_ID[id].sections.flatMap(([, ps]) => ps).join(" ");
  for (const id of ["privacy", "terms"]) {
    assert(inPage(id).includes(`aged ${TERMS_AGE} and over`), `${id} states the same age`);
  }
  // ...and no older number is left lying around in either of them from a previous draft.
  for (const id of ["privacy", "terms"]) {
    const stale = inPage(id).match(/under (\d+)|aged (\d+)/g) || [];
    for (const hit of stale) {
      const n = Number(hit.replace(/\D/g, ""));
      assert(n === TERMS_AGE, `${id} mentions age ${n}, which is not ${TERMS_AGE}: ${hit}`);
    }
  }
});

// Vercel is what actually serves the address. The page can be perfect and still 404 without these.
await runTest("the terms address is routed, and its .html redirects to it", async () => {
  const vercel = JSON.parse(readSrc(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrites = vercel.rewrites.map((r) => r.source);
  for (const src of ["/terms", "/terms/"]) {
    assert(rewrites.includes(src), `${src} is rewritten to the built file: ${JSON.stringify(rewrites)}`);
  }
  // One address per page: the .html 308s to the pretty one, the way the other three do.
  const redirect = vercel.redirects.find((r) => r.source === "/terms.html");
  assert(redirect && redirect.destination === "/terms" && redirect.permanent === true,
    `/terms.html redirects permanently to /terms: ${JSON.stringify(redirect)}`);
});

await close();
console.log("test-site-pages.mjs done");
