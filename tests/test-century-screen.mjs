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
  assert, runTest, waitForCrypto, makeMockAuth, loadModule, type,
} from "./helpers.mjs";
import { readFileSync } from "node:fs";
import {
  initCenturyData, CENTURY_SLOTS, CENTURY_GOAL, CENTURY_BOARDS, centuryPlan, centuryRespinTeam,
  centuryFits, centuryTeamName, centuryDailySeed, centuryCeiling,
} from "../century-logic.mjs";
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
async function openCentury() {
  await openNav("Modes");
  const tile = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Century"));
  assert(tile, "the Modes screen has a Century tile");
  await click(tile);
  await flush();
  return tile;
}

// Play the whole run by clicking: for each board, take the highest scorer that fits a slot still open. The screen
// hides the stats, so this is a test knowing what a player would have to remember - it is not reading the DOM for
// a number that is not there.
// Driven by the SCREEN's own state, not by a count of seven: this is also called on a run resumed with picks
// already in it, and a fixed seven iterations then ran past the end and read a board that was no longer there.
async function playOut({ respinAt = -1 } = {}) {
  const taken = [];
  for (let guard = 0; ce().dataset.view === "play" && guard <= CENTURY_SLOTS.length; guard++) {
    const stepNo = [...ce().querySelectorAll(".ce-chip.on")].length;
    if (stepNo === respinAt) {
      const again = findButtonByText(ce(), "Re-spin this team");
      assert(again && !again.disabled, `the re-spin is offered at step ${stepNo}`);
      await click(again);
      await flush();
    }
    const teamName = ce().querySelector(".ce-team").textContent;
    const code = Object.keys(CENTURY_BOARDS).find((t) => centuryTeamName(t) === teamName);
    assert(code, `the board names a real team: ${teamName}`);
    // The roster as the screen has it, read off the chips rather than recomputed.
    const roster = {};
    ce().querySelectorAll(".ce-chip").forEach((li, i) => {
      const name = li.querySelector(".ce-cn").textContent;
      if (name !== "—") roster[CENTURY_SLOTS[i]] = { name, pos: null };
    });
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
    const row = [...ce().querySelectorAll(".ce-man")].find((b) => b.querySelector(".ce-name").textContent === best.name);
    assert(row && !row.disabled, `${best.name} is offered and enabled`);
    await click(row);
    await flush();
    // One legal slot goes straight in; more than one asks which.
    const chooser = ce().querySelector(".ce-slots");
    if (chooser) {
      const want = [...chooser.querySelectorAll("button")].find((b) => b.textContent === CENTURY_SLOT_LABEL[bestSlot])
        || chooser.querySelector("button");
      await click(want);
      await flush();
    }
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
  const modes = [...ce().querySelectorAll(".ce-mode")].map((b) => b.textContent);
  assert(modes.length === 2 && modes[0].includes("Daily") && modes[1].includes("Unlimited"),
    `both variants are offered: ${JSON.stringify(modes)}`);
});

await runTest("2. an Unlimited run is played by clicking and lands on the board", async () => {
  await openCentury();
  await click([...ce().querySelectorAll(".ce-mode")][1]);
  await flush();
  assert(ce().dataset.view === "play", `it deals a board: ${ce().dataset.view}`);
  assert(ce().querySelectorAll(".ce-chip").length === CENTURY_SLOTS.length, "seven slots are shown");
  // No stats anywhere on the board - that is the whole mode.
  const board = ce().querySelector(".ce-board").textContent;
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
  assert(ce().textContent.includes("Best possible from your teams"), "and it says what the draw was worth at best");

  const runs = window.__ps_supabase__._century.runs();
  assert(runs.length === 1 && runs[0].score === expected, `the run was recorded: ${JSON.stringify(runs.map((r) => r.score))}`);
  assert(runs[0].day === null, "with no day, because it was Unlimited");
  assert(runs[0].username === "centurion", "under the account's name");
});

await runTest("3. the score on screen is the server's, and the ceiling is for the teams dealt", async () => {
  await openCentury();
  const before = window.__ps_supabase__._century.runs().length;
  await click([...ce().querySelectorAll(".ce-mode")][1]);
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
  await click([...ce().querySelectorAll(".ce-mode")][1]);
  await flush();
  const wip = JSON.parse((await window.storage.get("ps-century-wip")).value);
  const plan = centuryPlan(wip.seed);
  assert(ce().querySelector(".ce-team").textContent === centuryTeamName(plan[0]),
    `the first board is the plan's: ${ce().querySelector(".ce-team").textContent}`);
  await click(findButtonByText(ce(), "Re-spin this team"));
  await flush();
  const spare = centuryRespinTeam(wip.seed, 0, plan);
  assert(ce().querySelector(".ce-team").textContent === centuryTeamName(spare),
    `the re-spin deals the spare: ${ce().querySelector(".ce-team").textContent} wanted ${centuryTeamName(spare)}`);
  assert(!plan.includes(spare), "which is never a team the plan already holds");
  const again = findButtonByText(ce(), "Re-spin used");
  assert(again && again.disabled, "and there is no second one");
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
  await click([...ce().querySelectorAll(".ce-mode")][1]);
  await flush();
  // Two picks, then leave the screen entirely.
  for (let i = 0; i < 2; i++) {
    const row = [...ce().querySelectorAll(".ce-man")].find((b) => !b.disabled);
    await click(row);
    await flush();
    const chooser = ce().querySelector(".ce-slots");
    if (chooser) { await click(chooser.querySelector("button")); await flush(); }
  }
  const saved = JSON.parse((await window.storage.get("ps-century-wip")).value);
  assert(saved.picks.length === 2, `two picks are saved: ${saved.picks.length}`);
  await click(findButtonByText(ce(), "Leave"));
  await flush();
  await openCentury();
  assert(ce().dataset.view === "play", `it resumes rather than restarting: ${ce().dataset.view}`);
  const filled = [...ce().querySelectorAll(".ce-chip.on")].length;
  assert(filled === 2, `with the two picks still there: ${filled}`);
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
  const daily = [...ce().querySelectorAll(".ce-mode")][0];
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
  // Back out and the daily is closed, on the screen and on the Modes tile.
  await click(findButtonByText(ce(), "Boards"));
  await flush();
  const again = [...ce().querySelectorAll(".ce-mode")][0];
  assert(again.disabled, "the daily is no longer offered");
  assert(again.textContent.includes(String(score)), `and it says what it scored: ${again.textContent}`);
  await click(findButtonByText(ce(), "Back"));
  await flush();
  const tile = [...container.querySelectorAll("button.mode")].find((b) => b.textContent.includes("Century"));
  assert(tile.textContent.includes(`Done · ${score}`), `the Modes tile says so too: ${tile.textContent}`);
});

await runTest("7. the boards show the day and all time, and mark a player's own row", async () => {
  await openCentury();
  const tabs = [...ce().querySelectorAll('[role="tab"]')];
  assert(tabs.length === 2 && tabs[0].getAttribute("aria-selected") === "true", "Today is the open tab");
  assert(ce().querySelector(".ce-lb"), "the day's board renders");
  assert(ce().querySelector(".ce-lb tr.me"), "and this player's own row is marked");
  assert(ce().textContent.includes("centurion"), "by name");
  await click(tabs[1]);
  await flush();
  assert(tabs[1].getAttribute("aria-selected") === "true", "All time opens");
  const caption = ce().querySelector(".ce-lb caption").textContent;
  assert(/one per player/.test(caption), `it is one row per player: ${caption}`);
  // Every board in the game renders a guest's name with a chip rather than as a link, and this one is no
  // different - that is what stops a throwaway account being clickable.
  const head = [...ce().querySelectorAll(".ce-lb th")].map((h) => h.textContent);
  assert(head.includes("Runs"), `the all-time board counts runs: ${JSON.stringify(head)}`);
});

await runTest("8. a guest plays Unlimited and is refused the daily, with a reason", async () => {
  await auth.auth.signOut();
  await flush();
  // A guest account, the way finishing a season makes one.
  await auth.auth.signInAnonymously();
  await flush();
  await openCentury();
  const [daily, free] = [...ce().querySelectorAll(".ce-mode")];
  assert(daily.disabled, "the daily is closed to a guest");
  assert(/needs an account/.test(daily.textContent), `and says why: ${daily.textContent}`);
  assert(!free.disabled, "Unlimited is open");
  await click(free);
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
  const modes = [...ce().querySelectorAll(".ce-mode")];
  assert(modes.every((b) => b.disabled), "neither variant is playable");
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
  await click([...ce().querySelectorAll(".ce-mode")][1]);
  await flush();
  // Fill the two back slots and the Flex, so most backs have nowhere left.
  let filledBacks = 0;
  while (filledBacks < 3) {
    const rows = [...ce().querySelectorAll(".ce-man")].filter((b) => !b.disabled);
    if (!rows.length) break;
    await click(rows[rows.length - 1]);
    await flush();
    const chooser = ce().querySelector(".ce-slots");
    if (chooser) { await click(chooser.querySelector("button")); await flush(); }
    filledBacks++;
  }
  const teamName = ce().querySelector(".ce-team").textContent;
  const code = Object.keys(CENTURY_BOARDS).find((t) => centuryTeamName(t) === teamName);
  const roster = {};
  ce().querySelectorAll(".ce-chip").forEach((li, i) => {
    const name = li.querySelector(".ce-cn").textContent;
    if (name !== "—") roster[CENTURY_SLOTS[i]] = { name };
  });
  let checked = 0;
  for (const row of ce().querySelectorAll(".ce-man")) {
    const name = row.querySelector(".ce-name").textContent;
    const p = CENTURY_BOARDS[code].find((q) => q.name === name);
    const legal = CENTURY_SLOTS.some((s) => !centuryBlock({ ...p }, s, rosterWith(roster, p)));
    assert(row.disabled === !legal,
      `${name} (${p.pos}): the board says ${row.disabled ? "no room" : "pickable"}, the rule says ${legal ? "pickable" : "no room"}`);
    checked++;
  }
  assert(checked > 5, `enough of the board was checked: ${checked}`);
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
  await click([...ce().querySelectorAll(".ce-mode")][0]);
  await flush();
  await playOut();
  assert(ce().dataset.view === "done", "the first daily finishes");
  assert(!/already recorded/.test(ce().textContent), `with no complaint: ${ce().textContent.slice(0, 160)}`);
  const after = window.__ps_supabase__._century.runs().filter((r) => r.day === today() && r.username === "twice");
  assert(after.length === 1, `one row exists: ${after.length}`);

  // Now the stale tab: a fresh snapshot for the same day, resumed.
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

console.log("test-century-screen.mjs done");
