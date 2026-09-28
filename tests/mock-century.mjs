// The test mock's side of Century: supabase/migration-century.sql's century_runs table and its two boards, plus
// the submit-century Edge Function.
//
// The function half is deliberately thin, for the reason mock-versus.mjs's is: every rule lives in
// century-logic.mjs, which the real index.ts calls too, so this file and the server both do the same two small
// things - say who is asking, and write down what replayCentury returned. There is no second copy of the rules
// here to drift from the first.
//
// The BOARD half is not thin, and tests/test-century-sql.mjs holds it to the real SQL row for row, the way
// tests/test-runs-sql.mjs holds the Stats functions: an order that is not fully tiebroken is an order the two
// can disagree about, which is how the missing team tiebreak in most-drafted was found.
import {
  replayCentury, centuryCeiling, centuryOutcome, centuryDailySeed, centuryReservedSeed, CENTURY_SLOTS, CENTURY_GOAL,
} from "../century-logic.mjs";

const CODE = /^[A-Z0-9]{4,16}$/;

// What supabase-js hands a caller for a non-2xx from an Edge Function: an error carrying the Response, which the
// body has to be read out of. Same shape mock-versus.mjs builds.
const httpError = (reason, status, message) => ({
  data: null,
  error: {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: { status, json: async () => ({ error: message || reason, reason }) },
  },
});

// Postgres's `collate "C"` is a byte comparison, not a locale one, so a tiebreak on username has to be compared
// the same way here or the two orders differ on any name with an upper-case letter in it.
const byteCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clampLimit = (n) => Math.max(1, Math.min(Number.isFinite(n) ? Math.trunc(n) : 10, 50));

// state: tests/mock-supabase.mjs's shared state ({ profiles, currentUserId, ... })
export function makeCentury(state, { today = () => new Date().toISOString().slice(0, 10) } = {}) {
  // A Map keyed by id, because tests/mock-supabase.mjs reads every table as `[...store.values()]` - the app calls
  // .from("century_runs") directly for one read (fetchMyCentury), so this has to BE a table, not just a list.
  const table = new Map();
  let nextId = 1;
  const runs = () => [...table.values()]; // rows, snake_case, as the real table
  const add = (row) => { table.set(row.id, row); return row; };
  const clear = () => table.clear();

  const rowsSorted = (list) => list.slice().sort((a, b) => (b.score - a.score)
    || byteCmp(a.created_at, b.created_at)
    || byteCmp(a.username, b.username));

  // ---------- The Edge Function ----------
  async function submitCentury(body) {
    // state.currentUserId is a FUNCTION in tests/mock-supabase.mjs, not a value - the session changes as a test
    // signs in and out, so it has to be asked each time.
    const uid = typeof state.currentUserId === "function" ? state.currentUserId() : state.currentUserId;
    if (!uid) return httpError("unauthorized", 401, "unauthorized");
    const profile = state.profiles.get(uid);
    if (!profile) return httpError("no_profile", 400, "no profile for this account");

    const daily = body?.variant === "daily";
    let seed;
    let day = null;
    if (daily) {
      if (profile.guest) return httpError("guest_daily", 403, "the daily is for accounts");
      day = today();
      seed = centuryDailySeed(day);
      if (body?.day && body.day !== day) return httpError("wrong_day", 400, "a daily submission must be for today");
    } else {
      const code = typeof body?.seed === "string" ? body.seed : "";
      if (!CODE.test(code)) return httpError("bad_code", 400, "missing challenge code");
      if (centuryReservedSeed(code)) return httpError("reserved_code", 400, "that code is reserved");
      seed = code;
    }

    const picks = Array.isArray(body?.picks) ? body.picks : null;
    if (!picks) return httpError("malformed", 400, "malformed submission");
    const clean = picks.slice(0, CENTURY_SLOTS.length + 1).map((m) => ({
      slot: typeof m?.slot === "string" ? m.slot : null,
      name: typeof m?.name === "string" ? m.name : null,
      ...(m?.respun ? { respun: true } : {}),
    }));
    const replay = replayCentury({ seed, picks: clean });
    if (!replay.ok) return httpError(replay.reason, 400, "illegal run");

    // The partial unique index on (day, user_id) where day is not null.
    if (day != null && runs().some((r) => r.day === day && r.user_id === uid)) {
      return httpError("duplicate", 409, "today's Century is already recorded");
    }

    const ceiling = centuryCeiling(seed, replay.respunAt);
    const outcome = centuryOutcome(replay.score);
    const roster = CENTURY_SLOTS.map((slot) => {
      const p = replay.roster[slot];
      return { slot, name: p.name, team: p.team, pos: p.pos, td: p.td };
    });
    add({
      id: nextId++,
      user_id: uid,
      // use_account_username: the name and the guest flag come from the account, not from the request.
      username: profile.username,
      guest: !!profile.guest,
      day, seed, score: replay.score, hit: replay.hit, ceiling, roster, outcome,
      created_at: new Date(Date.now() + nextId).toISOString(),
    });
    return {
      data: {
        ok: true, day, seed, score: replay.score, hit: replay.hit, goal: CENTURY_GOAL,
        ceiling, outcome, roster, teams: replay.teams, respunAt: replay.respunAt,
      },
      error: null,
    };
  }

  // ---------- The two boards ----------
  const centuryTop = ({ p_day, p_limit }) => rowsSorted(runs().filter((r) => r.day === p_day))
    .slice(0, clampLimit(p_limit))
    .map((r) => ({
      id: r.user_id, username: r.username, guest: r.guest,
      score: r.score, hit: r.hit, ceiling: r.ceiling, outcome: r.outcome,
    }));

  const centuryBest = ({ p_limit }) => {
    // One row per account: their best run, daily or Unlimited. Ranked by the same order the SQL's row_number
    // uses - score, then created_at, then id - which is fully tiebroken, so both sides pick the same row.
    const byUser = new Map();
    for (const r of runs()) {
      const list = byUser.get(r.user_id) || [];
      list.push(r);
      byUser.set(r.user_id, list);
    }
    const best = [];
    for (const [, list] of byUser) {
      const ranked = list.slice().sort((a, b) => (b.score - a.score) || byteCmp(a.created_at, b.created_at) || (a.id - b.id));
      const top = ranked[0];
      best.push({
        ...top,
        runs: list.length,
        centuries: list.filter((r) => r.hit).length,
      });
    }
    return rowsSorted(best).slice(0, clampLimit(p_limit)).map((r) => ({
      id: r.user_id, username: r.username, guest: r.guest,
      score: r.score, hit: r.hit, ceiling: r.ceiling, outcome: r.outcome,
      daily: r.day != null, runs: r.runs, centuries: r.centuries,
    }));
  };

  // `tables` is the shape tests/mock-supabase.mjs merges into its own: RLS on with no client write policy, so it
  // hands back what row-level security would for any write. `add` and `clear` are for tests setting a board up.
  return { table, tables: { century_runs: table }, add, clear, runs, submitCentury, centuryTop, centuryBest,
    rpcs: { century_top: centuryTop, century_best: centuryBest } };
}
