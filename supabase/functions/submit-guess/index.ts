// Server-side verification for a finished Guess the Player game, and the only writer of public.guess_runs
// (RLS on, no client insert or update policy at all - see migration-guess.sql for why this board is verified
// when Over/Under beside it is not).
//
// It takes the guesses, not the result: a list of player ids, in order. The answer follows from the date alone,
// so it is recomputed here, every guess is checked against the pool, and whether the game was solved and in how
// many is derived from scratch. Nothing the client says about its result is used.
//
// The rules live in guess-logic.mjs, which the browser imports too, for the reason game-logic.mjs is shared: the
// browser colours a row the instant a guess is made while this decides whether the run counts.
//
// What it deliberately does NOT do, exactly as submit-century does not:
//   - touch `profiles`. This board is its own; a game here cannot move a season leaderboard or a streak.
//   - pay the run's coins. The client claims those with claim_minigame('guess', day) once this answers ok, so
//     every coin in the game still moves in one place (SHOP.md).
//
// The daily's date comes from THIS function's clock and is never taken from the client, which is what makes the
// daily the one variant that cannot be ground for an easier answer.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  initGuessData, replayGuessGame, guessOutcome, GUESS_TRIES,
} from "../../../guess-logic.mjs";
import guessPool from "../../../data/guess-pool.json" with { type: "json" };

initGuessData(guessPool);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UNIQUE_VIOLATION = "23505";
// A practice seed is a shareable code, held to the shape the code box accepts rather than to any string that
// fits the column - a seed nobody could type is a seed nobody can be challenged with.
const CODE = /^[A-Z0-9]{4,16}$/;

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const utcToday = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    return await handle(req, json);
  } catch (e) {
    console.error("submit-guess:", e);
    return json({ error: "failed to save" }, 500);
  }
});

async function handle(req: Request, json: (body: unknown, status?: number) => Response) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // The account has to have a profile, for the reason use_account_username raises without one: the name on this
  // board comes from the account, and an account signed in with Google has none until it claims a name.
  const { data: profile, error: profileError } = await service
    .from("profiles").select("id, guest").eq("id", user.id).maybeSingle();
  if (profileError) return json({ error: "failed to save" }, 500);
  if (!profile) return json({ error: "no profile for this account" }, 400);

  const daily = body?.variant === "daily";
  let day: string | null = null;
  let seed: string | null = null;
  if (daily) {
    // A guest may not play the daily, for the reason they may not play the season's: a guest account costs
    // nothing to make, so counting one would hand anybody as many goes at the day's player as they liked.
    if (profile.guest) return json({ error: "the daily is for accounts", reason: "guest_daily" }, 403);
    day = utcToday();
    if (body?.day && body.day !== day) {
      return json({ error: "a daily submission must be for today", reason: "wrong_day" }, 400);
    }
  } else {
    const code = typeof body?.seed === "string" ? body.seed : "";
    if (!CODE.test(code)) return json({ error: "missing practice code", reason: "bad_code" }, 400);
    seed = code;
  }

  // Only strings reach the replay, so nothing else on a submitted array can mean anything. Capped at one more
  // than the game allows, so `too_many` is the answer rather than a megabyte of ids.
  const raw = Array.isArray(body?.guesses) ? body.guesses : null;
  if (!raw) return json({ error: "malformed submission" }, 400);
  const guesses = raw.slice(0, GUESS_TRIES + 1).map((g: any) => (typeof g === "string" ? g : null));

  const replay = replayGuessGame(day ? { date: day, guesses } : { seed, guesses });
  if (!replay.ok) return json({ error: "illegal game", reason: replay.reason }, 400);

  const outcome = guessOutcome(replay.solved, replay.tries);
  const { error: insertError } = await service.from("guess_runs").insert({
    user_id: user.id,
    day,
    seed,
    solved: replay.solved,
    tries: replay.tries,
    guesses: replay.rows.map((r: any) => r.id),
    answer: replay.answer.id,
    outcome,
  });
  if (insertError?.code === UNIQUE_VIOLATION) {
    return json({ error: "today's game is already recorded", reason: "duplicate" }, 409);
  }
  if (insertError) {
    console.error("submit-guess insert:", insertError);
    return json({ error: "failed to save" }, 500);
  }

  return json({
    ok: true,
    day,
    seed,
    solved: replay.solved,
    tries: replay.tries,
    tried: GUESS_TRIES,
    outcome,
    // The answer goes back only now the game is over, which is the one moment it is safe to send: the row was
    // written above, so there is no way to ask for it and then keep playing.
    answer: {
      id: replay.answer.id, name: replay.answer.name, team: replay.answer.team, pos: replay.answer.pos,
      draft: replay.answer.draft, number: replay.answer.number, from: replay.answer.from, to: replay.answer.to,
    },
    rows: replay.rows,
  });
}
