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
      // Exactly as the draft screen asks for it - this helper stands in for the client, and
      // replayDraft recomputes the candidate under the same rules to check it.
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

// The app leaves a board with a legal pick only by picking from it or by re-spinning it (which puts the new board
// straight after it). A trace that walks past such a board to draft from later ones - the best six of the
// sequence's ten - was accepted until v1.12.0, and on a Daily it beats any draft the app allows.
t = (() => {
  const seed = "verify-seed-skip";
  const seq = gl.seededSequence(seed);
  const roster = {};
  const drafted = new Set();
  const history = [];
  for (let i = 1; i < seq.length && history.length < gl.SLOTS.length; i++) { // board 0 is passed over
    const open = gl.SLOTS.filter((s) => !roster[s]);
    const player = gl.BOARDS[seq[i]].find((p) => !drafted.has(p.id) && open.some((s) => gl.fits(p.pos, s)));
    if (!player) continue;
    const slot = open.find((s) => gl.fits(player.pos, s));
    history.push({ key: seq[i], id: player.id, season: player.season, slot });
    roster[slot] = player;
    drafted.add(player.id);
  }
  return { seed, history, seq };
})();
check("the skipping trace's first board did have a legal pick", gl.boardHasOption(t.seq[0], new Set(), gl.SLOTS));
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects a trace that passes over a board it could have picked from", !r.ok && /passed over/.test(r.reason || ""), r);
// A re-spin replaces the board on screen, so it can't be tied to a board the draft already picked from: that would add
// the re-spun board instead of replacing one, giving the draft an extra board to pick from.
t = (() => {
  const seed = "verify-seed-respin-after-pick";
  const base = gl.seededSequence(seed);
  const roster = {};
  const drafted = new Set();
  const history = [];
  const seq = [];
  const pickFrom = (key) => {
    const open = gl.SLOTS.filter((s) => !roster[s]);
    const player = gl.BOARDS[key].find((p) => !drafted.has(p.id) && open.some((s) => gl.fits(p.pos, s)));
    if (!player) return;
    const slot = open.find((s) => gl.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot });
    roster[slot] = player;
    drafted.add(player.id);
  };
  seq.push(base[0]);
  pickFrom(base[0]);
  const [team, w] = base[0].split("|");
  const respin = gl.rerollCandidate({ seed, kind: "team", seqIdx: 0, spinTeam: team, spinW: Number(w), shown: new Set(base), drafted, open: gl.SLOTS.filter((s) => !roster[s]) });
  seq.push(respin);
  pickFrom(respin);
  for (let i = 1; i < base.length && history.length < gl.SLOTS.length; i++) {
    seq.push(base[i]);
    pickFrom(base[i]);
  }
  return { seed, history, seq };
})();
check("the re-spin-after-a-pick trace is a full roster", t.history.length === gl.SLOTS.length, t.history.length);
r = gl.replayDraft(t.seed, t.history, t.seq);
check("rejects a re-spin tied to a board the draft already picked from", !r.ok && /re-?spin|reroll/i.test(r.reason || ""), r);
// And a draft with its last board re-spun before the final pick still replays: a re-spin is the legal way on.
const lastSpin = simulateDraft("verify-seed-5", [{ kind: "team", beforePick: 5 }]);
r = gl.replayDraft(lastSpin.seed, lastSpin.history, lastSpin.seq);
check("a re-spin before the final pick still replays as legal", r.ok, r);

// THE STRANDED RE-SPIN. In GM a roster can spend down to a cap that nothing left on the plan fits: boardAt
// returns -1, the screen sets `noBoardLeft` and tells the player in as many words to "Re-spin for a board you
// can use." Doing that puts the new board straight after one that WAS picked from, which is the one shape the
// check above refuses - so until v2.18.6 the app instructed a player into a season the server then threw away,
// 400 "illegal roster", with no retry that could ever succeed.
//
// The relaxation cannot buy an extra board: stranded means no remaining entry holds a single affordable,
// eligible player, so the alternative to this re-spin is no draft at all rather than a worse one. The check
// above - a re-spin off a picked-from board while the plan is still alive - must keep failing, and does.
{
  const SEED = "D073PL", opts = { gm: true, format: "fantasy" };
  const seq = gl.seededSequence(SEED);
  const on = (key, name, season) => (gl.BOARDS[key] || []).find((p) => p.name === name && p.season === season);
  const picks = [["DET|4", "Jahmyr Gibbs", 2024, "FLEX1"], ["HOU|0", "Domanick Williams", 2004, "FLEX2"],
    ["BAL|4", "Mark Andrews", 2021, "TE"], ["CHI|1", "Matt Forte", 2008, "RB"], ["CLE|0", "Quincy Morgan", 2002, "WR"]];
  const roster = {}, history = [];
  for (const [key, name, season, slot] of picks) {
    const p = on(key, name, season);
    if (!p) throw new Error(name + " " + season + " is not on " + key + " - the data moved under this test");
    roster[slot] = p; history.push({ key, slot, id: p.id, season: p.season });
  }
  const cap = gl.capLeftFor(roster, opts);
  check("GM: five legal picks can strand the draft with only QB open and $1M left",
    cap.left === 1 && gl.SLOTS.filter((s) => !roster[s]).join() === "QB", cap);
  check("...and the rest of the plan is genuinely dead, which is what the screen calls noBoardLeft",
    gl.boardAt(seq, 5, roster, cap) < 0, { at: gl.boardAt(seq, 5, roster, cap) });

  const cand = gl.rerollCandidate({ seed: SEED, kind: "team", seqIdx: 4, spinTeam: "CLE", spinW: 0,
    shown: new Set(seq), drafted: new Set(history.map((h) => h.id)), open: ["QB"], cap });
  const used = [...seq]; used.splice(5, 0, cand);
  const qb = (gl.BOARDS[cand] || []).find((p) => p.pos === "QB" && gl.playerSalary(p) <= cap.left);
  check("the re-spin the screen offers deals a board with an affordable QB on it", !!cand && !!qb, { cand, qb: qb && qb.name });
  roster.QB = qb; history.push({ key: cand, slot: "QB", id: qb.id, season: qb.season });
  check("and the roster it completes is legal, exactly at the cap", gl.capLeftFor(roster, opts).left === 0, gl.capLeftFor(roster, opts));

  const v = gl.replayDraft(SEED, history, used, opts);
  check("a re-spin taken because the draft was STRANDED replays as legal", v.ok, v);
}

console.log(failures === 0 ? "\nAll replayDraft checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
