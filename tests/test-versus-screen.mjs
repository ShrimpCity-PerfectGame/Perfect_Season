// The 1v1 screens in the real app (VERSUS.md 9), in jsdom on the mock: the Modes tile, the lobby and its link,
// a draft where the board is what the server says it is, a powerup spent by clicking it, and the result.
//
// The other 1v1 suites drive the rules and the client functions. This one drives the buttons - which is where
// the wiring lives, and the only place a screen that renders nothing would show up.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, clickMode,
  assert, runTest, waitForCrypto, makeMockAuth,
} from "./helpers.mjs";
import { replayMatch, optionId, VERSUS_SLOTS } from "../versus-logic.mjs";

setupDom();
// This screen is driven by a Realtime subscription: a change to the match arrives, the screen re-reads, and
// React updates outside whatever act() the click was wrapped in. That is the thing being tested, not a mistake,
// and the warning it prints would otherwise bury every assertion in the file.
const realError = console.error;
console.error = (...args) => { if (!/not wrapped in act/.test(String(args[0] || ""))) realError(...args); };

window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

let { container, reactRoot } = await mount();
await flush();

const panel = () => container.querySelector(".panel");
const submit = (label) => [...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes(label));
async function signUp(email, username) {
  // Always from a clean slate: a guest's Account tab is a login rather than the signup panel, so getting there
  // by clicking depends on who was signed in last.
  await auth.auth.signOut();
  await flush();
  await openAccount();
  const create = findButtonByText(panel(), "Create account");
  if (create?.hasAttribute("role")) { await click(create); await flush(); }
  const [e, u, p, p2] = [...panel().querySelectorAll("input")];
  await type(e, email);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click(submit("Create account"));
  await waitForCrypto();
}
const versus = () => container.querySelector(".versus");
let matchCode = null; // the match tests three and four share
async function openMatch(email, code) {
  await signIn(email);
  window.history.pushState({ ps: "view", view: "versus", code }, "", `/vs/${code}`);
  window.dispatchEvent(new window.PopStateEvent("popstate", { state: { ps: "view", view: "versus", code } }));
  await flush();
  await flush();
}
const goHome = async () => { await click(findButtonByText(container, "Modes")); await flush(); };
// The tab is "Account" signed out and "Profile" signed in, so a test that has to get there says which it means
// by asking for either.
async function signIn(email) {
  await auth.auth.signOut();
  await flush();
  await auth.auth.signInWithPassword({ email, password: "Password1" });
  await flush();
}
async function openAccount() {
  await click(findButtonByText(container, "Account") || findButtonByText(container, "Profile"));
  await flush();
}

await runTest("the Modes tile opens a lobby with a link to send", async () => {
  await signUp("alpha@x.test", "alpha");
  await goHome();
  await clickMode(container, "1v1");
  await flush();
  assert(versus(), "the 1v1 screen is on");
  assert(versus().dataset.view === "lobby", `starting at the lobby, got ${versus().dataset.view}`);

  await click(findButtonByText(container, "Open a lobby"));
  await flush();
  const code = versus().dataset.code;
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(code || ""), `a lobby with a code, got ${JSON.stringify(code)}`);
  assert(text(container).includes(`/vs/${code}`), "and the link to send is on screen");
  assert(findButtonByText(container, "Copy link"), "with a button to copy it");
  assert(text(container).includes("Waiting for an opponent"), "and says what it is waiting for");
  // The address is the link, so it survives a reload and can be copied out of the bar.
  assert(window.location.pathname === `/vs/${code}`, `the address is the invite, got ${window.location.pathname}`);
});

await runTest("a guest is told to sign in rather than shown a lobby", async () => {
  await openAccount();
  await click(findButtonByText(container, "Log out"));
  await flush();
  await auth.auth.signInAnonymously();
  await flush();
  await goHome();
  const tile = [...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "1v1")?.closest("button");
  assert(tile, "the tile is still there for a guest");
  assert(tile.textContent.includes("Sign in to play"), `and says so: ${tile.textContent.slice(0, 120)}`);
  await click(tile);
  await flush();
  assert(!versus() || versus().dataset.view !== "draft", "and a guest never reaches a draft");
});

await runTest("the opponent's screen shows the same board, and a pick lands on it", async () => {
  // Two accounts, one browser: the host opens the lobby, then the opponent signs in and takes the link - which
  // is exactly what happens on two machines, minus the machines.
  await signUp("beta@x.test", "beta");
  await goHome();
  await clickMode(container, "1v1");
  await flush();
  await click(findButtonByText(container, "Open a lobby"));
  await flush();
  const code = versus().dataset.code;
  matchCode = code;

  // The other player takes it. The app reads a /vs/ address as an invite.
  await signUp("gamma@x.test", "gamma");
  await flush();
  const joined = await auth.rpc("join_match", { p_code: code });
  assert(!joined.data.error, `the opponent joined: ${JSON.stringify(joined.data.error)}`);

  // Back to the host's screen, by the match's own address - which is also a player reopening their own draft.
  await openMatch("beta@x.test", code);

  assert(versus()?.dataset.view === "draft", `the draft is on screen, got ${versus()?.dataset.view}`);
  const state = replayMatch({ code, picks: [], respins: [], dips: [], swaps: [] });
  assert(container.querySelector(".vs-board")?.dataset.board === state.boardKey,
    `showing the board the server dealt (${state.boardKey}), got ${container.querySelector(".vs-board")?.dataset.board}`);

  // Both rosters are on screen, empty, and the slots are named in letters rather than by colour alone.
  const slots = [...container.querySelectorAll('.vs-roster[data-side="host"] li')].map((li) => li.dataset.slot);
  assert(JSON.stringify(slots) === JSON.stringify(VERSUS_SLOTS), `eight slots in order, got ${slots.join(",")}`);
  assert([...container.querySelectorAll('.vs-roster[data-side="host"] li')].every((li) => li.dataset.filled === "0"), "nothing filled yet");

  // beta is the host, and the host leads board one - so this screen is the one on the clock.
  assert(state.turn.side === "host", "the host leads the first board");
  const options = [...container.querySelectorAll(".vs-opt")];
  assert(options.length > 10, `the board's options are on screen, got ${options.length}`);
  const first = options.find((b) => !b.disabled);
  assert(first, "an option is takeable");
  const took = first.dataset.opt;
  await click(first);
  await flush();
  await flush();
  const after = auth._versus._replay(code);
  assert(after.taken.has(took), `the pick reached the match: ${took}`);
  assert(container.querySelector(`.vs-opt[data-opt="${CSS_escape(took)}"]`)?.dataset.taken === "1",
    "and the board now shows it as taken");
  // And it landed in a slot on the host's side, not the opponent's.
  const filled = [...container.querySelectorAll('.vs-roster[data-side="host"] li')].filter((li) => li.dataset.filled === "1");
  assert(filled.length === 1, `one slot filled, got ${filled.length}`);
  assert([...container.querySelectorAll('.vs-roster[data-side="guest"] li')].every((li) => li.dataset.filled === "0"),
    "and nothing on the opponent's");
});

// jsdom has CSS.escape, but the attribute values here are simple enough to quote directly.
function CSS_escape(v) { return String(v).replace(/"/g, '\\"'); }

await runTest("the follower spends a re-spin, and walks away to a board of their own", async () => {
  // The host has picked, so it is the opponent's turn - and a re-spin spent now is theirs alone (VERSUS.md 7),
  // which is the half of the rule that is easiest to get wrong and the only one visible on screen.
  const code = matchCode;
  await openMatch("gamma@x.test", code);
  assert(versus()?.dataset.view === "draft", `the opponent is in the draft, got ${versus()?.dataset.view}`);

  const before = auth._versus._replay(code);
  assert(before.turn.side === "guest", `it is the opponent's turn, got ${before.turn.side}`);
  const shared = before.boards[0].key;
  assert(container.querySelector(".vs-board").dataset.board === shared, "looking at the board the host picked from");

  const respin = findButtonByText(container, "Re-spin era");
  assert(respin && !respin.disabled, "the re-spin is on screen and takeable");
  await click(respin);
  await flush();
  await flush();

  const after = auth._versus._replay(code);
  assert(after.boards[0].key === shared, "the host keeps the board he picked from");
  assert(after.boards[0].followKey !== shared, `and the opponent has one of their own: ${after.boards[0].followKey}`);
  assert(container.querySelector(".vs-board").dataset.board === after.boards[0].followKey,
    "which is what their screen now shows");
  assert(auth._versus._matches.get(code).respins.length === 1, "the match recorded it");
  assert(before.pickNo === after.pickNo, "and it cost no pick");
  assert(findButtonByText(container, "Re-spin era").disabled, "with none of that kind left");
});

await runTest("the 1v1 board shows the records, apart from every other board", async () => {
  // Records as a finished match leaves them.
  const rows = [...auth._profiles.values()];
  const beta = rows.find((p) => p.username === "beta");
  const gamma = rows.find((p) => p.username === "gamma");
  beta.pvp_wins = 2; beta.pvp_losses = 0;
  gamma.pvp_wins = 0; gamma.pvp_losses = 2;

  await click(findButtonByText(container, "Leaderboard"));
  await flush();
  await flush();
  const heads = [...container.querySelectorAll("h2")].map((h) => h.textContent);
  assert(heads.includes("1v1"), `the 1v1 board is on the Leaderboard: ${JSON.stringify(heads)}`);

  const board = [...container.querySelectorAll("table.lb")].find((t) => t.textContent.includes("2–0"));
  assert(board, `with the records on it: ${text(container).slice(0, 200)}`);
  const first = board.querySelector("tbody tr");
  assert(first.textContent.includes("beta") && first.textContent.includes("2"), `best record first: ${first.textContent}`);
  // And nothing about it moved the career record, which is the line VERSUS.md 1 draws.
  assert(!beta.wins && !beta.champs, "a 1v1 win is not a season win");
});

// The draft keeps a clock ticking and a Realtime channel open, both of which would hold the process open
// after the last assertion - so the screen comes down the way a player leaving it would take it down.
reactRoot.unmount();
console.log("test-versus-screen.mjs done");
