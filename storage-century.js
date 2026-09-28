// The browser's side of Century: the submit-century Edge Function and the two boards in
// supabase/migration-century.sql. The app imports these from ./storage.js.
//
// Nothing here throws: a read that fails is null, a write that fails is { ok: false, reason }. Reads go out as
// GET (READ) so a dropped connection is retried; the submission is a POST and goes out once.
//
// Every refusal the function can answer with is mapped below. That list is not optional and not decoration: a
// code that reaches the app unmapped is read as "network" and shown as "check your connection" - forever, for a
// rule rather than a fault. tests/test-century-screen.mjs holds this map to the function's own source.
import { getClient, READ } from "./storage-core.js";

const failed = (reason) => ({ ok: false, reason });
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Everything submit-century answers with instead of saving. Anything not here is a fault, not a rule.
export const CENTURY_REFUSALS = [
  "duplicate",      // today's daily is already recorded for this account
  "guest_daily",    // a guest may not play the daily
  "wrong_day",      // a tab left open past UTC midnight
  "reserved_code",  // a code that deals a daily's own seven teams
  "bad_code",       // not a code the box would accept
  "malformed",      // no picks at all
  // replayCentury's own reasons, which mean the run as submitted was not legal. A player should never see one:
  // the screen enforces the same rules from the same module. If one appears, the two have drifted.
  "bad_seed", "bad_picks", "wrong_length", "bad_pick", "two_respins", "bad_slot", "slot_taken",
  "not_on_board", "wrong_position", "already_drafted", "no_team",
];

// Hand in a finished run. `picks` is the whole game: seven { slot, name } in the order they were filled, with
// `respun: true` on the one that followed the re-spin.
//
// For the daily, no seed is sent at all - the function derives it from its own clock - and `day` is only the
// day the browser believes it played, so a tab left open past UTC midnight is told rather than recorded against
// a board it never saw.
//   { ok: true, score, hit, goal, ceiling, outcome, roster, teams, respunAt, day, seed }
//   { ok: false, reason }
export async function submitCentury({ variant, seed, day, picks }) {
  try {
    const body = variant === "daily"
      ? { variant: "daily", day, picks }
      : { variant: "unlimited", seed, picks };
    const { data, error } = await getClient().functions.invoke("submit-century", { body });
    if (error) {
      let answer = null;
      try { answer = await error.context?.json?.(); } catch (e) { /* no readable body */ }
      const reason = answer?.reason;
      return failed(CENTURY_REFUSALS.includes(reason) ? reason : "network");
    }
    if (!data?.ok) return failed("network");
    return { ok: true, ...data };
  } catch (e) {
    return failed("network");
  }
}

const mapRow = (r) => ({
  id: r.id ?? null,
  username: r.username ?? null,
  guest: !!r.guest,
  score: num(r.score),
  hit: !!r.hit,
  ceiling: num(r.ceiling),
  outcome: r.outcome ?? null,
});

// One day's Century board, best first. `day` is 'YYYY-MM-DD'.
export async function fetchCenturyTop(day, limit = 10) {
  try {
    const { data, error } = await getClient().rpc("century_top", { p_day: day, p_limit: limit }, READ);
    if (error || !Array.isArray(data)) return null;
    return data.filter((r) => r && typeof r === "object").map(mapRow);
  } catch (e) {
    return null;
  }
}

// The all-time board: every account's best Century run, daily or Unlimited.
export async function fetchCenturyBest(limit = 10) {
  try {
    const { data, error } = await getClient().rpc("century_best", { p_limit: limit }, READ);
    if (error || !Array.isArray(data)) return null;
    return data.filter((r) => r && typeof r === "object").map((r) => ({
      ...mapRow(r),
      daily: !!r.daily,
      runs: num(r.runs),
      centuries: num(r.centuries),
    }));
  } catch (e) {
    return null;
  }
}

// Whether this account has already played a given day's Century, and what it scored - so the tile can say so
// before anything is dealt rather than after seven picks. century_runs has public select, so this is an ordinary
// read; a signed-out visitor has no account to ask about and gets null.
export async function fetchMyCentury(day) {
  try {
    const client = getClient();
    const { data: session } = await client.auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) return null;
    const { data, error } = await client
      .from("century_runs")
      .select("score, hit, ceiling, outcome, roster")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    if (error || !data) return null;
    return {
      score: num(data.score),
      hit: !!data.hit,
      ceiling: num(data.ceiling),
      outcome: data.outcome ?? null,
      roster: Array.isArray(data.roster) ? data.roster : [],
    };
  } catch (e) {
    return null;
  }
}
