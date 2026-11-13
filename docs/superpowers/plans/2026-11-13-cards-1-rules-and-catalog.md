# Cards, plan 1 of 5: the catalog and the rules - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A frozen card catalog and one pure rules module that can score any card battle, with a test that prints and holds the balance numbers the rest of the feature depends on.

**Architecture:** `tools/data/build-card-catalog.mjs` writes `data/cards.json` once and only ever appends to it. `card-logic.mjs` is a pure module in the mould of `century-logic.mjs`: archetypes, defense traits, lineup legality and battle scoring, imported later by the browser, an Edge Function and the tests. Nothing in this plan touches React, Supabase, the build or any screen, so nothing a player can see changes.

**Tech Stack:** Node ES modules, no new dependencies. Tests are standalone scripts in `tests/` that exit non-zero on failure (`node tests/test-x.mjs`), using the local `ok`/`eq` helpers every existing logic test defines; `tests/run-all.mjs` globs the directory.

**Spec:** `docs/superpowers/specs/2026-11-13-card-collection-design.md`. Read it first; sections 3, 4 and 7 govern this plan.

**Why this is plan 1 of 5.** The spec covers five subsystems (rules; ownership and collection; packs; battles on the server and on screen; badges, profile and boards). Every later one needs numbers only this plan can produce - what a starter deck can beat, what a win should pay - so they are planned after this one's balance test has printed them.

## Global Constraints

- `card-logic.mjs` imports only from `./game-logic.mjs`. No React, no Supabase, no DOM, no `Math.random` (every random draw comes from a `rand` function passed in).
- Never order anything with a random comparator, and consume a fixed number of draws per battle: the browser and Deno must agree call for call.
- A card's strength is its printed fantasy `rating` in every slot, Flex included. `flexRating`/`effectiveRating` are not used.
- Finish bonus in battle is exactly Base +0, Silver +1, Gold +2, Prism +3.
- Lineup slots are `SLOTS` from `game-logic.mjs`: `["QB","RB","WR","TE","FLEX1","FLEX2"]`; a slot accepts a position by `fits(pos, slot)`.
- `data/cards.json` is append-only: an existing card's `id`, `pid` and stats never change after the build that created it.
- No existing file's behaviour changes. `game-logic.mjs`, `data/players.json` and `data/versus-pool.json` are read, never edited. The sim checksum test must stay green.
- `data/cards.json` must not be shipped to the site by this plan. Check how `build.mjs` copies `data/` and, if it copies the whole folder, exclude the file; the feature is behind a switch that does not exist yet.
- No URL may appear in `data/cards.json` (`tests/test-site-pages.mjs` holds shipped data files to that).
- Work on a branch cut from `staging`, one commit per task. No version bump or changelog entry: nothing here reaches a player.

## Review Focus

1. **A rebuilt `players.json` (2026 season added, a best season moved)** - every card that existed keeps its id, pid and stats; only new cards appear. Pinned in Task 1.
2. **A lineup naming a card id that does not exist, a finish that is not one of the four, or a missing slot** - `lineupProblem` answers a reason code; `scoreBattle` is never reached and nothing throws. Pinned in Task 4.
3. **A card with zero games, attempts, carries or catches** - archetype tests divide by these; the card must come out a Role player, never `NaN` or a thrown error. Pinned in Task 2.
4. **Ties at the cut for a defense trait** (two teams level for fifth in a season) - the result must be the same on every run and every engine. Pinned in Task 3.
5. **`rand` returning exactly 0 or values just under 1** - totals stay finite and inside the documented luck spread. Pinned in Task 5.

---

### Task 1: The frozen card catalog

**Files:**
- Create: `tools/data/build-card-catalog.mjs`
- Create: `data/cards.json` (generated)
- Test: `tests/test-card-catalog.mjs`

**Interfaces:**
- Consumes: `initGameData(players, opponents)` and `BOARDS` from `game-logic.mjs` (each board row has `id, name, pos, season, g, cmp, att, py, ptd, int, car, ry, rtd, rec, rcy, rctd, fl, ppr, rating, team, w`).
- Produces: `data/cards.json` shaped `{ built, columns, cards }` where `columns` is exactly
  `["id","pid","name","pos","season","team","g","cmp","att","py","ptd","int","car","ry","rtd","rec","rcy","rctd","fl","rating"]` and `cards` is an array of positional rows sorted by `id`.
  Also exports `mergeCatalog(existing, rows) -> { cards, added }` for the test.

Rules the builder implements:
- A card's natural key is `name|season|team`. Two input rows with one key is an error: throw, write nothing.
- `id` is an integer from 1. An existing key keeps its id and its whole stored row untouched; a new key gets `max(id) + 1`, assigned in a deterministic order (sort new rows by team, then season, then name).
- `pid` is the player. On first build it is `1 +` the row's `players.json` name index. On a rebuild, a new row takes the `pid` of any existing card whose key shares its `name` **and** which the current `players.json` gives the same name index; otherwise `max(pid) + 1`. (Two different men can share a name; the name index is what tells them apart within one build.)
- A key that has left `players.json` stays in the catalog exactly as it was.

- [ ] **Step 1: Write the failing test** in `tests/test-card-catalog.mjs`

```js
// header: same imports/helpers as tests/test-century-logic.mjs (read, ok, eq, initGameData)
import { mergeCatalog } from "../tools/data/build-card-catalog.mjs";
const cat = read("data/cards.json");
const at = Object.fromEntries(cat.columns.map((c, i) => [c, i]));
const rows = Object.values(BOARDS).flat();

eq(cat.cards.length, rows.length, "one card per draft-pool row");            // 3124 today
eq(new Set(cat.cards.map((c) => c[at.id])).size, cat.cards.length, "ids are unique");
ok(cat.cards.every((c, i) => c[at.id] === i + 1), "ids run 1..n in file order");
eq(new Set(cat.cards.map((c) => c[at.pid])).size, 1639, "1,639 players");
for (const r of rows) {
  const c = cat.cards.find((x) => x[at.name] === r.name && x[at.season] === r.season && x[at.team] === r.team);
  ok(c && c[at.rating] === r.rating && c[at.py] === r.py && c[at.rcy] === r.rcy, `${r.name} ${r.season} ${r.team} is in the catalog with its stats`);
}
ok(!/https?:/.test(JSON.stringify(cat)), "no URL in the catalog");

// Review Focus 1: a rebuild never rewrites what exists.
const moved = rows.filter((r) => !(r.name === rows[0].name && r.season === rows[0].season)); // one row leaves
const changed = moved.map((r, i) => (i === 5 ? { ...r, rating: r.rating + 9 } : r));         // one row's stats move
const added = [...changed, { ...rows[10], season: 2026, rating: 77 }];                        // one new season
const again = mergeCatalog(cat, added);
eq(again.added, 1, "exactly the new season is added");
eq(again.cards.length, cat.cards.length + 1, "nothing is removed");
ok(cat.cards.every((c, i) => JSON.stringify(again.cards[i]) === JSON.stringify(c)), "every existing row is byte-identical");
eq(again.cards.at(-1)[at.id], cat.cards.length + 1, "the new card takes the next id");
eq(again.cards.at(-1)[at.pid], cat.cards.find((c) => c[at.name] === rows[10].name && c[at.season] === rows[10].season)[at.pid], "and its player's existing pid");
let threw = false; try { mergeCatalog(cat, [...rows, rows[3]]); } catch { threw = true; }
ok(threw, "a duplicate key refuses to build");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it** - `node tests/test-card-catalog.mjs`. Expected: fails, module not found.
- [ ] **Step 3: Implement** `mergeCatalog(existing, rows)` and the CLI in `tools/data/build-card-catalog.mjs`. The CLI reads `data/players.json`, calls `initGameData`, reads `data/cards.json` if it exists (else `{ cards: [] }`), merges, writes the file with `built` set to today, and prints `added N, total M`. Follow `tools/data/build-season-pool.mjs` for file layout and the positional-rows convention.
- [ ] **Step 4: Generate and run** - `node tools/data/build-card-catalog.mjs` (expected `added 3124, total 3124`), then `node tests/test-card-catalog.mjs` (expected: no FAIL lines, exit 0). Run the builder a second time: expected `added 0`, and `git diff --stat data/cards.json` shows only the `built` date at most - if so, make the builder leave `built` alone when nothing was added.
- [ ] **Step 5: Keep it off the site.** Read how `build.mjs` handles `data/`; if `cards.json` would be copied to `public/`, exclude it, and run `node tests/test-build-seo.mjs` and `node tests/test-site-pages.mjs`. Expected: both pass.
- [ ] **Step 6: Commit** - `git add tools/data/build-card-catalog.mjs data/cards.json tests/test-card-catalog.mjs` (plus `build.mjs` if touched), message `cards: the frozen catalog`.

---

### Task 2: Cards and archetypes

**Files:**
- Create: `card-logic.mjs`
- Test: `tests/test-card-logic.mjs`

**Interfaces:**
- Consumes: `data/cards.json` from Task 1.
- Produces:
  - `initCardData(catalog) -> { cards: number, players: number }`
  - `CARDS: Map<number, Card>` where `Card = { id, pid, name, pos, season, team, g, cmp, att, py, ptd, int, car, ry, rtd, rec, rcy, rctd, fl, rating, archetype }`
  - `ARCHETYPES: { id, label, pos: string[] }[]` in priority order, ids exactly:
    `gunslinger, scrambler, volume, manager, workhorse, goalline, homerun, receiving, deep, redzone, possession, seam, valve`
  - `ROLE_PLAYER = "role"`
  - `cardArchetypes(card) -> string[]` (every archetype the card qualifies for, in priority order)
  - `cardArchetype(card) -> string` (the first of those, or `"role"`)
  - `archetypeLabel(id) -> string`

Thresholds, from spec 3.1 (per-game values divide by `g`):

| id | pos | rule |
|---|---|---|
| gunslinger | QB | `att/g >= 25 && py/att >= 7.7` |
| scrambler | QB | `ry/g >= 22` |
| volume | QB | `att/g >= 36` |
| manager | QB | `att/g >= 20 && int/att <= 0.021 && py/att < 7.7` |
| workhorse | RB | `car/g >= 17 && rec/g < 3` |
| goalline | RB | `rtd >= 10` |
| homerun | RB | `car >= 100 && ry/car >= 4.8` |
| receiving | RB | `rec/g >= 3.2` |
| deep | WR | `rec >= 30 && rcy/rec >= 15.5` |
| redzone | WR, TE | `rctd >= 9` (WR), `rctd >= 7` (TE) |
| possession | WR | `rec/g >= 5 && rcy/rec < 13` |
| seam | TE | `rec >= 25 && rcy/rec >= 12.5` |
| valve | TE | `rec/g >= 3.5 && rcy/rec < 11` |

Labels: Gunslinger, Scrambler, Volume passer, Game manager, Workhorse, Goal-line back, Home-run hitter, Receiving back, Deep threat, Red-zone target, Possession, Seam stretcher, Safety valve; `role` is "Role player".

- [ ] **Step 1: Write the failing test** in `tests/test-card-logic.mjs`

```js
const info = initCardData(read("data/cards.json"));
eq(info.cards, 3124, "every card loads"); eq(info.players, 1639, "1,639 players");
const all = [...CARDS.values()];
const count = (id) => all.filter((c) => cardArchetypes(c).includes(id)).length;
// The counts the design was agreed on (spec 3.1), measured 2026-11-12.
for (const [id, n] of [["gunslinger", 91], ["scrambler", 70], ["manager", 86], ["volume", 64], ["workhorse", 101],
  ["receiving", 148], ["goalline", 122], ["homerun", 123], ["deep", 194], ["possession", 121], ["redzone", 245], ["seam", 78], ["valve", 89]]) eq(count(id), n, `${id} count`);
const find = (name, season) => all.find((c) => c.name === name && c.season === season);
eq(cardArchetype(find("Tom Brady", 2007)), "gunslinger", "2007 Brady");
eq(cardArchetype(find("Adrian Peterson", 2012)), "workhorse", "2012 Peterson");
eq(cardArchetype(find("Devery Henderson", 2011)), "deep", "2011 Henderson");
ok(all.filter((c) => c.archetype === "role").length > 1500, "most cards are role players");
ok(all.every((c) => c.archetype === cardArchetype(c)), "the stored archetype is the computed one");
ok(all.every((c) => ARCHETYPES.find((a) => a.id === c.archetype)?.pos.includes(c.pos) ?? c.archetype === "role"), "an archetype only lands on its own position");
// Review Focus 3: a card with nothing in the denominators.
const empty = { ...all[0], g: 0, att: 0, car: 0, rec: 0, py: 0, ry: 0, rcy: 0, rtd: 0, rctd: 0, int: 0 };
for (const pos of ["QB", "RB", "WR", "TE"]) eq(cardArchetype({ ...empty, pos }), "role", `an empty ${pos} is a role player`);
```

- [ ] **Step 2: Run it** - `node tests/test-card-logic.mjs`. Expected: fails, module not found.
- [ ] **Step 3: Implement** the Produces list in `card-logic.mjs`. Guard every ratio so a zero denominator is "does not qualify". Open the file with a header comment in the style of `century-logic.mjs` saying what the module owns and that the browser, the Edge Function and the tests all import it.
- [ ] **Step 4: Run** - `node tests/test-card-logic.mjs`. Expected: exit 0. If a pinned count is off by a handful, the threshold comparison differs from the table above (`>=` against `>`); fix the code, not the number.
- [ ] **Step 5: Commit** - `card-logic.mjs`, `tests/test-card-logic.mjs`; message `cards: archetypes from a card's own season`.

---

### Task 3: Defenses and their traits

**Files:**
- Modify: `card-logic.mjs`
- Modify: `tests/test-card-logic.mjs`

**Interfaces:**
- Consumes: `data/versus-pool.json` (`columns.defenses` is `["season","team","rating","pa","ints","fum","sacks","tds"]`).
- Produces:
  - `initDefenses(versusPool) -> number` (count loaded)
  - `DEFENSES: Defense[]`, `Defense = { key: "2000|BAL", season, team, rating, pa, ints, fum, sacks, tds, traits: string[] }`
  - `defenseByKey(key) -> Defense | undefined`
  - `TRAITS: { id, label }[]`, ids exactly `stingy, ballhawks, passrush, strip, scoring`; labels Stingy, Ball hawks, Pass rush, Strip artists, Scoring defense.

Rule: a defense has a trait when it is in the **best five of its own season** for that trait's stat (`pa` lowest; `ints`, `sacks`, `fum`, `tds` highest). Ranking within a season, not across the pool, is what keeps a 2003 defense and a 2023 defense comparable. Ties are broken by team code ascending, so exactly five teams per season carry each trait. `traits` is in `TRAITS` order.

- [ ] **Step 1: Add the failing tests**

```js
eq(initDefenses(read("data/versus-pool.json")), 859, "859 defenses");
for (const t of TRAITS) for (let y = 1999; y <= 2025; y++) eq(DEFENSES.filter((d) => d.season === y && d.traits.includes(t.id)).length, 5, `${y} has five ${t.id}`);
ok(defenseByKey("2000|BAL").traits.includes("stingy"), "the 2000 Ravens are stingy");
ok(defenseByKey("2002|TB").traits.includes("ballhawks"), "the 2002 Bucs are ball hawks");
ok(defenseByKey("2022|PHI").traits.includes("passrush"), "the 2022 Eagles rush the passer");
// Review Focus 4: the answer does not depend on the order the file lists teams in.
const pool = read("data/versus-pool.json"); const before = DEFENSES.map((d) => d.key + ":" + d.traits.join(","));
initDefenses({ ...pool, defenses: [...pool.defenses].reverse() });
eq(JSON.stringify(DEFENSES.map((d) => d.key + ":" + d.traits.join(",")).sort()), JSON.stringify([...before].sort()), "traits survive a reordered file");
```

- [ ] **Step 2: Run** - expected: fails on `initDefenses` not exported.
- [ ] **Step 3: Implement.** Sort a copy with a full comparator (stat, then team code); never rely on input order.
- [ ] **Step 4: Run** - expected: exit 0.
- [ ] **Step 5: Commit** - message `cards: defense traits, five a season`.

---

### Task 4: Lineup legality

**Files:**
- Modify: `card-logic.mjs`
- Modify: `tests/test-card-logic.mjs`

**Interfaces:**
- Consumes: `SLOTS`, `fits` from `game-logic.mjs`; `CARDS`.
- Produces:
  - `FINISHES = ["base","silver","gold","prism"]`, `FINISH_BONUS = { base: 0, silver: 1, gold: 2, prism: 3 }`
  - `ownKey(id, finish) -> string` (`"412:gold"`)
  - `Lineup = { [slot]: { id: number, finish: string } }`
  - `lineupProblem(lineup, owned) -> null | string`, `owned` being a `Map<ownKey, count>` or `null` to skip the ownership check. Reasons, checked in this order, first one wins: `malformed` (not an object, or a key that is not a slot), `incomplete` (a slot missing), `unknown_card`, `bad_finish`, `bad_slot` (position does not fit), `same_player` (two entries share a `pid`), `not_owned` (count under 1).

- [ ] **Step 1: Add the failing tests.** Build one legal lineup `good` from real cards (highest-rated QB, RB, WR, TE, then the next two best RB/WR/TE by rating with distinct `pid`s), all `base`, and assert:

```js
eq(lineupProblem(good, null), null, "a legal lineup passes");
eq(lineupProblem(good, new Map(Object.values(good).map((e) => [ownKey(e.id, e.finish), 1]))), null, "and passes when owned");
eq(lineupProblem(good, new Map()), "not_owned", "an empty collection owns nothing");
eq(lineupProblem({ ...good, QB: undefined }, null), "incomplete", "a missing slot");
eq(lineupProblem({ ...good, FLEX1: good.QB }, null), "bad_slot", "a quarterback cannot play Flex");
eq(lineupProblem({ ...good, FLEX2: { ...good.RB } }, null), "same_player", "one man, one slot");
// Review Focus 2: things only a modified client would send.
eq(lineupProblem({ ...good, RB: { id: 999999, finish: "base" } }, null), "unknown_card", "an id that is not a card");
eq(lineupProblem({ ...good, RB: { ...good.RB, finish: "diamond" } }, null), "bad_finish", "a finish that does not exist");
eq(lineupProblem({ ...good, K: good.RB }, null), "malformed", "a slot that does not exist");
for (const junk of [null, undefined, "x", 7, []]) eq(lineupProblem(junk, null), "malformed", `junk input ${JSON.stringify(junk)}`);
```

Add one more: two different seasons of the same player in RB and FLEX1 answer `same_player` (find a `pid` with two RB cards).

- [ ] **Step 2: Run** - expected: fails, `lineupProblem` not exported.
- [ ] **Step 3: Implement.** It must not throw on any input.
- [ ] **Step 4: Run** - expected: exit 0.
- [ ] **Step 5: Commit** - message `cards: what a legal lineup is`.

---

### Task 5: Scoring a battle

**Files:**
- Modify: `card-logic.mjs`
- Modify: `tests/test-card-logic.mjs`

**Interfaces:**
- Consumes: everything above; `hashStr`, `mulberry32` from `game-logic.mjs`.
- Produces:
  - Tunable constants, exported: `LUCK_SPREAD = 12`, `TARGET_BASE = 150`, `TARGET_SLOPE = 4.2`, `COUNTERS`, `PAIRS`.
  - `battleTarget(defense) -> number` = `Math.round(TARGET_BASE + TARGET_SLOPE * defense.rating)`
  - `scoreBattle(lineup, defense, rand) -> { cards: Play[], offense: number, target: number, win: boolean }`
    with `Play = { slot, id, finish, base, roll, mods: { key, label, pts }[], total, line: string }`, `cards` in `SLOTS` order, `offense` the sum of `total`, `win` is `offense >= target`. Call only with a lineup `lineupProblem` passed.
  - `showdownSeed(date) -> "showdown-<date>"`, `showdownDefense(date) -> Defense`, `showdownRand(date, lineup) -> () => number`, `showdownScore(date, lineup) -> { ...scoreBattle result, score: number }` where `score = offense`.

Scoring, per card in `SLOTS` order:
- `base = rating + FINISH_BONUS[finish]`.
- `roll = (rand() + rand() - 1) * LUCK_SPREAD` - **exactly two draws per card, twelve per battle, always**, whatever the card is. A triangular spread: most games land near the rating, a few far from it, never beyond `±LUCK_SPREAD`.
- `mods`: one entry per rule that fires. A counter fires when the defense has the trait and the card has the archetype. A pair fires for a card when the lineup also holds a card of the partner archetype (it fires once per card, however many partners there are).
- `total = base + roll + sum(mods.pts)`, kept to one decimal.
- `line`: the card's main per-game yardage scaled by `total / base`, and touchdowns the same way, rounded - `"142 yards, 2 TD"`. Main yardage is `py` for QB, `ry` for RB, `rcy` for WR and TE. No random draw.

Starting tables (Task 6 tunes the numbers; the keys are the design):

```js
export const COUNTERS = {            // trait -> archetype -> points
  stingy:    { goalline: -8, redzone: -8 },
  ballhawks: { gunslinger: -10, volume: -8, manager: 6 },
  passrush:  { volume: -8, gunslinger: -6, scrambler: 8, valve: 5, receiving: 5 },
  strip:     { workhorse: -8, homerun: -6, possession: 4 },
  scoring:   { volume: -6, manager: 6, workhorse: 4 },
};
export const PAIRS = [               // [archetype, archetype, points to each]
  ["gunslinger", "deep", 7], ["gunslinger", "seam", 5], ["manager", "possession", 5], ["manager", "valve", 4],
  ["scrambler", "homerun", 5], ["volume", "receiving", 5], ["volume", "possession", 4],
];
```

The showdown: `showdownDefense(date)` is `DEFENSES` sorted by `key`, indexed by `Math.floor(mulberry32(hashStr(showdownSeed(date)))() * DEFENSES.length)`. `showdownRand(date, lineup)` is `mulberry32(hashStr(showdownSeed(date) + "|" + SLOTS.map((s) => lineup[s].id + ":" + lineup[s].finish).join(",")))`, so one lineup scores the same for everyone that day and a different lineup rolls differently.

- [ ] **Step 1: Add the failing tests**

```js
const mid = () => 0.5;                                   // a roll of exactly zero
const rav = defenseByKey("2000|BAL");
const r0 = scoreBattle(good, rav, mid);
eq(r0.cards.length, 6, "six plays"); eq(r0.cards.map((c) => c.slot).join(), SLOTS.join(), "in slot order");
ok(r0.cards.every((c) => c.roll === 0), "a 0.5 roll is no luck");
eq(r0.target, battleTarget(rav), "the target is the defense's"); eq(r0.win, r0.offense >= r0.target, "win is offense against target");
const gold = scoreBattle({ ...good, QB: { ...good.QB, finish: "gold" } }, rav, mid);
eq(+(gold.offense - r0.offense).toFixed(1), 2, "gold is worth exactly two");
// a pair fires both ways, and only with the partner present
const gun = all.find((c) => c.archetype === "gunslinger"), deep = all.find((c) => c.archetype === "deep" && c.pid !== gun.pid);
const paired = scoreBattle({ ...good, QB: { id: gun.id, finish: "base" }, WR: { id: deep.id, finish: "base" } }, rav, mid);
ok(paired.cards[0].mods.some((m) => m.pts === 7) && paired.cards[2].mods.some((m) => m.pts === 7), "gunslinger and deep threat lift each other");
// a counter fires only against the trait
const hawks = DEFENSES.find((d) => d.traits.includes("ballhawks")), calm = DEFENSES.find((d) => d.traits.length === 0);
ok(scoreBattle({ ...good, QB: { id: gun.id, finish: "base" } }, hawks, mid).cards[0].mods.some((m) => m.pts === -10), "ball hawks punish a gunslinger");
ok(!scoreBattle({ ...good, QB: { id: gun.id, finish: "base" } }, calm, mid).cards[0].mods.some((m) => m.pts < 0), "a defense with no trait counters nothing");
ok(/^\d+ yards, \d+ TD$/.test(r0.cards[0].line), "a play reads as football");
// twelve draws, always
let n = 0; scoreBattle(good, rav, () => (n++, 0.5)); eq(n, 12, "exactly twelve draws");
// Review Focus 5: the edges of the generator
for (const edge of [0, 0.999999999]) { const r = scoreBattle(good, rav, () => edge);
  ok(r.cards.every((c) => Number.isFinite(c.total) && Math.abs(c.roll) <= LUCK_SPREAD), `finite and inside the spread at rand=${edge}`); }
// the showdown: same lineup same score, and the day decides the defense
eq(showdownScore("2026-11-13", good).score, showdownScore("2026-11-13", good).score, "one lineup, one score");
ok(showdownDefense("2026-11-13").key === showdownDefense("2026-11-13").key, "one defense a day");
ok(new Set(Array.from({ length: 60 }, (_, i) => showdownDefense(`2026-12-${String(i % 28 + 1).padStart(2, "0")}-${i}`).key)).size > 30, "days differ");
// engine independence: a checksum over 2,000 seeded battles, pinned once it is first printed
let sum = 0; for (let i = 0; i < 2000; i++) sum = (sum + Math.round(scoreBattle(good, DEFENSES[i % DEFENSES.length], mulberry32(i)).offense * 10)) >>> 0;
console.log("battle checksum", sum); eq(sum, PINNED_CHECKSUM, "2,000 battles roll the same everywhere");
```

- [ ] **Step 2: Run** - expected: fails, `scoreBattle` not exported.
- [ ] **Step 3: Implement.** Set `PINNED_CHECKSUM` in the test to the printed value only after every other assertion passes.
- [ ] **Step 4: Run** - `node tests/test-card-logic.mjs`, expected exit 0; then `node tests/test-sim-engine-independence.mjs`, expected unchanged and passing.
- [ ] **Step 5: Commit** - message `cards: scoring a battle`.

---

### Task 6: The balance bot, and tuning to it

**Files:**
- Create: `tests/test-card-balance.mjs`
- Modify: `card-logic.mjs` (constants only), `tests/test-card-logic.mjs` (re-pin the checksum and any constant an assertion names)

**Interfaces:**
- Consumes: the whole of `card-logic.mjs`.
- Produces: printed numbers the next four plans are written from, and the constants they are measured at.

The test builds three collections with a seeded generator and plays each against 2,000 random defenses with fresh seeded luck:
- **starter**: 8 Base cards drawn from cards rated under 60, re-drawn until a legal lineup exists (the spec's starter deck).
- **middling**: 60 Base cards drawn uniformly from the catalog.
- **stacked**: the 60 highest-rated cards.

Two bots choose a lineup from a collection for a given defense, seeing the defense first as a player does:
- `byRating`: the highest-rated legal lineup, ignoring archetypes.
- `byFit`: the legal lineup with the highest expected `offense` at zero luck (`rand = () => 0.5`). An exact search over six slots is affordable: at most the top eight candidates per slot by zero-luck value.

It prints, and asserts, per collection:

| Number | Band it must sit in |
|---|---|
| starter win rate, `byFit` | 0.20 to 0.45 |
| middling win rate, `byFit` | 0.50 to 0.80 |
| stacked win rate, `byFit` | 0.85 to 0.98 |
| share of (middling, defense) pairs where `byFit` chose a different lineup from `byRating` | at least 0.40 |
| middling win rate, `byFit` minus `byRating` | at least 0.05 |
| share of battles decided by luck (zero-luck result differs from the rolled one), middling | 0.05 to 0.25 |
| share of `byFit` middling lineups holding at least one card rated under 70 | at least 0.15 |

These are the design's anti-goal turned into numbers: the best six ratings must not be the answer, a new player must win sometimes, the best collection must still be able to lose, and luck must be "a bit".

- [ ] **Step 1: Write the test** with the three collections, the two bots and the table above as assertions, printing every number whether it passes or not.
- [ ] **Step 2: Run** - `node tests/test-card-balance.mjs`. Expected: it runs and prints; some bands fail at the starting constants.
- [ ] **Step 3: Tune** `LUCK_SPREAD`, `TARGET_BASE`, `TARGET_SLOPE` and the point values inside `COUNTERS` and `PAIRS` until every band holds. Change values only: no new keys, no new rules, no per-collection special cases. If the bands cannot all hold after honest tuning, stop and report which two conflict and the closest numbers reached - that is a design question for the owner, not something to resolve by loosening a band.
- [ ] **Step 4: Re-pin** the checksum and any moved constants in `tests/test-card-logic.mjs`; run both card tests and `node tests/run-all.mjs card`. Expected: all pass.
- [ ] **Step 5: Commit** - message `cards: balance, measured`.

---

### Task 7: Run stopper - find out, and write it all down

**Files:**
- Create: `CARDS.md`
- Modify: `CLAUDE.md` (Build/Run Commands: three test lines; one paragraph pointing at `CARDS.md`)

**Interfaces:**
- Consumes: the finished module and the balance test's output.
- Produces: `CARDS.md`, the reference the remaining four plans and every later session read first.

- [ ] **Step 1: Check the data.** `tools/data/build-versus-pool.mjs` names its three nflverse sources at the top. Download one season's header row of each (2024) and list the columns. Answer one question: can a team's rushing yards allowed and passing yards allowed for a season be computed from them (directly, or by summing each opponent's offence from the weekly file)? Do not change the builder.
- [ ] **Step 2: Write `CARDS.md`** with these sections, each short: what a card is and why the catalog is frozen (with the rebuild rule); the archetype table with current counts; defense traits and the five-a-season rule; lineup rules and reason codes; how a battle scores, with the constants as tuned; the balance table exactly as the test printed it, with the date; the daily showdown's seed and its accepted gap (the bundle is public, so the best lineup is computable offline); the Run stopper finding from Step 1 with the columns named; what is not built yet (everything outside this plan, per the spec's phases).
- [ ] **Step 3: Update `CLAUDE.md`** - add `node tests/test-card-catalog.mjs`, `node tests/test-card-logic.mjs`, `node tests/test-card-balance.mjs` to the test list with one-line descriptions in the existing style, and a short "Cards (in progress)" paragraph that names `CARDS.md` and the spec and says no screen or table exists yet.
- [ ] **Step 4: Run** `node tests/run-all.mjs`. Expected: every test file passes.
- [ ] **Step 5: Commit** - message `cards: CARDS.md, and what the defense data can support`.
