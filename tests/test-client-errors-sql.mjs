// The crash sink's table, in real Postgres. The rule it exists to hold: nobody but the service role writes
// it, and three columns are absent on purpose - no user_id, no username, no ip. A column nobody adds is
// easier to keep absent than to remove once it has rows in it.
import { freshDb, MIGRATIONS } from "./pg-fixture.mjs";
import { assert, runTest } from "./helpers.mjs";

const db = await freshDb({ migrations: MIGRATIONS });

await runTest("the table exists with the columns the function writes, and no others", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'client_errors' order by column_name`);
  const got = rows.map((r) => r.column_name).sort();
  const want = ["before", "browser", "component", "created_at", "id", "kind", "message", "screen", "stack", "version"].sort();
  assert(JSON.stringify(got) === JSON.stringify(want), `columns: ${JSON.stringify(got)}`);
});

await runTest("no column can hold a person", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'client_errors'`);
  for (const r of rows) {
    assert(!/user|name|ip|email|account|session/i.test(r.column_name),
      `${r.column_name} is the sort of column this table must not have`);
  }
});

await runTest("RLS is on and there is no write policy at all", async () => {
  const { rows: [t] } = await db.query(
    `select relrowsecurity from pg_class where oid = 'public.client_errors'::regclass`);
  assert(t.relrowsecurity === true, "row level security is enabled");
  const { rows: pol } = await db.query(
    `select polname, polcmd from pg_policy where polrelid = 'public.client_errors'::regclass`);
  assert(pol.length === 0, `no policy of any kind, got: ${JSON.stringify(pol)}`);
});

await runTest("an anon insert is refused", async () => {
  await db.exec("set role anon");
  let refused = false;
  try {
    await db.query(`insert into public.client_errors (version, kind, message) values ('t', 'crash', 'x')`);
  } catch (e) { refused = true; }
  await db.exec("reset role");
  assert(refused, "anon cannot write the table");
});

await runTest("kind is crash and nothing else", async () => {
  let refused = false;
  try {
    await db.query(`insert into public.client_errors (version, kind, message) values ('t', 'silent', 'x')`);
  } catch (e) { refused = true; }
  assert(refused, "the check constraint holds kind to 'crash'");
});

await db.close();
console.log("test-client-errors-sql.mjs done");
