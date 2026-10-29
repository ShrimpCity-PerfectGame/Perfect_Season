// The Android app's own behaviour (app-shell.mjs, entry-app.jsx): the hardware Back button and the share
// sheet. Both halves are here - the shell's routing on its own, with the native pieces faked, and then the
// game in jsdom answering a Back press the way the shell asks it to. Nothing here needs a device, and the
// website is checked too: it must never hear a Back event it wasn't built for.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, makeMockAuth, loadModule } from "./helpers.mjs";
import { BACK_EVENT, barStyleFor, followSystemBars, goBack, nativeShare } from "../app-shell.mjs";

// ---------- the shell on its own ----------

// A window just big enough for goBack: the event, the listeners, and a history that records back().
function fakeWindow({ handled = false } = {}) {
  const listeners = [];
  const win = {
    CustomEvent: class {
      constructor(type, opts = {}) { this.type = type; this.cancelable = !!opts.cancelable; this.defaultPrevented = false; }
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
    },
    addEventListener: (type, fn) => listeners.push([type, fn]),
    dispatchEvent: (e) => { for (const [type, fn] of listeners) if (type === e.type) fn(e); return !e.defaultPrevented; },
    history: { backs: 0, back() { this.backs++; } },
  };
  if (handled) win.addEventListener(BACK_EVENT, (e) => e.preventDefault());
  return win;
}

await runTest("Back asks the game first, then goes back, and only leaves the app with nothing left", async () => {
  let exits = 0;
  const exitApp = () => exits++;

  const taken = fakeWindow({ handled: true });
  assert(goBack({ canGoBack: true }, { win: taken, exitApp }) === "handled", "a game that answers Back keeps it");
  assert(taken.history.backs === 0 && exits === 0, "nothing else happens then");

  const spare = fakeWindow();
  assert(goBack({ canGoBack: true }, { win: spare, exitApp }) === "back", "an entry of its own goes back");
  assert(spare.history.backs === 1 && exits === 0, "back, and the app stays open");

  const last = fakeWindow();
  assert(goBack({ canGoBack: false }, { win: last, exitApp }) === "exit", "nothing left leaves the app");
  assert(last.history.backs === 0 && exits === 1, "the app exits exactly once");
});

await runTest("the share sheet: sharing passes the season on, closing it is an AbortError", async () => {
  const sent = [];
  const ok = nativeShare(async (options) => { sent.push(options); });
  await ok({ text: "Gridspin Unlimited 3-14" });
  assert(sent.length === 1 && sent[0].text === "Gridspin Unlimited 3-14", "the card reaches the sheet");
  assert(sent[0].dialogTitle === "Share", "the sheet gets a title even when the share has none");

  // What the game does with each of these is in perfect-season.jsx's doShare: an AbortError shows nothing,
  // anything else falls back to the clipboard. Reporting a dismissed sheet as a share would claim a season
  // had been shared that the player chose not to send.
  const cancelled = nativeShare(async () => { throw new Error("Share canceled"); });
  const abort = await cancelled({ text: "x" }).then(() => null, (e) => e);
  assert(abort && abort.name === "AbortError", `closing the sheet is an AbortError, got ${abort && abort.name}`);

  const broken = nativeShare(async () => { throw new Error("Must provide a URL or Message or files"); });
  const failure = await broken({ text: "x" }).then(() => null, (e) => e);
  assert(failure && failure.name !== "AbortError", "a real failure stays a failure, so the game copies instead");
});

await runTest("the system bars follow the screen they sit over", async () => {
  // Android's names read backwards: "DARK" is a dark screen, and it draws light icons on it.
  assert(barStyleFor("rgb(247, 244, 234)") === "LIGHT", "cream takes dark icons");
  assert(barStyleFor("rgb(16, 17, 20)") === "DARK", "the play screen's navy takes light ones");
  assert(barStyleFor("rgb(0, 0, 0)") === "DARK", "so does the Leaderboard's black");
  assert(barStyleFor("rgba(20, 22, 28, 1)") === "DARK", "however the browser writes the colour");
  assert(barStyleFor("") === "DEFAULT" && barStyleFor(null) === "DEFAULT", "an unreadable ground leaves the phone's own choice alone");

  // The root element the app puts its theme scope on, and a window that reports each scope's colour.
  const scopes = { ps: "rgb(247, 244, 234)", "ps dark": "rgb(16, 17, 20)", "ps night": "rgb(0, 0, 0)" };
  const root = { className: "ps", watchers: [] };
  const doc = { querySelector: (sel) => (sel === ".ps" ? root : null) };
  const view = {
    getComputedStyle: (el) => ({ backgroundColor: scopes[el.className] }),
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { root.watchers.push(this); } disconnect() { root.watchers = []; } },
    setTimeout: () => 0, clearTimeout: () => {},
  };
  const styles = [];
  const stop = followSystemBars((o) => styles.push(o.style), { doc, view });
  const scope = (className) => { root.className = className; for (const w of root.watchers) w.fn(); };
  scope("ps dark");
  scope("ps night"); // dark to black: different scopes, but the icons stay light, so the bars are left alone
  scope("ps night");
  scope("ps");
  assert(styles.join(",") === "LIGHT,DARK,LIGHT", `expected one call per change of ground, got ${styles.join(",")}`);
  stop();
  scope("ps dark");
  assert(styles.length === 3, "and nothing more once it stops watching");
});

// ---------- the game answering a Back press ----------

let app = null;
async function close() {
  if (!app) return;
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
// A fresh page with the rules already seen, so an open dialog is something this test opened.
async function open(url = "http://localhost/", auth = makeMockAuth()) {
  await close();
  setupDom(url);
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(4);
  return app.container;
}
// Back as the shell sends it, with a window that records what it would have done next.
async function back() {
  const { act } = await import("react-dom/test-utils");
  let exited = 0;
  const before = window.history.length;
  await act(async () => {
    const asked = new window.CustomEvent(BACK_EVENT, { cancelable: true });
    window.dispatchEvent(asked);
    if (!asked.defaultPrevented) {
      if (before > 1) window.history.back();
      else exited++;
    }
  });
  await flush(3);
  return { exited };
}
const tab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
const onTab = (c, label) => tab(c, label)?.getAttribute("aria-current") === "page";
const rules = (c) => c.querySelector('[role="dialog"][aria-labelledby="howto-title"]');

await runTest("Back closes the rules before it touches the screen", async () => {
  const c = await open();
  await click(tab(c, "Leaderboard"));
  await flush(2);
  await click(findButtonByText(c, "How to play"));
  await flush(2);
  assert(rules(c), "the rules are open");
  const { exited } = await back();
  assert(!rules(c), "Back closes them");
  assert(!exited, "and doesn't leave the app");
  assert(onTab(c, "Leaderboard"), "the screen under them is still there");
});

await runTest("Back from any other screen returns to Modes, and only Modes leaves the app", async () => {
  const c = await open();
  for (const label of ["Leaderboard", "Players", "Stats"]) {
    await click(tab(c, label));
    await flush(2);
    assert(onTab(c, label), `on ${label}`);
    const { exited } = await back();
    assert(onTab(c, "Modes"), `Back from ${label} returns to Modes, got: ${text(c).slice(0, 80)}`);
    assert(!exited, `Back from ${label} doesn't leave the app`);
  }
  const { exited } = await back();
  assert(exited === 1, "Back from Modes leaves the app");
});

// Where the web view is in its history, which jsdom does not say. Capacitor's canGoBack is "is there an entry
// behind this one", and history.length cannot answer that once Back has walked down past entries that are
// still there in front - which is what a phantom stop is made of. So the position is kept here, the way a
// browser keeps it: a push moves up and drops anything in front, back and go move within what exists.
function trackPosition() {
  const h = window.history;
  let at = 0;
  let length = h.length;
  const push = h.pushState.bind(h), back = h.back.bind(h), go = h.go.bind(h);
  h.pushState = (...args) => { push(...args); at++; length = at + 1; };
  h.back = () => { if (at > 0) at--; back(); };
  h.go = (n) => { if (at + n >= 0 && at + n < length) at += n; go(n); };
  return { at: () => at, canGoBack: () => at > 0 };
}
// Back as the shell sends it, with canGoBack from that position rather than from history.length.
async function backAt(position) {
  const { act } = await import("react-dom/test-utils");
  let exited = 0;
  await act(async () => {
    const asked = new window.CustomEvent(BACK_EVENT, { cancelable: true });
    window.dispatchEvent(asked);
    if (!asked.defaultPrevented) {
      if (position.canGoBack()) window.history.back();
      else exited++;
    }
  });
  await flush(4);
  return { exited };
}
async function until(cond, what) {
  for (let i = 0; i < 40; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}

await runTest("Back to Modes goes past the screens the app pushed, so the next Back leaves the app", async () => {
  const auth = makeMockAuth();
  await auth.auth.signUp({ email: "walker@example.com", password: "Password1", options: { data: { username: "walker" } } });
  const c = await open("http://localhost/", auth);
  const position = trackPosition();
  const profile = () => c.querySelector("section.profile");
  const shop = () => c.querySelector("section.shop");
  // Your profile, the Shop from its card, then the Leaderboard tab: each one pushes an entry, the last because
  // it leaves a screen that owns one. Three entries above Modes.
  await click(c.querySelector(".whoami"));
  await until(() => profile()?.dataset.username === "walker", "your profile");
  await click([...profile().querySelectorAll("button")].find((b) => b.textContent.trim() === "Shop"));
  await until(() => shop(), "the shop from your card");
  await click(tab(c, "Leaderboard"));
  await until(() => onTab(c, "Leaderboard"), "the Leaderboard");
  assert(position.at() === 3, `three entries pushed above Modes, at ${position.at()}`);

  let { exited } = await backAt(position);
  await until(() => onTab(c, "Modes"), () => `Modes, got: ${text(c).slice(0, 80)}`);
  assert(!exited && !shop(), "Back goes to Modes, and not by way of the Shop");
  assert(position.at() === 0, `and past every entry the app pushed, at ${position.at()}`);
  ({ exited } = await backAt(position));
  assert(exited === 1, `the next Back leaves the app, rather than walking into the Shop: ${text(c).slice(0, 80)}`);
});

await runTest("...and lands on Modes even when the page opened on another screen", async () => {
  // The entry the page opened in is where that Back arrives. In the app it is always Modes; opened on the
  // Leaderboard's own address it is not, and the press still meant Modes.
  const auth = makeMockAuth();
  await auth.auth.signUp({ email: "lander@example.com", password: "Password1", options: { data: { username: "lander" } } });
  const c = await open("http://localhost/leaderboard", auth);
  const position = trackPosition();
  await until(() => onTab(c, "Leaderboard"), "the Leaderboard it opened on");
  await click(c.querySelector(".whoami"));
  await until(() => c.querySelector("section.profile")?.dataset.username === "lander", "your profile");
  await click(tab(c, "Stats"));
  await until(() => onTab(c, "Stats"), "Stats");
  assert(position.at() === 2, `two entries above the one it opened in, at ${position.at()}`);
  const { exited } = await backAt(position);
  await until(() => onTab(c, "Modes"), () => `Modes, got: ${text(c).slice(0, 80)}`);
  assert(!exited && window.location.pathname === "/", `on Modes at its own address, got ${window.location.pathname}`);
  assert(window.history.state?.view === "home", `and the entry says so: ${JSON.stringify(window.history.state)}`);
});

await runTest("a profile takes Back through the entry it pushed, not straight to Modes", async () => {
  const c = await open("http://localhost/u/laddertest");
  await flush(4);
  assert(window.location.pathname === "/u/laddertest", "the profile is on screen at its own address");
  // Not cancelled: the shell's own history.back() is what returns to where the profile was opened from,
  // so Forward still works and the page comes back where it was left.
  const asked = new window.CustomEvent(BACK_EVENT, { cancelable: true });
  window.dispatchEvent(asked);
  assert(!asked.defaultPrevented, "the game leaves a profile to Back itself");
});

await runTest("Back closes a report sheet before the profile it opened over", async () => {
  const auth = makeMockAuth();
  auth._profiles.set("bob-id", { id: "bob-id", username: "bob", runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] });
  // Signed in already, the way a player who signed in yesterday opens the app - reporting is for accounts.
  await auth.auth.signUp({ email: "reporter@example.com", password: "Password1", options: { data: { username: "reporter" } } });
  const c = await open("http://localhost/u/bob", auth);
  await flush(4);

  await click(findButtonByText(c, "Report"));
  await flush(2);
  const sheet = () => c.querySelector('.md-sheet[role="dialog"]');
  assert(sheet(), `the report sheet, got: ${text(c).slice(0, 200)}`);

  const { exited } = await back();
  assert(!sheet(), "Back closes the sheet");
  assert(!exited, "and doesn't leave the app");
  assert(window.location.pathname === "/u/bob", `bob's profile is still underneath, got ${window.location.pathname}`);
});

// Escape reads the same register Back does, so it closes only the dialog on top. Three dialogs used to
// add their own window listener, which meant every one of them fired on every press: a first-run device
// landing on somebody's profile has the rules up, and tapping Report puts the sheet over them - one
// Escape closed both, the sheet they meant and the rules underneath they had not read yet.
await runTest("Escape closes the dialog on top, not every dialog at once", async () => {
  // Node cannot import .jsx directly; loadModule bundles it the way every other screen test does.
  const { useCloseOnBack, closeTopDialog } = await loadModule("ui-common.jsx");
  const React = await import("react");
  const { act } = await import("react-dom/test-utils");
  const { createRoot } = await import("react-dom/client");
  setupDom();

  const closed = [];
  const Dialog = ({ name }) => { useCloseOnBack(() => closed.push(name)); return null; };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  // The rules open first, then the report sheet over them.
  await act(async () => { root.render(React.createElement(React.Fragment, null,
    React.createElement(Dialog, { key: "rules", name: "rules" }),
    React.createElement(Dialog, { key: "sheet", name: "sheet" }))); });

  await act(async () => { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })); });
  assert(closed.join(",") === "sheet", `only the one on top closed, got: ${closed.join(",") || "(none)"}`);

  // And Back agrees with it, through the same register.
  assert(closeTopDialog() === true, "Back still finds a dialog to close");
  await act(async () => { root.unmount(); });
});

await close();
