// The crash sink's only writer (docs/superpowers/specs/2026-10-05-client-error-sink-design.md).
//
// It exists to do one thing the client cannot be trusted with: SCRUB. error-boundary.jsx's report carries
// location.pathname, and /u/<name> is a username - so a report stored straight from the browser would put a
// name in the database with nobody looking. The crashed client is the last code that should be asked to
// remove it, which is why this function exists rather than an insert policy on public.client_errors.
//
// It is deliberately NOT authenticated (verify_jwt = false in supabase/config.toml, like the other five): a
// crash can happen signed out, and a guest's crash matters as much as anyone's. That makes it an open
// endpoint, bounded by the hourly cap below rather than by who is asking.
//
// It touches nothing but client_errors. No profile, no wallet, no board.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// These are the table's CHECK bounds (migration-client-errors.sql) restated, so a report is trimmed to fit
// rather than refused by Postgres. If they drift apart the insert fails and the report is lost, which is
// why tests/test-client-errors-sql.mjs drives every one of them at its edge.
const MAX = { version: 40, message: 500, stack: 2000, component: 1000, entry: 300, extra: 120, kind: 40, before: 5, browser: 80 };
const RATE_PER_HOUR = 200;
// A second ceiling, on TOTAL rows rather than rate. The hourly cap bounds how FAST this grows and says
// nothing about how BIG it gets: 200/hr across the 90-day window is 432,000 rows, and one row can reach
// ~23 KB because the caps above count code points while the column checks count characters - four bytes
// each for astral text. That is roughly 10 GB reachable from an endpoint anybody can POST to, and a full
// Supabase project goes READ-ONLY, which stops the whole game. The crash sink taking the site down would
// be a poor trade for catching crashes. 10,000 rows is ~235 MB at that worst case, and far more reports
// than anyone will ever read.
const MAX_ROWS = 10_000;
const KEEP_DAYS = 90;

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Cap by CODE POINT, not by UTF-16 unit. Slicing at a fixed length can cut an emoji in half and leave a lone
// surrogate, which is invalid UTF-8 - Postgres refuses the whole row, turning one bad crash report into no
// crash report at all. Array.from iterates code points, so the cut always lands between characters.
function cap(v: unknown, n: number): string | null {
  if (typeof v !== "string" || !v) return null;
  const points = Array.from(v);
  return points.length <= n ? v : points.slice(0, n).join("");
}

// A near-miss must become `other`, NEVER itself. A default that passes an unrecognised path through is the
// leak this whole function exists to close, wearing a disguise - so this matches exact shapes and nothing
// else: no prefix matching, no startsWith, no trailing-segment tolerance.
function screenOf(path: unknown): string {
  if (typeof path !== "string") return "other";
  if (path === "/") return "home";
  if (path === "/leaderboard") return "leaderboard";
  if (path === "/how-to-play") return "rules";
  // One segment after the prefix, and that segment carries no slash and no query. /u/Name?tab=x is not a
  // pathname a browser produces, but the client is not trusted to have sent a pathname at all.
  if (/^\/u\/[^/?#]+$/.test(path)) return "profile";
  if (/^\/c\/[^/?#]+$/.test(path)) return "challenge";
  if (/^\/vs\/[^/?#]+$/.test(path)) return "duel";
  return "other";
}

// Browser plus major version plus platform, and nothing else. The raw user-agent is a fingerprint; this is
// the part anybody would actually act on ("it only happens on Android Chrome"). Edge is checked before
// Chrome because its UA contains both.
function browserOf(ua: unknown): string {
  if (typeof ua !== "string" || !ua.trim()) return "unknown";
  const m = (re: RegExp) => re.exec(ua)?.[1];
  const name = m(/Edg\/(\d+)/) ? `Edge ${m(/Edg\/(\d+)/)}`
    : m(/Chrome\/(\d+)/) ? `Chrome ${m(/Chrome\/(\d+)/)}`
    : m(/Firefox\/(\d+)/) ? `Firefox ${m(/Firefox\/(\d+)/)}`
    : m(/Version\/(\d+).*Safari/) ? `Safari ${m(/Version\/(\d+).*Safari/)}`
    : "unknown";
  const os = /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod|iOS/.test(ua) ? "iOS"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "unknown";
  return cap(`${name} / ${os}`, MAX.browser)!;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const version = cap(body?.version, MAX.version);
  const message = cap(body?.message, MAX.message);
  // The two fields without which a row says nothing. Everything else may be absent - a crash with no stack
  // is still worth recording.
  if (!version || !message) return json({ error: "malformed report" }, 400);
  if (body?.before != null && !Array.isArray(body.before)) return json({ error: "malformed report" }, 400);
  if (body?.path != null && typeof body.path !== "string") return json({ error: "malformed report" }, 400);

  const before = Array.isArray(body.before)
    ? body.before.slice(0, MAX.before).map((e: any) => ({
        kind: cap(e?.kind, MAX.kind), message: cap(e?.message, MAX.entry), extra: cap(e?.extra, MAX.extra),
      }))
    : null;

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // A GLOBAL cap rather than a per-IP one. Per-IP means storing an address hash, which is the one thing the
  // rest of this design spends its effort not storing. Its ceiling is real and accepted: a flood fills the
  // hour and genuine crashes are dropped. The upgrade, if it is ever needed, is a daily-salted IP hash - the
  // pattern /privacy already describes for the visit counter, so the policy language exists.
  // Retention FIRST, before the counts and before any early return. It used to sit after the insert, which
  // meant the moment the table hit MAX_ROWS the drop returned above it and the prune could never run again -
  // crash reporting switching itself off for good, and rows outliving the 90 days /privacy promises. A
  // failure here must still never fail the report, so it stays wrapped.
  // Retention FIRST, before the counts and before any early return. Put after the insert it becomes a dead
  // end: the moment the table reaches MAX_ROWS the drop returns above it, the prune can never run again,
  // crash reporting switches itself off for good, and rows outlive the 90 days /privacy promises. Run here
  // it also heals a table that is already full. A failure must never fail the report, so it stays wrapped.
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  try { await service.from("client_errors").delete().lt("created_at", cutoff); } catch (e) { /* carry on */ }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await service.from("client_errors").select("id", { count: "exact", head: true }).gte("created_at", since);
  const { count: total } = await service.from("client_errors").select("id", { count: "exact", head: true });
  // Answered ok, not refused: the browser can do nothing about the cap and must not retry. `dropped` is
  // there so a test - and only a test - can tell the two apart.
  if ((count ?? 0) >= RATE_PER_HOUR || (total ?? 0) >= MAX_ROWS) return json({ ok: true, dropped: true });

  const { error } = await service.from("client_errors").insert({
    version, kind: "crash", message,
    stack: cap(body?.stack, MAX.stack),
    component: cap(body?.component, MAX.component),
    before,
    // Capped BEFORE the regexes run: the Safari pattern backtracks badly over a long string full of
    // near-matches, and the body is whatever anyone cares to POST.
    browser: browserOf(cap(body?.ua, 400)),
    screen: screenOf(body?.path),
  });
  if (error) {
    // The one class of failure this function cannot record is its own, so it goes to the platform log the
    // way the other five functions log theirs.
    console.error("report-error: insert failed:", error.message);
    return json({ error: "failed to record" }, 500);
  }

  return json({ ok: true });
});
