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
import { createClient } from "npm:@supabase/supabase-js@2";
import * as GL from "../../../game-logic.mjs";
import gameData from "../../../data/players.json" with { type: "json" };

GL.initGameData(gameData.players, gameData.opponents);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
    recent: row?.recent || [], dailyStreak: row?.daily_streak || 0, dailyLast: row?.daily_last ?? null,
    dailyBestStreak: row?.daily_best_streak || 0,
  };
}
function profileToRow(s: any) {
  return {
    runs: s.runs, dnf: s.dnf, wins: s.wins, losses: s.losses,
    champs: s.champs, perfect: s.perfect, playoffs: s.playoffs,
    best_score: s.bestScore, best_run: s.bestRun, best_record: s.bestRecord, recent: s.recent || [],
    daily_streak: s.dailyStreak, daily_last: s.dailyLast, daily_best_streak: s.dailyBestStreak,
  };
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

Deno.serve(async (req) => {
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
    const updated = GL.applyDnf(rowToProfile(row), Number(bodyRaw.picks) || 0);
    const { error: writeError } = await service.from("profiles").update(profileToRow(updated)).eq("id", user.id);
    if (writeError) return json({ error: "failed to save" }, 500);
    return json({ ok: true });
  }

  const { mode, history, seq, gm, capUsed } = bodyRaw || {};
  if (!mode || !Array.isArray(history) || !Array.isArray(seq)) return json({ error: "malformed submission" }, 400);

  // Never trust a client-supplied seed directly - re-derive it exactly how startDraft() does
  // (perfect-season.jsx), so a fabricated seed or a backdated "daily" claim can't be smuggled in.
  let seed: string;
  if (mode.kind === "daily") {
    const today = todayKey();
    if (mode.date !== today) return json({ error: "a daily submission must be for today" }, 400);
    seed = `daily-${today}`;
  } else if (mode.kind === "free") {
    if (typeof mode.code !== "string" || !mode.code) return json({ error: "missing challenge code" }, 400);
    seed = mode.code;
  } else {
    return json({ error: "unknown mode" }, 400);
  }

  // The daily is one draft per day (CLAUDE.md's "Protect the daily") - the client's own dailyDone
  // flag is just a courtesy gate, not a security boundary, so re-check here: if today's daily_runs
  // row for this account already exists, reject outright rather than double-counting wins/losses
  // into profiles on a retried or replayed submission.
  if (mode.kind === "daily") {
    const { data: already } = await service.from("daily_runs").select("date").eq("date", mode.date).eq("user_id", user.id).maybeSingle();
    if (already) return json({ error: "today's daily is already recorded" }, 409);
  }

  const replay = GL.replayDraft(seed, history, seq);
  if (!replay.ok) return json({ error: "illegal roster", reason: replay.reason }, 400);
  const roster = replay.roster;

  let tot = 0, wt = 0;
  for (const s of GL.SLOTS) { const k = s === "QB" ? GL.QB_WEIGHT : 1; tot += GL.effectiveRating(s, roster[s]) * k; wt += k; }
  const score = Math.round((tot / wt) * 10) / 10;
  const lineup = GL.SLOTS.map((s) => `${roster[s].id}${roster[s].season}`).join("|");
  const sim = GL.withSeed(`${seed}#${lineup}`, () => GL.simulateSeason(score));

  const run = {
    w: sim.w, l: sim.l, score, outcome: sim.outcome, champ: sim.champ, perfect: sim.perfect, playoffs: sim.playoffs,
    date: Date.now(),
    roster: GL.SLOTS.map((s) => ({
      slot: s, name: roster[s].name, team: roster[s].team, season: roster[s].season,
      ppr: roster[s].ppr, rating: GL.effectiveRating(s, roster[s]),
    })),
    mode: mode.kind, code: mode.kind === "free" ? mode.code : undefined,
    gm: !!gm, capUsed: gm ? capUsed : undefined,
  };

  const { data: existingRow } = await service.from("profiles").select("*").eq("id", user.id).single();
  if (!existingRow) return json({ error: "no profile for this account" }, 400);

  // For daily mode, insert into daily_runs FIRST and rely on its (date, user_id) primary key to
  // atomically reject a genuine race (two near-simultaneous submissions for the same daily) -
  // the earlier check above only closes the common case, not a true race, so profiles must never
  // be updated before this succeeds, or a raced second request would double-count wins/losses.
  if (mode.kind === "daily") {
    const { error: dailyInsertError } = await service.from("daily_runs").insert({
      date: mode.date, user_id: user.id, username: existingRow.username,
      w: run.w, l: run.l, score, outcome: run.outcome,
    });
    if (dailyInsertError) return json({ error: "today's daily is already recorded" }, 409);
  }

  const existing = rowToProfile(existingRow);
  let updated = GL.applyRun(existing, run);
  if (mode.kind === "daily") {
    const streak = GL.nextStreak(existing, mode.date);
    updated = { ...updated, dailyLast: mode.date, dailyStreak: streak, dailyBestStreak: Math.max(streak, existing.dailyBestStreak || 0) };
  }

  const { error: writeError } = await service.from("profiles").update(profileToRow(updated)).eq("id", user.id);
  if (writeError) return json({ error: "failed to save" }, 500);

  return json({ ok: true, run });
});
