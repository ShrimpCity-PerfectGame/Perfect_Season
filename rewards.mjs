// Coins: what a finished season and a badge pay, and the one-time starting balance. Contract: SHOP.md (4.1).
// Pure and framework-free, like game-logic.mjs and badges.mjs: the browser shows what a season paid from it,
// and the submit-run Edge Function runs this same file to pay the season.
//
// Coin amounts live here and nowhere else in JavaScript. The database pays three things by itself - the
// welcome coins (create_wallet), the minigame coins (claim_minigame) and the starting balance (the backfill
// at the bottom of supabase/migration-wallet.sql) - and tests/test-wallet-sql.mjs checks those against these
// numbers.
import { BADGES, BADGE_BY_ID } from "./badges.mjs";
import { normFormat } from "./game-logic.mjs";

export const COIN_RULES = Object.freeze({
  season: 20, // finishing an Unlimited, Genius or GM season
  dailySeason: 40, // finishing a Daily, instead of `season`
  win: 2, // each win, playoff wins included
  playoffs: 10,
  title: 50,
  perfect: 150, // on top of the title
  pointsPer: 10, // 1 coin per this many ladder points the draft earned, when it earned any
  streakPerDay: 5, // a Daily only: per day of the streak it makes...
  streakMax: 50, // ...up to this
  minigame: 15, // Over/Under and Build-a-player, once each per game day in the player's calendar (SQL: claim_minigame)
  paidSeasonsPerDay: 20, // Unlimited/Genius/GM seasons that pay per UTC day; Dailies don't count toward it
  welcome: 250, // a new account (SQL: create_wallet)
  startingCap: 10000, // the one-time starting balance's cap (SQL: the backfill)
});

// A count from something that may be missing, fractional or negative.
const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

// What one finished season pays, line by line: { total, lines: [{ key, label, coins }] }. `run` is the run
// submit-run records (w, playoffs, champ, perfect, points, mode); `streak` is the daily streak this Daily
// makes, and is ignored for anything but a Daily. A line that pays nothing is left out.
export function coinsForRun(run, { streak = 0 } = {}) {
  const r = run || {};
  const daily = r.mode === "daily";
  const lines = [];
  const add = (key, label, coins) => {
    if (coins > 0) lines.push({ key, label, coins });
  };
  add("season", daily ? "Finished the Daily" : "Finished a season", daily ? COIN_RULES.dailySeason : COIN_RULES.season);
  const wins = count(r.w);
  add("wins", `${wins} ${wins === 1 ? "win" : "wins"}`, wins * COIN_RULES.win);
  if (r.playoffs) add("playoffs", "Made the playoffs", COIN_RULES.playoffs);
  if (r.champ) add("title", "Won the title", COIN_RULES.title);
  if (r.perfect) add("perfect", "Went 20–0", COIN_RULES.perfect);
  const points = count(r.points);
  add("points", `${points} ladder points`, Math.floor(points / COIN_RULES.pointsPer));
  if (daily) {
    const days = count(streak);
    add("streak", `${days}-day streak`, Math.min(COIN_RULES.streakMax, days * COIN_RULES.streakPerDay));
  }
  return { total: lines.reduce((sum, line) => sum + line.coins, 0), lines };
}

// The ledger entry a finished season pays under, with its coins: { kind, ref, amount, lines, dailyCap }.
// A Daily is paid once per date and format and always pays; any other season once per challenge code, and
// only while the player's paid seasons today are under the cap. `date` is the Daily's own date.
export function seasonReward(run, { date = null, streak = 0 } = {}) {
  const { total, lines } = coinsForRun(run, { streak });
  if (run?.mode === "daily") {
    return { kind: "daily", ref: `${date}:${normFormat(run.format)}`, amount: total, lines, dailyCap: null };
  }
  return { kind: "season", ref: String(run?.code ?? ""), amount: total, lines, dailyCap: COIN_RULES.paidSeasonsPerDay };
}

// The starting balance for an account from before coins existed, from its career counters (the app's stats
// shape): 20 a season, 2 a win, 10 a playoff trip, 50 a title, 150 a perfect season - never less than a new
// account's welcome coins, and capped.
export function startingBalance(stats) {
  const s = stats || {};
  const career = count(s.runs) * COIN_RULES.season + count(s.wins) * COIN_RULES.win + count(s.playoffs) * COIN_RULES.playoffs
    + count(s.champs) * COIN_RULES.title + count(s.perfect) * COIN_RULES.perfect;
  return Math.min(COIN_RULES.startingCap, Math.max(COIN_RULES.welcome, career));
}

// Every earned badge with what it pays, in catalog order: [{ id, coins }] from badges.mjs's badgeProgress.
// Badges that pay nothing are included too, so badge_awards records them.
export function badgeRewards(progress) {
  const earned = new Set((Array.isArray(progress) ? progress : []).filter((p) => p?.earned).map((p) => p.id));
  return BADGES.filter((b) => earned.has(b.id)).map((b) => ({ id: b.id, coins: b.coins }));
}

// submit-run's `coins` answer from the season's credit and the badge awards:
//   season - credit_coins's answer plus the season's lines: { credited, balance, capped, lines }
//   awards - award_badges's answer: { awarded, credited, balance }
// -> { earned, balance, capped, lines }, lines being the season's (when it paid) then each paying new badge's.
export function coinsSummary(season, awards) {
  const awarded = Array.isArray(awards?.awarded) ? awards.awarded : [];
  const badgeLines = awarded.map((id) => BADGE_BY_ID[id]).filter((b) => b && b.coins > 0)
    .map((b) => ({ key: `badge:${b.id}`, label: `${b.name} badge`, coins: b.coins }));
  const seasonPaid = count(season?.credited) > 0;
  return {
    earned: count(season?.credited) + count(awards?.credited),
    balance: count(awards ? awards.balance : season?.balance),
    capped: !!season?.capped,
    lines: [...(seasonPaid && Array.isArray(season.lines) ? season.lines : []), ...badgeLines],
  };
}
