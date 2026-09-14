// The pieces every storage module shares: the Supabase client seam and the profile row mapping.
// storage.js re-exports the feature modules (storage-profile.js, storage-moderation.js), so the app
// still imports everything from "./storage.js". Kept separate so those modules don't import
// storage.js back.
//
// SUPABASE_URL/SUPABASE_ANON_KEY are bare identifiers, textually replaced at build time by
// build.mjs's esbuild `define` (same mechanism as the existing NODE_ENV define) - never read
// from process.env directly here, since this module is bundled for the browser. The real
// client is only ever constructed lazily (not at module load) so tests - which always install
// window.__ps_supabase__ before mounting - never hit this branch or need the identifiers defined.
import { createClient } from "@supabase/supabase-js";

let _client = null;
export function getClient() {
  if (typeof window !== "undefined" && window.__ps_supabase__) return window.__ps_supabase__;
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

// supabase-js retries a dropped GET/HEAD by itself (up to 3 times, 1s/2s/4s apart) but never a POST,
// and .rpc() POSTs by default. Read-only functions are called as GET (`get: true`, allowed because
// they're declared STABLE) to get that same retry. Writes stay POST and go out exactly once.
export const READ = { get: true };

// DB columns are snake_case; the rest of the app works with the same camelCase shape
// blankStats() always produced, so every profile row is translated at this boundary.
export function rowToProfile(row) {
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
export function profileToRow(s) {
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

// A PostgREST error from a database function that raised one of its own codes (`raise exception
// 'bio_blocked'` arrives as message "bio_blocked", code P0001), mapped through `table` to the reason
// the app shows. Anything unrecognized - a dropped connection, a server error - is "network".
export function rpcReason(error, table) {
  const key = String(error?.message || "").trim();
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : "network";
}
