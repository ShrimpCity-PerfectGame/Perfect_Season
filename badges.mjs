// Badges, worked out from stats the site already keeps - nothing is stored, so every player has every
// badge their record already earns the day this ships, as far back as that record goes (per-run badges
// read the runs log, which starts partway through the site's history). Pure and framework-free: the
// profile screen runs it in the browser now, and from v1.12.0 the submit-run Edge Function runs the same
// file to pay each badge's coins once. Contract: PROFILES.md.
//
// A badge can't be lost: every condition only ever becomes true (counters grow, bests improve, and a
// day's Daily places are final once no one can still post that day). The one exception is Loyal Fan,
// which counts drafts from whichever team is your favorite now.
//
// Inputs, all in the app's shapes:
//   stats   - the profile row as storage-core.js's rowToProfile returns it
//   extra   - player_stats() through profile-rules.mjs's mapPlayerStats
//   details - storage-profile.js's mapDetails (for the favorite team)
//   joined  - the account's created_at, an ISO string

export const BADGE_TIERS = ["bronze", "silver", "gold", "special"];
// Showcase order: the rarest first.
const TIER_ORDER = { gold: 0, special: 1, silver: 2, bronze: 3 };
export const TIER_COINS = { bronze: 100, silver: 300, gold: 1000, special: 500 };

// Both calibrated by simulation before launch: bots played 8,000-10,000 drafts per case in each
// scoring format, graded and simulated exactly as submit-run does, with points from botPar and
// draftPoints. The strong bot took the best available player every pick; the middling one, a random
// pick from the best four.
//
// A title won with this team score or lower. A title below about 95 almost never happens (the playoff
// field is rated 106-116 from its 10th to 90th percentile, and a game is decided outright at a 20-point
// gap). For mixes of strong through weak drafters, with up to a fifth of drafts in GM mode, the lowest
// 2-3% of title-winning scores fell at about 101-103, and 102 or lower took in 1.7-3.2% of titles.
// Alone, a strong drafter rarely wins that low (0.5% of titles), a middling one more often (8%), and GM
// mode's capped teams most (a third). Per draft that's roughly 1 in 300 (a strong GM drafter) to 1 in 1,800 (one who
// always takes the third-best player), so no way of playing makes it common or out of reach.
export const CINDERELLA_MAX_SCORE = 102;
// Ladder points in one draft: the top 5% of drafts for a strong drafter (95th percentile 214 with
// fantasy scoring, 226 with Championship scoring; 5.2% of their drafts reach 220). A middling drafter
// gets there about 1 draft in 700.
export const SCOUT_MIN_POINTS = 220;
// Joined in Gridspin's first month (it launched 2026-09-14).
export const DAY_ONE_BEFORE = "2026-10-14T00:00:00.000Z";

// `coins` is paid once, from v1.12.0. Over/Under and Build-a-player scores are saved by the browser
// rather than checked by the server, so their badges pay nothing.
const UNPAID = new Set(["stat-nerd", "mad-scientist"]);
export const BADGES = [
  { id: "first-down", name: "First Down", emoji: "🏈", tier: "bronze", how: "Finish your first season" },
  { id: "starter", name: "Starter", emoji: "🏈", tier: "bronze", how: "Finish 25 seasons" },
  { id: "veteran", name: "Veteran", emoji: "🏈", tier: "silver", how: "Finish 100 seasons" },
  { id: "hall-of-famer", name: "Hall of Famer", emoji: "🏈", tier: "gold", how: "Finish 500 seasons" },
  { id: "ring-bearer", name: "Ring Bearer", emoji: "🏆", tier: "bronze", how: "Win a championship" },
  { id: "dynasty", name: "Dynasty", emoji: "🏆", tier: "silver", how: "Win 10 championships" },
  { id: "undefeated", name: "Undefeated", emoji: "🏆", tier: "gold", how: "Go 20–0" },
  { id: "playoff-regular", name: "Playoff Regular", emoji: "📈", tier: "silver", how: "Make the playoffs 25 times" },
  { id: "big-brain", name: "Big Brain", emoji: "🧠", tier: "silver", how: "Win a title in Genius mode" },
  { id: "front-office", name: "Front Office", emoji: "💼", tier: "silver", how: "Win a title in GM mode" },
  { id: "daily-champion", name: "Daily Champion", emoji: "🏆", tier: "silver", how: "Win the title in a Daily" },
  { id: "old-school", name: "Old School", emoji: "🏈", tier: "silver", how: "Win a title with Championship scoring" },
  { id: "hot-streak", name: "Hot Streak", emoji: "🔥", tier: "bronze", how: "Play the Daily 3 days in a row" },
  { id: "week-warrior", name: "Week Warrior", emoji: "🔥", tier: "silver", how: "Play the Daily 7 days in a row" },
  { id: "every-single-day", name: "Every Single Day", emoji: "🔥", tier: "gold", how: "Play the Daily 30 days in a row" },
  { id: "cinderella", name: "Cinderella", emoji: "🚨", tier: "gold", how: `Win a title with a team score of ${CINDERELLA_MAX_SCORE} or lower` },
  { id: "scout", name: "Scout", emoji: "⚡", tier: "silver", how: `Earn ${SCOUT_MIN_POINTS} or more ladder points in one draft` },
  { id: "daily-winner", name: "Daily Winner", emoji: "👑", tier: "gold", how: "Finish #1 on a day's Daily leaderboard" },
  { id: "loyal-fan", name: "Loyal Fan", emoji: "🏈", tier: "bronze", how: "Draft 25 players from your favorite team" },
  { id: "stat-nerd", name: "Stat Nerd", emoji: "📈", tier: "bronze", how: "Score 15 in Over/Under" },
  { id: "mad-scientist", name: "Mad Scientist", emoji: "⚡", tier: "bronze", how: "Create 10 players in Build-a-player" },
  { id: "day-one", name: "Day One", emoji: "👑", tier: "special", how: "Join in Gridspin's first month" },
].map((b) => ({ ...b, coins: UNPAID.has(b.id) ? 0 : TIER_COINS[b.tier] }));
export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

// A value that may be missing. Number(null) is 0, which would read a missing upset score as the lowest
// ever and a missing rank as a finish, so missing is NaN here and fails every comparison.
const value = (v) => (v == null || v === "" ? NaN : Number(v));
const list = (v) => (Array.isArray(v) ? v : []);
const count = (have, need) => {
  const n = Number(have) || 0;
  return { have: Math.min(Math.max(0, n), need), need, earned: n >= need };
};
const flag = (earned) => ({ have: earned ? 1 : 0, need: 1, earned: !!earned });

// Every badge with whether it's earned and how far along it is: [{ id, earned, have, need }], in
// BADGES order. Yes/no badges report have 0 or 1 of need 1. Missing inputs count as nothing done.
export function badgeProgress(input) {
  const { stats, extra, details, joined } = input || {};
  const s = stats || {};
  const x = extra || {};
  const ladderChamps = (ladder) => list(x.byLadder).find((r) => r?.ladder === ladder)?.champs;
  const lowestTitle = Math.min(...[x.byFormat?.fantasy?.biggestUpset, x.byFormat?.standard?.biggestUpset]
    .map((u) => value(u?.score)).filter(Number.isFinite));
  const fav = details?.favoriteTeam;
  const favCount = fav ? list(x.teamCounts).find((t) => t?.team === fav)?.count : 0;
  const joinedAt = joined ? Date.parse(joined) : NaN;

  const rules = {
    "first-down": () => count(s.runs, 1),
    "starter": () => count(s.runs, 25),
    "veteran": () => count(s.runs, 100),
    "hall-of-famer": () => count(s.runs, 500),
    "ring-bearer": () => count(s.champs, 1),
    "dynasty": () => count(s.champs, 10),
    "undefeated": () => count(s.perfect, 1),
    "playoff-regular": () => count(s.playoffs, 25),
    "big-brain": () => count(ladderChamps("genius"), 1),
    "front-office": () => count(ladderChamps("gm"), 1),
    "daily-champion": () => count(ladderChamps("daily"), 1),
    "old-school": () => count(x.byFormat?.standard?.champs, 1),
    "hot-streak": () => count(s.dailyBestStreak, 3),
    "week-warrior": () => count(s.dailyBestStreak, 7),
    "every-single-day": () => count(s.dailyBestStreak, 30),
    // Math.min of nothing is Infinity, so no title at all never qualifies.
    "cinderella": () => flag(lowestTitle <= CINDERELLA_MAX_SCORE),
    "scout": () => flag(value(x.bestPoints) >= SCOUT_MIN_POINTS),
    "daily-winner": () => flag(value(x.dailies?.bestRank) === 1),
    "loyal-fan": () => count(favCount, 25),
    "stat-nerd": () => flag(value(x.overUnder?.best) >= 15),
    "mad-scientist": () => count(x.builds?.count, 10),
    "day-one": () => flag(joinedAt < Date.parse(DAY_ONE_BEFORE)),
  };
  return BADGES.map((b) => ({ id: b.id, ...rules[b.id]() }));
}

// The n best earned badges for the player card, as BADGES entries: rarest tier first (gold, special,
// silver, bronze), then catalog order.
export function topBadges(progress, n = 3) {
  const earned = new Set(list(progress).filter((p) => p?.earned).map((p) => p.id));
  return BADGES.filter((b) => earned.has(b.id))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || BADGES.indexOf(a) - BADGES.indexOf(b))
    .slice(0, Math.max(0, n));
}
