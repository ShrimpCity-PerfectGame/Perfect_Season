// Profile data (PROFILES.md 3.1 and 4.1): supabase/migration-profiles.sql in real Postgres (PGlite, set
// up like a Supabase project by tests/pg-fixture.mjs), the test mock that mirrors it
// (tests/mock-profile-data.mjs), and storage-profile.js driven end to end against that mock. Checks:
//   - row-level security: clients read profile_details, avatar_presets and site_flags, can't read
//     blocked_words, and can't write any of the four directly;
//   - the functions act only on the caller's own row and enforce every limit and error code;
//   - the avatars bucket's policies: your own folder only, uploads named exactly as the app names them,
//     at most 10 files a folder, and no new files while uploads are paused;
//   - check_username, the signup trigger, and player_profile's lookup and JSON shape;
//   - running the migration a second time is harmless;
//   - the mock returns what the SQL returns for the same list of calls;
//   - storage-profile.js's statuses and reasons, its uploads and its clean-up.
// The word filter's own cases are in test-word-filter.mjs.
import { assert, runTest, makeMockAuth } from "./helpers.mjs";
import { freshDb, addAccount, asUser, asAnon, failure, uuid, sql } from "./pg-fixture.mjs";
import { makeProfileData, BLOCKED_WORDS_SEED, AVATAR_FOLDER_LIMIT } from "./mock-profile-data.mjs";
import { playerStats } from "./mock-profile-stats.mjs";
import { FREE_AVATAR_PRESETS, TEAM_CODES, AVATAR_BUCKET, AVATAR_MAX_BYTES, AVATAR_TYPES, emptyPlayerStats, mapPlayerStats } from "../profile-rules.mjs";

const ch = (...codes) => String.fromCodePoint(...codes);
// A blocked word of each kind, taken from the list rather than written out here.
const WORD = BLOCKED_WORDS_SEED.find((b) => b.match === "word").word;
const ANYWHERE = BLOCKED_WORDS_SEED.find((b) => b.match === "anywhere").word;
const DOUBLED = BLOCKED_WORDS_SEED.find((b) => /(.)\1/.test(b.word)).word;
// A doubled letter written three times, and a word in mathematical bold letters.
const stretched = (w) => w.replace(/(.)\1/, "$1$1$1");
const mathBold = (w) => [...w].map((c) => ch(0x1D41A + c.charCodeAt(0) - 97)).join("");
const photo = (uid, n = "1757800000000", ext = "webp") => `${uid}/${n}.${ext}`;
// Sorted keys, so JSON from Postgres and from the mock compare equal regardless of key order.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const db = await freshDb();
const ALICE = uuid(1), BOB = uuid(2);
const HEXY = "abcdef00-0000-4000-8000-0000000000ab"; // an id with letters in it, for case checks
await addAccount(db, { id: ALICE, username: "alice", runs: 3, wins: 40, losses: 11 });
await addAccount(db, { id: BOB, username: "bob" });

// Runs a statement as a role and reports what happened instead of throwing.
async function attempt(who, statement, params) {
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
// One database function call as a player (or signed out, who = null): { data } or { error: code }.
async function call(who, fn, args) {
  const names = Object.keys(args);
  const res = await attempt(who, `select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
  return res.error ? { error: res.error } : { data: res.rows[0].r };
}
const owner = async (statement, params) => (await db.query(statement, params)).rows;

// ---------- Row-level security ----------

await runTest("anyone can read profile_details, avatar_presets and site_flags; nobody can read blocked_words", async () => {
  assert(!(await call(ALICE, "save_profile", { p_bio: "Hello", p_favorite_team: "KC" })).error, "alice saves a bio");
  for (const who of [null, BOB]) {
    const label = who ? "a signed-in player" : "a signed-out visitor";
    const details = await attempt(who, "select * from profile_details");
    assert(details.rows?.some((r) => r.user_id === ALICE && r.bio === "Hello"), `${label} should read profile_details: ${JSON.stringify(details)}`);
    const presets = await attempt(who, "select key, pack, free from avatar_presets order by key");
    assert(presets.rows?.length === FREE_AVATAR_PRESETS.length, `${label} should read all ${FREE_AVATAR_PRESETS.length} presets`);
    const flags = await attempt(who, "select key, enabled from site_flags");
    assert(flags.rows?.some((r) => r.key === "uploads_paused" && r.enabled === false), `${label} should read the uploads_paused flag`);
    const words = await attempt(who, "select * from blocked_words");
    assert(/permission denied/.test(words.error || ""), `${label} must not read blocked_words, got ${JSON.stringify(words).slice(0, 120)}`);
  }
  // The seeds: exactly profile-rules.mjs's free presets, all in the starter pack.
  const presets = await owner("select key, pack, free from avatar_presets order by key");
  const want = FREE_AVATAR_PRESETS.map((p) => p.key).sort();
  assert(same(presets.map((p) => p.key), want) && presets.every((p) => p.pack === "starter" && p.free === true), `presets should be the ${want.length} free starter keys, got ${JSON.stringify(presets)}`);
});

await runTest("clients can't insert, update or delete the new tables directly", async () => {
  const writes = [
    ["insert into profile_details (user_id, bio) values ($1, 'forged')", (uid) => [uid]],
    ["update profile_details set bio = 'forged' where user_id = $1", (uid) => [uid]],
    ["update profile_details set bio = 'forged'", () => []],
    ["delete from profile_details", () => []],
    ["insert into avatar_presets (key, pack, free) values ('forged', 'gold', true)", () => []],
    ["update avatar_presets set free = true", () => []],
    ["delete from avatar_presets", () => []],
    ["insert into blocked_words (word) values ('forged')", () => []],
    ["update blocked_words set match = 'word'", () => []],
    ["delete from blocked_words", () => []],
    ["insert into site_flags (key, enabled) values ('forged', true)", () => []],
    ["update site_flags set enabled = true", () => []],
    ["delete from site_flags", () => []],
  ];
  for (const who of [null, ALICE]) {
    for (const [statement, params] of writes) {
      const res = await attempt(who, statement, params(ALICE));
      // An insert is refused outright; an update or delete finds no row it may touch. Either way, nothing changes.
      assert(res.error || res.affected === 0, `${who ? "alice" : "anon"}: "${statement}" should change nothing, changed ${res.affected}`);
    }
  }
  const details = await owner("select bio from profile_details where user_id = $1", [ALICE]);
  assert(details[0]?.bio === "Hello", "alice's row is untouched");
  assert((await owner("select count(*)::int as n from avatar_presets"))[0].n === FREE_AVATAR_PRESETS.length, "presets untouched");
  assert((await owner("select count(*)::int as n from blocked_words"))[0].n === BLOCKED_WORDS_SEED.length, "word list untouched");
  assert(same(await owner("select key, enabled from site_flags"), [{ key: "uploads_paused", enabled: false }]), "flags untouched");
});

// ---------- The functions ----------

await runTest("a signed-out caller, or a session with no account, gets not_signed_in", async () => {
  for (const who of [null, uuid(99)]) {
    for (const [fn, args] of [["save_profile", { p_bio: "hi", p_favorite_team: null }], ["set_avatar", { p_path: null, p_preset: "crown" }], ["set_avatar", { p_path: null, p_preset: null }]]) {
      const res = await call(who, fn, args);
      assert(res.error === "not_signed_in", `${fn} as ${who || "anon"} should raise not_signed_in, got ${JSON.stringify(res)}`);
    }
  }
  assert((await owner("select count(*)::int as n from profile_details where user_id = $1", [uuid(99)]))[0].n === 0, "no row was created");
});

await runTest("save_profile trims, enforces the length, character, word and team rules, and leaves the picture alone", async () => {
  let res = await call(BOB, "set_avatar", { p_path: null, p_preset: "trophy" });
  assert(res.data?.avatar_preset === "trophy", "bob picks a default avatar first");
  res = await call(BOB, "save_profile", { p_bio: "  Takes a running back in round one  ", p_favorite_team: "NE" });
  assert(same(Object.keys(res.data || {}).sort(), ["avatar_path", "avatar_preset", "bio", "favorite_team", "updated_at", "user_id"]), `returns the details row, got ${JSON.stringify(res)}`);
  assert(res.data.bio === "Takes a running back in round one" && res.data.favorite_team === "NE" && res.data.user_id === BOB, "bio trimmed, team saved");
  assert(res.data.avatar_preset === "trophy", "the picture is left alone");

  const refusals = [
    [{ p_bio: "x".repeat(161), p_favorite_team: null }, "bio_too_long"],
    [{ p_bio: `go ${ch(0x1F3C8).repeat(158)}`, p_favorite_team: null }, "bio_too_long"], // 161 code points
    [{ p_bio: "line one\nline two", p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `flip${ch(0x202E)}ped`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `zero${ch(0x200B)}width`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `line one${ch(0x2028)}line two`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `para one${ch(0x2029)}para two`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `letter${ch(0x61C)}mark`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `old${ch(0x206A)}format`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `old${ch(0x206F)}format`, p_favorite_team: null }, "bio_invalid"],
    [{ p_bio: `a mark at the end${ch(0x61C)}`, p_favorite_team: null }, "bio_invalid"], // not whitespace, so not trimmed
    [{ p_bio: `big ${WORD} energy`, p_favorite_team: null }, "bio_blocked"],
    [{ p_bio: [...ANYWHERE].join("."), p_favorite_team: null }, "bio_blocked"],
    [{ p_bio: `total ${stretched(DOUBLED)}`, p_favorite_team: null }, "bio_blocked"],
    [{ p_bio: mathBold(ANYWHERE), p_favorite_team: null }, "bio_blocked"],
    [{ p_bio: "Fine bio", p_favorite_team: "XYZ" }, "bad_team"],
    [{ p_bio: "Fine bio", p_favorite_team: "kc" }, "bad_team"],
    [{ p_bio: "Fine bio", p_favorite_team: "" }, "bad_team"],
    // Checked in the order PROFILES.md lists them: a long bio with a bad team is too long.
    [{ p_bio: "x".repeat(200), p_favorite_team: "XYZ" }, "bio_too_long"],
  ];
  for (const [args, code] of refusals) {
    const r = await call(BOB, "save_profile", args);
    assert(r.error === code, `save_profile(${JSON.stringify(args).slice(0, 60)}) should raise ${code}, got ${JSON.stringify(r).slice(0, 120)}`);
  }
  const kept = await owner("select bio, favorite_team from profile_details where user_id = $1", [BOB]);
  assert(same(kept, [{ bio: "Takes a running back in round one", favorite_team: "NE" }]), `a refused save changes nothing, got ${JSON.stringify(kept)}`);

  const accepted = [
    [{ p_bio: " " + "x".repeat(160) + "\n", p_favorite_team: null }, "x".repeat(160)], // surrounding whitespace doesn't count
    [{ p_bio: `go ${ch(0x1F3C8).repeat(157)}`, p_favorite_team: null }, `go ${ch(0x1F3C8).repeat(157)}`], // 160 code points
    [{ p_bio: `family ${ch(0x1F468, 0x200D, 0x1F469)}`, p_favorite_team: null }, `family ${ch(0x1F468, 0x200D, 0x1F469)}`], // joiners are fine
    [{ p_bio: `${ch(0xFEFF, 0x3000)}trimmed like trim()${ch(0xA0, 0x2029)}`, p_favorite_team: null }, "trimmed like trim()"],
    [{ p_bio: "Matt Cassel to Titus Dickson in Scunthorpe", p_favorite_team: null }, "Matt Cassel to Titus Dickson in Scunthorpe"],
    [{ p_bio: null, p_favorite_team: null }, ""],
  ];
  for (const [args, bio] of accepted) {
    const r = await call(BOB, "save_profile", args);
    assert(r.data?.bio === bio, `save_profile should store ${JSON.stringify(bio).slice(0, 40)}, got ${JSON.stringify(r).slice(0, 160)}`);
  }
  for (const team of TEAM_CODES) {
    const r = await call(BOB, "save_profile", { p_bio: "", p_favorite_team: team });
    assert(r.data?.favorite_team === team, `${team} should be a valid favorite team, got ${JSON.stringify(r)}`);
  }
  assert((await call(BOB, "save_profile", { p_bio: "", p_favorite_team: null })).data?.favorite_team === null, "null clears the team");
  // Only the caller's own row: alice's is exactly as she left it.
  assert(same(await owner("select bio, favorite_team from profile_details where user_id = $1", [ALICE]), [{ bio: "Hello", favorite_team: "KC" }]), "bob's saves never touch alice's row");
  // The table enforces the same rules if something skips the function.
  assert(/check constraint/.test(await failure(db, "update profile_details set favorite_team = 'XYZ' where user_id = $1", [BOB])), "the table itself refuses a bad team");
  assert(/check constraint/.test(await failure(db, "update profile_details set bio = $2 where user_id = $1", [BOB, "x".repeat(161)])), "the table itself refuses a long bio");
  for (const code of [0x1, 0x2028, 0x2029, 0x61C, 0x206A, 0x206F, 0x202E, 0xFEFF]) {
    const err = await failure(db, "update profile_details set bio = $2 where user_id = $1", [BOB, `a${ch(code)}b`]);
    assert(/profile_details_bio_characters/.test(err), `the table itself refuses U+${code.toString(16).toUpperCase()} in a bio, got ${JSON.stringify(err)}`);
  }
});

await runTest("set_avatar takes a photo in your own folder or a free preset, never both, and clears the other", async () => {
  await owner("insert into avatar_presets (key, pack, free) values ('gold-helmet', 'gold', false) on conflict (key) do nothing");
  const refusals = [
    [{ p_path: photo(ALICE), p_preset: "crown" }, "bad_request"],
    [{ p_path: photo(BOB), p_preset: null }, "bad_path"],
    [{ p_path: "1757800000000.webp", p_preset: null }, "bad_path"],
    [{ p_path: `${ALICE}/sub/1757800000000.webp`, p_preset: null }, "bad_path"],
    [{ p_path: photo(ALICE, "123456789"), p_preset: null }, "bad_path"],
    [{ p_path: photo(ALICE, "12345678901234567"), p_preset: null }, "bad_path"],
    [{ p_path: photo(ALICE, "1757800000000", "gif"), p_preset: null }, "bad_path"],
    [{ p_path: photo(ALICE, "1757800000000", "WEBP"), p_preset: null }, "bad_path"],
    [{ p_path: `${photo(ALICE)}\n`, p_preset: null }, "bad_path"],
    [{ p_path: null, p_preset: "no-such-avatar" }, "bad_preset"],
    [{ p_path: null, p_preset: "gold-helmet" }, "bad_preset"],
  ];
  for (const [args, code] of refusals) {
    const r = await call(ALICE, "set_avatar", args);
    assert(r.error === code, `set_avatar(${JSON.stringify(args)}) should raise ${code}, got ${JSON.stringify(r).slice(0, 120)}`);
  }
  let r = await call(ALICE, "set_avatar", { p_path: photo(ALICE, "1234567890", "png"), p_preset: null });
  assert(r.data?.avatar_path === photo(ALICE, "1234567890", "png") && r.data.avatar_preset === null, `a photo path is set, got ${JSON.stringify(r)}`);
  r = await call(ALICE, "set_avatar", { p_path: photo(ALICE, "1757800000000123"), p_preset: null });
  assert(r.data?.avatar_path === photo(ALICE, "1757800000000123"), "16 digits is fine");
  for (const { key } of FREE_AVATAR_PRESETS) {
    r = await call(ALICE, "set_avatar", { p_path: null, p_preset: key });
    assert(r.data?.avatar_preset === key && r.data.avatar_path === null, `${key} is a free preset that clears the photo, got ${JSON.stringify(r)}`);
  }
  r = await call(ALICE, "set_avatar", { p_path: null, p_preset: null });
  assert(r.data?.avatar_path === null && r.data.avatar_preset === null && r.data.bio === "Hello" && r.data.favorite_team === "KC", `both null clears the picture and keeps the bio, got ${JSON.stringify(r)}`);
  // A first-ever picture creates the row, with an empty bio.
  const carol = uuid(3);
  await addAccount(db, { id: carol, username: "carol" });
  r = await call(carol, "set_avatar", { p_path: null, p_preset: "whistle" });
  assert(r.data?.bio === "" && r.data.favorite_team === null && r.data.avatar_preset === "whistle", `set_avatar creates the row, got ${JSON.stringify(r)}`);
  assert(/check constraint/.test(await failure(db, "update profile_details set avatar_path = $2 where user_id = $1", [carol, photo(ALICE)])), "the table itself refuses a path in someone else's folder");
  // Ids are compared exactly as auth.uid() spells them (lowercase), like isOwnAvatarPath.
  await addAccount(db, { id: HEXY, username: "hexy" });
  r = await call(HEXY, "set_avatar", { p_path: photo(HEXY.toUpperCase()), p_preset: null });
  assert(r.error === "bad_path", `a folder in the wrong case is someone else's, got ${JSON.stringify(r)}`);
  assert((await call(HEXY, "set_avatar", { p_path: photo(HEXY), p_preset: null })).data?.avatar_path === photo(HEXY), "the same folder in the right case is fine");
});

await runTest("check_username answers invalid, taken, blocked or ok, for anyone", async () => {
  const cases = [
    ["ab", "invalid"], ["a".repeat(17), "invalid"], ["has space", "invalid"], ["dash-name", "invalid"], [`na${ch(0xEF)}ve`, "invalid"],
    [null, "invalid"], ["", "invalid"], ["alice", "taken"], ["Alice", "ok"], ["abc", "ok"], ["a".repeat(16), "ok"],
    ["Cassel_2009", "ok"], [`${WORD}_99`, "blocked"], [`xx${ANYWHERE}xx`, "blocked"], [`The_${WORD.toUpperCase()}`, "blocked"],
    [stretched(DOUBLED), "blocked"], [`${stretched(DOUBLED).toUpperCase()}_1`, "blocked"], ["Glasss_Jaw", "ok"], ["Goooal_Line", "ok"],
  ];
  for (const who of [null, BOB]) {
    for (const [name, want] of cases) {
      const r = await call(who, "check_username", { p_username: name });
      assert(r.data === want, `check_username(${JSON.stringify(name)}) as ${who ? "bob" : "anon"} should be ${want}, got ${JSON.stringify(r)}`);
    }
  }
});

await runTest("the signup trigger refuses a username outside the rule or with a blocked word, and creates every other account", async () => {
  const bad = uuid(50), good = uuid(51);
  const err = await failure(db, "insert into auth.users values ($1, $2)", [bad, { username: `xX_${ANYWHERE}_Xx` }]);
  assert(err === "username_blocked", `a blocked username should raise username_blocked, got ${JSON.stringify(err)}`);
  assert((await owner("select count(*)::int as n from auth.users where id = $1", [bad]))[0].n === 0, "no auth user is left behind");
  assert((await owner("select count(*)::int as n from profiles where id = $1", [bad]))[0].n === 0, "no profile is created");
  assert((await failure(db, "insert into auth.users values ($1, $2)", [bad, { username: stretched(DOUBLED) }])) === "username_blocked", "a stretched doubled letter is blocked");
  assert((await failure(db, "insert into auth.users values ($1, $2)", [bad, { username: "has space" }])) === "username_invalid", "a name outside the rule is invalid");
  await owner("insert into auth.users values ($1, $2)", [good, { username: "Hancock_Titus" }]);
  assert((await owner("select username from profiles where id = $1", [good]))[0]?.username === "Hancock_Titus", "a clean username signs up");
});

await runTest("the mock's signup refuses exactly the usernames the signup trigger refuses", async () => {
  const names = ["Glasss_Jaw", "has space", "ab", "a".repeat(17), `na${ch(0xEF)}ve`, "", `${WORD}_99`, stretched(DOUBLED), `${stretched(DOUBLED)}_1`,
    `xX_${ANYWHERE}_Xx`, "Mississippi", "Cockrell_Titus", "alice", mathBold("alice")];
  const auth = makeMockAuth();
  auth._profiles.set("existing-alice", { id: "existing-alice", username: "alice" });
  let n = 0;
  for (const username of [...names, undefined, 12]) {
    const id = uuid(600 + n++);
    const sqlErr = await failure(db, "insert into auth.users values ($1, $2)", [id, username === undefined ? {} : { username }]);
    const { error } = await auth.auth.signUp({ email: `signup${n}@example.com`, password: "Password1", options: { data: { username } } });
    const sqlSays = sqlErr === "" ? "ok" : /username_(invalid|blocked)/.test(sqlErr) ? "refused" : /duplicate|unique/.test(sqlErr) ? "taken" : sqlErr;
    const mockSays = !error ? "ok" : error.status === 500 && error.message === "Database error saving new user" ? "refused" : error.code === "23505" ? "taken" : JSON.stringify(error);
    assert(sqlSays === mockSays, `signup as ${JSON.stringify(username)}: the trigger says ${sqlSays}, the mock says ${mockSays}`);
    await auth.auth.signOut();
  }
});

await runTest("player_profile: an exact name, else a case-insensitive one only when exactly one account matches", async () => {
  await addAccount(db, { id: uuid(5), username: "Morgan" });
  await addAccount(db, { id: uuid(6), username: "dana" });
  await addAccount(db, { id: uuid(7), username: "Dana" });
  const lookups = [["Morgan", uuid(5)], ["morgan", uuid(5)], ["MORGAN", uuid(5)], ["dana", uuid(6)], ["Dana", uuid(7)], ["DANA", null],
    ["nobody_here", null], ["", null], [null, null], ["alice", ALICE]];
  for (const who of [null, BOB]) {
    for (const [name, id] of lookups) {
      const r = await call(who, "player_profile", { p_username: name });
      assert(!r.error && (r.data?.profile?.id ?? null) === id, `player_profile(${JSON.stringify(name)}) should find ${id}, got ${JSON.stringify(r).slice(0, 120)}`);
      if (!id) assert(r.data === null, `no match is null, got ${JSON.stringify(r.data)}`);
    }
  }
});

await runTest("player_profile returns the whole profiles row, the details row or null, and player_stats", async () => {
  let r = await call(null, "player_profile", { p_username: "Morgan" });
  assert(same(Object.keys(r.data).sort(), ["details", "profile", "stats"]), `keys are profile, details, stats: ${Object.keys(r.data || {})}`);
  const row = (await owner("select to_jsonb(p) as p from profiles p where id = $1", [uuid(5)]))[0].p;
  assert(same(r.data.profile, row), "profile is every column of the profiles row");
  assert(r.data.details === null, "no details row reads as null");
  const stats = (await owner("select player_stats($1) as s", [uuid(5)]))[0].s;
  assert(same(r.data.stats, stats), "stats is player_stats(id)");
  assert(same(Object.keys(r.data.stats).sort(), Object.keys(emptyPlayerStats()).sort()), "stats has player_stats' shape");

  r = await call(null, "player_profile", { p_username: "alice" });
  const details = (await owner("select to_jsonb(d) as d from profile_details d where user_id = $1", [ALICE]))[0].d;
  assert(same(r.data.details, details) && same(Object.keys(details).sort(), ["avatar_path", "avatar_preset", "bio", "favorite_team", "updated_at", "user_id"]), `details is the saved row, got ${JSON.stringify(r.data.details)}`);
  assert(r.data.profile.wins === 40 && r.data.profile.username === "alice", "the profile row carries the account's stats");
});

// ---------- Storage ----------

const avatarFile = (uid, n) => photo(uid, `17578000000${String(n).padStart(2, "0")}`);
const insertFile = (who, name, bucket = "avatars") => attempt(who, "insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]);

await runTest("avatar files: a player can add, see, change and delete files only in their own folder, named as the app names them", async () => {
  await owner("insert into storage.buckets (id, name) values ('other', 'other') on conflict (id) do nothing");
  assert(!(await insertFile(ALICE, avatarFile(ALICE, 1))).error, "alice adds a file to her own folder");
  assert(!(await insertFile(BOB, avatarFile(BOB, 1))).error, "bob adds a file to his");
  for (const [name, bucket, why] of [[avatarFile(BOB, 2), "avatars", "someone else's folder"], ["1757800000001.webp", "avatars", "no folder"],
    [avatarFile(ALICE, 3), "other", "another bucket"]]) {
    const r = await insertFile(ALICE, name, bucket);
    assert(/row-level security/.test(r.error || ""), `alice must not add a file in ${why}, got ${JSON.stringify(r)}`);
  }
  // Only "<her id>/<10-16 digits>.webp|jpg|png": no subfolder, and nothing else for a name.
  for (const name of [`${ALICE}/sub/1757800000004.webp`, `${ALICE}/1757800000004.webp/1757800000005.webp`, `${ALICE}//1757800000004.webp`,
    photo(ALICE, "123456789"), photo(ALICE, "12345678901234567"), photo(ALICE, "1757800000004", "gif"), photo(ALICE, "1757800000004", "WEBP"),
    `${photo(ALICE, "1757800000004")}.png`, `${photo(ALICE, "1757800000004")}\n`, `${ALICE}/1757800000004`, `${ALICE}/x1757800000004.webp`,
    `${ALICE}/avatar.webp`, `${ALICE}/.webp`, `${ALICE} /1757800000004.webp`]) {
    const r = await insertFile(ALICE, name);
    assert(/row-level security/.test(r.error || ""), `alice must not add ${JSON.stringify(name)}, got ${JSON.stringify(r)}`);
  }
  assert(!(await insertFile(ALICE, photo(ALICE, "1234567890", "png"))).error && !(await insertFile(ALICE, photo(ALICE, "1234567890123456", "jpg"))).error, "10 and 16 digits, PNG and JPEG, are fine");
  await owner("delete from storage.objects where name in ($1, $2)", [photo(ALICE, "1234567890", "png"), photo(ALICE, "1234567890123456", "jpg")]);
  // A file already in a subfolder of hers (put there before this rule) is still hers to see and delete.
  await owner("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${ALICE}/sub/1757800000004.webp`]);

  const seen = await attempt(ALICE, "select name from storage.objects order by name");
  assert(seen.rows.length === 2 && seen.rows.every((o) => o.name.startsWith(`${ALICE}/`)), `alice sees only her own files, got ${JSON.stringify(seen.rows)}`);
  const anonSeen = await attempt(null, "select name from storage.objects");
  assert(anonSeen.rows.length === 0, "a signed-out visitor sees none through the table (the bucket is public by address instead)");

  let r = await attempt(ALICE, "update storage.objects set metadata = '{\"size\": 1}' where name = $1", [avatarFile(ALICE, 1)]);
  assert(r.affected === 1, `alice updates her own file, got ${JSON.stringify(r)}`);
  r = await attempt(ALICE, "update storage.objects set metadata = '{\"size\": 1}' where name = $1", [avatarFile(BOB, 1)]);
  assert(r.affected === 0 && !r.error, "alice can't update bob's file");
  r = await attempt(ALICE, "update storage.objects set name = $2 where name = $1", [avatarFile(ALICE, 1), avatarFile(BOB, 9)]);
  assert(/row-level security/.test(r.error || ""), `alice can't move her file into bob's folder, got ${JSON.stringify(r)}`);
  r = await attempt(ALICE, "update storage.objects set name = $2 where name = $1", [avatarFile(ALICE, 1), `${ALICE}/sub/1757800000001.webp`]);
  assert(/row-level security/.test(r.error || ""), `nor rename it to a name an upload couldn't have, got ${JSON.stringify(r)}`);
  r = await attempt(ALICE, "delete from storage.objects where name = $1", [avatarFile(BOB, 1)]);
  assert(r.affected === 0, "alice can't delete bob's file");
  r = await attempt(null, "delete from storage.objects");
  assert(r.affected === 0, "a signed-out visitor can't delete anything");
  assert(/row-level security/.test((await insertFile(null, avatarFile(ALICE, 5))).error || ""), "a signed-out visitor can't upload");
  r = await attempt(ALICE, "delete from storage.objects where name = $1", [`${ALICE}/sub/1757800000004.webp`]);
  assert(r.affected === 1, "alice deletes her own file, the old one in a subfolder too");
  assert((await owner("select count(*)::int as n from storage.objects where name = $1", [avatarFile(BOB, 1)]))[0].n === 1, "bob's file survived");
});

await runTest("a player's avatars folder holds at most 10 files: the 11th upload is refused until one is deleted", async () => {
  const pat = uuid(40), sam = uuid(41);
  await addAccount(db, { id: pat, username: "pat" });
  await addAccount(db, { id: sam, username: "sam" });
  for (let n = 1; n <= 10; n++) assert(!(await insertFile(pat, avatarFile(pat, n))).error, `pat's upload ${n} fits`);
  let r = await insertFile(pat, avatarFile(pat, 11));
  assert(/row-level security/.test(r.error || ""), `the 11th is refused, got ${JSON.stringify(r)}`);
  r = await attempt(pat, "insert into storage.objects (bucket_id, name) values ('avatars', $1) on conflict (bucket_id, name) do update set metadata = '{\"x\": 1}'", [avatarFile(pat, 1)]);
  assert(/row-level security/.test(r.error || ""), `an upsert over one of the ten still counts as adding, got ${JSON.stringify(r)}`);
  assert((await attempt(pat, "update storage.objects set metadata = '{\"size\": 3}' where name = $1", [avatarFile(pat, 2)])).affected === 1, "a full folder's files can still be changed");
  assert(!(await insertFile(sam, avatarFile(sam, 1))).error, "another player's folder isn't affected");
  assert((await attempt(pat, "delete from storage.objects where name = $1", [avatarFile(pat, 3)])).affected === 1, "pat deletes one");
  assert(!(await insertFile(pat, avatarFile(pat, 11))).error, "and there's room for one more");
  // Anything under the folder counts, even a file named in a way an upload can't be now.
  await owner("delete from storage.objects where name = $1", [avatarFile(pat, 11)]);
  await owner("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${pat}/sub/1757800000099.webp`]);
  assert(/row-level security/.test((await insertFile(pat, avatarFile(pat, 12))).error || ""), "an old file in a subfolder takes a place too");
  assert((await owner("select count(*)::int as n from storage.objects where name like $1", [`${pat}/%`]))[0].n === 10, "pat's folder never went past 10");
  // The policy's helper: the uploading player must be able to run it (the policy calls it as them); signed-out visitors can't.
  const [fn] = await owner(`select p.prosecdef, has_function_privilege('authenticated', p.oid, 'execute') as authed, has_function_privilege('anon', p.oid, 'execute') as anon
                              from pg_proc p where p.proname = 'avatar_folder_has_room'`);
  assert(fn && fn.prosecdef === false && fn.authed === true && fn.anon === false, `avatar_folder_has_room is security invoker, executable by authenticated only: ${JSON.stringify(fn)}`);
  assert((await call(pat, "avatar_folder_has_room", {})).data === false && (await call(sam, "avatar_folder_has_room", {})).data === true, "it answers for the caller's own folder");
});

await runTest("while uploads are paused nobody can add or replace a file, but can still see and delete their own", async () => {
  const flag = (on) => owner("update site_flags set enabled = $1 where key = 'uploads_paused'", [on]);
  await flag(true);
  try {
    assert(/row-level security/.test((await insertFile(BOB, avatarFile(BOB, 7))).error || ""), "no new file while paused");
    const replace = await attempt(ALICE, "update storage.objects set metadata = '{\"size\": 2}' where name = $1", [avatarFile(ALICE, 1)]);
    assert(/row-level security/.test(replace.error || ""), `no replacing a file while paused, got ${JSON.stringify(replace)}`);
    const seen = await attempt(ALICE, "select name from storage.objects where name = $1", [avatarFile(ALICE, 1)]);
    assert(seen.rows.length === 1, "reading still works");
    const del = await attempt(BOB, "delete from storage.objects where name = $1", [avatarFile(BOB, 1)]);
    assert(del.affected === 1, "deleting your own file still works");
    // The functions don't depend on the switch: choosing a default avatar still works.
    assert((await call(BOB, "set_avatar", { p_path: null, p_preset: "crown" })).data?.avatar_preset === "crown", "presets still work while paused");
  } finally {
    await flag(false);
  }
  assert(!(await insertFile(BOB, avatarFile(BOB, 7))).error, "uploads work again once unpaused");
});

await runTest("the avatars bucket is public, 256 KB, WebP/JPEG/PNG only", async () => {
  const [bucket] = await owner("select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1", [AVATAR_BUCKET]);
  assert(bucket?.public === true && Number(bucket.file_size_limit) === AVATAR_MAX_BYTES, `bucket public with a ${AVATAR_MAX_BYTES}-byte limit, got ${JSON.stringify(bucket)}`);
  assert(same([...bucket.allowed_mime_types].sort(), [...AVATAR_TYPES].sort()), `mime types ${bucket.allowed_mime_types}`);
});

// ---------- The mock ----------

await runTest("the mock returns what the SQL returns for the same calls", async () => {
  const ONE = uuid(30), TWO = uuid(31);
  await addAccount(db, { id: ONE, username: "parity_one" });
  await addAccount(db, { id: TWO, username: "Parity_Two" });
  await addAccount(db, { id: uuid(32), username: "parity_two" });
  await owner("insert into avatar_presets (key, pack, free) values ('gold-helmet', 'gold', false) on conflict (key) do nothing");

  // The mock starts from exactly what the database holds now: every account (lookups see them all),
  // every details row, and the paid preset.
  let current = null;
  const state = { profiles: new Map(), runs: new Map(), dailyRuns: new Map(), souRuns: new Map(), builds: new Map(), currentUserId: () => current, isModerator: () => false };
  for (const { p } of await owner("select to_jsonb(p) as p from profiles p")) state.profiles.set(p.id, p);
  const mock = makeProfileData(state, { playerStats });
  for (const { d } of await owner("select to_jsonb(d) as d from profile_details d")) mock.tables.profile_details.set(d.user_id, { ...d });
  mock.tables.avatar_presets.set("gold-helmet", { key: "gold-helmet", pack: "gold", free: false });
  const mockCall = (who, fn, args) => {
    current = who;
    try {
      return { data: mock.rpcs[fn](args) };
    } catch (e) {
      return { error: e.message };
    } finally {
      current = null;
    }
  };
  // updated_at is the clock at the moment of saving - the one field the two can't share.
  const comparable = (res) => {
    const strip = (d) => (d && typeof d === "object" && "updated_at" in d && "user_id" in d ? { ...d, updated_at: "(time)" } : d);
    const data = res.data && typeof res.data === "object" && "profile" in res.data ? { ...res.data, details: strip(res.data.details) } : strip(res.data);
    return res.error ? { error: res.error } : { data };
  };

  const calls = [
    [null, "save_profile", { p_bio: "hi", p_favorite_team: "KC" }],
    [uuid(99), "save_profile", { p_bio: "hi", p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: "  Hello there  ", p_favorite_team: "KC" }],
    [ONE, "save_profile", { p_bio: "x".repeat(161), p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: ` ${"x".repeat(160)}\t`, p_favorite_team: "SF" }],
    [ONE, "save_profile", { p_bio: `go ${ch(0x1F3C8).repeat(157)}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `go ${ch(0x1F3C8).repeat(158)}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: "line one\nline two", p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `flip${ch(0x202E)}ped`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `line${ch(0x2028)}two`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `letter${ch(0x61C)}mark`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `old${ch(0x206C)}format`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `${ch(0x2028)}separators at the ends are trimmed${ch(0x2029)}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `so ${stretched(DOUBLED)}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: mathBold(ANYWHERE), p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `Glasss jaw, ${ch(0x1D5D5, 0x1D5EE, 0x1D601)} and ${ch(0x24D5, 0x24D0, 0x24DD)}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `family ${ch(0x1F468, 0x200D, 0x1F469)}`, p_favorite_team: "WAS" }],
    [ONE, "save_profile", { p_bio: `${ch(0xFEFF, 0x3000)}trimmed${ch(0xA0, 0x2029)}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `what a ${[...ANYWHERE].join(" ")}`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: `${WORD.toUpperCase()}!`, p_favorite_team: null }],
    [ONE, "save_profile", { p_bio: "Cassel to Dickson", p_favorite_team: "kc" }],
    [ONE, "save_profile", { p_bio: "Cassel to Dickson", p_favorite_team: "" }],
    [ONE, "save_profile", { p_bio: "Cassel to Dickson", p_favorite_team: "NYJ" }],
    [TWO, "save_profile", { p_bio: null, p_favorite_team: null }],
    [ONE, "set_avatar", { p_path: photo(ONE), p_preset: "crown" }],
    [ONE, "set_avatar", { p_path: photo(TWO), p_preset: null }],
    [ONE, "set_avatar", { p_path: `${ONE}/sub/1757800000000.webp`, p_preset: null }],
    [ONE, "set_avatar", { p_path: photo(ONE, "123456789"), p_preset: null }],
    [ONE, "set_avatar", { p_path: photo(ONE, "12345678901234567"), p_preset: null }],
    [ONE, "set_avatar", { p_path: photo(ONE, "1757800000000", "gif"), p_preset: null }],
    [ONE, "set_avatar", { p_path: `${photo(ONE)}\n`, p_preset: null }],
    [HEXY, "set_avatar", { p_path: photo(HEXY.toUpperCase()), p_preset: null }],
    [HEXY, "set_avatar", { p_path: photo(HEXY, "1757800000001", "png"), p_preset: null }],
    [ONE, "set_avatar", { p_path: photo(ONE, "1234567890", "jpg"), p_preset: null }],
    [ONE, "set_avatar", { p_path: null, p_preset: "no-such-avatar" }],
    [ONE, "set_avatar", { p_path: null, p_preset: "gold-helmet" }],
    [ONE, "set_avatar", { p_path: null, p_preset: "football" }],
    [TWO, "set_avatar", { p_path: photo(TWO), p_preset: null }],
    [ONE, "set_avatar", { p_path: null, p_preset: null }],
    [null, "set_avatar", { p_path: null, p_preset: null }],
    [null, "check_username", { p_username: "parity_one" }],
    [null, "check_username", { p_username: "Parity_One" }],
    [null, "check_username", { p_username: "ab" }],
    [null, "check_username", { p_username: "has space" }],
    [null, "check_username", { p_username: "a".repeat(17) }],
    [null, "check_username", { p_username: null }],
    [null, "check_username", { p_username: `${WORD}_lord_99` }],
    [TWO, "check_username", { p_username: `${ANYWHERE.toUpperCase()}1` }],
    [TWO, "check_username", { p_username: "Hancock_Cassel" }],
    [null, "check_username", { p_username: stretched(DOUBLED) }],
    [null, "check_username", { p_username: "Goooal_Line" }],
    [null, "player_profile", { p_username: "parity_one" }],
    [null, "player_profile", { p_username: "PARITY_ONE" }],
    [null, "player_profile", { p_username: "Parity_Two" }],
    [null, "player_profile", { p_username: "PARITY_TWO" }],
    [null, "player_profile", { p_username: "alice" }],
    [ONE, "player_profile", { p_username: "bob" }],
    [null, "player_profile", { p_username: "nobody_here" }],
    [null, "player_profile", { p_username: null }],
  ];
  for (const [who, fn, args] of calls) {
    const fromSql = comparable(await call(who, fn, args));
    const fromMock = comparable(mockCall(who, fn, args));
    assert(same(fromSql, fromMock), `${fn}(${JSON.stringify(args).slice(0, 80)}) as ${who || "anon"}: sql ${JSON.stringify(fromSql).slice(0, 200)} vs mock ${JSON.stringify(fromMock).slice(0, 200)}`);
  }
  // And both end up holding the same rows.
  const sqlRows = (await owner("select to_jsonb(d) as d from profile_details d")).map(({ d }) => ({ ...d, updated_at: null }));
  const mockRows = [...mock.tables.profile_details.values()].map((d) => ({ ...d, updated_at: null }));
  const byId = (a, b) => (a.user_id < b.user_id ? -1 : 1);
  assert(same(sqlRows.sort(byId), mockRows.sort(byId)), "profile_details ends up the same in both");
});

// ---------- Re-running the migration ----------

await runTest("running the migration a second time is harmless", async () => {
  await owner("update site_flags set enabled = true where key = 'uploads_paused'");
  await owner("update blocked_words set match = 'anywhere' where word = $1", [WORD]);
  await owner("insert into blocked_words (word, match) values ('ownersaddition', 'word')");
  const before = {
    details: await owner("select * from profile_details order by user_id"),
    presets: await owner("select * from avatar_presets order by key"),
    policies: await owner("select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('objects', 'profile_details', 'avatar_presets', 'site_flags', 'blocked_words') order by 1, 2"),
    grants: await owner("select has_function_privilege('anon', 'public.text_is_clean(text)', 'execute') as a, has_function_privilege('authenticated', 'public.check_username(text)', 'execute') as b"),
  };
  await db.exec(sql("migration-runs-log.sql")); // the deploy order re-runs this first
  await db.exec(sql("migration-profiles.sql"));
  assert((await owner("select enabled from site_flags where key = 'uploads_paused'"))[0].enabled === true, "re-running must not switch uploads back on");
  assert((await owner("select match from blocked_words where word = $1", [WORD]))[0].match === "anywhere", "an owner's change to a seeded word survives");
  assert((await owner("select count(*)::int as n from blocked_words where word = 'ownersaddition'"))[0].n === 1, "an owner's added word survives");
  assert((await owner("select count(*)::int as n from blocked_words"))[0].n === BLOCKED_WORDS_SEED.length + 1, "no seeded word is duplicated");
  assert(same(await owner("select * from profile_details order by user_id"), before.details), "details rows are untouched");
  assert(same(await owner("select * from avatar_presets order by key"), before.presets), "presets are unchanged");
  assert(same(await owner("select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('objects', 'profile_details', 'avatar_presets', 'site_flags', 'blocked_words') order by 1, 2"), before.policies), "the same policies, once each");
  assert(same(await owner("select has_function_privilege('anon', 'public.text_is_clean(text)', 'execute') as a, has_function_privilege('authenticated', 'public.check_username(text)', 'execute') as b"), before.grants) && before.grants[0].a === false && before.grants[0].b === true, "grants and revokes are the same");
  // Still working afterwards.
  assert((await call(ALICE, "save_profile", { p_bio: "Still here", p_favorite_team: "KC" })).data?.bio === "Still here", "save_profile still works");
  assert((await call(null, "check_username", { p_username: `${WORD}zz` })).data === "blocked", "the edited word now matches anywhere");
  await owner("update site_flags set enabled = false where key = 'uploads_paused'");
  await owner("update blocked_words set match = 'word' where word = $1", [WORD]);
  await owner("delete from blocked_words where word = 'ownersaddition'");
});

await runTest("re-running the migration over the first version's bio rule replaces it, and fixes a bio the new rule refuses", async () => {
  // The first version of this migration had the character rule as an unnamed column check, with a shorter list.
  const OLD_RULE = "U&'[\\0001-\\001F\\007F-\\009F\\200B\\200E\\200F\\202A-\\202E\\2060-\\2064\\2066-\\2069\\FEFF]'";
  await db.exec(`alter table public.profile_details drop constraint profile_details_bio_characters;
                 alter table public.profile_details add check (bio !~ ${OLD_RULE});`);
  const bioChecks = async () => (await owner(`select conname from pg_constraint where conrelid = 'public.profile_details'::regclass and contype = 'c'
                                                and pg_get_constraintdef(oid) like '%bio%' order by conname`)).map((r) => r.conname);
  assert(same(await bioChecks(), ["profile_details_bio_check", "profile_details_bio_check1"]), `the old rule gets the first version's name: ${await bioChecks()}`);
  // Saved under the old rule: a line separator and an Arabic letter mark inside, one at an end.
  await owner("update profile_details set bio = $2 where user_id = $1", [ALICE, `Line one${ch(0x2028)}line two${ch(0x61C)}${ch(0x206A)}`]);
  await db.exec(sql("migration-profiles.sql"));
  assert(same(await bioChecks(), ["profile_details_bio_characters", "profile_details_bio_check"]), `the new rule replaces the old one: ${await bioChecks()}`);
  assert((await owner("select bio from profile_details where user_id = $1", [ALICE]))[0].bio === "Line one line two", "each refused character became a space, and the ends were trimmed");
  assert(/profile_details_bio_characters/.test(await failure(db, "update profile_details set bio = $2 where user_id = $1", [ALICE, `a${ch(0x2029)}b`])), "the new rule is enforced");
  await db.exec(sql("migration-profiles.sql"));
  assert(same(await bioChecks(), ["profile_details_bio_characters", "profile_details_bio_check"]), "and a third run changes nothing");
});

await db.close();

// ---------- storage-profile.js, end to end against the mock ----------

const auth = makeMockAuth();
globalThis.window = globalThis.window || {};
window.__ps_supabase__ = auth;
const P = await import("../storage-profile.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// Upload names are the current millisecond (avatarObjectPath), so two real uploads never share one.
const nextMs = () => new Promise((resolve) => setTimeout(resolve, 2));
const blob = (bytes, type = "image/webp") => new Blob([new Uint8Array(bytes)], { type });

// A client that behaves like the mock except where a test overrides one call, and records every rpc.
function install(overrides = {}) {
  const calls = [];
  const client = Object.create(auth);
  client.rpc = (name, args, opts) => {
    calls.push({ name, args, opts });
    return overrides.rpc?.[name] ? overrides.rpc[name](args, opts) : auth.rpc(name, args, opts);
  };
  client.storage = {
    from(bucket) {
      const real = auth.storage.from(bucket);
      return {
        ...real,
        upload: (...a) => { calls.push({ name: "upload", args: a }); return overrides.upload ? overrides.upload(real, ...a) : real.upload(...a); },
        remove: (paths) => { calls.push({ name: "remove", args: paths }); return overrides.remove ? overrides.remove(paths) : real.remove(paths); },
        list: (...a) => { calls.push({ name: "list", args: a }); return real.list(...a); },
      };
    },
  };
  window.__ps_supabase__ = client;
  return calls;
}
const restore = () => { window.__ps_supabase__ = auth; };
async function signUp(n, username) {
  const { data } = await auth.auth.signUp({ email: `p${n}@example.com`, password: "Password1", options: { data: { username } } });
  return data.user.id;
}
const signIn = (n) => auth.auth.signInWithPassword({ email: `p${n}@example.com`, password: "Password1" });
const objectsIn = (uid) => [...auth._storageObjects.values()].filter((o) => o.path.startsWith(`${uid}/`)).map((o) => o.path);

const ME = await signUp(1, "shrimpcity");
const OTHER = await signUp(2, "otherguy");
await signIn(1);

await runTest("fetchPlayerProfile: ok for an exact or unambiguous name, missing otherwise, error when the read fails", async () => {
  let res = await P.fetchPlayerProfile("shrimpcity");
  assert(res.status === "ok" && res.profile.id === ME && res.profile.username === "shrimpcity", `exact name, got ${JSON.stringify(res).slice(0, 120)}`);
  assert(res.profile.joined === auth._profiles.get(ME).created_at && res.profile.joined, "joined is created_at");
  assert(same(res.profile.details, { bio: "", avatarPath: null, avatarUrl: null, avatarPreset: null, favoriteTeam: null, updatedAt: null }), "no details row maps to empty details");
  assert(res.profile.stats.username === "shrimpcity" && res.profile.stats.id === ME && res.profile.stats.runs === 0, "stats is rowToProfile");
  assert(same(res.profile.extra, mapPlayerStats(emptyPlayerStats())), "extra is mapPlayerStats(player_stats)");
  res = await P.fetchPlayerProfile("ShrimpCity");
  assert(res.status === "ok" && res.profile.username === "shrimpcity", "a unique case-insensitive match gives the stored name");
  auth._profiles.set("twin-1", { id: "twin-1", username: "Twin", runs: 0 });
  auth._profiles.set("twin-2", { id: "twin-2", username: "twin", runs: 0 });
  assert((await P.fetchPlayerProfile("TWIN")).status === "missing", "an ambiguous name is missing");
  assert((await P.fetchPlayerProfile("twin")).profile?.id === "twin-2", "an exact name still wins");
  for (const name of ["nobody_here", "", null, undefined, 42]) assert((await P.fetchPlayerProfile(name)).status === "missing", `${JSON.stringify(name)} is missing`);

  let calls = install();
  await P.fetchPlayerProfile("shrimpcity");
  assert(calls[0].name === "player_profile" && calls[0].opts?.get === true, "player_profile is read with GET, so supabase-js retries it");
  for (const broken of [
    () => Promise.resolve({ data: null, error: { message: "TypeError: fetch failed", details: "", hint: "", code: "" } }),
    () => Promise.reject(new Error("offline")),
    () => { throw new Error("sync failure"); },
    () => Promise.resolve({ data: { details: null }, error: null }),
  ]) {
    install({ rpc: { player_profile: broken } });
    const r = await P.fetchPlayerProfile("shrimpcity");
    assert(r.status === "error", `a failed or malformed read is an error, got ${JSON.stringify(r)}`);
  }
  restore();
});

await runTest("fetchProfileDetails: the saved details, empty details for none saved, null when it can't load", async () => {
  auth._profileDetails.set(ME, { user_id: ME, bio: "Hi", avatar_path: `${ME}/1757800000000.webp`, avatar_preset: null, favorite_team: "KC", updated_at: "2026-09-14T10:00:00.000Z" });
  const d = await P.fetchProfileDetails(ME);
  assert(same(d, { bio: "Hi", avatarPath: `${ME}/1757800000000.webp`, avatarUrl: `https://storage.mock/avatars/${ME}/1757800000000.webp`, avatarPreset: null, favoriteTeam: "KC", updatedAt: "2026-09-14T10:00:00.000Z" }), `mapped details, got ${JSON.stringify(d)}`);
  assert(same(await P.fetchProfileDetails(OTHER), P.mapDetails(null)), "a player with no row gets empty details");
  assert((await P.fetchProfileDetails(null)) === null, "no user id is null");
  const client = Object.create(auth);
  client.from = () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) });
  window.__ps_supabase__ = client;
  assert((await P.fetchProfileDetails(ME)) === null, "a failed read is null");
  client.from = () => { throw new Error("offline"); };
  assert((await P.fetchProfileDetails(ME)) === null, "a thrown error is null");
  restore();
  auth._profileDetails.delete(ME);
  assert(P.avatarUrl(null) === null && P.avatarUrl("") === null && P.avatarUrl(`${ME}/1.webp`) === `https://storage.mock/avatars/${ME}/1.webp`, "avatarUrl");
});

await runTest("saveProfile: saves and returns the details, or says too_long, blocked, invalid, signed_out or network", async () => {
  let calls = install();
  let res = await P.saveProfile({ bio: "  Takes a running back\n in round one  ", favoriteTeam: "KC" });
  assert(res.ok && res.details.bio === "Takes a running back in round one" && res.details.favoriteTeam === "KC", `saved, got ${JSON.stringify(res)}`);
  assert(auth._profileDetails.get(ME)?.bio === "Takes a running back in round one", "the mock row holds it");
  assert(calls[0].name === "save_profile" && !calls[0].opts?.get, "a save is a POST, sent once");
  calls = install();
  res = await P.saveProfile({ bio: "x".repeat(161), favoriteTeam: null });
  assert(!res.ok && res.reason === "too_long" && calls.length === 0, "too long is answered without a request");
  res = await P.saveProfile({ bio: "Fine", favoriteTeam: "XYZ" });
  assert(!res.ok && res.reason === "invalid" && calls.length === 0, "a bad team is answered without a request");
  restore();
  res = await P.saveProfile({ bio: `total ${WORD}`, favoriteTeam: null });
  assert(!res.ok && res.reason === "blocked", `a blocked word, got ${JSON.stringify(res)}`);
  res = await P.saveProfile({ bio: "", favoriteTeam: "" });
  assert(res.ok && res.details.favoriteTeam === null && res.details.bio === "", "empty clears both");
  for (const odd of [undefined, null, {}]) {
    res = await P.saveProfile(odd);
    assert(res.ok === true, `saveProfile(${JSON.stringify(odd)}) saves an empty profile instead of throwing, got ${JSON.stringify(res)}`);
  }
  const serverSays = { bio_too_long: "too_long", bio_blocked: "blocked", bio_invalid: "invalid", bad_team: "invalid", not_signed_in: "signed_out", something_new: "network" };
  for (const [code, reason] of Object.entries(serverSays)) {
    install({ rpc: { save_profile: () => Promise.resolve({ data: null, error: { message: code, code: "P0001", details: null, hint: null } }) } });
    res = await P.saveProfile({ bio: "Fine", favoriteTeam: null });
    assert(!res.ok && res.reason === reason, `the database's ${code} is ${reason}, got ${JSON.stringify(res)}`);
  }
  for (const [error, reason, status] of [
    [{ message: "JWT expired", code: "PGRST301", details: null, hint: null }, "signed_out", 401],
    [{ message: "TypeError: fetch failed", code: "", details: "", hint: "" }, "network", 0],
    [{ message: "An invalid response was received from the upstream server", code: "" }, "network", 502],
  ]) {
    install({ rpc: { save_profile: () => Promise.resolve({ data: null, error, status }) } });
    res = await P.saveProfile({ bio: "Fine", favoriteTeam: null });
    assert(!res.ok && res.reason === reason, `${error.message} is ${reason}, got ${JSON.stringify(res)}`);
  }
  install({ rpc: { save_profile: () => Promise.reject(new Error("offline")) } });
  assert((await P.saveProfile({ bio: "Fine" })).reason === "network", "a rejected request is network");
  restore();
  await auth.auth.signOut();
  res = await P.saveProfile({ bio: "Fine", favoriteTeam: null });
  assert(!res.ok && res.reason === "signed_out", `signed out, got ${JSON.stringify(res)}`);
  await signIn(1);
});

await runTest("saveAvatarPhoto uploads to your folder, switches to it, deletes the old photo, and cleans up when it can't", async () => {
  let calls = install();
  let res = await P.saveAvatarPhoto(ME, blob(1200), null);
  assert(res.ok && new RegExp(`^${ME}/\\d{13}\\.webp$`).test(res.details.avatarPath), `uploaded to the player's folder, got ${JSON.stringify(res)}`);
  assert(res.details.avatarUrl === `https://storage.mock/avatars/${res.details.avatarPath}` && res.details.avatarPreset === null, "details carry the public address");
  const upload = calls.find((c) => c.name === "upload");
  assert(upload.args[2].upsert === false && upload.args[2].cacheControl === "31536000" && upload.args[2].contentType === "image/webp", `upload options, got ${JSON.stringify(upload.args[2])}`);
  const setCall = calls.find((c) => c.name === "set_avatar");
  assert(setCall && !setCall.opts?.get && calls.indexOf(upload) < calls.indexOf(setCall), "uploads first, then set_avatar as a POST");
  const first = res.details.avatarPath;
  assert(same(objectsIn(ME), [first]) && auth._storageObjects.get(`avatars/${first}`).contentType === "image/webp", "the file is stored with its type");

  await nextMs();
  res = await P.saveAvatarPhoto(ME, blob(900, "image/jpeg"), first);
  await tick();
  assert(res.ok && res.details.avatarPath.endsWith(".jpg") && same(objectsIn(ME), [res.details.avatarPath]), `the previous photo is deleted after the switch, left ${JSON.stringify(objectsIn(ME))}`);
  const second = res.details.avatarPath;

  // Reasons answered before uploading anything.
  for (const [b, reason, label] of [[blob(100, "image/gif"), "type", "a GIF"], [blob(0), "type", "an empty file"], [null, "type", "no file"],
    [{ type: "image/webp" }, "type", "a file with no size"], [blob(AVATAR_MAX_BYTES + 1), "too_large", "over 256 KB"]]) {
    calls = install();
    res = await P.saveAvatarPhoto(ME, b, second);
    assert(!res.ok && res.reason === reason && !calls.some((c) => c.name === "upload"), `${label} is ${reason} without uploading, got ${JSON.stringify(res)}`);
  }
  await nextMs();
  assert((await P.saveAvatarPhoto(ME, blob(AVATAR_MAX_BYTES), second)).ok, "exactly 256 KB is fine");
  const third = auth._profileDetails.get(ME).avatar_path;
  await tick();

  calls = install();
  res = await P.saveAvatarPhoto(OTHER, blob(100), null);
  assert(!res.ok && res.reason === "signed_out" && !calls.some((c) => c.name === "upload"), `another player's id is signed_out, got ${JSON.stringify(res)}`);
  res = await P.saveAvatarPhoto(null, blob(100), null);
  assert(!res.ok && res.reason === "signed_out", "no user id is signed_out");
  restore();

  // The kill switch.
  auth._siteFlags.get("uploads_paused").enabled = true;
  res = await P.saveAvatarPhoto(ME, blob(100), third);
  auth._siteFlags.get("uploads_paused").enabled = false;
  assert(!res.ok && res.reason === "paused", `paused uploads say paused, got ${JSON.stringify(res)}`);
  assert(same(objectsIn(ME), [third]) && auth._profileDetails.get(ME).avatar_path === third, "nothing uploaded or changed while paused");

  // set_avatar refusing after the upload: the new file is deleted, the old one kept.
  for (const [failure, reason] of [
    [() => Promise.resolve({ data: null, error: { message: "bad_path", code: "P0001" } }), "invalid"],
    [() => Promise.resolve({ data: null, error: { message: "not_signed_in", code: "P0001" } }), "signed_out"],
    [() => Promise.resolve({ data: null, error: { message: "TypeError: fetch failed", code: "" } }), "network"],
    [() => Promise.reject(new Error("offline")), "network"],
  ]) {
    calls = install({ rpc: { set_avatar: failure } });
    await nextMs();
    res = await P.saveAvatarPhoto(ME, blob(100), third);
    await tick();
    const uploaded = calls.find((c) => c.name === "upload")?.args[0];
    assert(!res.ok && res.reason === reason, `set_avatar failing is ${reason}, got ${JSON.stringify(res)}`);
    assert(uploaded && calls.some((c) => c.name === "remove" && c.args.includes(uploaded)) && same(objectsIn(ME), [third]), `the new file is deleted and the old one kept, left ${JSON.stringify(objectsIn(ME))}`);
  }

  // Storage errors in the shapes storage-js returns.
  for (const [error, reason] of [
    [{ name: "StorageApiError", status: 400, statusCode: "413", code: "EntityTooLarge", message: "The object exceeded the maximum allowed size" }, "too_large"],
    [{ name: "StorageApiError", status: 413, statusCode: "413", message: "Payload too large" }, "too_large"],
    [{ name: "StorageApiError", status: 400, statusCode: "415", code: "InvalidMimeType", message: "mime type image/webp is not supported" }, "type"],
    // Refused with uploads on, a session, and no leftovers to clear: nothing the player can fix but trying again.
    [{ name: "StorageApiError", status: 400, statusCode: "403", code: "AccessDenied", message: "new row violates row-level security policy" }, "network"],
    [{ name: "StorageApiError", status: 400, statusCode: "400", code: "InvalidJWT", message: "exp claim timestamp check failed" }, "signed_out"],
    [{ name: "StorageApiError", status: 409, statusCode: "409", code: "KeyAlreadyExists", message: "The resource already exists" }, "network"],
    [{ name: "StorageUnknownError", message: "Failed to fetch" }, "network"],
  ]) {
    calls = install({ upload: () => Promise.resolve({ data: null, error }) });
    res = await P.saveAvatarPhoto(ME, blob(100), third);
    assert(!res.ok && res.reason === reason && !calls.some((c) => c.name === "set_avatar"), `${error.message} is ${reason}, got ${JSON.stringify(res)}`);
  }
  install({ upload: () => Promise.reject(new TypeError("Failed to fetch")) });
  assert((await P.saveAvatarPhoto(ME, blob(100), third)).reason === "network", "a thrown upload is network");
  // Refused because the session went away between the check and the upload: signed_out.
  let sessionChecks = 0;
  calls = install({ upload: () => Promise.resolve({ data: null, error: { name: "StorageApiError", status: 400, statusCode: "403", code: "AccessDenied", message: "new row violates row-level security policy" } }) });
  window.__ps_supabase__.auth = { ...auth.auth, getSession: async () => (sessionChecks++ === 0 ? auth.auth.getSession() : { data: { session: null }, error: null }) };
  res = await P.saveAvatarPhoto(ME, blob(100), third);
  assert(!res.ok && res.reason === "signed_out" && same(objectsIn(ME), [third]), `a session lost mid-upload is signed_out, got ${JSON.stringify(res)}`);
  // A token refresh that can't reach the server isn't a sign-out: the upload is tried, and fails as network.
  calls = install({ upload: () => Promise.resolve({ data: null, error: { name: "StorageUnknownError", message: "Failed to fetch" } }) });
  window.__ps_supabase__.auth = { ...auth.auth, getSession: async () => ({ data: { session: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } }) };
  res = await P.saveAvatarPhoto(ME, blob(100), third);
  assert(!res.ok && res.reason === "network" && calls.some((c) => c.name === "upload"), `an offline session check is network, got ${JSON.stringify(res)}`);
  restore();

  // A previous path outside your own folder is never deleted, even for someone whose storage policy would allow it.
  auth._storageObjects.set(`avatars/${OTHER}/1757800000000.webp`, { bucket: "avatars", path: `${OTHER}/1757800000000.webp`, contentType: "image/webp", size: 10, owner: OTHER });
  auth._moderators.set(ME, { user_id: ME, added_at: new Date().toISOString() });
  await nextMs();
  res = await P.saveAvatarPhoto(ME, blob(100), `${OTHER}/1757800000000.webp`);
  await tick();
  auth._moderators.delete(ME);
  assert(res.ok && auth._storageObjects.has(`avatars/${OTHER}/1757800000000.webp`), "someone else's file survives");
});

await runTest("the mock's avatars bucket follows the storage policies: exact names, your own folder, at most 10 files", async () => {
  const bucket = auth.storage.from(AVATAR_BUCKET);
  const refused = async (path, label) => {
    const r = await bucket.upload(path, blob(10), { contentType: "image/webp" });
    assert(r.error?.statusCode === "403" && r.error.code === "AccessDenied", `${label} is refused like the policy refuses it, got ${JSON.stringify(r)}`);
  };
  await refused(`${ME}/sub/1757800000000.webp`, "a subfolder");
  await refused(`${ME}/123456789.webp`, "a short number");
  await refused(`${ME}/avatar.webp`, "any other name");
  await refused(`${OTHER}/1757800000000.webp`, "someone else's folder");
  for (const path of objectsIn(ME)) auth._storageObjects.delete(`avatars/${path}`);
  for (let n = 0; n < AVATAR_FOLDER_LIMIT; n++) assert(!(await bucket.upload(`${ME}/17570000001${String(n).padStart(2, "0")}.webp`, blob(10), { contentType: "image/webp" })).error, `upload ${n + 1} fits`);
  await refused(`${ME}/1757000000199.webp`, `upload ${AVATAR_FOLDER_LIMIT + 1}`);
  const listed = await bucket.list(ME);
  assert(!listed.error && listed.data.length === AVATAR_FOLDER_LIMIT && listed.data.every((f) => f.id && /^\d{13}\.webp$/.test(f.name)), `list shows the folder's files by name: ${JSON.stringify(listed).slice(0, 200)}`);
  await auth.auth.signOut();
  assert((await bucket.list(ME)).data.length === 0, "a signed-out visitor lists nothing");
  await signIn(1);
  for (const path of objectsIn(ME)) auth._storageObjects.delete(`avatars/${path}`);
});

await runTest("a full folder: saveAvatarPhoto clears out the leftovers, keeping the current photo, and tries once more", async () => {
  const put = (path) => auth._storageObjects.set(`avatars/${path}`, { bucket: "avatars", path, contentType: "image/webp", size: 10, owner: ME });
  const fill = (current) => {
    for (const path of objectsIn(ME)) auth._storageObjects.delete(`avatars/${path}`);
    put(current);
    auth._profileDetails.set(ME, { ...auth._profileDetails.get(ME), avatar_path: current, avatar_preset: null });
    const leftovers = Array.from({ length: AVATAR_FOLDER_LIMIT - 1 }, (_, i) => `${ME}/17560000000${String(i).padStart(2, "0")}.webp`);
    leftovers.forEach(put);
    return leftovers;
  };
  const current = `${ME}/1755000000000.webp`;
  let leftovers = fill(current);
  let calls = install();
  await nextMs();
  let res = await P.saveAvatarPhoto(ME, blob(100), current);
  await tick();
  assert(res.ok, `the photo is saved once the leftovers are gone, got ${JSON.stringify(res)}`);
  assert(calls.filter((c) => c.name === "upload").length === 2 && calls.some((c) => c.name === "list"), "refused, listed, then uploaded again");
  const cleared = calls.find((c) => c.name === "remove").args;
  assert(same([...cleared].sort(), [...leftovers].sort()), `exactly the leftovers were cleared, not the current photo: ${JSON.stringify(cleared)}`);
  assert(same(objectsIn(ME), [res.details.avatarPath]), `then the replaced photo went too, leaving only the new one: ${JSON.stringify(objectsIn(ME))}`);

  // Full, and the leftovers won't delete: no second upload, and the refusal reads as something to retry.
  leftovers = fill(current);
  calls = install({ remove: () => Promise.resolve({ data: [], error: null }) });
  res = await P.saveAvatarPhoto(ME, blob(100), current);
  assert(!res.ok && res.reason === "network" && calls.filter((c) => c.name === "upload").length === 1, `a folder that can't be cleared is network, got ${JSON.stringify(res)}`);
  assert(objectsIn(ME).length === AVATAR_FOLDER_LIMIT, "nothing was added");

  // Full while uploads are paused: paused, and nothing is deleted.
  auth._siteFlags.get("uploads_paused").enabled = true;
  calls = install();
  res = await P.saveAvatarPhoto(ME, blob(100), current);
  auth._siteFlags.get("uploads_paused").enabled = false;
  assert(!res.ok && res.reason === "paused" && !calls.some((c) => c.name === "remove" || c.name === "list"), `paused, got ${JSON.stringify(res)}`);
  restore();
  // Back to one photo, the current picture, which the tests after this start from.
  for (const path of objectsIn(ME)) auth._storageObjects.delete(`avatars/${path}`);
  await nextMs();
  assert((await P.saveAvatarPhoto(ME, blob(100), null)).ok, "a fresh photo to carry on with");
});

await runTest("setAvatarPreset and removeAvatar switch the picture and delete the photo they replace", async () => {
  const current = auth._profileDetails.get(ME).avatar_path;
  assert(current && objectsIn(ME).includes(current), "starts with a photo");
  let calls = install();
  let res = await P.setAvatarPreset("crown", current);
  await tick();
  assert(res.ok && res.details.avatarPreset === "crown" && res.details.avatarPath === null && res.details.avatarUrl === null, `preset set, got ${JSON.stringify(res)}`);
  assert(!objectsIn(ME).includes(current) && calls.some((c) => c.name === "remove"), "the replaced photo is deleted");
  restore();
  for (const bad of ["no-such-avatar", "", null, undefined, 7]) {
    res = await P.setAvatarPreset(bad, null);
    assert(!res.ok && res.reason === "invalid", `${JSON.stringify(bad)} is invalid, got ${JSON.stringify(res)}`);
  }
  auth._avatarPresets.set("gold-helmet", { key: "gold-helmet", pack: "gold", free: false });
  assert((await P.setAvatarPreset("gold-helmet", null)).reason === "invalid", "a paid preset is invalid");

  await nextMs();
  const photoRes = await P.saveAvatarPhoto(ME, blob(100), null);
  res = await P.removeAvatar(photoRes.details.avatarPath);
  await tick();
  assert(res.ok && res.details.avatarPath === null && res.details.avatarPreset === null && !objectsIn(ME).includes(photoRes.details.avatarPath), `picture removed and file deleted, got ${JSON.stringify(res)}`);
  assert(res.details.bio === auth._profileDetails.get(ME).bio, "the bio is kept");

  // Nothing is deleted when the change fails, or when the previous path isn't the player's.
  auth._storageObjects.set(`avatars/${ME}/1757800000999.webp`, { bucket: "avatars", path: `${ME}/1757800000999.webp`, contentType: "image/webp", size: 10, owner: ME });
  install({ rpc: { set_avatar: () => Promise.resolve({ data: null, error: { message: "TypeError: fetch failed", code: "" } }) } });
  res = await P.setAvatarPreset("crown", `${ME}/1757800000999.webp`);
  assert(!res.ok && res.reason === "network" && objectsIn(ME).includes(`${ME}/1757800000999.webp`), "a failed switch keeps the photo");
  install({ rpc: { set_avatar: () => Promise.reject(new Error("offline")) } });
  assert((await P.removeAvatar(`${ME}/1757800000999.webp`)).reason === "network", "a rejected request is network");
  restore();
  res = await P.removeAvatar("not/a/real/path.webp");
  assert(res.ok, "a junk previous path is ignored");
  await auth.auth.signOut();
  assert((await P.setAvatarPreset("crown", null)).reason === "signed_out", "signed out preset");
  assert((await P.removeAvatar(null)).reason === "signed_out", "signed out remove");
  await signIn(1);
});

await runTest("checkUsername: ok, taken, blocked or invalid, and null when it can't check", async () => {
  let calls = install();
  assert((await P.checkUsername("shrimpcity")) === "taken", "taken");
  assert(calls[0].name === "check_username" && calls[0].opts?.get === true, "read with GET");
  assert((await P.checkUsername("Shrimp_City_2")) === "ok", "ok");
  assert((await P.checkUsername(`${WORD}_99`)) === "blocked", "blocked");
  calls = install();
  for (const bad of ["ab", "has space", "a".repeat(17), "", null]) assert((await P.checkUsername(bad)) === "invalid", `${JSON.stringify(bad)} is invalid`);
  assert(calls.length === 0, "an invalid name is answered without a request");
  for (const broken of [() => Promise.resolve({ data: null, error: { message: "boom" } }), () => Promise.reject(new Error("offline")), () => Promise.resolve({ data: "maybe", error: null })]) {
    install({ rpc: { check_username: broken } });
    assert((await P.checkUsername("fresh_name")) === null, "null when it can't check");
  }
  restore();
});

console.log("test-profile-data.mjs done");
