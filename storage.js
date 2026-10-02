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
import { captchaToken, captchaConfigured } from "./captcha.mjs";

// ---------- Auth ----------

// Supabase's CAPTCHA setting is per PROJECT and covers sign-in, sign-up, password reset and the anonymous
// sign-in all at once, so every one of those calls has to be able to carry a token before the switch is
// flipped. With no site key captcha.mjs answers null and these behave exactly as they did - see the note at
// the top of that file about the order the two halves ship in.
//
// A null token when a key IS configured means the challenge could not be reached or would not answer: a
// blocked CDN, a proxy, an ad blocker. Sending the call anyway would get Supabase's own captcha refusal,
// which reaches the player as a bare "Something went wrong" - so it is turned into a sentence here instead,
// in the shape every other auth call answers in.
const CAPTCHA_FAILED = {
  message: "The anti-robot check didn't load. Turn off any ad blocker for this site and try again.",
  __captcha: true,
};
async function withCaptcha(options = {}) {
  if (!captchaConfigured()) return { ok: true, options };
  const token = await captchaToken();
  if (!token) return { ok: false, error: CAPTCHA_FAILED };
  return { ok: true, options: { ...options, captchaToken: token } };
}
export async function authSignUp(email, password, username) {
  const cap = await withCaptcha({ data: { username } });
  if (!cap.ok) return { data: null, error: cap.error };
  return getClient().auth.signUp({ email, password, options: cap.options });
}
export async function authSignIn(email, password) {
  const cap = await withCaptcha();
  if (!cap.ok) return { data: null, error: cap.error };
  return getClient().auth.signInWithPassword({ email, password, options: cap.options });
}
// A guest: Supabase's anonymous sign-in, taken when a visitor finishes a season so it can go on the
// leaderboard (migration-profiles.sql gives the account its profile and its name). Nothing is asked of
// them, and nothing is kept but the account itself - which they can turn into a real one later.
// The one the CAPTCHA is actually for, and the awkward one: this is called from postAsGuest after somebody
// has played a whole season, with no form on screen. Turnstile's interaction-only mode is what makes that
// bearable - a plausible browser is never asked anything.
export async function authSignInAsGuest() {
  const cap = await withCaptcha();
  if (!cap.ok) return { data: null, error: cap.error };
  return getClient().auth.signInAnonymously({ options: cap.options });
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
// Forgetting a password. Until v2.19.1 there was no way back at all: the auth surface was signUp,
// signInWithPassword, the two providers, updateUser and signOut, and an email signup that lost its password
// lost the account - with it every season, badge, coin and streak on it, none of which the player can see
// anywhere else. Supabase emails a one-time link; following it brings the page back to `redirectTo` with a
// recovery session in the address, which supabase-js reads and announces as PASSWORD_RECOVERY.
//
// `redirectTo` has to be on the project's Redirect URLs allowlist, which is a per-environment dashboard
// setting this repo does not hold - the same drift CLAUDE.md warns about under Releasing. It is the site's
// own origin, which is already allowed in both projects because Google sign-in has used it since v1.16.0.
export async function authResetPassword(email, redirectTo) {
  const cap = await withCaptcha({ redirectTo });
  if (!cap.ok) return { data: null, error: cap.error };
  return getClient().auth.resetPasswordForEmail(email, cap.options);
}
// The second half, called while that recovery session is live. It is the same updateUser authAddEmail uses,
// with only the password - a guest trading up sets both at once, and this sets one on an account that
// already has the address.
export async function authSetPassword(password) {
  return getClient().auth.updateUser({ password });
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
  // The challenge could not be reached. Said in words, because "Something went wrong" sends a player
  // looking for a problem with their password.
  if (error.__captcha) return error.message;
  if (/captcha/i.test(error.message || "")) return "The anti-robot check didn't pass. Try again.";
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
// a reason. Two are carried through, because for both of them "it will be saved next time" is a lie:
// "duplicate" (this draft already counted) and "reserved_code" (the code is the daily's own draft, so
// it will never be accepted, however many times it is sent).
export async function submitRun(trace) {
  const { data, error } = await getClient().functions.invoke("submit-run", { body: trace });
  if (error) {
    let body = null;
    try { body = await error.context?.json?.(); } catch (e) { /* no readable body */ }
    const reason = body?.reason;
    return reason === "duplicate" || reason === "reserved_code" ? { ok: false, reason } : { ok: false };
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
  // Tiebroken on username, or two players on the same score swap places between page loads - and the row
  // that drops off the bottom of the top ten changes with them. Every ordering in the Stats SQL was given
  // a tiebreak for this reason; this one is in the browser and was missed.
  const { data, error } = await getClient().from("profiles").select("*").not(col, "is", null)
    .order(col, { ascending: false }).order("username", { ascending: true }).limit(limit);
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
  // Tiebroken on username, for the reason fetchLeaderboardTop is: two players on the same points otherwise
  // swap places between page loads, and the row that drops off the bottom changes with them.
  const { data, error } = await getClient().from("profiles").select("*").gt(col, 0)
    .order(col, { ascending: false }).order("username", { ascending: true }).limit(limit);
  if (error || !data) return [];
  return data.map(rowToProfile);
}
// The per-mode score board: each account's best draft in one ladder and one format, best first
// (migration-runs-log.sql's ladder_best). An RPC rather than an order-by on profiles, the way
// fetchLeaderboardTop and fetchLadderTop are, because profiles keeps one best score per FORMAT
// (best_score / best_score_std) and nothing per mode - the runs log is the only place that knows.
// Rows come back already shaped and already tiebroken; the ordering lives in SQL so the mock can be held to
// it (tests/test-runs-sql.mjs). Empty on failure, never a partial board.
export async function fetchLadderBest(ladder = "unlimited", format = "fantasy", limit = 10) {
  try {
    const { data, error } = await getClient().rpc("ladder_best", {
      p_ladder: LADDER_COL[ladder] ? ladder : "unlimited",
      p_format: format === "standard" ? "standard" : "fantasy",
      p_limit: limit,
    }, READ);
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch (e) {
    return [];
  }
}

// Who is wearing what, for the boards: the supporter star and the name colour, by name. One small read
// rather than a flag on every board row, because the boards that come from daily_runs, sou_runs and builds
// hold a SNAPSHOT of the name and the guest flag, stamped when the row was written - right for `guest`, which
// is a fact about the account at the time, and wrong for both of these. A supporter star appears the day
// somebody buys and a name colour changes whenever they equip another one, so a snapshot would be stale on
// every row already written. The boards ask who wears what, now, and every name renders through one NameLink
// that knows.
// Names rather than ids because a name is what a board renders, and profiles.username is unique.
// Rows: { username, supporter, namecolor }, and only for accounts wearing something - see board_looks in
// supabase/migration-shop.sql. An empty list is the safe answer to any failure: plain names, which is what
// every board showed before any of this.
// `names` asks about exactly those accounts and ignores the limit, which is what the duel screen needs: two
// people, who may be anywhere in the alphabet and so may sit outside the boards' first `limit` wearers. Without
// it a duel between two players who both bought a colour could show neither.
export async function fetchBoardLooks({ names = null, limit = 500 } = {}) {
  try {
    const args = names ? { p_limit: limit, p_names: names } : { p_limit: limit };
    const { data, error } = await getClient().rpc("board_looks", args, READ);
    if (error || !Array.isArray(data)) return [];
    return data.filter((r) => r && typeof r.username === "string");
  } catch (e) {
    return [];
  }
}

// Both Stats functions only read, so they go out as GET (storage-core.js's READ) and get supabase-js's
// automatic retry. Keep it that way for any new read-only RPC; writes stay POST and go out exactly once.

// Summed in the database (site_totals(), supabase/migration-runs-log.sql) - one small row back
// instead of a column from every account. Returns null when it can't be loaded, never zeros: a
// failed request must not show up as "0 drafts".
export async function fetchSiteTotals() {
  const { data, error } = await getClient().rpc("site_totals", {}, READ);
  if (error || !data) return null;
  // `plays` falls back to `runs` rather than to 0: a client that is ahead of the migration would
  // otherwise show a pill counting nothing at all, and drafts alone is the honest older answer.
  const runs = Number(data.runs) || 0;
  // `drafted` is null rather than 0 when the database has not got it yet: the Stats tile leaves itself
  // out on null, and "0 players drafted" beside 170 drafts would be a claim about the world, not a gap.
  return {
    runs, perfect: Number(data.perfect) || 0, players: Number(data.players) || 0,
    plays: Number(data.plays) || runs,
    drafted: data.drafted == null ? null : Number(data.drafted) || 0,
  };
}
export async function fetchDailyTop(date, limit = 10, format = "fantasy") {
  // Tiebroken on username, for the reason fetchLeaderboardTop is.
  const { data, error } = await getClient().from("daily_runs").select("*").eq("date", date).eq("format", format)
    .order("score", { ascending: false }).order("username", { ascending: true }).limit(limit);
  if (error || !data) return [];
  // `guest` travels with the name everywhere a name is shown, and this render site already asks for it -
  // but be clear about what this line does, because the comment here used to say the flag was "in place"
  // and it is not: **`daily_runs` has no `guest` column**, on either project, so `!!r.guest` is `!!undefined`
  // and always false. Checked against information_schema on both in v2.18.5; of the tables a board reads,
  // only profiles, sou_runs, builds, century_runs and guess_runs carry one.
  //
  // Nothing is wrong today, and not because of this line: `submit-run` refuses a guest's daily outright
  // (`guest_daily`), so no guest row can exist for the board to chip. The mapping is kept so the shape
  // matches every other board's, and so that adding the column plus a write in submit-run is all it would
  // take - but until that happens this is a fallback that cannot fire, not a protection.
  return data.map((r) => ({ username: r.username, w: r.w, l: r.l, score: r.score, outcome: r.outcome, guest: !!r.guest }));
}
export async function fetchSouTop(date, limit = 10) {
  // Tiebroken on username, for the reason fetchLeaderboardTop is: two rows on the same number otherwise
  // swap places between page loads, and the one that drops off the bottom of the top ten changes with
  // them. Every ordering in the Stats SQL was given a tiebreak; the four in this file were missed, and
  // this is the one it matters most on - small integer scores over a single shared round sequence, so
  // ties at the rank-10 cut are the ordinary case rather than a coincidence.
  const { data, error } = await getClient().from("sou_runs").select("*").eq("date", date)
    .order("score", { ascending: false }).order("username", { ascending: true }).limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({ username: r.username, score: r.score, guest: !!r.guest }));
}
// Whether this ACCOUNT has already played a given day's season daily, and how it went. The device keeps its
// own record (DAILY_KEY) and that is all the app read until v2.18.10 - which made the record the truth rather
// than a hint, and it is per-DEVICE while `daily_runs`' primary key is (date, format, user_id). So the device
// answered for whoever used it last: a second account on the same phone was told the day was already played,
// shown the first account's lineup, and locked out of a daily it had never touched. The same gap the other
// way round is why Over/Under has fetchMySouRun above, and why Guess and Century ask their own tables first.
// A read that fails answers null, which leaves the device's own record standing - the same fallback the rest
// of this file uses, and the right one: it is better to think you have played than to be dealt a day twice.
// THREE answers, not two, and the difference decides whether the device's record is trusted:
//   an object  - this account played it, and here is how it went
//   null       - this account definitively has NOT played it
//   undefined  - the question could not be asked (no account, or the read failed)
// Two answers is what the first version of this had, and it did not work: "no row" fell back to the
// device's record, which belongs to whoever used the browser last - so the second account was still
// shown the first one's daily and still locked out. A signed-in account has to trust the server's "no",
// because that is the only thing that knows which account is asking. `undefined` is the only case where
// the device still gets to answer, and it means the network failed, not that the day is free.
export async function fetchMyDailyRun(date, format, userId) {
  if (!userId) return undefined;
  const { data, error } = await getClient().from("daily_runs").select("*")
    .eq("date", date).eq("format", format).eq("user_id", userId).maybeSingle();
  if (error) return undefined;
  if (!data) return null;
  return { w: data.w, l: data.l, score: data.score, outcome: data.outcome, champ: !!data.champ };
}

// Whether this account has already played a given day. The primary key (date, user_id) is what really
// enforces "one run a day"; the app's own flag is in PERSONAL, per-device storage, so a phone after a
// laptop knew nothing about it - and dealt a whole second run, showed the score, and dropped it with no
// error and no coins, because upsertSouRun is a plain insert whose answer nobody read.
// Three answers, for the reason fetchMyDailyRun gives above: an object means this account played that day,
// `null` means it definitively did not, and `undefined` means the question could not be asked. Only the last
// lets the device's own record answer - it is keyed by the date and by nothing else, so on a shared browser
// it belongs to whoever played last, and treating its "done" as the truth locked the next account out.
export async function fetchMySouRun(date, userId) {
  if (!userId) return undefined;
  const { data, error } = await getClient().from("sou_runs").select("*").eq("date", date).eq("user_id", userId).maybeSingle();
  if (error) return undefined;
  if (!data) return null;
  return { score: data.score };
}
// "saved" | "already" | "failed". Three answers, not two, because the caller says something factual about the
// world: told `false`, it announced "already recorded on another device" - and a dropped request says nothing
// of the sort. A player on their only device was told their score was safe somewhere else when no row existed
// anywhere, and because the coins are claimed only on a save, the day's 15 went unclaimed and the device's own
// done-flag was written regardless, so there was no second try. 23505 is the unique violation, and the only
// error that means the day really is already recorded.
export async function upsertSouRun(date, userId, row) {
  const { error } = await getClient().from("sou_runs").insert({ date, user_id: userId, username: row.username, score: row.score });
  if (!error) return "saved";
  return error.code === "23505" ? "already" : "failed";
}

// Build-a-player is stat-free for the player's own account (see playBapSim's own comment in
// perfect-season.jsx) - this is a separate, additive, sitewide-only tally logged once a build
// completes, purely for the Stats screen's "created players" count and "highest-OVR" leaderboard.
// `day` is the build's day in the PLAYER's calendar, not UTC - the same thing sou_runs.date has always been,
// and what claim_minigame's build arm matches on since v2.18.7. Without it that arm compared the client's local
// day against the row's UTC date, so a build made in the hours where those differ paid no coins at all and said
// nothing about it. A row written by an older client has no `day`; the arm still falls back to the UTC date for
// those, so nothing already on the board stops paying.
export async function logBuild(userId, { username, pos, overall, filled, day }) {
  const { error } = await getClient().from("builds")
    .insert({ user_id: userId, username, pos, overall, filled, ...(day ? { day } : {}) });
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
    // Tiebroken on username, for the reason fetchLeaderboardTop is.
    .order("overall", { ascending: false })
    .order("username", { ascending: true })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return data
    .map((r) => ({ username: r.username, guest: !!r.guest, pos: r.pos, overall: Number(r.overall), filled: r.filled }))
    .filter((b) => Number.isFinite(b.overall) && BUILD_POSITIONS.includes(b.pos));
}
export async function fetchBuildCount() {
  // null when it cannot be loaded, never 0 - the rule fetchSiteTotals states above and this one did not keep.
  // The Stats screen takes its error flag from fetchSiteStats alone, so when only this query failed the screen
  // rendered "0 / Created players" beside boards that had loaded perfectly: a wrong number, stated plainly.
  const { count, error } = await getClient().from("builds").select("*", { count: "exact", head: true });
  return error || count == null ? null : count;
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
    // Whitelisted field by field, so a new one in site_totals() has to be added HERE too - which is how
    // `drafted` reached the Stats screen as undefined the first time. Null, not 0, when the database
    // hasn't got it: the tile leaves itself out rather than claiming nobody has drafted anyone.
    totals: {
      runs: Number(data.totals?.runs) || 0, perfect: Number(data.totals?.perfect) || 0,
      players: Number(data.totals?.players) || 0,
      plays: Number(data.totals?.plays) || Number(data.totals?.runs) || 0,
      drafted: data.totals?.drafted == null ? null : Number(data.totals.drafted) || 0,
    },
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
// total-plays tick via Realtime broadcast (every tab that finishes a draft or a mini-game tells
// every other open tab to bump its count by one - optimistic, not re-fetched, since this is a fun
// live number, not a ledger). Unlike every other export here, this is a long-lived subscription, not
// a one-shot request, so it returns an unsubscribe function (call it on unmount) alongside a
// broadcaster for the "something just finished" side.
export function subscribeSiteActivity({ onOnlineCount, onPlayFinished }) {
  const client = getClient();
  // self: true - Supabase doesn't echo a broadcast back to its sender by default, and the tab that
  // just finished a draft should count it too (see loadLeaderboard's setLivePlays for the other half).
  const channel = client.channel("site-activity", { config: { broadcast: { self: true } } });
  channel.on("presence", { event: "sync" }, () => onOnlineCount(Object.keys(channel.presenceState()).length));
  // The WIRE name stays "draft_finished" though the number it feeds is now plays (v2.16.0). A deploy
  // leaves tabs on both bundles talking to each other for as long as they stay open, and renaming the
  // event would split them into two silent halves, each counting only its own kind of tab. `kind` is a
  // payload field for the same reason it is not a new event: an old tab sends none, and no kind means
  // "draft", which is the only thing an old tab ever broadcast.
  channel.on("broadcast", { event: "draft_finished" }, (msg) => onPlayFinished(msg?.payload?.kind === "minigame" ? "minigame" : "draft"));
  channel.subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({}); });
  return {
    unsubscribe: () => client.removeChannel(channel),
    // kind: "draft" bumps both the plays pill and the Stats screen's Drafts tile; "minigame" bumps
    // only plays, because a Guess the Player round is not a draft and that tile still says Drafts.
    broadcastPlayFinished: (kind = "draft") => channel.send({ type: "broadcast", event: "draft_finished", payload: { kind } }),
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
// ---------- Century (v2.9.0) ----------
// The mode's rules are in century-logic.mjs; this is only the two boards and the submission.
export * from "./storage-century.js";
// ---------- Guess the Player (v2.13.0) ----------
// Rules in guess-logic.mjs; this is the two boards and the submission.
export * from "./storage-guess.js";
