// Example profiles in exactly the shape storage-profile.js's fetchPlayerProfile returns, for testing and
// previewing the profile screen without a database: a veteran with every section filled, a brand-new
// account, and the veteran with an uploaded photo. PROFILES.md describes each field.
import { rowToProfile } from "../../storage-core.js";
import { mapPlayerStats, emptyPlayerStats } from "../../profile-rules.mjs";

const day = (d, h = 18) => Date.UTC(2026, 8, d, h);
const roster = (names) => ["QB", "RB", "WR", "TE", "FLEX1", "FLEX2"].map((slot, i) => ({ slot, ...names[i] }));
const BEST = roster([
  { name: "Peyton Manning", team: "IND", season: 2004, ppr: 412.5, rating: 128.1 },
  { name: "Priest Holmes", team: "KC", season: 2002, ppr: 409.1, rating: 124.6 },
  { name: "Randy Moss", team: "NE", season: 2007, ppr: 396.5, rating: 121.3 },
  { name: "Tony Gonzalez", team: "KC", season: 2004, ppr: 247.9, rating: 112.0 },
  { name: "Travis Kelce", team: "KC", season: 2022, ppr: 316.3, rating: 104.2 },
  { name: "Marvin Harrison", team: "IND", season: 2002, ppr: 373.4, rating: 109.8 },
]);

export const VETERAN_ROW = {
  id: "fixture-veteran", username: "shrimpcity", created_at: "2026-09-02T15:04:00.000Z",
  runs: 64, dnf: 7, wins: 797, losses: 387, champs: 9, perfect: 1, playoffs: 38,
  best_score: 112.4, best_run: { w: 20, l: 0, score: 112.4, outcome: "Perfect season. 20–0.", date: day(9), format: "fantasy", mode: "free", roster: BEST },
  best_score_std: 98.0, best_run_std: { w: 16, l: 4, score: 98.0, outcome: "Won the championship after a 13–4 regular season", date: day(11), format: "standard", mode: "daily", roster: BEST },
  best_record: { w: 20, l: 0 },
  points_daily: 8140, points_unlimited: 21430, points_genius: 2210, points_gm: 3905, points_bank: 35685,
  daily_streak: 6, daily_last: "2026-09-13", daily_best_streak: 9,
  recent: [
    { w: 14, l: 5, score: 96.2, outcome: "Lost the championship", date: day(13, 20), mode: "daily", format: "fantasy", points: 140 },
    { dnf: true, picks: 2, mode: "unlimited", points: -50, date: day(13, 17) },
    { w: 11, l: 7, score: 88.4, outcome: "Lost in the divisional round", date: day(12, 22), mode: "free", gm: true, format: "fantasy", points: 60 },
    { w: 8, l: 9, score: 79.9, outcome: "Missed the playoffs", date: day(12, 19), mode: "free", format: "standard", points: -40 },
    { w: 17, l: 3, score: 104.9, outcome: "Won the championship after a 14–3 regular season", date: day(11, 21), mode: "daily", format: "fantasy", points: 212 },
  ],
};

export const VETERAN_STATS_JSON = {
  since: "2026-09-02T15:10:00.000Z",
  by_ladder: [
    { ladder: "daily", seasons: 21, dnf: 0, wins: 254, losses: 130, champs: 3, perfect: 0, playoffs: 12, best_score: 104.9, best_score_std: 97.2 },
    { ladder: "unlimited", seasons: 30, dnf: 5, wins: 378, losses: 177, champs: 4, perfect: 1, playoffs: 18, best_score: 112.4, best_score_std: 98.0 },
    { ladder: "genius", seasons: 6, dnf: 0, wins: 66, losses: 43, champs: 1, perfect: 0, playoffs: 3, best_score: 98.0, best_score_std: null },
    { ladder: "gm", seasons: 7, dnf: 2, wins: 93, losses: 36, champs: 1, perfect: 0, playoffs: 5, best_score: 101.7, best_score_std: 90.3 },
  ],
  wins: [[5, 1], [6, 1], [7, 2], [8, 3], [9, 4], [10, 6], [11, 7], [12, 9], [13, 8], [14, 7], [15, 5], [16, 4], [17, 3], [18, 2], [19, 1], [20, 1]].map(([w, n]) => ({ w, n })),
  best_points: 212,
  go_to_players: [
    { name: "Randy Moss", season: 2007, team: "NE", count: 6 },
    { name: "Priest Holmes", season: 2002, team: "KC", count: 5 },
    { name: "Peyton Manning", season: 2004, team: "IND", count: 4 },
    { name: "Tony Gonzalez", season: 2004, team: "KC", count: 4 },
    { name: "Travis Kelce", season: 2022, team: "KC", count: 3 },
  ],
  team_counts: [{ team: "KC", count: 31 }, { team: "NE", count: 22 }, { team: "IND", count: 14 }, { team: "SF", count: 9 }, { team: "GB", count: 6 }],
  by_format: {
    fantasy: { champs: 7, biggest_upset: { score: 71.4, w: 15, l: 5, ladder: "gm", created_at: "2026-09-10T02:11:00.000Z" }, best_gm: { score: 96.1, w: 18, l: 2 } },
    standard: { champs: 2, biggest_upset: { score: 82.0, w: 14, l: 6, ladder: "daily", created_at: "2026-09-11T21:40:00.000Z" }, best_gm: { score: 90.3, w: 16, l: 4 } },
  },
  dailies: { played: 21, best_score: 104.9, best_w: 19, best_l: 1, best_rank: 1 },
  over_under: { played: 12, best: 17 },
  builds: { count: 4, best: { pos: "WR", overall: 131.2 } },
};

const details = (overrides = {}) => ({
  bio: "", avatarPath: null, avatarUrl: null, avatarPreset: null, favoriteTeam: null, updatedAt: null, ...overrides,
});

// Every section filled, a default avatar, a bio and a favorite team.
export function veteranProfile(overrides = {}) {
  return {
    id: VETERAN_ROW.id, username: VETERAN_ROW.username, joined: VETERAN_ROW.created_at,
    details: details({ bio: "Takes a running back in round one and regrets nothing. Still chasing that second 20–0.", avatarPreset: "trophy", favoriteTeam: "KC", updatedAt: "2026-09-12T10:00:00.000Z" }),
    stats: rowToProfile(VETERAN_ROW), extra: mapPlayerStats(VETERAN_STATS_JSON),
    ...overrides,
  };
}

// An account that has never finished or abandoned a draft, with nothing saved.
export function rookieProfile(overrides = {}) {
  const row = { id: "fixture-rookie", username: "newbie", created_at: "2026-09-14T09:00:00.000Z", runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] };
  return {
    id: row.id, username: row.username, joined: row.created_at,
    details: details(), stats: rowToProfile(row), extra: mapPlayerStats(emptyPlayerStats()),
    ...overrides,
  };
}

// A 1x1 lime PNG, standing in for an uploaded photo.
export const PHOTO_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO4tf3/fwAHOQMhGoNALgAAAABJRU5ErkJggg==";
export function photoProfile(overrides = {}) {
  const v = veteranProfile();
  return { ...v, details: { ...v.details, avatarPreset: null, avatarPath: `${v.id}/1757800000000.webp`, avatarUrl: PHOTO_DATA_URL }, ...overrides };
}
