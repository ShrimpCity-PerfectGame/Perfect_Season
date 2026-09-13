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
    recent: row.recent || [], dailyStreak: row.daily_streak || 0, dailyLast: row.daily_last ?? null,
    dailyBestStreak: row.daily_best_streak || 0, id: row.id,
  };
}
function profileToRow(s) {
  return {
    username: s.username, runs: s.runs, dnf: s.dnf, wins: s.wins, losses: s.losses,
    champs: s.champs, perfect: s.perfect, playoffs: s.playoffs,
    best_score: s.bestScore, best_run: s.bestRun, best_record: s.bestRecord, recent: s.recent || [],
    daily_streak: s.dailyStreak, daily_last: s.dailyLast, daily_best_streak: s.dailyBestStreak,
  };
}

export async function fetchProfile(userId) {
  const { data } = await getClient().from("profiles").select("*").eq("id", userId).single();
  return rowToProfile(data);
}
export async function updateProfile(userId, s) {
  const { error } = await getClient().from("profiles").update(profileToRow(s)).eq("id", userId);
  return !error;
}

export async function fetchLeaderboardTop(limit = 10) {
  const { data, error } = await getClient().from("profiles").select("*").not("best_score", "is", null).order("best_score", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map(rowToProfile);
}
// How many players sit strictly above this score - callers add 1 for a 1-based rank.
export async function fetchOwnRank(score) {
  const { data, error } = await getClient().from("profiles").select("*");
  if (error || !data) return 0;
  return data.filter((r) => r.best_score != null && r.best_score > score).length;
}
export async function fetchSiteTotals() {
  const { data, error } = await getClient().from("profiles").select("*");
  const rows = error || !data ? [] : data;
  const totals = rows.reduce((t, r) => ({ runs: t.runs + (r.runs || 0) + (r.dnf || 0), perfect: t.perfect + (r.perfect || 0) }), { runs: 0, perfect: 0 });
  return { ...totals, players: rows.length };
}
export async function fetchDailyTop(date, limit = 10) {
  const { data, error } = await getClient().from("daily_runs").select("*").eq("date", date).order("score", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({ username: r.username, w: r.w, l: r.l, score: r.score, outcome: r.outcome }));
}
export async function upsertDailyRun(date, userId, row) {
  const { error } = await getClient().from("daily_runs").insert({ date, user_id: userId, username: row.username, w: row.w, l: row.l, score: row.score, outcome: row.outcome });
  return !error;
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

// Hall of fame's "most-drafted players" needs every roster anyone's actually drafted, not just
// each profile's single best one - the closest available signal is each profile's own `recent`
// (their last 10 finished runs). Deliberately bounded to the most-recently-active profiles
// (order + limit) rather than an unbounded full-table scan, since this is new code with no
// existing precedent to match.
export async function fetchRecentRosters(limit = 300) {
  const { data, error } = await getClient().from("profiles").select("recent").order("updated_at", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.flatMap((r) => r.recent || []).filter((run) => !run.dnf && run.roster);
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
  const channel = client.channel("site-activity");
  channel.on("presence", { event: "sync" }, () => onOnlineCount(Object.keys(channel.presenceState()).length));
  channel.on("broadcast", { event: "draft_finished" }, onDraftFinished);
  channel.subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({}); });
  return {
    unsubscribe: () => client.removeChannel(channel),
    broadcastDraftFinished: () => channel.send({ type: "broadcast", event: "draft_finished", payload: {} }),
  };
}
