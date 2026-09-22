// The rules a draft is built on, as invariants rather than examples. All pure game-logic.mjs, so this
// runs in a second and is the cheapest place to catch a change that quietly moves the game.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import * as GL from "../game-logic.mjs";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
GL.initGameData(data.players, data.opponents);

// One draft, played by a bot that always takes the most valuable legal pick it can afford - the
// greediest possible player, and so the one most likely to strand itself in GM.
function playGreedily(seed, { format = "fantasy", gm = false } = {}) {
  const seq = GL.seededSequence(seed);
  const roster = {};
  const drafted = new Set();
  const keys = [];
  const cap = () => GL.capLeftFor(roster, { gm, format });
  let idx = GL.boardAt(seq, 0, roster, cap());
  for (let pick = 0; pick < GL.SLOTS.length; pick++) {
    if (idx < 0) return { stuck: "no board left", keys };
    const key = seq[idx];
    keys.push(key);
    const open = GL.SLOTS.filter((s) => !roster[s]);
    const left = cap();
    // The same reserve the draft screen holds back and botPar keeps: every slot still to fill costs at
    // least MIN_SALARY, and spending into that is what strands a draft.
    const hold = gm ? (open.length - 1) * GL.MIN_SALARY : 0;
    let best = null, anyAffordable = null;
    for (const p of GL.BOARDS[key]) {
      if (drafted.has(p.id)) continue;
      const cost = gm ? GL.playerSalary(p, format) : 0;
      if (left && cost > left.left) continue;
      for (const s of open) {
        if (!GL.fits(p.pos, s)) continue;
        const r = GL.effectiveRating(s, p, format);
        if (!anyAffordable || r > anyAffordable.r) anyAffordable = { p, s, r };
        if ((!left || cost <= left.left - hold) && (!best || r > best.r)) best = { p, s, r };
      }
    }
    const take = best || anyAffordable;
    if (!take) return { stuck: "nothing on the board", keys };
    roster[take.s] = take.p;
    drafted.add(take.p.id);
    if (pick < GL.SLOTS.length - 1) idx = GL.boardAt(seq, idx + 1, roster, cap());
  }
  return { roster, keys };
}

await runTest("a GM draft cannot spend itself out of a roster", async () => {
  // GM dealt boards where every Lock in was disabled and the only way out was abandoning the draft -
  // which is charged as a DNF, for a player who had made a legal pick every single round. A greedy
  // spender hit it in 23.8% of drafts, and a re-spin was no escape: 6.9% landed somewhere just as dead.
  // Two things fixed it - boardAt skips a board nobody affordable is on, and the draft screen holds
  // back MIN_SALARY for each slot still to fill, which is the reserve botPar was always keeping.
  let stuck = 0;
  const runs = 400;
  for (let i = 0; i < runs; i++) {
    const r = playGreedily(`GMSTUCK${i}`, { format: i % 2 ? "standard" : "fantasy", gm: true });
    if (r.stuck) stuck++;
  }
  assert(stuck === 0, `${stuck} of ${runs} greedy GM drafts stranded`);
});

await runTest("every finished draft has a par, so no season scores zero for the bot's sake", async () => {
  // botPar returned null when its own greedy walk spent itself out, and draftPoints turns null into
  // zero - so 2.2% of finished GM seasons scored nothing at all. It takes a second walk now, spending
  // the least it can, which is what somebody short of cap actually does.
  let none = 0;
  const runs = 300;
  for (let i = 0; i < runs; i++) {
    const format = i % 2 ? "standard" : "fantasy";
    const r = playGreedily(`GMPAR${i}`, { format, gm: true });
    if (r.stuck) continue;
    if (GL.botPar(r.keys, { format, gm: true }) == null) none++;
  }
  assert(none === 0, `${none} of ${runs} finished GM drafts had no par`);
});

await runTest("the bot's handicap is a different player, not the same one twice", async () => {
  // Candidates were one per (player, slot) pair, and flexRating does not depend on WHICH flex - so
  // with both Flex slots open the same man held ranks 1 and 2 and "second best" was the best again.
  // It no-opped on 27% of the bot's picks, which made par too high and every points total and coin
  // payout about 17% low. Measured, rather than asserted at one seed: par has to sit below what a
  // bot taking the very best of everything would score.
  let par = 0, top = 0, n = 0;
  for (let i = 0; i < 120; i++) {
    const format = i % 2 ? "standard" : "fantasy";
    const r = playGreedily(`PARGAP${i}`, { format });
    if (r.stuck) continue;
    const p = GL.botPar(r.keys, { format });
    if (p == null) continue;
    // What the boards would give a bot with no handicap at all.
    let tot = 0, wt = 0;
    for (const s of GL.SLOTS) { const k = s === "QB" ? GL.QB_WEIGHT : 1; tot += GL.effectiveRating(s, r.roster[s], format) * k; wt += k; }
    par += p; top += tot / wt; n++;
  }
  assert(n > 100, `enough drafts to average over: ${n}`);
  const gap = (top / n) - (par / n);
  // 15, not 2. Measured on these same 120 drafts: 17.9 with the dedup, 12.9 without it - so a threshold of 2
  // had six times the headroom the bug needed, and reverting the fix left the whole suite green. The floor is
  // set just under the fixed value, which is what makes it a regression test rather than a formality.
  assert(gap > 15, `par sits meaningfully below a no-handicap bot: gap ${gap.toFixed(2)} (mean par ${(par / n).toFixed(2)})`);
});



await runTest("a GM re-spin never deals a board nobody affordable is on", async () => {
  // boardAt learned the cap in 2.0 and rerollCandidate did not, so the one control a player reaches for to
  // escape a dead board could hand them another one - 1.17% of offered re-spins, 12.35% of seeds. The client
  // and replayDraft pass the same cap now, so a re-spin the screen offers is one the server accepts.
  let offered = 0, dead = 0;
  for (let i = 0; i < 300; i++) {
    const format = i % 2 ? "standard" : "fantasy";
    const seed = `GMSPIN${i}`;
    const seq = GL.seededSequence(seed);
    const roster = {};
    const drafted = new Set();
    // Spend most of the cap on the first few boards, which is where the dead ends live.
    let idx = GL.boardAt(seq, 0, roster, GL.capLeftFor(roster, { gm: true, format }));
    for (let n = 0; n < 5 && idx >= 0; n++) {
      const open = GL.SLOTS.filter((s) => !roster[s]);
      const left = GL.capLeftFor(roster, { gm: true, format });
      let best = null;
      for (const p of GL.BOARDS[seq[idx]]) {
        if (drafted.has(p.id) || GL.playerSalary(p, format) > left.left) continue;
        for (const s of open) {
          if (!GL.fits(p.pos, s)) continue;
          const r = GL.effectiveRating(s, p, format);
          if (!best || r > best.r) best = { p, s, r };
        }
      }
      if (!best) break;
      roster[best.s] = best.p; drafted.add(best.p.id);
      idx = GL.boardAt(seq, idx + 1, roster, GL.capLeftFor(roster, { gm: true, format }));
    }
    if (idx < 0) continue;
    const open = GL.SLOTS.filter((s) => !roster[s]);
    const cap = GL.capLeftFor(roster, { gm: true, format });
    const [team, w] = seq[idx].split("|");
    for (const kind of ["team", "years"]) {
      const next = GL.rerollCandidate({ seed, kind, seqIdx: idx, spinTeam: team, spinW: Number(w),
        shown: new Set(seq), drafted, open, cap });
      if (!next) continue;
      offered++;
      if (!GL.boardHasOption(next, drafted, open, cap)) dead++;
    }
  }
  assert(offered > 200, `enough re-spins to be measuring anything: ${offered}`);
  assert(dead === 0, `${dead} of ${offered} GM re-spins landed on a board nobody affordable is on`);
});

await runTest("a rescued par is a benchmark, not a bad player", async () => {
  // When the greedy bot spends itself out of a roster, par used to come from a walk taking the CHEAPEST man
  // who fits - which is not a benchmark. Par fell as low as 41.6 against a median of 91, and draftPoints
  // (500 x (score/par - 0.85)) turned a 95-point season into 717 ladder points instead of 97. Codes are the
  // client's own choice, so that is a seed worth hunting: about one try in 167.
  const pars = [];
  for (let i = 0; i < 600; i++) {
    const format = i % 2 ? "standard" : "fantasy";
    const r = playGreedily(`PARFLOOR${i}`, { format, gm: true });
    if (r.stuck) continue;
    const p = GL.botPar(r.keys, { format, gm: true });
    if (p != null) pars.push(p);
  }
  assert(pars.length > 400, `enough finished GM drafts: ${pars.length}`);
  const worst = Math.min(...pars);
  // A collapsed par is what it looks like; an honestly low one sits in the same band as a no-cap draft's.
  assert(worst > 65, `the lowest par is still a real benchmark: ${worst.toFixed(1)}`);
  assert(GL.draftPoints(95, worst) < 350,
    `and a strong season against it cannot run away with the ladder: ${GL.draftPoints(95, worst)} points`);
});

console.log("test-draft-rules.mjs done");
