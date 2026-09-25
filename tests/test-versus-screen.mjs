// The 1v1 screens in the real app (VERSUS.md 9), in jsdom on the mock: the Modes tile, the lobby and its link,
// a draft where the board is what the server says it is, a powerup spent by clicking it, and the result.
//
// The other 1v1 suites drive the rules and the client functions. This one drives the buttons - which is where
// the wiring lives, and the only place a screen that renders nothing would show up.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, clickMode,
  assert, runTest, waitForCrypto, makeMockAuth, loadModule,
} from "./helpers.mjs";
import { replayMatch, optionId, autoPick, VERSUS_SLOTS, MATCH_PICKS, TURN_SECONDS } from "../versus-logic.mjs";
import { TEAMS, WINDOWS } from "../game-logic.mjs";
import fs from "node:fs";

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
// A board opens the moment it is dealt now, so there is nothing to wait out - but a turn still has a clock,
// and these helpers keep it from running out mid-test.
function pastOpeningWindow(code) {
  const m = auth._versus._matches.get(code);
  if (m?.turn_deadline) m.turn_deadline = new Date(Date.now() + TURN_SECONDS * 1000).toISOString();
}
async function openMatch(email, code) {
  await signIn(email);
  window.history.pushState({ ps: "view", view: "versus", code }, "", `/vs/${code}`);
  pastOpeningWindow(code);
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
  await clickMode(container, "Duel");
  await flush();
  assert(versus(), "the 1v1 screen is on");
  assert(versus().dataset.view === "lobby", `starting at the lobby, got ${versus().dataset.view}`);

  await click(findButtonByText(container, "Open a lobby"));
  await flush();
  const code = versus().dataset.code;
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(code || ""), `a lobby with a code, got ${JSON.stringify(code)}`);
  assert(text(container).includes(`/vs/${code}`), "and the link to send is on screen");
  assert(findButtonByText(container, "Invite a friend"), "with a button to send it");
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
  const tile = [...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Duel")?.closest("button");
  assert(tile, "the tile is still there for a guest");
  assert(tile.textContent.includes("Sign in to play"), `and says so: ${tile.textContent.slice(0, 120)}`);
  await click(tile);
  await flush();
  assert(!versus() || versus().dataset.view !== "draft", "and a guest never reaches a draft");
});

await runTest("an invite taken while signed out signs you in where you stand", async () => {
  // The bug this pins: clicking a friend's link while signed out used to open the single-player rules (which
  // answer none of a 1v1's questions), and logging in from there walked you off the screen that was holding
  // the code - so you came back to no match.
  await auth.auth.signOut();
  await flush();
  window.history.pushState({ ps: "view", view: "versus", code: "ZZZZ99" }, "", "/vs/ZZZZ99");
  window.dispatchEvent(new window.PopStateEvent("popstate", { state: { ps: "view", view: "versus", code: "ZZZZ99" } }));
  await flush();
  await flush();

  assert(!container.querySelector("#howto-title"), "the game's own rules do not open over an invite");
  const panel = container.querySelector(".versus[data-view='signedout']");
  assert(panel, `the 1v1 screen offers a sign-in in place: ${text(container).slice(0, 160)}`);
  assert(panel.dataset.code === "ZZZZ99", `and still knows which match: ${panel.dataset.code}`);
  assert(container.querySelector(".panel input"), "with the login on the same screen");
  assert(window.location.pathname === "/vs/ZZZZ99", "and the address still holds the invite");
});

await runTest("the opponent's screen shows the same board, and a pick lands on it", async () => {
  // Two accounts, one browser: the host opens the lobby, then the opponent signs in and takes the link - which
  // is exactly what happens on two machines, minus the machines.
  await signUp("beta@x.test", "beta");
  await goHome();
  await clickMode(container, "Duel");
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
  const state = replayMatch({ code, picks: [], respins: [], dips: [], steals: [] });
  // It draws the single-player draft's own reel, so the team and era come from the board the server dealt.
  const [team, w] = state.boardKey.split("|");
  assert(container.querySelector(".reel .team")?.textContent === TEAMS[team][0],
    `the reel names the team the server dealt (${TEAMS[team][0]}), got ${container.querySelector(".reel .team")?.textContent}`);
  assert(container.querySelector(".reel .led")?.textContent === `${WINDOWS[Number(w)][0]}–${WINDOWS[Number(w)][1]}`,
    `and its era: ${container.querySelector(".reel .led")?.textContent}`);

  // Both rosters are ABOVE the board, not under it: what you still have open is what you read the board
  // against, so scrolling eight sections to check it is the wrong way round.
  const rosterTop = container.querySelector(".vs-rosters")?.compareDocumentPosition(container.querySelector(".reel"));
  assert(rosterTop & 4, "the rosters come before the reel in the document");

  // Both rosters are on screen, empty, and the slots are named in letters rather than by colour alone.
  const slots = [...container.querySelectorAll(".vs-rosters .roster")[0].querySelectorAll(".slot")].map((el) => el.dataset.slot);
  assert(JSON.stringify(slots) === JSON.stringify(VERSUS_SLOTS), `eight slots in order, got ${slots.join(",")}`);
  assert(slots.every((_, i) => [...container.querySelectorAll(".vs-rosters .roster")[0].querySelectorAll(".slot")][i].dataset.filled === "0"),
    "nothing filled yet");

  // beta is the host, and the host leads board one - so this screen is the one on the clock.
  assert(state.turn.side === "host", "the host leads the first board");
  const cards = [...container.querySelectorAll(".sec .card")];
  assert(cards.length > 10, `the board's cards are on screen, got ${cards.length}`);
  // The board shows a defense and a kicker beside the players (VERSUS.md 6) - and no grades on any of them,
  // because a grade would hand the pick over.
  assert(cards.some((c) => c.dataset.opt.startsWith("dst|")) && cards.some((c) => c.dataset.opt.startsWith("k|")),
    "a defense and a kicker are on the board with the players");
  assert(!container.querySelector(".sec .card .vs-grade"), "and nothing on a card grades it");

  // Picking is two steps, as it is in the single-player draft: choose, then lock in.
  const pick = cards.find((c) => !c.classList.contains("off"));
  const took = pick.dataset.opt;
  await click(pick.querySelector(".hit"));
  await flush();
  const lock = [...pick.querySelectorAll(".drafts .btn")].find((b) => b.textContent.includes("Lock in"));
  assert(lock, `tapping a card offers Lock in, got ${pick.textContent.slice(0, 80)}`);
  await click(lock);
  await flush();
  await flush();

  const after = auth._versus._replay(code);
  assert(after.taken.has(took), `the pick reached the match: ${took}`);
  // And it landed in a slot on the host's side, not the opponent's.
  const rosters = [...container.querySelectorAll(".vs-rosters .roster")];
  assert([...rosters[0].querySelectorAll(".slot")].filter((el) => el.dataset.filled === "1").length === 1, "one slot filled");
  assert([...rosters[1].querySelectorAll(".slot")].every((el) => el.dataset.filled === "0"), "and nothing on the opponent's");
});

await runTest("the player on the clock sees Your pick, and the one waiting does not", async () => {
  // The announcement is per-screen, which no amount of testing latestEvent in isolation proves: it depends on
  // which side THIS browser is, while the two screens read the same match rows.
  // Opened the way the passing tests above open one - through the tile and the lobby - because that is the
  // path the app actually supports, and a duel screen reached any other way is a test of the test.
  await signUp("theta@x.test", "theta");
  await goHome();
  await clickMode(container, "Duel");
  await flush();
  await click(findButtonByText(container, "Open a lobby"));
  await flush();
  const code = versus().dataset.code;

  await signUp("iota@x.test", "iota");
  await flush();
  const joined = await auth.rpc("join_match", { p_code: code });
  assert(!joined.data.error, `the opponent joined: ${JSON.stringify(joined.data.error)}`);

  const st = auth._versus._replay(code);
  const leader = st.turn.side;                 // whoever leads board 1, decided by the match code
  const email = { host: "theta@x.test", guest: "iota@x.test" };
  const boom = () => container.querySelector(".vs-boom");
  const said = () => container.querySelector(".vs-boom-title")?.textContent || null;

  await openMatch(email[leader], code);
  await flush(2);
  assert(boom(), `the player on the clock gets an announcement (view ${versus()?.dataset?.view})`);
  assert(said() === "Your pick", `saying whose it is: ${said()}`);
  assert(boom().classList.contains("is-brief"), "in the short form - this happens eight times a match");
  assert(boom().classList.contains("tone-turn"), "and in its own colour");
  assert(container.querySelector('[aria-live="polite"]')?.textContent === "Your pick",
    "and once as words, for a screen reader rather than a description of an animation");

  // The player waiting, on the same rows.
  const waiting = leader === "host" ? "guest" : "host";
  await openMatch(email[waiting], code);
  await flush(2);
  assert(said() !== "Your pick", `the player waiting is not told it is theirs: ${said()}`);
});

await runTest("the follower spends a re-spin, and walks away to a board of their own", async () => {
  // The host has picked, so it is the opponent's turn - and a re-spin spent now is theirs alone (VERSUS.md 7),
  // which is the half of the rule that is easiest to get wrong and the only one visible on screen.
  const code = matchCode;
  await openMatch("gamma@x.test", code);
  assert(versus()?.dataset.view === "draft", `the opponent is in the draft, got ${versus()?.dataset.view}`);

  const before = auth._versus._replay(code);
  assert(before.turn.side === "guest", `it is the opponent's turn, got ${before.turn.side}`);
  const shared = before.boards[0].key;
  assert(container.querySelector(".reel .team").textContent === TEAMS[shared.split("|")[0]][0],
    "looking at the board the host picked from");

  const respin = findButtonByText(container, "Re-spin era");
  assert(respin && !respin.disabled, "the re-spin is on screen and takeable");
  await click(respin);
  await flush();
  await flush();

  const after = auth._versus._replay(code);
  assert(after.boards[0].key === shared, "the host keeps the board he picked from");
  assert(after.boards[0].followKey !== shared, `and the opponent has one of their own: ${after.boards[0].followKey}`);
  assert(container.querySelector(".reel .team").textContent === TEAMS[after.boards[0].followKey.split("|")[0]][0],
    "which is what their screen now shows");
  assert(auth._versus._matches.get(code).respins.length === 1, "the match recorded it");
  assert(before.pickNo === after.pickNo, "and it cost no pick");
  assert(findButtonByText(container, "Re-spin era").disabled, "with none of that kind left");
});

await runTest("the powerups show for both players, and say who has spent what", async () => {
  const code = matchCode;
  await openMatch("beta@x.test", code);
  // Named here rather than imported: node cannot load a .jsx, and naming them makes the test fail loudly if
  // one is ever quietly dropped from the bar.
  const EXPECTED = ["Team", "Era", "Double", "Steal"];
  const labels = [...container.querySelectorAll(".vs-powers .btn")].map((b) => b.textContent.replace(/\s+/g, " ").trim());
  assert(labels.length === EXPECTED.length + 1, `every powerup plus the rules button: ${JSON.stringify(labels)}`);
  for (const short of EXPECTED) assert(labels.some((l) => l.includes(short)), `${short} is on the bar`);

  // And a track under each roster, so a player can see what the other still holds without remembering it.
  const tracks = [...container.querySelectorAll(".vs-track")];
  assert(tracks.length === 2, `one track per player, got ${tracks.length}`);
  // A literal, not EXPECTED.length. Derived from the same list it is checking, dropping a powerup from both
  // passed - which is exactly what the comment above promises it will not do.
  assert(tracks.every((t) => t.querySelectorAll("li").length === 4), "each showing all four");
  // A spent one reads as spent without colour - struck through, and said in words for a screen reader.
  const spent = [...container.querySelectorAll(".vs-track .vs-tk")].filter((li) => li.classList.contains("spent"));
  assert(spent.every((li) => li.textContent.includes("used")), "a spent powerup says so in words");
});

await runTest("the screen keeps reading even while it is your own turn", async () => {
  // The other player can act DURING your turn - a steal takes the pick you just made. A screen that stopped
  // reading whenever it believed it was its turn would never learn it had stopped being, and Realtime is not
  // something to bet the draft on.
  const code = matchCode;
  await openMatch("beta@x.test", code);
  assert(container.querySelector(".versus").dataset.view === "draft", "the draft is on screen");

  // Flip the sides behind the screen's back, and touch nothing else.
  const m = auth._versus._matches.get(code);
  const wasHost = m.host_id;
  m.host_id = m.guest_id;
  m.guest_id = wasHost;
  for (let i = 0; i < 40 && container.querySelector(".vs-turn")?.textContent === "Your pick"; i++) await flush();
  await flush();
  assert(container.querySelector(".vs-turn")?.textContent !== "Your pick",
    `the screen noticed without being told: ${container.querySelector(".vs-turn")?.textContent}`);
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
  assert(heads.includes("Duels"), `the duel board is on the Leaderboard: ${JSON.stringify(heads)}`);

  const board = [...container.querySelectorAll("table.lb")].find((t) => t.textContent.includes("2–0"));
  assert(board, `with the records on it: ${text(container).slice(0, 200)}`);
  const first = board.querySelector("tbody tr");
  assert(first.textContent.includes("beta") && first.textContent.includes("2"), `best record first: ${first.textContent}`);
  // And nothing about it moved the career record, which is the line VERSUS.md 1 draws.
  assert(!beta.wins && !beta.champs, "a 1v1 win is not a season win");
});

// The moment a match ends, on the screen of whoever did NOT make the last pick.
//
// The Edge Function writes the sixteenth pick, then reads back, grades, and sets the status - three calls, not
// one transaction. match_picks is in the Realtime publication, so the other player's screen is told about that
// insert while the rest is still in flight, and for that beat the rows say the draft is over while the match
// row still says `drafting`. replayMatch returns turn: null there. The draft view read state.turn.side straight
// through, and with no error boundary anywhere in the app that unmounted the whole root - a blank page, landing
// on the loser, at the exact moment they were owed a result.
await runTest("the last pick lands on the other screen before the result does", async () => {
  // Two accounts of its own: the ones above are already in a match, and create_match now hands a player back
  // the match they are in rather than opening a second one.
  await signUp("delta@x.test", "delta");
  await signUp("epsilon@x.test", "epsilon");
  await signIn("delta@x.test");
  const code = (await auth.rpc("create_match", {})).data.code;
  await signIn("epsilon@x.test");
  await auth.rpc("join_match", { p_code: code });

  // Play it to the end the way the clock would, taking the best available option every turn.
  for (let i = 0; i < MATCH_PICKS; i++) {
    const st = auth._versus._replay(code);
    if (!st || st.done || !st.turn) break;
    await signIn(st.turn.side === "host" ? "delta@x.test" : "epsilon@x.test");
    const best = autoPick(st.boardKey, st.taken, st.roster[st.turn.side], "fantasy");
    const o = best.option;
    pastOpeningWindow(code); // a board's first pick waits ten seconds; these tests are not about waiting
    const res = await auth._versus.invokeMatchPick({
      code, boardIdx: st.boardIdx, kind: o.kind, slot: best.slot,
      playerId: o.kind === "player" ? o.id : undefined,
      team: o.kind === "player" ? undefined : o.team, season: o.season,
    });
    assert(!res.error, `pick ${st.pickNo}: ${JSON.stringify(await res.error?.context?.json?.() ?? res.error)}`);
  }
  const done = auth._versus._matches.get(code);
  assert(done.status === "done" && done.result, `the match finished: ${JSON.stringify(done.status)}`);

  // Rewind to the window between the sixteenth pick landing and the status catching up - which is a state the
  // server really does publish, not a hypothetical.
  done.status = "drafting";
  done.result = null;
  assert(auth._versus._replay(code).done === true, "the rows say the draft is over");

  await openMatch("delta@x.test", code);
  const screen = versus();
  assert(screen, "the screen is still mounted - it used to take the whole app down here");
  assert(screen.dataset.view === "grading", `and says what is happening: ${screen.dataset.view}`);
  assert(text(screen).includes("Working out the result"), `in words: ${text(screen).slice(0, 120)}`);

  // And it does not just sit there. The poll only READS, so before this nothing ever poked the server: a
  // finish that failed left the row on `drafting` with all sixteen picks in, and both screens waited on it
  // forever while create_match handed them back into the dead match for every duel afterwards. The screen
  // asks the server to finish, and any request does it.
  for (let i = 0; i < 12 && auth._versus._matches.get(code).status !== "done"; i++) {
    await new Promise((r) => setTimeout(r, 120));
    await flush();
  }
  assert(auth._versus._matches.get(code).status === "done",
    `the screen asked the server to finish, and it did: ${auth._versus._matches.get(code).status}`);

  // Then the status catches up, the way the poll finds it two seconds later, and the result is there.
  done.status = "done";
  done.result = auth._versus._matches.get(code).result
    || { winner: "host", margin: 1, host: { score: 1, against: 0, points: 7 }, guest: { score: 0, against: 0, points: 3 } };
  await openMatch("delta@x.test", code);
  assert(versus().dataset.view === "done", `and then the result: ${versus().dataset.view}`);
});

// A steal, driven through the buttons, in the real app.
//
// This is the test that was missing, and the gap was exactly where the bug was. Every other suite drives the
// rules directly, or reads the mock's own state - so all of them passed while `steals` was dropped twice on the
// CLIENT read path: mapMatch never named the new record, and the screen's replayMatch call omitted it. The
// effect was a deadlock. The victim's screen said it was not their turn, the thief's said it still was, and
// neither could move until the clock ran out. The seam between the client's mapper and the screen had no test.
await runTest("a steal through the buttons moves the player on both screens", async () => {
  await signUp("zeta@x.test", "zeta");
  await signUp("eta@x.test", "eta");
  await signIn("zeta@x.test");
  const code = (await auth.rpc("create_match", {})).data.code;
  await signIn("eta@x.test");
  await auth.rpc("join_match", { p_code: code });

  // Two picks in, so each side owns somebody.
  for (let i = 0; i < 2; i++) {
    const st = auth._versus._replay(code);
    await signIn(st.turn.side === "host" ? "zeta@x.test" : "eta@x.test");
    const best = autoPick(st.boardKey, st.taken, st.roster[st.turn.side], "fantasy");
    const o = best.option;
    pastOpeningWindow(code);
    await auth._versus.invokeMatchPick({
      code, boardIdx: st.boardIdx, kind: o.kind, slot: best.slot,
      playerId: o.kind === "player" ? o.id : undefined,
      team: o.kind === "player" ? undefined : o.team, season: o.season,
    });
  }

  const before = auth._versus._replay(code);
  const thiefSide = before.turn.side;
  const victimSide = thiefSide === "host" ? "guest" : "host";
  const thiefEmail = thiefSide === "host" ? "zeta@x.test" : "eta@x.test";
  // A player rather than a defense or a kicker, so the name on screen is just his name - versus.jsx owns
  // optionName and node cannot import a .jsx.
  const mine2 = VERSUS_SLOTS.map((sl) => before.roster[victimSide][sl]).find((o) => o && o.kind === "player");
  const theirName = mine2?.name;
  assert(theirName, `the other player owns a player to take: ${JSON.stringify(VERSUS_SLOTS.map((sl) => before.roster[victimSide][sl]).filter(Boolean).map((o) => o.kind))}`);

  await openMatch(thiefEmail, code);
  assert(versus().dataset.view === "draft", `the thief is on the draft screen: ${versus().dataset.view}`);

  // Arm the steal, then tap them on the other roster - which is the whole UI for it.
  await click(findButtonByText(container, "Steal"));
  await flush();
  const grab = [...container.querySelectorAll(".vs-them .vs-grab")];
  assert(grab.length > 0, `their filled slots become buttons: ${text(container).slice(0, 160)}`);
  const target = grab.find((b) => b.textContent.includes(theirName)) || grab[0];
  await click(target);
  await flush();
  await flush();

  // The match itself.
  const m = auth._versus._matches.get(code);
  assert(m.steals.length === 1, `the steal is on the match: ${JSON.stringify(m.steals)}`);

  // And the screen agrees with the server, which is the part that was broken. The thief holds him; the player
  // who was robbed is on the clock, because the thief spent their turn taking him.
  const after = auth._versus._replay(code);
  assert(VERSUS_SLOTS.some((sl) => after.roster[thiefSide][sl] && optionId(after.roster[thiefSide][sl]) === optionId(mine2)),
    "he is on the thief's roster");
  const yours = container.querySelector(".vs-side:not(.vs-them)");
  assert(text(yours).includes(theirName), `and the screen shows him on YOUR roster: ${text(yours).slice(0, 200)}`);
  const theirs = container.querySelector(".vs-them");
  assert(!text(theirs).includes(theirName), `and off theirs: ${text(theirs).slice(0, 200)}`);
  assert(after.turn.side === victimSide, `the robbed player is on the clock: ${after.turn.side}`);
  assert(text(container).includes("is picking"), `so the thief's screen says it is not their turn: ${text(container).slice(0, 120)}`);
});

// The draft keeps a clock ticking and a Realtime channel open, both of which would hold the process open
// after the last assertion - so the screen comes down the way a player leaving it would take it down.
// After the matches above, not among them: it opens a lobby of its own, and who leads board one is seeded on
// the match code, so an extra match in the middle re-deals the one the board tests share. It stays above
// the reactRoot.unmount() below, which is where the mounted app ends.
await runTest("the lobby sends a written invitation, not an address", async () => {
  // Matchmaking is entirely "get this link to one person", and that person is almost always reached in a text.
  // A bare URL says neither who sent it nor what it is - and whoever opens it first IS the opponent, so it has
  // to be worth opening. The button hands the device's share sheet a message instead of loading the clipboard.
  const clip = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
  const ua = window.navigator.userAgent;
  // The test above leaves the app inside a match, where there are no tabs to reach the Account panel by.
  await goHome();
  await signUp("inviter@x.test", "inviter");
  await goHome();
  await clickMode(container, "Duel");
  await flush();
  await click(findButtonByText(container, "Open a lobby"));
  await flush();
  const code = versus().dataset.code;

  // A computer, where there is no sheet: the same message goes to the clipboard, so what gets pasted into a
  // chat is still a sentence. The link is on screen to read either way.
  let copied = null;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  await click(findButtonByText(container, "Invite a friend"));
  await flush();
  assert(copied, "the invitation went somewhere");
  assert(copied.includes("inviter"), `it says who is asking: ${JSON.stringify(copied)}`);
  assert(/invited you to a duel/i.test(copied), `and what it is: ${JSON.stringify(copied)}`);
  assert(copied.trim().endsWith(`/vs/${code}`), `with the link last: ${JSON.stringify(copied)}`);
  assert(findButtonByText(container, "Copied"), "and the button says what actually happened");

  // A phone, which is the whole point of this: the sheet takes it, and nothing is copied behind its back.
  let shared = null;
  Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone)", configurable: true });
  Object.defineProperty(window.navigator, "share", { value: async (d) => { shared = d; }, configurable: true });
  copied = null;
  await click(findButtonByText(container, "Copied") || findButtonByText(container, "Invite a friend"));
  await flush();
  assert(shared, "the share sheet was offered it");
  assert(shared.text.includes(`/vs/${code}`), `the sheet got the invitation: ${JSON.stringify(shared)}`);
  assert(copied === null, "and it was not also dumped on the clipboard");
  assert(findButtonByText(container, "Invite sent"), "the button says it was sent");

  // Closing the sheet is a choice, not a failure. The half that bites is the clipboard: falling through to
  // it would send the invitation after they had decided not to. The label assertion under it is weaker than it
  // looks - INVITE_SAID has no words for "cancelled", so the button reads the same either way - and it is here
  // to catch somebody giving it some.
  Object.defineProperty(window.navigator, "share", {
    value: async () => { throw Object.assign(new Error("closed"), { name: "AbortError" }); }, configurable: true });
  await click(findButtonByText(container, "Invite sent") || findButtonByText(container, "Invite a friend"));
  await flush();
  assert(copied === null, "an abandoned share sheet does not fall through to the clipboard");
  assert(!findButtonByText(container, "Copied"), "and the button claims nothing");

  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  delete window.navigator.share;
  if (clip) Object.defineProperty(window.navigator, "clipboard", clip);
});

reactRoot.unmount();
// Every refusal the rules can give has words on the screen, and every set of words belongs to a refusal the
// rules can still give. Both halves have been wrong: `would_strand` stayed in the map for a release after the
// rule that raised it was deleted, and two new refusals went in before their copy did - which reaches a player
// as "That didn't work" over a board that looks perfectly fine.
await runTest("every refusal the server can give has words, and no words are orphaned", async () => {
  setupDom();
  const { errorText } = await loadModule("versus.jsx");
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const rules = src("../versus-logic.mjs");
  const raised = [...rules.matchAll(/refuse\(\s*"([a-z_]+)"/g)].map((x) => x[1]);
  assert(raised.length > 15, `found the refusals in versus-logic.mjs: ${raised.length}`);
  const mute = [...new Set(raised)].filter((r) => errorText(r) === "That didn't work.");
  assert(mute.length === 0, `each one has words: ${JSON.stringify(mute)}`);

  // The other way round, searched rather than listed: a refusal reaches the screen from the rules, from the
  // Edge Function's own answers, or from the client's own storage layer, so a set of words is orphaned only
  // when the string appears in none of the three.
  const sources = [rules, src("../supabase/functions/match-pick/index.ts"), src("../storage-versus.js")];
  const screen = [...src("../versus.jsx").matchAll(/^  ([a-z_]+): "/gm)].map((x) => x[1]);
  const orphans = screen.filter((r) => !sources.some((s) => s.includes(JSON.stringify(r))));
  assert(orphans.length === 0, `no words for a refusal nothing can raise: ${JSON.stringify(orphans)}`);
});

console.log("test-versus-screen.mjs done");
