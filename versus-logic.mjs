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
// The first seconds of a board, in which its opening pick cannot land yet. Steal the pick has to be spent
// before that pick, so without a window it could not really be spent at all: the leader can take something the
// instant the board appears, and the other player is reading the board, not watching for a chance to act.
//
// It exists only when it could be used - the board's first pick, not yet swapped, and the player picking second
// still holding theirs. Any other board opens immediately, so a match never waits for a window nobody wants.
// The clock is deliberately NOT extended by it: a board stays 45 seconds end to end, so the window is ten
// seconds of reading and thirty-five of acting rather than a longer turn. Confirmed as the right trade by the
// owner after playing it.
export const LOOK_SECONDS = 10;

// Where an average season sits on the 0-130 scale, which is the middle tools/data/build-versus-pool.mjs rates
// against. A defense or a kicker is worth what it is ABOVE or BELOW this, never its raw rating.
export const AVERAGE_RATING = 65;
// The seven picks that make your own score. The kicker is averaged in with the six players rather than added
// on top, and that is a correction: as a separate term a below-average kicker read as "your kicker: -2.1", a
// line of negative points for having drafted a kicker at all. Averaged, he behaves like every other pick - a
// weak one lowers your score the way a weak tight end does, and nothing on the screen calls it a penalty.
// The defense is the eighth and is not here, because it is the one pick that acts on the OTHER roster.
export const SCORED_SLOTS = [...SLOTS, "K"];
// What one ordinary slot is worth in that mean: 1 / (QB_WEIGHT + 6). The defense is worth exactly that, since
// it is exactly one of the eight picks. Not a tuned number.
export const SLOT_WEIGHT_TOTAL = QB_WEIGHT + SCORED_SLOTS.length - 1;
export const SLOT_WORTH = 1 / SLOT_WEIGHT_TOTAL;
// The gap at which one roster is simply better, borrowed from the season sim's SPREAD so the two modes agree
// about what a decisive margin looks like. Only the SIZE of the football final scales with it - never the winner.
export const DECISIVE_GAP = 20;

let DEFENSES = new Map(); // "TEAM|season" -> the row from data/versus-pool.json
let KICKERS = new Map();

// data/versus-pool.json packs its rows as arrays with the column names given once, because it ships in the page
// every visitor loads and repeating eight key names 1,722 times is 80 KB of nothing. Expanded once, here.
// An already-expanded row (a test fixture written by hand) is taken as it is.
const expand = (rows, columns, kind) => (rows || []).map((r) => {
  if (!Array.isArray(r)) return { ...r, kind };
  const o = { kind };
  for (let i = 0; i < columns.length; i++) o[columns[i]] = r[i];
  return o;
});

export function initVersusData(pool) {
  const columns = pool?.columns || {};
  const defenses = expand(pool?.defenses, columns.defenses || [], "dst");
  const kickers = expand(pool?.kickers, columns.kickers || [], "k");
  DEFENSES = new Map(defenses.map((d) => [`${d.team}|${d.season}`, d]));
  KICKERS = new Map(kickers.map((k) => [`${k.team}|${k.season}`, k]));
}

// ---------- What a board holds ----------

// A board is a team and an era, exactly as everywhere else. Its defenses and kickers are that team's, one per
// year of the era - so a 2006-2010 board offers five of each and a 1999-2005 board seven (VERSUS.md 6).
export function unitsOn(key) {
  const [team, w] = key.split("|");
  const [from, to] = WINDOWS[Number(w)] || [];
  const defenses = [];
  // A kicker appears ONCE, in his best season of the era - the same rule the player boards follow, where a man
  // shows his best year for that team rather than all of them. A defense is not a person and does not get that
  // treatment: the 2005 Bears and the 2006 Bears are two different defenses, which is the whole point of
  // offering a year at a time.
  const best = new Map();
  for (let season = from; season <= to; season++) {
    const d = DEFENSES.get(`${team}|${season}`);
    if (d) defenses.push(d);
    const k = KICKERS.get(`${team}|${season}`);
    if (!k) continue;
    const held = best.get(k.name);
    if (!held || k.rating > held.rating) best.set(k.name, k);
  }
  return { defenses, kickers: [...best.values()].sort((a, b) => a.season - b.season) };
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
// A pick's rating, whichever pool it came from: a player's depends on the slot and the format, a defense's and
// a kicker's is the one the pool gave it.
const ratingIn = (slot, o, format) => (o.kind === "player" ? effectiveRating(slot, o, format) : o.rating);

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
  return boardServes(key, taken, openFirst, openSecond, 1);
}

// The general form, because a board does not always get drafted once each: a double dip takes two off it before
// the other player picks (VERSUS.md 7), and a board the other player has forfeited gets drafted once in total.
//
//   openSecond null   nobody picks after them, so one option is the whole requirement
//   firstPicks n      the first player takes n before the second picks at all
//
// The second player is safe when either some option they can use is one the first player could never take, or
// more of the shared ones remain than the first player can possibly remove.
export function boardServes(key, taken, openFirst, openSecond, firstPicks = 1) {
  const options = optionsOn(key).filter((o) => !taken.has(optionId(o)));
  const forFirst = options.filter((o) => fitsAny(o, openFirst));
  if (forFirst.length < firstPicks) return false;
  if (!openSecond) return true;
  const forSecond = options.filter((o) => fitsAny(o, openSecond));
  const exclusive = forSecond.filter((o) => !fitsAny(o, openFirst));
  return exclusive.length >= 1 || forSecond.length - exclusive.length > firstPicks;
}

// The next board that can serve the players about to draft it, walking the sequence the way boardAt does in
// single player. `used` is every board already dealt or spun in, so nothing repeats. `openSecond` is null on a
// board the other player has forfeited to a double dip - then it only has to serve the one.
//
// The sequence holds eighteen entries for eight boards. If they were somehow all unusable it widens to the rest
// of the boards in the same seeded order rather than leaving a player with nothing - a case that should never
// happen, and must not be a crash if it does.
export function nextBoard(seed, seq, used, taken, openFirst, openSecond) {
  for (const key of seq) {
    if (used.has(key)) continue;
    if (boardServes(key, taken, openFirst, openSecond)) return key;
  }
  const rng = mulberry32(hashStr(`${seed}-widen`));
  const rest = Object.keys(BOARDS).filter((k) => !used.has(k) && !seq.includes(k));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return rest.find((key) => boardServes(key, taken, openFirst, openSecond)) || null;
}

// ---------- Replaying a match ----------

const emptyRoster = () => Object.fromEntries(VERSUS_SLOTS.map((s) => [s, null]));
export const openSlots = (roster) => VERSUS_SLOTS.filter((s) => !roster[s]);

// Everything derived from a match's public state, computed the same way by both screens and the server: the
// eight boards as they actually came out, both rosters, what is gone, and whose turn it is. Nothing here reads
// anything a client said - only the picks and re-spins the database holds.
//
// `picks` are match_picks rows in pick_no order; `respins` are matches.respins entries.
export function replayMatch({ code, picks = [], respins = [], dips = [], swaps = [] }) {
  const seq = seededSequence(code);
  const roster = { host: emptyRoster(), guest: emptyRoster() };
  const taken = new Set();
  const used = new Set();
  const boards = []; // one per board index; `key` is null for a board nobody was left to draft
  const spins = new Map(respins.map((r) => [`${r.pickNo}|${r.kind}`, r]));
  const openOf = (side) => openSlots(roster[side]);
  let pickNo = 0;

  for (let boardIdx = 0; boardIdx < MATCH_BOARDS; boardIdx++) {
    const lead = firstPickerOn(boardIdx);
    const follow = lead === "host" ? "guest" : "host";
    // Whoever took two off the board before gives up this one (VERSUS.md 7). The board is dealt for whoever is
    // left, which is what a double dip really costs: the other player gets a board to themselves.
    const forfeit = dips.find((d) => d.boardIdx === boardIdx - 1)?.by;
    const base = [lead, follow].filter((side) => side !== forfeit);
    if (!base.length) { boards.push({ key: null, followKey: null, order: [] }); continue; }

    // Dealt for the players it was dealt to, before anyone declared anything: a dip is decided after seeing the
    // board, so it can't be what chose it.
    let key = nextBoard(code, seq, used, taken, openOf(base[0]), base[1] ? openOf(base[1]) : null);
    if (!key) break;
    used.add(key);

    // Steal the pick reverses who leads - after the board is dealt, because it is spent on a board already on
    // the table. A dip then inserts a second turn for whoever spent it, back to back with their first.
    const order = [...base];
    if (swaps.some((w) => w.boardIdx === boardIdx) && order.length > 1) order.reverse();
    const dip = dips.find((d) => d.boardIdx === boardIdx);
    if (dip && order.includes(dip.by)) order.splice(order.indexOf(dip.by) + 1, 0, dip.by);

    const board = { key, followKey: key, order: [...order] };
    boards.push(board);
    const keyFor = (side) => (side === order[0] ? board.key : board.followKey);

    for (let i = 0; i < order.length; i++) {
      const side = order[i];
      pickNo++;
      // A re-spin is spent before a player's FIRST pick on a board. The board's opening pick moves the board for
      // everyone on it; anyone else's moves only their own, since the board has already been picked over.
      if (order.indexOf(side) === i) {
        for (const kind of ["team", "era"]) {
          const spin = spins.get(`${pickNo}|${kind}`);
          if (!spin) continue;
          used.add(spin.key);
          if (i === 0) { board.key = spin.key; board.followKey = spin.key; } else board.followKey = spin.key;
        }
      }
      const pick = picks.find((p) => p.pickNo === pickNo);
      if (!pick) {
        return {
          seq, boards, roster, taken, used, boardIdx, pickNo, boardKey: keyFor(side),
          turn: { boardIdx, first: i === 0, side }, done: false,
        };
      }
      // A stolen pick is on the thief's roster, in the slot they chose. Stealing was their whole turn, so the
      // turn that was theirs becomes another one for the player they robbed.
      //
      // It has to be the thief's OWN next turn, found by looking for them, not whatever sits at i + 1. On a
      // board somebody has also double dipped, i + 1 is the dip's extra turn - belonging to the victim - and
      // overwriting it swallowed the dip: the victim picked once where they had paid for twice, and still
      // forfeited the next board. That left both rosters short and the match ended at fourteen picks with no
      // result, unfinishable and ungradeable (VERSUS.md 7).
      const thief = pick.stolenBy;
      take(pick, keyFor(side), roster[thief || side], taken);
      if (thief) {
        const theirs = order.indexOf(thief, i + 1);
        if (theirs >= 0) order[theirs] = side;
        else order.splice(i + 1, 0, side); // no turn of theirs left to take: give the replacement back here
      }
    }
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

// Your seven own picks, weighted as single player weights its six - the quarterback carries the same extra
// weight, and the kicker joins them as one more ordinary slot. It is deliberately NOT comparable to a
// single-player team score: a 1v1 has eight picks and its own board, and the two never rank against each other.
export function rosterScore(roster, format) {
  let total = 0, weight = 0;
  for (const slot of SCORED_SLOTS) {
    if (!roster[slot]) return null;
    const w = slot === "QB" ? QB_WEIGHT : 1;
    total += ratingIn(slot, roster[slot], format) * w;
    weight += w;
  }
  return total / weight;
}

const round1 = (n) => Math.round(n * 10) / 10;

// One side's score: their own seven picks, less what the other roster's defense takes off them.
export function sideScore(mine, theirs, format) {
  const own = rosterScore(mine, format);
  if (own == null) return null;
  // Their defense is subtracted from YOUR score, because that is what a defense does (VERSUS.md 6).
  const against = theirs.DST ? (theirs.DST.rating - AVERAGE_RATING) * SLOT_WORTH : 0;
  return { roster: round1(own), against: round1(against), score: round1(own - against) };
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

// ---------- Steal (VERSUS.md 7) ----------

export const MATCH_STEALS = 1; // one each per match

// Whether the follower may take the pick the leader has just made, and which of their slots it could fill.
// Returns the open slots it fits, or null if it can't be stolen.
//
// Two ways it can't. The obvious one is that it fits nothing they still have open. The other is the reason this
// function exists at all: a steal empties the leader's slot and sends them back to the same board, and the board
// might have nothing left they can use. A board with one quarterback, dealt to a leader who needs only a
// quarterback, is exactly that - the serve-both rule (section 8) guaranteed the FOLLOWER an option after the
// leader picked, not the leader an option after being robbed. So it is checked here, and a steal that would
// strand them is refused and costs nothing.
export function stealableSlots({ key, taken, option, stealerRoster, leaderRoster, leaderSlot }) {
  const slots = openSlots(stealerRoster).filter((s) => optionFits(option, s));
  if (!slots.length) return { reason: "bad_slot" };
  const leaderOpen = [...openSlots(leaderRoster), leaderSlot];
  const left = optionsOn(key).some((o) => !taken.has(optionId(o)) && leaderOpen.some((s) => optionFits(o, s)));
  // Told apart on purpose: "he fits nothing you have open" and "it would strand them" are different problems
  // with different answers, and one message for both says something untrue about the board in half the cases.
  return left ? { slots } : { reason: "would_strand" };
}

export function stealsLeft(picks, side) {
  return MATCH_STEALS - picks.filter((p) => p.stolenBy === side).length;
}

// ---------- Double dip (VERSUS.md 7) ----------

export const MATCH_DIPS = 1; // one each per match

// Two options that fill two DIFFERENT open slots. Two quarterbacks on a board are two options and one slot, so
// counting options alone would allow a dip that can't be completed.
function twoFit(options, open) {
  for (let a = 0; a < open.length; a++) {
    for (let b = a + 1; b < open.length; b++) {
      const first = options.filter((o) => optionFits(o, open[a]));
      const second = options.filter((o) => optionFits(o, open[b]));
      if (!first.length || !second.length) continue;
      if (first.length > 1 || second.length > 1 || optionId(first[0]) !== optionId(second[0])) return true;
    }
  }
  return false;
}

// Whether a player may take two off this board and give up the next one. Declared after seeing the board, so it
// is checked against the board as it stands, and refused - costing nothing - when:
//
//   it is the last board          there is no next pick to forfeit, so there is nothing to pay with;
//   they have one slot open       two picks need two slots to go in;
//   the board can't fill two      two options that fit two different slots of theirs;
//   it would strand the other     only when someone still picks after them. A dip by the player picking second
//                                 is free of that: nobody is left to be stranded.
export function canDoubleDip({ key, taken, boardIdx, dipperRoster, otherRoster, picksAfter }) {
  if (boardIdx >= MATCH_BOARDS - 1) return false;
  const open = openSlots(dipperRoster);
  if (open.length < 2) return false;
  const options = optionsOn(key).filter((o) => !taken.has(optionId(o)));
  if (!twoFit(options, open)) return false;
  if (!picksAfter) return true;
  return boardServes(key, taken, open, openSlots(otherRoster), 2);
}

export function dipsLeft(dips, side) {
  return MATCH_DIPS - dips.filter((d) => d.by === side).length;
}

// ---------- Steal the pick (VERSUS.md 7) ----------

export const MATCH_PICK_STEALS = 1; // one each per match

// Spent by the player who WOULD pick second on a board, before its first pick lands: the order is reversed and
// they lead it instead. Nothing else moves - the board is still dealt to both and still has to serve both.
//
// Which is the catch, and the reason this isn't just a flag: the serve-both rule is not symmetric. The board was
// chosen knowing who picked first, so reversing them can strand the player who now picks second. Checked with
// the same rule, the other way round.
export function canStealPick({ key, taken, moverRoster, otherRoster }) {
  return boardServes(key, taken, openSlots(moverRoster), openSlots(otherRoster), 1);
}

export function pickStealsLeft(swaps, side) {
  return MATCH_PICK_STEALS - swaps.filter((w) => w.by === side).length;
}

// ---------- Every move, decided in one place (VERSUS.md 4) ----------

// The match-pick Edge Function is I/O and nothing else: it says who is asking, hands the match's rows to this,
// and writes down whatever comes back. Every rule that decides a move lives here instead, for the same reason
// game-logic.mjs exists - a rule the browser enforces and the server doesn't (or the other way round) is a rule
// that will drift, and this one would drift into "the pick I made didn't happen".
//
// It reads nothing but the rows: `side` is who the caller turned out to be, and everything else - whose turn it
// is, what is on the board, what is gone - is derived. Returns either { ok: false, reason, status } or an action
// for the caller to write.
//
//   move  { claim: "clock" } | { respin } | { stealPick } | { dip } | { steal, slot } | { boardIdx, kind, ... }
const refuse = (reason, status = 409) => ({ ok: false, reason, status });

// Whether a board is still in its opening window, and until when. `deadline` is the turn's, always set
// TURN_SECONDS out, so the turn's start is known without storing it.
export function lookWindow({ state, swaps = [], picks = [], deadline = 0 }) {
  if (!state || state.done || !state.turn.first || !deadline) return null;
  if (swaps.some((w) => w.boardIdx === state.boardIdx)) return null; // already swapped: nothing left to wait for
  const follower = state.turn.side === "host" ? "guest" : "host";
  if (pickStealsLeft(swaps, follower) < 1) return null; // they have none to spend
  return { until: deadline - TURN_SECONDS * 1000 + LOOK_SECONDS * 1000, follower };
}

export function decideMove({ code, format, picks = [], respins = [], dips = [], swaps = [], side, move = {}, now = Date.now(), deadline = 0 }) {
  const state = replayMatch({ code, picks, respins, dips, swaps });
  if (state.done) return refuse("already_finished");
  const onClock = state.turn.side;
  const key = state.boardKey;
  const mine = state.roster[onClock];
  const theirs = state.roster[onClock === "host" ? "guest" : "host"];
  const asPick = (option, slot, auto) => ({
    ok: true, action: "pick", side: onClock, option, slot, auto,
    pickNo: state.pickNo, boardIdx: state.boardIdx, state,
  });

  // The clock is the one move either player may make, because it is how a match survives an opponent who has
  // closed the tab. A client saying time is up is a claim: the deadline decides.
  if (move.claim === "clock") {
    if (!deadline || now < deadline) return refuse("too_early");
    const auto = autoPick(key, state.taken, mine, format);
    // VERSUS.md 8 guarantees the board can serve them, so this is a broken invariant rather than a bad request.
    if (!auto) return { ...refuse("no_option", 500) };
    return asPick(auto.option, auto.slot, true);
  }

  // Steal the pick is the one powerup spent while it is NOT your turn, and it has to be: it belongs to the
  // player picking second, before the first pick lands - which is exactly when the other player is on the
  // clock. Decided above the turn check for that reason. Behind it, it could never be spent at all.
  if (move.stealPick) {
    if (pickStealsLeft(swaps, side) < 1) return refuse("no_steals_left");
    if (side === onClock || !state.turn.first) return refuse("already_leading");
    // Once per board, whoever spends it. Both players have one, so without this the second could simply flip
    // the board back - the order ends where it started and two powerups are gone, which is a worse game than
    // either of them not having spent one.
    if (swaps.some((w) => w.boardIdx === state.boardIdx)) return refuse("already_swapped");
    // One powerup may reorder a board, not two. A double dip is cleared against a board that has to serve the
    // dipper twice and the other player once, in that order; reversing it afterwards makes the dipper the one
    // who needs two picks from what is left, which is a stronger requirement than the board was ever checked
    // against - and on a thin board it strands them with no legal pick at all (VERSUS.md 7). Dipping after a
    // swap is fine and stays allowed: canDoubleDip checks the order as it actually stands.
    if (dips.some((d) => d.boardIdx === state.boardIdx)) return refuse("already_dipped");
    const myRoster = state.roster[side];
    const theirRoster = state.roster[side === "host" ? "guest" : "host"];
    if (!canStealPick({ key, taken: state.taken, moverRoster: myRoster, otherRoster: theirRoster })) return refuse("would_strand");
    return { ok: true, action: "swap", boardIdx: state.boardIdx, side, state };
  }

  if (side !== onClock) return refuse("not_your_turn");

  if (move.respin === "team" || move.respin === "era") {
    if (respinsLeft(respins, side)[move.respin] < 1) return refuse("no_respins_left");
    const board = respinBoard({
      code, kind: move.respin, pickNo: state.pickNo, key,
      seq: state.seq, used: state.used, taken: state.taken, roster: mine, otherRoster: theirs,
    });
    if (!board) return refuse("no_candidate");
    return { ok: true, action: "respin", kind: move.respin, key: board, pickNo: state.pickNo, side, state };
  }

  if (move.dip) {
    if (dipsLeft(dips, side) < 1) return refuse("no_dips_left");
    if (state.boardIdx >= MATCH_BOARDS - 1) return refuse("last_board");
    const order = state.boards[state.boardIdx].order;
    const picksAfter = order.slice(order.indexOf(side) + 1).some((s) => s !== side);
    if (!canDoubleDip({ key, taken: state.taken, boardIdx: state.boardIdx, dipperRoster: mine, otherRoster: theirs, picksAfter })) {
      return refuse("no_room");
    }
    return { ok: true, action: "dip", boardIdx: state.boardIdx, side, state };
  }

  if (move.steal) {
    if (stealsLeft(picks, side) < 1) return refuse("no_steals_left");
    const last = picks[picks.length - 1];
    // Nothing to steal until they have taken something, and only ever the pick just made.
    if (!last || state.turn.first || last.stolenBy) return refuse("nothing_to_steal");
    // ...and never your own. On a board you double dipped, the pick before yours is your first one, and
    // everything below reads it as the other player's: it would move your own player between your own slots,
    // spend the steal, and grade `would_strand` against the wrong roster entirely.
    if (mine[last.slot] && optionId(mine[last.slot]) === pickId(last)) return refuse("nothing_to_steal");
    const option = optionsOn(key).find((o) => optionId(o) === pickId(last));
    if (!option) return refuse("nothing_to_steal");
    const slots = stealableSlots({
      key, taken: state.taken, option, stealerRoster: mine,
      leaderRoster: state.roster[side === "host" ? "guest" : "host"], leaderSlot: last.slot,
    });
    if (slots.reason) return refuse(slots.reason);
    const slot = slots.slots.includes(move.slot) ? move.slot : slots.slots[0];
    return { ok: true, action: "steal", pickNo: last.pickNo, slot, side, state };
  }

  // An ordinary pick.
  if (move.boardIdx !== state.boardIdx) return refuse("wrong_board");
  // ...but not yet, if the board has only just opened and the other player could still take the first pick off
  // them. The clock is unaffected: it runs its full length from the same start, so this costs the leader
  // thinking time, not their turn.
  const look = lookWindow({ state, swaps, picks, deadline });
  if (look && now < look.until) return refuse("board_opening");
  const wanted = optionsOn(key).find((o) => (move.kind === "player"
    ? o.kind === "player" && o.id === Number(move.playerId) && o.season === Number(move.season)
    : o.kind === move.kind && o.team === move.team && o.season === Number(move.season)));
  if (!wanted) return refuse("not_on_board");
  if (state.taken.has(optionId(wanted))) return refuse("already_taken");
  if (!optionFits(wanted, move.slot) || mine[move.slot]) return refuse("bad_slot");
  return asPick(wanted, move.slot, false);
}
