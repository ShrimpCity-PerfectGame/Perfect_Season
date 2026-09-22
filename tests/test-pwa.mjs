// Installing the site as an app, and playing it with no signal: the service worker's rules (sw-rules.mjs),
// what build.mjs writes for it, and the offer the game shows when a browser makes one. The rule that carries
// the most weight is the one about what is never stored - everything that isn't this site's own files, which
// is every account, leaderboard, wallet and submit-run call.
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupDom, makeStorage, mount, flush, click, text, assert, runTest, makeMockAuth } from "./helpers.mjs";
import { planFor, pageKey, BUNDLE, FONT_HOSTS } from "../sw-rules.mjs";
import { THEME } from "../theme.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://www.gridspin.app";
// A request as the worker sees one.
const req = (url, { method = "GET", mode = "no-cors" } = {}) => ({ url, method, mode });

await runTest("the worker touches this site's own files and nothing else", async () => {
  assert(planFor(req(`${SITE}/`, { mode: "navigate" }), SITE) === "page", "the app itself");
  assert(planFor(req(`${SITE}/u/laddertest`, { mode: "navigate" }), SITE) === "page", "a profile");
  assert(planFor(req(`${SITE}/c/ABC123?beat=12-5`, { mode: "navigate" }), SITE) === "page", "a challenge link");
  assert(planFor(req(`${SITE}/how-to-play`, { mode: "navigate" }), SITE) === "page", "a page of its own");
  assert(planFor(req(`${SITE}${BUNDLE}`), SITE) === "bundle", "the bundle");
  for (const asset of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/icon.svg", "/favicon-32.png", "/apple-touch-icon.png", "/og.png", "/site.webmanifest"]) {
    assert(planFor(req(`${SITE}${asset}`), SITE) === "asset", `${asset} is an asset`);
  }
  for (const host of FONT_HOSTS) assert(planFor(req(`https://${host}/css2?family=Anton`), SITE) === "font", `${host}`);

  // Everything sitewide goes to Supabase on another origin. A stored answer to any of these would be a lie:
  // a leaderboard from last week, a balance already spent, or a season that looks unsaved and is sent twice.
  const supabase = "https://ndelisxdxjmvcdezzecu.supabase.co";
  assert(planFor(req(`${supabase}/rest/v1/profiles?select=*`), SITE) === null, "a leaderboard read is left alone");
  assert(planFor(req(`${supabase}/rest/v1/rpc/shop_state`), SITE) === null, "the shop is left alone");
  assert(planFor(req(`${supabase}/auth/v1/token?grant_type=password`, { method: "POST" }), SITE) === null, "signing in is left alone");
  assert(planFor(req(`${supabase}/functions/v1/submit-run`, { method: "POST" }), SITE) === null, "a season is left alone");
  assert(planFor(req(`${supabase}/storage/v1/object/public/avatars/u/1.webp`), SITE) === null, "a picture is left alone");
  assert(planFor(req(`${SITE}${BUNDLE}`, { method: "POST" }), SITE) === null, "nothing but GET is answered from store");
  assert(planFor(req(`${SITE}/robots.txt`), SITE) === null, "the crawl files are the crawlers' business");
  assert(planFor(req(`${SITE}/sitemap.xml`), SITE) === null, "including the sitemap");
  assert(planFor(req("https://example.com/tracker.js"), SITE) === null, "and anything else out there");
  // Another origin serving a path that looks like ours is still another origin: only this site's own files are
  // ever stored, whatever they are called.
  assert(planFor(req(`https://cdn.example.com${BUNDLE}`), SITE) === null, "someone else's page.js is not our bundle");
  assert(planFor(req("https://cdn.example.com/icon-192.png"), SITE) === null, "someone else's icon is not our icon");
  assert(planFor(req(`${supabase}/icon-192.png`), SITE) === null, "and nothing under the database's own address");
});

await runTest("a page is stored under its path, never its query, and never one entry per link", async () => {
  const key = (url) => pageKey(req(url, { mode: "navigate" }), SITE);
  // The one that matters: Google sign-in comes back to /?code=<authorization code> (Supabase's PKCE flow).
  // Keyed by the request, the worker filed that code in Cache Storage until the next deploy replaced the
  // store. It is single-use and short-lived and it is in the history anyway, but this site should not be the
  // one keeping a copy.
  assert(key(`${SITE}/?code=4%2F0AY0e-g7-rWEVWUV`) === `${SITE}/`, "an authorization code never reaches the store");
  assert(!key(`${SITE}/?code=SECRET`).includes("SECRET"), "nothing from a query does");
  assert(key(`${SITE}/?error=access_denied&error_description=x`) === `${SITE}/`, "nor what came back instead of one");

  // And one entry, not one per link. Nothing empties the store until a release replaces it, so every
  // challenge link, profile and duel a player opened used to stay in it.
  const many = [`${SITE}/c/ABC123?beat=20-0`, `${SITE}/c/ZZZ999`, `${SITE}/u/laddertest`, `${SITE}/vs/QWE456`, `${SITE}/anything-else`];
  assert(new Set(many.map(key)).size === 1 && key(many[0]) === `${SITE}/`, `every shell address is one entry: ${[...new Set(many.map(key))].join(', ')}`);

  // The pages that are their own file keep their own, or /privacy offline would be the game and /how-to-play
  // would answer for "/". A trailing slash is the same page; vercel.json rewrites both.
  for (const p of ["/how-to-play", "/leaderboard", "/privacy"]) {
    assert(key(SITE + p) === SITE + p, `${p} is its own entry`);
    assert(key(`${SITE}${p}/`) === SITE + p, `${p}/ is the same entry`);
    assert(key(`${SITE}${p}?utm_source=x`) === SITE + p, `${p} with a query is the same entry`);
  }
  // Anything that resolves lands on the shell, which is the safe answer for an address this build has never
  // heard of; the few that do not parse at all are left alone, and service-worker.js falls back to "/".
  assert(key(`${SITE}/some-page-a-later-release-adds`) === `${SITE}/`, "an address nobody recognises is the shell");
  assert(key("http://") === null, "and one that will not parse is nobody's business");
});

await runTest("build.mjs writes a worker stamped with this exact build", async () => {
  const build = (env = {}) => {
    const clean = { ...process.env };
    for (const k of ["APP_ENV", "SITE_URL", "CANONICAL_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) delete clean[k];
    execFileSync(process.execPath, ["build.mjs"], { cwd: root, env: { ...clean, ...env }, stdio: "pipe" });
    const read = (f) => (existsSync(path.join(root, "public", f)) ? readFileSync(path.join(root, "public", f), "utf8") : null);
    return { sw: read("sw.js"), js: read("page.js"), html: read("page.html") };
  };
  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  const first = build({ APP_ENV: "staging", SITE_URL: "https://gridspin.test", SUPABASE_URL: "https://one.supabase.co", SUPABASE_ANON_KEY: "one" });
  assert(first.sw, "public/sw.js is written");
  const name = (sw) => (sw.match(/gridspin-[\w.-]+/) || [])[0];
  assert(name(first.sw)?.startsWith(`gridspin-${version}-`), `the store is named after the release, got ${name(first.sw)}`);
  // The worker is what a browser installs; it has to be able to open the game with nothing else to hand.
  for (const shell of ["\"/\"", JSON.stringify(BUNDLE), "\"/site.webmanifest\"", "\"/icon-192.png\""]) {
    assert(first.sw.includes(shell), `the shell it stores includes ${shell}`);
  }
  assert(first.html.includes('rel="manifest"'), "the page links the manifest, without which no browser offers to install it");
  assert(first.js.includes("/sw.js"), "the bundle registers it");
  assert(first.sw.includes("/how-to-play") && first.sw.includes("/privacy"),
    "the worker knows the pages that have a file of their own, from site-paths.mjs");
  assert(/<meta name="theme-color" content="[^"]+"/.test(first.html), "the page ships a theme colour for the app to keep in step");

  // The bundle's name never changes, so the stamp is the only thing that can tell two builds apart: a deploy
  // has to leave a player on the new one, not on whatever their browser stored last week.
  const second = build({ APP_ENV: "staging", SITE_URL: "https://gridspin.test", SUPABASE_URL: "https://two.supabase.co", SUPABASE_ANON_KEY: "two" });
  assert(second.js !== first.js, "a different build makes a different bundle");
  assert(name(second.sw) !== name(first.sw), `and a differently named store, got ${name(second.sw)} twice`);
});

// ---------- the offer, in the game ----------

let app = null;
async function close() {
  if (!app) return;
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
async function open() {
  await close();
  setupDom("http://localhost/");
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  app = await mount();
  await flush(4);
  return app.container;
}
const offerButton = (c) => [...c.querySelectorAll("button.pill")].find((b) => b.textContent === "Install Gridspin") || null;
// What Chrome sends: an event it lets the page hold on to, and which reports what the player chose.
async function browserOffers(container) {
  const { act } = await import("react-dom/test-utils");
  let prompted = 0;
  const event = new window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => { prompted++; };
  await act(async () => { window.dispatchEvent(event); });
  await flush(2);
  return { event, prompts: () => prompted, container };
}

await runTest("the offer to install only appears when the browser makes one", async () => {
  const c = await open();
  assert(!offerButton(c), `no offer to begin with, got: ${text(c).slice(0, 120)}`);

  const offer = await browserOffers(c);
  assert(offer.event.defaultPrevented, "the browser's own bar is held back, so the offer is the game's to make");
  assert(offerButton(c), "the offer appears beside the live pills");

  await click(offerButton(c));
  await flush(2);
  assert(offer.prompts() === 1, "taking it opens the browser's install dialog");
  assert(!offerButton(c), "and the offer goes: a browser only lets each one be used once");
});

await runTest("an installed copy is never offered another install", async () => {
  const c = await open();
  await browserOffers(c);
  assert(offerButton(c), "the offer is there");
  const { act } = await import("react-dom/test-utils");
  await act(async () => { window.dispatchEvent(new window.Event("appinstalled")); });
  await flush(2);
  assert(!offerButton(c), "installing it takes the offer away");
});

await runTest("an installed copy is painted the colour of the screen it's on", async () => {
  const c = await open();
  // What page.html ships (build.mjs writes it out), so the first paint is cream before React has mounted.
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", THEME.light.bg);
  document.head.appendChild(meta);
  const colour = () => document.querySelector('meta[name="theme-color"]').getAttribute("content");
  const tab = (label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));

  await click(tab("Leaderboard"));
  await flush(3);
  assert(colour() === THEME.night.bg, `the Leaderboard is true black, got ${colour()}`);
  await click(tab("Draft"));
  await flush(3);
  assert(colour() === THEME.dark.bg, `the play screen is stadium-dark, got ${colour()}`);
  await click(tab("Modes"));
  await flush(3);
  assert(colour() === THEME.light.bg, `and everything else is cream, got ${colour()}`);
});


// pageKey is tested above as a pure function, which says nothing about whether the worker CALLS it -
// reverting keyFor to `(request) => request` left this whole suite green. And the built file is minified,
// so reading it for names proves nothing either. So: run it. This drives public/sw.js's own fetch handler
// against a stand-in Cache API and asks what it really stored, and under what.
await runTest("the worker that ships files a page under its path, not the address it was asked for", async () => {
  execFileSync(process.execPath, ["build.mjs"], {
    cwd: root, stdio: "pipe",
    env: { ...process.env, APP_ENV: "staging", SITE_URL: SITE, SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" },
  });
  const source = readFileSync(path.join(root, "public", "sw.js"), "utf8");

  const store = new Map();
  const keyOf = (r) => (typeof r === "string" ? r : r.url);
  const cache = {
    put: async (req, res) => { store.set(keyOf(req), res); },
    match: async (req) => store.get(keyOf(req)),
    add: async () => {},
    keys: async () => [...store.keys()],
  };
  const listeners = {};
  const sandbox = {
    self: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      location: { origin: SITE },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
      caches: null,
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {}, match: async (r) => cache.match(r) },
    fetch: async (req) => ({ ok: true, status: 200, type: "basic", url: keyOf(req), clone() { return this; } }),
    URL, Set, Map, Promise, console,
  };
  sandbox.self.caches = sandbox.caches;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert(typeof listeners.fetch === "function", "the built worker registers a fetch handler");

  const ask = async (url) => {
    const answered = [], waits = [];
    listeners.fetch({
      request: { url, method: "GET", mode: "navigate" },
      respondWith: (p) => answered.push(p),
      waitUntil: (p) => waits.push(p),
    });
    await Promise.all(answered).catch(() => {});
    await Promise.all(waits).catch(() => {});
  };

  // The one that matters: signing in with Google comes back to /?code=<authorization code>.
  await ask(`${SITE}/?code=4%2F0AY0e-SECRETCODE`);
  let keys = [...store.keys()];
  assert(keys.length === 1 && keys[0] === `${SITE}/`, `the shell is filed under "/" alone: ${keys.join(", ")}`);
  assert(!keys.some((k) => k.includes("SECRETCODE")), "and the authorization code is nowhere in the store");

  // Twenty shared links are one entry, not twenty - nothing prunes this store but the next release.
  for (const u of [`${SITE}/c/ABC123?beat=20-0`, `${SITE}/c/ZZZ999`, `${SITE}/u/somebody`, `${SITE}/vs/QWE456`]) await ask(u);
  keys = [...store.keys()];
  assert(keys.length === 1, `every address served the shell is the same entry: ${keys.join(", ")}`);

  // A page with a file of its own keeps its own key, or offline /privacy would be the game.
  await ask(`${SITE}/privacy`);
  assert(store.has(`${SITE}/privacy`) && store.has(`${SITE}/`), `/privacy is its own entry: ${[...store.keys()].join(", ")}`);

  // And opening one of our own FILES in a tab is a navigation too. Filed under "/", it served that file in
  // place of the game to everything that falls back to the shell.
  const shellBefore = await cache.match(`${SITE}/`);
  await ask(`${SITE}/icon.svg`);
  assert((await cache.match(`${SITE}/`)) === shellBefore, "opening /icon.svg in a tab does not replace the shell");
});

await close();
