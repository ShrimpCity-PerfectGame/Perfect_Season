// The browser's side of Guess the Player: the submit-guess Edge Function and the two boards in
// supabase/migration-guess.sql. The app imports these from ./storage.js.
//
// Nothing here throws: a read that fails is null, a write that fails is { ok: false, reason }. Reads go out as
// GET (READ) so a dropped connection is retried; the submission is a POST and goes out once.
//
// Every refusal the function can answer with is mapped below. A code that reaches the app unmapped is read as
// "network" and shown as "check your connection" - forever, for a rule rather than a fault.
import { getClient, READ } from "./storage-core.js";

const failed = (reason) => ({ ok: false, reason });
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const GUESS_REFUSALS = [
  "duplicate",     // today's game is already recorded for this account
  "guest_daily",   // a guest may not play the daily
  "wrong_day",     // a tab left open past UTC midnight
  "bad_code",      // not a practice code the box would accept
  "malformed",     // no guesses at all
  // replayGuessGame's own reasons. A player should never see one: the screen enforces the same rules from the
  // same module. If one appears, the two have drifted.
  "no_answer", "bad_guesses", "no_guesses", "too_many", "bad_guess", "repeat_guess", "unknown_player",
  "guessed_past_the_end",
];

// Hand in a finished game. `guesses` is the whole of it: the player ids guessed, in order.
//   { ok: true, solved, tries, tried, outcome, answer, rows, day, seed } | { ok: false, reason }
export async function submitGuess({ variant, seed, day, guesses }) {
  try {
    const body = variant === "daily" ? { variant: "daily", day, guesses } : { variant: "practice", seed, guesses };
    const { data, error } = await getClient().functions.invoke("submit-guess", { body });
    if (error) {
      let answer = null;
      try { answer = await error.context?.json?.(); } catch (e) { /* no readable body */ }
      const reason = answer?.reason;
      return failed(GUESS_REFUSALS.includes(reason) ? reason : "network");
    }
    if (!data?.ok) return failed("network");
    return { ok: true, ...data };
  } catch (e) {
    return failed("network");
  }
}

// One day's board, best first.
export async function fetchGuessTop(day, limit = 10) {
  try {
    const { data, error } = await getClient().rpc("guess_top", { p_day: day, p_limit: limit }, READ);
    if (error || !Array.isArray(data)) return null;
    return data.filter((r) => r && typeof r === "object").map((r) => ({
      id: r.id ?? null, username: r.username ?? null, guest: !!r.guest,
      solved: !!r.solved, tries: num(r.tries), outcome: r.outcome ?? null,
    }));
  } catch (e) {
    return null;
  }
}

// All time: how many dailies each account has solved, and how few guesses it takes them.
export async function fetchGuessBest(limit = 10) {
  try {
    const { data, error } = await getClient().rpc("guess_best", { p_limit: limit }, READ);
    if (error || !Array.isArray(data)) return null;
    return data.filter((r) => r && typeof r === "object").map((r) => ({
      id: r.id ?? null, username: r.username ?? null, guest: !!r.guest,
      dailies: num(r.dailies), solved: num(r.solved),
      avgTries: r.avgTries == null ? null : Number(r.avgTries), best: num(r.best),
    }));
  } catch (e) {
    return null;
  }
}

// Whether this account has already played a given day, and how it went - so the tile can say so before anything
// is dealt rather than after eight guesses. guess_runs has public select, so this is an ordinary read.
export async function fetchMyGuess(day) {
  try {
    const client = getClient();
    const { data: session } = await client.auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) return null;
    const { data, error } = await client
      .from("guess_runs")
      .select("solved, tries, outcome, guesses, answer")
      .eq("user_id", userId)
      .eq("day", day)
      .maybeSingle();
    if (error || !data) return null;
    return {
      solved: !!data.solved, tries: num(data.tries), outcome: data.outcome ?? null,
      guesses: Array.isArray(data.guesses) ? data.guesses : [], answer: data.answer ?? null,
    };
  } catch (e) {
    return null;
  }
}
