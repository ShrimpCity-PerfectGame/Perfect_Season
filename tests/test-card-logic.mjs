// The card rules, with no browser and no database: card-logic.mjs is pure, so everything the cards promise can
// be checked by calling it. Archetypes, category scores, decks and hands and teams, synergies and abilities,
// how a battle scores, the CPU's teams, and how cards are handed out.
// tests/test-card-balance.mjs is the other half - it PLAYS thousands of battles and holds the numbers.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32, initGameData, BOARDS } from "../game-logic.mjs";
import * as C from "../card-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.error(`FAIL  ${what}`); } };
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);
// A later section's exports do not exist until its task lands; calling through this says which one is missing
// instead of dying on the first.
const need = (name) => { if (typeof C[name] === "undefined") { fails++; console.error(`FAIL  card-logic.mjs does not export ${name}`); return false; } return true; };

// ---------- 1. Cards and archetypes ----------
const catalog = read("data/cards.json");
const CHECKSUM = 9088863; // the 2,000-battle pin in section 5: a change to a number, a category or a draw moves it
const info = C.initCardData(catalog);
eq(info.cards, 3124, "every card loads");
eq(info.players, 1639, "1,639 players");
const all = [...C.CARDS.values()];
const count = (id) => all.filter((c) => C.cardArchetypes(c).includes(id)).length;
// The counts the design was agreed on (spec 3.1), measured against the pool on 2026-11-12.
for (const [id, n] of [["gunslinger", 91], ["scrambler", 70], ["manager", 86], ["volume", 64], ["workhorse", 101],
  ["receiving", 148], ["goalline", 122], ["homerun", 123], ["deep", 194], ["possession", 121], ["redzone", 245],
  ["seam", 78], ["valve", 89]]) eq(count(id), n, `${id} count`);
eq(C.ARCHETYPES.map((a) => a.id).join(), "gunslinger,scrambler,volume,manager,workhorse,goalline,homerun,receiving,deep,redzone,possession,seam,valve", "the archetypes, in priority order");
const find = (name, season) => all.find((c) => c.name === name && c.season === season);
eq(C.cardArchetype(find("Tom Brady", 2007)), "gunslinger", "2007 Brady");
eq(C.cardArchetype(find("Adrian Peterson", 2012)), "workhorse", "2012 Peterson");
eq(C.cardArchetype(find("Devery Henderson", 2011)), "deep", "2011 Henderson");
eq(C.archetypeLabel("deep"), "Deep threat", "a label");
eq(C.archetypeLabel("role"), "Role player", "the role player's label");
ok(all.filter((c) => c.archetype === "role").length > 1500, "most cards are role players");
ok(all.every((c) => c.archetype === C.cardArchetype(c)), "the stored archetype is the computed one");
ok(all.every((c) => c.archetype === "role" || C.ARCHETYPES.find((a) => a.id === c.archetype).pos.includes(c.pos)), "an archetype only lands on its own position");
// A card with nothing in the denominators is a role player, never NaN and never a throw.
const empty = { ...all[0], g: 0, att: 0, cmp: 0, car: 0, rec: 0, py: 0, ry: 0, rcy: 0, ptd: 0, rtd: 0, rctd: 0, int: 0 };
for (const pos of ["QB", "RB", "WR", "TE"]) {
  eq(C.cardArchetype({ ...empty, pos }), "role", `an empty ${pos} is a role player`);
  eq(C.cardArchetypes({ ...empty, pos }).length, 0, `and qualifies for nothing`);
}

// ---------- 2. Categories ----------
if (need("CATEGORIES")) {
  eq(C.CATEGORY_IDS.join(), "production,scoring,bigplay,workload,efficiency,star", "six categories");
  ok(all.every((c) => C.CATEGORY_IDS.every((k) => Number.isInteger(c.cats[k]) && c.cats[k] >= 0 && c.cats[k] <= 99)), "every card has a whole 0-99 score in each");
  ok(all.every((c) => c.raw === undefined), "and the raw numbers behind them are not kept on the card");
  // Ranked within a position and an era, so each group spans the scale and no position owns a category.
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const mine = all.filter((c) => c.pos === pos);
    for (const k of C.CATEGORY_IDS) {
      const avg = mine.reduce((s, c) => s + c.cats[k], 0) / mine.length;
      ok(avg > 44 && avg < 56, `${pos} ${k} averages the middle of the scale (${avg.toFixed(1)})`);
    }
  }
  const brady = find("Tom Brady", 2007), hester = find("Devin Hester", 2009);
  ok(brady.cats.scoring >= 97 && brady.cats.efficiency >= 97 && brady.cats.star >= 97, "2007 Brady is at the top in touchdowns, efficiency and star power: " + JSON.stringify(brady.cats));
  ok(brady.cats.bigplay < brady.cats.scoring, "and is not the best at everything - big play is his weakest: " + brady.cats.bigplay);
  ok(hester.cats.star < 70 && hester.cats.workload > hester.cats.scoring, "a role player's scores are a role player's");
  // The shape of a season decides its categories, not the rating: plenty of lower-rated cards beat a higher-rated one somewhere.
  const rbs = all.filter((c) => c.pos === "RB" && c.season >= 2016 && c.season <= 2020);
  let upsets = 0, pairs = 0;
  for (let i = 0; i < rbs.length; i += 7) for (let j = i + 3; j < rbs.length; j += 11) {
    const [lo, hi] = rbs[i].rating < rbs[j].rating ? [rbs[i], rbs[j]] : [rbs[j], rbs[i]];
    if (hi.rating - lo.rating < 5) continue;
    pairs++;
    if (C.CATEGORY_IDS.some((k) => lo.cats[k] > hi.cats[k])) upsets++;
  }
  ok(pairs > 50 && upsets / pairs > 0.5, `a lower-rated back beats a clearly higher-rated one in some category ${(100 * upsets / pairs).toFixed(0)}% of the time`);
  // A handful of touches is not a rate: no card with under ten catches or carries tops big play.
  const thin = all.filter((c) => (c.pos === "RB" ? c.car : c.pos === "QB" ? c.cmp : c.rec) < 10);
  ok(thin.length > 5 && thin.every((c) => c.cats.bigplay < 95), "a season of a few touches is never a top big-play score: " + Math.max(...thin.map((c) => c.cats.bigplay)));
  // Deterministic, and independent of the order the file lists cards in.
  const before = JSON.stringify(all.map((c) => [c.id, c.cats]));
  C.initCardData({ ...catalog, cards: [...catalog.cards].reverse() });
  eq(JSON.stringify([...C.CARDS.values()].sort((a, b) => a.id - b.id).map((c) => [c.id, c.cats])), before, "the scores do not depend on the order the catalog lists cards in");
  C.initCardData(catalog);
}
const A = [...C.CARDS.values()].sort((a, b) => a.id - b.id);
const F = (name, season) => A.find((c) => c.name === name && c.season === season);
const E = (c, finish = "base") => ({ id: c.id, finish });
const byPos = (pos) => A.filter((c) => c.pos === pos);
// thirty different men in the deck's shape, the first of each position by id
function someDeck(skip = 0) {
  const men = new Set(), deck = [];
  for (const pos of C.POSITIONS) for (const c of byPos(pos).slice(skip)) {
    if (deck.filter((e) => C.CARDS.get(e.id).pos === pos).length >= C.DECK_SHAPE[pos]) break;
    if (!men.has(c.pid)) { men.add(c.pid); deck.push(E(c)); }
  }
  return deck;
}

// ---------- 3. Decks, hands and teams ----------
if (need("deckProblem")) {
  const deck = someDeck();
  eq(deck.length, 30, "a deck is thirty cards");
  eq(C.deckProblem(deck, null), null, "5, 10, 10 and 5 different men is a deck");
  const owned = new Map(deck.map((e) => [C.ownKey(e.id, e.finish), 1]));
  eq(C.deckProblem(deck, owned), null, "and one you own is one you may save");
  const qb2 = byPos("QB").find((c) => !deck.some((e) => C.CARDS.get(e.id).pid === c.pid));
  const sameMan = A.find((c) => c.pid === C.CARDS.get(deck[0].id).pid && c.id !== deck[0].id);
  for (const [reason, list, own] of [
    ["malformed", null], ["malformed", "thirty of my best"], ["malformed", { ...deck }],
    ["bad_deck", deck.slice(1)], ["bad_deck", [...deck, E(qb2)]],
    ["malformed", [null, ...deck.slice(1)]], ["malformed", [[1], ...deck.slice(1)]],
    ["unknown_card", [{ id: 99999999, finish: "base" }, ...deck.slice(1)]],
    ["unknown_card", [{ id: "constructor", finish: "base" }, ...deck.slice(1)]],
    ["bad_finish", [{ id: deck[0].id, finish: "diamond" }, ...deck.slice(1)]],
    ["bad_finish", [{ id: deck[0].id, finish: "constructor" }, ...deck.slice(1)]],
    ["bad_deck", [E(qb2), ...deck.slice(0, 5), ...deck.slice(7)]], // six quarterbacks, nine backs
    ...(sameMan ? [["same_player", [...deck.slice(0, 4), E(sameMan), ...deck.slice(5)]]] : []),
    ["not_owned", deck, new Map()],
    ["not_owned", [{ id: deck[0].id, finish: "prism" }, ...deck.slice(1)], owned],
  ]) eq(C.deckProblem(list, own === undefined ? null : own), reason, `deckProblem: ${reason}`);

  const hand = C.dealHand(deck, mulberry32(3));
  eq(hand.length, 12, "a hand is twelve");
  eq(C.POSITIONS.map((p) => hand.filter((e) => C.CARDS.get(e.id).pos === p).length).join(), "2,4,4,2", "two quarterbacks, four backs, four receivers, two tight ends");
  ok(hand.every((e) => deck.some((d) => d.id === e.id && d.finish === e.finish)) && new Set(hand.map((e) => e.id)).size === 12, "all out of the deck, none twice");
  let draws = 0; C.dealHand(deck, () => (draws++, 0.5));
  eq(draws, 12, "in exactly twelve draws");
  eq(JSON.stringify(C.dealHand([...deck].reverse(), mulberry32(3))), JSON.stringify(hand), "the same draws deal the same hand whatever order the deck was saved in");
  const seen = new Set(); for (let i = 0; i < 400; i++) for (const e of C.dealHand(deck, mulberry32(i + 1))) seen.add(e.id);
  eq(seen.size, 30, "over many deals every card in the deck comes up");
  let noTeam = 0; for (let i = 0; i < 300; i++) if (!C.bestTeam(C.dealHand(deck, mulberry32(i + 50)))) noTeam++;
  eq(noTeam, 0, "every hand can field a team");

  const team = C.bestTeam(hand);
  eq(C.teamProblem(team, hand), null, "the best six out of a hand is a team");
  ok(team.every((e, i) => i === 0 || C.CARDS.get(team[i - 1].id).rating >= C.CARDS.get(e.id).rating), "best first");
  const benchQb = hand.find((e) => C.CARDS.get(e.id).pos === "QB" && !team.some((t) => t.id === e.id));
  const notQb = team.findIndex((e) => C.CARDS.get(e.id).pos !== "QB");
  const theQb = team.findIndex((e) => C.CARDS.get(e.id).pos === "QB");
  const outsider = A.find((c) => c.pos === C.CARDS.get(team[notQb].id).pos && !deck.some((d) => C.CARDS.get(d.id).pid === c.pid));
  const swap = (i, e) => team.map((t, j) => (j === i ? e : t));
  for (const [reason, list, h] of [
    ["malformed", null], ["malformed", "six"], ["malformed", { 0: team[0] }],
    ["incomplete", team.slice(0, 5)], ["incomplete", swap(2, null)], ["incomplete", []],
    ["malformed", [...team, team[0]]], ["malformed", swap(0, [1])],
    ["unknown_card", swap(0, { id: 99999999, finish: "base" })],
    ["bad_finish", swap(0, { id: team[0].id, finish: "diamond" })],
    ["bad_slot", swap(notQb, benchQb)],                 // two quarterbacks
    ["bad_slot", swap(theQb, E(outsider))],             // none
    ["same_player", (() => { // the same card twice, in two spots of one position, so the shape still holds
      const pos = C.POSITIONS.find((p) => p !== "QB" && team.filter((e) => C.CARDS.get(e.id).pos === p).length >= 2);
      const spots = team.map((e, i) => (C.CARDS.get(e.id).pos === pos ? i : -1)).filter((i) => i >= 0);
      return swap(spots[0], team[spots[1]]);
    })()],
    ["not_in_hand", swap(notQb, E(outsider)), hand],
    ["not_in_hand", swap(0, { id: team[0].id, finish: "prism" }), hand],
  ]) eq(C.teamProblem(list, h === undefined ? null : h), reason, `teamProblem: ${reason}`);
  eq(C.teamProblem([...team].reverse(), hand), null, "any order of a legal six is legal - the order is the player's");
  eq(C.bestTeam(hand.filter((e) => C.CARDS.get(e.id).pos !== "TE")), null, "no tight end, no team");

  eq(C.bestDeck(deck).length, 30, "thirty cards in the shape make a deck of themselves");
  eq(C.bestDeck(deck.slice(1)), null, "one short of a position is no deck");
  const rich = [...deck, ...someDeck(40)];
  const best = C.bestDeck(rich);
  eq(C.deckProblem(best, null), null, "the best deck out of a bigger collection is a legal one");
  ok(best.reduce((s, e) => s + C.CARDS.get(e.id).rating, 0) >= deck.reduce((s, e) => s + C.CARDS.get(e.id).rating, 0), "and at least as strong as any thirty of them");
  eq(C.bestDeck(null), null, "nothing at all is no deck");
}

// ---------- 4. Synergies and abilities ----------
if (need("playedSynergies")) {
  // Real teammates: a quarterback and two receivers from one team in one season (the 2021 Jets have nine cards).
  const qb = F("Zach Wilson", 2021), w1 = F("Corey Davis", 2021), w2 = F("Elijah Moore", 2021);
  ok(qb && w1 && w2 && qb.team === w1.team && w1.team === w2.team, "three real teammates are in the catalog");
  const pts = (mods, key) => mods.find((m) => m.key === key)?.pts ?? 0;
  eq(C.playedSynergies(E(qb), []).length, 0, "the first card down has nobody to play off");
  const second = C.playedSynergies(E(w1), [E(qb)]);
  eq(pts(second, "team"), C.TEAM_BONUS, "the second, with one teammate already played");
  eq(pts(second, "season"), C.SEASON_BONUS, "from the same season");
  eq(pts(second, "mates"), C.TEAMMATE_BONUS, "and a real teammate");
  const third = C.playedSynergies(E(w2), [E(qb), E(w1)]);
  eq(pts(third, "team"), 2 * C.TEAM_BONUS, "the third, with two - synergy builds as the battle goes");
  eq(pts(third, "mates"), C.TEAMMATE_BONUS, "real teammates once, however many");
  const stranger = byPos("RB").find((c) => c.team !== qb.team && c.season !== qb.season && c.archetype === "role");
  eq(C.playedSynergies(E(stranger), [E(qb), E(w1)]).length, 0, "a stranger gets nothing");
  const sameTeam = A.filter((c) => c.team === qb.team && c.pid !== qb.pid).slice(0, 5).map((c) => E(c));
  eq(pts(C.playedSynergies(E(qb), sameTeam), "team"), C.TEAM_BONUS_MAX, "the team bonus stops at its cap");
  const gun = byPos("QB").find((c) => c.archetype === "gunslinger"), deep = byPos("WR").find((c) => c.archetype === "deep" && c.team !== gun.team && c.season !== gun.season);
  eq(pts(C.playedSynergies(E(deep), [E(gun)]), "pair:gunslinger+deep"), 6, "a Deep threat played after his Gunslinger");
  eq(pts(C.playedSynergies(E(gun), []), "pair:gunslinger+deep"), 0, "the Gunslinger played first gets no pair - nobody is down yet");
  ok(Object.keys(C.ABILITIES).length === C.ARCHETYPES.length && C.ARCHETYPES.every((a) => C.ABILITIES[a.id]), "every archetype has an ability");
  eq(C.abilityOf({ archetype: "role" }), null, "and a Role player has none");
  const R = (over) => ({ cat: "star", wins: 0, losses: 0, prevWon: null, qbPlayed: false, foeRating: 50, rating: 50, ...over });
  for (const [arch, yes, no] of [
    ["gunslinger", { cat: "bigplay" }, { cat: "scoring" }], ["homerun", { cat: "bigplay" }, { cat: "workload" }],
    ["goalline", { cat: "scoring" }, { cat: "bigplay" }], ["redzone", { cat: "scoring" }, { cat: "production" }],
    ["volume", { cat: "production" }, { cat: "efficiency" }], ["possession", { cat: "efficiency" }, { cat: "scoring" }],
    ["scrambler", { foeRating: 90 }, { foeRating: 40 }], ["workhorse", { prevWon: true }, { prevWon: false }],
    ["deep", { qbPlayed: true }, {}], ["receiving", { qbPlayed: true }, {}], ["seam", { wins: 1, losses: 2 }, { wins: 2, losses: 2 }],
  ]) {
    ok(C.ABILITIES[arch].when(R(yes)) === true, `${arch} fires when it should`);
    ok(C.ABILITIES[arch].when(R(no)) !== true, `${arch} does not fire otherwise`);
  }
  ok(C.ABILITIES.workhorse.when(R({ prevWon: null })) !== true, "momentum needs a round before it");
}

// ---------- 5. A battle, a round at a time ----------
if (need("playRound")) {
  const deck = someDeck();
  const hand = C.dealHand(deck, mulberry32(11));
  const foe = C.buildTeam(mulberry32(12), 55);
  // The other side: six spots, each card fitting its own, in an order with a Flex last.
  eq(foe.map((e) => e.spot).slice().sort().join(), [...C.SPOTS].sort().join(), "the other side's six carry the six spots");
  eq(foe[5].spot, "FLEX", "and the last is a Flex");
  ok(foe.every((e) => C.spotFits(C.CARDS.get(e.id).pos, e.spot)), "each of their cards fits its spot");
  ok(C.spotFits("TE", "FLEX") && C.spotFits("RB", "FLEX") && !C.spotFits("QB", "FLEX") && C.spotFits("QB", "QB") && !C.spotFits("RB", "WR"), "a Flex is anybody but a quarterback");
  const firsts = new Set(Array.from({ length: 300 }, (_, i) => C.buildTeam(mulberry32(i + 1), 60)[0].spot));
  eq(firsts.size, 5, "the first round can be any of the five spots that are not the last Flex - it is not the quarterback every time");
  ok(Array.from({ length: 300 }, (_, i) => C.buildTeam(mulberry32(i + 1), 60)).every((t) => t[5].spot === "FLEX"), "and the last round is a Flex in every one of 300 teams");

  // What may be played: in the hand, fits the spot, not already down.
  const spot = foe[0].spot;
  const fit = hand.find((e) => C.spotFits(C.CARDS.get(e.id).pos, spot));
  const misfit = hand.find((e) => !C.spotFits(C.CARDS.get(e.id).pos, spot));
  const outsider = A.find((c) => C.spotFits(c.pos, spot) && !deck.some((d) => C.CARDS.get(d.id).pid === c.pid));
  eq(C.roundProblem(hand, foe, [], fit), null, "a card from the hand that fits the spot may be played");
  for (const [reason, entry, rounds] of [
    ["malformed", null], ["malformed", "my best card"], ["unknown_card", { id: 99999999, finish: "base" }], ["bad_finish", { id: fit.id, finish: "diamond" }],
    ["not_in_hand", E(outsider)], ["not_in_hand", { id: fit.id, finish: "prism" }], ["bad_slot", misfit],
  ]) eq(C.roundProblem(hand, foe, rounds || [], entry), reason, `roundProblem: ${reason}`);
  eq(C.roundProblem(hand, foe, new Array(6).fill({ mine: fit }), fit), "malformed", "a seventh round is not a round");
  eq(C.roundProblem(null, foe, [], fit), "malformed", "nor is one with no hand");
  ok(C.playable(hand, foe, []).every((e) => C.spotFits(C.CARDS.get(e.id).pos, spot)) && C.playable(hand, foe, []).length >= 2, "playable lists the cards that fit, and there is always a choice");
  ok(C.playable(hand, foe, []).every((e, i, list) => i === 0 || C.CARDS.get(list[i - 1].id).rating >= C.CARDS.get(e.id).rating), "best first");

  // Play one, and what it changes for the next.
  let draws = 0;
  const r0 = C.playRound(foe, [], fit, "star", () => (draws++, 0.5));
  eq(draws, 4, "a round is four draws");
  ok(r0.cat === "star" && r0.spot === spot && r0.mine.id === fit.id && r0.foe.id === foe[0].id && r0.mine.roll === 0, "it is your card against theirs in that spot, on that category");
  ok(Math.abs(r0.mine.total - (r0.mine.base + r0.mine.roll + r0.mine.mods.reduce((n, m) => n + m.pts, 0))) < 0.06 && r0.mine.base === C.roundBase(fit, "star"), "a card's total is its base, its luck and its bonuses");
  eq(r0.win, r0.mine.total > r0.foe.total ? "me" : r0.mine.total < r0.foe.total ? "foe" : "tie", "the higher total takes the round");
  eq(r0.score.join(), r0.win === "me" ? "1,0" : r0.win === "foe" ? "0,1" : "0,0", "and the score moves");
  eq(C.roundProblem(hand, foe, [r0], fit), foe[1].spot === spot || (foe[1].spot === "FLEX" && C.CARDS.get(fit.id).pos !== "QB") ? "already_played" : "bad_slot", "the same card cannot be played again");

  // "Pick for me" never strands a later spot, and a whole battle can always be played from any hand.
  let stuck = 0, wrong = 0;
  for (let i = 0; i < 500; i++) {
    const h = C.dealHand(deck, mulberry32(i + 100)), f = C.buildTeam(mulberry32(i + 900), 40 + (i % 70));
    const picks = C.autoLineup(h, f);
    if (!picks) { stuck++; continue; }
    if (picks.some((e, k) => !C.spotFits(C.CARDS.get(e.id).pos, f[k].spot)) || new Set(picks.map((e) => C.CARDS.get(e.id).pid)).size !== 6) wrong++;
  }
  eq(stuck + wrong, 0, "500 hands against 500 teams: Pick for me fills all six spots, legally, every time");
  // ...and the trap it avoids: a Flex round that eats the only card a later spot can use.
  const flexFirst = [{ ...foe.find((e) => e.spot === "FLEX"), spot: "FLEX" }, ...["TE", "QB", "RB", "WR"].map((s) => ({ ...foe.find((e) => e.spot === s) })), { ...foe.filter((e) => e.spot === "FLEX")[1] }];
  const tes = hand.filter((e) => C.CARDS.get(e.id).pos === "TE");
  const oneTe = hand.filter((e) => C.CARDS.get(e.id).pos !== "TE" || e.id === tes[0].id);
  ok(C.leavesAWay(oneTe, flexFirst, [], oneTe.find((e) => C.CARDS.get(e.id).pos === "RB")) && !C.leavesAWay(oneTe, flexFirst, [], tes[0]), "with one tight end left and his round to come, he is not spent on a Flex");
  ok(C.CARDS.get(C.autoPick(oneTe, flexFirst, []).id).pos !== "TE", "and Pick for me does not spend him");

  // A whole battle: the same rounds, added up.
  const mine = C.autoLineup(hand, foe);
  draws = 0;
  const b = C.scoreBattle(mine, foe, () => (draws++, 0.5));
  eq(draws, 29, "twenty-nine draws: five to order the categories, four a round");
  eq(b.rounds.map((x) => x.cat).sort().join(), [...C.CATEGORY_IDS].sort().join(), "each category exactly once");
  eq(b.rounds.map((x) => x.spot).join(), foe.map((e) => e.spot).join(), "the rounds are the other side's spots, in order");
  eq(JSON.stringify(C.battleResult(b.rounds)), JSON.stringify(b), "battleResult is the rounds added up");
  eq(b.win, b.wins !== b.losses ? b.wins > b.losses : b.total >= b.foeTotal, "more rounds wins; level on rounds, the higher total; dead level, you");
  eq(JSON.stringify(C.scoreBattle(mine, foe, mulberry32(77))), JSON.stringify(C.scoreBattle(mine, foe, mulberry32(77))), "the same generator plays the same battle");
  const orders = new Set(Array.from({ length: 60 }, (_, i) => C.scoreBattle(mine, foe, mulberry32(i + 1)).rounds.map((x) => x.cat).join()));
  ok(orders.size > 40, "the category order really is shuffled: " + orders.size + " orders in 60 battles");
  eq(C.shuffleCategories(mulberry32(3)).slice().sort().join(), [...C.CATEGORY_IDS].sort().join(), "shuffleCategories is the six, each once");
  // Luck is bounded, and wider only for a Gunslinger.
  let worst = 0, wide = 0;
  for (let i = 0; i < 200; i++) for (const x of C.scoreBattle(mine, foe, mulberry32(i + 500)).rounds) for (const side of [x.mine, x.foe]) {
    if (C.CARDS.get(side.id).archetype === "gunslinger") wide = Math.max(wide, Math.abs(side.roll)); else worst = Math.max(worst, Math.abs(side.roll));
  }
  ok(worst <= C.LUCK_SPREAD && worst > C.LUCK_SPREAD * 0.7, "luck stays inside its spread: " + worst);
  ok(wide <= C.LUCK_SPREAD * C.LUCK_WIDE, "a Gunslinger's inside the wider one: " + wide);
  const fixed = C.scoreBattle(mine, foe, () => 0.5, ["star", "scoring", "bigplay", "workload", "efficiency", "production"], 5);
  eq(fixed.rounds.map((x) => x.cat).join(), "star,scoring,bigplay,workload,efficiency,production", "the categories can be handed in");
  ok(fixed.rounds.every((x) => x.foe.mods.some((m) => m.key === "edge" && m.pts === 5) && !x.mine.mods.some((m) => m.key === "edge")), "an edge goes on every card of theirs and none of yours");
  const one = E(F("Adrian Peterson", 2012));
  ok(new Set(C.CATEGORY_IDS.map((k) => C.roundBase(one, k))).size >= 4, "one card is worth different amounts in different categories");
  eq(Math.round(10 * (C.roundBase(E(F("Adrian Peterson", 2012), "prism"), "star") - C.roundBase(one, "star"))) / 10, 0, "a finish is not in a card's base");
  {
    const foeSix = C.buildTeam(mulberry32(5), 60), flat = () => 0.5;
    const plain = C.playRound(foeSix, [], E(F("Adrian Peterson", 2012)), "star", flat), shiny = C.playRound(foeSix, [], E(F("Adrian Peterson", 2012), "prism"), "star", flat);
    eq(Math.round(10 * (shiny.mine.total - plain.mine.total)) / 10, 15, "it is added whole to the round: a Prism plays fifteen points up");
    ok(shiny.mine.mods.some((m) => m.key === "finish" && m.pts === 15 && m.label === "Prism finish") && !plain.mine.mods.some((m) => m.key === "finish"), "and is named as a bonus of its own");
    eq([C.FINISH_BONUS.base, C.FINISH_BONUS.silver, C.FINISH_BONUS.gold, C.FINISH_BONUS.prism].join(), "0,5,10,15", "five, ten and fifteen");
  }

  // The abilities that depend on the battle so far - which is what makes the next card a decision.
  const mgr = byPos("QB").find((c) => c.archetype === "manager"), deepWr = byPos("WR").find((c) => c.archetype === "deep" && c.team !== mgr.team && c.season !== mgr.season);
  const two = [{ ...foe.find((e) => e.spot === "QB") }, { ...foe.find((e) => e.spot === "WR") }];
  const afterQb = C.playRound(two, [C.playRound(two, [], E(mgr), "star", () => 0.5)], E(deepWr), "star", () => 0.5);
  ok(afterQb.mine.mods.some((m) => m.key === "next" && m.pts === C.ABILITY_NEXT), "the card after a Game manager gets his lift");
  ok(afterQb.mine.mods.some((m) => m.key === "ability" && m.label === "Go route"), "and a Deep threat played after his quarterback fires");
  const wrFirst = C.playRound([two[1], two[0]], [], E(deepWr), "star", () => 0.5);
  ok(!wrFirst.mine.mods.some((m) => m.key === "ability") && wrFirst.mine.ability.on === false, "played BEFORE the quarterback he does not - and is shown his ability as not this round");
  const seamTe = byPos("TE").find((c) => c.archetype === "seam");
  const behind = [{ cat: "x", win: "foe", mine: E(byPos("RB")[0]), foe: E(byPos("RB")[1]) }];
  // across from a Role player, so nothing cancels him
  const plain = { ...E(byPos("TE").find((c) => c.archetype === "role")), spot: "TE" };
  const teSpot = [{ ...foe[0] }, plain];
  ok(C.playRound(teSpot, behind, E(seamTe), "star", () => 0.5).mine.mods.some((m) => m.label === "Clutch"), "a Seam stretcher played when you are behind is Clutch");
  ok(!C.playRound([teSpot[1]], [], E(seamTe), "star", () => 0.5).mine.mods.some((m) => m.label === "Clutch"), "and level, he is not");
  const valve = byPos("TE").find((c) => c.archetype === "valve"), goal = byPos("RB").find((c) => c.archetype === "goalline");
  const cancelled = C.playRound([{ ...E(valve), spot: "RB" }], [], E(goal), "scoring", () => 0.5);
  ok(!cancelled.mine.mods.some((m) => m.key === "ability") && cancelled.mine.ability.cancelled === true, "a Goal-line back in a Touchdown round, across from a Safety valve, gets nothing");
  ok(C.playRound([{ ...E(byPos("RB").find((c) => c.archetype === "role")), spot: "RB" }], [], E(goal), "scoring", () => 0.5).mine.mods.some((m) => m.key === "ability" && m.pts === 6), "and across from anybody else he gets his six");

  // Pinned: 2,000 battles, so a change to any number or to the order of a draw shows here.
  let sum = 0; const pin = mulberry32(20261114);
  for (let i = 0; i < 2000; i++) {
    const h = C.dealHand(deck, pin), f = C.buildTeam(pin, 40 + (i % 60));
    const res = C.scoreBattle(C.autoLineup(h, f), f, pin);
    sum = (sum + Math.round(res.total * 10) + 7 * res.wins + (res.win ? 13 : 0)) % 1000000007;
  }
  console.log(`  2,000 battles checksum: ${sum}`);
  eq(sum, CHECKSUM, "the pinned checksum (a change here moves every battle - the client and the functions must ship together)");
}

// ---------- 6. The other side: the ladder and the daily ----------
if (need("buildTeam")) {
  let draws = 0;
  const t = C.buildTeam(() => (draws++, 0.4), 70);
  eq(draws, 10, "a CPU team is ten draws");
  eq(C.teamProblem(t, null), null, "and a legal six");
  ok(t.every((e) => e.finish === "base" && Math.abs(C.CARDS.get(e.id).rating - 70) <= C.CPU_BAND), "of Base cards near its target");
  for (const target of [20, 38, 70, 100, 124, 140]) eq(C.teamProblem(C.buildTeam(mulberry32(target), target), null), null, `a team can be built at ${target}`);
  eq(JSON.stringify(C.ladderFoe("a-seed", 3)), JSON.stringify(C.ladderFoe("a-seed", 3)), "a run's team at a step follows from the seed and the step");
  ok(JSON.stringify(C.ladderFoe("a-seed", 3)) !== JSON.stringify(C.ladderFoe("b-seed", 3)), "and two runs meet different teams");
  const avg = (team) => team.reduce((s, e) => s + C.CARDS.get(e.id).rating, 0) / 6;
  ok(avg(C.ladderFoe("s", 0)) < avg(C.ladderFoe("s", 5)) && avg(C.ladderFoe("s", 5)) < avg(C.ladderFoe("s", 11)), "each step up the ladder is a stronger team");
  eq(C.ladderTarget(0), C.CPU_START, "it starts at the bottom");
  eq(C.ladderTarget(200), C.CPU_MAX, "and cannot field better cards than the game holds");
  eq(C.ladderEdge(3), 0, "no edge while the cards can still get better");
  ok(C.ladderEdge(20) > 0 && C.ladderEdge(30) > C.ladderEdge(20), "past that, the top team plays harder with every win");
  eq(JSON.stringify(C.ladderFoe("s", -2)), JSON.stringify(C.ladderFoe("s", 0)), "a step that is not one is read as the first");
  ok(C.ladderName(0) === "Practice squad" && C.ladderName(99) === "The GOATs", "the tiers have names");

  const day = "2026-11-14";
  const dfoe = C.dailyFoe(day);
  eq(JSON.stringify(dfoe), JSON.stringify(C.dailyFoe(day)), "the day's team is the day's");
  ok(JSON.stringify(dfoe) !== JSON.stringify(C.dailyFoe("2026-11-15")), "and tomorrow's is another");
  eq(C.dailyCategories(day).slice().sort().join(), [...C.CATEGORY_IDS].sort().join(), "the day's categories are the six");
  const hand = C.dealHand(someDeck(30), mulberry32(5)), team = C.autoLineup(hand, dfoe);
  const a = C.dailyBattle(day, team);
  eq(JSON.stringify(a), JSON.stringify(C.dailyBattle(day, team)), "the same cards in the same spots score the same for everyone");
  eq(a.rounds.map((x) => x.cat).join(), C.dailyCategories(day).join(), "on the day's categories, in the day's order");
  eq(JSON.stringify(C.dailyRound(day, [], team[0])), JSON.stringify(a.rounds[0]), "a round played on its own is the round of the whole battle");
  // ONE ROLL PER CARD PER DAY: the same card has the same luck whichever round it plays in, and whatever its finish.
  const flexA = dfoe.findIndex((e) => e.spot === "FLEX"), flexB = 5;
  const swapped = team.slice(); [swapped[flexA], swapped[flexB]] = [swapped[flexB], swapped[flexA]];
  const moved = C.dailyBattle(day, swapped);
  eq(moved.rounds[flexB].mine.roll, a.rounds[flexA].mine.roll, "a card keeps its luck for the day whichever round it plays in");
  eq(moved.rounds[flexA].mine.roll, a.rounds[flexB].mine.roll, "both of them do");
  const shiny = C.dailyBattle(day, [{ id: team[0].id, finish: "prism" }, ...team.slice(1)]);
  eq(shiny.rounds[0].mine.roll, a.rounds[0].mine.roll, "and a better finish is the same luck, plus its bonus");
  ok(a.rounds.every((x, i) => x.foe.roll === moved.rounds[i].foe.roll), "the other side's luck is the day's too");
  eq(JSON.stringify(C.dailyScore(a)), JSON.stringify({ rounds: a.wins, score: a.total }), "ranked by rounds won, then total");
}

// ---------- 7. Getting cards: the starter cards and the daily card ----------
if (need("starterFill")) {
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    const fill = C.starterFill([], mulberry32(i + 1));
    const deck = fill.map((g) => ({ id: g.id, finish: g.finish }));
    if (fill.length !== 30 || C.deckProblem(deck, null) !== null || fill.some((g) => g.finish !== "base" || C.CARDS.get(g.id).rating >= C.STARTER_MAX_RATING) || new Set(fill.map((g) => g.ref)).size !== 30) bad++;
  }
  eq(bad, 0, "200 starter fills from nothing: thirty Base cards under 60 that are a legal deck, each with a ref of its own");
  eq(C.starterFill([], mulberry32(1)).map((g) => g.ref).slice(0, 6).join(), "deck:QB:0,deck:QB:1,deck:QB:2,deck:QB:3,deck:QB:4,deck:RB:0", "a ref names the deck spot it fills");
  // An account that opened the OLD eight-card starter is topped up to a deck, and only to a deck.
  const old = [byPos("QB")[3], byPos("RB")[3], byPos("WR")[3], byPos("TE")[3], byPos("RB")[9], byPos("WR")[9], byPos("QB")[9], byPos("WR")[15]].map((c) => E(c));
  const top = C.starterFill(old, mulberry32(8));
  eq(top.length, 22, "eight held in the shape, twenty-two to come");
  eq(top.filter((g) => g.ref.startsWith("deck:QB:")).map((g) => g.ref).join(), "deck:QB:2,deck:QB:3,deck:QB:4", "it fills the spots that are empty, by number");
  eq(C.deckProblem(C.bestDeck([...old, ...top.map((g) => ({ id: g.id, finish: g.finish }))]), null), null, "and then there is a deck");
  ok(top.every((g) => !old.some((o) => C.CARDS.get(o.id).pid === C.CARDS.get(g.id).pid)), "never a man the account already has");
  eq(C.starterFill(someDeck(), mulberry32(1)).length, 0, "a collection that can already fill a deck gets nothing");
  let n = 0; C.starterFill(old, () => (n++, 0.5));
  eq(n, 22, "one draw a card");
  eq(JSON.stringify(C.starterFill([], mulberry32(9))), JSON.stringify(C.starterFill([], mulberry32(9))), "the same generator deals the same cards");

  eq(C.rollFinish(() => 0), "base", "the bottom of the roll is Base");
  eq(C.rollFinish(() => 0.9999999), "prism", "the top of it is Prism");
  eq(C.rollFinish(() => 0.80), "silver", "exactly at Base's edge is Silver");
  eq(C.rollFinish(() => 0.5, { base: 0, silver: 0, gold: 0, prism: 1 }), "prism", "the odds are whatever it is handed");
  const tally = { base: 0, silver: 0, gold: 0, prism: 0 }; const r = mulberry32(4242);
  for (let i = 0; i < 20000; i++) tally[C.rollFinish(r)]++;
  for (const f of C.FINISHES) ok(Math.abs(tally[f] / 20000 - C.DAILY_FINISH_ODDS[f]) <= (f === "prism" ? 0.003 : 0.01), `${f} comes up as often as its odds say (${(tally[f] / 200).toFixed(2)}%)`);
  eq(+(Object.values(C.DAILY_FINISH_ODDS).reduce((a, b) => a + b, 0)).toFixed(6), 1, "the daily finish odds add up to one");

  const pool = read("data/players.json"); initGameData(pool.players, pool.opponents);
  eq(C.cardBoardKey(find("Tom Brady", 2007)), "NE|1", "2007 Brady came off the 2006-10 Patriots board");
  ok(all.every((c) => BOARDS[C.cardBoardKey(c)]), "every card's board is a board the draft deals");
  ok(all.every((c) => BOARDS[C.cardBoardKey(c)].some((p) => p.name === c.name && p.season === c.season)), "and the card's own row is on it");
  let draws = 0; const counted = () => (draws++, 0.3);
  const dc = C.dailyCard(["NE|1"], counted);
  eq(C.cardBoardKey(C.CARDS.get(dc.id)), "NE|1", "a daily card comes off one of the day's boards");
  eq(draws, 2, "in exactly two draws");
  ok(C.FINISHES.includes(dc.finish), "with a finish");
  // The card is one of the players DRAFTED, not just somebody off the same board.
  const brady = BOARDS["NE|1"].find((p) => p.name === "Tom Brady" && p.season === 2007);
  const kc = BOARDS["KC|0"][0];
  const picks = [{ key: "NE|1", id: brady.id, season: brady.season }, { key: "KC|0", id: kc.id, season: kc.season }];
  const got = new Set(Array.from({ length: 200 }, (_, i) => C.dailyCard(picks, mulberry32(i + 1)).id));
  eq([...got].map((id) => C.CARDS.get(id).name).sort().join(), [brady.name, kc.name].sort().join(), "a daily card is one of the players drafted, and either can come up");
  eq(C.cardBoardKey(C.CARDS.get(C.dailyCard([{ key: "NE|1", id: -5, season: 1901 }], mulberry32(3)).id)), "NE|1", "a pick with no card falls back to its board rather than earning nothing");
  eq(C.dailyCard([], mulberry32(1)), null, "no boards, no card");
  eq(C.dailyCard(["XX|9"], mulberry32(1)), null, "a board that is not one, no card");
  eq(C.dailyCard(null, mulberry32(1)), null, "nothing at all, no card");
  eq(JSON.stringify(C.dailyCard(["NE|1", "KC|0"], mulberry32(5))), JSON.stringify(C.dailyCard(["KC|0", "NE|1"], mulberry32(5))), "the order the boards are listed in does not matter");
  const seen = new Set(Array.from({ length: 300 }, (_, i) => C.dailyCard(["NE|1", "KC|0"], mulberry32(i + 1)).id));
  ok(seen.size > 15 && [...seen].every((id) => ["NE|1", "KC|0"].includes(C.cardBoardKey(C.CARDS.get(id)))), "any card on those boards can come up, and no other");
}

console.log(fails ? `\n${fails} FAILED` : "card logic: all checks passed");
process.exit(fails ? 1 : 0);
