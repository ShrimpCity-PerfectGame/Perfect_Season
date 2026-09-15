// Reports and moderation (PROFILES.md 3.3, 4.2 and 6.4), checked three ways:
//   - supabase/migration-moderation.sql in real Postgres (PGlite, tests/pg-fixture.mjs): who can call what,
//     that no client can touch reports or moderators directly, every refusal and limit of report_player,
//     every mod_act action and its effects, and the moderator storage policies;
//   - the test mock (tests/mock-moderation.mjs, as tests/mock-supabase.mjs wires it) against that SQL for one
//     shared sequence of calls, so every jsdom test that reports or moderates is testing what the database does;
//   - storage-moderation.js's handling of real PostgREST answers, and the screens (moderation.jsx) in jsdom.
import { freshDb, addAccount, asUser, asAnon, uuid, sql } from "./pg-fixture.mjs";
import { assert, runTest, setupDom, makeMockAuth, loadModule, renderComponent, click, type, flush } from "./helpers.mjs";

// A made-up word for the word filter to refuse, added to the real blocked_words list (and the mock's).
const BLOCKED = "snarfblat";
const USERNAME_RULE = "Usernames are 3 to 16 characters: letters, numbers, and underscores.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// jsonb and the mock order an object's keys differently.
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

async function moderationDb() {
  const db = await freshDb();
  await db.exec(`insert into public.blocked_words (word, match) values ('${BLOCKED}', 'word') on conflict do nothing;`);
  return db;
}

const NAMES = ["alice", "bob", "carol", "dave", "erin"];
const ID = Object.fromEntries(NAMES.map((name, i) => [name, uuid(i + 1)]));
// Every SQL test starts from the same five accounts, alice the moderator. Deleting the auth users cascades to
// everything else (profiles, reports, moderators, details, runs), which is much quicker than a new database.
async function fresh(db) {
  await db.exec("delete from storage.objects; delete from auth.users;");
  for (const name of NAMES) await addAccount(db, { id: ID[name], username: name });
  await db.exec("insert into moderators (user_id) select id from profiles where username = 'alice';"); // the runbook's line
}
// One statement as a signed-in player (their id) or signed out (null): { data, rows } or { error: "<message>" }.
async function run(db, uid, statement, params = []) {
  const go = async () => {
    try {
      const { rows } = await db.query(statement, params);
      return { data: rows[0] ? Object.values(rows[0])[0] : null, rows };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  };
  return uid ? asUser(db, uid, go) : asAnon(db, go);
}
const report = (db, uid, username, reason, note = "") => run(db, uid, "select report_player($1, $2, $3)", [username, reason, note]);
const act = (db, uid, target, action, name = null) => run(db, uid, "select mod_act($1, $2, $3)", [target, action, name]);
const queueFor = (db, uid) => run(db, uid, "select mod_queue()");
const describe = (v) => JSON.stringify(v, (k, x) => (k === "rows" ? undefined : x));

const db = await moderationDb();

await runTest("the migration installs after migration-profiles.sql, re-runs cleanly, and declares what the contract says", async () => {
  await fresh(db);
  assert(!(await report(db, ID.carol, "bob", "bio")).error, "a first report goes in");
  await db.exec(sql("migration-moderation.sql"));
  await db.exec(sql("migration-moderation.sql"));
  const kept = (await db.query("select (select count(*)::int from reports) as reports, (select count(*)::int from moderators) as moderators")).rows[0];
  assert(kept.reports === 1 && kept.moderators === 1, `re-running keeps reports and moderators, got ${JSON.stringify(kept)}`);

  const fns = (await db.query(`select proname, provolatile, prosecdef, proconfig from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('is_moderator', 'report_player', 'mod_queue', 'mod_act')`)).rows;
  // The two that only read are stable, so the app calls them as GET and gets supabase-js's retry.
  const volatility = { is_moderator: "s", mod_queue: "s", report_player: "v", mod_act: "v" };
  assert(fns.length === 4, `each function defined once, got ${fns.map((f) => f.proname)}`);
  for (const f of fns) {
    assert(f.prosecdef === true, `${f.proname} is security definer`);
    assert(f.provolatile === volatility[f.proname], `${f.proname}: volatility ${f.provolatile}, expected ${volatility[f.proname]}`);
    assert(String(f.proconfig).includes("search_path=public"), `${f.proname} sets search_path = public, got ${f.proconfig}`);
  }
  const tables = (await db.query(`select c.relname, c.relrowsecurity,
      (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('reports', 'moderators')`)).rows;
  assert(tables.length === 2 && tables.every((t) => t.relrowsecurity && t.policies === 0), `reports and moderators: RLS on, no policies - got ${JSON.stringify(tables)}`);
  const unique = (await db.query("select indexdef from pg_indexes where schemaname = 'public' and tablename = 'reports' and indexdef ilike 'create unique%' and indexdef ilike '%where%'")).rows.map((r) => r.indexdef);
  assert(unique.length === 1 && /\(reporter_id, target_id, reason\)/.test(unique[0]) && /status = 'open'/.test(unique[0]), `one unique index over open reports, got ${unique}`);
});

await runTest("only moderators can read the queue or act: players and signed-out visitors get not_moderator", async () => {
  await fresh(db);
  await report(db, ID.carol, "bob", "bio", "rude");
  const isMod = async (uid) => (await run(db, uid, "select is_moderator()")).data;
  assert((await isMod(ID.alice)) === true && (await isMod(ID.bob)) === false && (await isMod(null)) === false, "is_moderator is true for alice only");
  for (const [uid, who] of [[ID.bob, "a player"], [ID.carol, "the reporter"], [null, "a signed-out visitor"]]) {
    const q = await queueFor(db, uid);
    assert(q.error === "not_moderator", `${who} can't read the queue: ${describe(q)}`);
    for (const action of ["remove_picture", "clear_bio", "rename", "dismiss", "explode"]) {
      const res = await act(db, uid, ID.bob, action, "new_name");
      assert(res.error === "not_moderator", `${who}'s ${action} gets not_moderator, got ${describe(res)}`);
    }
  }
  const q = await queueFor(db, ID.alice);
  assert(Array.isArray(q.data) && q.data.length === 1, `the moderator reads the queue: ${describe(q)}`);
  const still = (await db.query("select (select username from profiles where id = $1) as name, (select status from reports) as status", [ID.bob])).rows[0];
  assert(still.name === "bob" && still.status === "open", "none of the refused calls changed anything");
  await db.exec("delete from moderators where user_id = (select id from profiles where username = 'alice')");
  assert((await queueFor(db, ID.alice)).error === "not_moderator" && (await act(db, ID.alice, ID.bob, "dismiss")).error === "not_moderator", "a removed moderator loses the queue and the actions");
});

await runTest("no client can read or write reports or moderators directly, a moderator included", async () => {
  await fresh(db);
  await report(db, ID.carol, "bob", "bio", "rude");
  for (const [uid, who] of [[ID.bob, "a player"], [ID.alice, "a moderator"], [null, "a signed-out visitor"]]) {
    for (const table of ["reports", "moderators"]) {
      const read = await run(db, uid, `select count(*)::int from ${table}`);
      assert(read.data === 0, `${who} reads nothing from ${table}: ${describe(read)}`);
    }
    const addReport = await run(db, uid, "insert into reports (reporter_id, target_id, reason) values ($1, $2, 'other')", [ID.dave, ID.erin]);
    assert(/row-level security/.test(addReport.error || ""), `${who} can't insert a report: ${describe(addReport)}`);
    const addModerator = await run(db, uid, "insert into moderators (user_id) values ($1)", [uid || ID.dave]);
    assert(/row-level security/.test(addModerator.error || ""), `${who} can't make anyone a moderator: ${describe(addModerator)}`);
    for (const statement of ["update reports set status = 'dismissed' returning id", "delete from reports returning id", "delete from moderators returning user_id"]) {
      const res = await run(db, uid, statement);
      assert(res.rows?.length === 0, `${who}: "${statement}" touches nothing, got ${describe(res)}`);
    }
  }
  const after = (await db.query("select (select count(*)::int from reports where status = 'open') as open, (select count(*)::int from moderators) as mods")).rows[0];
  assert(after.open === 1 && after.mods === 1, `the report and the moderator are untouched: ${JSON.stringify(after)}`);
});

await runTest("report_player refuses signed out, no such player, self, a bad reason, a long note and duplicates", async () => {
  await fresh(db);
  const refused = async (uid, username, reason, note, code, why) => {
    const res = await report(db, uid, username, reason, note);
    assert(res.error === code, `${why}: expected ${code}, got ${describe(res)}`);
  };
  await refused(null, "bob", "bio", "", "not_signed_in", "signed out");
  await refused(ID.carol, "nobody", "bio", "", "no_such_player", "an unknown username");
  await refused(ID.carol, "BOB", "bio", "", "no_such_player", "the username in another case (exact match only)");
  await refused(ID.carol, null, "bio", "", "no_such_player", "no username");
  await refused(ID.bob, "bob", "bio", "", "self", "reporting yourself");
  await refused(ID.carol, "bob", "spam", "", "bad_reason", "a reason that isn't one of the four");
  await refused(ID.carol, "bob", null, "", "bad_reason", "no reason");
  await refused(ID.carol, "bob", "bio", "x".repeat(201), "note_too_long", "a 201-character note");
  assert((await db.query("select count(*)::int as n from reports")).rows[0].n === 0, "no refusal wrote a report");

  // The note is trimmed before it's measured, and measured in characters (code points), like char_length.
  assert(!(await report(db, ID.carol, "bob", "bio", ` \t${"x".repeat(200)}\r\n `)).error, "200 characters with whitespace around them is fine");
  assert(!(await report(db, ID.carol, "bob", "picture", "😀".repeat(200))).error, "200 emoji are 200 characters");
  assert(!(await report(db, ID.carol, "bob", "other", null)).error, "the note is optional");
  const notes = Object.fromEntries((await db.query("select reason, note from reports")).rows.map((r) => [r.reason, r.note]));
  assert(notes.bio === "x".repeat(200) && notes.picture === "😀".repeat(200) && notes.other === "", `notes are stored trimmed: ${JSON.stringify(notes).slice(0, 120)}`);

  await refused(ID.carol, "bob", "bio", "again", "duplicate", "the same reporter, player and reason while it's open");
  assert(!(await report(db, ID.dave, "bob", "bio")).error, "someone else can report the same thing");
  assert(!(await report(db, ID.carol, "dave", "bio")).error, "the same reporter and reason about another player");
  assert(!(await act(db, ID.alice, ID.bob, "dismiss")).error, "a moderator dismisses bob's reports");
  assert(!(await report(db, ID.carol, "bob", "bio", "it's back")).error, "once resolved, the same report can be made again");
});

await runTest("report_player allows 10 reports per reporter in any 24 hours, resolved ones included, before checking duplicates", async () => {
  await fresh(db);
  const targets = Array.from({ length: 11 }, (_, i) => ({ id: uuid(100 + i), username: `target${i}` }));
  for (const t of targets) await addAccount(db, t);
  // Older than 24 hours: not counted.
  for (const t of targets.slice(0, 3)) {
    await db.query("insert into reports (reporter_id, target_id, reason, created_at) values ($1, $2, 'other', now() - interval '25 hours')", [ID.erin, t.id]);
  }
  // Nine in the last 24 hours, three of them already dismissed.
  for (const [i, t] of targets.slice(0, 9).entries()) {
    await db.query("insert into reports (reporter_id, target_id, reason, status, created_at) values ($1, $2, 'bio', $3, now() - interval '23 hours')", [ID.erin, t.id, i < 3 ? "dismissed" : "open"]);
  }
  assert(!(await report(db, ID.erin, "target9", "bio")).error, "the 10th report in 24 hours goes in");
  const eleventh = await report(db, ID.erin, "target10", "bio");
  assert(eleventh.error === "limit", `the 11th gets limit: ${describe(eleventh)}`);
  const duplicate = await report(db, ID.erin, "target5", "bio");
  assert(duplicate.error === "limit", `at the limit, a duplicate also gets limit (limit is checked first): ${describe(duplicate)}`);
  assert(!(await report(db, ID.dave, "target10", "bio")).error, "the limit is per reporter");
  await db.query("update reports set created_at = created_at - interval '2 hours' where reporter_id = $1 and created_at < now() - interval '22 hours'", [ID.erin]);
  assert(!(await report(db, ID.erin, "target10", "bio")).error, "once they're more than 24 hours old, reports stop counting");
});

await runTest("mod_queue groups open reports by player, oldest first, with each player's picture, bio and reporters - and the mock agrees", async () => {
  await fresh(db);
  const photo = `${ID.bob}/1757800000000.webp`;
  await db.query("insert into profile_details (user_id, bio, avatar_path, favorite_team) values ($1, 'Hello there', $2, 'KC')", [ID.bob, photo]);
  await db.query("insert into profile_details (user_id, avatar_preset) values ($1, 'trophy')", [ID.carol]);
  // Fixed times and ids, to pin both tiebreaks: bob and carol share their oldest time (so username decides),
  // and two of bob's reports share a time (so id decides).
  const rid = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
  const at = (hour) => new Date(Date.UTC(2026, 8, 13, hour)).toISOString();
  const rows = [
    [rid(10), "erin", "bob", "picture", "", "open", at(10)],
    [rid(20), "carol", "dave", "other", "Spamming the daily board", "open", at(9)],
    [rid(30), "erin", "carol", "username", "", "open", at(10)],
    [rid(40), "dave", "bob", "bio", "mean bio", "open", at(11)],
    [rid(5), "carol", "bob", "other", "", "open", at(10)],
    [rid(50), "bob", "erin", "bio", "", "dismissed", at(8)],
  ];
  for (const [id, from, to, reason, note, status, created] of rows) {
    await db.query("insert into reports (id, reporter_id, target_id, reason, note, status, created_at) values ($1, $2, $3, $4, $5, $6, $7)", [id, ID[from], ID[to], reason, note, status, created]);
  }
  const q = (await queueFor(db, ID.alice)).data;
  assert(q.map((p) => p.username).join() === "dave,bob,carol", `players by oldest open report, then username: ${q.map((p) => p.username)}`);
  const bob = q[1];
  assert(bob.reports.map((r) => r.id).join() === [rid(5), rid(10), rid(40)].join(), `bob's reports by time, then id: ${bob.reports.map((r) => r.id)}`);
  assert(JSON.stringify(Object.keys(bob).sort()) === JSON.stringify(["avatar_path", "avatar_preset", "bio", "favorite_team", "reports", "user_id", "username"]), `entry keys: ${Object.keys(bob)}`);
  assert(JSON.stringify(Object.keys(bob.reports[0]).sort()) === JSON.stringify(["created_at", "id", "note", "reason", "reporter"]), `report keys: ${Object.keys(bob.reports[0])}`);
  assert(bob.user_id === ID.bob && bob.avatar_path === photo && bob.avatar_preset === null && bob.bio === "Hello there" && bob.favorite_team === "KC", `bob's details: ${JSON.stringify(bob)}`);
  assert(bob.reports[2].reporter === "dave" && bob.reports[2].note === "mean bio" && bob.reports[2].reason === "bio", "each report carries its reporter's username, note and reason");
  assert(q[2].avatar_preset === "trophy" && q[2].bio === "" && q[2].avatar_path === null, "carol: a default avatar, no bio");
  assert(q[0].bio === "" && q[0].avatar_path === null && q[0].avatar_preset === null && q[0].favorite_team === null, "dave never saved a profile: an empty bio and no picture");
  assert(!q.some((p) => p.username === "erin"), "resolved reports aren't listed");

  // The same rows through the mock.
  const mock = makeMockAuth();
  const { data } = await mock.auth.signUp({ email: "alice@test.example", password: "Password1", options: { data: { username: "alice" } } });
  mock._moderators.set(data.user.id, { user_id: data.user.id, added_at: at(1) });
  for (const name of NAMES.slice(1)) mock._profiles.set(ID[name], { id: ID[name], username: name });
  mock._profileDetails.set(ID.bob, { user_id: ID.bob, bio: "Hello there", avatar_path: photo, avatar_preset: null, favorite_team: "KC", updated_at: at(1) });
  mock._profileDetails.set(ID.carol, { user_id: ID.carol, bio: "", avatar_path: null, avatar_preset: "trophy", favorite_team: null, updated_at: at(1) });
  for (const [id, from, to, reason, note, status, created] of rows) {
    mock._reports.set(id, { id, reporter_id: ID[from], target_id: ID[to], reason, note, status, created_at: created, resolved_by: null, resolved_at: null, action: null });
  }
  const times = (list) => JSON.stringify(sortKeys(list), (k, v) => (k === "created_at" ? Date.parse(v) : v));
  const mockQ = (await mock.rpc("mod_queue")).data;
  assert(times(q) === times(mockQ), `the mock's queue differs from the SQL's:\n sql  ${times(q)}\n mock ${times(mockQ)}`);
});

await runTest("mod_act: remove_picture, clear_bio and dismiss change what they say and resolve only the reports they answer", async () => {
  await fresh(db);
  const photo = `${ID.bob}/1757800000000.webp`;
  await db.query("insert into profile_details (user_id, bio, avatar_path, favorite_team) values ($1, 'Hello there', $2, 'KC')", [ID.bob, photo]);
  await db.query("insert into profile_details (user_id, avatar_preset) values ($1, 'trophy')", [ID.carol]);
  for (const [from, reason] of [["carol", "picture"], ["dave", "bio"], ["erin", "username"], ["carol", "other"]]) {
    assert(!(await report(db, ID[from], "bob", reason)).error, `${from} reports bob's ${reason}`);
  }
  assert(!(await report(db, ID.dave, "carol", "picture")).error, "dave reports carol's picture");

  assert((await act(db, ID.alice, ID.bob, "delete_account")).error === "bad_action", "an unknown action gets bad_action");
  assert((await act(db, ID.alice, ID.bob, null)).error === "bad_action", "no action gets bad_action");
  assert((await act(db, ID.alice, uuid(999), "dismiss")).error === "no_such_player", "an unknown player gets no_such_player");
  assert((await act(db, ID.alice, null, "remove_picture")).error === "no_such_player", "no player gets no_such_player");

  const reportsOn = async (uid) => Object.fromEntries((await db.query("select reason, status, action, resolved_by, resolved_at from reports where target_id = $1", [uid])).rows.map((r) => [r.reason, r]));
  const detailsOf = async (uid) => (await db.query("select bio, avatar_path, avatar_preset, favorite_team from profile_details where user_id = $1", [uid])).rows[0] || null;
  const resolved = (r, status, action) => r.status === status && r.action === action && r.resolved_by === ID.alice && r.resolved_at instanceof Date;
  const untouched = (r) => r.status === "open" && r.action === null && r.resolved_by === null && r.resolved_at === null;

  const removed = await act(db, ID.alice, ID.bob, "remove_picture");
  assert(removed.data?.ok === true && removed.data.removed_path === photo, `remove_picture returns the old path: ${describe(removed)}`);
  assert(JSON.stringify(await detailsOf(ID.bob)) === JSON.stringify({ bio: "Hello there", avatar_path: null, avatar_preset: null, favorite_team: "KC" }), `only the picture is cleared: ${JSON.stringify(await detailsOf(ID.bob))}`);
  let bob = await reportsOn(ID.bob);
  assert(resolved(bob.picture, "actioned", "remove_picture"), `the picture report is actioned by alice: ${JSON.stringify(bob.picture)}`);
  assert(untouched(bob.bio) && untouched(bob.username) && untouched(bob.other), "the other reports stay open");
  const again = await act(db, ID.alice, ID.bob, "remove_picture");
  assert(again.data?.ok === true && again.data.removed_path === null, `with no picture left it still succeeds, with no path: ${describe(again)}`);
  const preset = await act(db, ID.alice, ID.carol, "remove_picture");
  assert(preset.data?.removed_path === null && (await detailsOf(ID.carol)).avatar_preset === null, "a default avatar is cleared too, with no file to delete");
  assert(resolved((await reportsOn(ID.carol)).picture, "actioned", "remove_picture"), "and carol's picture report is actioned");

  assert(!(await act(db, ID.alice, ID.bob, "clear_bio")).error, "clear_bio succeeds");
  assert(JSON.stringify(await detailsOf(ID.bob)) === JSON.stringify({ bio: "", avatar_path: null, avatar_preset: null, favorite_team: "KC" }), "clear_bio empties the bio and nothing else");
  bob = await reportsOn(ID.bob);
  assert(resolved(bob.bio, "actioned", "clear_bio") && untouched(bob.username) && untouched(bob.other), "only the bio report is resolved");
  assert(!(await act(db, ID.alice, ID.dave, "clear_bio")).error && (await detailsOf(ID.dave)) === null, "a player who never saved a profile doesn't get a details row out of it");

  const pictureResolvedAt = bob.picture.resolved_at.getTime();
  await sleep(5);
  assert(!(await act(db, ID.alice, ID.bob, "dismiss")).error, "dismiss succeeds");
  bob = await reportsOn(ID.bob);
  assert(resolved(bob.username, "dismissed", "dismiss") && resolved(bob.other, "dismissed", "dismiss"), `dismiss resolves every open report as dismissed: ${JSON.stringify(bob)}`);
  assert(resolved(bob.picture, "actioned", "remove_picture") && bob.picture.resolved_at.getTime() === pictureResolvedAt, "reports resolved earlier keep how and when");
  assert(!(await act(db, ID.alice, ID.dave, "dismiss")).error, "dismissing a player with no reports is harmless");
  assert(JSON.stringify((await queueFor(db, ID.alice)).data) === "[]", "the queue is empty");
});

await runTest("mod_act rename refuses invalid, taken and blocked names, and renames the player everywhere their name is stored", async () => {
  await fresh(db);
  await report(db, ID.carol, "bob", "username", "rude");
  await report(db, ID.dave, "bob", "bio");
  await db.query("insert into runs (user_id, username, ladder) values ($1, 'bob', 'unlimited'), ($2, 'carol', 'gm')", [ID.bob, ID.carol]);
  await db.query("insert into daily_runs (date, format, user_id, username, w, l, score) values ('2026-09-13', 'fantasy', $1, 'bob', 10, 7, 80), ('2026-09-13', 'fantasy', $2, 'carol', 9, 8, 70)", [ID.bob, ID.carol]);
  await db.query("insert into sou_runs (date, user_id, username, score) values ('2026-09-13', $1, 'bob', 5), ('2026-09-13', $2, 'carol', 3)", [ID.bob, ID.carol]);
  await db.query("insert into builds (user_id, username, pos, overall, filled) values ($1, 'bob', 'WR', 90, '{}'), ($2, 'carol', 'QB', 80, '{}')", [ID.bob, ID.carol]);
  const profileBefore = (await db.query("select * from profiles where id = $1", [ID.bob])).rows[0];

  const refusedAs = async (name, code) => {
    const res = await act(db, ID.alice, ID.bob, "rename", name);
    assert(res.error === code, `renaming to ${JSON.stringify(name)} gets ${code}, got ${describe(res)}`);
  };
  for (const name of ["ab", "x".repeat(17), "has space", "bad-name", "émile", "bob\n", "", null]) await refusedAs(name, "invalid");
  for (const name of ["carol", "bob"]) await refusedAs(name, "taken"); // bob's own name is taken too
  for (const name of [BLOCKED, `${BLOCKED.toUpperCase()}_99`]) await refusedAs(name, "blocked");
  const unchanged = (await db.query("select (select username from profiles where id = $1) as name, (select count(*)::int from reports where status = 'open') as open", [ID.bob])).rows[0];
  assert(unchanged.name === "bob" && unchanged.open === 2, `no refusal renamed anyone or resolved anything: ${JSON.stringify(unchanged)}`);

  const ok = await act(db, ID.alice, ID.bob, "rename", "Bobby_2");
  assert(ok.data?.ok === true && ok.data.removed_path === null, `rename succeeds: ${describe(ok)}`);
  const profileAfter = (await db.query("select * from profiles where id = $1", [ID.bob])).rows[0];
  assert(profileAfter.username === "Bobby_2", "profiles has the new name");
  for (const column of Object.keys(profileBefore).filter((c) => c !== "username")) {
    assert(JSON.stringify(profileAfter[column]) === JSON.stringify(profileBefore[column]), `rename changes the username column only, but ${column} changed`);
  }
  for (const table of ["runs", "daily_runs", "sou_runs", "builds"]) {
    const names = Object.fromEntries((await db.query(`select user_id, username from ${table}`)).rows.map((r) => [r.user_id, r.username]));
    assert(names[ID.bob] === "Bobby_2" && names[ID.carol] === "carol", `${table} follows bob's new name and leaves carol's: ${JSON.stringify(names)}`);
  }
  const reasons = Object.fromEntries((await db.query("select reason, status, action from reports where target_id = $1", [ID.bob])).rows.map((r) => [r.reason, `${r.status}/${r.action}`]));
  assert(reasons.username === "actioned/rename" && reasons.bio === "open/null", `only the username report is resolved: ${JSON.stringify(reasons)}`);
  assert((await report(db, ID.erin, "bob", "picture")).error === "no_such_player" && !(await report(db, ID.erin, "Bobby_2", "picture")).error, "reports find the player by the new name");
  assert(!(await act(db, ID.alice, ID.bob, "rename", "bobby_2")).error, "a change of case alone is a different exact name, so it's allowed");
});

await runTest("moderators can read and delete any picture in the avatars bucket, and nothing more", async () => {
  await fresh(db);
  await db.exec("insert into storage.buckets (id, name) values ('other', 'other') on conflict (id) do nothing");
  const bobPath = `${ID.bob}/1757800000000.webp`, carolPath = `${ID.carol}/1757800000001.jpg`;
  await db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2), ('avatars', $3, $4), ('other', $1, $2)", [bobPath, ID.bob, carolPath, ID.carol]);
  const names = async (uid, bucket) => {
    const res = await run(db, uid, "select name from storage.objects where bucket_id = $1 order by name", [bucket]);
    assert(!res.error, `reading storage.objects: ${res.error}`);
    return res.rows.map((r) => r.name);
  };
  const removed = async (uid, bucket, name) => {
    const res = await run(db, uid, "delete from storage.objects where bucket_id = $1 and name = $2 returning id", [bucket, name]);
    assert(!res.error, `deleting from storage.objects: ${res.error}`);
    return res.rows.length;
  };

  assert((await names(ID.alice, "avatars")).join() === [bobPath, carolPath].sort().join(), "a moderator sees every avatar");
  assert((await names(ID.alice, "other")).length === 0, "but nothing in another bucket");
  assert(!(await names(ID.dave, "avatars")).includes(bobPath) && (await names(null, "avatars")).length === 0, "a player can't see someone else's avatar object, and a visitor sees none");
  assert((await removed(ID.dave, "avatars", bobPath)) === 0 && (await removed(null, "avatars", bobPath)) === 0, "a player or visitor can't delete someone else's picture");
  assert((await removed(ID.alice, "other", bobPath)) === 0, "a moderator can't delete outside the avatars bucket");
  assert((await removed(ID.alice, "avatars", bobPath)) === 1, "a moderator deletes bob's picture");
  const left = (await db.query("select bucket_id || '/' || name as key from storage.objects order by key")).rows.map((r) => r.key);
  assert(left.join() === [`avatars/${carolPath}`, `other/${bobPath}`].sort().join(), `only that object is gone: ${left}`);

  const insert = await run(db, ID.alice, "insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [`${ID.bob}/1757800000009.webp`, ID.alice]);
  assert(/row-level security/.test(insert.error || ""), `a moderator can't upload into someone's folder: ${describe(insert)}`);
  const update = await run(db, ID.alice, "update storage.objects set name = $1 where name = $2 returning id", [`${ID.carol}/1757800000002.jpg`, carolPath]);
  assert(update.rows?.length === 0, `a moderator can't change someone's picture: ${describe(update)}`);
  // A delete that reads rows (a where clause, returning) is also held to the select policies, so only a bare
  // delete shows that the delete policy itself stays inside the avatars bucket.
  const bare = await run(db, ID.alice, "delete from storage.objects");
  assert(!bare.error, `a bare delete runs: ${bare.error}`);
  const afterBare = (await db.query("select bucket_id || '/' || name as key from storage.objects")).rows.map((r) => r.key);
  assert(afterBare.join() === `other/${bobPath}`, `a moderator's delete never reaches another bucket: ${afterBare}`);

  await db.query("insert into storage.objects (bucket_id, name, owner) values ('avatars', $1, $2)", [carolPath, ID.carol]);
  await db.exec("delete from moderators");
  assert((await names(ID.alice, "avatars")).length === 0 && (await removed(ID.alice, "avatars", carolPath)) === 0, "a removed moderator loses both");
  assert((await db.query("select count(*)::int as n from storage.objects where name = $1", [carolPath])).rows[0].n === 1, "carol's picture is still there");
});

// ---------- The mock against the SQL ----------

// Ids become account labels, report ids become their order of first appearance, and times become "<time>"
// once they're known to parse - the two sides make different ids and clocks, but everything else must match.
function canonical(value, labels = new Map(), reportIds = new Map()) {
  const byLength = [...labels.entries()].sort((a, b) => b[0].length - a[0].length);
  const walk = (v, key) => {
    if (typeof v === "string") {
      if (key === "created_at" || key === "resolved_at") return Number.isNaN(Date.parse(v)) ? `unparseable time ${v}` : "<time>";
      if (key === "id" && labels.size) {
        if (!reportIds.has(v)) reportIds.set(v, `report ${reportIds.size + 1}`);
        return reportIds.get(v);
      }
      return byLength.reduce((s, [id, label]) => s.split(id).join(`<${label}>`), v);
    }
    if (v instanceof Date) return "<time>";
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k], k)]));
    return v;
  };
  return walk(value);
}
function firstDiff(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path || "(top)"}: sql=${JSON.stringify(a)?.slice(0, 300)} mock=${JSON.stringify(b)?.slice(0, 300)}`;
}

await runTest("the mock gives the same answers as the SQL for one shared sequence of calls, and leaves the same data", async () => {
  await fresh(db);
  const mock = makeMockAuth();
  const PASSWORD = "Password1";
  const mockId = {};
  for (const name of NAMES) {
    const { data } = await mock.auth.signUp({ email: `${name}@test.example`, password: PASSWORD, options: { data: { username: name } } });
    mockId[name] = data.user.id;
  }
  mock._moderators.set(mockId.alice, { user_id: mockId.alice, added_at: new Date().toISOString() });
  const sides = [
    { name: "sql", id: { ...ID, nobody: uuid(999) }, reportIds: new Map() },
    { name: "mock", id: { ...mockId, nobody: "user-999" }, reportIds: new Map() },
  ];
  for (const side of sides) side.labels = new Map(Object.entries(side.id).map(([label, id]) => [id, label]));
  const [S, M] = sides;

  // The same starting data on both: bob has a photo, a bio and a history under his name; carol a default avatar.
  const photo = (side) => `${side.id.bob}/1757800000000.webp`;
  await db.query("insert into profile_details (user_id, bio, avatar_path, favorite_team) values ($1, 'Hello there', $2, 'KC')", [ID.bob, photo(S)]);
  await db.query("insert into profile_details (user_id, avatar_preset) values ($1, 'trophy')", [ID.carol]);
  await db.query("insert into runs (user_id, username, ladder, created_at) values ($1, 'bob', 'unlimited', '2026-09-12T10:00:00Z'), ($2, 'carol', 'gm', '2026-09-12T11:00:00Z')", [ID.bob, ID.carol]);
  await db.query("insert into daily_runs (date, format, user_id, username, w, l, score) values ('2026-09-13', 'fantasy', $1, 'bob', 10, 7, 80)", [ID.bob]);
  await db.query("insert into sou_runs (date, user_id, username, score) values ('2026-09-13', $1, 'bob', 5)", [ID.bob]);
  await db.query("insert into builds (user_id, username, pos, overall, filled) values ($1, 'bob', 'WR', 90, '{}')", [ID.bob]);
  const stamp = "2026-09-12T09:00:00.000Z";
  mock._profileDetails.set(mockId.bob, { user_id: mockId.bob, bio: "Hello there", avatar_path: photo(M), avatar_preset: null, favorite_team: "KC", updated_at: stamp });
  mock._profileDetails.set(mockId.carol, { user_id: mockId.carol, bio: "", avatar_path: null, avatar_preset: "trophy", favorite_team: null, updated_at: stamp });
  mock._runs.set(`${mockId.bob}|2026-09-12T10:00:00.000Z|false`, { user_id: mockId.bob, username: "bob", ladder: "unlimited", created_at: "2026-09-12T10:00:00.000Z", dnf: false });
  mock._runs.set(`${mockId.carol}|2026-09-12T11:00:00.000Z|false`, { user_id: mockId.carol, username: "carol", ladder: "gm", created_at: "2026-09-12T11:00:00.000Z", dnf: false });
  mock._dailyRuns.set(`2026-09-13:fantasy:${mockId.bob}`, { date: "2026-09-13", format: "fantasy", user_id: mockId.bob, username: "bob", w: 10, l: 7, score: 80 });
  mock._souRuns.set(`2026-09-13:${mockId.bob}`, { date: "2026-09-13", user_id: mockId.bob, username: "bob", score: 5 });
  mock._builds.set("build-1", { id: "build-1", user_id: mockId.bob, username: "bob", pos: "WR", overall: 90, filled: {} });

  // Renaming to a blocked word needs the word filter. The SQL always has one (the stand-in or the real one);
  // the mock's arrives with agent B's tests/mock-profile-data.mjs, and that step joins in once it does.
  mock._blockedWords.set(BLOCKED, { word: BLOCKED, match: "word" });
  const mockFilterLive = (await mock.rpc("check_username", { p_username: BLOCKED })).data === "blocked";
  if (!mockFilterLive) console.log("\n    (the blocked-name step is left out until the mock's word filter is in)");

  // bob is renamed CAROL partway through: a change of case from another player's name is still a new exact name.
  const erinFiles = [["CAROL", "picture"], ["CAROL", "bio"], ["CAROL", "username"], ["carol", "picture"], ["carol", "bio"], ["carol", "username"], ["carol", "other"], ["dave", "picture"], ["dave", "bio"]];
  const STEPS = [
    [null, "report_player", { p_username: "bob", p_reason: "bio" }],
    ["carol", "report_player", { p_username: "nobody", p_reason: "bio" }],
    ["carol", "report_player", { p_username: "BOB", p_reason: "bio" }],
    ["bob", "report_player", { p_username: "bob", p_reason: "bio" }],
    ["carol", "report_player", { p_username: "bob", p_reason: "spam" }],
    ["carol", "report_player", { p_username: "bob" }],
    ["carol", "report_player", { p_username: "bob", p_reason: "bio", p_note: "x".repeat(201) }],
    // The database trims spaces, tabs and line breaks only, so non-breaking spaces still count.
    ["carol", "report_player", { p_username: "bob", p_reason: "bio", p_note: `\u00a0${"x".repeat(199)}\u00a0` }],
    ["carol", "report_player", { p_username: "bob", p_reason: "bio", p_note: ` \t${"x".repeat(200)}\r\n` }],
    ["carol", "report_player", { p_username: "bob", p_reason: "bio", p_note: "again" }],
    ["carol", "report_player", { p_username: "bob", p_reason: "picture", p_note: "😀".repeat(200) }],
    ["dave", "report_player", { p_username: "bob", p_reason: "username", p_note: "  rude name \n" }],
    ["dave", "report_player", { p_username: "carol", p_reason: "picture", p_note: null }],
    ["erin", "report_player", { p_username: "bob", p_reason: "other", p_note: "spam account?" }],
    ["alice", "is_moderator", {}],
    ["bob", "is_moderator", {}],
    [null, "is_moderator", {}],
    ["bob", "mod_queue", {}],
    [null, "mod_queue", {}],
    ["bob", "mod_act", { p_user_id: "@carol", p_action: "dismiss" }],
    ["alice", "mod_queue", {}],
    ["alice", "mod_act", { p_user_id: "@nobody", p_action: "dismiss" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "explode" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "remove_picture" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "remove_picture" }],
    ["alice", "mod_act", { p_user_id: "@carol", p_action: "remove_picture" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "clear_bio" }],
    ["alice", "mod_act", { p_user_id: "@dave", p_action: "clear_bio" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "rename", p_new_name: "b!" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "rename" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "rename", p_new_name: "carol" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "rename", p_new_name: "bob" }],
    ...(mockFilterLive ? [["alice", "mod_act", { p_user_id: "@bob", p_action: "rename", p_new_name: BLOCKED }]] : []),
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "rename", p_new_name: "CAROL" }],
    ["carol", "report_player", { p_username: "bob", p_reason: "picture" }],
    ["carol", "report_player", { p_username: "CAROL", p_reason: "bio" }],
    ["alice", "mod_queue", {}],
    ["alice", "mod_act", { p_user_id: "@dave", p_action: "dismiss" }],
    ["alice", "mod_act", { p_user_id: "@bob", p_action: "dismiss" }],
    // erin's one report so far has just been dismissed, and still counts: nine more make ten, then the limit,
    // which is checked before duplicates.
    ...erinFiles.map(([p_username, p_reason]) => ["erin", "report_player", { p_username, p_reason }]),
    ["erin", "report_player", { p_username: "dave", p_reason: "username" }],
    ["erin", "report_player", { p_username: "CAROL", p_reason: "picture" }],
    ["alice", "mod_queue", {}],
    ["alice", "mod_act", { p_user_id: "@carol", p_action: "dismiss" }],
    ["alice", "mod_queue", {}],
  ];

  const resolve = (args, side) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.startsWith("@") ? side.id[v.slice(1)] : v]));
  const SQL_CALL = {
    is_moderator: () => ["select is_moderator()", []],
    mod_queue: () => ["select mod_queue()", []],
    report_player: (a) => ["select report_player($1, $2, $3)", [a.p_username ?? null, a.p_reason ?? null, a.p_note === undefined ? "" : a.p_note]],
    mod_act: (a) => ["select mod_act($1, $2, $3)", [a.p_user_id ?? null, a.p_action ?? null, a.p_new_name ?? null]],
  };
  for (const [i, [who, fn, args]] of STEPS.entries()) {
    const [statement, params] = SQL_CALL[fn](resolve(args, S));
    const sqlRes = await run(db, who ? ID[who] : null, statement, params);
    if (who) await mock.auth.signInWithPassword({ email: `${who}@test.example`, password: PASSWORD });
    else await mock.auth.signOut();
    const m = await mock.rpc(fn, resolve(args, M));
    const mockRes = m.error ? { error: m.error.message } : { data: m.data };
    const a = canonical(sqlRes.error ? { error: sqlRes.error } : { data: sqlRes.data }, S.labels, S.reportIds);
    const b = canonical(mockRes, M.labels, M.reportIds);
    assert(!firstDiff(a, b), `step ${i + 1} (${who || "signed out"}: ${fn} ${JSON.stringify(args).slice(0, 80)}) - ${firstDiff(a, b)}`);
    await sleep(5); // distinct timestamps, so every "oldest first" is decided by time on both sides
  }

  // And the same data afterwards.
  const sorted = (rows) => rows.map((r) => JSON.stringify(r)).sort();
  const reportRows = (rows, side) => sorted(rows.map((r) => canonical({
    reporter: r.reporter_id, target: r.target_id, reason: r.reason, note: r.note ?? "", status: r.status ?? "open",
    action: r.action ?? null, resolved_by: r.resolved_by ?? null, resolved: !!r.resolved_at,
  }, side.labels)));
  const sqlReports = (await db.query("select * from reports")).rows;
  let d = firstDiff(reportRows(sqlReports, S), reportRows([...mock._reports.values()], M));
  assert(!d, `reports differ: ${d}`);
  assert(sqlReports.length === 15, `expected 15 reports in all, got ${sqlReports.length}`);

  const usernames = (rows, side) => sorted(rows.map((r) => canonical({ who: r.user_id ?? r.id, username: r.username }, side.labels)));
  for (const [table, rows] of [["profiles", [...mock._profiles.values()]], ["runs", [...mock._runs.values()]], ["daily_runs", [...mock._dailyRuns.values()]], ["sou_runs", [...mock._souRuns.values()]], ["builds", [...mock._builds.values()]]]) {
    const sqlRows = (await db.query(`select ${table === "profiles" ? "id" : "user_id"}, username from ${table}`)).rows;
    d = firstDiff(usernames(sqlRows, S), usernames(rows, M));
    assert(!d, `${table} usernames differ: ${d}`);
  }
  assert((await db.query("select username from profiles where id = $1", [ID.bob])).rows[0].username === "CAROL", "bob ends up renamed");
  const erinLast = sqlReports.filter((r) => r.reporter_id === ID.erin).length;
  assert(erinLast === 10, `erin stopped at 10 reports, got ${erinLast}`);
  const detailRows = (rows, side) => sorted(rows.map((r) => canonical({ who: r.user_id, bio: r.bio, avatar_path: r.avatar_path, avatar_preset: r.avatar_preset, favorite_team: r.favorite_team }, side.labels)));
  d = firstDiff(detailRows((await db.query("select * from profile_details")).rows, S), detailRows([...mock._profileDetails.values()], M));
  assert(!d, `profile details differ: ${d}`);
});

await db.close();

// ---------- storage-moderation.js ----------

setupDom();
const { act: reactAct } = await import("react-dom/test-utils");

await runTest("storage-moderation.js maps every refusal and real PostgREST failure to its reason, and never throws", async () => {
  const S = await loadModule("storage-moderation.js");
  const storage = (removed = []) => ({
    from: (bucket) => ({
      getPublicUrl: (path) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${path}` } }),
      remove: async (paths) => { removed.push(...paths); return { data: paths.map((name) => ({ name })), error: null }; },
    }),
  });
  // What supabase-js resolves to when a database function raises its code (HTTP 400, a PostgrestError).
  const raising = (message) => async () => ({ data: null, error: { message, details: null, hint: null, code: "P0001" }, count: null, status: 400, statusText: "Bad Request" });
  const client = (rpc, extra = {}) => ({ rpc, storage: storage(), ...extra });

  const reportCases = { limit: "limit", duplicate: "duplicate", self: "self", not_signed_in: "signed_out", no_such_player: "missing", bad_reason: "invalid", note_too_long: "invalid", some_new_code: "network" };
  for (const [code, reason] of Object.entries(reportCases)) {
    window.__ps_supabase__ = client(raising(code));
    const res = await S.reportPlayer("bob", "bio", "");
    assert(res.ok === false && res.reason === reason, `reportPlayer: ${code} -> ${reason}, got ${JSON.stringify(res)}`);
  }
  window.__ps_supabase__ = client(async () => ({ data: null, error: { message: "JWT expired", details: null, hint: null, code: "PGRST303" }, status: 401, statusText: "Unauthorized" }));
  assert((await S.reportPlayer("bob", "bio")).reason === "signed_out", "an expired sign-in reads as signed out");
  window.__ps_supabase__ = client(async () => ({ data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" }, status: 0, statusText: "" }));
  assert((await S.reportPlayer("bob", "bio")).reason === "network", "a failed fetch is network");
  window.__ps_supabase__ = client(async () => { throw new TypeError("Failed to fetch"); });
  assert((await S.reportPlayer("bob", "bio")).reason === "network", "a thrown request is network");
  window.__ps_supabase__ = { get rpc() { throw new Error("no client"); } };
  assert((await S.reportPlayer("bob", "bio")).reason === "network", "a broken client is network");
  let sent = null;
  window.__ps_supabase__ = client(async (name, args) => { sent = { name, args }; return { data: { ok: true }, error: null, status: 200 }; });
  assert((await S.reportPlayer("bob", "other", undefined)).ok === true && sent.name === "report_player" && JSON.stringify(sent.args) === JSON.stringify({ p_username: "bob", p_reason: "other", p_note: "" }), `reportPlayer sends the contract's arguments: ${JSON.stringify(sent)}`);

  const moderatorAnswers = [[{ data: true, error: null }, true], [{ data: false, error: null }, false], [{ data: "true", error: null }, false], [{ data: null, error: { message: "boom" } }, false]];
  for (const [answer, want] of moderatorAnswers) {
    let options;
    window.__ps_supabase__ = client(async (name, args, opts) => { options = opts; return answer; });
    assert((await S.isModerator()) === want && options?.get === true, `isModerator(${JSON.stringify(answer)}) is ${want}, as a GET`);
  }
  window.__ps_supabase__ = client(async () => { throw new Error("offline"); });
  assert((await S.isModerator()) === false, "isModerator is false when it can't be checked");

  window.__ps_supabase__ = client(raising("not_moderator"));
  assert((await S.fetchModQueue()) === null, "fetchModQueue is null for a non-moderator");
  window.__ps_supabase__ = client(async () => ({ data: { not: "a list" }, error: null }));
  assert((await S.fetchModQueue()) === null, "and for an answer that isn't a list");
  window.__ps_supabase__ = client(async () => { throw new Error("offline"); });
  assert((await S.fetchModQueue()) === null, "and when the request throws");
  let queueOptions;
  window.__ps_supabase__ = client(async (name, args, opts) => {
    queueOptions = opts;
    return {
      data: [
        { user_id: "u1", username: "bob", avatar_path: "u1/1757800000000.webp", avatar_preset: null, bio: null, favorite_team: "KC",
          reports: [{ id: "r1", reason: "picture", note: null, reporter: "carol", created_at: "2026-09-14T10:00:00+00:00" }, null] },
        null,
        { user_id: "u2", username: "dave", avatar_path: null, avatar_preset: "trophy", bio: "Hi", favorite_team: null, reports: null },
      ],
      error: null,
    };
  });
  const list = await S.fetchModQueue();
  assert(queueOptions?.get === true, "the queue is read as a GET");
  assert(JSON.stringify(list) === JSON.stringify([
    { userId: "u1", username: "bob", avatarPath: "u1/1757800000000.webp", avatarUrl: "https://cdn.test/avatars/u1/1757800000000.webp", avatarPreset: null, bio: "", favoriteTeam: "KC",
      reports: [{ id: "r1", reason: "picture", note: "", reporter: "carol", createdAt: "2026-09-14T10:00:00+00:00" }] },
    { userId: "u2", username: "dave", avatarPath: null, avatarUrl: null, avatarPreset: "trophy", bio: "Hi", favoriteTeam: null, reports: [] },
  ]), `fetchModQueue maps to the app's shape and drops broken entries: ${JSON.stringify(list)}`);

  const modCases = { not_moderator: "not_moderator", taken: "taken", blocked: "blocked", invalid: "invalid", no_such_player: "missing", bad_action: "invalid", PGRST202: "network" };
  for (const [code, reason] of Object.entries(modCases)) {
    window.__ps_supabase__ = client(raising(code));
    const res = await S.modAction("u1", "rename", "new_name");
    assert(res.ok === false && res.reason === reason, `modAction: ${code} -> ${reason}, got ${JSON.stringify(res)}`);
  }
  window.__ps_supabase__ = client(async () => { throw new TypeError("Failed to fetch"); });
  assert((await S.modAction("u1", "dismiss")).reason === "network", "a thrown request is network");
  const removed = [];
  const calls = [];
  window.__ps_supabase__ = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true, removed_path: args.p_action === "remove_picture" ? "u1/1757800000000.webp" : null }, error: null }; }, storage: storage(removed) };
  assert((await S.modAction("u1", "remove_picture", "ignored")).ok === true, "remove_picture succeeds");
  await flush();
  assert(removed.join() === "u1/1757800000000.webp", `and deletes the returned file: ${removed}`);
  assert((await S.modAction("u1", "dismiss")).ok === true && removed.length === 1, "an action with no removed path deletes nothing");
  assert((await S.modAction("u1", "rename", "Bobby")).ok === true, "rename succeeds");
  assert(JSON.stringify(calls.map((c) => c.args)) === JSON.stringify([
    { p_user_id: "u1", p_action: "remove_picture", p_new_name: null },
    { p_user_id: "u1", p_action: "dismiss", p_new_name: null },
    { p_user_id: "u1", p_action: "rename", p_new_name: "Bobby" },
  ]), `the new name goes only with rename: ${JSON.stringify(calls)}`);
  window.__ps_supabase__ = { rpc: async () => ({ data: { ok: true, removed_path: "u1/1.webp" }, error: null }), get storage() { throw new Error("storage is down"); } };
  assert((await S.modAction("u1", "remove_picture")).ok === true, "a file that can't be deleted doesn't undo a picture removal that landed");
});

// ---------- The screens ----------

const { ReportSheet, ModerationQueue, MODERATION_CSS } = await loadModule("moderation.jsx");
let mounted = null;
async function show(Component, props) {
  if (mounted) await reactAct(async () => mounted.reactRoot.unmount());
  mounted = await renderComponent(Component, props);
  await flush();
  return mounted.container;
}
// helpers.mjs's type() only knows inputs; a textarea's value setter is its own.
async function typeText(el, value) {
  await reactAct(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const buttonIn = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label) || null;
const sendButton = (root) => [...root.querySelectorAll('button[type="submit"]')][0];
const errorIn = (root) => root.querySelector(".err")?.textContent || "";

// Five accounts on the in-memory mock, alice a moderator. signIn(null) signs out.
async function mockWorld() {
  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  const ids = {};
  for (const name of NAMES) {
    const { data } = await auth.auth.signUp({ email: `${name}@test.example`, password: "Password1", options: { data: { username: name } } });
    ids[name] = data.user.id;
  }
  auth._moderators.set(ids.alice, { user_id: ids.alice, added_at: new Date().toISOString() });
  const signIn = (name) => (name ? auth.auth.signInWithPassword({ email: `${name}@test.example`, password: "Password1" }) : auth.auth.signOut());
  return { auth, ids, signIn };
}

await runTest("MODERATION_CSS styles only md- classes and uses theme tokens rather than colors of its own", async () => {
  const selectors = MODERATION_CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter((s) => !s.startsWith("@") && !/^(from|to|\d+%)$/.test(s));
  for (const group of selectors) {
    for (const selector of group.split(",")) {
      const classes = selector.match(/\.[a-z][\w-]*/g) || [];
      assert(classes.some((c) => c.startsWith(".md-")), `"${selector.trim()}" should style an md- class`);
    }
  }
  const noVars = MODERATION_CSS.replace(/--[\w-]+:[^;}]+/g, "");
  assert(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(noVars), "no hard-coded colors outside the theme's own variables");
  assert(MODERATION_CSS.indexOf("@media (prefers-reduced-motion:reduce)") > MODERATION_CSS.indexOf("animation:md-rise"), "the sheet's animation is switched off for reduced motion");
});

await runTest("ReportSheet: choose a reason, add a note, send, and get the thank-you", async () => {
  const { auth, ids, signIn } = await mockWorld();
  await signIn("carol");
  let closed = 0;
  const c = await show(ReportSheet, { username: "bob", onClose: () => { closed++; } });
  const dialog = c.querySelector('[role="dialog"]');
  assert(dialog && dialog.getAttribute("aria-modal") === "true" && /^Report\s*bob$/.test(dialog.querySelector("h2").textContent), "a modal dialog titled Report bob");
  assert(document.activeElement === dialog, "focus moves into the sheet");
  const reasons = [...c.querySelectorAll(".md-reason")].map((l) => l.textContent);
  assert(JSON.stringify(reasons) === JSON.stringify(["Picture", "Bio", "Username", "Something else"]), `the four reasons: ${reasons}`);
  assert(sendButton(c).textContent === "Send" && sendButton(c).disabled, "Send waits for a reason");
  await click(c.querySelector('input[value="bio"]'));
  assert(c.querySelector('input[value="bio"]').checked && !sendButton(c).disabled, "choosing a reason enables Send");
  await typeText(c.querySelector("textarea"), "  Calls people names.  ");
  assert(c.querySelector(".md-count").textContent === "19/200", `the count is of the trimmed note: ${c.querySelector(".md-count").textContent}`);
  await click(sendButton(c));
  await flush();
  assert(c.textContent.includes("Thanks. A moderator will take a look.") && !c.querySelector("form"), "the thank-you replaces the form");
  const rows = [...auth._reports.values()];
  assert(rows.length === 1 && rows[0].reporter_id === ids.carol && rows[0].target_id === ids.bob && rows[0].reason === "bio" && rows[0].note === "Calls people names.", `one report, as sent: ${JSON.stringify(rows)}`);
  assert(document.activeElement === buttonIn(c, "Close"), "focus lands on Close");
  await click(buttonIn(c, "Close"));
  assert(closed === 1, "Close calls onClose");
});

await runTest("ReportSheet puts every refusal into words", async () => {
  const { auth, ids, signIn } = await mockWorld();
  const attempt = async ({ as, username = "bob", reason = "bio" }) => {
    await signIn(as);
    const c = await show(ReportSheet, { username, onClose() {} });
    await click(c.querySelector(`input[value="${reason}"]`));
    await click(sendButton(c));
    await flush();
    return c.textContent.includes("Thanks. A moderator will take a look.") ? "sent" : errorIn(c);
  };
  assert((await attempt({ as: "carol" })) === "sent", "a first report goes through");
  const expect = async (options, text, why) => {
    const got = await attempt(options);
    assert(got === text, `${why}: expected "${text}", got "${got}"`);
  };
  await expect({ as: "carol" }, "You've already reported this player for that. A moderator will look at it.", "duplicate");
  await expect({ as: "bob" }, "You can't report yourself.", "self");
  await expect({ as: "carol", username: "ghost" }, "We couldn't find that player. Their username may have changed.", "missing");
  await expect({ as: null }, "Log in to report a player.", "signed out");
  for (let i = 0; i < 10; i++) {
    auth._reports.set(`seed-${i}`, { id: `seed-${i}`, reporter_id: ids.dave, target_id: ids.erin, reason: "other", note: "", status: i < 4 ? "dismissed" : "open", created_at: new Date(Date.now() - 3600e3).toISOString() });
  }
  await expect({ as: "dave", reason: "picture" }, "You've sent 10 reports in the last 24 hours. Try again later.", "limit");
  // What the mock won't produce by itself: a refusal the form should have prevented, and a dropped connection.
  const realRpc = auth.rpc;
  auth.rpc = (name, args) => (name === "report_player" ? Promise.resolve({ data: null, error: { message: "note_too_long", code: "P0001" }, status: 400 }) : realRpc(name, args));
  await expect({ as: "erin" }, "Pick a reason, and keep the note to 200 characters.", "invalid");
  auth.rpc = () => Promise.reject(new TypeError("Failed to fetch"));
  await expect({ as: "erin" }, "The report didn't send. Check your connection and try again.", "network");
  auth.rpc = realRpc;
  await expect({ as: "erin" }, "sent", "and it works again once the connection's back");
});

await runTest("ReportSheet: an over-long note turns Send off, and Escape, the backdrop, × and Cancel all close it", async () => {
  const { signIn } = await mockWorld();
  await signIn("carol");
  let closed = 0;
  const c = await show(ReportSheet, { username: "bob", onClose: () => { closed++; } });
  await click(c.querySelector('input[value="other"]'));
  await typeText(c.querySelector("textarea"), `  ${"😀".repeat(201)}  `);
  const count = () => c.querySelector(".md-count");
  assert(count().textContent === "201/200" && count().classList.contains("over") && sendButton(c).disabled, `201 emoji are over the limit and Send is off: ${count().textContent}`);
  await typeText(c.querySelector("textarea"), "😀".repeat(200));
  assert(count().textContent === "200/200" && !count().classList.contains("over") && !sendButton(c).disabled, "200 is fine");

  await reactAct(async () => { window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert(closed === 1, "Escape closes");
  const tap = async (el) => {
    await reactAct(async () => { el.dispatchEvent(new window.Event("pointerdown", { bubbles: true })); });
    await click(el);
  };
  await tap(c.querySelector(".md-sheet"));
  await tap(c.querySelector(".md-reason"));
  assert(closed === 1, "a tap inside the sheet doesn't close it");
  await tap(c.querySelector(".md-scrim"));
  assert(closed === 2, "a tap on the backdrop does");
  await click(c.querySelector(".md-x"));
  await click(buttonIn(c, "Cancel"));
  assert(closed === 4, "× and Cancel close it");
});

// bob: a photo, a bio and a history under his name, reported for all three; dave: nothing saved, one report.
async function queueWorld() {
  const world = await mockWorld();
  const { auth, ids, signIn } = world;
  const photo = `${ids.bob}/1757800000000.webp`;
  auth._profileDetails.set(ids.bob, { user_id: ids.bob, bio: "Ask me about my 20-0 season", avatar_path: photo, avatar_preset: null, favorite_team: "KC", updated_at: "2026-09-10T10:00:00.000Z" });
  auth._storageObjects.set(`avatars/${photo}`, { bucket: "avatars", path: photo, contentType: "image/webp", size: 2048, owner: ids.bob });
  auth._runs.set(`${ids.bob}|2026-09-10T10:00:00.000Z|false`, { user_id: ids.bob, username: "bob", created_at: "2026-09-10T10:00:00.000Z", dnf: false });
  auth._dailyRuns.set(`2026-09-10:fantasy:${ids.bob}`, { date: "2026-09-10", format: "fantasy", user_id: ids.bob, username: "bob", w: 10, l: 7, score: 80 });
  auth._souRuns.set(`2026-09-10:${ids.bob}`, { date: "2026-09-10", user_id: ids.bob, username: "bob", score: 5 });
  auth._builds.set("build-1", { id: "build-1", user_id: ids.bob, username: "bob", pos: "WR", overall: 90, filled: {} });
  for (const [from, target, reason, note] of [["carol", "bob", "picture", "Not a football picture"], ["dave", "bob", "bio", ""], ["carol", "dave", "other", "Spamming the daily board"], ["erin", "bob", "username", ""]]) {
    await signIn(from);
    const res = await auth.rpc("report_player", { p_username: target, p_reason: reason, p_note: note });
    assert(!res.error, `seeding ${from}'s report: ${JSON.stringify(res.error)}`);
    await sleep(3);
  }
  await signIn("alice");
  const reportOn = (target, reason) => [...auth._reports.values()].find((r) => r.target_id === ids[target] && r.reason === reason);
  return { ...world, photo, reportOn };
}
const cardOf = (c, username) => c.querySelector(`.md-player[data-username="${username}"]`);
const actionsOf = (card) => [...card.querySelectorAll(".md-acts button")].map((b) => b.textContent);

await runTest("ModerationQueue lists each reported player's picture, bio and reports, oldest first, and opens their profile", async () => {
  await queueWorld();
  const opened = [];
  const c = await show(ModerationQueue, { onOpenProfile: (name) => opened.push(name) });
  assert(c.querySelector("h2").textContent === "Reports", "headed Reports");
  const cards = [...c.querySelectorAll(".md-player")];
  assert(cards.map((x) => x.dataset.username).join() === "bob,dave", `players by oldest report: ${cards.map((x) => x.dataset.username)}`);
  assert(c.querySelector(".md-sum").textContent === "4 open reports on 2 players", c.querySelector(".md-sum").textContent);
  const bob = cards[0];
  assert(bob.querySelector('[role="img"]'), "bob's picture is shown");
  assert(bob.querySelector(".md-name").textContent === "bob" && bob.querySelector(".md-meta").textContent === "3 open reports", "name and report count");
  assert(bob.querySelector(".md-bio").textContent.includes("Ask me about my 20-0 season"), "bob's bio");
  assert([...bob.querySelectorAll(".md-tag")].map((t) => t.textContent).join() === "Picture,Bio,Username", "bob's reports in order, by reason");
  assert(bob.textContent.includes("Not a football picture") && bob.textContent.includes("Reported by carol") && bob.textContent.includes("Reported by erin"), "notes and reporters");
  assert(actionsOf(bob).join() === "Remove picture,Clear bio,Rename player,Dismiss", `bob's actions: ${actionsOf(bob)}`);
  assert(actionsOf(cards[1]).join() === "Rename player,Dismiss" && cards[1].textContent.includes("No bio"), "dave has no picture or bio to act on");
  await click(bob.querySelector(".md-link"));
  assert(opened.join() === "bob", "the name opens the profile");
});

await runTest("ModerationQueue: Remove picture and Clear bio ask first, then act and resolve just their reports", async () => {
  const { auth, ids, photo, reportOn } = await queueWorld();
  const c = await show(ModerationQueue, { onOpenProfile() {} });
  const bob = () => cardOf(c, "bob");

  await click(buttonIn(bob(), "Remove picture"));
  assert(bob().querySelector(".md-ask")?.textContent === "Remove bob's picture?" && !bob().querySelector(".md-acts"), "it asks first");
  assert(document.activeElement === buttonIn(bob(), "Cancel"), "focus moves to the question's Cancel");
  assert(auth._profileDetails.get(ids.bob).avatar_path === photo, "nothing changes before confirming");
  await click(buttonIn(bob(), "Cancel"));
  assert(!bob().querySelector(".md-ask") && document.activeElement === buttonIn(bob(), "Remove picture"), "Cancel goes back, focus on Remove picture");
  assert(auth._profileDetails.get(ids.bob).avatar_path === photo && reportOn("bob", "picture").status === "open", "and changes nothing");

  await click(buttonIn(bob(), "Remove picture"));
  await click(buttonIn(bob(), "Remove"));
  await flush();
  const details = auth._profileDetails.get(ids.bob);
  assert(details.avatar_path === null && details.avatar_preset === null && details.bio === "Ask me about my 20-0 season", "the picture is cleared, the bio kept");
  assert(!auth._storageObjects.has(`avatars/${photo}`), "and the file is deleted");
  const pic = reportOn("bob", "picture");
  assert(pic.status === "actioned" && pic.action === "remove_picture" && pic.resolved_by === ids.alice, `the picture report is resolved: ${JSON.stringify(pic)}`);
  assert(reportOn("bob", "bio").status === "open" && reportOn("bob", "username").status === "open", "the others stay open");
  assert(c.querySelector(".md-status").textContent === "Removed bob's picture.", `says what it did: ${c.querySelector(".md-status").textContent}`);
  assert(bob().querySelector(".md-meta").textContent === "2 open reports" && !buttonIn(bob(), "Remove picture"), "bob's card updates");

  await click(buttonIn(bob(), "Clear bio"));
  assert(bob().querySelector(".md-ask").textContent === "Clear bob's bio?", "Clear bio asks first");
  await click(buttonIn(bob(), "Clear"));
  await flush();
  assert(auth._profileDetails.get(ids.bob).bio === "" && reportOn("bob", "bio").action === "clear_bio" && reportOn("bob", "username").status === "open", "the bio is cleared and its report resolved");
  assert(c.querySelector(".md-status").textContent === "Cleared bob's bio." && bob().textContent.includes("No bio") && !buttonIn(bob(), "Clear bio"), "and the card says so");

  // A failure changes nothing and says so in the card.
  const realRpc = auth.rpc;
  auth.rpc = (name, args) => (name === "mod_act" ? Promise.reject(new TypeError("Failed to fetch")) : realRpc(name, args));
  await click(buttonIn(cardOf(c, "dave"), "Rename player"));
  await type(cardOf(c, "dave").querySelector(".md-input"), "dave_2");
  await click(buttonIn(cardOf(c, "dave"), "Next"));
  await click(buttonIn(cardOf(c, "dave"), "Rename"));
  await flush();
  assert(errorIn(cardOf(c, "dave")) === "That didn't go through. Check your connection and try again.", `a dropped connection: ${errorIn(cardOf(c, "dave"))}`);
  auth.rpc = realRpc;
  assert(auth._profiles.get(ids.dave).username === "dave", "nothing was renamed");
});

await runTest("ModerationQueue: Rename player asks for the name, confirms it, says why a name won't do, then renames everywhere", async () => {
  const { auth, ids, reportOn } = await queueWorld();
  const c = await show(ModerationQueue, { onOpenProfile() {} });
  const bob = () => cardOf(c, "bob") || cardOf(c, "bob_renamed");
  const field = () => bob().querySelector(".md-input");

  await click(buttonIn(bob(), "Rename player"));
  assert(field() && document.activeElement === field(), "a name field appears, focused");
  await type(field(), "b!");
  await click(buttonIn(bob(), "Next"));
  assert(errorIn(bob()) === USERNAME_RULE && !bob().querySelector(".md-ask"), `the username rule is checked before asking: ${errorIn(bob())}`);
  assert(field().getAttribute("aria-describedby") === bob().querySelector(".err").id && field().getAttribute("aria-invalid") === "true", "the message is tied to the name field");

  await type(field(), "carol");
  await click(buttonIn(bob(), "Next"));
  assert(bob().querySelector(".md-ask").textContent === "Rename bob to carol?", "it asks before renaming");
  await click(buttonIn(bob(), "Back"));
  assert(field().value === "carol" && document.activeElement === field(), "Back returns to the field with the name kept");
  await click(buttonIn(bob(), "Next"));
  await click(buttonIn(bob(), "Rename"));
  await flush();
  assert(errorIn(bob()) === "That username is taken. Try another one." && field(), `taken, and back on the field: ${errorIn(bob())}`);

  // The database's other refusals. Its word filter isn't in the mock yet, and the form stops invalid names before
  // they're sent, so these answers are supplied here.
  const realRpc = auth.rpc;
  for (const [code, text] of [["blocked", "That username isn't allowed. Try another one."], ["invalid", USERNAME_RULE], ["not_moderator", "Only moderators can do that."]]) {
    auth.rpc = (name, args) => (name === "mod_act" ? Promise.resolve({ data: null, error: { message: code, details: null, hint: null, code: "P0001" }, status: 400 }) : realRpc(name, args));
    await type(field(), "fine_name");
    await click(buttonIn(bob(), "Next"));
    await click(buttonIn(bob(), "Rename"));
    await flush();
    assert(errorIn(bob()) === text, `${code}: expected "${text}", got "${errorIn(bob())}"`);
  }
  auth.rpc = realRpc;
  assert(auth._profiles.get(ids.bob).username === "bob" && reportOn("bob", "username").status === "open", "no refusal renamed anyone");
  assert(!field() && actionsOf(bob()).includes("Rename player"), "a refusal that isn't about the name goes back to the actions");

  await click(buttonIn(bob(), "Rename player"));
  assert(field().value === "", "the name field starts empty again");
  await type(field(), "  bob_renamed ");
  await click(buttonIn(bob(), "Next"));
  assert(bob().querySelector(".md-ask").textContent === "Rename bob to bob_renamed?", "the name is trimmed");
  await click(buttonIn(bob(), "Rename"));
  await flush();
  assert(auth._profiles.get(ids.bob).username === "bob_renamed", "profiles has the new name");
  for (const [table, rows] of [["runs", auth._runs], ["daily_runs", auth._dailyRuns], ["sou_runs", auth._souRuns], ["builds", auth._builds]]) {
    const mine = [...rows.values()].filter((r) => r.user_id === ids.bob);
    assert(mine.length === 1 && mine[0].username === "bob_renamed", `${table} follows the new name: ${JSON.stringify(mine)}`);
  }
  const username = reportOn("bob", "username");
  assert(username.status === "actioned" && username.action === "rename" && reportOn("bob", "picture").status === "open", "the username report is resolved, the others stay open");
  assert(c.querySelector(".md-status").textContent === "Renamed bob to bob_renamed." && cardOf(c, "bob_renamed"), "the queue shows the new name");
});

await runTest("ModerationQueue: Dismiss closes a player's reports without asking; empty and failed loads say so plainly", async () => {
  const { auth, ids, reportOn, signIn } = await queueWorld();
  const c = await show(ModerationQueue, { onOpenProfile() {} });
  await click(buttonIn(cardOf(c, "dave"), "Dismiss"));
  await flush();
  const dave = reportOn("dave", "other");
  assert(dave.status === "dismissed" && dave.action === "dismiss" && dave.resolved_by === ids.alice, `dave's report is dismissed: ${JSON.stringify(dave)}`);
  assert(!cardOf(c, "dave") && c.querySelector(".md-status").textContent === "Dismissed the reports on dave.", "dave leaves the queue");
  assert(document.activeElement === c.querySelector(".md-status"), "focus goes to the message when the card is gone");
  await click(buttonIn(cardOf(c, "bob"), "Dismiss"));
  await flush();
  assert(["picture", "bio", "username"].every((r) => reportOn("bob", r).status === "dismissed"), "Dismiss closes all of a player's reports");
  assert(!c.querySelector(".md-player") && c.querySelector(".md-empty")?.textContent === "No open reports.", "then: No open reports.");
  assert(auth._profileDetails.get(ids.bob).avatar_path && auth._profileDetails.get(ids.bob).bio, "dismissing changes nothing about the player");

  await signIn("bob");
  const c2 = await show(ModerationQueue, { onOpenProfile() {} });
  assert(c2.textContent.includes("The reports didn't load.") && buttonIn(c2, "Try again"), "a queue that can't load says so");
  auth._moderators.set(ids.bob, { user_id: ids.bob, added_at: new Date().toISOString() });
  await click(buttonIn(c2, "Try again"));
  await flush();
  assert(c2.querySelector(".md-empty")?.textContent === "No open reports." && !c2.textContent.includes("didn't load"), "Try again loads it");
});

if (mounted) await reactAct(async () => mounted.reactRoot.unmount());
console.log("test-moderation.mjs done");
