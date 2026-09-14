// Badges, worked out from stats the site already keeps - nothing is stored, so every player has every
// badge they've already earned the day this ships, and a badge can't be lost (every condition only
// ever becomes true: counters grow, bests improve). Pure and framework-free: the profile screen runs
// it in the browser now, and from v1.12.0 the submit-run Edge Function runs the same file to pay each
// badge's coins once. Contract: PROFILES.md.
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

// Tuned with the difficulty bot before launch, so these stay hard but reachable.
export const CINDERELLA_MAX_SCORE = 75; // a title won with this team score or lower
export const SCOUT_MIN_POINTS = 150; // ladder points in a single draft
// Joined in Gridspin's first month (it launched 2026-09-14).
export const DAY_ONE_BEFORE = "2026-10-14T00:00:00.000Z";

// `coins` is paid once, from v1.12.0. Over/Under and Build-a-player scores are saved by the browser
// rather than checked by the server, so their badges pay nothing.
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
  { id: "stat-nerd", name: "Stat Nerd", emoji: "📈", tier: "bronze", how: "Score 15 in Over/Under", noCoins: true },
  { id: "mad-scientist", name: "Mad Scientist", emoji: "⚡", tier: "bronze", how: "Create 10 players in Build-a-player", noCoins: true },
  { id: "day-one", name: "Day One", emoji: "👑", tier: "special", how: "Join in Gridspin's first month" },
].map((b) => ({ ...b, coins: b.noCoins ? 0 : TIER_COINS[b.tier] }));
export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

const ladderRow = (extra, ladder) => (extra?.byLadder || []).find((r) => r.ladder === ladder) || null;
const count = (have, need) => ({ have: Math.min(Math.max(0, Number(have) || 0), need), need, earned: (Number(have) || 0) >= need });
const flag = (earned) => ({ have: earned ? 1 : 0, need: 1, earned: !!earned });

// Every badge with whether it's earned and how far along it is: [{ id, earned, have, need }], in
// BADGES order. Yes/no badges report have 0 or 1 of need 1. Missing inputs count as nothing done.
export function badgeProgress({ stats, extra, details, joined } = {}) {
  const s = stats || {};
  const x = extra || {};
  const upsets = [x.byFormat?.fantasy?.biggestUpset, x.byFormat?.standard?.biggestUpset].filter(Boolean).map((u) => u.score);
  const lowestTitle = upsets.length ? Math.min(...upsets) : null;
  const fav = details?.favoriteTeam;
  const favCount = fav ? (x.teamCounts || []).find((t) => t.team === fav)?.count || 0 : 0;
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
    "big-brain": () => count(ladderRow(x, "genius")?.champs, 1),
    "front-office": () => count(ladderRow(x, "gm")?.champs, 1),
    "daily-champion": () => count(ladderRow(x, "daily")?.champs, 1),
    "old-school": () => count(x.byFormat?.standard?.champs, 1),
    "hot-streak": () => count(s.dailyBestStreak, 3),
    "week-warrior": () => count(s.dailyBestStreak, 7),
    "every-single-day": () => count(s.dailyBestStreak, 30),
    "cinderella": () => flag(lowestTitle != null && lowestTitle <= CINDERELLA_MAX_SCORE),
    "scout": () => flag(x.bestPoints != null && x.bestPoints >= SCOUT_MIN_POINTS),
    "daily-winner": () => flag(x.dailies?.bestRank === 1),
    "loyal-fan": () => count(favCount, 25),
    "stat-nerd": () => flag(x.overUnder?.best != null && x.overUnder.best >= 15),
    "mad-scientist": () => count(x.builds?.count, 10),
    "day-one": () => flag(Number.isFinite(joinedAt) && joinedAt < Date.parse(DAY_ONE_BEFORE)),
  };
  return BADGES.map((b) => ({ id: b.id, ...rules[b.id]() }));
}

// The n best earned badges for the player card: rarest tier first, then catalog order.
export function topBadges(progress, n = 3) {
  return (progress || [])
    .filter((p) => p.earned)
    .map((p) => BADGE_BY_ID[p.id])
    .filter(Boolean)
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || BADGES.indexOf(a) - BADGES.indexOf(b))
    .slice(0, n);
}
