// The test mock's player_stats(): one player's per-run stats for the profile screen, computed over the
// mock's in-memory runs, daily_runs, sou_runs and builds. Mirrors player_stats() in
// supabase/migration-runs-log.sql; tests/test-player-stats-sql.mjs requires the two to return
// identical JSON. Contract and exact shape: PROFILES.md.
//
// `state` is the mock's shared tables: { profiles, runs, dailyRuns, souRuns, builds, currentUserId }.
//
// Where the SQL leans on Postgres behaviour, this spells it out: aggregates skip nulls, an ascending
// order puts null last and a descending one puts it first, names sort in code-point order (the SQL's
// collate "C"), and timestamps come out the way to_jsonb writes them in a UTC session, which is what a
// Supabase database runs in.

const LADDERS = ["daily", "unlimited", "genius", "gm"]; // by_ladder's order
const FORMATS = ["fantasy", "standard"];
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (v) => (v == null ? null : Number(v));
const text = (v) => (v == null ? null : String(v));
// A timestamp as milliseconds, whether the row holds an ISO string, a Date or a number.
const ms = (v) => (v == null ? null : typeof v === "number" ? v : v instanceof Date ? v.getTime() : Date.parse(v));
function asc(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const desc = (a, b) => asc(b, a);
const max = (values) => values.reduce((m, v) => (v == null ? m : m == null || v > m ? v : m), null);
const sum = (values) => values.reduce((t, v) => t + (v ?? 0), 0);
const countBy = (rows, test) => rows.filter(test).length;

// to_jsonb's timestamptz in a UTC session: "2026-09-01T12:00:00+00:00", with fractional seconds only
// when there are some, trailing zeros dropped (".12", not ".120").
function pgTimestamp(v) {
  const t = ms(v);
  return t == null || Number.isNaN(t) ? null : new Date(t).toISOString().replace(/\.?0*Z$/, "+00:00");
}
// A daily_runs date ('YYYY-MM-DD') as its UTC midnight, the SQL's date::date.
function dayMs(date) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(date ?? ""));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}
// Counts rows by a composite key, returning [{ key: [...values], count }].
function tally(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = JSON.stringify(keyOf(item));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ key: JSON.parse(key), count }));
}

export function playerStats(state, userId) {
  const mine = [...state.runs.values()].filter((r) => r.user_id === userId);
  const done = mine.filter((r) => !r.dnf);
  // e->>'name' and friends: a roster entry that isn't an object has none of them.
  const entries = done.flatMap((r) => (Array.isArray(r.roster) ? r.roster : []).map((e) => {
    const o = e && typeof e === "object" && !Array.isArray(e) ? e : {};
    return { name: text(o.name), season: num(o.season), team: text(o.team) };
  }));

  const byLadder = LADDERS.map((ladder) => {
    const rows = mine.filter((r) => r.ladder === ladder);
    const fin = rows.filter((r) => !r.dnf);
    const best = (format) => max(fin.filter((r) => r.format === format).map((r) => num(r.score)));
    return rows.length ? {
      ladder, seasons: fin.length, dnf: rows.length - fin.length,
      wins: sum(fin.map((r) => num(r.w))), losses: sum(fin.map((r) => num(r.l))),
      champs: countBy(fin, (r) => r.champ), perfect: countBy(fin, (r) => r.perfect), playoffs: countBy(fin, (r) => r.playoffs),
      best_score: best("fantasy"), best_score_std: best("standard"),
    } : null;
  }).filter(Boolean);

  const wins = tally(done.filter((r) => r.w != null), (r) => [Number(r.w)])
    .map(({ key: [w], count }) => ({ w, n: count }))
    .sort((a, b) => a.w - b.w);

  const goToPlayers = tally(entries, (e) => [e.name, e.season, e.team])
    .map(({ key: [name, season, team], count }) => ({ name, season, team, count }))
    .sort((a, b) => b.count - a.count || asc(a.name, b.name) || asc(a.season, b.season) || asc(a.team, b.team))
    .slice(0, 5);
  const teamCounts = tally(entries, (e) => [e.team])
    .map(({ key: [team], count }) => ({ team, count }))
    .sort((a, b) => b.count - a.count || asc(a.team, b.team));

  // A run with no score can't be an upset or a best (as in the SQL and site_stats).
  const byFormat = Object.fromEntries(FORMATS.map((format) => {
    const fin = done.filter((r) => r.format === format);
    const upset = fin.filter((r) => r.champ && r.score != null)
      .sort((a, b) => Number(a.score) - Number(b.score) || asc(ms(a.created_at), ms(b.created_at)))[0];
    const gm = fin.filter((r) => r.gm && r.score != null)
      .sort((a, b) => Number(b.score) - Number(a.score) || asc(ms(a.created_at), ms(b.created_at)))[0];
    return [format, {
      champs: countBy(fin, (r) => r.champ),
      biggest_upset: upset ? { score: num(upset.score), w: num(upset.w), l: num(upset.l), ladder: text(upset.ladder), created_at: pgTimestamp(upset.created_at) } : null,
      best_gm: gm ? { score: num(gm.score), w: num(gm.w), l: num(gm.l) } : null,
    }];
  }));

  // daily_runs.format defaults to fantasy, so a mock row without one is a fantasy daily. A row a test put
  // in without a created_at (the database would fill in now()) sorts after dated ones.
  const formatOf = (r) => r.format ?? "fantasy";
  const allDailies = [...state.dailyRuns.values()];
  const dailies = allDailies.filter((r) => r.user_id === userId);
  const bestDaily = [...dailies].sort((a, b) => Number(b.score) - Number(a.score) || asc(ms(a.created_at), ms(b.created_at))
    || asc(a.date, b.date) || asc(formatOf(a), formatOf(b)))[0];
  // Only days that are over everywhere: two or more days before today's UTC date.
  const now = new Date();
  const lastFinalDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 2 * DAY_MS;
  const finishes = dailies.filter((d) => dayMs(d.date) <= lastFinalDay)
    .map((d) => 1 + countBy(allDailies, (o) => o.date === d.date && formatOf(o) === formatOf(d) && Number(o.score) > Number(d.score)));

  const souRuns = [...state.souRuns.values()].filter((r) => r.user_id === userId);
  const builds = [...state.builds.values()].filter((r) => r.user_id === userId);
  const bestBuild = [...builds].sort((a, b) => desc(num(a.overall), num(b.overall)) || asc(ms(a.created_at), ms(b.created_at)) || asc(a.id, b.id))[0];

  return {
    since: pgTimestamp(mine.reduce((m, r) => {
      const t = ms(r.created_at);
      return t == null || Number.isNaN(t) || (m != null && m <= t) ? m : t;
    }, null)),
    by_ladder: byLadder,
    wins,
    best_points: max(done.map((r) => num(r.points))),
    go_to_players: goToPlayers,
    team_counts: teamCounts,
    by_format: byFormat,
    dailies: {
      played: dailies.length,
      best_score: bestDaily ? num(bestDaily.score) : null, best_w: bestDaily ? num(bestDaily.w) : null, best_l: bestDaily ? num(bestDaily.l) : null,
      best_rank: finishes.length ? Math.min(...finishes) : null,
    },
    over_under: { played: souRuns.length, best: max(souRuns.map((r) => num(r.score))) },
    builds: { count: builds.length, best: bestBuild ? { pos: text(bestBuild.pos), overall: num(bestBuild.overall) } : null },
  };
}
