// rewards.mjs (SHOP.md 4.1): what a finished season and a badge pay, the one-time starting balance, and the
// `coins` answer submit-run builds from the database's credits. Pure functions, so every rule is pinned here
// directly: each COIN_RULES line and its label, a Daily against any other season, the streak cap, missing and
// negative inputs, seasonReward's ledger refs and caps, startingBalance's floor and cap, badgeRewards' order and
// its zero-coin badges, and coinsSummary for a paid season, a capped one, no awards and badge lines.
// The SQL's own copies of these numbers are checked in test-wallet-sql.mjs.
import { assert, runTest } from "./helpers.mjs";
import { COIN_RULES, coinsForRun, seasonReward, startingBalance, badgeRewards, coinsSummary } from "../rewards.mjs";
import { BADGES, BADGE_BY_ID, badgeProgress } from "../badges.mjs";

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => JSON.stringify(v);
const line = (key, label, coins) => ({ key, label, coins });
const keys = (result) => result.lines.map((l) => l.key);

await runTest("COIN_RULES are the contract's numbers, and can't be changed at run time", async () => {
  const want = {
    season: 20, dailySeason: 40, win: 2, playoffs: 10, title: 50, perfect: 150, pointsPer: 10,
    streakPerDay: 5, streakMax: 50, minigame: 15, paidSeasonsPerDay: 20, welcome: 250, startingCap: 10000,
  };
  assert(same(COIN_RULES, want), `COIN_RULES: ${show(COIN_RULES)}`);
  assert(Object.isFrozen(COIN_RULES), "COIN_RULES is frozen");
  try {
    COIN_RULES.win = 1000;
  } catch (e) {
    // a strict-mode module throws on writing a frozen object; either way nothing changes
  }
  assert(COIN_RULES.win === 2, "writing to COIN_RULES changes nothing");
});

await runTest("coinsForRun: every line in order, each with its label and coins", async () => {
  // A perfect Unlimited season: every line but the streak, which only a Daily has.
  const perfect = coinsForRun({ mode: "free", w: 20, l: 0, playoffs: true, champ: true, perfect: true, points: 145 }, { streak: 9 });
  assert(same(perfect.lines, [
    line("season", "Finished a season", 20),
    line("wins", "20 wins", 40),
    line("playoffs", "Made the playoffs", 10),
    line("title", "Won the title", 50),
    line("perfect", "Went 20–0", 150),
    line("points", "145 ladder points", 14),
  ]), `a perfect season's lines: ${show(perfect.lines)}`);
  assert(perfect.total === 284, `the total adds up the lines: ${perfect.total}`);
  assert(perfect.lines[4].label === "Went 20–0", "20-0 is written with an en dash (U+2013), like the rest of the app");

  // A title short of perfect, and a season that missed the playoffs.
  const title = coinsForRun({ mode: "free", w: 17, l: 3, playoffs: true, champ: true, perfect: false, points: 99 });
  assert(same(keys(title), ["season", "wins", "playoffs", "title", "points"]) && title.total === 20 + 34 + 10 + 50 + 9, `a title: ${show(title)}`);
  const missed = coinsForRun({ mode: "free", w: 6, l: 11, playoffs: false, champ: false, perfect: false, points: -120 });
  assert(same(missed.lines, [line("season", "Finished a season", 20), line("wins", "6 wins", 12)]) && missed.total === 32, `missed the playoffs: ${show(missed)}`);

  // Genius and GM seasons pay by the same rules as Unlimited: only a Daily is different.
  const gm = coinsForRun({ mode: "free", gm: true, w: 6, l: 11, points: -120 });
  const genius = coinsForRun({ mode: "free", genius: true, w: 6, l: 11, points: -120 });
  assert(same(gm, missed) && same(genius, missed), "GM and Genius pay like Unlimited");
});

await runTest("coinsForRun: a line that pays nothing is left out, and one win is singular", async () => {
  const nothing = coinsForRun({ mode: "free", w: 0, l: 17, playoffs: false, champ: false, perfect: false, points: 0 });
  assert(same(nothing, { total: 20, lines: [line("season", "Finished a season", 20)] }), `a winless season still pays for finishing: ${show(nothing)}`);
  assert(same(coinsForRun({ mode: "free", w: 1, l: 16 }).lines[1], line("wins", "1 win", 2)), "1 win");
  assert(same(coinsForRun({ mode: "free", w: 2, l: 15 }).lines[1], line("wins", "2 wins", 4)), "2 wins");
});

await runTest("coinsForRun: ladder points pay 1 coin per 10, and nothing when missing, negative or under 10", async () => {
  const pointsLine = (points) => coinsForRun({ mode: "free", w: 0, points }).lines.find((l) => l.key === "points") ?? null;
  for (const points of [undefined, null, "", "lots", NaN, Infinity, -Infinity, -300, -1, 0, 9, 9.99]) {
    assert(pointsLine(points) === null, `points ${show(points)} (${String(points)}) pay nothing, got ${show(pointsLine(points))}`);
  }
  assert(same(pointsLine(10), line("points", "10 ladder points", 1)), `10 points: ${show(pointsLine(10))}`);
  assert(same(pointsLine(19), line("points", "19 ladder points", 1)), `19 points: ${show(pointsLine(19))}`);
  assert(same(pointsLine(145), line("points", "145 ladder points", 14)), `145 points: ${show(pointsLine(145))}`);
  assert(same(pointsLine(387), line("points", "387 ladder points", 38)), `387 points: ${show(pointsLine(387))}`);
  // Counters from something odd are whole and never negative.
  assert(same(coinsForRun({ mode: "free", w: -4, points: 10.9 }).lines, [line("season", "Finished a season", 20), line("points", "10 ladder points", 1)]), "a negative win count pays nothing; fractions round down");
  assert(same(coinsForRun({ mode: "free", w: "12" }).lines[1], line("wins", "12 wins", 24)), "a numeric string counts");
});

await runTest("coinsForRun: a Daily pays 40 for finishing plus 5 a streak day up to 50; any other season ignores the streak", async () => {
  const daily = coinsForRun({ mode: "daily", w: 12, l: 8, playoffs: true, champ: false, perfect: false, points: 57 }, { streak: 6 });
  assert(same(daily.lines, [
    line("season", "Finished the Daily", 40),
    line("wins", "12 wins", 24),
    line("playoffs", "Made the playoffs", 10),
    line("points", "57 ladder points", 5),
    line("streak", "6-day streak", 30),
  ]) && daily.total === 109, `a Daily: ${show(daily)}`);

  const streakLine = (streak) => coinsForRun({ mode: "daily", w: 0 }, streak === undefined ? undefined : { streak }).lines.find((l) => l.key === "streak") ?? null;
  assert(same(streakLine(1), line("streak", "1-day streak", 5)), `a first Daily is a 1-day streak: ${show(streakLine(1))}`);
  assert(same(streakLine(9), line("streak", "9-day streak", 45)), "9 days: 45");
  assert(same(streakLine(10), line("streak", "10-day streak", 50)), "10 days: the cap, 50");
  assert(same(streakLine(11), line("streak", "11-day streak", 50)), "11 days: still 50");
  assert(same(streakLine(365), line("streak", "365-day streak", 50)), "a year: still 50");
  for (const streak of [undefined, 0, -3, null, NaN]) assert(streakLine(streak) === null, `a streak of ${String(streak)} pays nothing`);

  // The streak only counts for a Daily.
  for (const mode of ["free", undefined, "unlimited"]) {
    const run = coinsForRun({ mode, w: 12, l: 8, playoffs: true, points: 57 }, { streak: 6 });
    assert(!keys(run).includes("streak") && run.lines[0].label === "Finished a season" && run.lines[0].coins === 20, `mode ${mode} has no streak line: ${show(run)}`);
  }
});

await runTest("seasonReward: a Daily pays under <date>:<format> with no cap; any other season under its code, capped per day", async () => {
  const run = { mode: "daily", w: 14, l: 6, playoffs: true, points: 88, format: "standard" };
  const daily = seasonReward(run, { date: "2026-09-14", streak: 3 });
  const lines = coinsForRun(run, { streak: 3 });
  assert(same(daily, { kind: "daily", ref: "2026-09-14:standard", amount: lines.total, lines: lines.lines, dailyCap: null }), `a Championship Daily: ${show(daily)}`);
  for (const format of [undefined, null, "fantasy", "nonsense"]) {
    const r = seasonReward({ ...run, format }, { date: "2026-09-15" });
    assert(r.kind === "daily" && r.ref === "2026-09-15:fantasy" && r.dailyCap === null, `format ${show(format)} is the fantasy Daily: ${show(r)}`);
  }

  for (const variant of [{}, { gm: true }, { genius: true }, { format: "standard" }]) {
    const season = { mode: "free", code: "K3F9QZ", w: 11, l: 6, playoffs: true, points: 40, ...variant };
    const r = seasonReward(season, { date: "2026-09-14", streak: 12 });
    const want = coinsForRun(season);
    assert(same(r, { kind: "season", ref: "K3F9QZ", amount: want.total, lines: want.lines, dailyCap: COIN_RULES.paidSeasonsPerDay }), `a season ${show(variant)}: ${show(r)}`);
    assert(!keys(r).includes("streak"), "a season's streak never pays, whatever is passed");
  }
  assert(COIN_RULES.paidSeasonsPerDay === 20 && seasonReward({ mode: "free", code: "ABCD" }).dailyCap === 20, "the cap is 20 seasons a day");
  // A season without a code gets an empty ref, which credit_coins refuses (bad_ref) rather than paying under a shared key.
  assert(seasonReward({ mode: "free", w: 3 }).ref === "", "no code, no ref");
});

await runTest("startingBalance: 20 a season, 2 a win, 10 a playoff trip, 50 a title, 150 a perfect season; at least 250, at most 10,000", async () => {
  const cases = [
    [{ runs: 30, wins: 350, playoffs: 12, champs: 4, perfect: 1 }, 600 + 700 + 120 + 200 + 150],
    [{ runs: 100, wins: 1200, playoffs: 60, champs: 20, perfect: 3 }, 2000 + 2400 + 600 + 1000 + 450],
    [{ runs: 12, wins: 1 }, 250], // 242 is under the floor
    [{ runs: 12, wins: 5 }, 250], // exactly 250
    [{ runs: 12, wins: 6 }, 252], // just over
    [{}, 250],
    [null, 250],
    [undefined, 250],
    [{ runs: 0, wins: 0, playoffs: 0, champs: 0, perfect: 0 }, 250],
    [{ runs: 500 }, 10000], // exactly the cap
    [{ runs: 499, wins: 1 }, 9982],
    [{ runs: 500, wins: 1 }, 10000], // one coin over is capped
    [{ runs: 9000, wins: 150000, playoffs: 9000, champs: 9000, perfect: 9000 }, 10000],
    // Missing or odd counters count as nothing, one at a time.
    [{ runs: null, wins: 300, playoffs: undefined, champs: 4, perfect: "" }, 600 + 200],
    [{ runs: -40, wins: 300 }, 600],
    [{ runs: 20.7, wins: 300.2 }, 400 + 600],
    [{ runs: "20", wins: "300" }, 1000],
    [{ runs: Infinity, wins: 300 }, 600],
  ];
  for (const [stats, want] of cases) {
    const got = startingBalance(stats);
    assert(got === want, `startingBalance(${show(stats)}) should be ${want}, got ${got}`);
  }
  assert(startingBalance({}) === COIN_RULES.welcome && startingBalance({ runs: 1e6 }) === COIN_RULES.startingCap, "the floor is a new account's welcome coins and the cap is startingCap");
  // Extra fields in the app's stats shape don't count.
  assert(startingBalance({ runs: 30, wins: 350, playoffs: 12, champs: 4, perfect: 1, losses: 250, dnf: 40, pointsBank: 99999 }) === 1770, "only the five career counters count");
});

await runTest("badgeRewards: every earned badge in catalog order with its coins, zero-coin badges included", async () => {
  assert(same(badgeRewards([]), []) && same(badgeRewards(null), []) && same(badgeRewards("nope"), []), "no progress, no badges");

  // A real player's progress: first season, 25+ seasons, a title, Genius title, a Daily streak, both minigame
  // badges (which pay nothing), and joined on day one.
  const progress = badgeProgress({
    stats: { runs: 30, champs: 1, perfect: 0, playoffs: 10, dailyBestStreak: 7 },
    extra: {
      byLadder: [{ ladder: "genius", champs: 1 }], byFormat: { fantasy: { champs: 1 }, standard: { champs: 0 } },
      bestPoints: 100, dailies: { bestRank: 4 }, overUnder: { best: 18 }, builds: { count: 12 }, teamCounts: [],
    },
    details: { favoriteTeam: null },
    joined: "2026-09-14T12:00:00.000Z",
  });
  const earned = progress.filter((p) => p.earned).map((p) => p.id);
  const want = BADGES.filter((b) => earned.includes(b.id)).map((b) => ({ id: b.id, coins: b.coins }));
  const got = badgeRewards(progress);
  assert(same(got, want), `every earned badge in catalog order: ${show(got)}`);
  assert(same(got.map((b) => b.id), ["first-down", "starter", "ring-bearer", "big-brain", "hot-streak", "week-warrior", "stat-nerd", "mad-scientist", "day-one"]),
    `the ids, in BADGES order: ${show(got.map((b) => b.id))}`);
  assert(same(got.map((b) => b.coins), [100, 100, 100, 300, 100, 300, 0, 0, 500]), `bronze 100, silver 300, special 500, minigame badges 0: ${show(got)}`);

  // Order follows the catalog, never the order the progress arrives in.
  const shuffled = [...progress].reverse();
  assert(same(badgeRewards(shuffled), want), "a reordered progress list still comes back in catalog order");
  // Unearned entries, junk entries and unknown ids are ignored.
  assert(same(badgeRewards([{ id: "undefeated", earned: false }, null, 7, { id: "no-such-badge", earned: true }, { id: "undefeated", earned: true }]), [{ id: "undefeated", coins: 1000 }]), "only earned, known badges");
  // Every badge, when all are earned: gold 1000, silver 300, bronze 100, special 500, and the two unpaid.
  const all = badgeRewards(BADGES.map((b) => ({ id: b.id, earned: true })));
  assert(all.length === BADGES.length && all.every((b, i) => b.id === BADGES[i].id && b.coins === BADGE_BY_ID[b.id].coins), "all 22 badges, each with its catalog coins");
  assert(same(all.filter((b) => b.coins === 0).map((b) => b.id), ["stat-nerd", "mad-scientist"]), "only Stat Nerd and Mad Scientist pay nothing");
});

await runTest("coinsSummary: a paid season's lines, then each new badge that pays", async () => {
  const seasonLines = coinsForRun({ mode: "free", w: 12, l: 5, playoffs: true, points: 57 }).lines; // 20 + 24 + 10 + 5 = 59
  const season = { credited: 59, balance: 309, capped: false, duplicate: false, lines: seasonLines };
  const awards = { awarded: ["first-down", "stat-nerd", "day-one"], credited: 600, balance: 909 };
  const got = coinsSummary(season, awards);
  assert(same(got, {
    earned: 659,
    balance: 909,
    capped: false,
    lines: [...seasonLines, line("badge:first-down", "First Down badge", 100), line("badge:day-one", "Day One badge", 500)],
  }), `a paid season with badges: ${show(got)}`);
  assert(same(Object.keys(got).sort(), ["balance", "capped", "earned", "lines"]), "exactly the contract's keys");
});

await runTest("coinsSummary: a capped or repeated season shows no season lines, and the badges still pay", async () => {
  const seasonLines = coinsForRun({ mode: "free", w: 9, l: 8 }).lines;
  const capped = coinsSummary({ credited: 0, balance: 5000, capped: true, duplicate: false, lines: seasonLines }, { awarded: [], credited: 0, balance: 5000 });
  assert(same(capped, { earned: 0, balance: 5000, capped: true, lines: [] }), `capped, no badges: ${show(capped)}`);

  const cappedWithBadge = coinsSummary({ credited: 0, balance: 5000, capped: true, lines: seasonLines }, { awarded: ["undefeated"], credited: 1000, balance: 6000 });
  assert(same(cappedWithBadge, { earned: 1000, balance: 6000, capped: true, lines: [line("badge:undefeated", "Undefeated badge", 1000)] }), `capped with a badge: ${show(cappedWithBadge)}`);

  const repeated = coinsSummary({ credited: 0, balance: 700, capped: false, duplicate: true, lines: seasonLines }, { awarded: [], credited: 0, balance: 700 });
  assert(same(repeated, { earned: 0, balance: 700, capped: false, lines: [] }), `a repeated ref pays nothing and shows nothing: ${show(repeated)}`);
});

await runTest("coinsSummary: no awards, badge lines only for badges that pay, and the later balance", async () => {
  const seasonLines = coinsForRun({ mode: "daily", w: 10, l: 7, points: 20 }, { streak: 2 }).lines; // 40 + 20 + 2 + 10
  const season = { credited: 72, balance: 572, capped: false, duplicate: false, lines: seasonLines };
  const none = coinsSummary(season, { awarded: [], credited: 0, balance: 572 });
  assert(same(none, { earned: 72, balance: 572, capped: false, lines: seasonLines }), `no new badges: ${show(none)}`);

  // Stat Nerd and Mad Scientist are awarded (so they're recorded) but pay nothing, so they get no line; an id the
  // catalog doesn't know gets none either.
  const unpaid = coinsSummary(season, { awarded: ["stat-nerd", "mad-scientist", "retired-badge"], credited: 0, balance: 572 });
  assert(same(unpaid.lines, seasonLines) && unpaid.earned === 72, `unpaid badges add no lines: ${show(unpaid)}`);

  // The balance is award_badges', which runs after the season's credit.
  const later = coinsSummary(season, { awarded: ["veteran"], credited: 300, balance: 872 });
  assert(later.balance === 872 && later.earned === 372, `balance after the badges: ${show(later)}`);
  assert(same(later.lines.at(-1), line("badge:veteran", "Veteran badge", 300)), "a silver badge's line");

  // Missing pieces read as nothing rather than throwing.
  assert(same(coinsSummary(null, null), { earned: 0, balance: 0, capped: false, lines: [] }), `nothing at all: ${show(coinsSummary(null, null))}`);
  assert(same(coinsSummary(season, null), { earned: 72, balance: 572, capped: false, lines: seasonLines }), "no awards answer: the season's balance");
  assert(same(coinsSummary({ credited: 20, balance: 270, capped: false }, { awarded: "first-down", credited: 100, balance: 370 }), { earned: 120, balance: 370, capped: false, lines: [] }),
    "a malformed awarded list or missing lines add no lines");
});

console.log("test-rewards.mjs done");
