// The crash net (error-boundary.jsx). Until v2.19.0 there wasn't one, and React 18 unmounts the whole tree on
// an uncaught render error - so the player got a blank cream page with no text and no way back. versus.jsx
// records that happening on a real duel: "with no error boundary anywhere, that took the whole app down, and
// it landed on whoever didn't make the last pick."
//
// What matters here is not that a boundary exists but that the SCREEN it renders is usable by somebody who
// cannot see a console: it says what happened in words, offers the one remedy that works, carries the version,
// and hands them something to send. And that it stands up with no stylesheet, because the stylesheet is
// injected by the component that just crashed.
import fs from "node:fs";
import { setupDom, loadModule, renderComponent, click, flush, assert, runTest, findButtonByText } from "./helpers.mjs";

setupDom();
const { act } = await import("react-dom/test-utils");
const React = await import("react");
const mod = await loadModule("error-boundary.jsx");
const { ErrorBoundary, installGlobalErrorHandlers, recordError, errorLog, clearErrorLog, crashReport, describeError, VERSION } = mod;

// A component that throws on demand, which is the only way to reach componentDidCatch for real.
function Boom({ when }) {
  if (when) throw new Error("the board read a turn that no longer exists");
  return React.createElement("p", null, "the game");
}

// React logs every caught error to console.error; that is correct behaviour and would bury the test output.
const realError = console.error;
const swallow = () => { console.error = () => {}; };
const restore = () => { console.error = realError; };

await runTest("a crash shows a screen, not a blank page", async () => {
  swallow();
  const shown = await renderComponent(ErrorBoundary, { children: React.createElement(Boom, { when: true }) });
  restore();
  const { container } = shown;
  const text = container.textContent;

  assert(text.includes("Something went wrong"), `it says so in words: ${text.slice(0, 120)}`);
  assert(container.querySelector("[role=alert]"), "and announces itself to a screen reader");
  // The one remedy that actually works: pages and the bundle are network-first in the service worker, so a
  // reload fetches new code rather than re-serving the broken build.
  assert(findButtonByText(container, "Reload the game"), "the reload button is there");
  assert(findButtonByText(container, "Copy error details"), "and a way to send it on");
  assert(text.includes(VERSION), `the build is named, so a report says which one broke: ${VERSION}`);
  // The player needs to know their seasons are safe - they are on the server, not in this page - or the next
  // thing they do is panic rather than reload.
  assert(/nothing you had saved is lost/i.test(text), "and it says their seasons are safe");
  await act(async () => shown.reactRoot.unmount());
});

await runTest("the crash screen needs no stylesheet, because the stylesheet is the thing that crashed", async () => {
  // perfect-season.jsx injects APP_CSS as it renders. A crash during that render means there may be no styles
  // at all, so every rule here has to be inline - a crash screen that needs the crashed app's CSS is not one.
  swallow();
  const shown = await renderComponent(ErrorBoundary, { children: React.createElement(Boom, { when: true }) });
  restore();
  const { container } = shown;
  const root = container.querySelector(".ps-crash");
  assert(root, "the crash screen renders its own root");
  assert(/background/.test(root.getAttribute("style") || ""), "with its own background, not the page's");
  for (const b of container.querySelectorAll("button")) {
    assert((b.getAttribute("style") || "").includes("border"), `every control is styled inline: ${b.textContent}`);
  }
  // No class from the app's stylesheet is relied on anywhere in the tree.
  const classed = [...container.querySelectorAll("[class]")].map((e) => e.getAttribute("class"));
  assert(classed.every((c) => c === "ps-crash"), `no app classes are used: ${JSON.stringify(classed)}`);
  await act(async () => shown.reactRoot.unmount());
});

await runTest("a healthy tree is left completely alone", async () => {
  const shown = await renderComponent(ErrorBoundary, { children: React.createElement(Boom, { when: false }) });
  assert(shown.container.textContent.includes("the game"), "the children render as normal");
  assert(!shown.container.textContent.includes("Something went wrong"), "and nothing of the net is on screen");
  await act(async () => shown.reactRoot.unmount());
});

await runTest("the report carries what the owner needs and nothing about the player", async () => {
  clearErrorLog();
  recordError("unhandledrejection", new Error("submitRun: Failed to fetch"), "");
  const report = crashReport(new Error("the board read a turn that no longer exists"), {
    componentStack: "\n    at VersusScreen\n    at PerfectSeason",
  });

  assert(report.includes(VERSION), "the build");
  assert(report.includes("the board read a turn that no longer exists"), "what broke");
  assert(report.includes("VersusScreen"), "and where, so it can be found in the source");
  // The thing that led up to it. A crash is usually the second failure, not the first - the lost Guess daily
  // on 2026-09-30 was diagnosed by inference precisely because nothing recorded the first one.
  assert(report.includes("submitRun: Failed to fetch"), "and what happened before it");

  // Once, not twice. V8 begins err.stack with "Error: <message>", so printing the message and then the stack
  // repeats the only line the reader cares about - which is what the first real crash screen showed.
  const said = report.split("\n").filter((l) => l.includes("the board read a turn that no longer exists"));
  assert(said.length === 1, `the error is stated once: ${JSON.stringify(said)}`);

  // No personal data, ever. The owner does not need it to find a crash, and a report that carries it is one
  // the player should have been asked about first. This is a privacy promise, not a nicety: site-pages.mjs
  // tells players Gridspin keeps as little about them as it can.
  for (const leak of ["@", "user_id", "userId", "email", "password", "token", "session"]) {
    assert(!report.toLowerCase().includes(leak.toLowerCase()),
      `the report carries no ${leak}: ${report.slice(0, 200)}`);
  }
});

await runTest("what an error boundary cannot catch is caught anyway", async () => {
  // A boundary sees rendering and nothing else. A rejected promise and a handler that throws are exactly the
  // silent failures this repo keeps shipping, and they do not blank the page - so they are kept for the next
  // report rather than shown.
  clearErrorLog();
  const off = installGlobalErrorHandlers(window);
  // window.Event, not the bare global: node has an Event of its own and jsdom refuses to dispatch it.
  const fire = (type, props) => {
    const ev = new window.Event(type);
    for (const k of Object.keys(props)) {
      try { ev[k] = props[k]; } catch (e) { Object.defineProperty(ev, k, { value: props[k], configurable: true }); }
    }
    window.dispatchEvent(ev);
  };
  fire("unhandledrejection", { reason: new Error("claim_minigame: 500") });
  fire("error", { error: new Error("boom"), filename: "page.js", lineno: 12 });
  const log = errorLog();
  assert(log.length === 2, `both were kept: ${JSON.stringify(log.map((l) => l.kind))}`);
  assert(log[0].kind === "unhandledrejection" && log[0].message.includes("claim_minigame"), "the rejection");
  assert(log[1].kind === "error" && log[1].extra.includes("page.js:12"), "and the error, with where it came from");
  off();

  // Bounded, because this is a diagnostic and not a log: a loop that throws every frame must not eat memory.
  clearErrorLog();
  for (let i = 0; i < 60; i++) recordError("error", new Error(`e${i}`), "");
  assert(errorLog().length === 20, `the ring is capped: ${errorLog().length}`);
  assert(errorLog()[19].message === "e59", "and keeps the newest");
});

await runTest("anything at all can be thrown, and the net still describes it", async () => {
  // A rejected promise carries whatever the thrower passed - a string, a response object, undefined. Each of
  // these reached describeError as a crash at some point in a real app; none of them may throw here, because
  // a crash handler that crashes is worse than none.
  const cases = [
    [new Error("ordinary"), "ordinary"],
    ["a bare string", "a bare string"],
    [{ code: 42, hint: "no row" }, "42"],
    [null, "null"],
    [undefined, "undefined"],
  ];
  for (const [thrown, expect] of cases) {
    const d = describeError(thrown);
    assert(typeof d.message === "string" && d.message.includes(expect),
      `${JSON.stringify(thrown)} describes as something: ${JSON.stringify(d.message)}`);
  }
  // A circular object cannot be stringified, and that must not become the crash.
  const circular = { name: "loop" };
  circular.self = circular;
  const d = describeError(circular);
  assert(typeof d.message === "string" && d.message.length > 0, `a circular object still describes: ${d.message}`);
});

await runTest("the crash screen's own colours clear AA, since no token file holds them", async () => {
  // Every other surface in the game takes theme.mjs tokens, and tests/test-theme-contrast.mjs holds those to
  // WCAG AA. This file imports nothing - that is the point of it - so its colours are literals that nothing
  // else can check. A crash screen nobody can read is a blank page with extra steps.
  const chan = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (h) => { const [r, g, b] = chan(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => {
    const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
    return (hi + 0.05) / (lo + 0.05);
  };
  const CREAM = "#FDF6E9";
  const pairs = [
    ["heading and body ink on the cream", "#14110F", CREAM],
    ["the muted line on the cream", "#5B5651", CREAM],
    ["the reload button's ink on lime", "#14110F", "#C8FF3D"],
    ["the report block", "#F4EEE3", "#14110F"],
  ];
  for (const [what, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    assert(r >= 4.5, `${what} clears AA: ${r.toFixed(2)}:1`);
  }
  // ...and the colours asserted here are the ones the file actually uses, or this test holds nothing.
  const src = fs.readFileSync(new URL("../error-boundary.jsx", import.meta.url), "utf8");
  for (const [what, fg, bg] of pairs) {
    assert(src.includes(fg) && src.includes(bg), `${what}: both colours are really in the file (${fg}, ${bg})`);
  }
  // Lime is a fill and never text - the rule the whole design system turns on.
  assert(!/color:\s*"#C8FF3D"/.test(src), "lime is never used as an ink");
});

// THE RULE THIS WHOLE FILE RESTS ON, finally asserted. It is stated in the comment at the top and above
// sendReport, and until v2.22.0 it was checked by nothing - the exact shape CLAUDE.md records walking into
// three times. It matters more now than it did: sendReport posts a crash over the network, and the obvious
// way to write that is to import storage.js, which would make the crash net depend on the app it reports on.
await runTest("error-boundary.jsx imports nothing but React", async () => {
  const src = fs.readFileSync(new URL("../error-boundary.jsx", import.meta.url), "utf8");
  const from = [...src.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const bare = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const all = [...from, ...bare];
  assert(all.length === 1 && all[0] === "react",
    `the crash net may import react and nothing else, found: ${JSON.stringify(all)}`);
  assert(!/\brequire\s*\(|\bawait\s+import\s*\(/.test(src), "and nothing dynamic either");
});

// Every jsdom test and tools/ui-harness build with no Supabase environment, so both defines are "". Without
// the guard, every caught render error in the suite POSTs at a relative URL - which jsdom answers in ways
// that are slow at best and noisy at worst.
await runTest("the reporter is inert when the build has no Supabase", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { calls.push(a); return Promise.resolve({ ok: true }); };
  try {
    mod.sendReport(new Error("no backend in a test build"), { componentStack: "    at App" });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert(calls.length === 0, `nothing was sent: ${JSON.stringify(calls).slice(0, 200)}`);
});

// It must also never be the thing that breaks a crash screen. A report built from a junk error, or thrown at
// by a hostile fetch, still has to return quietly.
await runTest("the reporter cannot throw, whatever it is handed", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new TypeError("fetch itself exploded"); };
  try {
    for (const [err, info] of [[new Error("x"), null], ["a string, not an Error", undefined],
                               [null, { componentStack: null }], [{ weird: true }, {}]]) {
      mod.sendReport(err, info);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  assert(true, "sendReport returned on every shape without throwing");
});

console.log("test-error-boundary.mjs done");
