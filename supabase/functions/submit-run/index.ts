// Server-side verification for a finished draft. The client no longer writes its own computed
// score/outcome directly - it submits the raw draft trace (mode + history + seq), and this
// function independently re-derives the seed, replays the trace for roster legality, and
// recomputes the score/season outcome using the exact same game-logic.mjs the client runs (see
// that file's own header comment for why one shared module matters here). Only this function's
// service-role client can write profiles/daily_runs from here on - see supabase/schema.sql's RLS
// policies, which now block direct client writes to those tables.
//
// Scope (see CLAUDE.md's tamper-resistance note and the plan behind this feature): closes
// "fabricate any score" and "claim an impossible roster" for both Daily and Unlimited/challenge-
// code mode. Daily's seed is derived from this function's own clock, never trusted from the
// client, so Daily is fully closed. Unlimited/challenge-code mode's `mode.code` is still
// client-chosen, so grinding many codes offline for a lucky legitimate outcome remains possible -
// an accepted, documented gap, not solved by this function.
//
// From v1.12.0 (SHOP.md 4.2) a finished draft also counts only once - a challenge code finishes
// one season per account, as a Daily already did - and a finished season pays coins and any badges
// it earned. The amounts come from rewards.mjs, the same file the browser shows them from, and only
// this function's service role can pay them (credit_coins and award_badges in
// supabase/migration-wallet.sql).
import { createClient } from "npm:@supabase/supabase-js@2";
import * as GL from "../../../game-logic.mjs";
import { seasonReward, badgeRewards, coinsSummary } from "../../../rewards.mjs";
import { badgeProgress } from "../../../badges.mjs";
import { mapPlayerStats } from "../../../profile-rules.mjs";
import gameData from "../../../data/players.json" with { type: "json" };

GL.initGameData(gameData.players, gameData.opponents);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Postgres's unique_violation, which PostgREST passes through as the error's code: the one insert
// failure that means "this draft is already recorded" rather than "the save failed".
const UNIQUE_VIOLATION = "23505";

// Edge Functions don't add CORS headers on their own - the browser calls this cross-origin (the
// Vercel-hosted app calling *.supabase.co), so every response (including the preflight OPTIONS
// the browser sends first) needs these or the fetch is blocked before this code even sees it.
// Echoing the request's own Origin (rather than a literal "*") is the standard-compliant form -
// a literal wildcard is invalid/ignored by the browser for a credentialed request, which supabase-
// js's fetch turned out to be here even though this function only reads the Bearer token, not a
// cookie - reflecting the real Origin works for both credentialed and non-credentialed requests.
function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Mirrors storage.js's rowToProfile/profileToRow - duplicated rather than imported, since
// storage.js is written for the browser client (window.__ps_supabase__, etc.) and this is the
// only piece of it this function needs; the mapping itself is a fixed schema contract, not game
// logic, so it doesn't carry the same drift risk that motivated sharing game-logic.mjs.
function rowToProfile(row: any) {
  return {
    runs: row?.runs || 0, dnf: row?.dnf || 0, wins: row?.wins || 0, losses: row?.losses || 0,
    champs: row?.champs || 0, perfect: row?.perfect || 0, playoffs: row?.playoffs || 0,
    bestScore: row?.best_score ?? null, bestRun: row?.best_run ?? null, bestRecord: row?.best_record ?? null,
    bestScoreStd: row?.best_score_std ?? null, bestRunStd: row?.best_run_std ?? null,
    points: {
      daily: row?.points_daily || 0, unlimited: row?.points_unlimited || 0,
      genius: row?.points_genius || 0, gm: row?.points_gm || 0,
    },
    pointsBank: row?.points_bank || 0, pointsDay: row?.points_day ?? null,
    recent: row?.recent || [], dailyStreak: row?.daily_streak || 0, dailyLast: row?.daily_last ?? null,
    dailyBestStreak: row?.daily_best_streak || 0,
  };
}
function profileToRow(s: any) {
  return {
    runs: s.runs, dnf: s.dnf, wins: s.wins, losses: s.losses,
    champs: s.champs, perfect: s.perfect, playoffs: s.playoffs,
    best_score: s.bestScore, best_run: s.bestRun, best_record: s.bestRecord, recent: s.recent || [],
    best_score_std: s.bestScoreStd, best_run_std: s.bestRunStd,
    points_daily: s.points?.daily || 0, points_unlimited: s.points?.unlimited || 0,
    points_genius: s.points?.genius || 0, points_gm: s.points?.gm || 0,
    points_bank: s.pointsBank || 0, points_day: s.pointsDay ?? null,
    daily_streak: s.dailyStreak, daily_last: s.dailyLast, daily_best_streak: s.dailyBestStreak,
  };
}

// The client's todayKey() (perfect-season.jsx) uses the player's LOCAL calendar date; this
// function runs in Deno's own timezone (UTC on Supabase's infra). A player anywhere off UTC can
// have a different local "today" than the server's for a several-hour window each day (worse the
// further from UTC), so this can't require an exact match - it accepts any date that some real
// timezone offset (UTC-12 to UTC+14) could call "today" relative to the server's actual UTC
// instant: UTC's own yesterday, today, or tomorrow. Still rejects an arbitrary backdated claim
// (anything outside that 3-day window), which is all the seed-legitimacy check actually needs.
function utcDateKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function isPlausibleDailyDate(date: string) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return [-1, 0, 1].some((offset) => utcDateKey(new Date(now + offset * DAY)) === date);
}

// Appends to the runs log (supabase/migration-runs-log.sql) AFTER the profile is saved. The two
// writes aren't one transaction, and that's deliberate: the profile is the player's own record, so a
// failure here is logged and swallowed rather than failing a season that already counted. The
// unique (user_id, created_at, dnf) key makes a duplicate a no-op, not an error.
async function logRun(service: any, row: any) {
  const { error } = await service.from("runs").upsert(row, { onConflict: "user_id,created_at,dnf", ignoreDuplicates: true });
  if (error) console.error("runs log insert failed:", error.message);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let bodyRaw: any;
  try { bodyRaw = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // A DNF (abandoned/reset draft) has no roster or score to verify - just apply the increment.
  // A fabricated DNF count only makes an account's own stats look worse, not a leaderboard
  // integrity issue, but profiles still isn't client-writable at all, so this goes through here too.
  if (bodyRaw?.dnf) {
    const { data: row } = await service.from("profiles").select("*").eq("id", user.id).single();
    if (!row) return json({ error: "no profile for this account" }, 400);
    // The mode is a tag, not a claim about a roster - it only decides which ladder eats the
    // penalty, and lying about it can only move your own penalty sideways, never erase it.
    // applyDnf falls back to unlimited for anything unrecognized.
    const updated = GL.applyDnf(rowToProfile(row), Number(bodyRaw.picks) || 0, bodyRaw.mode);
    const { error: writeError } = await service.from("profiles").update(profileToRow(updated)).eq("id", user.id);
    if (writeError) return json({ error: "failed to save" }, 500);
    await logRun(service, GL.runLogRow(user.id, row.username, updated.recent[0]));
    return json({ ok: true });
  }

  const { mode, history, seq, gm: rawGm, genius: rawGenius, format: rawFormat } = bodyRaw || {};
  // A Daily is never GM or Genius - the app offers neither on it - so those flags are ignored there rather than
  // trusted: a GM flag would score the Daily's ladder points against the easier par of a bot drafting under the
  // cap, and put the Daily on the GM Stats board.
  const gm = mode?.kind === "daily" ? false : !!rawGm;
  const genius = mode?.kind === "daily" ? false : !!rawGenius;
  if (!mode || !Array.isArray(history) || !Array.isArray(seq)) return json({ error: "malformed submission" }, 400);

  // Read only from the top level, never mode.format - the format selects both the seed and the
  // scoring formula, so having two places it could come from would just be an ambiguity to probe.
  // An unrecognized value is rejected outright (same footing as mode.kind below), but a MISSING
  // one is allowed and means fantasy: that's what lets a client from before this feature shipped
  // keep submitting normally during a deploy.
  if (rawFormat != null && !GL.FORMATS.includes(rawFormat)) {
    return json({ error: "unknown scoring format" }, 400);
  }
  const format = GL.normFormat(rawFormat);

  // Never trust a client-supplied seed directly - re-derive it exactly how startDraft() does
  // (perfect-season.jsx), so a fabricated seed or a backdated "daily" claim can't be smuggled in.
  // The date itself still comes from the client (its own local calendar day, same as the boards
  // it actually drafted from), only bounds-checked against the server's clock - see
  // isPlausibleDailyDate's comment for why an exact match with the server's own "today" is wrong.
  let seed: string;
  if (mode.kind === "daily") {
    if (typeof mode.date !== "string" || !isPlausibleDailyDate(mode.date)) {
      return json({ error: "a daily submission must be for today" }, 400);
    }
    // The two formats' dailies are deliberately different drafts, so playing one doesn't spoil
    // the other's boards. Derived here, never taken from the client.
    seed = GL.dailySeed(mode.date, format);
  } else if (mode.kind === "free") {
    // finished_codes holds a code of at most 32 characters (the app's own are 4 to 8), so a longer
    // one is refused here, before the replay, rather than by that insert after it.
    if (typeof mode.code !== "string" || !mode.code || mode.code.length > 32) return json({ error: "missing challenge code" }, 400);
    seed = mode.code;
  } else {
    return json({ error: "unknown mode" }, 400);
  }

  const replay = GL.replayDraft(seed, history, seq);
  if (!replay.ok) return json({ error: "illegal roster", reason: replay.reason }, 400);
  const roster = replay.roster;

  let tot = 0, wt = 0;
  for (const s of GL.SLOTS) { const k = s === "QB" ? GL.QB_WEIGHT : 1; tot += GL.effectiveRating(s, roster[s], format) * k; wt += k; }
  const score = Math.round((tot / wt) * 10) / 10;
  const lineup = GL.SLOTS.map((s) => `${roster[s].id}${roster[s].season}`).join("|");
  const sim = GL.withSeed(`${seed}#${lineup}`, () => GL.simulateSeason(score));

  // Recomputed from the server-verified roster, not accepted from the client - capUsed feeds a
  // competitive Stats-screen leaderboard (the GM-mode cap constraint), so it needs the same
  // trust level as score/outcome, not the client's own report.
  const finalCapUsed = gm ? GL.SLOTS.reduce((sum, s) => sum + GL.playerSalary(roster[s], format), 0) : undefined;
  // And a GM season has to fit under the cap. The app never lets a pick past it (a player the cap can't cover
  // can't be locked in), but whether a draft was GM is the client's word: without this, any roster could be sent
  // as GM - topping the GM board, and scoring its ladder points (and their coins) against a par the bot drafted
  // under the cap. Refused before anything is written, like any other illegal roster.
  if (gm && finalCapUsed > GL.GM_CAP) return json({ error: "illegal roster", reason: "over the salary cap" }, 400);

  // Par and points are recomputed here from the verified board sequence, exactly like score and
  // capUsed - the client never gets to say how well it did against the bot. The bot plays the
  // boards actually drafted from (history[].key), so a reroll moves par with it.
  const par = GL.botPar(history.map((h: any) => h.key), { format, gm: !!gm });
  const points = GL.draftPoints(score, par);

  const run = {
    w: sim.w, l: sim.l, score, outcome: sim.outcome, champ: sim.champ, perfect: sim.perfect, playoffs: sim.playoffs,
    date: Date.now(),
    roster: GL.SLOTS.map((s) => ({
      slot: s, name: roster[s].name, team: roster[s].team, season: roster[s].season,
      ppr: roster[s].ppr, rating: GL.effectiveRating(s, roster[s], format),
    })),
    mode: mode.kind, code: mode.kind === "free" ? mode.code : undefined,
    gm: !!gm, genius: !!genius, capUsed: finalCapUsed,
    // Always stamped, "fantasy" included, so the Stats screen can filter on it without having to
    // treat an absent tag as a third case.
    format,
    par: par ?? undefined, points,
  };

  const { data: existingRow } = await service.from("profiles").select("*").eq("id", user.id).single();
  if (!existingRow) return json({ error: "no profile for this account" }, 400);

  // Daily is one draft per day per format (CLAUDE.md's "Protect the daily") - the client's own
  // dailyDone flag is just a courtesy gate, not a security boundary. Insert into daily_runs FIRST
  // and rely on its (date, format, user_id) primary key to atomically reject a duplicate/raced
  // resubmission - profiles must never be updated before this succeeds, or a raced second request
  // would double-count wins/losses. Including `format` in the key is what lets the two formats'
  // dailies coexist while each stays one-per-day.
  //
  // Only a unique violation means the draft is already recorded - the app tells the player so,
  // instead of offering a retry - so any other failure is a failed save.
  if (mode.kind === "daily") {
    const { error: dailyInsertError } = await service.from("daily_runs").insert({
      date: mode.date, format, user_id: user.id, username: existingRow.username,
      w: run.w, l: run.l, score, outcome: run.outcome,
    });
    if (dailyInsertError?.code === UNIQUE_VIOLATION) return json({ error: "today's daily is already recorded", reason: "duplicate" }, 409);
    if (dailyInsertError) return json({ error: "failed to save" }, 500);
  } else {
    // A challenge code the same way, through finished_codes' (user_id, code) primary key: one
    // finished season per code per account, whichever variant or format it was played in. Without
    // it the same finished draft counted - and would now pay - every time it was sent.
    const { error: codeInsertError } = await service.from("finished_codes").insert({ user_id: user.id, code: mode.code });
    if (codeInsertError?.code === UNIQUE_VIOLATION) return json({ error: "this draft is already recorded", reason: "duplicate" }, 409);
    if (codeInsertError) return json({ error: "failed to save" }, 500);
  }

  const existing = rowToProfile(existingRow);
  // The best-of-the-day window is keyed on THIS function's own UTC date, never the client's, so
  // the window can't be widened by claiming a different day.
  let updated = GL.applyRun(existing, run, utcDateKey(new Date()));
  if (mode.kind === "daily") {
    const streak = GL.nextStreak(existing, mode.date);
    updated = { ...updated, dailyLast: mode.date, dailyStreak: streak, dailyBestStreak: Math.max(streak, existing.dailyBestStreak || 0) };
  }

  const { error: writeError } = await service.from("profiles").update(profileToRow(updated)).eq("id", user.id);
  if (writeError) {
    // The season didn't count, so give back what the duplicate guard took - the challenge code, or
    // this Daily's daily_runs row - and let a retry count it. Best effort: if this fails as well, a
    // retry answers "already recorded" (as a failed Daily save always did before v1.12.0).
    const release = mode.kind === "daily"
      ? service.from("daily_runs").delete().eq("date", mode.date).eq("format", format).eq("user_id", user.id)
      : service.from("finished_codes").delete().eq("user_id", user.id).eq("code", mode.code);
    const { error: releaseError } = await release;
    if (releaseError) console.error("duplicate guard release failed:", releaseError.message);
    return json({ error: "failed to save" }, 500);
  }
  await logRun(service, GL.runLogRow(user.id, existingRow.username, run, mode.kind === "daily" ? mode.date : null));

  // The season's coins, then the coins for any badge the player now has. The season has already
  // counted, so a failure here is logged and answered as `coins: null` rather than an error - and
  // nothing is lost for good: a credit that went through stays paid, and an unpaid badge pays with
  // the next finished season. supabase-js hands back { data, error } instead of throwing, so each
  // error is thrown here to reach the catch.
  let coins: unknown = null;
  let newBadges: string[] = [];
  try {
    const reward = seasonReward(run, { date: mode.date, streak: updated.dailyStreak });
    // The season's credit and the badges' two reads don't depend on each other, so they go out together; only
    // award_badges waits, so the balance it answers with includes the season. The badges come from the same inputs
    // the profile screen uses. player_stats reads the runs log, which logRun above has normally just added this
    // season to, so a badge this season earned (a Cinderella title, a Scout draft) pays now rather than a season
    // later. It only reads, so it goes out as a GET and gets supabase-js's retry.
    const [
      { data: credit, error: creditError },
      { data: stats, error: statsError },
      { data: details, error: detailsError },
    ] = await Promise.all([
      service.rpc("credit_coins", {
        p_user: user.id, p_amount: reward.amount, p_kind: reward.kind, p_ref: reward.ref, p_daily_cap: reward.dailyCap,
      }),
      service.rpc("player_stats", { p_user_id: user.id }, { get: true }),
      service.from("profile_details").select("favorite_team").eq("user_id", user.id).maybeSingle(),
    ]);
    if (creditError) throw new Error(`credit_coins: ${creditError.message}`);
    if (statsError) throw new Error(`player_stats: ${statsError.message}`);
    if (detailsError) throw new Error(`profile_details: ${detailsError.message}`);
    const progress = badgeProgress({
      stats: updated, extra: mapPlayerStats(stats), details: { favoriteTeam: details?.favorite_team ?? null }, joined: existingRow.created_at,
    });
    const { data: awards, error: awardError } = await service.rpc("award_badges", { p_user: user.id, p_badges: badgeRewards(progress) });
    if (awardError) throw new Error(`award_badges: ${awardError.message}`);

    coins = coinsSummary({ ...credit, lines: reward.lines }, awards);
    newBadges = Array.isArray(awards?.awarded) ? awards.awarded : [];
  } catch (e) {
    console.error("coins failed:", e instanceof Error ? e.message : e);
    coins = null;
    newBadges = [];
  }

  // `coins` and `newBadges` are new; a client from before them reads `ok` and `run` as it always did.
  return json({ ok: true, run, coins, newBadges });
});
