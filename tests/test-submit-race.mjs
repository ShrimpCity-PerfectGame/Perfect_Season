// Two submissions that overlap must both land. Neither may quietly overwrite the other.
//
// submit-run applies a season by reading the whole profile row, working out the new one with
// game-logic.mjs's applyRun/applyDnf, and writing it all back. The rules are decided outside the
// database - deliberately, so there is one copy of them and not a second in SQL - which means the
// database cannot hold a lock across the decision the way wallet_lock does for the wallet. There are
// two whole round trips inside that gap (the guest check and the duplicate guard), and until every
// write carried the revision it was computed from, a second request could read the same row and write
// last.
//
// It needed no attacker. `finish()` does not await the submission, so the result screen is live while
// the season is still in flight, and "Run it back" fires a DNF as its own request - much shorter,
// because it has no replay, no sim and no botPar - which read first and wrote last. The finished
// season vanished from `profiles` while `finished_codes` kept the code and the ledger kept the coins,
// so the retry answered "already recorded" and a new personal best was gone for good.
//
// The mock mirrors index.ts here, including the retry, and `_pauseBeforeProfileWrite` is what lets a
// test stand in the gap the real function cannot avoid having.
import { assert, runTest, makeMockAuth, setupDom } from "./helpers.mjs";
import { initGameData } from "../game-logic.mjs";
import { readFileSync } from "node:fs";

setupDom();
const players = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
initGameData(players.players, players.opponents);

// A finished season, drafted the way the app drafts one - `boardAt` decides which board comes next,
// so no board with a legal pick is ever passed over and submit-run's replay accepts the trace. Same
// shape as tests/test-replay-verification.mjs's builder.
const GL = await import("../game-logic.mjs");
function playedSeason(code) {
  const seq = GL.seededSequence(code);
  const roster = {};
  const drafted = new Set();
  const history = [];
  let seqIdx = GL.boardAt(seq, 0, roster);
  for (let pick = 0; pick < GL.SLOTS.length; pick++) {
    const key = seq[seqIdx];
    const open = GL.SLOTS.filter((s) => !roster[s]);
    const player = GL.BOARDS[key].find((p) => !drafted.has(p.id) && open.some((s) => GL.fits(p.pos, s)));
    const slot = open.find((s) => GL.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot });
    roster[slot] = player;
    drafted.add(player.id);
    if (pick < GL.SLOTS.length - 1) seqIdx = GL.boardAt(seq, seqIdx + 1, roster);
  }
  return { mode: { kind: "free", code }, history, seq };
}
// The mock answers a refusal the way the real function does - a body carrying `error`, not a thrown
// one - so a test that only checks `res.error` reads every refusal as a success.
const failed = (res) => res.error || res.data?.error || null;

await runTest("a finished season and a DNF that overlap both land", async () => {
  const sb = makeMockAuth();
  await sb.auth.signUp({ email: "racer@x.test", password: "password1", options: { data: { username: "Racer" } } });

  // One season first, so there is something to overwrite and a best score to lose.
  const first = await sb.functions.invoke("submit-run", { body: playedSeason("RACE01") });
  assert(!failed(first), `the first season saved: ${JSON.stringify(failed(first))}`);
  const after1 = { ...sb._profiles.get([...sb._profiles.keys()][0]) };
  assert(after1.runs === 1, `one run recorded: ${after1.runs}`);

  // Now the real shape: a season in flight, and "Run it back" firing a DNF inside the gap between
  // that season's read of the profile and its write.
  let release;
  const gap = new Promise((r) => { release = r; });
  sb._pauseBeforeProfileWrite(() => gap);

  const seasonPromise = sb.functions.invoke("submit-run", { body: playedSeason("RACE02") });
  // Let the season get as far as its paused write, then land the DNF completely.
  await new Promise((r) => setTimeout(r, 0));
  const dnf = await sb.functions.invoke("submit-run", { body: { dnf: true, picks: 3, mode: "unlimited" } });
  assert(!failed(dnf), `the DNF landed: ${JSON.stringify(failed(dnf))}`);
  release();
  const season = await seasonPromise;
  assert(!failed(season), `and the season still saved: ${JSON.stringify(failed(season))}`);

  const end = sb._profiles.get([...sb._profiles.keys()][0]);
  // Both, not one: two finished seasons and one abandoned draft.
  assert(end.runs === 2, `both seasons counted, not one: runs=${end.runs}`);
  assert(end.dnf === 1, `and the DNF counted: dnf=${end.dnf}`);
  // The wins of the second season are in there too - the counters were applied on top of the DNF,
  // not instead of it. Off the old code `runs` came back 1 and the season's score was gone.
  assert(end.rev >= 3, `every write bumped the revision: rev=${end.rev}`);
});

await runTest("two finished seasons that overlap both count", async () => {
  const sb = makeMockAuth();
  await sb.auth.signUp({ email: "two@x.test", password: "password1", options: { data: { username: "TwoTabs" } } });

  let release;
  const gap = new Promise((r) => { release = r; });
  sb._pauseBeforeProfileWrite(() => gap);

  const a = sb.functions.invoke("submit-run", { body: playedSeason("RACE03") });
  await new Promise((r) => setTimeout(r, 0));
  const b = await sb.functions.invoke("submit-run", { body: playedSeason("RACE04") });
  assert(!failed(b), `the second tab's season saved: ${JSON.stringify(failed(b))}`);
  release();
  const aDone = await a;
  assert(!failed(aDone), `and the first tab's did too: ${JSON.stringify(failed(aDone))}`);

  const end = sb._profiles.get([...sb._profiles.keys()][0]);
  assert(end.runs === 2, `two seasons, two runs: ${end.runs}`);
  // `runs` and the runs log have to agree - this is the pair that ended up permanently inconsistent.
  const logged = [...sb._runs.values()].flat().filter((r) => !r.dnf).length;
  assert(logged === 2, `and the runs log holds both: ${logged}`);
});

console.log("test-submit-race.mjs done");
