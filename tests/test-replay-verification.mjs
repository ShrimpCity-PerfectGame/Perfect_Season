// Verification for game-logic.mjs's replayDraft() - the roster-legality check the submit-run
// Edge Function will run server-side. Simulates real draft traces (using the same exported
// primitives a real draft uses) and confirms replayDraft accepts them, then hand-tampers each one
// in a specific way and confirms it's rejected.
import { readFileSync } from "node:fs";
import * as gl from "../game-logic.mjs";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
gl.initGameData(data.players, data.opponents);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok - ${name}`); }
  else { console.log(`  FAIL - ${name}${detail ? ": " + JSON.stringify(detail) : ""}`); failures++; }
}

// Drives a draft exactly like the client would: pick the first fitting undrafted player at each
// board, optionally performing a reroll right before a specific pick number (0-indexed).
function simulateDraft(seed, rerollPlan = []) {
  const base = gl.seededSequence(seed);
  const seq = [...base];
  const roster = {};
  const drafted = new Set();
  const history = [];
  let seqIdx = gl.boardAt(seq, 0, roster);
  const doneRerolls = new Set();

  for (let pickNum = 0; pickNum < gl.SLOTS.length; pickNum++) {
    const plan = rerollPlan.find((r) => r.beforePick === pickNum && !doneRerolls.has(r.kind));
    if (plan) {
      const [spinTeam, spinW] = seq[seqIdx].split("|");
      const open = gl.SLOTS.filter((s) => !roster[s]);
      const shown = new Set(seq);
      const next = gl.rerollCandidate({ seed, kind: plan.kind, seqIdx, spinTeam, spinW: Number(spinW), shown, drafted, open });
      if (!next) throw new Error(`no reroll candidate available for ${plan.kind} at pick ${pickNum}`);
      seq.splice(seqIdx + 1, 0, next);
      seqIdx = seqIdx + 1;
      doneRerolls.add(plan.kind);
    }
    const key = seq[seqIdx];
    const board = gl.BOARDS[key];
    const open = gl.SLOTS.filter((s) => !roster[s]);
    const player = board.find((p) => !drafted.has(p.id) && open.some((s) => gl.fits(p.pos, s)));
    const slot = open.find((s) => gl.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot });
    roster[slot] = player;
    drafted.add(player.id);
    if (pickNum < gl.SLOTS.length - 1) seqIdx = gl.boardAt(seq, seqIdx + 1, roster);
  }
  return { seed, history, seq, roster };
}

// ---------- Legitimate traces ----------
const noReroll = simulateDraft("verify-seed-1");
let r = gl.replayDraft(noReroll.seed, noReroll.history, noReroll.seq);
check("no-reroll draft replays as legal", r.ok, r);

const teamReroll = simulateDraft("verify-seed-2", [{ kind: "team", beforePick: 1 }]);
r = gl.replayDraft(teamReroll.seed, teamReroll.history, teamReroll.seq);
check("single team-reroll draft replays as legal", r.ok, r);

const eraReroll = simulateDraft("verify-seed-3", [{ kind: "years", beforePick: 2 }]);
r = gl.replayDraft(eraReroll.seed, eraReroll.history, eraReroll.seq);
check("single era-reroll draft replays as legal", r.ok, r);

const bothRerolls = simulateDraft("verify-seed-4", [{ kind: "team", beforePick: 0 }, { kind: "years", beforePick: 3 }]);
r = gl.replayDraft(bothRerolls.seed, bothRerolls.history, bothRerolls.seq);
check("team + era reroll draft replays as legal", r.ok, r);

// Confirm the replayed roster actually matches what was drafted (not just "ok: true")
const rosterMatches = gl.SLOTS.every((s) => r.roster[s].id === bothRerolls.roster[s].id && r.roster[s].season === bothRerolls.roster[s].season);
check("replayed roster matches the drafted roster exactly", rosterMatches);

// Confirm score/sim recomputation from the replayed roster matches what the client would show
const lineup = gl.SLOTS.map((s) => `${bothRerolls.roster[s].id}${bothRerolls.roster[s].season}`).join("|");
let tot = 0, wt = 0;
for (const s of gl.SLOTS) { const k = s === "QB" ? gl.QB_WEIGHT : 1; tot += gl.effectiveRating(s, bothRerolls.roster[s]) * k; wt += k; }
const score = Math.round((tot / wt) * 10) / 10;
const sim1 = gl.withSeed(`${bothRerolls.seed}#${lineup}`, () => gl.simulateSeason(score));
const sim2 = gl.withSeed(`${bothRerolls.seed}#${lineup}`, () => gl.simulateSeason(score));
check("score/sim recomputation is deterministic from seed+roster alone", sim1.w === sim2.w && sim1.l === sim2.l && sim1.outcome === sim2.outcome);

// ---------- Tampered traces (must all be rejected) ----------
function tamper(trace, mutate) {
  const copy = { seed: trace.seed, history: trace.history.map((h) => ({ ...h })), seq: [...trace.seq] };
  mutate(copy);
  return copy;
}

let t = tamper(noReroll, (c) => { c.history[2].id = 999999; }); // a player id that exists nowhere
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects a fabricated player id", !r.ok, r);

t = tamper(noReroll, (c) => {
  // swap in a real player from the SAME board but force him into a slot he doesn't fit (a QB into RB)
  const qbEntry = c.history.find((h) => h.slot === "QB");
  const board = gl.BOARDS[qbEntry.key];
  const rbSlotEntry = c.history.find((h) => h.slot !== "QB");
  const rbBoard = gl.BOARDS[rbSlotEntry.key];
  const qbPlayer = board.find((p) => p.pos === "QB");
  rbSlotEntry.id = qbPlayer.id; rbSlotEntry.season = qbPlayer.season; rbSlotEntry.key = qbEntry.key;
});
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects a player forced into a slot he doesn't fit", !r.ok, r);

t = tamper(noReroll, (c) => { c.history[3].id = c.history[0].id; c.history[3].season = c.history[0].season; c.history[3].key = c.history[0].key; });
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects the same player drafted twice", !r.ok, r);

t = tamper(teamReroll, (c) => {
  // claim a SECOND team-reroll happened too, by splicing in one more board of the same era as
  // whatever's now active - a real second reroll of the same kind should be impossible (budget 1)
  const [, w] = c.seq[c.seq.length - 1].split("|");
  const candidateKey = Object.keys(gl.BOARDS).find((k) => k !== c.seq[c.seq.length - 1] && !c.seq.includes(k) && k.split("|")[1] === w);
  c.seq.splice(1, 0, candidateKey);
});
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects a second reroll of the same kind", !r.ok, r);

t = tamper(noReroll, (c) => {
  // insert an arbitrary, unrelated board into the middle of a no-reroll sequence - not
  // derivable from any legitimate reroll of the board before it
  const bogus = Object.keys(gl.BOARDS).find((k) => !c.seq.includes(k));
  c.seq.splice(2, 0, bogus);
});
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects an arbitrary inserted board with no reroll basis", !r.ok, r);

t = tamper(noReroll, (c) => {
  // an entirely different seed's roster - boards that don't belong to THIS seed's sequence at all
  const otherSeq = gl.seededSequence("some-completely-different-seed");
  c.seq = otherSeq.slice(0, 6);
});
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects a roster whose boards belong to a different seed entirely", !r.ok, r);

console.log(failures === 0 ? "\nAll replayDraft checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
