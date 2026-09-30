// Century's screen in the real app, in jsdom on the mock: the Modes tile, the two variants, seven picks made by
// clicking, the re-spin, the result, the boards, and what a guest is refused.
//
// test-century-logic.mjs drives the rules and test-century-edge.mjs the function. This one drives the BUTTONS,
// which is where the wiring lives and the only place a screen that renders nothing would show up. It also holds
// two things no other file can:
//
//   - that the screen's own refusal map covers every reason the Edge Function can answer with. A reason with no
//     line reads as "check your connection", forever, for a rule rather than a fault - the exact failure
//     PROFILES.md records for guest codes.
//   - that a pick's legality is asked through ONE function, so the board's disabled state and its click handler
//     cannot disagree. CLAUDE.md records the cost of getting that wrong: the GM salary cap was enforced on one of
//     the draft screen's two doors and not the other, for three releases.
import {
  setupDom, makeStorage, mount, flush, click, text, findButtonByText, clickMode,
  assert, runTest, waitForCrypto, makeMockAuth, loadModule, loadAppModule, type,
} from "./helpers.mjs";
import { readFileSync } from "node:fs";
import {
  initCenturyData, CENTURY_SLOTS, CENTURY_GOAL, CENTURY_BOARDS, centuryPlan, centuryRespinTeam,
  centuryFits, centuryDailySeed, centuryCeiling,
} from "../century-logic.mjs";
import { TEAMS } from "../game-logic.mjs";
const { parseChallengeLink } = await loadAppModule();
// Node cannot import .jsx, so the screen module comes through the same bundler helper the other screen tests use.
const { centuryBlock, CENTURY_SLOT_LABEL } = await loadModule("century.jsx");
import { CENTURY_REFUSALS } from "../storage-century.js";

initCenturyData(JSON.parse(readFileSync(new URL("../data/season-2025.json", import.meta.url), "utf8")));

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

let { container } = await mount();
await flush();

const ce = () => container.querySelector(".ce");
const panel = () => container.querySelector(".panel");
const submit = (label) => [...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes(label));
const today = () => new Date().toISOString().slice(0, 10);

// The nav tabs are plain buttons, not .mode tiles - clickMode is for a tile on the Modes screen.
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
// Century lives behind Mini games since v2.10.0, not on Modes. This walks the route a player walks, and hands
// back the TILE - captured before the click, because afterwards the only thing on screen saying "Century" is
// the Daily Century tile on the mode's own menu, which is a different tile with different words.
async function openCentury() {
  const tile = await centuryTile();
  await click(tile);
  await flush();
  return tile;
}
// The Century tile as the Mini games screen shows it, without opening the mode.
async function centuryTile() {
  await openNav("Modes");
  const mini = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Mini games"));
  assert(mini, "Modes has a Mini games tile");
  await click(mini);
  await flush();
  const tile = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Century"));
  assert(tile, "the Mini games screen has a Century tile");
  return tile;
}

// The screen's markup IS the draft screen's: a .reel naming the team, a .roster of .slot tiles, and .card rows
// with a .drafts row of Lock in buttons under the selected one. These read the screen the way a player sees it.
const reelTeam = () => ce().querySelector(".reel .team").textContent;
const teamCode = () => Object.keys(CENTURY_BOARDS).find((t) => TEAMS[t] && TEAMS[t][0] === reelTeam());
const slotTiles = () => [...ce().querySelectorAll(".roster .slot")];
// The menu deals the app's own .mode tiles, the same ones the Modes screen uses - Daily first, Unlimited second.
const variantTiles = () => [...ce().querySelectorAll(".modes .mode")];
const filledSlots = () => slotTiles().filter((b) => b.classList.contains("filled"));
const openCards = () => [...ce().querySelectorAll(".card")].filter((c) => !c.classList.contains("off"));
const cardFor = (name) => [...ce().querySelectorAll(".card")].find((c) => c.querySelector(".nm")?.textContent === name);
// The roster as the tiles show it, not recomputed.
function rosterOnScreen() {
  const out = {};
  slotTiles().forEach((tile, i) => {
    if (tile.classList.contains("filled")) out[CENTURY_SLOTS[i]] = { name: tile.querySelector(".v").textContent };
  });
  return out;
}
// Select a card and press one of its Lock in buttons.
async function lockIn(card, slot) {
  await click(card.querySelector(".hit"));
  await flush();
  const drafts = card.querySelector(".drafts") || ce().querySelector(".drafts");
  assert(drafts, "a Lock in row opened");
  const buttons = [...drafts.querySelectorAll("button")];
  const want = (slot && buttons.find((b) => b.textContent.includes(`Lock in - ${CENTURY_SLOT_LABEL[slot]}`)))
    || buttons.find((b) => b.textContent.includes("Lock in"));
  await click(want);
  await flush();
}

// Play the whole run by clicking: for each board, take the highest scorer that fits a slot still open. The screen
// hides the stats, so this is a test knowing what a player would have to remember - it is not reading the DOM for
// a number that is not there.
// Driven by the SCREEN's own state, not by a count of seven: this is also called on a run resumed with picks
// already in it, and a fixed seven iterations then ran past the end and read a board that was no longer there.
async function playOut({ respinAt = -1 } = {}) {
  const taken = [];
  for (let guard = 0; ce().dataset.view === "play" && guard <= CENTURY_SLOTS.length; guard++) {
    const stepNo = filledSlots().length;
    if (stepNo === respinAt) {
      const again = findButtonByText(ce(), "Re-spin team");
      assert(again && !again.disabled, `the re-spin is offered at step ${stepNo}`);
      await click(again);
      await flush();
    }
    const code = teamCode();
    assert(code, `the reel names a real team: ${reelTeam()}`);
    const roster = rosterOnScreen();
    const filled = new Set(Object.values(roster).map((r) => r.name));
    let best = null, bestSlot = null;
    for (const p of CENTURY_BOARDS[code]) {
      if (filled.has(p.name)) continue;
      for (const slot of CENTURY_SLOTS) {
        if (roster[slot] || !centuryFits(p.pos, slot)) continue;
        if (!best || p.td > best.td) { best = p; bestSlot = slot; }
      }
    }
    assert(best, `something on ${code} fits a slot still open at step ${stepNo}`);
    const card = cardFor(best.name);
    assert(card && !card.classList.contains("off"), `${best.name} is on the board and pickable`);
    await lockIn(card, bestSlot);
    taken.push({ name: best.name, td: best.td, team: code });
  }
  assert(ce().dataset.view === "done", `the run reached its end: ${ce().dataset.view}`);
  return taken;
}

await runTest("1. the Modes tile opens Century, and the screen says what the mode is", async () => {
  await signUp("century1@example.test", "centurion");
  const tile = await openCentury();
  assert(tile.textContent.includes(String(CENTURY_GOAL)), `the tile names the goal: ${tile.textContent}`);
  assert(ce(), "the screen renders");
  assert(ce().dataset.view === "menu", `it opens on the menu: ${ce().dataset.view}`);
  assert(text(container).includes("Seven slots"), "it explains the seven slots");
  assert(container.querySelector("h1.vh")?.textContent === "Century", "and it names itself for a screen reader");
  const modes = [...variantTiles()].map((b) => b.textContent);
  assert(modes.length === 2 && modes[0].includes("Daily") && modes[1].includes("Unlimited"),
    `both variants are offered: ${JSON.stringify(modes)}`);
});

await runTest("2. an Unlimited run is played by clicking and lands on the board", async () => {
  await openCentury();
  await click([...variantTiles()][1]);
  await flush();
  assert(ce().dataset.view === "play", `it deals a board: ${ce().dataset.view}`);
  assert(slotTiles().length === CENTURY_SLOTS.length, "seven slots are shown");
  assert(ce().querySelector(".reel"), "the board spins in on the draft screen's own reel");
  assert(ce().querySelector(".modebar"), "and carries the mode bar every draft screen has");
  assert(!ce().querySelector(".cells"), "no stat cells are rendered, exactly as Genius mode renders none");
  // No stats anywhere on the board - that is the whole mode.
  const board = [...ce().querySelectorAll(".sec")].map((x) => x.textContent).join(" ");
  assert(!/\bTD\b|touchdown/i.test(board), `the board shows no stats: ${board.slice(0, 120)}`);

  const taken = await playOut();
  assert(ce().dataset.view === "done", `seven picks finish the run: ${ce().dataset.view}`);
  const shown = Number(ce().querySelector(".ce-score").textContent);
  const expected = taken.reduce((n, p) => n + p.td, 0);
  assert(shown === expected, `the score is the touchdowns added up: ${shown} vs ${expected}`);
  // And now the stats ARE shown, which is the payoff.
  const rows = [...ce().querySelectorAll(".ce-card tbody tr")];
  assert(rows.length === CENTURY_SLOTS.length, `seven rows on the card: ${rows.length}`);
  for (const p of taken) assert(ce().querySelector(".ce-card").textContent.includes(p.name), `${p.name} is on the card`);
  assert(ce().textContent.includes("Best possible from your seven teams"), "and it says what the draw was worth at best");

  const runs = window.__ps_supabase__._century.runs();
  assert(runs.length === 1 && runs[0].score === expected, `the run was recorded: ${JSON.stringify(runs.map((r) => r.score))}`);
  assert(runs[0].day === null, "with no day, because it was Unlimited");
  assert(runs[0].username === "centurion", "under the account's name");
});

await runTest("3. the score on screen is the server's, and the ceiling is for the teams dealt", async () => {
  await openCentury();
  const before = window.__ps_supabase__._century.runs().length;
  await click([...variantTiles()][1]);
  await flush();
  const seed = JSON.parse((await window.storage.get("ps-century-wip")).value).seed;
  const taken = await playOut();
  const runs = window.__ps_supabase__._century.runs();
  assert(runs.length === before + 1, "one more run");
  const saved = runs[runs.length - 1];
  assert(saved.ceiling === centuryCeiling(seed), `the ceiling is the draw's: ${saved.ceiling} vs ${centuryCeiling(seed)}`);
  assert(saved.score <= saved.ceiling, `and no run beats it: ${saved.score} > ${saved.ceiling}`);
  assert(Number(ce().querySelector(".ce-score").textContent) === saved.score, "the screen shows what was saved");
  void taken;
});

await runTest("4. the re-spin is once, and changes the team", async () => {
  await openCentury();
  await click([...variantTiles()][1]);
  await flush();
  const wip = JSON.parse((await window.storage.get("ps-century-wip")).value);
  const plan = centuryPlan(wip.seed);
  assert(teamCode() === plan[0], `the first board is the plan's: ${reelTeam()}`);
  await click(findButtonByText(ce(), "Re-spin team"));
  await flush();
  const spare = centuryRespinTeam(wip.seed, 0, plan);
  assert(teamCode() === spare, `the re-spin deals the spare: ${reelTeam()} wanted ${TEAMS[spare][0]}`);
  assert(!plan.includes(spare), "which is never a team the plan already holds");
  const again = findButtonByText(ce(), "Re-spin team");
  assert(again && again.disabled, "and there is no second one");
  assert(/0 left/.test(again.textContent), `and says none are left: ${again.textContent}`);
  // The rest of the run still finishes, and the server accepts it with the re-spin where it was spent.
  const before = window.__ps_supabase__._century.runs().length;
  await playOut();
  const runs = window.__ps_supabase__._century.runs();
  assert(runs.length === before + 1, `it saved: ${runs.length} vs ${before + 1}`);
  assert(runs[runs.length - 1].ceiling === centuryCeiling(wip.seed, 0),
    "and the ceiling is for the teams actually dealt, not the plan");
});

await runTest("5. a run in progress resumes; a finished one does not come back", async () => {
  await openCentury();
  await click([...variantTiles()][1]);
  await flush();
  // Two picks, then leave the screen entirely.
  for (let i = 0; i < 2; i++) await lockIn(openCards()[0]);
  const saved = JSON.parse((await window.storage.get("ps-century-wip")).value);
  assert(saved.picks.length === 2, `two picks are saved: ${saved.picks.length}`);
  await click(findButtonByText(ce(), "Leave"));
  await flush();
  await openCentury();
  assert(ce().dataset.view === "play", `it resumes rather than restarting: ${ce().dataset.view}`);
  assert(filledSlots().length === 2, `with the two picks still there: ${filledSlots().length}`);
  // Finish it, and the snapshot is gone - a finished run must never resurface as a resumable one.
  await playOut();
  const after = await window.storage.get("ps-century-wip");
  assert(!after || after === "{", `the snapshot is cleared: ${JSON.stringify(after)}`);
  await click(findButtonByText(ce(), "Done"));
  await flush();
  await openCentury();
  assert(ce().dataset.view === "menu", `and the screen opens on the menu again: ${ce().dataset.view}`);
});

await runTest("6. the daily is once, and the tile says so afterwards", async () => {
  await openCentury();
  const daily = [...variantTiles()][0];
  assert(!daily.disabled, "an account may play the daily");
  await click(daily);
  await flush();
  const wip = JSON.parse((await window.storage.get("ps-century-wip")).value);
  assert(wip.seed === centuryDailySeed(today()) && wip.day === today(),
    `the daily's seed is the day's: ${JSON.stringify(wip)}`);
  await playOut();
  const runs = window.__ps_supabase__._century.runs().filter((r) => r.day === today());
  assert(runs.length === 1, `one daily row: ${runs.length}`);
  const score = runs[0].score;
  // Back out: the daily is played, and says so - but it is NOT a dead end. It used to be disabled saying
  // "Played" while the Mini games tile promised "See today's result", so the run just finished was unreachable.
  await click(findButtonByText(ce(), "Boards"));
  await flush();
  const again = [...variantTiles()][0];
  assert(!again.disabled, "the daily tile is still live once played");
  assert(again.textContent.includes(String(score)), `and it says what it scored: ${again.textContent}`);
  assert(/See how it went/.test(again.textContent), `and offers the result: ${again.textContent}`);
  // Pressing it shows that run again, from the stored roster - no second run is recorded.
  await click(again);
  await flush();
  assert(ce().dataset.view === "done", `it opens the result: ${ce().dataset.view}`);
  assert(Number(ce().querySelector(".ce-score").textContent) === score, "with the score it scored");
  assert(ce().querySelectorAll(".ce-card tbody tr").length === CENTURY_SLOTS.length, "and all seven players");
  assert(/Today's Century/.test(ce().textContent), "labelled as today's, not as a fresh finish");
  assert(window.__ps_supabase__._century.runs().filter((r) => r.day === today()).length === 1,
    "and looking at it records nothing");
  // And the Mini games tile still carries the pill.
  await click(findButtonByText(ce(), "Boards"));
  await flush();
  await click(findButtonByText(ce(), "Back"));
  await flush();
  const tile = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Century"));
  assert(tile.textContent.includes(`Done · ${score}`), `the Mini games tile says so too: ${tile.textContent}`);
});

await runTest("7. the boards show the day and all time, and mark a player's own row", async () => {
  await openCentury();
  // BOTH tab panels are in the document (one `hidden`), so every read here is scoped to the open one - the
  // other is real markup a loose querySelector would happily return instead. That is the shape a tabs widget
  // has to have, or the closed tab's aria-controls points at nothing.
  const open = () => ce().querySelector(".ce-panel:not([hidden])");
  const tabs = [...ce().querySelectorAll('[role="tab"]')];
  assert(tabs.length === 2 && tabs[0].getAttribute("aria-selected") === "true", "Today is the open tab");
  assert(ce().querySelectorAll(".ce-panel").length === 2, "both panels exist, so neither tab points at nothing");
  assert(ce().querySelectorAll(".ce-panel[hidden]").length === 1, "and exactly one of them is hidden");
  assert(open().querySelector(".ce-lb"), "the day's board renders");
  assert(open().querySelector(".ce-lb tr.me"), "and this player's own row is marked");
  assert(open().textContent.includes("centurion"), "by name");
  await click(tabs[1]);
  await flush();
  assert(tabs[1].getAttribute("aria-selected") === "true", "All time opens");
  const caption = open().querySelector(".ce-lb caption").textContent;
  assert(/one per player/.test(caption), `it is one row per player: ${caption}`);
  // Every board in the game renders a guest's name with a chip rather than as a link, and this one is no
  // different - that is what stops a throwaway account being clickable.
  const head = [...open().querySelectorAll(".ce-lb th")].map((h) => h.textContent);
  assert(head.includes("Runs"), `the all-time board counts runs: ${JSON.stringify(head)}`);
});

await runTest("8. a guest plays Unlimited and is refused the daily, with a reason", async () => {
  await auth.auth.signOut();
  await flush();
  // A guest account, the way finishing a season makes one.
  await auth.auth.signInAnonymously();
  await flush();
  await openCentury();
  const [daily, free] = [...variantTiles()];
  // The daily is closed to a guest, and the tile SAYS so - but it is not a disabled button telling you to do
  // something it will not let you do. It takes them to the Account tab, which is where the answer is.
  assert(!daily.disabled, "the daily tile is still a live control");
  assert(/needs an account/.test(daily.textContent), `and says why: ${daily.textContent}`);
  const beforeGuest = window.__ps_supabase__._century.runs().length;
  await click(daily);
  await flush();
  assert(!ce() || ce().dataset.view !== "play", "a guest tapping the daily never reaches a board");
  assert(window.__ps_supabase__._century.runs().length === beforeGuest, "and nothing was recorded");
  assert(/account/i.test(text(container)), "they are taken somewhere that talks about an account");

  await openCentury();
  const free2 = [...variantTiles()][1];
  assert(!free2.disabled, "Unlimited is open");
  await click(free2);
  await flush();
  assert(ce().dataset.view === "play", "and it deals");
  const before = window.__ps_supabase__._century.runs().length;
  await playOut();
  const runs = window.__ps_supabase__._century.runs();
  assert(runs.length === before + 1, `a guest's Unlimited run is recorded: ${runs.length}`);
  assert(runs[runs.length - 1].guest === true, "and carries the guest flag from the account");
});

await runTest("9. a signed-out visitor reads the boards and is asked to sign in", async () => {
  await auth.auth.signOut();
  await flush();
  await openCentury();
  const modes = [...variantTiles()];
  // Same rule signed out: live controls that take you to the Account tab rather than dead ones that do not.
  assert(modes.every((b) => !b.disabled), "both tiles are live controls");
  assert(modes.every((b) => /Sign in to play/.test(b.textContent)), "and both say what is needed");
  const beforeOut = window.__ps_supabase__._century.runs().length;
  await click(modes[1]);
  await flush();
  assert(!ce() || ce().dataset.view !== "play", "a signed-out visitor tapping one never reaches a board");
  assert(window.__ps_supabase__._century.runs().length === beforeOut, "and nothing was recorded");
  await openCentury();
  assert(/Sign in/.test(ce().textContent), `and it says to sign in: ${ce().textContent.slice(0, 200)}`);
  assert(ce().querySelector(".ce-lb") || /Nobody/.test(ce().textContent), "the boards still render");
});

await runTest("10. one function decides whether a pick is legal, and the board obeys it", async () => {
  // The rule, on its own. centuryBlock is what both the disabled state and the click handler call, and this is
  // the assertion that it actually says no - the GM cap's history is that a screen can look right and enforce
  // nothing.
  const team = Object.keys(CENTURY_BOARDS)[0];
  const qb = CENTURY_BOARDS[team].find((p) => p.pos === "QB");
  const rb = CENTURY_BOARDS[team].find((p) => p.pos === "RB");
  assert(centuryBlock(qb, "QB", {}) === null, "a quarterback fits the QB slot");
  assert(/Flex takes/.test(centuryBlock(qb, "FLEX", {}) || ""), `a quarterback never fits the Flex: ${centuryBlock(qb, "FLEX", {})}`);
  assert(/needs a RB/.test(centuryBlock(qb, "RB1", {}) || ""), `nor a back slot: ${centuryBlock(qb, "RB1", {})}`);
  assert(/already filled/.test(centuryBlock(rb, "RB1", { RB1: rb }) || ""), "a filled slot is refused");
  assert(/already on your roster/.test(centuryBlock(rb, "RB2", { RB1: rb }) || ""), "and so is the same man twice");
  assert(centuryBlock(null, "QB", {}), "nothing is not a pick");
  assert(centuryBlock(rb, "K", {}), "and there is no K slot");

  // And the board honours it: on a real board, every enabled row has somewhere to go and every disabled one has
  // nowhere. This is the two-doors check - if the disabled state came from anything other than centuryBlock, one
  // of these two counts would be wrong.
  await signUp("century2@example.test", "another");
  await openCentury();
  await click([...variantTiles()][1]);
  await flush();
  // Fill the two back slots and the Flex, so most backs have nowhere left.
  for (let n = 0; n < 3; n++) {
    const cards = openCards();
    if (!cards.length) break;
    await lockIn(cards[cards.length - 1]);
  }
  const code = teamCode();
  const roster = rosterOnScreen();
  let checked = 0;
  for (const card of ce().querySelectorAll(".card")) {
    const name = card.querySelector(".nm").textContent;
    const p = CENTURY_BOARDS[code].find((q) => q.name === name);
    const legal = CENTURY_SLOTS.some((s) => !centuryBlock({ ...p }, s, rosterWith(roster, p)));
    const off = card.classList.contains("off");
    assert(off === !legal,
      `${name} (${p.pos}): the board says ${off ? "no room" : "pickable"}, the rule says ${legal ? "pickable" : "no room"}`);
    assert(card.querySelector(".hit").disabled === off, `${name}: the card and its own button agree`);
    checked++;
  }
  assert(checked > 5, `enough of the board was checked: ${checked}`);

  // THE SECOND DOOR. A roster tile is the other way a pick is made, and the draft screen's equivalent enforced
  // nothing at all for three releases. Select somebody, and every tile must agree with centuryBlock.
  const pick = openCards()[0];
  await click(pick.querySelector(".hit"));
  await flush();
  const who = CENTURY_BOARDS[code].find((q) => q.name === pick.querySelector(".nm").textContent);
  let tiles = 0;
  slotTiles().forEach((tile, i) => {
    const slot = CENTURY_SLOTS[i];
    const allowed = !centuryBlock(who, slot, rosterWith(roster, who));
    assert(tile.disabled === !allowed,
      `${who.name} -> ${slot}: the tile says ${tile.disabled ? "no" : "yes"}, the rule says ${allowed ? "yes" : "no"}`);
    tiles++;
  });
  assert(tiles === CENTURY_SLOTS.length, `all seven tiles were checked: ${tiles}`);
});
// The roster centuryBlock is asked about, with the names the chips showed - the pos is not on a chip, so a filled
// slot is what matters and a name is enough for the duplicate rule.
function rosterWith(roster, player) {
  const out = {};
  for (const [slot, r] of Object.entries(roster)) out[slot] = { name: r.name, pos: player.pos };
  return out;
}

await runTest("11. every refusal the function can answer with has a line on screen", async () => {
  // storage-century.js's map and century.jsx's wording, held to the Edge Function's own source. A reason that
  // reaches the app unmapped is read as "network" and shown as "check your connection" - forever, for a rule.
  const fnSource = readFileSync(new URL("../supabase/functions/submit-century/index.ts", import.meta.url), "utf8");
  const fromFn = [...fnSource.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const missing = [...new Set(fromFn)].filter((r) => !CENTURY_REFUSALS.includes(r));
  assert(missing.length === 0, `every reason the function answers with is mapped: missing ${JSON.stringify(missing)}`);
  // And every replayCentury reason, which the function passes straight through.
  const logicSource = readFileSync(new URL("../century-logic.mjs", import.meta.url), "utf8");
  const fromLogic = [...logicSource.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const missingLogic = [...new Set(fromLogic)].filter((r) => !CENTURY_REFUSALS.includes(r));
  assert(missingLogic.length === 0, `every rule the replay can break is mapped: missing ${JSON.stringify(missingLogic)}`);
  // The wording: each one says something, and none of them blames the connection for a rule.
  const source = readFileSync(new URL("../century.jsx", import.meta.url), "utf8");
  for (const r of CENTURY_REFUSALS) {
    if (["duplicate", "guest_daily", "wrong_day", "reserved_code", "bad_code"].includes(r)) {
      assert(source.includes(`case "${r}"`), `${r} has a line of its own`);
    }
  }
  assert(/default:/.test(source), "and anything else falls to a line that names the reason rather than the network");
});

// A run in progress is saved per DEVICE, not per account, so a half-finished one is still there after signing in
// as somebody else - which is right (it is seven picks, not a record) and is also how a test leaves one behind.
const dropWip = async () => { await window.storage.delete("ps-century-wip"); };

await runTest("12. a second daily is reported as already recorded, not shown as a saved run", async () => {
  // The path a real player reaches this by: a tab left open on a daily that was finished somewhere else. The
  // screen closes the daily off once it knows, so getting back in means resuming a snapshot - which is exactly
  // what that stale tab has. A finished-looking result screen for a run nothing recorded is the worst option
  // available, so the 409 has to reach the player.
  await dropWip();
  await signUp("century3@example.test", "twice");
  await openCentury();
  await click([...variantTiles()][0]);
  await flush();
  await playOut();
  assert(ce().dataset.view === "done", "the first daily finishes");
  assert(!/already recorded/.test(ce().textContent), `with no complaint: ${ce().textContent.slice(0, 160)}`);
  const after = window.__ps_supabase__._century.runs().filter((r) => r.day === today() && r.username === "twice");
  assert(after.length === 1, `one row exists: ${after.length}`);

  // Now the stale tab: a fresh snapshot for the same day, resumed. The done record this device wrote a
  // moment ago goes with it - since v2.18.0 the resume path consults it, and a tab stale because the day
  // was finished ELSEWHERE is by definition a device that never wrote one.
  for (const k of (await window.storage.list("ps-century-done", false)).keys) await window.storage.delete(k, false);
  await window.storage.set("ps-century-wip", JSON.stringify({
    variant: "daily", day: today(), seed: centuryDailySeed(today()), picks: [],
  }));
  await openCentury();
  assert(ce().dataset.view === "play", `the stale tab resumes into a run: ${ce().dataset.view}`);
  await playOut();
  assert(/already recorded/.test(ce().textContent),
    `and the second is reported: ${ce().textContent.slice(0, 240)}`);
  const still = window.__ps_supabase__._century.runs().filter((r) => r.day === today() && r.username === "twice");
  assert(still.length === 1, `with still only one row: ${still.length}`);
  assert(still[0].score === after[0].score, "and the first run's score untouched");
  await dropWip();
});

await runTest("13. the result shares a card, and the card's link deals the same seven teams", async () => {
  // The share sheet is not available in jsdom, so sendShare falls through to the clipboard - which is the path
  // a desktop takes anyway. What is captured here is the TEXT, because that is the whole artefact.
  const written = [];
  navigator.clipboard = { writeText: async (t) => { written.push(t); } };
  await dropWip();
  await signUp("century4@example.test", "sharer");
  await openCentury();
  await click(variantTiles()[1]);
  await flush();
  const seed = JSON.parse((await window.storage.get("ps-century-wip")).value).seed;
  const taken = await playOut();
  const score = taken.reduce((n, p) => n + p.td, 0);

  const share = findButtonByText(ce(), "Share");
  assert(share, "the result offers a Share button");
  await click(share);
  await flush();
  assert(written.length === 1, `it shared once: ${written.length}`);
  const card = written[0];
  assert(card.includes(`${score}/${CENTURY_GOAL}`), `the card states the score: ${card.split("\n")[0]}`);
  assert(card.includes(seed), `and carries the seed as its code: ${card}`);
  // Not one player on the roster may be named - the spoiler rule, checked against the run just played.
  for (const p of taken) assert(!card.includes(p.name), `${p.name} must not be on the card: ${card}`);

  // And the link is playable: parsed, it deals the same seven teams.
  const link = card.split("\n").pop();
  const q = link.slice(link.indexOf("?"));
  const parsed = parseChallengeLink(`/c/${seed}`, q);
  assert(parsed?.century && parsed.code === seed, `it parses as a Century link: ${JSON.stringify(parsed)}`);
  assert(centuryPlan(parsed.code).join(",") === centuryPlan(seed).join(","), "dealing the same seven teams");
});

await runTest("14. taking a Century link deals its teams, and costs no season draft", async () => {
  await dropWip();
  const seed = "SHARED77";
  // Landing on the link is what the app does at startup, so the card appears on Modes.
  window.history.replaceState({}, "", `/c/${seed}?mode=century&score=91`);
  ({ container } = await mount());
  await flush();
  const card = container.querySelector(".challenge");
  assert(card, "a challenge card is offered on Modes");
  assert(/seven teams/.test(card.textContent), `worded for Century: ${card.textContent.slice(0, 90)}`);
  assert(/91/.test(card.textContent), "and it says what they got");
  assert(!/DNF/.test(card.textContent), "with no talk of abandoning a season draft, because none is involved");
  const take = findButtonByText(card, "Play these teams");
  assert(take, `the button says what it does: ${card.textContent.slice(0, 120)}`);
  await click(take);
  await flush();
  await flush();
  assert(ce()?.dataset.view === "play", `it opens Century mid-run: ${ce()?.dataset.view}`);
  const wip = JSON.parse((await window.storage.get("ps-century-wip")).value);
  assert(wip.seed === seed, `dealing the link's teams: ${wip.seed}`);
  assert(wip.variant === "unlimited", "as an Unlimited run, never as the daily");
  assert(teamCode() === centuryPlan(seed)[0], `and the first board is theirs: ${reelTeam()}`);
  window.history.replaceState({}, "", "/");
});

await runTest("15. a link beats a run already in progress, and a slow snapshot read cannot undo it", async () => {
  // THE BUG THIS FILE MISSED. Test 14 called dropWip() first, so no snapshot existed and the race never ran -
  // and on staging, taking a link dealt the OLD run instead of the shared one. The resume is an independent
  // async read: it started before the link was taken and landed after it, restoring a stale snapshot over a run
  // the player had just been handed. The saved snapshot was right and the screen was wrong, which is what made
  // it invisible to everything except opening a real link in a real browser.
  //
  // So this leaves a snapshot in place ON PURPOSE, and delays the read so it is guaranteed to land late.
  const stale = { variant: "unlimited", day: null, seed: "STALE999", picks: [] };
  await window.storage.set("ps-century-wip", JSON.stringify(stale), false);
  // A get that resolves after the link has been taken, however fast the rest of the mount is.
  const realGet = window.storage.get;
  window.storage.get = async (key, shared) => {
    const value = await realGet.call(window.storage, key, shared);
    if (key === "ps-century-wip") await new Promise((r) => setTimeout(r, 40));
    return value;
  };
  try {
    window.history.replaceState({}, "", "/c/SHARED77?mode=century&score=91");
    ({ container } = await mount());
    await flush();
    await click(findButtonByText(container.querySelector(".challenge"), "Play these teams"));
    await flush();
    // Let the delayed read land, then look at what is on screen.
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    assert(ce()?.dataset.view === "play", `a run is dealt: ${ce()?.dataset.view}`);
    const shown = ce().querySelector(".codechip")?.textContent || "";
    assert(shown.includes("SHARED77"), `the LINK's teams are on screen, not the stale run's: ${shown}`);
    assert(!shown.includes("STALE999"), "the stale snapshot did not come back");
    assert(teamCode() === centuryPlan("SHARED77")[0], `and the board is the link's: ${reelTeam()}`);
    // The saved snapshot agrees with the screen - they disagreed, which is how this hid.
    const wip = JSON.parse((await realGet.call(window.storage, "ps-century-wip", false)).value);
    assert(wip.seed === "SHARED77", `and what is saved matches what is shown: ${wip.seed}`);
  } finally {
    window.storage.get = realGet;
    window.history.replaceState({}, "", "/");
    await dropWip();
  }
});

await runTest("16. the played-today hint survives a reload, keyed by the day the run is filed under", async () => {
  // The OTHER half of the UTC bug. The in-memory pill is set when the run saves; this is the one that has to
  // come back from storage on a fresh load - and it was WRITTEN under the run's UTC day and READ under the
  // browser's LOCAL day. Those differ for hours every day for anyone west of UTC, so the pill simply never
  // returned for them. This is the assertion that catches the read side, which the save-side test cannot.
  await dropWip();
  await signUp("century5@example.test", "reloader");
  await openCentury();
  await click(variantTiles()[0]);
  await flush();
  const taken = await playOut();
  const score = taken.reduce((n, p) => n + p.td, 0);

  // A fresh load: nothing of the component's state survives, only what is in storage.
  ({ container } = await mount());
  await flush();
  await openNav("Modes");
  const mini = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Mini games"));
  assert(mini, "Modes still offers Mini games");
  assert(/done today/.test(mini.textContent), `and counts today's played games: ${mini.textContent}`);
  await click(mini);
  await flush();
  const tile = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Century"));
  assert(tile.textContent.includes(`Done · ${score}`),
    `the Century tile remembers across a reload: ${tile.textContent}`);
});

console.log("test-century-screen.mjs done");
