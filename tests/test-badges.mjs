// badges.mjs: the catalog, every badge's rule just below, at and just above its threshold, missing and
// partial inputs, topBadges' order and cap, the example profiles in tests/fixtures, that a growing record
// never loses a badge, and that the module stays pure (the submit-run Edge Function imports it from
// v1.12.0). Pure logic, no DOM.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import {
  BADGES, BADGE_BY_ID, BADGE_TIERS, TIER_COINS, CINDERELLA_MAX_SCORE, SCOUT_MIN_POINTS, DAY_ONE_BEFORE, badgeProgress, topBadges,
} from "../badges.mjs";
import { mapPlayerStats, emptyPlayerStats } from "../profile-rules.mjs";
import { rowToProfile } from "../storage-core.js";
import { mulberry32 } from "../game-logic.mjs";
import { veteranProfile, rookieProfile, photoProfile, VETERAN_STATS_JSON } from "./fixtures/profile-fixture.mjs";

const byId = (input) => Object.fromEntries(badgeProgress(input).map((p) => [p.id, p]));
const earnedIds = (input) => badgeProgress(input).filter((p) => p.earned).map((p) => p.id);
const fromProfile = (p) => ({ stats: p.stats, extra: p.extra, details: p.details, joined: p.joined });
const ids = (badges) => badges.map((b) => b.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await runTest("the catalog: 22 badges in the contract's shape, coins by tier", async () => {
  assert(BADGES.length === 22, `expected 22 badges, got ${BADGES.length}`);
  assert(new Set(BADGES.map((b) => b.id)).size === 22, "badge ids must be unique");
  for (const b of BADGES) {
    assert(same(Object.keys(b).sort(), ["coins", "emoji", "how", "id", "name", "tier"]), `${b.id} has keys ${Object.keys(b)}`);
    assert(BADGE_TIERS.includes(b.tier), `${b.id}: unknown tier ${b.tier}`);
    assert(BADGE_BY_ID[b.id] === b, `BADGE_BY_ID is missing ${b.id}`);
    assert(b.name && b.emoji && b.how, `${b.id} needs a name, emoji and how`);
    const unpaid = b.id === "stat-nerd" || b.id === "mad-scientist"; // browser-saved scores pay nothing
    assert(b.coins === (unpaid ? 0 : TIER_COINS[b.tier]), `${b.id}: coins ${b.coins}`);
  }
  assert(Object.keys(BADGE_BY_ID).length === 22, "BADGE_BY_ID has exactly the catalog");
});

await runTest("badges.mjs is pure: no imports, so it loads on its own anywhere", async () => {
  const source = readFileSync(new URL("../badges.mjs", import.meta.url), "utf8");
  assert(!/^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s*(\*|\{[^}]*\})\s*from\s/m.test(source), "badges.mjs must not import anything");
  const alone = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  assert(alone.badgeProgress({}).length === 22, "it should work loaded with nothing around it");
});

// [badge, need, input carrying a value]. Each is checked at need - 1, need and need + 1.
const COUNTED = [
  ["first-down", 1, (v) => ({ stats: { runs: v } })],
  ["starter", 25, (v) => ({ stats: { runs: v } })],
  ["veteran", 100, (v) => ({ stats: { runs: v } })],
  ["hall-of-famer", 500, (v) => ({ stats: { runs: v } })],
  ["ring-bearer", 1, (v) => ({ stats: { champs: v } })],
  ["dynasty", 10, (v) => ({ stats: { champs: v } })],
  ["undefeated", 1, (v) => ({ stats: { perfect: v } })],
  ["playoff-regular", 25, (v) => ({ stats: { playoffs: v } })],
  ["big-brain", 1, (v) => ({ extra: { byLadder: [{ ladder: "unlimited", champs: 9 }, { ladder: "genius", champs: v }] } })],
  ["front-office", 1, (v) => ({ extra: { byLadder: [{ ladder: "gm", champs: v }] } })],
  ["daily-champion", 1, (v) => ({ extra: { byLadder: [{ ladder: "daily", champs: v }] } })],
  ["old-school", 1, (v) => ({ extra: { byFormat: { fantasy: { champs: 9 }, standard: { champs: v } } } })],
  ["hot-streak", 3, (v) => ({ stats: { dailyBestStreak: v } })],
  ["week-warrior", 7, (v) => ({ stats: { dailyBestStreak: v } })],
  ["every-single-day", 30, (v) => ({ stats: { dailyBestStreak: v } })],
  ["loyal-fan", 25, (v) => ({ details: { favoriteTeam: "KC" }, extra: { teamCounts: [{ team: "NE", count: 90 }, { team: "KC", count: v }] } })],
  ["mad-scientist", 10, (v) => ({ extra: { builds: { count: v } } })],
];

await runTest("counted badges: just below, at and above the threshold, with progress capped at need", async () => {
  for (const [id, need, input] of COUNTED) {
    const below = byId(input(need - 1))[id], at = byId(input(need))[id], above = byId(input(need + 1))[id];
    assert(same(below, { id, have: need - 1, need, earned: false }), `${id} at ${need - 1}: ${JSON.stringify(below)}`);
    assert(same(at, { id, have: need, need, earned: true }), `${id} at ${need}: ${JSON.stringify(at)}`);
    assert(same(above, { id, have: need, need, earned: true }), `${id} at ${need + 1}: ${JSON.stringify(above)}`);
    if (need > 1) assert(BADGE_BY_ID[id].how.includes(String(need)), `${id}'s how text should say ${need}: "${BADGE_BY_ID[id].how}"`);
  }
});

await runTest("yes/no badges: just below, at and above the threshold", async () => {
  const check = (id, input, earned, label) => {
    const p = byId(input)[id];
    assert(same(p, { id, have: earned ? 1 : 0, need: 1, earned }), `${id}, ${label}: ${JSON.stringify(p)}`);
  };
  const upset = (fantasy, standard) => ({ extra: { byFormat: { fantasy: { biggestUpset: fantasy == null ? null : { score: fantasy } }, standard: { biggestUpset: standard == null ? null : { score: standard } } } } });
  const C = CINDERELLA_MAX_SCORE;
  check("cinderella", upset(C + 0.1, null), false, "a title just above the score");
  check("cinderella", upset(C, null), true, "a title at the score");
  check("cinderella", upset(C - 0.1, null), true, "a title below the score");
  check("cinderella", upset(null, C), true, "a Championship-scoring title counts too");
  check("cinderella", upset(C + 20, C - 5), true, "the lower of the two formats' titles");
  check("cinderella", upset(C + 0.1, C + 0.1), false, "both formats above");
  check("cinderella", upset(null, null), false, "no titles");
  assert(BADGE_BY_ID.cinderella.how.includes(`${C} or lower`), `cinderella's how text: "${BADGE_BY_ID.cinderella.how}"`);

  check("scout", { extra: { bestPoints: SCOUT_MIN_POINTS - 1 } }, false, "one point short");
  check("scout", { extra: { bestPoints: SCOUT_MIN_POINTS } }, true, "exactly");
  check("scout", { extra: { bestPoints: SCOUT_MIN_POINTS + 1 } }, true, "one over");
  check("scout", { extra: { bestPoints: null } }, false, "no finished draft");
  assert(BADGE_BY_ID.scout.how.includes(`${SCOUT_MIN_POINTS} or more`), `scout's how text: "${BADGE_BY_ID.scout.how}"`);

  check("daily-winner", { extra: { dailies: { bestRank: 2 } } }, false, "second at best");
  check("daily-winner", { extra: { dailies: { bestRank: 1 } } }, true, "first");
  check("daily-winner", { extra: { dailies: { bestRank: null } } }, false, "no finished days");

  check("stat-nerd", { extra: { overUnder: { best: 14 } } }, false, "14");
  check("stat-nerd", { extra: { overUnder: { best: 15 } } }, true, "15");
  check("stat-nerd", { extra: { overUnder: { best: 16 } } }, true, "16");
  check("stat-nerd", { extra: { overUnder: { best: null, played: 0 } } }, false, "never played");
  assert(BADGE_BY_ID["stat-nerd"].how.includes("15"), "stat-nerd's how text says 15");

  const cutoff = Date.parse(DAY_ONE_BEFORE);
  check("day-one", { joined: new Date(cutoff - 1).toISOString() }, true, "the last moment of the first month");
  check("day-one", { joined: DAY_ONE_BEFORE }, false, "the first moment after it");
  check("day-one", { joined: "2026-11-01T00:00:00.000Z" }, false, "later");
  check("day-one", { joined: "2025-12-25T00:00:00.000Z" }, true, "before Gridspin was renamed");
  check("day-one", { joined: null }, false, "no join date");
  check("day-one", { joined: "not a date" }, false, "an unreadable join date");
});

await runTest("missing and partial inputs count as nothing done, and never throw", async () => {
  const nothing = BADGES.map((b) => ({ id: b.id, have: 0, need: byId({})[b.id].need, earned: false }));
  for (const [label, input] of [
    ["no argument", undefined], ["null", null], ["{}", {}],
    ["all null", { stats: null, extra: null, details: null, joined: null }],
    ["an account with no history", { stats: rowToProfile({ id: "x", username: "x", runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] }), extra: mapPlayerStats(emptyPlayerStats()), details: { favoriteTeam: null } }],
    ["half-filled extra", { extra: { byFormat: { fantasy: { biggestUpset: { score: null } } }, dailies: { bestRank: null }, overUnder: {}, builds: {} } }],
    ["malformed lists", { extra: { byLadder: { genius: { champs: 3 } }, teamCounts: "KC", byFormat: [] }, details: { favoriteTeam: "KC" } }],
    ["junk values", { stats: { runs: "lots", champs: -4, perfect: NaN, dailyBestStreak: undefined }, extra: { bestPoints: "", dailies: { bestRank: "" } } }],
  ]) {
    const progress = badgeProgress(input);
    assert(same(progress.map((p) => p.id), BADGES.map((b) => b.id)), `${label}: progress must list every badge in catalog order`);
    assert(same(progress, nothing), `${label}: expected nothing earned, got ${JSON.stringify(progress.filter((p) => p.earned || p.have))}`);
  }
  // A missing upset score or rank is not a zero: Number(null) would have made both look earned.
  assert(!byId({ extra: { byFormat: { standard: { biggestUpset: { score: null } } } } }).cinderella.earned, "a null upset score isn't a title at 0");
  assert(!byId({ extra: { dailies: { bestRank: 0 } } })["daily-winner"].earned, "rank 0 isn't a win");
  // Numbers that arrive as strings still count.
  assert(byId({ stats: { runs: "25" } }).starter.earned && byId({ extra: { bestPoints: String(SCOUT_MIN_POINTS) } }).scout.earned, "numeric strings count");
  // Loyal Fan needs a favorite team, and only that team's drafts count.
  const counts = { teamCounts: [{ team: "KC", count: 40 }, { team: "NE", count: 3 }] };
  assert(same(byId({ extra: counts })["loyal-fan"], { id: "loyal-fan", have: 0, need: 25, earned: false }), "no favorite team, no Loyal Fan");
  assert(byId({ extra: counts, details: { favoriteTeam: "NE" } })["loyal-fan"].have === 3, "a favorite team counts only its own drafts");
  assert(byId({ extra: counts, details: { favoriteTeam: "SF" } })["loyal-fan"].have === 0, "a favorite team never drafted from");
  // Titles elsewhere don't earn the mode badges.
  const elsewhere = byId({ stats: { champs: 12 }, extra: { byLadder: [{ ladder: "unlimited", champs: 12 }], byFormat: { fantasy: { champs: 12 } } } });
  assert(!elsewhere["big-brain"].earned && !elsewhere["front-office"].earned && !elsewhere["daily-champion"].earned && !elsewhere["old-school"].earned,
    "Unlimited fantasy titles earn none of Big Brain, Front Office, Daily Champion or Old School");
});

await runTest("topBadges: gold, special, silver, bronze, then catalog order, up to n", async () => {
  const all = BADGES.map((b) => ({ id: b.id, have: 1, need: 1, earned: true }));
  const ORDER = [
    "hall-of-famer", "undefeated", "every-single-day", "cinderella", "daily-winner",
    "day-one",
    "veteran", "dynasty", "playoff-regular", "big-brain", "front-office", "daily-champion", "old-school", "week-warrior", "scout",
    "first-down", "starter", "ring-bearer", "hot-streak", "loyal-fan", "stat-nerd", "mad-scientist",
  ];
  assert(same(ids(topBadges(all, 22)), ORDER), `full order: ${ids(topBadges(all, 22))}`);
  assert(same(ids(topBadges(all)), ORDER.slice(0, 3)), "three by default");
  assert(same(ids(topBadges([...all].reverse(), 7)), ORDER.slice(0, 7)), "the order doesn't depend on the input's order");
  assert(topBadges(all, 0).length === 0 && topBadges(all, 40).length === 22, "n caps the list");
  assert(topBadges(all, 1)[0] === BADGE_BY_ID["hall-of-famer"], "returns the catalog entries themselves");

  const some = all.map((p) => ({ ...p, earned: ["starter", "day-one", "scout", "stat-nerd"].includes(p.id) }));
  assert(same(ids(topBadges(some)), ["day-one", "scout", "starter"]), `special before silver before bronze: ${ids(topBadges(some))}`);
  assert(same(ids(topBadges(some, 10)), ["day-one", "scout", "starter", "stat-nerd"]), "only earned badges");
  assert(topBadges([], 3).length === 0 && topBadges(null).length === 0 && topBadges(undefined).length === 0, "nothing earned, nothing shown");
  assert(topBadges([{ id: "no-such-badge", earned: true }, null, { id: "starter", earned: false }]).length === 0, "unknown and unearned entries are skipped");
  assert(same(ids(topBadges([{ id: "starter", earned: true }, { id: "starter", earned: true }])), ["starter"]), "a repeated entry shows once");
});

await runTest("the example profiles give sensible badges", async () => {
  const vet = byId(fromProfile(veteranProfile()));
  const expectEarned = [
    "first-down", "starter", "ring-bearer", "undefeated", "playoff-regular", "big-brain", "front-office", "daily-champion", "old-school",
    "hot-streak", "week-warrior", "daily-winner", "loyal-fan", "stat-nerd", "day-one",
    ...(VETERAN_STATS_JSON.by_format.fantasy.biggest_upset.score <= CINDERELLA_MAX_SCORE ? ["cinderella"] : []),
    ...(VETERAN_STATS_JSON.best_points >= SCOUT_MIN_POINTS ? ["scout"] : []),
  ];
  const got = Object.values(vet).filter((p) => p.earned).map((p) => p.id);
  assert(same([...got].sort(), [...expectEarned].sort()), `veteran earned ${got}`);
  assert(same(vet.veteran, { id: "veteran", have: 64, need: 100, earned: false }), `64 of 100 seasons: ${JSON.stringify(vet.veteran)}`);
  assert(same(vet.dynasty, { id: "dynasty", have: 9, need: 10, earned: false }), "9 of 10 titles");
  assert(vet["every-single-day"].have === 9 && vet["mad-scientist"].have === 4 && vet["loyal-fan"].have === 25, "progress toward the rest");
  assert(same(ids(topBadges(badgeProgress(fromProfile(veteranProfile())))), ["undefeated", "cinderella", "daily-winner"]), "the veteran's card shows three gold badges");
  assert(same(badgeProgress(fromProfile(photoProfile())), badgeProgress(fromProfile(veteranProfile()))), "a photo changes no badge");

  const rookie = fromProfile(rookieProfile());
  assert(same(earnedIds(rookie), ["day-one"]), `a first-month rookie has only Day One: ${earnedIds(rookie)}`);
  assert(badgeProgress(rookie).every((p) => p.earned || p.have === 0), "and no progress toward anything else");
  assert(same(ids(topBadges(badgeProgress(rookie))), ["day-one"]), "the rookie's card shows Day One");
  const lateRookie = fromProfile(rookieProfile({ joined: "2026-12-01T10:00:00.000Z" }));
  assert(earnedIds(lateRookie).length === 0 && topBadges(badgeProgress(lateRookie)).length === 0, "someone joining later starts with nothing");
});

await runTest("a growing record never loses a badge", async () => {
  // Plays out careers event by event - seasons, titles, streaks, dailies, minigames - and requires every
  // earned badge to stay earned and no progress to go backwards. The favorite team stays put: Loyal Fan
  // follows whichever team is the favorite now, the one badge that can go (checked last).
  const rng = mulberry32(20260914);
  const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  for (let career = 0; career < 40; career++) {
    const stats = { runs: 0, champs: 0, perfect: 0, playoffs: 0, dailyBestStreak: 0 };
    const ladders = { daily: 0, unlimited: 0, genius: 0, gm: 0 };
    const extra = {
      byLadder: [], teamCounts: [], bestPoints: null, dailies: { bestRank: null }, overUnder: { best: null }, builds: { count: 0 },
      byFormat: { fantasy: { champs: 0, biggestUpset: null }, standard: { champs: 0, biggestUpset: null } },
    };
    const teams = { KC: 0, NE: 0 };
    let streak = 0;
    let before = badgeProgress({ stats, extra, details: { favoriteTeam: "KC" }, joined: "2026-09-20T00:00:00.000Z" });
    for (let step = 0; step < 400; step++) {
      const event = int(0, 5);
      if (event <= 2) {
        const format = rng() < 0.3 ? "standard" : "fantasy", ladder = ["daily", "unlimited", "genius", "gm"][int(0, 3)];
        stats.runs++;
        if (rng() < 0.5) stats.playoffs++;
        if (rng() < 0.2) {
          stats.champs++; ladders[ladder]++; extra.byFormat[format].champs++;
          const score = 90 + int(0, 300) / 10, u = extra.byFormat[format].biggestUpset;
          if (!u || score < u.score) extra.byFormat[format].biggestUpset = { score };
          if (rng() < 0.2) stats.perfect++;
        }
        extra.bestPoints = Math.max(extra.bestPoints ?? -Infinity, int(-300, 320));
        for (let i = 0; i < 6; i++) teams[rng() < 0.4 ? "KC" : "NE"]++;
      } else if (event === 3) {
        streak = rng() < 0.85 ? streak + 1 : 1;
        stats.dailyBestStreak = Math.max(stats.dailyBestStreak, streak);
        const rank = int(1, 40);
        extra.dailies.bestRank = extra.dailies.bestRank == null ? rank : Math.min(extra.dailies.bestRank, rank);
      } else if (event === 4) {
        extra.overUnder.best = Math.max(extra.overUnder.best ?? 0, int(0, 20));
      } else {
        extra.builds.count++;
      }
      extra.byLadder = Object.entries(ladders).map(([ladder, champs]) => ({ ladder, champs }));
      extra.teamCounts = Object.entries(teams).map(([team, count]) => ({ team, count }));
      const after = badgeProgress({ stats, extra, details: { favoriteTeam: "KC" }, joined: "2026-09-20T00:00:00.000Z" });
      after.forEach((p, i) => {
        assert(!before[i].earned || p.earned, `career ${career} step ${step}: lost ${p.id}`);
        assert(p.have >= before[i].have, `career ${career} step ${step}: ${p.id} progress went from ${before[i].have} to ${p.have}`);
      });
      before = after;
    }
    assert(before.filter((p) => p.earned).length >= 10, `career ${career} should have earned plenty by the end`);
  }
  const fan = { extra: { teamCounts: [{ team: "KC", count: 30 }, { team: "NE", count: 2 }] } };
  assert(byId({ ...fan, details: { favoriteTeam: "KC" } })["loyal-fan"].earned && !byId({ ...fan, details: { favoriteTeam: "NE" } })["loyal-fan"].earned,
    "Loyal Fan follows the current favorite team");
});

console.log("test-badges.mjs done");
