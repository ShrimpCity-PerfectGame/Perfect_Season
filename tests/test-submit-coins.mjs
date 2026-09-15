// submit-run's coins (SHOP.md 4.2), end to end through storage.js's submitRun and submitDnf against the test mock,
// whose invokeSubmitRun mirrors supabase/functions/submit-run/index.ts step for step, with real, legal draft traces.
// Checks:
//   - a finished season pays its lines and the badges it earned, and the answer keeps what an older client reads;
//   - badges pay once, including ones earned before coins existed, which pay with the next finished season;
//   - a Daily pays 40 and its streak, under its date and format;
//   - a draft counts once: the same challenge code (in any variant) or the same Daily again answers
//     { ok: false, reason: "duplicate" } and writes nothing - not the profile, the runs log or the wallet;
//   - a challenge code over 32 characters is refused before anything is written;
//   - 20 Unlimited, Genius and GM seasons pay each UTC day, the 21st counts but pays nothing (capped), and a Daily
//     still pays;
//   - a DNF pays nothing; a reward that fails still counts the season, with coins: null;
//   - a failed save gives the challenge code (or the Daily's row) back, so a retry counts, and is never mistaken
//     for a duplicate.
import { assert, runTest, makeMockAuth } from "./helpers.mjs";
import * as GL from "../game-logic.mjs";
import { COIN_RULES, seasonReward, badgeRewards } from "../rewards.mjs";
import { BADGE_BY_ID, badgeProgress } from "../badges.mjs";
import { mapPlayerStats } from "../profile-rules.mjs";
import { rowToProfile } from "../storage-core.js";

globalThis.window = globalThis.window || {};
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
const { submitRun, submitDnf, fetchWallet } = await import("../storage.js");

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => String(JSON.stringify(v)).slice(0, 500);
const TODAY = new Date().toISOString().slice(0, 10);
// A joined date after Day One's window, so that badge only pays where a test gives it on purpose.
const JOINED_LATER = "2026-11-01T00:00:00.000Z";

// A real, legal draft for a seed, picked the way a player could: the first player on each board who fits an open slot
// - and, for a GM draft, whose salary still leaves the $1M minimum for every slot after it, since submit-run refuses a
// GM roster over the cap.
function legalTrace(seed, { gm = false, format } = {}) {
  const seq = GL.seededSequence(seed);
  const roster = {};
  const drafted = new Set();
  const history = [];
  let spent = 0;
  let at = GL.boardAt(seq, 0, roster);
  while (history.length < GL.SLOTS.length) {
    const key = seq[at];
    const open = GL.SLOTS.filter((s) => !roster[s]);
    const affordable = (p) => !gm || spent + GL.playerSalary(p, format) + (open.length - 1) <= GL.GM_CAP;
    const player = GL.BOARDS[key].find((p) => !drafted.has(p.id) && open.some((s) => GL.fits(p.pos, s)) && affordable(p));
    if (!player) throw new Error(`legalTrace(${seed}): nobody on ${key} fits an open slot${gm ? " under the cap" : ""}`);
    const slot = open.find((s) => GL.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot });
    roster[slot] = player;
    drafted.add(player.id);
    if (gm) spent += GL.playerSalary(player, format);
    if (history.length < GL.SLOTS.length) at = GL.boardAt(seq, at + 1, roster);
  }
  return { history, seq };
}
const season = (code, extra = {}) => submitRun({ mode: { kind: "free", code, ...(extra.gm ? { gm: true } : {}) }, ...legalTrace(code, extra), gm: !!extra.gm, genius: !!extra.genius, format: extra.format });
const daily = (format = "fantasy", date = TODAY) => submitRun({ mode: { kind: "daily", date }, ...legalTrace(GL.dailySeed(date, format)), gm: false, format });

let signups = 0;
async function signUp(username, profile = {}) {
  const email = `coins${++signups}@example.com`;
  const { data, error } = await auth.auth.signUp({ email, password: "Password1", options: { data: { username } } });
  assert(!error, `signing up ${username}: ${show(error)}`);
  Object.assign(auth._profiles.get(data.user.id), { created_at: JOINED_LATER, ...profile });
  return { id: data.user.id, email };
}
const signIn = (who) => auth.auth.signInWithPassword({ email: who.email, password: "Password1" });

const rowsOf = (map, uid) => [...map.values()].filter((r) => r.user_id === uid);
const ledgerOf = (uid) => rowsOf(auth._ledger, uid).sort((a, b) => a.id - b.id).map(({ amount, kind, ref }) => ({ amount, kind, ref }));
const awardedOf = (uid) => new Set(rowsOf(auth._badgeAwards, uid).map((r) => r.badge));
// Everything a submission can write for a player.
const snapshot = (uid) => JSON.stringify({
  profile: auth._profiles.get(uid), runs: rowsOf(auth._runs, uid), daily: rowsOf(auth._dailyRuns, uid), ledger: rowsOf(auth._ledger, uid),
  wallet: auth._wallets.get(uid) ?? null, awards: rowsOf(auth._badgeAwards, uid), codes: rowsOf(auth._finishedCodes, uid),
});
// The badges a player has now, from what's saved - the same inputs submit-run reads.
async function earnedBadges(uid) {
  const row = auth._profiles.get(uid);
  const { data } = await auth.rpc("player_stats", { p_user_id: uid });
  const favoriteTeam = auth._profileDetails.get(uid)?.favorite_team ?? null;
  return badgeRewards(badgeProgress({ stats: rowToProfile(row), extra: mapPlayerStats(data), details: { favoriteTeam }, joined: row.created_at })).map((b) => b.id);
}
const badgeLines = (ids) => ids.map((id) => BADGE_BY_ID[id]).filter((b) => b.coins > 0).map((b) => ({ key: `badge:${b.id}`, label: `${b.name} badge`, coins: b.coins }));
const total = (lines) => lines.reduce((sum, l) => sum + l.coins, 0);
// The HTTP answer itself, as supabase-js hands it to storage.js.
async function answer(body) {
  const { data, error } = await auth.functions.invoke("submit-run", { body });
  return error ? { status: error.context?.status, body: await error.context?.json?.() } : { status: 200, body: data };
}

// ---------- Paying a season ----------

await runTest("a finished season pays its lines and the badges it earned, and the answer keeps everything an older client reads", async () => {
  const fan = await signUp("coinfan");
  const res = await season("COINS-ONE");
  assert(res.ok === true, `the season counts: ${show(res)}`);
  assert(same(Object.keys(res).sort(), ["coins", "newBadges", "ok", "run"]), `ok and run as before, plus coins and newBadges: ${show(Object.keys(res))}`);
  assert(res.run.mode === "free" && res.run.code === "COINS-ONE" && Number.isFinite(res.run.score) && res.run.roster.length === 6, `the run: ${show(res.run)}`);

  const reward = seasonReward(res.run, {});
  assert(reward.kind === "season" && reward.ref === "COINS-ONE" && reward.lines[0].label === "Finished a season", `the season's reward: ${show(reward)}`);
  const earned = await earnedBadges(fan.id);
  assert(same(res.newBadges, earned) && res.newBadges.includes("first-down"), `every badge the player has is new: ${show(res.newBadges)} vs ${show(earned)}`);
  const badges = badgeLines(res.newBadges);
  assert(same(res.coins, {
    earned: reward.amount + total(badges),
    balance: COIN_RULES.welcome + reward.amount + total(badges),
    capped: false,
    lines: [...reward.lines, ...badges],
  }), `the coins answer: ${show(res.coins)}`);

  assert(same(ledgerOf(fan.id), [
    { amount: COIN_RULES.welcome, kind: "welcome", ref: "welcome" },
    { amount: reward.amount, kind: "season", ref: "COINS-ONE" },
    ...res.newBadges.filter((id) => BADGE_BY_ID[id].coins > 0).map((id) => ({ amount: BADGE_BY_ID[id].coins, kind: "badge", ref: id })),
  ]), `the ledger: ${show(ledgerOf(fan.id))}`);
  assert(same([...awardedOf(fan.id)].sort(), [...res.newBadges].sort()), "every new badge is recorded, the unpaid ones too");
  const wallet = await fetchWallet();
  assert(wallet?.balance === res.coins.balance && wallet.earned === res.coins.balance && wallet.spent === 0, `the wallet agrees: ${show(wallet)}`);
  assert(wallet.recent.some((m) => m.kind === "season" && m.ref === "COINS-ONE" && m.amount === reward.amount), "and lists the season");
});

await runTest("the next season pays its own coins and no badge a second time", async () => {
  const fan = await signUp("regular");
  const first = await season("REGULAR-1");
  const before = awardedOf(fan.id);
  const second = await season("REGULAR-2");
  assert(second.ok && second.coins, `the second season: ${show(second)}`);
  const earned = await earnedBadges(fan.id);
  assert(same(second.newBadges, earned.filter((id) => !before.has(id))), `only badges earned since: ${show(second.newBadges)}`);
  assert(!second.newBadges.includes("first-down"), "first-down doesn't pay again");
  const reward = seasonReward(second.run, {});
  assert(same(second.coins.lines, [...reward.lines, ...badgeLines(second.newBadges)]), `the lines: ${show(second.coins.lines)}`);
  assert(second.coins.balance === first.coins.balance + second.coins.earned, `the balance adds up: ${first.coins.balance} + ${second.coins.earned} vs ${second.coins.balance}`);
  assert(ledgerOf(fan.id).filter((l) => l.kind === "badge" && l.ref === "first-down").length === 1, "one first-down payment in the ledger");
});

await runTest("badges earned before coins existed pay with the player's next finished season, once", async () => {
  const vet = await signUp("oldtimer", {
    runs: 120, wins: 1500, losses: 700, champs: 12, perfect: 1, playoffs: 30, daily_streak: 0, daily_best_streak: 8,
    created_at: "2026-09-14T09:00:00.000Z", // joined on launch day
  });
  const res = await season("OLDTIMER-1");
  const known = ["first-down", "starter", "veteran", "ring-bearer", "dynasty", "undefeated", "playoff-regular", "hot-streak", "week-warrior", "day-one"];
  assert(known.every((id) => res.newBadges.includes(id)), `the career's badges all pay: ${show(res.newBadges)}`);
  assert(same(res.newBadges, await earnedBadges(vet.id)), "exactly the badges the player has, in catalog order");
  const reward = seasonReward(res.run, {});
  assert(res.coins.earned === reward.amount + total(badgeLines(res.newBadges)) && res.coins.earned >= reward.amount + total(badgeLines(known)), `a career's worth of badges: ${show(res.coins)}`);
  assert(total(badgeLines(known)) === 3100, "100 + 100 + 300 + 100 + 300 + 1,000 + 300 + 100 + 300 + 500");
  const again = await season("OLDTIMER-2");
  assert(!again.newBadges.some((id) => known.includes(id)), `none of them pays twice: ${show(again.newBadges)}`);
});

await runTest("a Daily pays 40 for finishing plus 5 a streak day up to 50, under its date and format", async () => {
  // nextStreak works in calendar days, the way the app does.
  const y = new Date(`${TODAY}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const streaker = await signUp("streaker", { daily_streak: 11, daily_last: yesterday, daily_best_streak: 11 });

  const res = await daily("fantasy");
  assert(res.ok && res.coins, `today's Daily: ${show(res)}`);
  const reward = seasonReward(res.run, { date: TODAY, streak: 12 });
  assert(reward.kind === "daily" && reward.ref === `${TODAY}:fantasy` && reward.dailyCap === null, `the reward: ${show(reward)}`);
  assert(same(res.coins.lines.slice(0, reward.lines.length), reward.lines) && res.coins.capped === false, `the lines: ${show(res.coins.lines)}`);
  assert(same(res.coins.lines[0], { key: "season", label: "Finished the Daily", coins: 40 }), "40 for finishing the Daily");
  assert(same(res.coins.lines.find((l) => l.key === "streak"), { key: "streak", label: "12-day streak", coins: 50 }), "a 12-day streak pays the most, 50");
  assert(ledgerOf(streaker.id).some((l) => same(l, { amount: reward.amount, kind: "daily", ref: `${TODAY}:fantasy` })), "paid under the date and format");

  // The Championship Daily is its own draft the same day, with its own ref.
  const std = await daily("standard");
  const stdReward = seasonReward(std.run, { date: TODAY, streak: 12 });
  assert(std.ok && std.coins?.capped === false && same(std.coins.lines.slice(0, stdReward.lines.length), stdReward.lines), `the Championship Daily pays too: ${show(std)}`);
  assert(ledgerOf(streaker.id).some((l) => same(l, { amount: stdReward.amount, kind: "daily", ref: `${TODAY}:standard` })), "under its own ref");
});

// ---------- A draft counts once ----------

await runTest("the same challenge code again, in any variant or format, answers duplicate and writes nothing", async () => {
  const player = await signUp("twicer");
  const first = await season("TWICE-CODE");
  assert(first.ok, `the first time counts: ${show(first)}`);
  const before = snapshot(player.id);
  for (const extra of [{}, { gm: true }, { genius: true }, { format: "standard" }]) {
    const again = await season("TWICE-CODE", extra);
    assert(same(again, { ok: false, reason: "duplicate" }), `again ${show(extra)}: ${show(again)}`);
    assert(snapshot(player.id) === before, `again ${show(extra)} wrote nothing`);
  }
  const http = await answer({ mode: { kind: "free", code: "TWICE-CODE" }, ...legalTrace("TWICE-CODE"), gm: false });
  assert(same(http, { status: 409, body: { error: "this draft is already recorded", reason: "duplicate" } }), `the function's answer: ${show(http)}`);
  assert(snapshot(player.id) === before, "still nothing written");
  // It's one season per code per account: someone else can still play it.
  const other = await signUp("othertwicer");
  const theirs = await season("TWICE-CODE");
  assert(theirs.ok && theirs.coins?.lines[0]?.key === "season" && auth._profiles.get(other.id).runs === 1, `another player's first time counts: ${show(theirs)}`);
});

await runTest("the same Daily again answers duplicate and writes nothing", async () => {
  const player = await signUp("dailytwice");
  assert((await daily("fantasy")).ok, "the first Daily counts");
  const before = snapshot(player.id);
  const again = await daily("fantasy");
  assert(same(again, { ok: false, reason: "duplicate" }), `the same Daily again: ${show(again)}`);
  assert(snapshot(player.id) === before, "wrote nothing");
  const http = await answer({ mode: { kind: "daily", date: TODAY }, ...legalTrace(GL.dailySeed(TODAY, "fantasy")), gm: false });
  assert(same(http, { status: 409, body: { error: "today's daily is already recorded", reason: "duplicate" } }), `the function's answer: ${show(http)}`);
  assert(snapshot(player.id) === before, "still nothing written");
});

await runTest("a challenge code over 32 characters is refused like a missing one, before anything is written", async () => {
  const player = await signUp("longcode");
  const before = snapshot(player.id);
  const tooLong = "L".repeat(33);
  const res = await season(tooLong);
  assert(!res.ok && res.error === "missing challenge code", `33 characters: ${show(res)}`);
  assert(snapshot(player.id) === before, "nothing written");
  const fits = await season("L".repeat(32));
  assert(fits.ok && rowsOf(auth._finishedCodes, player.id).some((r) => r.code === "L".repeat(32)), `32 characters is fine: ${show(fits).slice(0, 200)}`);
});

// ---------- The daily cap ----------

await runTest("Unlimited, Genius and GM pay for 20 seasons a UTC day; the 21st counts but pays nothing, and a Daily still pays", async () => {
  const grinder = await signUp("grinder");
  for (let i = 1; i <= COIN_RULES.paidSeasonsPerDay; i++) {
    const variant = i % 3 === 1 ? { gm: true } : i % 3 === 2 ? { genius: true } : {};
    const res = await season(`GRIND-${i}`, variant);
    assert(res.ok && res.coins?.capped === false && res.coins.lines[0]?.key === "season", `season ${i} ${show(variant)} pays: ${show(res.coins)}`);
  }
  const capped = await season("GRIND-21");
  assert(capped.ok === true, `the 21st still counts: ${show(capped)}`);
  assert(capped.coins?.capped === true, `and is capped: ${show(capped.coins)}`);
  assert(capped.coins.lines.every((l) => l.key.startsWith("badge:")) && capped.coins.earned === total(badgeLines(capped.newBadges)), `no season lines, only any new badge's: ${show(capped.coins)}`);
  // (Only the profile counts them all: seasons sent within one millisecond share a runs-log key, which only a test can do.)
  assert(auth._profiles.get(grinder.id).runs === 21, `all 21 are on the record: ${auth._profiles.get(grinder.id).runs}`);
  assert(!ledgerOf(grinder.id).some((l) => l.ref === "GRIND-21") && ledgerOf(grinder.id).filter((l) => l.kind === "season").length === 20, "20 paid seasons in the ledger");
  const genius = await season("GRIND-22", { genius: true });
  assert(genius.coins?.capped === true, "a Genius season is capped too");

  const today = await daily("fantasy");
  assert(today.ok && today.coins?.capped === false && same(today.coins.lines[0], { key: "season", label: "Finished the Daily", coins: 40 }), `the Daily still pays: ${show(today.coins)}`);
});

// ---------- Paying nothing ----------

await runTest("a DNF pays nothing and costs nothing", async () => {
  const quitter = await signUp("quitter");
  assert((await season("QUIT-1")).ok, "a season first");
  const coinsBefore = JSON.stringify({ ledger: ledgerOf(quitter.id), wallet: auth._wallets.get(quitter.id), awards: [...awardedOf(quitter.id)] });
  for (const [picks, ladder] of [[3, "unlimited"], [0, "gm"], [5, "daily"]]) assert((await submitDnf(picks, ladder)) === true, `a ${ladder} DNF is recorded`);
  assert(auth._profiles.get(quitter.id).dnf === 3, "three DNFs on the record");
  assert(JSON.stringify({ ledger: ledgerOf(quitter.id), wallet: auth._wallets.get(quitter.id), awards: [...awardedOf(quitter.id)] }) === coinsBefore, "and not a coin moved");
  const http = await answer({ dnf: true, picks: 2, mode: "unlimited" });
  assert(same(http, { status: 200, body: { ok: true } }), `a DNF's answer is unchanged: ${show(http)}`);
});

await runTest("a reward that fails still counts the season, answering coins: null", async () => {
  const unlucky = await signUp("unlucky");
  const server = auth._wallet.server;
  const realCredit = server.credit_coins, realAward = server.award_badges;

  server.credit_coins = () => {
    throw new Error("connection reset");
  };
  let res;
  try {
    res = await season("UNLUCKY-1");
  } finally {
    server.credit_coins = realCredit;
  }
  assert(res.ok === true && res.coins === null && same(res.newBadges, []), `the season counts without coins: ${show({ ...res, run: undefined })}`);
  assert(auth._profiles.get(unlucky.id).runs === 1 && rowsOf(auth._runs, unlucky.id).length === 1, "it's on the record and in the runs log");
  assert(same(ledgerOf(unlucky.id), [{ amount: 250, kind: "welcome", ref: "welcome" }]) && awardedOf(unlucky.id).size === 0, "no coins and no badges were recorded");
  assert(same(await season("UNLUCKY-1"), { ok: false, reason: "duplicate" }), "it counted, so the same draft is now a duplicate");

  // A database refusal is a failure the same way.
  server.credit_coins = () => {
    throw new Error("bad_ref");
  };
  try {
    res = await season("UNLUCKY-2");
  } finally {
    server.credit_coins = realCredit;
  }
  assert(res.ok === true && res.coins === null, `a refused credit: ${show(res.coins)}`);

  // Failing after the season's credit keeps the credit; the badge that didn't pay pays with the next season.
  server.award_badges = () => {
    throw new Error("award_badges timed out");
  };
  try {
    res = await season("UNLUCKY-3");
  } finally {
    server.award_badges = realAward;
  }
  assert(res.ok === true && res.coins === null && same(res.newBadges, []), `a failed award: ${show(res.coins)}`);
  assert(ledgerOf(unlucky.id).some((l) => l.kind === "season" && l.ref === "UNLUCKY-3") && awardedOf(unlucky.id).size === 0, "the season's credit stays paid, and no badge is recorded");
  res = await season("UNLUCKY-4");
  assert(res.ok && res.coins && res.newBadges.includes("first-down"), `the next season pays the badge: ${show(res.newBadges)}`);
});

await runTest("a failed save gives the challenge code back so a retry counts, and is never mistaken for a duplicate", async () => {
  const flaky = await signUp("flaky");
  const before = snapshot(flaky.id);
  auth._failWrites.add("profiles");
  let res, http;
  try {
    res = await season("FLAKY-1");
    http = await answer({ mode: { kind: "free", code: "FLAKY-1" }, ...legalTrace("FLAKY-1"), gm: false });
  } finally {
    auth._failWrites.delete("profiles");
  }
  assert(same(res, { ok: false }), `a failed profile save: ${show(res)}`);
  assert(same(http, { status: 500, body: { error: "failed to save" } }), `the function's answer: ${show(http)}`);
  assert(snapshot(flaky.id) === before, "the code was given back and nothing else written");
  const retry = await season("FLAKY-1");
  assert(retry.ok && retry.coins?.lines[0]?.key === "season", `the retry counts and pays: ${show(retry.coins)}`);

  // A Daily the same way: its daily_runs row is given back, so the retry isn't answered "already recorded".
  const beforeDaily = snapshot(flaky.id);
  auth._failWrites.add("profiles");
  try {
    res = await daily("standard");
  } finally {
    auth._failWrites.delete("profiles");
  }
  assert(same(res, { ok: false }), `a failed Daily profile save: ${show(res)}`);
  assert(snapshot(flaky.id) === beforeDaily, "the Daily's row was given back and nothing else written");
  const dailyRetry = await daily("standard");
  assert(dailyRetry.ok && dailyRetry.coins?.lines[0]?.key === "season" && dailyRetry.coins.lines[0].coins === COIN_RULES.dailySeason,
    `the Daily's retry counts and pays: ${show(dailyRetry)}`);

  for (const [table, submit] of [["finished_codes", () => season("FLAKY-2")], ["daily_runs", () => daily("fantasy")]]) {
    const beforeFailure = snapshot(flaky.id);
    auth._failWrites.add(table);
    try {
      res = await submit();
    } finally {
      auth._failWrites.delete(table);
    }
    assert(same(res, { ok: false }), `a failed ${table} insert is a failed save, not a duplicate: ${show(res)}`);
    assert(snapshot(flaky.id) === beforeFailure, `and writes nothing (${table})`);
    assert((await submit()).ok, `a retry after the ${table} failure counts`);
  }
});

await runTest("a Daily ignores GM and Genius flags: it's recorded, scored and paid as a plain Daily", async () => {
  const flagged = await signUp("dailyflags");
  const trace = legalTrace(GL.dailySeed(TODAY, "fantasy"));
  const res = await submitRun({ mode: { kind: "daily", date: TODAY }, ...trace, gm: true, genius: true, format: "fantasy" });
  assert(res.ok && res.run.gm === false && res.run.genius === false, `the run isn't GM or Genius: ${show(res.run && { gm: res.run.gm, genius: res.run.genius })}`);
  const plainPar = GL.botPar(trace.history.map((h) => h.key), { format: "fantasy", gm: false });
  assert(res.run.par === plainPar && res.run.capUsed === undefined, `scored against the plain par, with no cap: ${show({ par: res.run.par, plainPar, capUsed: res.run.capUsed })}`);
  const logged = rowsOf(auth._runs, flagged.id);
  assert(logged.length === 1 && logged[0].gm === false && logged[0].genius === false && logged[0].ladder === "daily", `logged as a plain Daily: ${show(logged)}`);
});

console.log("test-submit-coins.mjs done");
