// 1v1's own rules, in one module because two of them have to agree exactly: the browser draws the board and the
// match-pick Edge Function decides every pick, and if they disagreed about what a board holds or what a roster is
// worth, one of them would be lying to a player. Same reasoning as game-logic.mjs, which this builds on rather
// than duplicates - nothing here changes how single player works, and single player never imports this.
//
// Contract: VERSUS.md. The parts that matter most:
//   - eight boards, sixteen picks, snaking by board (1)
//   - every board offers that team's players, its defense in each year of the era, and its kicker (6)
//   - the higher score wins, every time; the football final only dresses the margin (6)
//   - a board that can't serve BOTH players is skipped before it is dealt (8)
//
// Like game-logic.mjs, this needs its data handed to it once: call initVersusData(pool) with
// data/versus-pool.json (and initGameData first) before anything else here.
import {
  BOARDS, WINDOWS, SLOTS, QB_WEIGHT, effectiveRating, fits,
  hashStr, mulberry32, seededSequence, rerollCandidate, LOSER_PTS, MARGINS,
} from "./game-logic.mjs";

export const VERSUS_SLOTS = [...SLOTS, "DST", "K"]; // eight: the six of single player, plus the two 1v1 adds
export const MATCH_BOARDS = 8;
export const MATCH_PICKS = MATCH_BOARDS * 2;
// 1v1's own budget, deliberately not game-logic.mjs's REROLL_BUDGET: single player's re-spins are its own.
export const MATCH_RESPINS = { team: 1, era: 1 };
export const TURN_SECONDS = 45;

// Where an average season sits on the 0-130 scale, which is the middle tools/data/build-versus-pool.mjs rates
// against. A defense or a kicker is worth what it is ABOVE or BELOW this, never its raw rating.
export const AVERAGE_RATING = 65;
// What one ordinary roster slot is worth in the six-player weighted mean: 1 / (QB_WEIGHT + 5). A defense and a
// kicker are each exactly one of the eight picks, so that is exactly what each is worth. Not a tuned number.
export const SLOT_WEIGHT_TOTAL = QB_WEIGHT + SLOTS.length - 1;
export const SLOT_WORTH = 1 / SLOT_WEIGHT_TOTAL;
// The gap at which one roster is simply better, borrowed from the season sim's SPREAD so the two modes agree
// about what a decisive margin looks like. Only the SIZE of the football final scales with it - never the winner.
export const DECISIVE_GAP = 20;

let DEFENSES = new Map(); // "TEAM|season" -> the row from data/versus-pool.json
let KICKERS = new Map();

export function initVersusData(pool) {
  DEFENSES = new Map((pool?.defenses || []).map((d) => [`${d.team}|${d.season}`, { ...d, kind: "dst" }]));
  KICKERS = new Map((pool?.kickers || []).map((k) => [`${k.team}|${k.season}`, { ...k, kind: "k" }]));
}

// ---------- What a board holds ----------

// A board is a team and an era, exactly as everywhere else. Its defenses and kickers are that team's, one per
// year of the era - so a 2006-2010 board offers five of each and a 1999-2005 board seven (VERSUS.md 6).
export function unitsOn(key) {
  const [team, w] = key.split("|");
  const [from, to] = WINDOWS[Number(w)] || [];
  const defenses = [], kickers = [];
  for (let season = from; season <= to; season++) {
    const d = DEFENSES.get(`${team}|${season}`);
    const k = KICKERS.get(`${team}|${season}`);
    if (d) defenses.push(d);
    if (k) kickers.push(k);
  }
  return { defenses, kickers };
}

// Everything on a board, in one list, each tagged with the pool it came from. The players keep the shape
// game-logic.mjs gave them; a `kind` is added rather than imposed, so nothing downstream has to special-case it.
export function optionsOn(key) {
  const { defenses, kickers } = unitsOn(key);
  return [...(BOARDS[key] || []).map((p) => (p.kind ? p : { ...p, kind: "player" })), ...defenses, ...kickers];
}

// What identifies an option for "taken": a player by who and when, a defense or kicker by whose and when. These
// are the same two identities match_picks is keyed by, so the database and this module agree by construction.
export const optionId = (o) =>
  (o.kind === "player" ? `player|${o.id}|${o.season}` : `${o.kind}|${o.team}|${o.season}`);

export function optionFits(o, slot) {
  if (o.kind === "dst") return slot === "DST";
  if (o.kind === "k") return slot === "K";
  // A player can never land in DST or K: `fits` compares the slot to his position, and no player has either.
  return slot !== "DST" && slot !== "K" && fits(o.pos, slot);
}

// What an option is actually worth to a roster, in points of final score - which is not its rating. A 112 defense
// and a 112 quarterback are different numbers of points, and anything choosing between them (the clock's
// auto-pick, a "best available" hint) has to compare what they are worth, not what they are rated.
//
// Measured against an average option, for all three kinds, so the three are comparable: a player's raw rating
// carries a constant a defense's does not.
export function optionValue(o, slot, format) {
  if (o.kind === "dst" || o.kind === "k") return (o.rating - AVERAGE_RATING) * SLOT_WORTH;
  const weight = slot === "QB" ? QB_WEIGHT : 1;
  return (effectiveRating(slot, o, format) - AVERAGE_RATING) * (weight / SLOT_WEIGHT_TOTAL);
}

// ---------- Whose turn, and on which board ----------

// Sixteen picks over eight boards, snaking: the host picks first on the even-numbered boards (0, 2, 4, 6) and
// second on the odd ones. `pickNo` is 1-based, as match_picks stores it.
export function turnAt(pickNo) {
  const boardIdx = Math.floor((pickNo - 1) / 2);
  const first = (pickNo - 1) % 2 === 0;
  const hostLeads = boardIdx % 2 === 0;
  return { boardIdx, first, side: first === hostLeads ? "host" : "guest" };
}
export const firstPickerOn = (boardIdx) => (boardIdx % 2 === 0 ? "host" : "guest");

// ---------- A board has to serve both players (VERSUS.md 8) ----------

const fitsAny = (o, open) => open.some((s) => optionFits(o, s));

// Can this board be drafted twice - once by each player - without stranding the second? The first picker takes
// exactly one option, so two that fit the second picker is always enough. One is enough only when the first
// picker could not have taken it anyway.
//
// This is the whole reason the rule exists: 33 of the 160 boards hold a single quarterback or a single tight
// end, and two players who both still need one cannot both be served from it.
export function boardServesBoth(key, taken, openFirst, openSecond) {
  const options = optionsOn(key).filter((o) => !taken.has(optionId(o)));
  if (!options.some((o) => fitsAny(o, openFirst))) return false;
  const forSecond = options.filter((o) => fitsAny(o, openSecond));
  if (forSecond.length >= 2) return true;
  return forSecond.length === 1 && !fitsAny(forSecond[0], openFirst);
}

// The next board that can serve both, walking the sequence the way boardAt does in single player. `used` is every
// board already dealt or spun in, so nothing repeats.
//
// The sequence holds eighteen entries for eight boards. If they were somehow all unusable it widens to the rest
// of the boards in the same seeded order rather than leaving a player with nothing - a case that should never
// happen, and must not be a crash if it does.
export function nextBoard(seed, seq, used, taken, openFirst, openSecond) {
  for (const key of seq) {
    if (used.has(key)) continue;
    if (boardServesBoth(key, taken, openFirst, openSecond)) return key;
  }
  const rng = mulberry32(hashStr(`${seed}-widen`));
  const rest = Object.keys(BOARDS).filter((k) => !used.has(k) && !seq.includes(k));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return rest.find((key) => boardServesBoth(key, taken, openFirst, openSecond)) || null;
}

// ---------- Replaying a match ----------

const emptyRoster = () => Object.fromEntries(VERSUS_SLOTS.map((s) => [s, null]));
export const openSlots = (roster) => VERSUS_SLOTS.filter((s) => !roster[s]);

// Everything derived from a match's public state, computed the same way by both screens and the server: the
// eight boards as they actually came out, both rosters, what is gone, and whose turn it is. Nothing here reads
// anything a client said - only the picks and re-spins the database holds.
//
// `picks` are match_picks rows in pick_no order; `respins` are matches.respins entries.
export function replayMatch({ code, picks = [], respins = [] }) {
  const seq = seededSequence(code);
  const roster = { host: emptyRoster(), guest: emptyRoster() };
  const taken = new Set();
  const used = new Set();
  const boards = []; // one { key, followKey } per board: the two are the same unless the follower re-spun
  const spins = new Map(respins.map((r) => [`${r.pickNo}|${r.kind}`, r]));
  const pending = (pickNo, boardIdx, key) =>
    ({ seq, boards, roster, taken, used, boardIdx, pickNo, boardKey: key, turn: turnAt(pickNo), done: false });

  for (let boardIdx = 0; boardIdx < MATCH_BOARDS; boardIdx++) {
    const lead = firstPickerOn(boardIdx);
    const follow = lead === "host" ? "guest" : "host";
    let key = nextBoard(code, seq, used, taken, openSlots(roster[lead]), openSlots(roster[follow]));
    if (!key) break;
    used.add(key);
    // A re-spin is attached to the pick it changes the board for. The leader's lands before either has picked,
    // so it replaces the board for BOTH of them - the follower still drafts the same board the leader did.
    for (const kind of ["team", "era"]) {
      const spin = spins.get(`${boardIdx * 2 + 1}|${kind}`);
      if (!spin) continue;
      used.add(spin.key);
      key = spin.key;
    }
    const board = { key, followKey: key };
    boards.push(board);

    const leadPick = picks.find((p) => p.pickNo === boardIdx * 2 + 1);
    if (!leadPick) return pending(boardIdx * 2 + 1, boardIdx, key);
    take(leadPick, key, roster[lead], taken);

    // The follower's re-spin lands after the leader has already taken something off this board, so it can only
    // be their own: they walk away to a board of their own and pick there (VERSUS.md 7). That asymmetry is the
    // point of it - the leader's re-spin is a board they hand the other player too.
    for (const kind of ["team", "era"]) {
      const spin = spins.get(`${boardIdx * 2 + 2}|${kind}`);
      if (!spin) continue;
      used.add(spin.key);
      board.followKey = spin.key;
    }
    const followPick = picks.find((p) => p.pickNo === boardIdx * 2 + 2);
    if (!followPick) return pending(boardIdx * 2 + 2, boardIdx, board.followKey);
    take(followPick, board.followKey, roster[follow], taken);
  }
  return {
    seq, boards, roster, taken, used,
    boardIdx: MATCH_BOARDS, pickNo: MATCH_PICKS + 1, boardKey: null, turn: null, done: true,
  };
}

function take(pick, key, roster, taken) {
  const option = optionsOn(key).find((o) => optionId(o) === pickId(pick));
  if (!option) return;
  roster[pick.slot] = option;
  taken.add(optionId(option));
}

// A stored pick's identity, in the same spelling optionId gives an option.
export const pickId = (p) =>
  (p.kind === "player" ? `player|${p.playerId}|${p.season}` : `${p.kind}|${p.team}|${p.season}`);

// What the clock owes when someone runs out of time: the most valuable option on the board that fits a slot they
// still have open. Never nothing - VERSUS.md 8 guarantees the board can serve them.
export function autoPick(key, taken, roster, format) {
  const open = openSlots(roster);
  let best = null;
  for (const o of optionsOn(key)) {
    if (taken.has(optionId(o))) continue;
    for (const slot of open) {
      if (!optionFits(o, slot)) continue;
      const value = optionValue(o, slot, format);
      // Tie-broken by identity so two engines can never disagree about which of two equal options it took.
      if (!best || value > best.value || (value === best.value && optionId(o) < optionId(best.option))) {
        best = { option: o, slot, value };
      }
    }
  }
  return best;
}

// ---------- The result ----------

// The six players, weighted exactly as single player weights them. Identical arithmetic, deliberately: an
// offense in 1v1 has to mean the same thing as a team score anywhere else in the game.
export function offenseScore(roster, format) {
  let total = 0, weight = 0;
  for (const slot of SLOTS) {
    if (!roster[slot]) return null;
    const w = slot === "QB" ? QB_WEIGHT : 1;
    total += effectiveRating(slot, roster[slot], format) * w;
    weight += w;
  }
  return total / weight;
}

const round1 = (n) => Math.round(n * 10) / 10;

// One side's score, and the three parts a player should be shown it came from.
export function sideScore(mine, theirs, format) {
  const offense = offenseScore(mine, format);
  if (offense == null) return null;
  const kicker = mine.K ? (mine.K.rating - AVERAGE_RATING) * SLOT_WORTH : 0;
  // Their defense is subtracted from YOUR score, because that is what a defense does (VERSUS.md 6).
  const against = theirs.DST ? (theirs.DST.rating - AVERAGE_RATING) * SLOT_WORTH : 0;
  return {
    offense: round1(offense), kicker: round1(kicker), against: round1(against),
    score: round1(offense + kicker - against),
  };
}

// The football final. Drawn FROM the result, never the other way round: the margin rises with the points gap,
// and only the losing side's points are left to the seed - which cannot move the margin or the winner. This is
// why 1v1 never calls winProb or gameResult (VERSUS.md 6).
export function footballFinal(gap, code) {
  const rng = mulberry32(hashStr(`${code}-final`));
  const low = LOSER_PTS[Math.floor(rng() * LOSER_PTS.length)];
  if (gap <= 0) return { winner: low, loser: low }; // a tie, which football has
  const idx = Math.min(MARGINS.length - 1, Math.max(0, Math.round((gap / DECISIVE_GAP) * (MARGINS.length - 1))));
  const margin = low === 0 && MARGINS[idx] < 3 ? 3 : MARGINS[idx]; // no 1-0 finals
  return { winner: low + margin, loser: low };
}

// The whole result, written once by the Edge Function when the sixteenth pick lands. Decided on the scores as
// they are shown, to a tenth of a point, so what a player reads is what settled it.
export function matchResult({ code, format, host, guest }) {
  const h = sideScore(host, guest, format);
  const g = sideScore(guest, host, format);
  if (!h || !g) return null;
  const gap = Math.abs(h.score - g.score);
  const final = footballFinal(gap, code);
  const winner = h.score === g.score ? null : h.score > g.score ? "host" : "guest";
  const points = (side) => (winner === null ? final.loser : winner === side ? final.winner : final.loser);
  return {
    host: { ...h, points: points("host") },
    guest: { ...g, points: points("guest") },
    winner, margin: round1(gap),
  };
}

// ---------- Re-spins ----------

// Either player may re-spin, on their own turn, before their own pick (VERSUS.md 7). What differs is who ends up
// on the new board:
//
//   the leader's re-spin  lands before anyone has picked, so it is the board BOTH of them draft - and it has to
//                         serve both (section 8), which rerollCandidate can't tell on its own: it only knows how
//                         to ask about one roster;
//   the follower's        lands after the leader has already taken something off this board, so it is theirs
//                         alone. It only has to serve them, which is exactly what rerollCandidate checks.
//
// `shown` is the WHOLE sequence, not just what has been reached: a replacement drawn from a board still waiting
// later would simply turn up again, since nothing removes the original (CLAUDE.md's reroll-pool invariant).
// Refused - costing nothing, as a no-op re-spin does in single player - when there is no candidate at all, or
// when a leader's candidate couldn't serve both. A refused re-spin is not spent.
export function respinBoard({ code, kind, pickNo, key, seq, used, taken, roster, otherRoster }) {
  const { first } = turnAt(pickNo);
  const shown = new Set([...seq, ...used]);
  const candidate = rerollCandidate({
    seed: code, kind: kind === "era" ? "years" : "team",
    // Salted by the pick rather than the board, so two re-spins on the same board can't land on each other.
    seqIdx: pickNo, spinTeam: key.split("|")[0], spinW: Number(key.split("|")[1]),
    shown, drafted: taken, open: openSlots(roster),
  });
  if (!candidate) return null;
  if (!first) return candidate; // theirs alone
  return boardServesBoth(candidate, taken, openSlots(roster), openSlots(otherRoster)) ? candidate : null;
}

export function respinsLeft(respins, side) {
  const spent = respins.filter((r) => r.by === side);
  return {
    team: MATCH_RESPINS.team - spent.filter((r) => r.kind === "team").length,
    era: MATCH_RESPINS.era - spent.filter((r) => r.kind === "era").length,
  };
}
