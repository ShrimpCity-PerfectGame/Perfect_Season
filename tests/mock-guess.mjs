// The test mock's side of Guess the Player: supabase/migration-guess.sql's guess_runs and its two boards, plus
// the submit-guess Edge Function.
//
// The function half is thin on purpose, for the reason mock-century.mjs's is: every rule lives in
// guess-logic.mjs, which the real index.ts calls too, so this and the server do the same two small things - say
// who is asking, and write down what replayGuessGame returned.
//
// The BOARD half is not thin, and tests/test-guess-sql.mjs holds it to the real SQL row for row.
import { replayGuessGame, guessOutcome, GUESS_TRIES } from "../guess-logic.mjs";
import { GUESS_BADGE_TRIES, BADGE_BY_ID } from "../badges.mjs";

const CODE = /^[A-Z0-9]{4,16}$/;

const httpError = (reason, status, message) => ({
  data: null,
  error: {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: { status, json: async () => ({ error: message || reason, reason }) },
  },
});

// Postgres's `collate "C"` is a byte comparison, not a locale one.
const byteCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clampLimit = (n) => Math.max(1, Math.min(Number.isFinite(n) ? Math.trunc(n) : 10, 50));
// Postgres rounds numeric to 2 decimals with round(x, 2); JS has to be told to.
const round2 = (n) => Math.round(n * 100) / 100;

export function makeGuess(state, { today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const table = new Map();
  let nextId = 1;
  const runs = () => [...table.values()];
  const add = (row) => { table.set(row.id, row); return row; };
  const clear = () => table.clear();

  async function submitGuessRun(body) {
    const uid = typeof state.currentUserId === "function" ? state.currentUserId() : state.currentUserId;
    if (!uid) return httpError("unauthorized", 401, "unauthorized");
    const profile = state.profiles.get(uid);
    if (!profile) return httpError("no_profile", 400, "no profile for this account");

    const daily = body?.variant === "daily";
    let day = null;
    let seed = null;
    if (daily) {
      if (profile.guest) return httpError("guest_daily", 403, "the daily is for accounts");
      day = today();
      if (body?.day && body.day !== day) return httpError("wrong_day", 400, "a daily submission must be for today");
    } else {
      const code = typeof body?.seed === "string" ? body.seed : "";
      if (!CODE.test(code)) return httpError("bad_code", 400, "missing practice code");
      seed = code;
    }

    const raw = Array.isArray(body?.guesses) ? body.guesses : null;
    if (!raw) return httpError("malformed", 400, "malformed submission");
    const guesses = raw.slice(0, GUESS_TRIES + 1).map((g) => (typeof g === "string" ? g : null));
    const replay = replayGuessGame(day ? { date: day, guesses } : { seed, guesses });
    if (!replay.ok) return httpError(replay.reason, 400, "illegal game");

    if (day != null && runs().some((r) => r.day === day && r.user_id === uid)) {
      return httpError("duplicate", 409, "today's game is already recorded");
    }

    const outcome = guessOutcome(replay.solved, replay.tries);
    add({
      id: nextId++,
      user_id: uid,
      // use_account_username: the name and the guest flag come from the account, not from the request.
      username: profile.username,
      guest: !!profile.guest,
      day, seed, solved: replay.solved, tries: replay.tries,
      guesses: replay.rows.map((r) => r.id), answer: replay.answer.id, outcome,
      created_at: new Date(Date.now() + nextId).toISOString(),
    });
    // Bullseye, exactly as supabase/functions/submit-guess/index.ts awards it: the DAILY only, solved in
    // GUESS_BADGE_TRIES or fewer, and idempotent per account the way award_badges is. The mock never modelled
    // this, so the end screen's badge line had no jsdom coverage at all.
    let badge = null;
    if (day && replay.solved && replay.tries <= GUESS_BADGE_TRIES) {
      const already = state.badgeAwards?.has?.(`${uid}|bullseye`);
      if (!state.badgeAwards) state.badgeAwards = new Set();
      state.badgeAwards.add(`${uid}|bullseye`);
      const coins = BADGE_BY_ID.bullseye?.coins ?? 0;
      badge = { awarded: ["bullseye"], credited: already ? 0 : coins, balance: null };
    }
    const a = replay.answer;
    return {
      data: {
        ok: true, badge, day, seed, solved: replay.solved, tries: replay.tries, tried: GUESS_TRIES, outcome,
        answer: { id: a.id, name: a.name, team: a.team, pos: a.pos, draft: a.draft, number: a.number, from: a.from, to: a.to },
        rows: replay.rows,
      },
      error: null,
    };
  }

  // Solved first, then fewest guesses, then earliest, then the name by byte.
  const guessTop = ({ p_day, p_limit }) => runs()
    .filter((r) => r.day === p_day)
    .sort((a, b) => (Number(b.solved) - Number(a.solved)) || (a.tries - b.tries)
      || byteCmp(a.created_at, b.created_at) || byteCmp(a.username, b.username))
    .slice(0, clampLimit(p_limit))
    .map((r) => ({ id: r.user_id, username: r.username, guest: r.guest, solved: r.solved, tries: r.tries, outcome: r.outcome }));

  const guessBest = ({ p_limit }) => {
    const byUser = new Map();
    for (const r of runs()) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
      byUser.get(r.user_id).push(r);
    }
    const out = [];
    for (const [uid, list] of byUser) {
      const dailies = list.filter((r) => r.day != null);
      if (!dailies.length) continue; // `having count(*) filter (where day is not null) > 0`
      const solvedRuns = dailies.filter((r) => r.solved);
      out.push({
        id: uid,
        // max(username) and bool_or(guest) - every row of an account carries the same values, the trigger sees to it.
        username: list.map((r) => r.username).sort(byteCmp).pop(),
        guest: list.some((r) => r.guest),
        dailies: dailies.length,
        solved: solvedRuns.length,
        avgTries: solvedRuns.length ? round2(solvedRuns.reduce((n, r) => n + r.tries, 0) / solvedRuns.length) : null,
        // min() over no rows is NULL in Postgres, not 0 - an account that has never solved one has no best.
        best: solvedRuns.length ? Math.min(...solvedRuns.map((r) => r.tries)) : null,
      });
    }
    // `avg_tries nulls last` - an account that has played but never solved sorts below one that has.
    return out
      .sort((a, b) => (b.solved - a.solved)
        || ((a.avgTries == null) - (b.avgTries == null))
        || ((a.avgTries ?? 0) - (b.avgTries ?? 0))
        || byteCmp(a.username, b.username))
      .slice(0, clampLimit(p_limit));
  };

  return {
    table, tables: { guess_runs: table }, add, clear, runs, submitGuessRun,
    rpcs: { guess_top: guessTop, guess_best: guessBest },
  };
}
