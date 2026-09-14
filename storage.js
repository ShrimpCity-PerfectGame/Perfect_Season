// Two independent seams:
//  - window.storage (get/set/delete): personal, per-device data only (draft-in-progress
//    snapshots, the daily-done flag, the howto-seen flag). Backed by localStorage in
//    production (entry.jsx), an in-memory mock in tests (tests/helpers.mjs's makeStorage()).
//  - the Supabase client (auth + "profiles"/"daily_runs"/"sou_runs" tables): all sitewide/shared data -
//    accounts, stats, the leaderboard. Backed by a real @supabase/supabase-js client in
//    production, an in-memory mock in tests (tests/helpers.mjs's makeMockAuth()), reached via
//    window.__ps_supabase__ so tests never need a real network call or project.
export async function sget(key, shared) {
  try { const r = await window.storage.get(key, shared); return r && r.value ? JSON.parse(r.value) : null; }
  catch (e) { return null; }
}
export async function sset(key, val, shared) {
  try { const r = await window.storage.set(key, JSON.stringify(val), shared); return !!r; }
  catch (e) { return false; }
}
export async function sdel(key, shared) {
  try { await window.storage.delete(key, shared); } catch (e) { /* already gone */ }
}
// Clearing a saved draft overwrites it first, then deletes. If the delete doesn't land, the
// empty snapshot still fails validDraft, so a finished draft can't come back as "5 of 6 picked".
export async function clearDraft(key) {
  await sset(key, { cleared: true, history: [] }, false);
  await sdel(key, false);
}

// ---------- Supabase client seam ----------
// SUPABASE_URL/SUPABASE_ANON_KEY are bare identifiers, textually replaced at build time by
// build.mjs's esbuild `define` (same mechanism as the existing NODE_ENV define) - never read
// from process.env directly here, since this module is bundled for the browser. The real
// client is only ever constructed lazily (not at module load) so tests - which always install
// window.__ps_supabase__ before mounting - never hit this branch or need the identifiers defined.
import { createClient } from "@supabase/supabase-js";
let _client = null;
function getClient() {
  if (typeof window !== "undefined" && window.__ps_supabase__) return window.__ps_supabase__;
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

// ---------- Auth ----------
export async function authSignUp(email, password, username) {
  return getClient().auth.signUp({ email, password, options: { data: { username } } });
}
export async function authSignIn(email, password) {
  return getClient().auth.signInWithPassword({ email, password });
}
export async function authSignOut() {
  return getClient().auth.signOut();
}
export async function authGetSession() {
  return getClient().auth.getSession();
}
export function authOnChange(cb) {
  return getClient().auth.onAuthStateChange(cb);
}
// Maps a Supabase-shaped error to the same friendly copy the old PBKDF2 flow used to show.
export function mapAuthError(error) {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "23505" || /username/i.test(error.message || "")) return "That username is taken. Try another one.";
  if (/already registered|already exists/i.test(error.message || "")) return "An account with that email already exists.";
  return "The account couldn't be created. Check your connection and try again.";
}

// ---------- Profiles (stats) and daily runs ----------
// DB columns are snake_case; the rest of the app works with the same camelCase shape
// blankStats() always produced, so every profile row is translated at this boundary.
function rowToProfile(row) {
  if (!row) return null;
  return {
    username: row.username, runs: row.runs || 0, dnf: row.dnf || 0, wins: row.wins || 0, losses: row.losses || 0,
    champs: row.champs || 0, perfect: row.perfect || 0, playoffs: row.playoffs || 0,
    bestScore: row.best_score ?? null, bestRun: row.best_run ?? null, bestRecord: row.best_record ?? null,
    bestScoreStd: row.best_score_std ?? null, bestRunStd: row.best_run_std ?? null,
    points: {
      daily: row.points_daily || 0, unlimited: row.points_unlimited || 0,
      genius: row.points_genius || 0, gm: row.points_gm || 0,
    },
    pointsBank: row.points_bank || 0, pointsDay: row.points_day ?? null,
    recent: row.recent || [], dailyStreak: row.daily_streak || 0, dailyLast: row.daily_last ?? null,
    dailyBestStreak: row.daily_best_streak || 0, id: row.id,
  };
}
function profileToRow(s) {
  return {
    username: s.username, runs: s.runs, dnf: s.dnf, wins: s.wins, losses: s.losses,
    champs: s.champs, perfect: s.perfect, playoffs: s.playoffs,
    best_score: s.bestScore, best_run: s.bestRun, best_record: s.bestRecord, recent: s.recent || [],
    best_score_std: s.bestScoreStd, best_run_std: s.bestRunStd,
    points_daily: s.points?.daily || 0, points_unlimited: s.points?.unlimited || 0,
    points_genius: s.points?.genius || 0, points_gm: s.points?.gm || 0,
    points_bank: s.pointsBank || 0, points_day: s.pointsDay ?? null,
    daily_streak: s.dailyStreak, daily_last: s.dailyLast, daily_best_streak: s.dailyBestStreak,
  };
}
// Which profiles column ranks each scoring format. Mirrors game-logic.mjs's BEST_FIELDS on the
// DB-column side of the boundary.
const BEST_COL = { fantasy: "best_score", standard: "best_score_std" };
const bestCol = (format) => BEST_COL[format] || BEST_COL.fantasy;
// ...and which column ranks each points ladder.
const LADDER_COL = { daily: "points_daily", unlimited: "points_unlimited", genius: "points_genius", gm: "points_gm" };

export async function fetchProfile(userId) {
  const { data } = await getClient().from("profiles").select("*").eq("id", userId).single();
  return rowToProfile(data);
}

// profiles and daily_runs are no longer client-writable at all (see supabase/schema.sql's RLS) -
// the client never computes its own score/outcome/DNF-count for persistence. Both of these call
// the submit-run Edge Function, which independently replays the draft trace (or, for a DNF, just
// applies the increment) and recomputes everything server-side before writing - see
// game-logic.mjs's replayDraft/simulateSeason and supabase/functions/submit-run.
export async function submitRun(trace) {
  const { data, error } = await getClient().functions.invoke("submit-run", { body: trace });
  if (error) return { ok: false };
  return data;
}
// `mode` is the ladder the abandoned draft belonged to, so the points penalty lands on the right
// board. It's a tag rather than a claim about a roster - the server falls back to "unlimited" for
// anything it doesn't recognize.
export async function submitDnf(picks, mode) {
  const { data, error } = await getClient().functions.invoke("submit-run", { body: { dnf: true, picks, mode } });
  if (error) return false;
  return !!data?.ok;
}

export async function fetchLeaderboardTop(limit = 10, format = "fantasy") {
  const col = bestCol(format);
  const { data, error } = await getClient().from("profiles").select("*").not(col, "is", null).order(col, { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map(rowToProfile);
}
// How many players sit strictly above this score in the same format - callers add 1 for a
// 1-based rank. Ranking across formats would be meaningless: the two score different things.
export async function fetchOwnRank(score, format = "fantasy") {
  const col = bestCol(format);
  // Counted server-side (head: no rows come back) rather than downloading every profile to count
  // them here.
  const { count, error } = await getClient().from("profiles").select("id", { count: "exact", head: true }).gt(col, score);
  return error || count == null ? 0 : count;
}

// Where one season lands among every logged season in its format, from the runs log: how many
// scored strictly higher, and how many there are. Two HEAD counts, retried by supabase-js if a
// request drops. null if either fails - the result screen then just leaves the rank out.
const loggedSeasons = (format) => getClient().from("runs").select("id", { count: "exact", head: true })
  .eq("format", format).eq("dnf", false);
export async function fetchSeasonRank(score, format = "fantasy") {
  const [above, all] = await Promise.all([loggedSeasons(format).gt("score", score), loggedSeasons(format)]);
  if (above.error || all.error || above.count == null || all.count == null) return null;
  return { above: above.count, total: all.count };
}
// Title-winning seasons in this format scoring at or below this one - i.e. this season's position
// on the Biggest upsets board once it's logged (lowest score first, earlier ties ahead of it).
export async function fetchUpsetRank(score, format = "fantasy") {
  const { count, error } = await loggedSeasons(format).eq("champ", true).lte("score", score);
  return error || count == null ? null : count;
}
// One points ladder. Only players who have actually earned on it are listed - a table full of
// zeroes from accounts that never played the mode isn't a leaderboard.
export async function fetchLadderTop(mode = "unlimited", limit = 10) {
  const col = LADDER_COL[mode] || LADDER_COL.unlimited;
  const { data, error } = await getClient().from("profiles").select("*").gt(col, 0).order(col, { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map(rowToProfile);
}
// supabase-js retries a dropped GET/HEAD by itself (up to 3 times, 1s/2s/4s apart) but never a POST,
// and .rpc() POSTs by default. Both Stats functions only read, so they're called as GET (`get: true`,
// allowed because they're declared STABLE) to get that same retry. Keep it that way for any new
// read-only RPC; writes stay POST and go out exactly once.
const READ = { get: true };

// Summed in the database (site_totals(), supabase/migration-runs-log.sql) - one small row back
// instead of a column from every account. Returns null when it can't be loaded, never zeros: a
// failed request must not show up as "0 drafts".
export async function fetchSiteTotals() {
  const { data, error } = await getClient().rpc("site_totals", {}, READ);
  if (error || !data) return null;
  return { runs: Number(data.runs) || 0, perfect: Number(data.perfect) || 0, players: Number(data.players) || 0 };
}
export async function fetchDailyTop(date, limit = 10, format = "fantasy") {
  const { data, error } = await getClient().from("daily_runs").select("*").eq("date", date).eq("format", format).order("score", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({ username: r.username, w: r.w, l: r.l, score: r.score, outcome: r.outcome }));
}
export async function fetchSouTop(date, limit = 10) {
  const { data, error } = await getClient().from("sou_runs").select("*").eq("date", date).order("score", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({ username: r.username, score: r.score }));
}
export async function upsertSouRun(date, userId, row) {
  const { error } = await getClient().from("sou_runs").insert({ date, user_id: userId, username: row.username, score: row.score });
  return !error;
}

// Build-a-player is stat-free for the player's own account (see playBapSim's own comment in
// perfect-season.jsx) - this is a separate, additive, sitewide-only tally logged once a build
// completes, purely for the Stats screen's "created players" count and "highest-OVR" leaderboard.
export async function logBuild(userId, { username, pos, overall, filled }) {
  const { error } = await getClient().from("builds").insert({ user_id: userId, username, pos, overall, filled });
  return !error;
}
export async function fetchTopBuilds(limit = 10) {
  const { data, error } = await getClient().from("builds").select("*").order("overall", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({ username: r.username, pos: r.pos, overall: r.overall, filled: r.filled }));
}
export async function fetchBuildCount() {
  const { count, error } = await getClient().from("builds").select("*", { count: "exact", head: true });
  return error || count == null ? 0 : count;
}

// Every Stats-screen board, computed in the database by site_stats() (supabase/migration-runs-log.sql)
// over every account and every logged run - not a browser-side pass over a recent sample. Career
// boards come from profiles; per-run boards (most-drafted, GM scores, biggest upsets) from the
// runs log. Returns the shape the Stats screen renders, or null if the request failed.
const EMPTY_FORMAT = { bestLineups: [], bestGm: [], biggestUpsets: [] };
export async function fetchSiteStats(limit = 10) {
  const { data, error } = await getClient().rpc("site_stats", { p_limit: limit }, READ);
  if (error || !data) return null;
  const profilesOf = (rows) => (rows || []).map(rowToProfile);
  const byFormat = {};
  for (const [f, v] of Object.entries(data.by_format || {})) {
    byFormat[f] = { bestLineups: profilesOf(v.best_lineups), bestGm: v.best_gm || [], biggestUpsets: v.biggest_upsets || [] };
  }
  return {
    totals: { runs: Number(data.totals?.runs) || 0, perfect: Number(data.totals?.perfect) || 0, players: Number(data.totals?.players) || 0 },
    byFormat: { fantasy: byFormat.fantasy || EMPTY_FORMAT, standard: byFormat.standard || EMPTY_FORMAT },
    mostDrafted: data.most_drafted || [],
    mostWins: profilesOf(data.most_wins),
    mostChamps: profilesOf(data.most_champs),
    mostPlayoffs: profilesOf(data.most_playoffs),
    longestStreaks: profilesOf(data.longest_streaks),
    bestWinPct: (data.best_win_pct || []).map((r) => ({ ...rowToProfile(r), pct: Number(r.pct) })),
    avgWinPct: Number(data.avg_win_pct) || 0,
  };
}

// One channel, two live concerns: a concurrent-players count via Supabase Realtime Presence
// (every open tab - no auth needed, guests count too - joins and "tracks" itself; every tab gets
// a "sync" event with the full presence set whenever anyone joins/leaves), and a live
// total-drafts tick via Realtime broadcast (every tab that finishes a draft tells every other
// open tab to bump its count by one - optimistic, not re-fetched, since this is a fun live
// number, not a ledger). Unlike every other export here, this is a long-lived subscription, not
// a one-shot request, so it returns an unsubscribe function (call it on unmount) alongside a
// broadcaster for the "a draft just finished" side.
export function subscribeSiteActivity({ onOnlineCount, onDraftFinished }) {
  const client = getClient();
  // self: true - Supabase doesn't echo a broadcast back to its sender by default, and the tab that
  // just finished a draft should count it too (see loadLeaderboard's setLiveDrafts for the other half).
  const channel = client.channel("site-activity", { config: { broadcast: { self: true } } });
  channel.on("presence", { event: "sync" }, () => onOnlineCount(Object.keys(channel.presenceState()).length));
  channel.on("broadcast", { event: "draft_finished" }, onDraftFinished);
  channel.subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({}); });
  return {
    unsubscribe: () => client.removeChannel(channel),
    broadcastDraftFinished: () => channel.send({ type: "broadcast", event: "draft_finished", payload: {} }),
  };
}
