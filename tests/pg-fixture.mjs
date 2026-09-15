// A real Postgres (PGlite, in-process) set up the way a Supabase project is, for testing the SQL in
// supabase/ - tables, functions and row-level security - without a project or Docker.
//
//   const db = await freshDb();                      // schema.sql + every migration below, in order
//   await addAccount(db, { id: uuid(1), username: "alice", runs: 3 });
//   await asUser(db, uuid(1), () => db.query("select save_profile('hi', 'KC')"));
//   await asAnon(db, () => db.query("select * from profile_details"));
//
// What it copies from Supabase: the anon/authenticated/service_role roles; auth.users and auth.uid()
// (read from the request.jwt.claim.sub setting, as Supabase's own does); a storage schema with
// buckets, objects (RLS on) and storage.foldername(); and default privileges that give the client roles
// every table and function as it's created, so row-level security and explicit revokes are what
// decide access - exactly as in a real project. test-runs-sql.mjs predates this and keeps its own.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

export const sql = (file) => readFileSync(new URL(`../supabase/${file}`, import.meta.url), "utf8");
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const MIGRATIONS = ["migration-runs-log.sql", "migration-profiles.sql", "migration-moderation.sql", "migration-wallet.sql", "migration-shop.sql"];
// Just v1.11.0's (PROFILES.md), for the tests whose every-function and every-table checks are about those.
export const PROFILE_MIGRATIONS = MIGRATIONS.slice(0, 3);

export async function freshDb({ migrations = MIGRATIONS } = {}) {
  const db = new PGlite();
  await db.exec(`
    -- PGlite takes the machine's time zone, which changes how to_jsonb writes timestamps and what
    -- current_date means. Supabase runs in UTC.
    set timezone = 'UTC';
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner uuid, metadata jsonb, created_at timestamptz not null default now(),
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    -- The folders of an object's path, without the file name: 'a/b/c.png' -> {a,b}.
    create function storage.foldername(name text) returns text[] language sql immutable
      as $$ select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1] $$;

    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant execute on function auth.uid(), storage.foldername(text) to anon, authenticated, service_role;
    grant all on all tables in schema storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  await db.exec(sql("schema.sql"));
  for (const file of migrations) await db.exec(sql(file));
  return db;
}

// Creates an account through the real signup trigger, then sets any other profiles columns given.
export async function addAccount(db, row) {
  await db.query("insert into auth.users values ($1, $2)", [row.id, { username: row.username }]);
  const cols = Object.keys(row).filter((k) => k !== "id" && k !== "username");
  if (!cols.length) return;
  const jsonCols = new Set(["best_run", "best_run_std", "best_record", "recent", "points_day"]);
  const sets = cols.map((c, i) => `${c} = $${i + 2}${jsonCols.has(c) ? "::jsonb" : ""}`).join(", ");
  await db.query(`update profiles set ${sets} where id = $1`, [row.id, ...cols.map((c) => (jsonCols.has(c) ? JSON.stringify(row[c]) : row[c]))]);
}

async function as(db, role, uid, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
// Runs fn as a signed-in player (role authenticated, auth.uid() = uid), then switches back.
export const asUser = (db, uid, fn) => as(db, "authenticated", uid, fn);
// Runs fn as a signed-out visitor (role anon).
export const asAnon = (db, fn) => as(db, "anon", null, fn);

// Runs a statement expected to fail and returns the error message ("" if it didn't fail) - for
// checking a database function's raised code: assert(await failure(db, "select save_profile(...)") === "bio_blocked").
export async function failure(db, statement, params) {
  try {
    await db.query(statement, params);
    return "";
  } catch (e) {
    return String(e?.message || e);
  }
}
