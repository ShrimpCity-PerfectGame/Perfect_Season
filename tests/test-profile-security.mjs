// Security checks for Gridspin v1.11.0 Profiles (PROFILES.md 2-4): the attacks a modified browser can make
// with the anon key or a signed-in token, each asserted to fail. The SQL runs in real Postgres (PGlite, set
// up like a Supabase project by tests/pg-fixture.mjs) as the anon and authenticated roles with auth.uid()
// set, the way PostgREST and the Storage API run a client's requests. The browser half renders what players
// write in jsdom and checks the addresses and deletions the storage modules make.
//   1. Writing another player's profile         6. Security definer hygiene
//   2. Limits and the word filter               7. player_profile and player_stats
//   3. Reading what clients must not            8. The minigame boards
//   4. Moderation abuse                         9. The browser
//   5. Storage policies
// Word-filter gaps that can only close by changing PROFILES.md 3.4 (and the mock with it) are printed at the
// end as known gaps, not asserted. Characters are written by code point, and blocked words are taken from the
// seeded list rather than spelled out.
import { readFileSync } from "node:fs";
import { StorageClient } from "@supabase/storage-js";
import { assert, runTest, setupDom, makeMockAuth, loadModule, renderComponent, flush } from "./helpers.mjs";
import { freshDb, addAccount, asUser, asAnon, failure, uuid, sql, PROFILE_MIGRATIONS } from "./pg-fixture.mjs";
import { BLOCKED_WORDS_SEED } from "./mock-profile-data.mjs";
import { veteranProfile } from "./fixtures/profile-fixture.mjs";
import { AVATAR_TYPES, AVATAR_MAX_BYTES, emptyPlayerStats } from "../profile-rules.mjs";

const ch = (...codes) => String.fromCodePoint(...codes);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (t) => JSON.stringify(t)?.slice(0, 90).replace(/[^\x20-\x7e]/g, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase()}>`);

// ---------- Words and disguises ----------
const seed = (match, test = () => true) => BLOCKED_WORDS_SEED.filter((b) => b.match === match && test(b.word)).map((b) => b.word);
const doubled = (w) => /(.)\1/.test(w);
const WORD = seed("word", (w) => !doubled(w) && w.length >= 4)[0]; // a whole-word entry with no doubled letter
const ANYWHERE = seed("anywhere", (w) => !doubled(w))[0]; // an anywhere entry with no doubled letter
const ANYWHERE_DOUBLED = seed("anywhere", doubled)[0];
const DOUBLED_WORDS = BLOCKED_WORDS_SEED.map((b) => b.word).filter(doubled);
const DIGITS = { o: "0", i: "1", e: "3", a: "4", s: "5", t: "7" };
const SYMBOLS = { a: "@", s: "$", i: "!", l: "|" };
const CYRILLIC = { a: 0x430, c: 0x441, e: 0x435, o: 0x43E, p: 0x440, x: 0x445, y: 0x443, i: 0x456, s: 0x455, h: 0x4BB, j: 0x458 };
const GREEK = { a: 0x3B1, i: 0x3B9, k: 0x3BA, o: 0x3BF, p: 0x3C1, t: 0x3C4, u: 0x3C5, v: 0x3BD, x: 0x3C7 };
const swapAll = (w, table) => [...w].map((c) => table[c] ?? c).join("");
const swapFirst = (w, table) => {
  const i = [...w].findIndex((c) => table[c] != null);
  if (i < 0) return null;
  const v = table[w[i]];
  return w.slice(0, i) + (typeof v === "number" ? ch(v) : v) + w.slice(i + 1);
};
const fullWidth = (w) => [...w].map((c) => ch(0xFF41 + c.charCodeAt(0) - 97)).join("");
const mathBold = (w) => [...w].map((c) => ch(0x1D41A + c.charCodeAt(0) - 97)).join("");
const circled = (w) => [...w].map((c) => ch(0x24D0 + c.charCodeAt(0) - 97)).join("");
const altCase = (w) => [...w].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join("");
const inside = (w, c) => w.slice(0, 2) + c + w.slice(2);
// The first doubled letter written three (or n) times: text_is_clean reads that run as one letter.
const stretchDoubled = (w, n = 3) => w.replace(/(.)\1/, (_, c) => c.repeat(n));
const stretchSingle = (w) => {
  const i = [...w].findIndex((c, k) => w[k - 1] !== c && w[k + 1] !== c);
  return w.slice(0, i) + w[i].repeat(4) + w.slice(i + 1);
};

// Disguises every blocked word must stay blocked under, in a bio.
function bioDisguises(w, match) {
  const out = [w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1), altCase(w), `${w}!`, `(${w})`, `"${w}"?!`, `${w}...`,
    `${w}s`, `${w}es`, `you are a ${w}, honestly`, stretchSingle(w), fullWidth(w)];
  for (const table of [DIGITS, SYMBOLS]) {
    const all = swapAll(w, table);
    if (all !== w) out.push(all);
  }
  for (const table of [CYRILLIC, GREEK]) {
    const one = swapFirst(w, table);
    if (one) out.push(one);
  }
  // Invisible characters a bio may contain (joiners are allowed for emoji), and a combining accent.
  for (const c of [ch(0x200D), ch(0x200C), ch(0xAD), ch(0x34F), ch(0xFE0F), ch(0x301)]) out.push(inside(w, c));
  if (match === "anywhere") {
    out.push([...w].join(" "), [...w].join("."), [...w].join("-"), [...w].join("_"), [...w].join(" / "), [...w].join("*"),
      `xx${w}xx`, `${w}face`, [...swapAll(w, DIGITS)].join(" "), [...w].join(ch(0x200D)));
  }
  return out;
}
// Usernames that fit the username rule but hide a blocked word (inside another word only for 'anywhere' entries).
const usernameDisguises = (w, match) => [w, w.toUpperCase(), altCase(w), `${w}_99`, `the_${w}`, `${w.toUpperCase()}69`, swapAll(w, DIGITS), `7${w}7`,
  ...(match === "anywhere" ? [`x${w}x`, `${w}face`, `Big${w.toUpperCase()}er`] : [])].filter((u) => /^[A-Za-z0-9_]{3,16}$/.test(u));
// Usernames outside the rule, many of which would otherwise show a blocked word or pass for another player.
const INVALID_USERNAMES = [
  "", "ab", "a".repeat(17), "has space", "dash-name", "dot.name", "at@name", "o'brien", "alice\n", " alice", "alice ",
  inside("alice", ch(0x200B)), inside("alice", ch(0x200D)), inside("alice", ch(0x202E)), inside("alice", ch(0x2066)),
  fullWidth("alice"), swapFirst("alice", CYRILLIC), mathBold(ANYWHERE), circled(ANYWHERE), mathBold(ANYWHERE_DOUBLED),
  `<img src=x onerror=alert(1)>`, "x".repeat(100000),
];

// ---------- The database ----------
// v1.11.0's migrations only: this file's every-function and every-table checks are about profiles and moderation.
// tests/test-economy-security.mjs does the same for v1.12.0's wallet and shop.
const db = await freshDb({ migrations: PROFILE_MIGRATIONS });
await db.exec("insert into storage.buckets (id, name) values ('other', 'other') on conflict (id) do nothing");
// Ids with letters in them, so a folder name in the wrong case is a different folder.
const ALICE = "a11ce000-0000-4000-8000-00000000a11c"; // the victim
const MALLORY = "badc0ffe-0000-4000-8000-00000000beef"; // the attacker
const MOD = uuid(3), BOB = uuid(4), CAROL = uuid(5);
const BASE = [[ALICE, "alice"], [MALLORY, "mallory"], [MOD, "modbot"], [BOB, "bob"], [CAROL, "carol"]];
// Every test starts from the same accounts, modbot the moderator. Deleting the auth users cascades to
// everything the accounts own.
async function reset() {
  await db.exec("delete from storage.objects; delete from auth.users; update site_flags set enabled = false where key = 'uploads_paused';");
  for (const [id, username] of BASE) await addAccount(db, { id, username });
  await db.query("insert into moderators (user_id) values ($1)", [MOD]);
}
// One statement as a player (their id) or signed out (null): { rows, affected } or { error }.
async function attempt(who, statement, params = []) {
  const run = async () => {
    try {
      const r = await db.query(statement, params);
      return { rows: r.rows, affected: r.affectedRows ?? 0 };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  };
  return who ? asUser(db, who, run) : asAnon(db, run);
}
// One database function call with named arguments: { data } or { error: "<message>" }.
async function call(who, fn, args = {}) {
  const names = Object.keys(args);
  const res = await attempt(who, `select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
  return res.error ? { error: res.error } : { data: res.rows[0].r };
}
const owner = async (statement, params) => (await db.query(statement, params)).rows;
// Inside an asUser/asAnon block (the role is already switched): a statement that reports instead of throwing.
const tryQuery = async (statement, params) => {
  try {
    return { rows: (await db.query(statement, params)).rows };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
};
const photo = (uid, n = 0, ext = "webp") => `${uid}/${1757800000000 + n}.${ext}`;
const refusedByRls = (r) => /row-level security/.test(r.error || "");
const detailsOf = async (uid) => (await owner("select to_jsonb(d) as d from profile_details d where user_id = $1", [uid]))[0]?.d ?? null;

// ---------- 1. Writing another player's profile ----------

await runTest("1a. nobody writes another player's profile_details directly: inserts, upserts, updates, forged ids and deletes change nothing", async () => {
  await reset();
  assert(!(await call(ALICE, "save_profile", { p_bio: "Alice's own words", p_favorite_team: "KC" })).error, "alice saves a bio");
  assert(!(await call(ALICE, "set_avatar", { p_path: null, p_preset: "crown" })).error, "alice picks an avatar");
  const before = await detailsOf(ALICE);
  const writes = [
    ["insert into profile_details (user_id, bio) values ($1, 'defaced')", [ALICE]],
    ["insert into profile_details (user_id, bio) values ($1, 'defaced') on conflict (user_id) do update set bio = excluded.bio", [ALICE]],
    ["insert into profile_details (user_id, avatar_path) values ($1, $2) on conflict (user_id) do update set avatar_path = excluded.avatar_path, avatar_preset = null", [ALICE, photo(ALICE)]],
    ["update profile_details set bio = 'defaced' where user_id = $1", [ALICE]],
    ["update profile_details set bio = 'defaced'", []],
    ["update profile_details set avatar_preset = null, favorite_team = null where user_id = $1", [ALICE]],
    ["update profile_details set user_id = $2 where user_id = $1", [ALICE, MALLORY]],
    ["delete from profile_details where user_id = $1", [ALICE]],
    ["delete from profile_details", []],
    // Not even your own row: every limit and the word filter live in the functions.
    ["insert into profile_details (user_id, bio) values ($1, $2)", [MALLORY, `${WORD} ${WORD}`]],
    ["insert into profile_details (user_id, avatar_path) values ($1, $2)", [MALLORY, photo(ALICE)]],
  ];
  for (const who of [MALLORY, null]) {
    for (const [statement, params] of writes) {
      const r = await attempt(who, statement, params);
      assert(r.error ? /row-level security|permission denied/.test(r.error) : r.affected === 0, `${who ? "mallory" : "anon"}: "${statement}" should change nothing, got ${show(r)}`);
    }
  }
  assert(!(await call(MALLORY, "save_profile", { p_bio: "mine", p_favorite_team: "NE" })).error, "mallory saves her own bio");
  const mine = await attempt(MALLORY, "update profile_details set bio = $1 where user_id = $2", [`${WORD}!`, MALLORY]);
  assert(mine.affected === 0 && (await detailsOf(MALLORY)).bio === "mine", "and can't rewrite her own row past the filter either");
  assert(same(await detailsOf(ALICE), before), `alice's row is untouched: ${show(await detailsOf(ALICE))}`);
});

await runTest("1b. save_profile and set_avatar change only the caller's row: no argument names another player, and a token with no account gets not_signed_in", async () => {
  await reset();
  assert(!(await call(ALICE, "save_profile", { p_bio: "Alice's own words", p_favorite_team: "KC" })).error, "alice saves a bio");
  const before = await detailsOf(ALICE);
  assert(!(await call(MALLORY, "save_profile", { p_bio: "Mallory here", p_favorite_team: "NE" })).error, "mallory saves");
  assert(!(await call(MALLORY, "set_avatar", { p_path: photo(MALLORY), p_preset: null })).error, "mallory sets a photo in her own folder");
  for (const extra of [{ p_user_id: ALICE }, { user_id: ALICE }, { p_uid: ALICE }]) {
    const a = await call(MALLORY, "save_profile", { p_bio: "defaced", p_favorite_team: null, ...extra });
    const b = await call(MALLORY, "set_avatar", { p_path: null, p_preset: null, ...extra });
    assert(/does not exist/.test(a.error || "") && /does not exist/.test(b.error || ""), `an extra ${Object.keys(extra)[0]} argument is no function at all: ${show(a)} ${show(b)}`);
  }
  for (const who of [null, uuid(999)]) {
    for (const [fn, args] of [["save_profile", { p_bio: "x", p_favorite_team: null }], ["set_avatar", { p_path: photo(ALICE), p_preset: null }], ["set_avatar", { p_path: null, p_preset: null }]]) {
      const r = await call(who, fn, args);
      assert(r.error === "not_signed_in", `${fn} as ${who ? "a token with no account" : "anon"}: ${show(r)}`);
    }
  }
  assert(same(await detailsOf(ALICE), before), "alice's row is untouched");
  assert((await detailsOf(MALLORY)).avatar_path === photo(MALLORY), "mallory's own save landed");
});

await runTest("1c. set_avatar refuses every path outside the caller's own folder and pattern, and every preset that isn't a free one", async () => {
  await reset();
  await owner("insert into avatar_presets (key, pack, free) values ('gold-helmet', 'gold', false) on conflict (key) do nothing");
  const M = MALLORY, file = "1757800000000";
  const paths = [
    photo(ALICE), `${ALICE}/${file}.jpg`, `${M}/../x.webp`, `${M}/./${file}.webp`, `${M}/../${ALICE}/${file}.webp`, `${M}/..%2F${ALICE}%2F${file}.webp`, `..%2F${ALICE}%2F${file}.webp`,
    `${M}/a/b.webp`, `${M}/${file}/${file}.webp`, `${M}//${file}.webp`, `/${M}/${file}.webp`, `./${M}/${file}.webp`,
    `${M}%2F${file}.webp`, `${M}%2f${file}.webp`, `${M}\\${file}.webp`, `${M.toUpperCase()}/${file}.webp`,
    `${M}/${file}.webp `, ` ${M}/${file}.webp`, `${M}/${file}.webp\n`, `${M}/${file}.webp${ch(0x200B)}`, `${M}${ch(0x200B)}/${file}.webp`,
    `${M}/${file}.WEBP`, `${M}/${file}.Webp`, `${M}/${file}.gif`, `${M}/${file}.svg`, `${M}/${file}.html`, `${M}/${file}.jpeg`,
    `${M}/${file}.webp.html`, `${M}/${file}.html.webp`, `${M}/${file}.webp?x=1`, `${M}/${file}.webp#x`, `${M}/${file}.webp%00`,
    `${M}/123456789.webp`, `${M}/12345678901234567.webp`, `${M}/${ch(0xFF11)}757800000000.webp`, `${M}/${ch(0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667, 0x668, 0x669, 0x660)}.webp`,
    `${M}/${file}${ch(0xFF0E)}webp`, "https://evil.example/x.webp", `javascript:alert(1)//${file}.webp`, "data:image/png;base64,AAAA", "", M,
  ];
  for (const p of paths) {
    const r = await call(M, "set_avatar", { p_path: p, p_preset: null });
    assert(r.error === "bad_path", `set_avatar(${show(p)}) should be bad_path, got ${show(r)}`);
  }
  const presets = ["no-such-avatar", "Crown", " crown", "crown ", `crown${ch(0x200B)}`, "", "gold-helmet", "crown' or '1'='1", "__proto__"];
  for (const key of presets) {
    const r = await call(M, "set_avatar", { p_path: null, p_preset: key });
    assert(r.error === "bad_preset", `set_avatar preset ${show(key)} should be bad_preset, got ${show(r)}`);
  }
  assert((await call(M, "set_avatar", { p_path: photo(M), p_preset: "crown" })).error === "bad_request", "a photo and a preset together is bad_request");
  assert((await detailsOf(M)) === null, "no refusal created a row");
  // The table holds the same line if a function were ever skipped.
  const direct = await failure(db, "insert into profile_details (user_id, avatar_path) values ($1, $2)", [M, photo(ALICE)]);
  assert(/check constraint/.test(direct), `the table itself refuses a path in someone else's folder: ${direct}`);
});

await runTest("1d. a favorite team is one of the 32 codes exactly, through the function and the table", async () => {
  await reset();
  for (const team of ["kc", "KC ", " KC", "KC'--", "javascript:alert(1)", "__proto__", "XYZ", "", `K${ch(0x200D)}C`, fullWidth("kc").toUpperCase()]) {
    const r = await call(MALLORY, "save_profile", { p_bio: "", p_favorite_team: team });
    assert(r.error === "bad_team", `team ${show(team)} should be bad_team, got ${show(r)}`);
  }
  assert(/check constraint/.test(await failure(db, "insert into profile_details (user_id, favorite_team) values ($1, 'XYZ')", [MALLORY])), "the table refuses a bad team too");
});

// ---------- 2. Limits and the word filter ----------

await runTest("2a. a bio is 160 code points at most however it's built, and has no control, invisible or direction-changing characters", async () => {
  await reset();
  const family = ch(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467, 0x200D, 0x1F466); // 7 code points, one picture
  const tooLong = [
    "x".repeat(161), ch(0x1F3C8).repeat(161), `${"e" + ch(0x301)}`.repeat(80) + "e", family.repeat(23),
    `${"x".repeat(80)}${ch(0xA0)}${"x".repeat(80)}`, // a no-break space is only trimmed at the ends
    "x".repeat(1000000),
  ];
  for (const bio of tooLong) {
    const r = await call(MALLORY, "save_profile", { p_bio: bio, p_favorite_team: null });
    assert(r.error === "bio_too_long", `${show(bio)} (${[...bio].length} code points) should be bio_too_long, got ${show(r)}`);
  }
  const fits = [ch(0x1F3C8).repeat(160), `${"e" + ch(0x301)}`.repeat(80), `${" ".repeat(500)}${"x".repeat(160)}${ch(0x3000, 0xFEFF, 0x2029)}`];
  for (const bio of fits) {
    const r = await call(MALLORY, "save_profile", { p_bio: bio, p_favorite_team: null });
    assert(!r.error && [...r.data.bio].length <= 160, `${show(bio)} should save at 160 code points or fewer, got ${show(r)}`);
  }
  const controls = [0x1, 0x7, 0x8, 0x9, 0xA, 0xB, 0xC, 0xD, 0x1B, 0x1F, 0x7F, 0x85, 0x9F, 0x200B, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
    0x2060, 0x2061, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF];
  for (const code of controls) {
    const bio = `good ${ch(code)} bio`;
    const r = await call(MALLORY, "save_profile", { p_bio: bio, p_favorite_team: null });
    assert(r.error === "bio_invalid", `U+${code.toString(16).toUpperCase()} inside a bio should be bio_invalid, got ${show(r)}`);
  }
  const nul = await call(MALLORY, "save_profile", { p_bio: `nul${ch(0)}byte`, p_favorite_team: null });
  assert(nul.error && !nul.data, `a NUL byte is refused: ${show(nul)}`);
  assert(/check constraint/.test(await failure(db, "insert into profile_details (user_id, bio) values ($1, $2)", [MALLORY, `a${ch(0x202E)}b`])), "the table refuses a direction override too");
  assert(/check constraint/.test(await failure(db, "update profile_details set bio = $2 where user_id = $1", [MALLORY, "x".repeat(161)])), "and a long bio");
});

await runTest("2b. blocked words stay blocked in a bio: case, punctuation, plurals, look-alike digits and symbols, Cyrillic, Greek, full width, joiners, accents, stretching and spacing", async () => {
  await reset();
  const words = [...new Set([WORD, ANYWHERE, ANYWHERE_DOUBLED, ...seed("word").slice(0, 4), ...seed("anywhere")])];
  let checked = 0;
  for (const w of words) {
    const match = BLOCKED_WORDS_SEED.find((b) => b.word === w).match;
    for (const bio of bioDisguises(w, match)) {
      const r = await call(MALLORY, "save_profile", { p_bio: bio, p_favorite_team: null });
      assert(r.error === "bio_blocked", `bio ${show(bio)} should be bio_blocked, got ${show(r)}`);
      checked++;
    }
  }
  assert(checked > 150, `expected a real spread of disguises, checked ${checked}`);
  assert((await detailsOf(MALLORY)) === null, "none of them saved");
});

await runTest("2c. signup refuses a username outside the rule (invisible, look-alike, direction, HTML, empty, overlong, not text) and leaves no account behind", async () => {
  await reset();
  const cases = [...INVALID_USERNAMES.map((u) => ({ username: u })), {}, { username: null }, { username: 12 }, { username: ["alice"] }, { username: { name: "alice" } }];
  for (const meta of cases) {
    const id = globalThis.crypto.randomUUID();
    const err = await failure(db, "insert into auth.users values ($1, $2)", [id, meta]);
    assert(err === "username_invalid", `signup with ${show(meta)} should raise username_invalid, got ${show(err)}`);
    const left = (await owner("select (select count(*)::int from auth.users where id = $1) + (select count(*)::int from profiles where id = $1) as n", [id]))[0].n;
    assert(left === 0, `a refused signup leaves nothing behind (${show(meta)})`);
  }
  const dup = await failure(db, "insert into auth.users values ($1, $2)", [globalThis.crypto.randomUUID(), { username: "alice" }]);
  assert(/unique|duplicate/.test(dup), `an exact duplicate username can't sign up: ${dup}`);
});

await runTest("2d. signup refuses a username hiding a blocked word: case, underscores, digits around it, look-alike digits, and a doubled letter stretched", async () => {
  await reset();
  const names = [
    ...usernameDisguises(WORD, "word"), ...usernameDisguises(ANYWHERE, "anywhere"), `xX_${ANYWHERE_DOUBLED}_Xx`,
    ...DOUBLED_WORDS.flatMap((w) => [stretchDoubled(w), stretchDoubled(w, 5).slice(0, 16), stretchDoubled(w).toUpperCase(), `${stretchDoubled(w)}_1`.slice(0, 16)]),
    // Stretched with look-alike digits: 5 5 5 reads as s s s.
    ...DOUBLED_WORDS.filter((w) => /([st])\1/.test(w)).map((w) => w.replace(/([st])\1/, (_, c) => DIGITS[c].repeat(3))),
  ].filter((u) => /^[A-Za-z0-9_]{3,16}$/.test(u));
  assert(names.length > 40, `expected many disguised names, got ${names.length}`);
  for (const username of names) {
    const id = globalThis.crypto.randomUUID();
    const err = await failure(db, "insert into auth.users values ($1, $2)", [id, { username }]);
    assert(err === "username_blocked", `signup as ${show(username)} should raise username_blocked, got ${show(err)}`);
    assert((await owner("select count(*)::int as n from profiles where id = $1", [id]))[0].n === 0, "and creates no profile");
  }
  // The same rule still lets ordinary names through, doubled letters and stretching included.
  for (const username of ["Cassel_2009", "Hancock_Titus", "Goooal_Line", "Glasss_Jaw", "Mississippi", "Buttt_Fumble"]) {
    const err = await failure(db, "insert into auth.users values ($1, $2)", [globalThis.crypto.randomUUID(), { username }]);
    assert(err === "", `${username} should sign up, got ${err}`);
  }
});

await runTest("2e. check_username says invalid for every name outside the rule, and a moderator's rename refuses invalid, blocked and taken names", async () => {
  await reset();
  for (const u of [...INVALID_USERNAMES, null]) {
    const r = await call(null, "check_username", { p_username: u });
    assert(r.data === "invalid", `check_username(${show(u)}) should be invalid, got ${show(r)}`);
  }
  for (const name of [...INVALID_USERNAMES, null]) {
    const r = await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: name });
    assert(r.error === "invalid", `rename to ${show(name)} should be invalid, got ${show(r)}`);
  }
  for (const name of [...usernameDisguises(WORD, "word"), ...usernameDisguises(ANYWHERE, "anywhere")]) {
    const r = await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: name });
    assert(r.error === "blocked", `rename to ${show(name)} should be blocked, got ${show(r)}`);
  }
  for (const name of ["alice", "bob", "modbot"]) {
    const r = await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: name });
    assert(r.error === "taken", `rename to ${name} should be taken, got ${show(r)}`);
  }
  assert((await owner("select username from profiles where id = $1", [BOB]))[0].username === "bob", "bob kept his name through every refusal");
});

await runTest("2f. the word filter's former gaps stay closed: compatibility letters, script g, format, tag and variation characters, and a doubled letter tripled - in bios, check_username and renames", async () => {
  await reset();
  const closed = [
    ["letters outside the fold table (mathematical bold)", mathBold(ANYWHERE)],
    ["letters outside the fold table (circled)", circled(ANYWHERE)],
    ["look-alikes outside the fold table (Latin script g U+0261)", ANYWHERE_DOUBLED.replace(/g/g, ch(0x261))],
    ["an invisible format character splitting a whole word (U+206A)", inside(WORD, ch(0x206A))],
    ["a tag character splitting a whole word (U+E0041)", inside(WORD, ch(0xE0041))],
    ["a variation selector from the supplement splitting a whole word (U+E0100)", inside(WORD, ch(0xE0100))],
    ...DOUBLED_WORDS.map((w) => [`a doubled letter stretched to three (${w.length} letters)`, stretchDoubled(w)]),
  ];
  const { rows } = await db.query("select u.n, text_is_clean(u.t) as clean from unnest($1::text[]) with ordinality as u(t, n) order by u.n", [closed.map((g) => g[1])]);
  closed.forEach(([what, text], i) => assert(rows[i].clean === false, `text_is_clean should refuse ${what}: ${show(text)}`));
  for (const [what, text] of closed) {
    const r = await call(MALLORY, "save_profile", { p_bio: `so ${text}`, p_favorite_team: null });
    // U+206A is also one of the characters a bio can't contain at all, which is checked first.
    const want = text.includes(ch(0x206A)) ? "bio_invalid" : "bio_blocked";
    assert(r.error === want, `a bio with ${what} should be ${want}, got ${show(r)}`);
  }
  const names = DOUBLED_WORDS.flatMap((w) => [stretchDoubled(w), stretchDoubled(w, 4).toUpperCase()]).filter((u) => /^[A-Za-z0-9_]{3,16}$/.test(u));
  assert(names.length >= 4, `expected stretched usernames to try, got ${show(names)}`);
  for (const name of names) {
    const check = await call(null, "check_username", { p_username: name });
    assert(check.data === "blocked", `check_username(${show(name)}) should be blocked, got ${show(check)}`);
    const rename = await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: name });
    assert(rename.error === "blocked", `rename to ${show(name)} should be blocked, got ${show(rename)}`);
  }
  assert((await detailsOf(MALLORY)) === null && (await owner("select username from profiles where id = $1", [BOB]))[0].username === "bob", "nothing was saved and nobody renamed");
});

// ---------- 3. Reading what clients must not ----------

await runTest("3a. no client reads blocked_words: not directly, not inside another query, not through planner statistics, and text_is_clean can't be called", async () => {
  await reset();
  await owner("analyze public.blocked_words");
  const reads = [
    "select * from blocked_words", "select count(*) from blocked_words", "select word from blocked_words where word like 'f%'", "table blocked_words",
    "select username from profiles where lower(username) in (select word from blocked_words)",
    "select exists (select 1 from profiles p join blocked_words b on b.word = p.username)",
  ];
  for (const who of [null, MALLORY, MOD]) {
    const label = who === MOD ? "a moderator" : who ? "a player" : "anon";
    for (const statement of reads) {
      const r = await attempt(who, statement);
      assert(/permission denied/.test(r.error || ""), `${label}: "${statement}" should be permission denied, got ${show(r)}`);
    }
    const stats = await attempt(who, "select attname, most_common_vals::text from pg_stats where tablename = 'blocked_words'");
    assert(!stats.error && stats.rows.length === 0, `${label} sees no statistics of blocked_words: ${show(stats)}`);
    for (const statement of ["select text_is_clean('x')", "select public.text_is_clean(t => 'x')"]) {
      const r = await attempt(who, statement);
      assert(/permission denied for function/.test(r.error || ""), `${label} can't call text_is_clean: ${show(r)}`);
    }
  }
  const grants = await owner(`select r.rolname, has_table_privilege(r.rolname, 'public.blocked_words', 'select, insert, update, delete') as can
    from pg_roles r where r.rolname in ('anon', 'authenticated')`);
  assert(grants.length === 2 && grants.every((g) => !g.can), `anon and authenticated hold no privilege on blocked_words: ${show(grants)}`);
  // The refusals the filter causes are bare codes: they never echo the text or a word from the list.
  const refusals = [
    (await call(MALLORY, "save_profile", { p_bio: `nice ${WORD}`, p_favorite_team: null })).error,
    (await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: `${WORD}_99` })).error,
    await failure(db, "insert into auth.users values ($1, $2)", [globalThis.crypto.randomUUID(), { username: `${ANYWHERE}_99` }]),
  ];
  assert(same(refusals, ["bio_blocked", "blocked", "username_blocked"]), `refusals are only their codes: ${show(refusals)}`);
});

await runTest("3b. reports and moderators can't be read by a player, a moderator or anon, and the queue answers only moderators", async () => {
  await reset();
  assert(!(await call(BOB, "report_player", { p_username: "alice", p_reason: "bio", p_note: "a private note" })).error, "bob reports alice");
  for (const who of [null, MALLORY, ALICE, MOD]) {
    for (const statement of ["select * from reports", "select * from moderators", "select count(*)::int as n from reports where note like '%private%'"]) {
      const r = await attempt(who, statement);
      assert(!r.error && (r.rows.length === 0 || r.rows[0].n === 0), `"${statement}" as ${who || "anon"} should find nothing, got ${show(r)}`);
    }
    const anyMods = await attempt(who, "select exists (select 1 from moderators) as e");
    assert(anyMods.rows?.[0]?.e === false, "nobody can even tell whether moderators exist");
  }
  for (const who of [null, MALLORY, ALICE, BOB]) {
    const q = await call(who, "mod_queue");
    assert(q.error === "not_moderator", `mod_queue as ${who || "anon"} is not_moderator, got ${show(q)}`);
    assert((await call(who, "is_moderator")).data === false, "is_moderator is false for them");
  }
  const q = await call(MOD, "mod_queue");
  assert(Array.isArray(q.data) && q.data.length === 1, `the moderator reads the queue: ${show(q)}`);
  const roles = await owner(`select has_table_privilege('anon', 'auth.users', 'select') as a, has_table_privilege('authenticated', 'auth.users', 'select') as b`);
  assert(roles[0].a === false && roles[0].b === false, "no migration gives clients auth.users");
});

// ---------- 4. Moderation abuse ----------

await runTest("4a. report_player holds 10 reports in 24 hours even in a burst of simultaneous calls, and one open report per reporter, player and reason", async () => {
  await reset();
  const targets = Array.from({ length: 15 }, (_, i) => ({ id: uuid(200 + i), username: `target${String(i).padStart(2, "0")}` }));
  for (const t of targets) await addAccount(db, t);
  const burst = await asUser(db, MALLORY, () => Promise.all(targets.map((t) => db.query("select report_player($1, 'other', '')", [t.username]).then(() => "ok", (e) => e.message))));
  const counts = burst.reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {});
  assert(counts.ok === 10 && counts.limit === 5, `a burst of 15 lets exactly 10 through: ${show(counts)}`);
  assert((await owner("select count(*)::int as n from reports where reporter_id = $1", [MALLORY]))[0].n === 10, "and 10 are stored");
  assert((await call(MALLORY, "report_player", { p_username: "alice", p_reason: "picture" })).error === "limit", "the 11th, later, is limit too");
  // A moderator dismissing them doesn't hand out more.
  for (const t of targets.slice(0, 10)) assert(!(await call(MOD, "mod_act", { p_user_id: t.id, p_action: "dismiss" })).error, "dismissed");
  assert((await call(MALLORY, "report_player", { p_username: "alice", p_reason: "picture" })).error === "limit", "dismissed reports still count");

  const dupes = await asUser(db, BOB, () => Promise.all(Array.from({ length: 6 }, () => db.query("select report_player('alice', 'bio', 'again')").then(() => "ok", (e) => e.message))));
  assert(dupes.filter((r) => r === "ok").length === 1 && dupes.filter((r) => r === "duplicate").length === 5, `a burst of the same report stores one: ${show(dupes)}`);
  // Two sessions really at once: the limit check and the insert run under a per-reporter lock held to commit.
  let held = null;
  await asUser(db, CAROL, async () => {
    await db.query("begin");
    try {
      await db.query("select report_player('alice', 'other', '')");
      held = (await db.query("select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted")).rows[0].n;
    } finally {
      await db.query("rollback");
    }
  });
  assert(held >= 1, `report_player holds an advisory lock until its transaction ends, got ${held}`);
});

await runTest("4b. report_player refuses anon, yourself, nobody, odd reasons, and notes that are long, huge or not text - and stores nothing for them", async () => {
  await reset();
  const refused = [
    [null, ["alice", "bio", ""], "not_signed_in"],
    [uuid(999), ["alice", "bio", ""], "not_signed_in"],
    [MALLORY, ["mallory", "bio", ""], "self"],
    [MALLORY, ["nobody_here", "bio", ""], "no_such_player"],
    [MALLORY, [null, "bio", ""], "no_such_player"],
    [MALLORY, ["ALICE", "bio", ""], "no_such_player"],
    [MALLORY, ["alice' or '1'='1", "bio", ""], "no_such_player"],
    [MALLORY, ["%", "bio", ""], "no_such_player"],
    [MALLORY, ["alice", "BIO", ""], "bad_reason"],
    [MALLORY, ["alice", " bio", ""], "bad_reason"],
    [MALLORY, ["alice", "spam", ""], "bad_reason"],
    [MALLORY, ["alice", null, ""], "bad_reason"],
    [MALLORY, ["alice", "bio", "x".repeat(201)], "note_too_long"],
    [MALLORY, ["alice", "bio", ch(0x1F4A9).repeat(201)], "note_too_long"],
    [MALLORY, ["alice", "bio", `${"e" + ch(0x301)}`.repeat(100) + "e"], "note_too_long"],
    [MALLORY, ["alice", "bio", "x".repeat(1000000)], "note_too_long"],
  ];
  for (const [who, [username, reason, note], code] of refused) {
    const r = await attempt(who, "select report_player($1, $2, $3)", [username, reason, note]);
    assert(r.error === code, `report_player(${show(username)}, ${show(reason)}, ${show(note)}) as ${who || "anon"} should be ${code}, got ${show(r)}`);
  }
  const nul = await attempt(MALLORY, "select report_player('alice', 'bio', $1)", [`nul${ch(0)}`]);
  assert(nul.error, "a NUL byte in a note is refused");
  assert((await owner("select count(*)::int as n from reports"))[0].n === 0, "no refusal stored a report");
  const direct = await attempt(MALLORY, "insert into reports (reporter_id, target_id, reason) values ($1, $2, 'bio')", [BOB, ALICE]);
  assert(refusedByRls(direct), `nobody inserts a report directly, least of all in someone else's name: ${show(direct)}`);
});

await runTest("4c. mod_act: players and anon get not_moderator for every action, and a moderator can't break usernames or hijack an exact name", async () => {
  await reset();
  assert(!(await call(ALICE, "save_profile", { p_bio: "Alice's own words", p_favorite_team: "KC" })).error, "alice saves a bio");
  for (const who of [null, MALLORY, ALICE]) {
    for (const action of ["remove_picture", "clear_bio", "rename", "dismiss", "bad", null]) {
      const r = await call(who, "mod_act", { p_user_id: ALICE, p_action: action, p_new_name: "hijacked" });
      assert(r.error === "not_moderator", `${action} as ${who || "anon"} should be not_moderator, got ${show(r)}`);
    }
  }
  for (const who of [MALLORY, null]) {
    const r = await attempt(who, "insert into moderators (user_id) values ($1)", [MALLORY]);
    assert(refusedByRls(r), `nobody makes themselves a moderator: ${show(r)}`);
  }
  for (const action of ["DISMISS", "dismiss; delete from reports", " rename", "remove_picture "]) {
    assert((await call(MOD, "mod_act", { p_user_id: ALICE, p_action: action })).error === "bad_action", `${show(action)} is bad_action`);
  }
  assert((await call(MOD, "mod_act", { p_user_id: uuid(999), p_action: "clear_bio" })).error === "no_such_player", "an unknown player is no_such_player");
  assert((await detailsOf(ALICE)).bio === "Alice's own words" && (await owner("select username from profiles where id = $1", [ALICE]))[0].username === "alice", "alice untouched");
  // Uniqueness holds through renames, and a case variant can't take over an exact name's profile.
  assert((await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: "alice" })).error === "taken", "bob can't be renamed to alice");
  assert(!(await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: "ALICE" })).error, "a case variant is a different name (PROFILES.md)");
  assert((await call(MOD, "mod_act", { p_user_id: CAROL, p_action: "rename", p_new_name: "ALICE" })).error === "taken", "but it's then taken exactly");
  assert((await call(null, "player_profile", { p_username: "alice" })).data?.profile?.id === ALICE, "alice's exact address still opens alice");
  assert((await call(null, "player_profile", { p_username: "Alice" })).data === null, "an address that matches both in another case opens nobody");
  const names = await owner("select username, count(*)::int as n from profiles group by username having count(*) > 1");
  assert(names.length === 0, `no username is held twice: ${show(names)}`);
});

// ---------- 5. Storage policies ----------

const insertObject = (who, bucket, name) => attempt(who, "insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]);

await runTest("5a. a player or anon can't add, replace, move, read or delete a file outside their own avatars folder", async () => {
  await reset();
  const alicePhoto = photo(ALICE), mine = photo(MALLORY);
  await owner("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2), ('other', $1, $2)", [alicePhoto, ALICE]);
  assert(!(await insertObject(MALLORY, "avatars", mine)).error, "mallory uploads to her own folder");
  const inserts = [
    ["avatars", photo(ALICE, 5)], ["avatars", `${ALICE}/../${MALLORY}/1757800000009.webp`], ["avatars", "1757800000000.webp"],
    ["avatars", `/${MALLORY}/1757800000001.webp`], ["avatars", `${MALLORY.toUpperCase()}/1757800000001.webp`], ["avatars", `${MALLORY} /1757800000001.webp`],
    ["other", photo(MALLORY, 1)], ["other", photo(ALICE, 1)], ["no-such-bucket", photo(MALLORY, 1)],
  ];
  for (const who of [MALLORY, null]) {
    for (const [bucket, name] of inserts) {
      const r = await insertObject(who, bucket, name);
      assert(r.error, `${who ? "mallory" : "anon"} must not add ${bucket}/${show(name)}: ${show(r)}`);
    }
    const anonOwn = who ? null : await insertObject(null, "avatars", photo(MALLORY, 2));
    assert(!anonOwn || refusedByRls(anonOwn), "anon can't upload even into a real player's folder");
    const upsert = await attempt(who, "insert into storage.objects (bucket_id, name) values ('avatars', $1) on conflict (bucket_id, name) do update set metadata = '{\"x\":1}'", [alicePhoto]);
    assert(refusedByRls(upsert), `an upsert over alice's file is refused: ${show(upsert)}`);
    for (const [statement, params] of [
      ["update storage.objects set metadata = '{\"x\":1}' where name = $1", [alicePhoto]],
      ["update storage.objects set name = $2 where name = $1 and bucket_id = 'avatars'", [alicePhoto, photo(MALLORY, 7)]],
      ["delete from storage.objects where name = $1", [alicePhoto]],
      ["delete from storage.objects where bucket_id = 'other'", []],
    ]) {
      const r = await attempt(who, statement, params);
      assert(!r.error && r.affected === 0, `${who ? "mallory" : "anon"}: "${statement}" touches nothing, got ${show(r)}`);
    }
    const seen = await attempt(who, "select bucket_id, name from storage.objects where name like $1", [`${ALICE}%`]);
    assert(seen.rows.length === 0, `${who ? "mallory" : "anon"} can't list alice's files`);
  }
  for (const [statement, params] of [
    ["update storage.objects set name = $2 where name = $1", [mine, photo(ALICE, 8)]],
    ["update storage.objects set bucket_id = 'other' where name = $1", [mine]],
  ]) {
    const r = await attempt(MALLORY, statement, params);
    assert(refusedByRls(r), `mallory can't move her own file out of her folder or bucket: ${show(r)}`);
  }
  const left = await owner("select bucket_id || '/' || name as k from storage.objects order by k");
  assert(same(left.map((r) => r.k), [`avatars/${alicePhoto}`, `avatars/${mine}`, `other/${alicePhoto}`].sort()), `alice's files survived: ${show(left)}`);
});

await runTest("5b. while uploads are paused nobody adds, replaces or moves a file (inserts, upserts and updates), a moderator included; deleting your own still works", async () => {
  await reset();
  const mine = photo(MALLORY), modFile = photo(MOD);
  await owner("insert into storage.objects (bucket_id, name) values ('avatars', $1), ('avatars', $2)", [mine, modFile]);
  await owner("update site_flags set enabled = true where key = 'uploads_paused'");
  try {
    for (const [who, name] of [[MALLORY, photo(MALLORY, 1)], [MOD, photo(MOD, 1)]]) {
      assert(refusedByRls(await insertObject(who, "avatars", name)), `${who === MOD ? "the moderator" : "mallory"} can't upload while paused`);
    }
    for (const [statement, params] of [
      ["insert into storage.objects (bucket_id, name) values ('avatars', $1) on conflict (bucket_id, name) do update set metadata = '{\"replaced\":true}'", [mine]],
      ["update storage.objects set metadata = '{\"replaced\":true}' where name = $1", [mine]],
      ["update storage.objects set name = $2 where name = $1", [mine, photo(MALLORY, 2)]],
    ]) {
      const r = await attempt(MALLORY, statement, params);
      assert(refusedByRls(r), `"${statement}" is refused while paused: ${show(r)}`);
    }
    const flag = await attempt(MALLORY, "update site_flags set enabled = false where key = 'uploads_paused'");
    assert(flag.affected === 0, "a player can't switch the kill switch off");
    const del = await attempt(MALLORY, "delete from storage.objects where name = $1", [mine]);
    assert(del.affected === 1, "deleting your own file still works");
  } finally {
    await owner("update site_flags set enabled = false where key = 'uploads_paused'");
  }
});

await runTest("5c. a moderator reads and deletes only avatars: not other buckets, and never uploads into or changes someone's folder", async () => {
  await reset();
  const alicePhoto = photo(ALICE);
  await owner("insert into storage.objects (bucket_id, name) values ('avatars', $1), ('other', $1)", [alicePhoto]);
  assert(refusedByRls(await insertObject(MOD, "avatars", photo(ALICE, 3))), "no upload into alice's folder");
  const change = await attempt(MOD, "update storage.objects set metadata = '{\"x\":1}' where name = $1", [alicePhoto]);
  assert(!change.error && change.affected === 0, "no change to alice's file");
  const otherSeen = await attempt(MOD, "select name from storage.objects where bucket_id = 'other'");
  assert(otherSeen.rows.length === 0, "nothing in another bucket is visible");
  const bare = await attempt(MOD, "delete from storage.objects");
  assert(!bare.error, `a bare delete runs: ${show(bare)}`);
  const left = await owner("select bucket_id || '/' || name as k from storage.objects");
  assert(same(left.map((r) => r.k), [`other/${alicePhoto}`]), `the moderator's delete stays inside avatars: ${show(left)}`);
});

await runTest("5d. the avatars bucket is public, 256 KB and WebP/JPEG/PNG only, and running the migration tightens a loosened bucket again", async () => {
  const check = async () => (await owner("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'"))[0];
  let b = await check();
  assert(b.public === true && Number(b.file_size_limit) === AVATAR_MAX_BYTES && same([...b.allowed_mime_types].sort(), [...AVATAR_TYPES].sort()), `bucket: ${show(b)}`);
  assert(!b.allowed_mime_types.some((t) => /svg|html|xml|javascript|gif/.test(t)), "no SVG, HTML or script types");
  await owner("update storage.buckets set file_size_limit = null, allowed_mime_types = array['image/svg+xml', 'text/html'] where id = 'avatars'");
  await db.exec(sql("migration-profiles.sql"));
  b = await check();
  assert(Number(b.file_size_limit) === AVATAR_MAX_BYTES && same([...b.allowed_mime_types].sort(), [...AVATAR_TYPES].sort()), `re-running restores the limits: ${show(b)}`);
});

// ---------- 6. Security definer hygiene ----------

// Every function in the public schema: [security definer, search_path, anon may execute, authenticated may execute].
// A trigger function can't be called directly whatever its grants (checked below).
const PG_TEMP_LAST = "public, pg_temp";
const EXPECTED_FUNCTIONS = {
  "check_new_build()": [false, PG_TEMP_LAST, false, false],
  "check_username(p_username text)": [true, PG_TEMP_LAST, true, true],
  // The name an account picks after signing in with Google: for the account doing it, so anon can't call it.
  "claim_username(p_username text)": [true, PG_TEMP_LAST, false, true],
  // v1.17.0: only the signup trigger names a guest, running as its owner. No client may ask for a name.
  "new_guest_name()": [true, PG_TEMP_LAST, false, false],
  // Called by the avatars insert policy as the uploading player, so they need execute; anon never uploads.
  "avatar_folder_has_room()": [false, PG_TEMP_LAST, false, true],
  // 2.0: the bucket's insert and update policies call it, so the player running them needs execute - and
  // invoker, because profiles is publicly selectable and it should need nothing its caller doesn't have.
  "caller_is_guest()": [false, PG_TEMP_LAST, false, true],
  "handle_new_user()": [true, PG_TEMP_LAST, true, true],
  "is_moderator()": [true, PG_TEMP_LAST, true, true],
  "mod_act(p_user_id uuid, p_action text, p_new_name text)": [true, PG_TEMP_LAST, true, true],
  "mod_queue()": [true, PG_TEMP_LAST, true, true],
  "player_profile(p_username text)": [false, "public", true, true],
  "player_stats(p_user_id uuid)": [false, "public", true, true],
  "report_player(p_username text, p_reason text, p_note text)": [true, PG_TEMP_LAST, true, true],
  "save_profile(p_bio text, p_favorite_team text)": [true, PG_TEMP_LAST, true, true],
  "set_avatar(p_path text, p_preset text)": [true, PG_TEMP_LAST, true, true],
  "site_stats(p_limit integer)": [false, "public", true, true],
  "site_totals()": [false, "public", true, true],
  "stats_card(p jsonb)": [false, "public", true, true],
  "text_is_clean(t text)": [true, PG_TEMP_LAST, false, false],
  "use_account_username()": [false, PG_TEMP_LAST, false, false],
  // 1.11.1: only check_username, the signup trigger and mod_act ask it, running as its owner.
  "username_is_reserved(p_username text)": [false, PG_TEMP_LAST, false, false],
};

await runTest("6a. every public function is the expected one: definer or invoker, its search_path, and who may execute it", async () => {
  const rows = await owner(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosecdef as definer,
      (select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`);
  const actual = Object.fromEntries(rows.map((r) => [r.sig, [r.definer, r.search_path, r.anon, r.authenticated]]));
  assert(same(Object.keys(actual).sort(), Object.keys(EXPECTED_FUNCTIONS).sort()), `public functions: ${show(Object.keys(actual))} - a new one needs a deliberate entry here`);
  for (const [sig, want] of Object.entries(EXPECTED_FUNCTIONS)) assert(same(actual[sig], want), `${sig}: expected ${show(want)}, got ${show(actual[sig])}`);
  for (const r of rows.filter((x) => x.definer)) assert(r.search_path === PG_TEMP_LAST, `${r.sig} is security definer, so it must search pg_temp last`);
  for (const who of [null, MALLORY]) {
    for (const fn of ["handle_new_user", "use_account_username", "check_new_build"]) {
      const r = await attempt(who, `select public.${fn}()`);
      assert(r.error, `${fn} can't be called directly by ${who || "anon"}`);
    }
  }
});

await runTest("6b. a caller's temporary tables, temporary functions and search_path don't change what a security definer function reads", async () => {
  await reset();
  await owner("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [photo(ALICE)]);
  assert(!(await call(BOB, "report_player", { p_username: "alice", p_reason: "bio" })).error, "bob reports alice");
  for (let i = 0; i < 10; i++) await addAccount(db, { id: uuid(300 + i), username: `spam${i}` });
  const targets = Array.from({ length: 10 }, (_, i) => `spam${i}`);
  for (const t of targets) assert(!(await call(MALLORY, "report_player", { p_username: t, p_reason: "other" })).error, "mallory uses up her reports");

  const results = await asUser(db, MALLORY, async () => {
    const out = {};
    const temps = [
      "create temp table moderators (user_id uuid, added_at timestamptz default now())",
      "create temp table blocked_words (word text, match text)",
      "create temp table profiles (id uuid, username text, created_at timestamptz default now())",
      "create temp table reports (id uuid default gen_random_uuid(), reporter_id uuid, target_id uuid, reason text, note text, status text default 'open', created_at timestamptz default now())",
      "create temp table profile_details (user_id uuid, bio text, avatar_path text, avatar_preset text, favorite_team text, updated_at timestamptz)",
      "create function pg_temp.text_is_clean(t text) returns boolean language sql as 'select true'",
      "create function pg_temp.is_moderator() returns boolean language sql as 'select true'",
    ];
    try {
      for (const t of temps) {
        const r = await tryQuery(t);
        if (r.error) throw new Error(`setting up the attack failed: ${t}: ${r.error}`);
      }
      await tryQuery("insert into pg_temp.moderators (user_id) values ($1)", [MALLORY]);
      await tryQuery("insert into pg_temp.profiles (id, username) values ($1, 'ghost_player')", [uuid(777)]);
      await tryQuery("set search_path = pg_temp, public");
      out.isModerator = await tryQuery("select is_moderator() as v");
      out.queue = await tryQuery("select mod_queue() as v");
      out.act = await tryQuery("select mod_act($1, 'clear_bio', null) as v", [ALICE]);
      out.bio = await tryQuery("select save_profile($1, null) as v", [`big ${WORD} energy`]);
      out.check = await tryQuery("select check_username($1) as v", [`${WORD}_99`]);
      out.taken = await tryQuery("select check_username('alice') as v");
      out.ghost = await tryQuery("select report_player('ghost_player', 'bio', '') as v");
      out.limit = await tryQuery("select report_player('alice', 'picture', '') as v");
      out.storageDelete = await tryQuery("delete from storage.objects where name = $1 returning name", [photo(ALICE)]);
      out.safeBio = await tryQuery("select save_profile('a fine bio', null) as v");
    } finally {
      await tryQuery("set search_path = public");
      for (const t of ["moderators", "blocked_words", "profiles", "reports", "profile_details"]) await tryQuery(`drop table if exists pg_temp.${t}`);
      await tryQuery("drop function if exists pg_temp.text_is_clean(text)");
      await tryQuery("drop function if exists pg_temp.is_moderator()");
    }
    return out;
  });
  assert(results.isModerator.rows?.[0]?.v === false, `a temporary moderators table doesn't make a moderator: ${show(results.isModerator)}`);
  assert(results.queue.error === "not_moderator" && results.act.error === "not_moderator", `nor opens the queue or the actions: ${show(results.queue)} ${show(results.act)}`);
  assert(results.bio.error === "bio_blocked" && results.check.rows?.[0]?.v === "blocked", `an empty temporary word list (or a temporary text_is_clean) doesn't switch the filter off: ${show(results.bio)} ${show(results.check)}`);
  assert(results.taken.rows?.[0]?.v === "taken" && results.ghost.error === "no_such_player", `a temporary profiles table isn't read: ${show(results.taken)} ${show(results.ghost)}`);
  assert(results.limit.error === "limit", `a temporary reports table doesn't reset the limit: ${show(results.limit)}`);
  assert(results.storageDelete.rows?.length === 0, "the storage policies' is_moderator isn't fooled either");
  assert(!results.safeBio.error, `and the real table takes the real save: ${show(results.safeBio)}`);
  assert((await detailsOf(MALLORY))?.bio === "a fine bio" && (await detailsOf(ALICE)) === null, "writes went to the real profile_details, for mallory only");
  assert((await owner("select count(*)::int as n from storage.objects"))[0].n === 1, "alice's file is still there");
  for (const statement of ["create function public.text_is_clean_x() returns boolean language sql as 'select true'", "create schema evil", "create table public.moderators_x (user_id uuid)"]) {
    const r = await attempt(MALLORY, statement);
    assert(/permission denied/.test(r.error || ""), `a client can't create objects outside its temporary schema: "${statement}" -> ${show(r)}`);
  }
});

// ---------- 7. player_profile and player_stats ----------

await runTest("7a. player_profile shows exactly what direct reads of public tables show - nothing about reports or moderators", async () => {
  await reset();
  await owner("insert into moderators (user_id) values ($1)", [ALICE]);
  assert(!(await call(ALICE, "save_profile", { p_bio: "Hello", p_favorite_team: "KC" })).error, "alice saves");
  const NOTE = "private-note-only-moderators-see";
  assert(!(await call(CAROL, "report_player", { p_username: "alice", p_reason: "bio", p_note: NOTE })).error, "carol reports alice");
  await owner("insert into sou_runs (date, user_id, username, score) values ('2026-09-10', $1, 'alice', 12)", [ALICE]);
  for (const who of [null, MALLORY]) {
    const res = await call(who, "player_profile", { p_username: "alice" });
    const text = JSON.stringify(res.data);
    assert(!text.includes(NOTE) && !text.includes("carol") && !/moderator|report|raw_user_meta/i.test(text), `nothing private in the profile: ${text.slice(0, 200)}`);
    const direct = await attempt(who, `select (select to_jsonb(p) from profiles p where p.id = $1) as profile,
      (select to_jsonb(d) from profile_details d where d.user_id = $1) as details, player_stats($1) as stats`, [ALICE]);
    assert(same(res.data, direct.rows[0]), `player_profile is exactly what ${who ? "a player" : "anon"} reads directly`);
  }
  const fns = await owner("select proname, prosecdef, provolatile from pg_proc where proname in ('player_profile', 'player_stats') order by 1");
  assert(fns.every((f) => f.prosecdef === false && f.provolatile === "s"), `both are stable security invoker: ${show(fns)}`);
});

await runTest("7b. odd, hostile and huge names neither error nor match anyone, and player_stats of nobody is the empty shape", async () => {
  await reset();
  const count = async () => (await owner("select count(*)::int as n from profiles"))[0].n;
  const n = await count();
  const names = ["alice' or '1'='1", "'; drop table profiles; --", "%", "_____", "a%", "\\", "alice\\", "ALICE%", `alice${ch(0x200B)}`, "x".repeat(1000000),
    "", null, ch(0x1F3C8), "$1", "alice\n", "(select username from profiles limit 1)"];
  for (const who of [null, MALLORY]) {
    for (const name of names) {
      const r = await call(who, "player_profile", { p_username: name });
      assert(!r.error && r.data === null, `player_profile(${show(name)}) should be null, got ${show(r)}`);
    }
  }
  const nul = await call(null, "player_profile", { p_username: `alice${ch(0)}` });
  assert(nul.error && !/Hello|best_score|recent/.test(nul.error), `a NUL byte is refused without saying anything about the data: ${show(nul)}`);
  assert((await count()) === n, "no profile was touched");
  const empty = await call(null, "player_stats", { p_user_id: uuid(999) });
  assert(same(empty.data, emptyPlayerStats()), `player_stats of nobody: ${show(empty)}`);
  const bad = await attempt(null, "select player_stats($1::text::uuid)", ["not-a-uuid'; select 1; --"]);
  assert(/invalid input syntax for type uuid/.test(bad.error || ""), `a malformed id is just a type error: ${show(bad)}`);
});

// ---------- 8. The minigame boards ----------

await runTest("8. Over/Under and builds rows carry the account's own name, a build's position and overall are what the boards can show, and renames stick", async () => {
  await reset();
  let r = await attempt(MALLORY, "insert into sou_runs (date, user_id, username, score) values ('2026-09-14', $1, 'alice', 20) returning username", [MALLORY]);
  assert(r.rows?.[0]?.username === "mallory", `an Over/Under score can't be posted under alice's name: ${show(r)}`);
  r = await attempt(MALLORY, "update sou_runs set username = $1 where user_id = $2 returning username", [`${WORD}_king`, MALLORY]);
  assert(r.rows?.[0]?.username === "mallory", `nor renamed afterwards: ${show(r)}`);
  r = await attempt(MALLORY, "insert into sou_runs (date, user_id, username, score) values ('2026-09-13', $1, 'alice', 20)", [ALICE]);
  assert(refusedByRls(r), "nor posted as alice's account");
  assert(refusedByRls(await attempt(null, "insert into sou_runs (date, user_id, username, score) values ('2026-09-13', $1, 'alice', 20)", [ALICE])), "anon posts nothing");

  r = await attempt(MALLORY, "insert into builds (user_id, username, pos, overall, filled) values ($1, 'alice', 'WR', 131.2, '{}') returning username", [MALLORY]);
  assert(r.rows?.[0]?.username === "mallory", `a build can't carry alice's name: ${show(r)}`);
  for (const pos of [WORD, "wr", "WR ", "", "K", "FLEX", "<b>QB</b>"]) {
    r = await attempt(MALLORY, "insert into builds (user_id, username, pos, overall, filled) values ($1, 'mallory', $2, 90, '{}')", [MALLORY, pos]);
    assert(r.error === "bad_build", `position ${show(pos)} should be bad_build, got ${show(r)}`);
  }
  for (const overall of ["NaN", "Infinity", "-Infinity", "1e12", "-1e12"]) {
    r = await attempt(MALLORY, "insert into builds (user_id, username, pos, overall, filled) values ($1, 'mallory', 'QB', $2::numeric, '{}')", [MALLORY, overall]);
    assert(r.error === "bad_build", `overall ${overall} should be bad_build, got ${show(r)}`);
  }
  assert(refusedByRls(await attempt(MALLORY, "insert into builds (user_id, username, pos, overall, filled) values ($1, 'alice', 'QB', 90, '{}')", [ALICE])), "no build for another account");

  assert(!(await call(MOD, "mod_act", { p_user_id: MALLORY, p_action: "rename", p_new_name: "renamed_one" })).error, "a moderator renames mallory");
  r = await attempt(MALLORY, "insert into sou_runs (date, user_id, username, score) values ('2026-09-12', $1, 'mallory', 3) returning username", [MALLORY]);
  assert(r.rows?.[0]?.username === "renamed_one", `her next score carries the new name, whatever her browser sends: ${show(r)}`);
  r = await attempt(MALLORY, "insert into builds (user_id, username, pos, overall, filled) values ($1, 'mallory', 'TE', 88, '{}') returning username", [MALLORY]);
  assert(r.rows?.[0]?.username === "renamed_one", "and so does her next build");
  const boards = await attempt(null, "select username from sou_runs union all select username from builds");
  assert(boards.rows.length === 4 && boards.rows.every((x) => x.username === "renamed_one"), `every row the boards read has her real name: ${show(boards.rows)}`);
  const stats = await call(null, "player_stats", { p_user_id: MALLORY });
  assert(same(stats.data.builds.best, { pos: "WR", overall: 131.2 }), `the profile's best build is a real position and number: ${show(stats.data.builds)}`);
});

await db.close();

// ---------- 9. The browser ----------

setupDom();
window.__ps_supabase__ = makeMockAuth();
const { act } = await import("react");
const ROOT = new URL("../", import.meta.url);
const source = (file) => readFileSync(new URL(file, ROOT), "utf8");
const HOSTILE = {
  username: `<img src=x onerror="alert(1)">`,
  bio: `</p><script>alert(1)</script><a href="javascript:alert(1)">tap</a> <b onmouseover=alert(1)>hi</b>`,
  note: `"><svg onload=alert(1)><iframe src="javascript:alert(1)">`,
  reporter: `<a href=//evil.example>x</a>`,
};
const URL_ATTRIBUTES = new Set(["href", "src", "srcset", "action", "formaction", "xlink:href", "poster", "background", "data"]);
// Nothing a player wrote became markup, an event handler, or a script or data address.
function assertInert(container, label, imgOrigin) {
  const bad = container.querySelector("script, iframe, object, embed, frame, base, meta, link, a[href], form[action]");
  assert(!bad, `${label}: rendered a <${bad?.tagName.toLowerCase()}>`);
  for (const el of container.querySelectorAll("*")) {
    for (const { name, value } of el.attributes) {
      assert(!/^on/i.test(name), `${label}: <${el.tagName.toLowerCase()}> got an ${name} attribute`);
      if (URL_ATTRIBUTES.has(name.toLowerCase())) assert(!/^\s*(javascript|vbscript|data):/i.test(value), `${label}: ${name}=${show(value)}`);
      if (name === "style") assert(!/url\(|expression\(|javascript:/i.test(value), `${label}: style=${show(value)}`);
    }
  }
  for (const img of container.querySelectorAll("img")) {
    const u = new URL(img.getAttribute("src"));
    assert(u.protocol === "https:" && u.origin === imgOrigin, `${label}: an image from ${show(img.getAttribute("src"))}`);
  }
}
let mounted = null;
async function show9(Component, props) {
  if (mounted) await act(async () => mounted.reactRoot.unmount());
  mounted = await renderComponent(Component, props);
  await flush();
  return mounted.container;
}
const STORAGE_ORIGIN = "https://project-ref.supabase.test";
const realStorage = () => new StorageClient(`${STORAGE_ORIGIN}/storage/v1`, {});

await runTest("9a. no HTML sinks in the profile code, no links built from data, and one image address - the avatar's", async () => {
  const sinks = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\s*\(|\beval\s*\(|new\s+Function\s*\(|srcdoc/;
  for (const file of ["profile.jsx", "moderation.jsx", "avatars.jsx", "avatar-picker.jsx", "avatar-image.mjs", "perfect-season.jsx", "ui-common.jsx", "storage-profile.js", "storage-moderation.js", "storage-core.js", "profile-rules.mjs"]) {
    const m = sinks.exec(source(file));
    assert(!m, `${file} uses ${m?.[0]}`);
  }
  for (const file of ["profile.jsx", "moderation.jsx", "avatars.jsx", "avatar-picker.jsx"]) {
    const text = source(file);
    assert(!/\bhref\s*=/.test(text), `${file} builds a link`);
    const srcs = text.match(/\bsrc\s*=\s*\{[^}]*\}/g) || [];
    assert(same(srcs, file === "avatars.jsx" ? ["src={photoUrl}"] : []), `${file} image sources: ${show(srcs)}`);
  }
});

await runTest("9b. avatarUrl only ever gives an https address in the avatars bucket, whatever path the database hands it", async () => {
  const SP = await import("../storage-profile.js");
  const SM = await import("../storage-moderation.js");
  window.__ps_supabase__ = { storage: realStorage() };
  const hostile = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+", "vbscript:x",
    "//evil.example/x.png", "https://evil.example/x.png", "/\\evil.example/x.png", "\\\\evil.example\\x.png", "../../../../evil", "%2e%2e/%2e%2e/evil",
    `${MALLORY}/1757800000000.webp?x="><script>`, "x\ny", `${ch(0x202E)}gnp.exe`, "#frag", "?q=1"];
  for (const path of hostile) {
    const url = SP.avatarUrl(path);
    const u = new URL(url);
    assert(u.protocol === "https:" && u.origin === STORAGE_ORIGIN, `avatarUrl(${show(path)}) -> ${show(url)}`);
    assert(url.startsWith(`${STORAGE_ORIGIN}/storage/v1/object/public/avatars/`), `stays under the bucket's address: ${show(url)}`);
  }
  for (const v of [null, undefined, "", 0, {}, ["x"]]) assert(SP.avatarUrl(v) === null, `avatarUrl(${show(v)}) is null`);
  const d = SP.mapDetails({ bio: HOSTILE.bio, avatar_path: "javascript:alert(1)", avatar_url: "javascript:alert(1)", avatar_preset: "__proto__", favorite_team: "javascript:alert(1)" });
  assert(new URL(d.avatarUrl).origin === STORAGE_ORIGIN, `mapDetails builds its address only from avatar_path: ${show(d.avatarUrl)}`);
  window.__ps_supabase__ = {
    storage: realStorage(),
    rpc: async (name) => name === "player_profile"
      ? { data: { profile: { id: "u1", username: HOSTILE.username, created_at: null }, details: { avatar_path: "data:text/html,<script>alert(1)</script>", bio: HOSTILE.bio }, stats: null }, error: null }
      : { data: [{ user_id: "u1", username: HOSTILE.username, avatar_path: "javascript:alert(1)", bio: HOSTILE.bio, reports: [] }], error: null },
  };
  const p = await SP.fetchPlayerProfile("whoever");
  assert(p.status === "ok" && new URL(p.profile.details.avatarUrl).origin === STORAGE_ORIGIN, `fetchPlayerProfile: ${show(p.profile?.details?.avatarUrl)}`);
  const q = await SM.fetchModQueue();
  assert(q?.length === 1 && new URL(q[0].avatarUrl).origin === STORAGE_ORIGIN, `fetchModQueue: ${show(q?.[0]?.avatarUrl)}`);
});

await runTest("9c. storage-profile.js deletes a previous photo only when it's in the player's own folder, and never uploads or deletes for another account", async () => {
  const SP = await import("../storage-profile.js");
  const ME = MALLORY, OTHER = ALICE;
  function client({ session = ME, setAvatarFails = false } = {}) {
    const log = { uploads: [], removed: [], rpcs: [] };
    window.__ps_supabase__ = {
      log,
      auth: { getSession: async () => ({ data: { session: session ? { user: { id: session } } : null }, error: null }) },
      from: () => ({ select: () => ({ eq: async () => ({ data: [{ enabled: false }], error: null }) }) }),
      rpc: async (name, args) => {
        log.rpcs.push({ name, args });
        if (setAvatarFails) return { data: null, error: { message: "bad_path", code: "P0001" }, status: 400 };
        return { data: { user_id: ME, bio: "", avatar_path: args.p_path, avatar_preset: args.p_preset, favorite_team: null, updated_at: "2026-09-14T00:00:00Z" }, error: null, status: 200 };
      },
      storage: {
        from: (bucket) => ({
          upload: async (path) => { log.uploads.push(`${bucket}/${path}`); return { data: { path }, error: null }; },
          remove: (paths) => { log.removed.push(...paths.map((x) => `${bucket}/${x}`)); return Promise.resolve({ data: [], error: null }); },
          getPublicUrl: (path) => realStorage().from(bucket).getPublicUrl(path),
        }),
      },
    };
    return log;
  }
  const blob = () => new Blob([new Uint8Array(64)], { type: "image/webp" });
  const notMine = [photo(OTHER), `${ME}/../${OTHER}/1757800000000.webp`, `${ME}/sub/1757800000000.webp`, `${ME.toUpperCase()}/1757800000000.webp`,
    `${ME}/1757800000000.webp\n`, `/${ME}/1757800000000.webp`, `${ME}/1757800000000.svg`, `${ME}/x.webp`, `${ME}%2F1757800000000.webp`, "", null];
  for (const previous of notMine) {
    for (const [label, run] of [
      ["saveAvatarPhoto", () => SP.saveAvatarPhoto(ME, blob(), previous)],
      ["setAvatarPreset", () => SP.setAvatarPreset("crown", previous)],
      ["removeAvatar", () => SP.removeAvatar(previous)],
    ]) {
      const log = client();
      const res = await run();
      await flush();
      assert(res.ok === true, `${label} succeeds: ${show(res)}`);
      assert(log.removed.every((x) => x.startsWith(`avatars/${ME}/`) && !x.includes("..")) && !log.removed.includes(`avatars/${previous}`), `${label} with previous ${show(previous)} deleted ${show(log.removed)}`);
    }
  }
  let log = client();
  await SP.saveAvatarPhoto(ME, blob(), photo(ME, 1));
  await flush();
  assert(log.removed.length === 1 && log.removed[0] === `avatars/${photo(ME, 1)}`, `a previous photo of her own is deleted: ${show(log.removed)}`);
  log = client({ session: ME });
  const other = await SP.saveAvatarPhoto(OTHER, blob(), photo(OTHER));
  await flush();
  assert(other.ok === false && other.reason === "signed_out" && !log.uploads.length && !log.removed.length, `nothing is uploaded or deleted for another account: ${show(other)} ${show(log)}`);
  log = client({ setAvatarFails: true });
  const failed = await SP.saveAvatarPhoto(ME, blob(), photo(OTHER));
  await flush();
  assert(failed.ok === false && log.uploads.length === 1 && same(log.removed, log.uploads) && log.uploads[0].startsWith(`avatars/${ME}/`), `a refused set_avatar deletes only the file just uploaded: ${show(log)}`);
});

await runTest("9d. the profile screen, the Reports queue and the Report sheet render names, bios, notes and reporters as text", async () => {
  const { ProfileScreen } = await loadModule("profile.jsx");
  const { ModerationQueue, ReportSheet } = await loadModule("moderation.jsx");
  const SP = await import("../storage-profile.js");
  window.__ps_supabase__ = { storage: realStorage() };
  const details = SP.mapDetails({ bio: HOSTILE.bio, avatar_path: `javascript:alert(1)//1757800000000.webp`, avatar_preset: "__proto__", favorite_team: "javascript:alert(1)" });
  const profile = veteranProfile({ username: HOSTILE.username, details });
  const noop = () => {};
  for (const [isOwner, userId] of [[false, null], [false, "someone"], [true, "fixture-veteran"]]) {
    const c = await show9(ProfileScreen, { status: "ok", profile, isOwner, userId, rank: { fantasy: 1, standard: null }, moderator: null,
      onRetry: noop, onShare: async () => "copied", onDetailsSaved: noop, onLogOut: noop, onPlay: noop, onOpenReports: noop });
    assertInert(c, `profile (owner ${isOwner})`, STORAGE_ORIGIN);
    assert(c.querySelector(".pf-name")?.textContent === HOSTILE.username && c.querySelector(".pf-bio")?.textContent === HOSTILE.bio, "the name and bio show as typed");
    assert(c.querySelector("section.profile")?.getAttribute("data-username") === HOSTILE.username, "an attribute holds the name as plain text");
    assert(!c.querySelector(".pf-team"), "a favorite team that isn't a team isn't shown");
  }

  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  const { data: modData } = await auth.auth.signUp({ email: "mod@test.example", password: "Password1", options: { data: { username: "modbot" } } });
  const { data: repData } = await auth.auth.signUp({ email: "rep@test.example", password: "Password1", options: { data: { username: "reporter" } } });
  const now = new Date().toISOString();
  auth._moderators.set(modData.user.id, { user_id: modData.user.id, added_at: now });
  auth._profiles.get(repData.user.id).username = HOSTILE.reporter;
  auth._profiles.set("evil-1", { id: "evil-1", username: HOSTILE.username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] });
  auth._profileDetails.set("evil-1", { user_id: "evil-1", bio: HOSTILE.bio, avatar_path: "javascript:alert(1)//1757800000000.webp", avatar_preset: null, favorite_team: null, updated_at: now });
  auth._reports.set("r-1", { id: "r-1", reporter_id: repData.user.id, target_id: "evil-1", reason: "bio", note: HOSTILE.note, status: "open", created_at: now, resolved_by: null, resolved_at: null, action: null });
  await auth.auth.signInWithPassword({ email: "mod@test.example", password: "Password1" });
  let c = await show9(ModerationQueue, { onOpenProfile: noop });
  await flush();
  assert(c.querySelector(".md-player"), `the queue loaded: ${c.textContent.slice(0, 120)}`);
  assertInert(c, "Reports queue", "https://storage.mock");
  const text = c.textContent;
  assert([HOSTILE.username, HOSTILE.bio, HOSTILE.note, HOSTILE.reporter].every((s) => text.includes(s)), "name, bio, note and reporter show as typed");

  c = await show9(ReportSheet, { username: HOSTILE.username, onClose: noop });
  assertInert(c, "Report sheet", STORAGE_ORIGIN);
  assert(c.querySelector("h2").textContent.includes(HOSTILE.username), "the sheet's title shows the name as text");
  await act(async () => mounted.reactRoot.unmount());
  mounted = null;
});

// ---------- Known gaps ----------
// Printed, not asserted: each needs PROFILES.md 3.4's algorithm (and tests/mock-profile-data.mjs) changed. A gap
// that has since closed isn't printed. Gaps closed so far are asserted in 2f.
{
  const gapDb = await freshDb({ migrations: PROFILE_MIGRATIONS });
  const gaps = [
    ["bios", "a whole-word entry spaced out", [...WORD].join(" ")],
    ["usernames", "a whole-word entry run into another word (camel case)", `${WORD[0].toUpperCase()}${WORD.slice(1)}Please`],
    ["everywhere", "a digit that isn't in the look-alike map (9 for g)", ANYWHERE_DOUBLED.replace(/g/g, "9")],
  ];
  const { rows } = await gapDb.query("select u.n, text_is_clean(u.t) as clean from unnest($1::text[]) with ordinality as u(t, n) order by u.n", [gaps.map((g) => g[2])]);
  const open = gaps.filter((_, i) => rows[i].clean);
  if (open.length) console.log(`  known word-filter gaps still open (${open.length}):`);
  for (const [where, what] of open) console.log(`    - ${where}: ${what}`);
  await gapDb.close();
}

console.log("test-profile-security.mjs done");
