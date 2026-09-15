// The word filter (PROFILES.md 3.4). text_is_clean() in supabase/migration-profiles.sql is the one that
// counts; the test mock's isClean (tests/mock-profile-data.mjs) mirrors it for every jsdom test. This runs
// the same cases through both - the SQL in real Postgres (PGlite), called as the table owner because
// clients can't execute it - and requires:
//   - the two agree on every case, every character their tables fold, and a few thousand random strings;
//   - what must pass passes: every player name in data/players.json (whole names and each part), every
//     team name and city, and ordinary words with unlucky substrings;
//   - what must be blocked is blocked: each seeded word plain, capitalized, with look-alike digits and
//     symbols, with invisible characters inside, and ('anywhere' words) spaced or dotted out; usernames
//     split on _ and digits.
// Every non-ASCII character is written by code point, so nothing in this file is invisible.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { freshDb } from "./pg-fixture.mjs";
import { TEAMS } from "../game-logic.mjs";
import {
  makeProfileData, textIsClean, BLOCKED_WORDS_SEED, FILTER_INVISIBLE, FILTER_EXPANSIONS, FILTER_FOLD_FROM, FILTER_FOLD_TO,
  FILTER_LOOKALIKE_FROM, FILTER_LOOKALIKE_TO,
} from "./mock-profile-data.mjs";
import { playerStats } from "./mock-profile-stats.mjs";

const ch = (...codes) => String.fromCodePoint(...codes);
const db = await freshDb();

// The mock as the app's tests get it (its own seeded list), and its filter over any other list.
const state = { profiles: new Map(), runs: new Map(), dailyRuns: new Map(), souRuns: new Map(), builds: new Map(), currentUserId: () => null, isModerator: () => false };
const mock = makeProfileData(state, { playerStats });

// Runs texts through both in one query; returns [{ text, sql, mock }].
async function both(texts, isClean = mock.isClean) {
  const { rows } = await db.query(
    "select u.n, text_is_clean(u.t) as clean from unnest($1::text[]) with ordinality as u(t, n) order by u.n", [texts]);
  assert(rows.length === texts.length, `expected ${texts.length} results from SQL, got ${rows.length}`);
  return texts.map((text, i) => ({ text, sql: rows[i].clean, mock: isClean(text) }));
}
const show = (t) => JSON.stringify(t)?.replace(/[^\x20-\x7e]/g, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase()}>`);
function expectAll(results, want, label) {
  const disagree = results.filter((r) => r.sql !== r.mock);
  assert(!disagree.length, `${label}: SQL and mock disagree on ${disagree.length} case(s), e.g. ${disagree.slice(0, 5).map((r) => `${show(r.text)} sql=${r.sql} mock=${r.mock}`).join("; ")}`);
  const wrong = results.filter((r) => r.sql !== want);
  assert(!wrong.length, `${label}: ${wrong.length} case(s) should be ${want ? "clean" : "blocked"}, e.g. ${wrong.slice(0, 8).map((r) => show(r.text)).join(", ")}`);
}

await runTest("the SQL seeds exactly the mock's word list, and clients can't read or call it", async () => {
  const { rows } = await db.query("select word, match from blocked_words order by word");
  const mockList = [...BLOCKED_WORDS_SEED].sort((a, b) => (a.word < b.word ? -1 : 1));
  assert(JSON.stringify(rows) === JSON.stringify(mockList), `seed lists differ: sql ${rows.length} words, mock ${mockList.length}`);
  assert(rows.every((r) => /^[a-z]+$/.test(r.word) && ["word", "anywhere"].includes(r.match)), "every word is lowercase letters with a valid match mode");
  assert(rows.some((r) => r.match === "anywhere") && rows.some((r) => r.match === "word"), "the list uses both match modes");
  const { rows: grants } = await db.query(`select r.rolname, has_function_privilege(r.rolname, 'public.text_is_clean(text)', 'execute') as can
                                             from pg_roles r where r.rolname in ('anon', 'authenticated')`);
  assert(grants.length === 2 && grants.every((g) => !g.can), "anon and authenticated must not be able to execute text_is_clean");
});

await runTest("ordinary words with unlucky substrings pass", async () => {
  const words = ["Scunthorpe", "assassin", "class", "Cassel", "Hancock", "Cockrell", "Titus", "Dickson", "Sussex", "therapist",
    "grapes", "shiitake", "cocktail", "analysis", "retardant", "Matsushita", "Shittu"];
  const texts = words.flatMap((w) => [w, w.toLowerCase(), w.toUpperCase(), `${w}s`]);
  texts.push(
    "Matt Cassel to Titus Dickson for six, live from Scunthorpe",
    "Therapist by day, shiitake and grapes by night. Cocktail analysis on Sundays.",
    "Push it, finish it, wash it", "Who really knows", "the glass holder", "fire retardant gloves",
    "Top 5 all-time QB!", "49ers fan since '94", "100% ride or die", "QB1 $$$", "Go Pats!!!", "I <3 football",
    "Blitz, sack, pick six, hail mary", "Running back, tight end, wide receiver", "A-gap hole",
    "shrimpcity", "QB_Guru99", "Brady4ever", "ChiefsKingdom", "tuck_rule_2001", "sh2t", "fuuck",
    "", "   ", ch(0x1F3C8, 0x1F525), `Brady ${ch(0x1F410)} forever`, ch(0x2764, 0xFE0F), `Caf${ch(0xE9)} con leche`, null,
  );
  expectAll(await both(texts), true, "ordinary text");
});

await runTest("every player name, name part, team name and city passes", async () => {
  const names = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8")).players.n;
  const texts = new Set();
  for (const name of names) {
    texts.add(name);
    for (const part of name.split(/\s+/)) texts.add(part);
  }
  for (const [code, [name, city]] of Object.entries(TEAMS)) {
    texts.add(code).add(name);
    if (city) texts.add(city).add(`${city} ${name}`);
  }
  assert(names.length > 1000 && texts.size > 2000, `expected the full player list, got ${names.length} names`);
  expectAll(await both([...texts]), true, "names and teams");
});

// Look-alike spellings of a word: digits, symbols, one accented vowel, a Cyrillic letter, full width.
const DIGITS = { o: "0", i: "1", e: "3", a: "4", s: "5", t: "7" };
const SYMBOLS = { a: "@", s: "$", i: "!", l: "|" };
const ACCENTED = { a: 0xE1, e: 0xE9, i: 0xED, o: 0xF3, u: 0xFA };
const CYRILLIC = { a: 0x430, c: 0x441, e: 0x435, o: 0x43E, p: 0x440, x: 0x445, y: 0x443 };
const swapAll = (w, table) => [...w].map((c) => table[c] ?? c).join("");
const swapFirst = (w, map) => {
  const i = [...w].findIndex((c) => map[c] != null);
  return i < 0 ? null : w.slice(0, i) + map[w[i]] + w.slice(i + 1);
};
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const INVISIBLE_INSIDE = [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF];

function blockedVariants({ word: w, match }) {
  const out = [w, cap(w), w.toUpperCase(), `${w}s`, `${w}es`, `This is ${w}, honestly.`, `${cap(w)}!`, `${w}?!`];
  for (const table of [DIGITS, SYMBOLS]) {
    const all = swapAll(w, table), first = swapFirst(w, table);
    if (all !== w) out.push(all, cap(all));
    if (first) out.push(first);
  }
  const accented = swapFirst(w, Object.fromEntries(Object.entries(ACCENTED).map(([k, v]) => [k, ch(v)])));
  if (accented) out.push(accented, accented.toUpperCase() === accented ? accented : cap(accented));
  const cyrillic = swapFirst(w, Object.fromEntries(Object.entries(CYRILLIC).map(([k, v]) => [k, ch(v)])));
  if (cyrillic) out.push(cyrillic);
  out.push([...w].map((c) => ch(0xFF41 + c.charCodeAt(0) - 97)).join("")); // full-width
  for (const inv of INVISIBLE_INSIDE) out.push(w[0] + ch(inv) + w.slice(1), w.slice(0, -1) + ch(inv) + w.slice(-1));
  // Stretched: a letter not already doubled, repeated (a doubled one collapses to one letter, by design).
  const i = [...w].findIndex((c, k) => w[k - 1] !== c && w[k + 1] !== c);
  if (i >= 0) out.push(w.slice(0, i) + w[i].repeat(4) + w.slice(i + 1));
  if (match === "anywhere") {
    out.push([...w].join(" "), [...w].join("."), [...w].join(". "), [...w].join("-"), `xx${w}xx`, `${w}face`, `mother${w}er`,
      [...swapAll(w, DIGITS)].join(" "), `${cap(w)} ${cap(w)}`.replace(/ /g, ""));
  }
  // Usernames: split on underscores and digits, including look-alike digits right next to the word.
  out.push(`${w}_99`, `the_${w}`, `${cap(w)}_Official`, `${w}1`, `1${w}`, `${w}2024`, `7${w}7`, `${w}_4_life`, `${w.toUpperCase()}69`);
  return out;
}

await runTest("every seeded word is blocked plain, capitalized, disguised, spaced out and inside usernames", async () => {
  for (const entry of BLOCKED_WORDS_SEED) expectAll(await both(blockedVariants(entry)), false, `"${entry.word}" (${entry.match})`);
});

await runTest("whole-word entries don't match inside other words; anywhere entries do", async () => {
  const word = BLOCKED_WORDS_SEED.filter((b) => b.match === "word");
  const anywhere = BLOCKED_WORDS_SEED.filter((b) => b.match === "anywhere");
  assert(word.length && anywhere.length, "the seed list has both kinds");
  expectAll(await both(word.flatMap((b) => [`un${b.word}ly`, `x${b.word}`, `${b.word}ing`.replace(/eing$/, "ing") + "x"])), true, "word entries inside other words");
  expectAll(await both(anywhere.flatMap((b) => [`un${b.word}ly`, `x${b.word}`, `${b.word}ingx`])), false, "anywhere entries inside other words");
});

// The character tables: probe words that only match when a character maps to exactly the right letter,
// added to the SQL table and to a copy of the mock's list.
await runTest("the SQL and the mock fold, drop and map exactly the same characters", async () => {
  const from = [...FILTER_FOLD_FROM], to = [...FILTER_FOLD_TO];
  assert(from.length === to.length && new Set(from).size === from.length, "the fold table pairs each character once");
  const probes = [{ word: "abcdefghijklmnopqrstuvwxyz", match: "anywhere" }, { word: "invisibleprobe", match: "word" },
    { word: "passaeoe", match: "word" }, { word: "oieastasil", match: "anywhere" }];
  await db.query(`insert into blocked_words (word, match) select * from jsonb_to_recordset($1::jsonb) as x(word text, match text)`, [JSON.stringify(probes)]);
  const entries = [...BLOCKED_WORDS_SEED, ...probes];
  const probeClean = (t) => textIsClean(t, entries);
  try {
    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    // Each folded character standing in for its letter completes the alphabet; in for any other letter, it doesn't.
    const folded = from.map((c, i) => alphabet.replace(to[i], c));
    expectAll(await both(folded, probeClean), false, "folded letters");
    const misplaced = from.map((c, i) => alphabet.replace(to[i] === "a" ? "b" : "a", c));
    expectAll(await both(misplaced, probeClean), true, "folded letters in the wrong place");
    // Dropped characters join the two halves of a whole word; any other non-letter splits it.
    const dropped = [...FILTER_INVISIBLE].map((c) => `invisible${c}probe`);
    expectAll(await both(dropped, probeClean), false, "invisible characters and combining accents");
    expectAll(await both(["invisible#probe", `invisible${ch(0x3164)}probe`, "invisible probe"], probeClean), true, "characters that aren't dropped");
    const expanded = FILTER_EXPANSIONS.map(([c, two]) => "passaeoe".replace(two, c));
    expectAll(await both(expanded, probeClean), false, "letters written as two");
    const lookalikes = [...FILTER_LOOKALIKE_FROM].map((c, i) => FILTER_LOOKALIKE_TO.slice(0, i) + c + FILTER_LOOKALIKE_TO.slice(i + 1));
    expectAll(await both([...lookalikes, FILTER_LOOKALIKE_FROM], probeClean), false, "look-alike characters");
    expectAll(await both(["2", "6", "8", "9", "#", "%", "&", "*"].map((c) => `oieas${c}asil`), probeClean), true, "characters that aren't look-alikes");
  } finally {
    await db.query("delete from blocked_words where word = any($1::text[])", [probes.map((p) => p.word)]);
  }
});

// mulberry32, so a failure reproduces.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

await runTest("the SQL and the mock agree on 3,000 random strings built from words, look-alikes and odd characters", async () => {
  const rand = rng(20260914);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const pieces = [
    ...BLOCKED_WORDS_SEED.map((b) => b.word), ...BLOCKED_WORDS_SEED.map((b) => b.word.slice(0, 3)), ...BLOCKED_WORDS_SEED.map((b) => b.word.slice(2)),
    "class", "Cassel", "the", "Chiefs", "go", "s", "es", "i", "t", " ", "  ", ".", "_", "-", "!", "?", "'",
    ...FILTER_LOOKALIKE_FROM, "2", "6", "8", "9", ...[...FILTER_INVISIBLE].slice(0, 20), ch(0x200D), ch(0x3164),
    ...[...FILTER_FOLD_FROM].filter((_, i) => i % 7 === 0), ch(0xDF), ch(0xE6), ch(0x153), ch(0x1F3C8), ch(0x416), ch(0x3B6),
  ];
  const texts = Array.from({ length: 3000 }, () => Array.from({ length: 1 + Math.floor(rand() * 8) }, () => pick(pieces)).join(""));
  const results = await both(texts);
  const disagree = results.filter((r) => r.sql !== r.mock);
  assert(!disagree.length, `SQL and mock disagree on ${disagree.length} random string(s), e.g. ${disagree.slice(0, 5).map((r) => `${show(r.text)} sql=${r.sql} mock=${r.mock}`).join("; ")}`);
  const blocked = results.filter((r) => !r.sql).length;
  assert(blocked > 300 && blocked < 2700, `the random strings should mix clean and blocked, got ${blocked} blocked of 3000`);
});

await db.close();
console.log("test-word-filter.mjs done");
