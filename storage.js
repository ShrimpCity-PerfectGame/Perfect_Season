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
// The client, the read-retry option and the profile row mapping live in storage-core.js, shared
// with the feature modules re-exported at the bottom of this file.
import { getClient, READ, rowToProfile } from "./storage-core.js";

// ---------- Auth ----------
export async function authSignUp(email, password, username) {
  return getClient().auth.signUp({ email, password, options: { data: { username } } });
}
export async function authSignIn(email, password) {
  return getClient().auth.signInWithPassword({ email, password });
}
// A guest: Supabase's anonymous sign-in, taken when a visitor finishes a season so it can go on the
// leaderboard (migration-profiles.sql gives the account its profile and its name). Nothing is asked of
// them, and nothing is kept but the account itself - which they can turn into a real one later.
export async function authSignInAsGuest() {
  return getClient().auth.signInAnonymously();
}

// Signing in with Google. The page leaves for Google and comes back to `redirectTo`, where supabase-js
// reads the session out of the address by itself - no password ever passes through here. An account
// arriving this way has no profile until it claims a name (storage-profile.js's claimUsername).
export async function authSignInWithGoogle(redirectTo) {
  return getClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
}
// A guest keeping what it has played: the email and password go onto the same account, so nothing it has
// done is left behind. Supabase may ask them to confirm the address; the account works meanwhile.
export async function authAddEmail(email, password) {
  return getClient().auth.updateUser({ email, password });
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
// Rows are translated to the app's camelCase shape by storage-core.js's rowToProfile.
// Which profiles column ranks each scoring format. Mirrors game-logic.mjs's BEST_FIELDS on the
// DB-column side of the boundary.
const BEST_COL = { fantasy: "best_score", standard: "best_score_std" };
const bestCol = (format) => BEST_COL[format] || BEST_COL.fantasy;
// ...and which column ranks each points ladder.
const LADDER_COL = { daily: "points_daily", unlimited: "points_unlimited", genius: "points_genius", gm: "points_gm" };

// `null` means the account genuinely has no profile row, which is a real and ordinary state: an account
// signed in with Google has none until it claims a name (PROFILES.md). A read that FAILED is not that, and
// until this threw they were the same value - which is how one dropped read could sign you out of your own
// account and post your next season as a guest, lock a named account behind the un-dismissable "pick a name"
// dialog, and leave a guest who had just traded up still being refused the daily under their new name.
//
// It is not rare enough to ignore: postgrest-js retries a GET only on a dropped connection or a 503/520, so
// a 500, 502, 504 or 429 from PostgREST or the edge lands here as a plain error, and so does any outage
// lasting past its ~7 seconds of backoff.
export async function fetchProfile(userId) {
  const { data, error } = await getClient().from("profiles").select("*").eq("id", userId).single();
  // PostgREST answers `.single()` with no rows as PGRST116. That is the answer, not a failure.
  if (error && error.code !== "PGRST116") {
    const failed = new Error("the profile could not be read");
    failed.cause = error;
    failed.profileReadFailed = true;
    throw failed;
  }
  return rowToProfile(data);
}

// profiles and daily_runs are no longer client-writable at all (see supabase/schema.sql's RLS) -
// the client never computes its own score/outcome/DNF-count for persistence. Both of these call
// the submit-run Edge Function, which independently replays the draft trace (or, for a DNF, just
// applies the increment) and recomputes everything server-side before writing - see
// game-logic.mjs's replayDraft/simulateSeason and supabase/functions/submit-run.
// On success, the function's answer: { ok: true, run, coins, newBadges } (SHOP.md 4.2 - coins is null when
// the season counted but its coins couldn't be paid). A refusal comes back as an HTTP error whose body names
// a reason; the only one the app treats differently is "duplicate" (this draft already counted).
export async function submitRun(trace) {
  const { data, error } = await getClient().functions.invoke("submit-run", { body: trace });
  if (error) {
    let body = null;
    try { body = await error.context?.json?.(); } catch (e) { /* no readable body */ }
    return body?.reason === "duplicate" ? { ok: false, reason: "duplicate" } : { ok: false };
  }
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
// 1-based rank - or null when the count can't be had. Never 0 on a failure: that would show #1.
// Ranking across formats would be meaningless: the two score different things.
export async function fetchOwnRank(score, format = "fantasy") {
  const col = bestCol(format);
  // Counted server-side (head: no rows come back) rather than downloading every profile to count
  // them here.
  try {
    const { count, error } = await getClient().from("profiles").select("id", { count: "exact", head: true }).gt(col, score);
    return error || count == null ? null : count;
  } catch (e) {
    return null;
  }
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
// Both Stats functions only read, so they go out as GET (storage-core.js's READ) and get supabase-js's
// automatic retry. Keep it that way for any new read-only RPC; writes stay POST and go out exactly once.

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
  return data.map((r) => ({ username: r.username, score: r.score, guest: !!r.guest }));
}
// Whether this account has already played a given day. The primary key (date, user_id) is what really
// enforces "one run a day"; the app's own flag is in PERSONAL, per-device storage, so a phone after a
// laptop knew nothing about it - and dealt a whole second run, showed the score, and dropped it with no
// error and no coins, because upsertSouRun is a plain insert whose answer nobody read.
export async function fetchMySouRun(date, userId) {
  if (!userId) return null;
  const { data, error } = await getClient().from("sou_runs").select("*").eq("date", date).eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return { score: data.score };
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
// builds was browser-written with no checks before 1.11.0, so an old row can hold a numeric NaN (PostgREST
// sends it as the string "NaN", which sorts first) or a made-up position. Those can't be shown - and a
// string overall once crashed the whole Stats screen - so only a finite overall at a real position comes
// back, as a number.
const BUILD_POSITIONS = ["QB", "RB", "WR", "TE"];
export async function fetchTopBuilds(limit = 10) {
  // Filtered in the QUERY, not after it. `limit` runs in Postgres, so taking the top ten and then
  // dropping the rows the screen can't show left fewer than ten - or, with enough of them, "No builds
  // yet" over a full table. A NaN numeric sorts above every real number in Postgres, which is what put
  // them at the top in the first place, and `overall < 1e12` is false for NaN, so this excludes them.
  // check_new_build only guards new rows ("nothing updates a build but a rename"), so the old bad ones
  // are permanent and this is what keeps them off the board.
  const { data, error } = await getClient().from("builds").select("*")
    .in("pos", BUILD_POSITIONS)
    .lt("overall", 1e12)
    .gt("overall", -1e12)
    .order("overall", { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return data
    .map((r) => ({ username: r.username, guest: !!r.guest, pos: r.pos, overall: Number(r.overall), filled: r.filled }))
    .filter((b) => Number.isFinite(b.overall) && BUILD_POSITIONS.includes(b.pos));
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

// ---------- Profiles, pictures and moderation (v1.11.0) ----------
// Their own modules, so they can be built and tested separately; re-exported here so the app keeps
// importing everything from "./storage.js". See PROFILES.md for the contract.
export * from "./storage-profile.js";
export * from "./storage-moderation.js";
// ---------- Coins and the shop (v1.12.0) ----------
// See SHOP.md.
export * from "./storage-shop.js";
// ---------- 1v1 (v1.19.0) ----------
// See VERSUS.md.
export * from "./storage-versus.js";
