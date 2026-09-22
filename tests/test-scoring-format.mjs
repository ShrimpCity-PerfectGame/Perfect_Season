// Pins the two scoring formats' math. No DOM - this is pure game-logic.mjs, so it's the fastest
// and most load-bearing check in the suite: if the fantasy path here moves even slightly, every
// score already on the leaderboard has silently changed meaning.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import * as GL from "../game-logic.mjs";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
GL.initGameData(data.players, data.opponents);

const all = Object.values(GL.BOARDS).flat();
const find = (name, season, team) =>
  all.find((p) => p.name === name && p.season === season && (!team || p.team === team));

await runTest("standard points are exactly ppr minus receptions, for every player", async () => {
  assert(all.length > 3000, "expected the full board pool, got " + all.length);
  for (const p of all) {
    const want = Math.round((p.ppr - p.rec) * 1e6) / 1e6;
    const got = Math.round(p.stdPoints * 1e6) / 1e6;
    assert(want === got, `${p.name} ${p.season}: stdPoints ${got} != ppr-rec ${want}`);
  }
});

await runTest("no standard rating exceeds the cap", async () => {
  for (const p of all) {
    assert(p.stdRating <= GL.RATING_CAP, `${p.name} ${p.season} stdRating ${p.stdRating} > ${GL.RATING_CAP}`);
  }
});

await runTest("the motivating case inverts: Landry outranks Parker on PPR, Parker outranks him on standard", async () => {
  const landry = find("Jarvis Landry", 2017, "MIA");
  const parker = find("DeVante Parker", 2019, "MIA");
  assert(landry && parker, "expected both Dolphins receivers on the 2016-2020 board");

  // Full PPR: Landry's 40 extra catches outweigh Parker's 215 extra yards.
  assert(landry.rating > parker.rating, `expected Landry (${landry.rating}) above Parker (${parker.rating}) on PPR`);
  const near = (a, b) => Math.abs(a - b) < 0.15;
  assert(near(landry.stdRating, 81.7), "expected Landry's standard rating near 81.7, got " + landry.stdRating.toFixed(2));
  assert(near(parker.stdRating, 96.2), "expected Parker's standard rating near 96.2, got " + parker.stdRating.toFixed(2));
  assert(parker.stdRating > landry.stdRating, "expected the ordering to invert under standard scoring");
});

await runTest("the efficiency adjustment is recomputed, not inverted out of a capped stored rating", async () => {
  // LaDainian Tomlinson 2003 is one of the 40 seasons whose stored `rating` was clamped at the
  // cap. Recovering the efficiency term by subtracting a production estimate from that clamped
  // value loses everything the clamp discarded - it lands near 117 instead of the cap. If this
  // ever fails, someone has "simplified" efficiencyAdj into an inversion.
  const lt = find("LaDainian Tomlinson", 2003);
  assert(lt, "expected LaDainian Tomlinson's 2003 season on a board");
  assert(lt.stdRating === GL.RATING_CAP, `expected ${GL.RATING_CAP}, got ${lt.stdRating.toFixed(1)} - efficiencyAdj may have been inverted rather than recomputed`);
});

await runTest("omitting the format argument reproduces the original full-PPR grading exactly", async () => {
  // The backwards-compatibility guarantee: every pre-existing call site passes no format.
  for (const p of all.slice(0, 400)) {
    assert(GL.effectiveRating("QB", p) === p.rating, `named slot, no format: ${p.name} should be raw rating`);
    assert(GL.effectiveRating("QB", p, "fantasy") === p.rating, "explicit fantasy should match");
    assert(GL.effectiveRating("FLEX1", p) === GL.flexRating(p), "flex, no format, should match flexRating");
    assert(GL.playerSalary(p) === GL.playerSalary(p, "fantasy"), "salary: omitted format should equal fantasy");
  }
});

await runTest("an unknown or missing format falls back to fantasy everywhere", async () => {
  const p = all[0];
  for (const bogus of [undefined, null, "", "nonsense", "STANDARD", "championship"]) {
    assert(GL.normFormat(bogus) === "fantasy", `normFormat(${JSON.stringify(bogus)}) should be fantasy`);
    assert(GL.effectiveRating("QB", p, bogus) === p.rating, "unknown format must grade as fantasy");
  }
  assert(GL.normFormat("standard") === "standard", "standard should normalize to itself");
});

await runTest("standard flex rating draws on the standard pool, not the PPR pool", async () => {
  // A flex rating is a pool z-score rescale, so if the standard pool stats weren't wired up the
  // two formats would agree everywhere.
  const flex = all.filter((p) => GL.FLEX_POS.includes(p.pos) && p.ppr > 50);
  const moved = flex.filter((p) => Math.abs(GL.flexRating(p, "standard") - GL.flexRating(p, "fantasy")) > 0.5);
  assert(moved.length > flex.length * 0.8, `expected most flex ratings to move between formats, only ${moved.length} of ${flex.length} did`);

  // Direction is what the format is *for*, and it tracks how much of a player's production was
  // receptions - not raw catch count. A 90-catch back with heavy rushing yardage correctly rises;
  // a receiver who got there on volume falls.
  const share = (p) => p.rec / p.ppr;
  for (const p of flex) {
    const fan = GL.flexRating(p, "fantasy"), std = GL.flexRating(p, "standard");
    // A player clamped at the cap in both formats can't show movement - the clamp hides it. That's
    // the cap working, not the format failing to apply, so those are out of scope here.
    if (fan >= GL.RATING_CAP && std >= GL.RATING_CAP) continue;
    const delta = std - fan;
    if (share(p) > 0.4) assert(delta < 0, `${p.name} ${p.season} earned ${(100 * share(p)).toFixed(0)}% of his points on receptions and should fall, moved ${delta.toFixed(2)}`);
    if (share(p) < 0.2) assert(delta > 0, `${p.name} ${p.season} barely scored on receptions and should rise, moved ${delta.toFixed(2)}`);
  }
});

await runTest("Flex is deliberately uncapped, so an all-time season can show its full value", async () => {
  // This is intended behaviour, not an oversight - it's the one slot where a season above the cap
  // isn't clipped, which is why your best player usually belongs in Flex. Pinned because it looks
  // like a bug from the outside and has already been "fixed" once by mistake. If you're changing
  // this, change the player-facing explanations with it (the grading note under the graded roster,
  // the Best possible order note, HowTo, and SCORING.md) - it was only ever confusing because it
  // went unexplained.
  const over = all.filter((p) => GL.FLEX_POS.includes(p.pos) && GL.flexRating(p, "fantasy") > GL.RATING_CAP);
  assert(over.length > 0, "expected some all-time seasons to rate above the cap in Flex");

  const mcc = all.find((p) => p.name === "Christian McCaffrey" && p.season === 2019);
  assert(mcc, "expected McCaffrey's 2019 season on a board");
  assert(GL.effectiveRating("RB", mcc, "fantasy") === GL.RATING_CAP, "his named-slot rating should be clipped at the cap");
  assert(GL.effectiveRating("FLEX1", mcc, "fantasy") > GL.RATING_CAP + 20, "his Flex rating should show the value the cap hides");
});

await runTest("uncapped Flex still can't push a real draft into auto-win territory", async () => {
  // The cap's other job is keeping team scores inside the band where the season sim is uncertain:
  // the strongest opponent is 120 and winProb is decided outright at a 20-point gap, so a team
  // score of 140 beats everything automatically. Named slots stay hard-capped, so reaching that
  // needs two all-timers in Flex on the same six boards. This guards the headroom.
  let best = 0;
  for (let i = 0; i < 150; i++) {
    const seq = GL.seededSequence("CEIL" + i);
    const roster = {}; const drafted = new Set();
    let idx = GL.boardAt(seq, 0, roster); let ok = true;
    for (let k = 0; k < 6; k++) {
      const open = GL.SLOTS.filter((s) => !roster[s]); const c = [];
      for (const p of GL.BOARDS[seq[idx]] || []) {
        if (drafted.has(p.id)) continue;
        for (const s of open) if (GL.fits(p.pos, s)) c.push({ p, s, r: GL.effectiveRating(s, p, "fantasy") });
      }
      if (!c.length) { ok = false; break; }
      c.sort((a, b) => b.r - a.r);
      roster[c[0].s] = c[0].p; drafted.add(c[0].p.id);
      if (k < 5) idx = GL.boardAt(seq, idx + 1, roster);
    }
    if (!ok) continue;
    let t = 0, w = 0;
    for (const s of GL.SLOTS) { const k = s === "QB" ? GL.QB_WEIGHT : 1; t += GL.effectiveRating(s, roster[s], "fantasy") * k; w += k; }
    best = Math.max(best, t / w);
  }
  assert(best < 140, `a best-available draft reached ${best.toFixed(1)}, which auto-beats every opponent - the sim has lost its headroom`);
});

await runTest("volume compilers fall and big-play producers rise", async () => {
  const cases = [
    ["Wes Welker", 2009, "down"],
    ["Jason Witten", 2012, "down"],
    ["Vernon Davis", 2013, "up"],
    ["LeGarrette Blount", 2016, "up"],
  ];
  for (const [name, season, dir] of cases) {
    const p = find(name, season);
    assert(p, `expected ${name} ${season} on a board`);
    const moved = p.stdRating - p.rating;
    if (dir === "down") assert(moved < -5, `${name} ${season} should fall sharply, moved ${moved.toFixed(1)}`);
    else assert(moved > 5, `${name} ${season} should rise sharply, moved ${moved.toFixed(1)}`);
  }
});

await runTest("both formats keep the same overall rating scale, so difficulty is comparable", async () => {
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
  const f = all.map((p) => p.rating), s = all.map((p) => p.stdRating);
  assert(Math.abs(mean(f) - mean(s)) < 3, `means drifted apart: ${mean(f).toFixed(1)} vs ${mean(s).toFixed(1)}`);
  assert(Math.abs(sd(f) - sd(s)) < 3, `spreads drifted apart: ${sd(f).toFixed(1)} vs ${sd(s).toFixed(1)}`);
});

await runTest("applyRun keeps the two formats' best scores in separate fields", async () => {
  const base = { runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] };
  const mk = (score, format) => ({ w: 12, l: 5, score, outcome: "lost", champ: false, perfect: false, playoffs: true, format });

  const afterStd = GL.applyRun(base, mk(101.5, "standard"));
  assert(afterStd.bestScoreStd === 101.5, "standard run should set bestScoreStd");
  assert(afterStd.bestScore == null, "a standard run must not touch the fantasy best score");

  const afterBoth = GL.applyRun(afterStd, mk(88.0, "fantasy"));
  assert(afterBoth.bestScore === 88.0, "fantasy run should set bestScore");
  assert(afterBoth.bestScoreStd === 101.5, "fantasy run must not disturb the standard best");
  // A lower fantasy score must not be promoted just because it beats nothing in its own field.
  const afterLower = GL.applyRun(afterBoth, mk(70.0, "fantasy"));
  assert(afterLower.bestScore === 88.0, "a worse fantasy run must not overwrite the fantasy best");

  // Career counters are deliberately shared across formats.
  assert(afterLower.runs === 3, "expected all three runs counted, got " + afterLower.runs);
  assert(afterLower.wins === 36, "expected wins merged across formats, got " + afterLower.wins);

  // An untagged run (written before formats existed) is fantasy.
  const legacy = GL.applyRun(base, { ...mk(95, undefined), format: undefined });
  assert(legacy.bestScore === 95, "an untagged run must count as fantasy");
});

await runTest("playing either format's daily keeps one shared streak", async () => {
  // nextStreak no-ops when the date already matches, so the second format on the same day neither
  // advances nor resets the streak.
  const stats = { dailyLast: "2026-03-04", dailyStreak: 3 };
  assert(GL.nextStreak(stats, "2026-03-05") === 4, "a new day should advance the streak");
  const after = { dailyLast: "2026-03-05", dailyStreak: 4 };
  assert(GL.nextStreak(after, "2026-03-05") === 4, "the same day again must not double-count");
});


// The season simulation stops being a simulation above a certain team score: winProb is decided
// outright at a 20-point gap (SPREAD), so a roster rated more than that above the strongest opponent
// in the game beats everything automatically - 20-0, a Perfect season badge, no dice rolled. The
// comment on flexRating names this as the condition the Flex cap exists for and says that if it ever
// stops holding, that is the first thing to re-check. For Championship it had stopped holding:
// re-anchoring production onto the shared scale lifted the top Flex rating from 172.8 to 197.9, and
// 3 of 16,550 real challenge codes handed out a guaranteed perfect season that replayDraft accepts,
// because it is a legal draft.
await runTest("Championship's Flex cannot out-reach Fantasy's", async () => {
  const flexable = all.filter((p) => GL.fits(p.pos, "FLEX1"));
  const top = (format) => Math.max(...flexable.map((p) => GL.flexRating(p, format)));
  const fantasy = top("fantasy");
  const standard = top("standard");
  assert(Math.abs(standard - fantasy) < 0.05,
    `the two ceilings agree: fantasy ${fantasy.toFixed(1)}, championship ${standard.toFixed(1)}`);
  // And Fantasy is untouched by the cap - nothing can exceed its own maximum.
  assert(Math.abs(fantasy - GL.flexCap()) < 0.05, `the cap IS Fantasy's ceiling: ${GL.flexCap().toFixed(1)}`);
});

await runTest("the rosters that guaranteed a 20-0 no longer do", async () => {
  // An opponent's strength is `reg` (its regular-season rating); `po` is the playoff one where it has one.
  const strongest = Math.max(...GL.OPPS.flatMap((o) => [o.reg, o.po].filter((r) => typeof r === "number")));
  // SPREAD isn't exported, so read it off winProb itself: the gap at which a win becomes certain.
  let spread = 0;
  while (spread < 100 && GL.winProb(strongest + spread, strongest) < 1) spread += 0.1;
  const certain = strongest + spread;

  // The exact roster the sweep drafted on code 0X2TIZ in Championship - every man legal on the board
  // that code deals him. It scored 143.3 and beat every opponent in the game at winProb exactly 1.
  const lineup = {
    QB: find("Jeff Garcia", 2000, "SF"),
    RB: find("Maurice Jones-Drew", 2009, "JAX"),
    WR: find("Michael Thomas", 2019, "NO"),
    TE: find("Rob Gronkowski", 2011, "NE"),
    FLEX1: find("LaDainian Tomlinson", 2006, "LAC"),
    FLEX2: find("Marshall Faulk", 2000, "LA"),
  };
  for (const [slot, p] of Object.entries(lineup)) assert(p, `${slot} is in the pool`);
  let tot = 0, wt = 0;
  for (const sl of GL.SLOTS) { const k = sl === "QB" ? GL.QB_WEIGHT : 1; tot += GL.effectiveRating(sl, lineup[sl], "standard") * k; wt += k; }
  const score = tot / wt;
  assert(score < certain,
    `it scores ${score.toFixed(1)}, and anything from ${certain.toFixed(1)} beats every opponent outright`);
  assert(GL.winProb(score, strongest) < 1, "and the strongest opponent is not a certain win");
});

console.log("test-scoring-format.mjs done");
