// Server-side verification for a finished Century run, and the only writer of public.century_runs (RLS on, no
// client insert or update policy at all - see migration-century.sql for why this mode is verified when Over/Under
// beside it is not).
//
// It takes the trace, not the score: seven (slot, player) pairs and at most one re-spin. That is the whole game,
// so the seven teams are recomputed here from the seed, every pick is checked against the board it was really
// dealt from, and the touchdowns are added up from this function's own copy of data/season-2025.json. Nothing the
// client says about which teams it saw, which players were on them or what the total came to is used.
//
// The rules live in century-logic.mjs, which the browser imports too, for the reason game-logic.mjs is shared: a
// rule enforced on one side and not the other will drift, and here the browser shows a score the instant the
// seventh slot is filled while this decides whether it counts.
//
// What it deliberately does NOT do:
//   - touch `profiles`. Century keeps its own board, so a run here cannot move a season leaderboard, a best
//     score, a streak or a badge. That is also why this is a function of its own rather than an arm of
//     submit-run: nothing about the season path changes to add a mode.
//   - pay the RUN's coins. The client claims those with claim_minigame('century', day) once this answers ok,
//     exactly as Over/Under and Build-a-player do, so every coin in the game still moves in one place (SHOP.md).
//
// It does award ONE badge, and only from a daily that reached the goal. That is deliberate: submit-run pays
// every other badge from player_stats, and it would pay this one too - but only on the player's next finished
// SEASON, which somebody who plays Century and nothing else may never have. This function witnessed the run, so
// it records it. award_badges is idempotent per (user, badge) and badge_rewards decides the amount, so nothing
// here can pay twice or pay the wrong number.
//
// The daily's seed comes from THIS function's clock and is never taken from the client - the same rule
// submit-run's daily has, and the reason the daily is the one variant that cannot be ground for a lucky board.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  initCenturyData, replayCentury, centuryCeiling, centuryOutcome, centuryDailySeed, centuryReservedSeed,
  CENTURY_SLOTS, CENTURY_GOAL,
} from "../../../century-logic.mjs";
import { BADGE_BY_ID } from "../../../badges.mjs";
import seasonPool from "../../../data/season-2025.json" with { type: "json" };

initCenturyData(seasonPool);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Postgres's unique_violation, as PostgREST passes it through: the one insert failure that means "this run is
// already recorded" rather than "the save failed".
const UNIQUE_VIOLATION = "23505";
// An Unlimited seed is a shareable code, so it is held to the shape the code box accepts rather than to any
// string that fits the column - a seed nobody could type is a seed nobody can be challenged with.
const CODE = /^[A-Z0-9]{4,16}$/;

// Same reasoning as submit-run's: Edge Functions add no CORS headers of their own, the browser calls this
// cross-origin, and the request's own Origin is echoed rather than a literal wildcard because supabase-js's
// fetch is credentialed.
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
    console.error("submit-century:", e);
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
  // board comes from the account, and an account signed in with Google has no profile until it claims a name.
  // Asked here so the answer is a sentence rather than a trigger's exception.
  const { data: profile, error: profileError } = await service
    .from("profiles").select("id, guest").eq("id", user.id).maybeSingle();
  if (profileError) return json({ error: "failed to save" }, 500);
  if (!profile) return json({ error: "no profile for this account" }, 400);

  const daily = body?.variant === "daily";
  let seed: string;
  let day: string | null = null;
  if (daily) {
    // A guest may not play the daily, for the reason they may not play the season's: a guest account costs
    // nothing to make, so counting one would hand anybody as many goes at the day's seven teams as they liked.
    // They may play Unlimited and they do earn coins - the refusal is the board, not the mode.
    if (profile.guest) return json({ error: "the daily is for accounts", reason: "guest_daily" }, 403);
    day = utcToday();
    seed = centuryDailySeed(day);
    // The client sends the day it believes it played so a stale tab is told so rather than silently recorded
    // against a board it never saw. The seed is this function's either way.
    if (body?.day && body.day !== day) {
      return json({ error: "a daily submission must be for today", reason: "wrong_day" }, 400);
    }
  } else {
    const code = typeof body?.seed === "string" ? body.seed : "";
    if (!CODE.test(code)) return json({ error: "missing challenge code", reason: "bad_code" }, 400);
    // A code that HASHES to a daily's seed deals that daily's seven teams bit for bit, so the check is on the
    // hash and not the spelling - hashStr is FNV-1a/32 and invertible, which makes such a code findable in about
    // a second. Same protection the main daily has (isReservedCode), and the browser refuses it first for the
    // same reason: a run that is never submitted was never asked about.
    if (centuryReservedSeed(code)) return json({ error: "that code is reserved", reason: "reserved_code" }, 400);
    seed = code;
  }

  const picks = Array.isArray(body?.picks) ? body.picks : null;
  if (!picks) return json({ error: "malformed submission" }, 400);
  // Only the two fields a move is allowed to carry reach the replay, so nothing else on a submitted object can
  // mean anything. `respun` is taken as a boolean, not as whatever truthy value was sent.
  const clean = picks.slice(0, CENTURY_SLOTS.length + 1).map((m: any) => ({
    slot: typeof m?.slot === "string" ? m.slot : null,
    name: typeof m?.name === "string" ? m.name : null,
    ...(m?.respun ? { respun: true } : {}),
  }));

  const replay = replayCentury({ seed, picks: clean });
  if (!replay.ok) return json({ error: "illegal run", reason: replay.reason }, 400);

  const ceiling = centuryCeiling(seed, replay.respunAt);
  const outcome = centuryOutcome(replay.score);
  // What the board shows back: the slot, who filled it, from which team, and what he was worth. Derived from the
  // replay, so it is this function's account of the run and not the client's.
  const roster = CENTURY_SLOTS.map((slot) => {
    const p = replay.roster[slot];
    return { slot, name: p.name, team: p.team, pos: p.pos, td: p.td };
  });

  const { error: insertError } = await service.from("century_runs").insert({
    user_id: user.id,
    day,
    seed,
    score: replay.score,
    hit: replay.hit,
    ceiling,
    roster,
    outcome,
  });
  if (insertError?.code === UNIQUE_VIOLATION) {
    return json({ error: "today's Century is already recorded", reason: "duplicate" }, 409);
  }
  if (insertError) {
    console.error("submit-century insert:", insertError);
    return json({ error: "failed to save" }, 500);
  }

  // The badge, and only for a daily that got there. Unlimited is unlimited, so a hundred ground out over an
  // evening of retries is not the achievement the daily's single go is (badges.mjs says the same in words).
  // A failure here never fails the run: the run is recorded, and submit-run will award the badge from
  // player_stats the next time a season finishes.
  let badge = null;
  if (day && replay.hit) {
    try {
      const { data, error } = await service.rpc("award_badges", {
        p_user: user.id,
        p_badges: [{ id: "century", coins: BADGE_BY_ID.century?.coins ?? 0 }],
      });
      if (error) console.error("submit-century award_badges:", error);
      else if (Array.isArray(data?.awarded) && data.awarded.length) badge = { awarded: data.awarded, credited: data.credited, balance: data.balance };
    } catch (e) {
      console.error("submit-century award_badges:", e);
    }
  }

  return json({
    ok: true,
    badge,
    day,
    seed,
    score: replay.score,
    hit: replay.hit,
    goal: CENTURY_GOAL,
    ceiling,
    outcome,
    roster,
    teams: replay.teams,
    respunAt: replay.respunAt,
  });
}
