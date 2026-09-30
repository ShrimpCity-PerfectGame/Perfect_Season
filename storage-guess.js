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

// The refusals a held game may be re-sent after. Each is "not your fault, and it may not be true in a
// minute": the radio was off, the function fell over, the session had lapsed, the name was not claimed
// yet. Every OTHER reason is the server's verdict on the game itself and re-sending cannot change it.
//
// `network` stays OFF this list on purpose, and v2.18.2 did not move it: it is what submitGuess answers
// when a reason came back that this client cannot read, and a newer function's verdict must not be
// re-sent for ever. What v2.18.2 fixed is that `network` was also carrying failures that are not
// verdicts at all - see submitGuess, where they are now told apart.
export const GUESS_RETRY = ["offline", "server", "signed_out", "no_profile"];

export const GUESS_REFUSALS = [
  "duplicate",     // today's game is already recorded for this account
  "guest_daily",   // a guest may not play the daily
  "wrong_day",     // a tab left open past UTC midnight
  "bad_code",      // not a practice code the box would accept
  "malformed",     // no guesses at all, or a body the function could not read
  "signed_out",    // the session expired while the game was being played
  "no_profile",    // signed in, but the account has never claimed a name
  // These two are the pair v2.18.2 had to tell apart, and the comment below used to sit on the wrong one
  // of them - which is a fair account of how they came to be confused in the first place.
  "server",        // the function answered, or the platform did: something on that side went wrong
  "offline",       // nothing came back that could be read, so nothing reached the function at all
  // replayGuessGame's own reasons. A player should never see one: the screen enforces the same rules from the
  // same module. If one appears, the two have drifted.
  "no_answer", "bad_guesses", "no_guesses", "too_many", "bad_guess", "repeat_guess", "unknown_player", "short_loss",
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
      let readable = true;
      try { answer = await error.context?.json?.(); } catch (e) { readable = false; }
      const reason = answer?.reason;
      if (GUESS_REFUSALS.includes(reason)) return failed(reason);
      // No body at all is the shape of a request that never arrived or never came back.
      if (!readable || !answer) return failed("offline");
      // A body that names a reason this client does not know is a NEWER function's verdict on the game,
      // and re-sending it cannot change the answer - that is `network`, and the outbox retires it.
      //
      // A body that names NO reason never came from the function: every answer it gives a POST names one
      // (submit-guess/index.ts). So this is the platform in between - the Functions relay, a gateway, a
      // worker that failed to boot - which is transient and is worth another go. Until v2.18.2 both
      // landed on `network` together, so the outbox threw away a played daily on exactly the failure it
      // was written to survive, and marked it `unrecorded`, which nothing reads: the day vanished in
      // silence. It is `server` because that is what it is, and because that is already the reason the
      // screen renders as "on us, not your connection".
      return failed(reason ? "network" : "server");
    }
    // The function answers a POST with `{ ok: true }` or with an error status. A 200 that is neither is
    // the platform again - a truncated or rewritten response - not a verdict, so it is worth re-sending.
    if (!data?.ok) return failed("server");
    return { ok: true, ...data };
  } catch (e) {
    // invoke() threw: DNS, TLS, CORS, a dead radio. Nothing reached the function.
    return failed("offline");
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
