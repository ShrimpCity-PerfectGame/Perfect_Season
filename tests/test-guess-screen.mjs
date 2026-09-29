// Guess the Player's screen in the real app, in jsdom on the mock: the Mini games tile, both variants, guesses
// typed and clicked, the colours, the end screen, the boards, resume, and what a guest is refused.
//
// test-guess-logic.mjs drives the rules and test-guess-edge.mjs the function. This one drives the BUTTONS, which
// is where the wiring lives and the only place a screen that renders nothing would show up. Two things only this
// file can hold:
//
//   - that every cell says its state IN WORDS. The colour is the whole of the signal for everyone else, and
//     colour may never be the only thing that means something (CLAUDE.md, v1.18.0's accessibility pass).
//   - that the screen's own refusal map covers every reason the Edge Function can answer with. A reason with no
//     line of its own reads as "check your connection" - forever, for a rule rather than a fault.
import {
  setupDom, makeStorage, mount, flush, click, text, findButtonByText,
  assert, runTest, waitForCrypto, makeMockAuth, loadModule, type,
} from "./helpers.mjs";
import { readFileSync } from "node:fs";
import {
  initGuessData, GUESS_PLAYERS, GUESS_TRIES, GUESS_COLUMNS, guessAnswerFor, guessAnswerForSeed, guessPlayer,
} from "../guess-logic.mjs";
import { GUESS_POOL_URL } from "../guess-pool.mjs";
import { GUESS_REFUSALS } from "../storage-guess.js";
// Node cannot import .jsx, so the screen module comes through the same bundler helper the other screen tests use.
const { GUESS_WIP, GUESS_HEADS } = await loadModule("guess.jsx");

// Deliberately NOT initialised here, unlike every other data file in the tests: the pool is fetched when the
// game opens (guess-pool.mjs), so test 0 drives the real loader through a stubbed fetch - which is also what
// leaves the pool in place for every test after it.
const POOL_TEXT = readFileSync(new URL("../data/guess-pool.json", import.meta.url), "utf8");
const servePool = () => { globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(POOL_TEXT), url }); };
const refusePool = () => { globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); }; };

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

let { container } = await mount();
await flush();

const gp = () => container.querySelector(".gp");
const view = () => gp()?.dataset.view;
// The Account tab can carry a notice panel above the form (that is what onNeedsAccount puts there), so the form
// is found by the fact that it HAS the fields rather than by being the first .panel on screen.
const panel = () => [...container.querySelectorAll(".panel")].find((p) => p.querySelector("input"))
  || container.querySelector(".panel");
const submit = (label) => [...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes(label));
const runs = () => window.__ps_supabase__._guess.runs();
const today = () => new Date().toISOString().slice(0, 10);
const variantTiles = () => [...gp().querySelectorAll(".modes .mode")];

async function openNav(label) {
  const tab = [...container.querySelectorAll("nav button, .nav button, button")].find((b) => b.textContent.trim() === label);
  assert(tab, `a "${label}" tab is on screen`);
  await click(tab);
  await flush();
}
async function openAccount() {
  await click(findButtonByText(container, "Account") || findButtonByText(container, "Profile"));
  await flush();
}
async function signUp(email, username) {
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
  await flush();
}
// The tile as the Mini games screen shows it - captured before the click, because once the mode is open the words
// "Guess the Player" belong to the screen itself.
async function guessTile() {
  await openNav("Modes");
  const mini = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Mini games"));
  assert(mini, "Modes has a Mini games tile");
  await click(mini);
  await flush();
  const tile = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Guess the Player"));
  assert(tile, "the Mini games screen has a Guess the Player tile");
  return tile;
}
async function openGuess() {
  const tile = await guessTile();
  await click(tile);
  await flush();
  return tile;
}

// ---------- playing by hand ----------
const seedOnScreen = () => gp().querySelector(".codechip code")?.textContent;
const gridRows = () => [...gp().querySelectorAll(".gp-grid tbody tr")];
const cellsOf = (tr) => [...tr.querySelectorAll(".gp-cell")];
const stateOf = (tr, col) => cellsOf(tr)[GUESS_COLUMNS.indexOf(col)].className.replace("gp-cell gp-c-", "");

// Types a name and clicks the player out of the list. The list shows position and draft class beside the name
// because the pool holds two Adrian Petersons - so the click is matched on all three, not on the name.
async function guessPlayerByName(p) {
  const input = gp().querySelector("#gp-q");
  assert(input, "the search box is on screen");
  await type(input, p.name);
  const hits = [...gp().querySelectorAll(".gp-hit")];
  const hit = hits.find((b) => b.querySelector(".gp-hn").textContent === p.name
    && b.querySelector(".gp-hm").textContent === `${p.pos} · ${p.draft}`);
  assert(hit, `${p.name} (${p.pos} ${p.draft}) is offered: ${hits.map((h) => h.textContent).join(" | ")}`);
  await click(hit);
  await flush();
  await flush();
}
// A game in progress is saved per DEVICE, not per account, so it outlives a sign-out - which is right (it is
// eight guesses, not a record) and is also why a test wanting the menu has to say so. Writing one by hand goes
// through the same shape sset leaves behind, a JSON string, or the screen reads nothing and resumes nothing.
const dropWip = async () => { await window.storage.delete(GUESS_WIP, false); };
const putWip = async (run) => { await window.storage.set(GUESS_WIP, JSON.stringify(run), false); };

// Somebody who is not the answer, and not already used by this game.
function someoneElse(answer, used = new Set(), pick = () => true) {
  const p = GUESS_PLAYERS.find((x) => x.id !== answer.id && !used.has(x.id) && pick(x));
  assert(p, "the pool holds a player to guess");
  used.add(p.id);
  return p;
}

await runTest("0. the pool is fetched when the game opens, and a failure says so rather than dealing nothing", async () => {
  // 195 KB of players is not in the bundle every visitor loads, so the game's first act is to go and get it.
  // What must never happen is the screen opening anyway: with no pool, every id resolves to null, the search box
  // offers nobody and a resumed game draws an empty grid - a screen that looks like a bug rather than a wait.
  await signUp("guess1@example.test", "guesser");
  assert(GUESS_PLAYERS.length === 0, "nothing has loaded the pool yet");
  refusePool();
  await openGuess();
  await flush();
  assert(view() === "failed", `a failed fetch says so: ${view()}`);
  assert(/Couldn't load the players/.test(gp().textContent), `and says what is missing: ${gp().textContent.slice(0, 80)}`);
  assert(!gp().querySelector(".modes"), "with no game on offer behind it");
  const again = findButtonByText(gp(), "Try again");
  assert(again, "and a retry, because a dropped fetch is the ordinary case");

  // The retry is a real retry: a failed load is forgotten rather than remembered as the answer.
  servePool();
  await click(again);
  await flush();
  await flush();
  assert(view() === "menu", `the game opens once the pool is in: ${view()}`);
  // Opening it again fetches nothing: the load is memoised, and a mini-game must not pull 195 KB per visit.
  let asked = 0;
  globalThis.fetch = async () => { asked++; throw new TypeError("should not be called"); };
  await openGuess();
  assert(view() === "menu", "the second opening needs no fetch");
  assert(asked === 0, `and made none: ${asked}`);
  assert(GUESS_POOL_URL === "/data/guess-pool.json", "served from the site root, so a challenge link's address reaches it too");

  // And now this file's own copy, which is a DIFFERENT module instance from the app's: the app under test is
  // bundled into build/test-component.mjs, so it holds its own guess-logic.mjs. The screen's pool was loaded
  // above through the stub; these are the answers the tests below compare against.
  initGuessData(JSON.parse(POOL_TEXT));
  assert(GUESS_PLAYERS.length > 120, `the test's own copy is in too: ${GUESS_PLAYERS.length}`);
});

await runTest("1. the Mini games tile opens the game, and the menu says how it is played", async () => {
  const tile = await openGuess();
  assert(tile.textContent.includes(String(GUESS_TRIES)), `the tile names the number of guesses: ${tile.textContent}`);
  assert(gp(), "the screen renders");
  assert(view() === "menu", `it opens on the menu: ${view()}`);
  assert(container.querySelector("h1.vh")?.textContent === "Guess the Player",
    "and it names itself for a screen reader, since the design shows no heading");
  const said = text(container);
  for (const word of ["team", "division", "position", "draft class", "number"]) {
    assert(said.toLowerCase().includes(word), `the five columns are explained: ${word}`);
  }
  const modes = variantTiles().map((b) => b.textContent);
  assert(modes.length === 2 && modes[0].includes("Daily") && modes[1].includes("Practice"),
    `both variants are offered: ${JSON.stringify(modes)}`);
});

await runTest("2. a practice game is won by typing a name, and recorded as solved", async () => {
  await openGuess();
  await click(variantTiles()[1]);
  await flush();
  assert(view() === "play", `Practice deals a game: ${view()}`);
  assert(!gp().querySelector(".gp-difficulty"), "and does not say how hard it is while it is being played");
  const code = seedOnScreen();
  assert(/^[A-Z0-9]{8}$/.test(code || ""), `it shows the code the game was dealt from: ${code}`);
  const answer = guessAnswerForSeed(code);
  assert(gp().textContent.includes(`${GUESS_TRIES} guesses left`), `it counts the guesses left: ${gp().textContent.slice(0, 80)}`);
  assert(!gridRows().length, "and shows no rows before anything is guessed");

  const wrong = someoneElse(answer);
  await guessPlayerByName(wrong);
  assert(gridRows().length === 1, `the guess appears as a row: ${gridRows().length}`);
  assert(cellsOf(gridRows()[0]).length === GUESS_COLUMNS.length, "with one cell per column");
  assert(gp().textContent.includes(`${GUESS_TRIES - 1} guesses left`), "and one fewer guess left");
  assert(gp().querySelector("#gp-q").value === "", "the box empties itself, ready for the next name");
  // Nothing is recorded until the game is over - a game in progress is a snapshot, not a run.
  assert(runs().length === 0, `nothing is recorded mid-game: ${runs().length}`);

  const before = runs().length;
  await guessPlayerByName(answer);
  assert(view() === "done", `guessing the answer ends the game: ${view()}`);
  assert(gp().querySelector(".gp-score").textContent === "2", `and says it took two: ${gp().querySelector(".gp-score").textContent}`);
  assert(/Got it/.test(gp().querySelector(".gp-eyebrow").textContent), "the hero says it was got");
  assert(gp().textContent.includes(answer.name), `and names the player: ${answer.name}`);
  assert(gridRows().length === 2, "both guesses stay on screen");
  // How hard the day was, which only appears once it is over - before that it narrows the answer.
  const hard = gp().querySelector(".gp-difficulty");
  assert(hard && /Difficulty \d+\/100/.test(hard.textContent), `the end screen says how hard it was: ${hard?.textContent}`);
  assert(GUESS_COLUMNS.every((c) => stateOf(gridRows()[1], c) === "hit"), "the winning row is green the whole way across");

  const saved = runs();
  assert(saved.length === before + 1, `the game is recorded: ${saved.length}`);
  const r = saved[saved.length - 1];
  assert(r.solved === true && r.tries === 2, `as solved in two: ${JSON.stringify({ solved: r.solved, tries: r.tries })}`);
  assert(r.day === null && r.seed === code, `off the daily board, under its code: ${JSON.stringify({ day: r.day, seed: r.seed })}`);
  assert(r.username === "guesser", "under the account's own name");
  assert(r.answer === answer.id, "recording the player it was");
});

await runTest("3. every cell says its state in words, and a close one says which way to go", async () => {
  await dropWip();
  await openGuess();
  await click(variantTiles()[1]);
  await flush();
  const answer = guessAnswerForSeed(seedOnScreen());
  // A guess drafted two years before the answer: yellow, with an arrow saying the answer is later.
  const earlier = GUESS_PLAYERS.find((p) => p.id !== answer.id && p.draft === answer.draft - 2);
  const target = earlier || someoneElse(answer);
  await guessPlayerByName(target);
  const row = gridRows()[0];
  // Each of the five carries a sentence naming the column, the value and the state, not a colour.
  for (const col of GUESS_COLUMNS) {
    const cell = cellsOf(row)[GUESS_COLUMNS.indexOf(col)];
    const said = cell.querySelector(".vh")?.textContent || "";
    assert(said.includes(GUESS_HEADS[col]), `the ${col} cell names its column: "${said}"`);
    assert(/exact|close|no/.test(said), `and says its state in words: "${said}"`);
    assert(cell.querySelector('[aria-hidden="true"]'), "with the short printed form hidden from a reader");
  }
  if (earlier) {
    assert(stateOf(row, "draft") === "near", `two years out is close: ${stateOf(row, "draft")}`);
    const said = cellsOf(row)[GUESS_COLUMNS.indexOf("draft")].querySelector(".vh").textContent;
    assert(/close, higher/.test(said), `and the words say which way, not just the arrow: "${said}"`);
    assert(cellsOf(row)[GUESS_COLUMNS.indexOf("draft")].textContent.includes("↑"), "the arrow is drawn too");
  }
  assert(GUESS_COLUMNS.every((c) => ["hit", "near", "miss"].includes(stateOf(row, c))),
    `every cell is one of the three states: ${GUESS_COLUMNS.map((c) => stateOf(row, c)).join(",")}`);
});

await runTest(`4. a game that uses all ${GUESS_TRIES} ends on the answer, not on a win`, async () => {
  await dropWip();
  await openGuess();
  await click(variantTiles()[1]);
  await flush();
  const answer = guessAnswerForSeed(seedOnScreen());
  const used = new Set();
  const before = runs().length;
  for (let i = 0; i < GUESS_TRIES; i++) await guessPlayerByName(someoneElse(answer, used));
  assert(view() === "done", `the game ends when the guesses run out: ${view()}`);
  assert(gp().querySelector(".gp-score").textContent === "—", "no number, because it was not got");
  assert(/Missed/.test(gp().querySelector(".gp-eyebrow").textContent), "the hero says it was missed");
  assert(gp().textContent.includes(`not in ${GUESS_TRIES}`), "and how many it had");
  // The answer is the payoff of a lost game and has to be there.
  assert(gp().textContent.includes(answer.name), `it says who it was: ${answer.name}`);
  assert(gp().textContent.includes(`#${answer.number}`), "with the number, the column nobody ever gets");
  assert(gridRows().length === GUESS_TRIES, `all ${GUESS_TRIES} rows stay on screen: ${gridRows().length}`);
  const r = runs()[runs().length - 1];
  assert(runs().length === before + 1 && r.solved === false && r.tries === GUESS_TRIES,
    `a loss is recorded as one: ${JSON.stringify({ solved: r.solved, tries: r.tries })}`);
});

await runTest("5. the daily is one game, and coming back shows how it went", async () => {
  await dropWip();
  await openGuess();
  const answer = guessAnswerFor(today());
  await click(variantTiles()[0]);
  await flush();
  assert(view() === "play", `the daily deals: ${view()}`);
  assert(gp().textContent.includes(today()), "and says which day it is");
  assert(gp().textContent.includes("the same player for everyone"), "and that everyone has the same one");
  assert(!seedOnScreen(), "with no code, because a daily is not shareable as one");
  const used = new Set();
  await guessPlayerByName(someoneElse(answer, used));
  await guessPlayerByName(answer);
  assert(view() === "done", `it can be won: ${view()}`);
  const r = runs()[runs().length - 1];
  assert(r.day === today(), `and is filed under today: ${r.day}`);

  // Back out and in again: the tile says how it went and the daily is closed.
  const tile = await guessTile();
  assert(/Got it in 2/.test(tile.textContent), `the Mini games tile says how it went: ${tile.textContent}`);
  await click(tile);
  await flush();
  const daily = variantTiles()[0];
  assert(/Got it in 2/.test(daily.textContent), `so does the daily tile: ${daily.textContent}`);
  assert(/See how it went/.test(daily.textContent), "and it offers the result rather than a game");
  const before = runs().length;
  await click(daily);
  await flush();
  assert(view() === "done", `tapping it shows the result: ${view()}`);
  assert(gp().textContent.includes(answer.name), "including the player it was");
  assert(gridRows().length === 2, "and the guesses that were made, re-coloured from the saved ids");
  assert(runs().length === before, "nothing is recorded a second time");
});

await runTest("6. a second daily is refused, and the player is told rather than shown a saved run", async () => {
  // The path a real player reaches this by: a tab left open on a daily that was finished somewhere else. The
  // snapshot is what gets them back onto a board, so the 409 has to reach the screen - a result panel for a game
  // nothing recorded is the worst option available.
  const day = today();
  const answer = guessAnswerFor(day);
  const wrong = someoneElse(answer);
  await putWip({ variant: "daily", day, seed: null, guesses: [] });
  await openGuess();
  assert(view() === "play", `the saved daily resumes: ${view()}`);
  const before = runs().length;
  await guessPlayerByName(wrong);
  await guessPlayerByName(answer);
  assert(view() === "done", "the game plays out");
  assert(runs().length === before, `and nothing is recorded twice: ${runs().length}`);
  assert(/already recorded/.test(gp().textContent), `the player is told why: ${gp().querySelector(".gp-err")?.textContent}`);
});

await runTest("6b. a refused game still shows the result the game actually had", async () => {
  // The result on screen when a save is refused is the LOCAL one, and nothing ever replaces it - so it is the
  // only screen in the game whose numbers are the client's own. A stale tab losing a daily and being told "Got
  // it" is the failure this guards: the local verdict comes from replayGuessGame, the same function the server
  // replays with, so it cannot be kinder than the truth.
  const day = today();
  const answer = guessAnswerFor(day);
  await putWip({ variant: "daily", day, seed: null, guesses: [] });
  await openGuess();
  assert(view() === "play", `the saved daily resumes: ${view()}`);
  const used = new Set();
  const before = runs().length;
  for (let i = 0; i < GUESS_TRIES; i++) await guessPlayerByName(someoneElse(answer, used));
  assert(view() === "done", "the game plays out");
  assert(runs().length === before, "the save is refused, as today's is already recorded");
  assert(/already recorded/.test(gp().textContent), "and says so");
  assert(/Missed/.test(gp().querySelector(".gp-eyebrow").textContent),
    `a lost game is still shown as lost: ${gp().querySelector(".gp-eyebrow").textContent}`);
  assert(gp().querySelector(".gp-score").textContent === "—", "with no number of guesses to be proud of");
});

await runTest("7. a half-finished practice game resumes, and a stale daily is thrown away", async () => {
  await dropWip();
  await openGuess();
  await click(variantTiles()[1]);
  await flush();
  const code = seedOnScreen();
  const answer = guessAnswerForSeed(code);
  await guessPlayerByName(someoneElse(answer));
  assert(gridRows().length === 1, "one guess in");
  // Leave the way a player leaves - the Leave button, not a reload.
  await click(findButtonByText(gp(), "Leave"));
  await flush();
  assert(!gp() || view() === "menu", "the screen is left");
  await openGuess();
  assert(view() === "play", `and the game is still there: ${view()}`);
  assert(seedOnScreen() === code, `the same game, not a new one: ${seedOnScreen()} vs ${code}`);
  assert(gridRows().length === 1, `with the guess that was made: ${gridRows().length}`);

  // A daily from another day is not resumable - it would be playing yesterday's player for today's board.
  await putWip({ variant: "daily", day: "2020-01-01", seed: null, guesses: [] });
  await openGuess();
  assert(view() === "menu", `yesterday's daily is dropped rather than resumed: ${view()}`);
  assert(await window.storage.get(GUESS_WIP, false) == null
    || !(await window.storage.get(GUESS_WIP, false))?.guesses, "and the snapshot is cleared");
});

await runTest("8. the boards render, today's and all time, with a guest chipped rather than linked", async () => {
  await openGuess();
  const tabs = [...gp().querySelectorAll('[role="tab"]')];
  assert(tabs.length === 2, `two boards: ${tabs.length}`);
  assert(tabs[0].getAttribute("aria-selected") === "true", "today's opens first");
  const open = () => [...gp().querySelectorAll('[role="tabpanel"]')].find((p) => !p.hidden);
  assert(open(), "one panel is open and the other hidden, so neither tab points at nothing");
  assert(open().querySelector(".gp-lb"), "today's board is a table");
  assert(open().textContent.includes("guesser"), `and this account is on it: ${open().textContent.slice(0, 120)}`);
  await click(tabs[1]);
  await flush();
  assert(tabs[1].getAttribute("aria-selected") === "true", "All time opens");
  const head = [...open().querySelectorAll(".gp-lb th")].map((h) => h.textContent);
  assert(head.includes("Solved") && head.includes("Average"), `it counts dailies solved: ${JSON.stringify(head)}`);
  assert(/Most dailies solved/.test(open().querySelector("caption").textContent), "and says so");
});

await runTest("9. a guest plays practice and is refused the daily, with a reason", async () => {
  await dropWip();
  await auth.auth.signOut();
  await flush();
  await auth.auth.signInAnonymously();   // a guest account, the way finishing a season makes one
  await flush();
  await openGuess();
  const [daily, practice] = variantTiles();
  assert(!daily.disabled, "the daily tile is still a live control");
  assert(/needs an account/.test(daily.textContent), `and says why: ${daily.textContent}`);
  const before = runs().length;
  await click(daily);
  await flush();
  assert(!gp() || view() !== "play", "a guest tapping the daily never reaches a game");
  assert(runs().length === before, "and nothing was recorded");
  assert(/account/i.test(text(container)), "they are taken somewhere that talks about an account");

  await openGuess();
  await click(variantTiles()[1]);
  await flush();
  assert(view() === "play", "Practice is open to them");
  const answer = guessAnswerForSeed(seedOnScreen());
  await guessPlayerByName(answer);
  assert(view() === "done", "and plays out");
  const r = runs()[runs().length - 1];
  assert(runs().length === before + 1 && r.guest === true, `recorded with the guest flag: ${JSON.stringify({ guest: r.guest })}`);
});

await runTest("10. a signed-out visitor reads the boards and is asked to sign in", async () => {
  await dropWip();
  await auth.auth.signOut();
  await flush();
  await openGuess();
  const [daily, practice] = variantTiles();
  assert(/Sign in to play/.test(daily.textContent), `the daily asks for an account: ${daily.textContent}`);
  assert(/Sign in to play/.test(practice.textContent), `and so does Practice: ${practice.textContent}`);
  const before = runs().length;
  await click(practice);
  await flush();
  assert(!gp() || view() !== "play", "neither deals a game");
  assert(runs().length === before, "and nothing is recorded");
});

await runTest("11. every reason the function can answer with has a line of its own", async () => {
  // The whole point of the map: a reason that reaches the app unmapped is read as "network" and shown as "check
  // your connection" - forever, for a rule rather than a fault.
  const fnSource = readFileSync(new URL("../supabase/functions/submit-guess/index.ts", import.meta.url), "utf8");
  const fromFn = [...fnSource.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const missing = [...new Set(fromFn)].filter((r) => !GUESS_REFUSALS.includes(r));
  assert(missing.length === 0, `every reason the function answers with is mapped: missing ${JSON.stringify(missing)}`);
  // And every replayGuessGame reason, which the function passes straight through.
  const logicSource = readFileSync(new URL("../guess-logic.mjs", import.meta.url), "utf8");
  const fromLogic = [...logicSource.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const missingLogic = [...new Set(fromLogic)].filter((r) => !GUESS_REFUSALS.includes(r));
  assert(missingLogic.length === 0, `every rule the replay can break is mapped: missing ${JSON.stringify(missingLogic)}`);
  // The wording: the ones a player can actually cause say something of their own, and none blames the connection.
  const source = readFileSync(new URL("../guess.jsx", import.meta.url), "utf8");
  for (const r of ["duplicate", "guest_daily", "wrong_day", "bad_code"]) {
    assert(source.includes(`case "${r}"`), `${r} has a line of its own`);
  }
  assert(/default:/.test(source), "and anything else falls to a line that names the reason rather than the network");
});

await runTest("12. the pool the screen offers is the pool the server checks against", async () => {
  // A search that offered a player the Edge Function's pool does not hold would be a game that cannot be handed
  // in - and the two are the same file, so this holds them to it rather than trusting that they are.
  await dropWip();
  await signUp("guess2@example.test", "searcher");
  await openGuess();
  await click(variantTiles()[1]);
  await flush();
  const box = () => gp().querySelector("#gp-q");
  await type(box(), "smith");
  const offered = [...gp().querySelectorAll(".gp-hit .gp-hn")].map((n) => n.textContent);
  assert(offered.length > 0, "a common name offers somebody");
  assert(offered.length <= 8, `and never paints the whole pool: ${offered.length}`);
  for (const name of offered) {
    assert(GUESS_PLAYERS.some((p) => p.name === name), `${name} is in the shared pool`);
  }
  // Two letters is the floor, so a one-letter query does not walk 4,637 rows on every keystroke.
  await type(box(), "s");
  assert(gp().querySelectorAll(".gp-hit").length === 0, "one letter offers nothing");
  await type(box(), "Zzzzzz");
  assert(gp().querySelectorAll(".gp-hit").length === 0, "and a name nobody has offers nothing");
  assert(/playing this season/.test(gp().textContent), "with a line saying which players the game holds");
  // Every id the screen can hand in resolves in the same module the function replays with.
  for (const p of GUESS_PLAYERS.slice(0, 50)) assert(guessPlayer(p.id) === p, `${p.id} resolves`);
});

console.log("test-guess-screen.mjs done");
