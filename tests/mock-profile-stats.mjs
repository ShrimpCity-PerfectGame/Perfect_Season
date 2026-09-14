// The test mock's player_stats(): one player's per-run stats for the profile screen, computed over the
// mock's in-memory runs, daily_runs, sou_runs and builds. Mirrors player_stats() in
// supabase/migration-runs-log.sql; tests/test-player-stats-sql.mjs requires the two to return
// identical JSON. Contract and exact shape: PROFILES.md.
//
// `state` is the mock's shared tables: { profiles, runs, dailyRuns, souRuns, builds, currentUserId }.
//
// PHASE 0 STUB (agent A writes the real computation): the empty shape for everyone.
import { emptyPlayerStats } from "../profile-rules.mjs";

export function playerStats(state, userId) {
  return emptyPlayerStats();
}
