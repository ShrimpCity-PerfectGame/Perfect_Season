// Shared jsdom bootstrap for driving the real PerfectSeason component headlessly.
// perfect-season.jsx is bundled fresh (react/react-dom left external so tests and the
// component share one React instance) rather than transpiled ad hoc, so esbuild catches
// the same syntax errors `npm run check` would.
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import * as GL from "../game-logic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");

// This is a SEPARATE instance of game-logic.mjs from the one esbuild inlines into the bundled
// component below (bundling copies the module in, it doesn't share it) - deterministic given the
// same data/players.json in, so both independently reach identical BOARDS/OPPS, same as the real
// client bundle and the real submit-run Edge Function are two separate processes in production.
const gameData = JSON.parse(readFileSync(path.join(root, "data", "players.json"), "utf8"));
GL.initGameData(gameData.players, gameData.opponents);

export { makeMockAuth } from "./mock-supabase.mjs";

export function setupDom(url = "http://localhost/") {
  // Tear down the previous jsdom before replacing it. Most suites call this once, but a bot that
  // plays hundreds of drafts in one process (test-difficulty.mjs) otherwise keeps every window
  // it ever built alive through these globals and exhausts the heap partway through a long run.
  if (global.window && typeof global.window.close === "function") global.window.close();
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
  global.HTMLElement = window.HTMLElement;
  global.MouseEvent = window.MouseEvent;
  global.Node = window.Node;
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  window.crypto.subtle = webcrypto.subtle;
  Object.defineProperty(global, "localStorage", { value: window.localStorage, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom's Document doesn't expose oninput, so React's isEventSupported('input') check comes
  // back false and it falls back to its legacy IE input-event polyfill, which calls the
  // long-gone attachEvent/detachEvent and throws. Stubbing the property short-circuits that.
  if (!("oninput" in window.document)) window.document.oninput = null;
  // Board spins run a real setInterval animation unless prefers-reduced-motion matches;
  // tests want the resolved board immediately, not 900ms of reel ticks.
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return true; },
  });
  return dom;
}

// In-memory stand-in for the artifact host's window.storage: get/set/delete/list keyed by
// a "shared" namespace (leaderboard/account rows, visible to everyone) vs "personal" (this
// device only). Mirrors entry.jsx's shim but plain-object backed instead of localStorage,
// so each test's storage.data can be reset or preloaded directly.
// delayKeys: optional list of substrings - a delete() whose key matches always resolves after
// a real delay, and a set() whose key matches AND whose value looks like clearDraft's
// "cleared" marker also delays (ordinary progress-saving writes to the same key are left
// fast). This isolates "the clear operation is slow" from "every write to this key is slow" -
// a caller that fires a slow clear (finish()'s fire-and-forget clearDraft) and a concurrent
// fast read from elsewhere (refreshWip()) can then be made to interleave deterministically:
// the read lands before the slow clear does, reproducing a real remote-storage's lack of
// read-after-write ordering.
export function makeStorage(delayKeys = [], delayMs = 30) {
  const data = {};
  const nsKey = (shared, key) => `${shared ? "shared" : "personal"}:${key}`;
  const storage = {
    data,
    async get(key, shared) {
      const k = nsKey(shared, key);
      return Object.prototype.hasOwnProperty.call(data, k) ? { value: data[k] } : null;
    },
    async set(key, value, shared) {
      if (delayKeys.some((k) => key.includes(k)) && value.includes('"cleared":true')) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      data[nsKey(shared, key)] = value;
      return true;
    },
    async delete(key, shared) {
      if (delayKeys.some((k) => key.includes(k))) await new Promise((r) => setTimeout(r, delayMs));
      delete data[nsKey(shared, key)];
    },
    async list(prefix, shared) {
      const nsPrefix = nsKey(shared, prefix);
      const keys = Object.keys(data)
        .filter((k) => k.startsWith(nsPrefix))
        .map((k) => k.slice(shared ? "shared:".length : "personal:".length));
      return { keys };
    },
  };
  return storage;
}

// react-dom must never be imported (even transitively) before setupDom() has installed the
// jsdom globals: react-dom's ChangeEventPlugin decides at MODULE LOAD TIME whether the
// environment supports native input events, based on whatever `window`/`document` are at that
// instant. Importing it early latches that decision to "no" and permanently routes text input
// through react-dom's long-dead IE input-event polyfill (attachEvent/detachEvent), which throws.
let cachedAct = null;
async function getAct() {
  if (!cachedAct) cachedAct = (await import("react-dom/test-utils")).act;
  return cachedAct;
}

let cachedComponentPath = null;
export async function loadPerfectSeason() {
  if (!cachedComponentPath) {
    const outfile = path.join(root, "build", "test-component.mjs");
    await esbuild.build({
      entryPoints: [path.join(root, "perfect-season.jsx")],
      bundle: true,
      format: "esm",
      jsx: "automatic",
      platform: "browser",
      external: ["react", "react-dom", "react-dom/client"],
      // Mirrors build.mjs: these are bare identifiers textually replaced at build time, so they
      // have to be defined here too or the component throws a ReferenceError on render.
      define: {
        APP_VERSION: JSON.stringify("test"),
        APP_ENV: JSON.stringify("production"),
        APP_SITE_URL: JSON.stringify("https://gridspin.test"),
      },
      outfile,
    });
    cachedComponentPath = outfile;
  }
  const mod = await import(pathToFileURL(cachedComponentPath).href + `?t=${Date.now()}`);
  return mod.default;
}

// The component module itself, for tests of its exported display helpers (SeasonStrip,
// SeasonMoments, gameWinChance, ...). Call setupDom() first, like mount().
export async function loadAppModule() {
  await loadPerfectSeason();
  return import(pathToFileURL(cachedComponentPath).href + `?t=${Date.now()}`);
}

// Mounts a fresh PerfectSeason instance. Call setupDom() first.
export async function mount() {
  const act = await getAct();
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const PerfectSeason = await loadPerfectSeason();
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  await act(async () => {
    reactRoot.render(React.createElement(PerfectSeason));
  });
  return { container, reactRoot };
}

// Auth now runs through the mock Supabase client (no client-side PBKDF2 delay to wait out),
// but call sites still call this after a signup/login submit - kept as a thin flush() alias
// rather than touched at every call site.
export async function waitForCrypto() {
  await flush();
}

export async function flush(rounds = 3) {
  const act = await getAct();
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export async function click(el) {
  const act = await getAct();
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

export async function type(el, value) {
  const act = await getAct();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

// Same idea as type(), but for <select> - HTMLSelectElement's value setter isn't inherited from
// HTMLInputElement, so type()'s setter lookup doesn't apply to it.
export async function selectOption(el, value) {
  const act = await getAct();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

export function text(container) {
  return container.textContent;
}

// Simulates a Realtime broadcast arriving from another tab - e.g.
// broadcast(auth, "site-activity", "draft_finished", {}). Wrapped in act() like every other
// helper here that triggers a React state update from outside a real DOM event.
export async function broadcast(auth, channelName, event, payload) {
  const act = await getAct();
  await act(async () => {
    auth._channels.get(channelName).send({ event, payload });
  });
}

// Opens a home-screen mode by its tile name ("Unlimited", "Genius mode", "GM mode", ...). Tests use
// this rather than clicking a tile's call-to-action text, because that copy is designed to change.
export async function clickMode(container, name) {
  const tile = [...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === name)?.closest("button");
  if (!tile) throw new Error(`no "${name}" mode tile on screen`);
  await click(tile);
}

export function findButtonByText(container, needle) {
  const buttons = [...container.querySelectorAll("button")];
  return buttons.find((b) => b.textContent.includes(needle)) || null;
}

export function findAllButtonsByText(container, needle) {
  return [...container.querySelectorAll("button")].filter((b) => b.textContent.includes(needle));
}

export function assert(cond, msg) {
  if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function runTest(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log("ok");
  } catch (e) {
    console.log("FAIL");
    console.error(e);
    process.exitCode = 1;
  }
}
