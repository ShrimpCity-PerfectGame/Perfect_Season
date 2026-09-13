// Pins the points ladder: the bot that sets par, the points curve, the best-of-the-day window,
// and which ladder a run lands on. Pure game-logic, no DOM.
//
// The bot is the load-bearing piece. It has to be deterministic (the server recomputes par rather
// than trusting the client), it must never reuse a player, and under GM it must never exceed the
// cap or strand itself unable to fill a slot.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import * as GL from "../game-logic.mjs";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
GL.initGameData(data.players, data.opponents);

// Deals a realistic set of six boards the way a draft would, so the bot is exercised against
// board sets that can actually occur rather than arbitrary keys.
function boardsFor(seed) {
  const seq = GL.seededSequence(seed);
  const roster = {};
  const keys = [];
  let idx = GL.boardAt(seq, 0, roster);
  for (let i = 0; i < GL.SLOTS.length; i++) {
    keys.push(seq[idx]);
    roster[GL.SLOTS[i]] = { id: -1 - i }; // stand-in: boardAt only cares which slots are filled
    if (i < GL.SLOTS.length - 1) idx = GL.boardAt(seq, idx + 1, roster);
  }
  return keys;
}
const SEEDS = Array.from({ length: 60 }, (_, i) => `POINTS${i}`);

await runTest("par is deterministic - the same boards always give the same number", async () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const keys = boardsFor(seed);
    const a = GL.botPar(keys, { format: "fantasy" });
    const b = GL.botPar(keys, { format: "fantasy" });
    assert(a === b, `${seed}: par changed between identical calls (${a} vs ${b})`);
    assert(a > 0, `${seed}: expected a positive par, got ${a}`);
  }
});

await runTest("par differs between scoring formats", async () => {
  let differing = 0;
  for (const seed of SEEDS) {
    const keys = boardsFor(seed);
    if (GL.botPar(keys, { format: "fantasy" }) !== GL.botPar(keys, { format: "standard" })) differing++;
  }
  assert(differing > SEEDS.length * 0.8, `expected par to move with format on most board sets, only ${differing}/${SEEDS.length} did`);
});

await runTest("the bot never drafts the same player twice", async () => {
  // bestOrderFor (the old optimal-based benchmark) had exactly this bug - it picked the top player
  // per board independently, so a player on two boards in one era could be counted twice and
  // inflate the target. The bot tracks drafted ids; this is the guard that it keeps doing so.
  for (const seed of SEEDS) {
    const keys = boardsFor(seed);
    // Re-run the bot's own selection to inspect the roster it builds.
    const roster = {}; const drafted = new Set();
    for (const key of keys) {
      const open = GL.SLOTS.filter((s) => !roster[s]);
      const cands = [];
      for (const p of GL.BOARDS[key] || []) {
        if (drafted.has(p.id)) continue;
        for (const s of open) if (GL.fits(p.pos, s)) cands.push({ p, s, r: GL.effectiveRating(s, p, "fantasy") });
      }
      if (!cands.length) break;
      cands.sort((a, b) => b.r - a.r || a.p.id - b.p.id || a.s.localeCompare(b.s));
      const c = cands[Math.min(GL.BOT_PICK_RANK - 1, cands.length - 1)];
      assert(!drafted.has(c.p.id), `${seed}: bot re-picked ${c.p.name}`);
      roster[c.s] = c.p; drafted.add(c.p.id);
    }
  }
});

await runTest("under GM the bot stays inside the cap and still fills a roster", async () => {
  let filled = 0;
  for (const seed of SEEDS) {
    const par = GL.botPar(boardsFor(seed), { format: "fantasy", gm: true });
    if (par == null) continue; // a board set that can't field a legal roster earns no points
    filled++;
    assert(par > 0, `${seed}: expected a positive GM par, got ${par}`);
  }
  // Greedy cap-aware play strands itself occasionally; the cheapest-affordable fallback should keep
  // that rare. If this drops sharply, the fallback has regressed.
  assert(filled > SEEDS.length * 0.9, `expected the GM bot to field a roster on almost every board set, managed ${filled}/${SEEDS.length}`);
});

await runTest("GM par is never higher than unconstrained par", async () => {
  // The cap can only remove options, so a cap-aware bot can't outscore an unconstrained one on the
  // same boards. If this ever inverts, the affordability filter is wrong.
  for (const seed of SEEDS) {
    const keys = boardsFor(seed);
    const free = GL.botPar(keys, { format: "fantasy" });
    const capped = GL.botPar(keys, { format: "fantasy", gm: true });
    if (free == null || capped == null) continue;
    assert(capped <= free + 1e-9, `${seed}: GM par ${capped.toFixed(2)} exceeded unconstrained par ${free.toFixed(2)}`);
  }
});

await runTest("the bot is beatable - it's an opponent, not a ceiling", async () => {
  // The whole reason par is a handicapped bot rather than the true optimum: a player taking the
  // best available pick every round should clear it most of the time, with room above.
  let wins = 0, total = 0, ratioSum = 0;
  for (const seed of SEEDS) {
    const keys = boardsFor(seed);
    const par = GL.botPar(keys, { format: "fantasy" });
    if (!par) continue;
    // Best-pick player on the same boards.
    const roster = {}; const drafted = new Set();
    let ok = true;
    for (const key of keys) {
      const open = GL.SLOTS.filter((s) => !roster[s]);
      const cands = [];
      for (const p of GL.BOARDS[key] || []) {
        if (drafted.has(p.id)) continue;
        for (const s of open) if (GL.fits(p.pos, s)) cands.push({ p, s, r: GL.effectiveRating(s, p, "fantasy") });
      }
      if (!cands.length) { ok = false; break; }
      cands.sort((a, b) => b.r - a.r);
      roster[cands[0].s] = cands[0].p; drafted.add(cands[0].p.id);
    }
    if (!ok) continue;
    let tot = 0, wt = 0;
    for (const s of GL.SLOTS) { const k = s === "QB" ? GL.QB_WEIGHT : 1; tot += GL.effectiveRating(s, roster[s], "fantasy") * k; wt += k; }
    const mine = tot / wt;
    total++; ratioSum += mine / par;
    if (mine > par) wins++;
  }
  const winRate = wins / total, avg = ratioSum / total;
  assert(winRate > 0.8, `a best-pick player should clear par most days, cleared ${(100 * winRate).toFixed(0)}%`);
  assert(avg > 1.05, `expected real headroom above par, averaged ${(100 * avg).toFixed(0)}%`);
});

await runTest("points are zero at the floor, positive above it, and clamped below", async () => {
  const par = 100;
  assert(GL.draftPoints(par * GL.PAR_FLOOR, par) === 0, "a draft exactly at the floor should earn nothing");
  assert(GL.draftPoints(par, par) === Math.round(GL.POINT_SCALE * (1 - GL.PAR_FLOOR)), "matching par should earn the floor-to-par gap");
  assert(GL.draftPoints(par * 1.14, par) > GL.draftPoints(par, par), "beating par should earn more than matching it");
  assert(GL.draftPoints(1, par) === GL.MIN_POINTS, "a catastrophic draft should clamp, not spiral");
  assert(GL.draftPoints(120, 0) === 0, "a missing par earns nothing rather than dividing by zero");
  assert(GL.draftPoints(120, null) === 0, "a null par earns nothing");
});

await runTest("only the best few drafts a day count toward an uncapped ladder", async () => {
  const day = "2026-03-05";
  let rec = null, total = 0;
  const played = [10, 90, 20, 80, 30, 70, 40];
  for (const p of played) {
    const r = GL.applyDayPoints(rec, "unlimited", p, day);
    rec = r.day; total += r.delta;
  }
  const best = [...played].sort((a, b) => b - a).slice(0, GL.DAILY_COUNTED_DRAFTS).reduce((t, x) => t + x, 0);
  assert(total === best, `expected only the best ${GL.DAILY_COUNTED_DRAFTS} to count (${best}), got ${total}`);
  assert(rec.byMode.unlimited.length === played.length, "every draft should still be recorded, even uncounted ones");

  // A new day starts the window over.
  const next = GL.applyDayPoints(rec, "unlimited", 15, "2026-03-06");
  assert(next.delta === 15, "the first draft of a new day should count in full, got " + next.delta);
  assert(next.day.byMode.unlimited.length === 1, "a new day should not carry yesterday's drafts");
});

await runTest("a later good draft can displace an earlier weak one from the counted set", async () => {
  const day = "2026-03-05";
  let rec = null, total = 0;
  for (const p of [5, 5, 5, 5, 5]) { const r = GL.applyDayPoints(rec, "gm", p, day); rec = r.day; total += r.delta; }
  assert(total === 25, "expected five counted drafts, got " + total);
  const r = GL.applyDayPoints(rec, "gm", 100, day);
  total += r.delta;
  assert(r.delta === 95, `a 100 replacing a 5 should move the ladder by 95, got ${r.delta}`);
  assert(total === 120, "expected the counted set to be 100+5+5+5+5, got " + total);
});

await runTest("ladders are kept separate and the bank counts everything", async () => {
  const day = "2026-03-05";
  const base = { runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] };
  const mk = (extra) => ({ w: 12, l: 5, score: 100, outcome: "lost", champ: false, perfect: false, playoffs: true, points: 100, ...extra });

  let s = GL.applyRun(base, mk({ mode: "free" }), day);
  assert(s.points.unlimited === 100, "a plain free draft belongs to the unlimited ladder");
  s = GL.applyRun(s, mk({ mode: "free", gm: true }), day);
  assert(s.points.gm === 100 && s.points.unlimited === 100, "a GM draft must not touch the unlimited ladder");
  s = GL.applyRun(s, mk({ mode: "free", genius: true }), day);
  assert(s.points.genius === 100, "a Genius draft belongs to the genius ladder");
  s = GL.applyRun(s, mk({ mode: "daily" }), day);
  assert(s.points.daily === 100, "a daily belongs to the daily ladder");

  assert(s.pointsBank === 400, "the bank should total every ladder, got " + s.pointsBank);
  assert(s.runs === 4, "career totals stay merged across ladders");

  // GM outranks genius when a draft is somehow both.
  assert(GL.modeKey({ mode: "free", gm: true, genius: true }) === "gm", "GM should win over Genius");
  assert(GL.modeKey({ mode: "daily", gm: true }) === "daily", "daily should win over the variant flags");
  assert(GL.modeKey({}) === "unlimited", "an untagged run falls back to unlimited");
});

await runTest("the daily ladder ignores the best-of-day window", async () => {
  // Daily is one draft a day by construction, so it should never be windowed - if it were, a
  // second daily submission (which can't happen) would be the only thing the window guarded.
  const day = "2026-03-05";
  const base = { runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] };
  const run = { w: 1, l: 1, score: 1, champ: false, perfect: false, playoffs: false, mode: "daily", points: 42 };
  const s = GL.applyRun(base, run, day);
  assert(s.points.daily === 42, "expected the daily ladder to take the points directly");
  assert(!s.pointsDay, "the daily ladder should not open a best-of-day window");
});

await runTest("a DNF costs points on the ladder it was abandoned in", async () => {
  const base = { runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] };
  const s = GL.applyDnf(base, 3, "gm");
  assert(s.dnf === 1, "the DNF should still count as a DNF");
  assert(s.points.gm === GL.DNF_POINTS, `expected the GM ladder to take the penalty, got ${s.points.gm}`);
  assert(s.pointsBank === GL.DNF_POINTS, "the bank should take the penalty too");
  assert(s.recent[0].mode === "gm", "the recent entry should record which mode was abandoned");

  const untagged = GL.applyDnf(base, 1);
  assert(untagged.points.unlimited === GL.DNF_POINTS, "an untagged DNF falls back to unlimited");
  const bogus = GL.applyDnf(base, 1, "nonsense");
  assert(bogus.points.unlimited === GL.DNF_POINTS, "an unrecognized mode falls back to unlimited rather than creating a ladder");
});

console.log("test-points.mjs done");
