// The card rules, with no browser and no database: card-logic.mjs is pure, so everything the cards promise can
// be checked by calling it. Archetypes, defense traits, what a legal lineup is, and how a battle scores.
// tests/test-card-balance.mjs is the other half - it PLAYS thousands of battles and holds the numbers.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOTS, mulberry32 } from "../game-logic.mjs";
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
const info = C.initCardData(read("data/cards.json"));
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

console.log(fails ? `\n${fails} FAILED` : "card logic: all checks passed");
process.exit(fails ? 1 : 0);
