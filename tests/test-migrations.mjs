// The promotion runbook's migration step, executed.
//
// Every migration file is tested somewhere already - but always the one or two a given suite needs, applied
// by that suite's own fixture. Nothing ran the list the runbook actually gives, in the order it gives, on a
// database that has never seen any of them. Two things go wrong there and neither shows up anywhere else:
//
//   - An ORDER that works on staging and production and fails on a new environment. v2.0.0 already had one:
//     `player_profile` in migration-profiles.sql calls `player_stats`, which only runs-log defines, and a
//     `language sql` body is validated when it is created - so profiles-first fails outright on a database
//     that does not already have it, and passes everywhere that does. CLAUDE.md says this is the worst shape
//     a runbook can be in, because it is invisible until the day somebody makes a new project.
//   - A file MISSING from the list. §3.3 added guest gates to three functions in migration-shop.sql, and the
//     v2.0.0 list did not name that file - so following the runbook exactly would have shipped a client
//     expecting those gates to a database that never got them, and the shop would have stayed open to guests
//     in production with nothing to show for it.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { assert, runTest } from "./helpers.mjs";
import { freshDb, sql } from "./pg-fixture.mjs";

// EVERY migration, in an order that works on a database that has only schema.sql - which is what a new
// Supabase project is, and the shape a broken order hides from. A given release re-runs a subset of this
// (v2.0.0's is in CLAUDE.md and 2.0-STATUS.md §7, and is this list minus the two that predate scoring
// formats); the full list is what has to be complete and correctly ordered.
const ORDER = [
  "migration-points-ladder.sql",
  "migration-scoring-formats.sql",
  "migration-runs-log.sql",
  "migration-profiles.sql",
  "migration-moderation.sql",
  "migration-wallet.sql",
  "migration-shop.sql",
  "migration-versus.sql",
];

await runTest("every migration in the repo is named here", async () => {
  // A file nobody runs is a file whose changes never reach an environment. This is the check that would have
  // caught migration-shop.sql going missing from the v2.0.0 list - §3.3 put guest gates in it and the list
  // did not name it, so following the runbook would have shipped a client expecting gates the database never
  // got, and the shop would have stayed open to guests with nothing on screen to say so.
  const onDisk = readdirSync(new URL("../supabase/", import.meta.url))
    .filter((f) => /^migration-.*\.sql$/.test(f)).sort();
  const listed = [...ORDER].sort();
  assert(JSON.stringify(onDisk) === JSON.stringify(listed),
    `the runbook names every migration:\n  on disk: ${onDisk.join(", ")}\n  listed:  ${listed.join(", ")}`);
});

await runTest("the runbook's order works on a database that has never seen any of them", async () => {
  // Only the base schema, which is what a brand-new Supabase project gets from schema.sql.
  const db = await freshDb({ migrations: ["schema.sql"] });
  try {
    for (const file of ORDER) {
      try {
        await db.exec(sql(file));
      } catch (e) {
        assert(false, `${file} failed on a new database, in the runbook's own order: ${String(e?.message || e).split("\n")[0]}`);
      }
    }
    // And the thing the order exists for: the functions that depend on each other all compiled.
    const fns = (await db.query("select proname from pg_proc where pronamespace = 'public'::regnamespace")).rows.map((r) => r.proname);
    for (const needed of ["player_stats", "player_profile", "site_stats", "shop_state", "record_pick", "mod_act", "caller_can_hold_avatars"]) {
      assert(fns.includes(needed), `${needed} exists after the runbook's order`);
    }
    await db.close();
  } catch (e) {
    await db.close();
    throw e;
  }
});

await runTest("running the whole list again changes nothing, twice over", async () => {
  // "Safe to re-run" is a promise each file makes in its own header, and the runbook depends on it - re-running
  // is how a change to a shared function reaches an environment. The runs-log backfill broke this for a stored
  // run with no numeric date (1 -> 2 -> 3 duplicates) while every file still claimed it was safe.
  const db = await freshDb({ migrations: ["schema.sql"] });
  try {
    const shape = async () => {
      const q = async (s) => (await db.query(s)).rows;
      return JSON.stringify({
        seeds: await q(`select 'shop_items' t, count(*)::int n from shop_items
          union all select 'avatar_presets', count(*) from avatar_presets
          union all select 'blocked_words', count(*) from blocked_words
          union all select 'badge_rewards', count(*) from badge_rewards
          union all select 'site_flags', count(*) from site_flags order by 1`),
        policies: await q("select schemaname, tablename, policyname from pg_policies where schemaname in ('public','storage') order by 1,2,3"),
        functions: await q("select proname, pg_get_function_identity_arguments(oid) as args from pg_proc where pronamespace = 'public'::regnamespace order by 1,2"),
        tables: await q("select table_name from information_schema.tables where table_schema = 'public' order by 1"),
      });
    };
    for (const file of ORDER) await db.exec(sql(file));
    const first = await shape();
    for (const file of ORDER) await db.exec(sql(file));
    assert(await shape() === first, "a second pass leaves the database exactly as it was");
    for (const file of ORDER) await db.exec(sql(file));
    assert(await shape() === first, "and so does a third");
    await db.close();
  } catch (e) {
    await db.close();
    throw e;
  }
});

console.log("test-migrations.mjs done");
