// Redesign stage two (1.7.0): the record-first result screen, its upset and streak moments, the
// per-season rank from the runs log, and the black Leaderboard. The display helpers are exercised
// directly (they're pure), the counts through storage.js against the mock runs log, and the
// screens by clicking through the real UI.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto,
  makeMockAuth, clickMode, loadAppModule,
} from "./helpers.mjs";
import { OPPS, TEAMS, winProb, runLogRow } from "../game-logic.mjs";
import { fetchSeasonRank, fetchUpsetRank } from "../storage.js";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
const app = await loadAppModule();
const html = (el) => renderToStaticMarkup(el);

// A real regular-season opponent and a playoff one, so win chances use real ratings.
const regOpp = OPPS.find((o) => o.reg != null);
const poOpp = OPPS.find((o) => o.po != null);
const gameVs = (o, extra) => ({ opp: `${o.season} ${TEAMS[o.team][0]}`, oppTeam: o.team, ...extra });

await runTest("an upset is a win with a 35% chance or less, worked out from the opponent's rating", async () => {
  // winProb is 0.5 + gap / 40, so a 6-point underdog sits exactly on 35%.
  const g = gameVs(regOpp, { win: true, playoff: false });
  assert(Math.abs(app.gameWinChance(regOpp.reg - 6, g) - 0.35) < 1e-9, "a 6-point underdog should have a 35% chance");
  assert(app.isUpsetWin(regOpp.reg - 6, g), "a win at exactly 35% counts as an upset");
  assert(!app.isUpsetWin(regOpp.reg - 5, g), "a win at 37.5% is not an upset");
  assert(!app.isUpsetWin(regOpp.reg - 20, { ...g, win: false }), "a loss is never an upset");
  // Playoff games use the playoff rating, like the simulation does.
  const pg = gameVs(poOpp, { win: true, playoff: true });
  assert(Math.abs(app.gameWinChance(poOpp.po, pg) - 0.5) < 1e-9, "a playoff game should use the opponent's playoff rating");
  assert(app.gameWinChance(80, { opp: "1900 Nobody", oppTeam: "XXX", win: true }) === null, "an unknown opponent has no win chance");
});

await runTest("outcome emoji: a title, a disaster, a missed postseason, and nothing for a playoff exit", async () => {
  assert(app.outcomeEmoji({ champ: true, w: 17, outcome: "Won the championship after a 13–4 regular season" }) === "🏆", "a title gets 🏆");
  assert(app.outcomeEmoji({ w: 3, outcome: "Missed the playoffs" }) === "💀", "four wins or fewer gets 💀");
  assert(app.outcomeEmoji({ w: 8, outcome: "Missed the playoffs" }) === "🧊", "any other missed postseason gets 🧊");
  assert(app.outcomeEmoji({ w: 12, outcome: "Lost to the 2007 Patriots in the divisional round" }) === null, "a playoff exit gets no emoji");
});

await runTest("the stat strip shows score with par, signed points, and this season's rank", async () => {
  const base = { score: 78.4, par: 80.1, points: 64, games: [] };
  let out = html(React.createElement(app.SeasonStrip, { result: { ...base, rank: { rank: 212, total: 1874 } }, ladderName: "Daily" }));
  assert(out.includes("78.4") && out.includes("par 80.1"), "expected team score and par, got: " + out);
  assert(out.includes("📈 +64") && out.includes("Daily ladder"), "expected positive points with 📈 and the ladder, got: " + out);
  assert(out.includes("#212") && out.includes("of 1,874 · Top 11%"), "expected the rank with a percentile, got: " + out);

  out = html(React.createElement(app.SeasonStrip, { result: { ...base, points: -156, rank: { rank: 3, total: 9 } }, ladderName: "Unlimited" }));
  assert(out.includes("-156") && !out.includes("📈"), "negative points get no 📈, got: " + out);
  assert(out.includes("of 9") && !out.includes("Top"), "a small sample shows no percentile, got: " + out);

  out = html(React.createElement(app.SeasonStrip, { result: { ...base }, ladderName: "Unlimited" }));
  assert(out.includes("Ranking"), "an unanswered rank shows as loading, got: " + out);
  out = html(React.createElement(app.SeasonStrip, { result: { ...base, rank: null }, ladderName: "Unlimited" }));
  assert(!out.includes("This season"), "a rank that can't be worked out is left out, got: " + out);
});

await runTest("moments appear only when they happened", async () => {
  const quiet = { score: 90, games: [gameVs(regOpp, { win: true, playoff: false })] };
  assert(html(React.createElement(app.SeasonMoments, { result: quiet, formatLabel: "Fantasy" })) === "", "a season with no moments renders nothing");

  // A playoff win at a long shot, plus a regular-season one that must not be the callout.
  const underdog = poOpp.po - 12; // 20% in the playoff game
  const result = {
    score: underdog, champ: true, upsetRank: 3, newBestScore: true, streak: { days: 7, newBest: true },
    games: [gameVs(regOpp, { win: true, playoff: false, label: "Wk 3" }), gameVs(poOpp, { win: true, playoff: true, label: "Conference" })],
  };
  const out = html(React.createElement(app.SeasonMoments, { result, formatLabel: "Fantasy" }));
  assert(out.includes("🚨 #3 biggest Fantasy upset"), "expected the upset board rank, got: " + out);
  assert(/class="mo streak milestone"[^>]*>🔥 7-day streak · new best/.test(out), "expected a milestone streak marked new best, got: " + out);
  assert(out.includes("📈 New personal best score"), "expected the personal best moment, got: " + out);
  assert(out.includes(`Upset in the Conference round.`) && out.includes(`You beat the ${poOpp.season} ${TEAMS[poOpp.team][0]} with a 20% chance to win.`),
    "expected the playoff upset callout with its chance, got: " + out);

  const ever = html(React.createElement(app.SeasonMoments, { result: { ...result, upsetRank: 1, streak: { days: 5, newBest: false } }, formatLabel: "Championship" }));
  assert(ever.includes("🚨 Biggest Championship upset ever"), "a #1 upset says so, got: " + ever);
  assert(/class="mo streak"[^>]*>🔥 5-day streak</.test(ever), "a non-milestone streak is a regular chip without new best, got: " + ever);
  const off = html(React.createElement(app.SeasonMoments, { result: { ...result, upsetRank: 11, streak: { days: 1, newBest: true } }, formatLabel: "Fantasy" }));
  assert(!off.includes("biggest") && !off.includes("streak"), "an upset outside the top 10 and a 1-day streak show no chip, got: " + off);
});

await runTest("season and upset ranks count the right logged runs", async () => {
  let clock = Date.UTC(2026, 8, 1);
  const log = (entry) => {
    const row = runLogRow(`seed-${clock}`, "seed", { roster: [], ...entry, date: (clock += 1000) });
    auth._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, row);
  };
  for (const score of [120, 110, 100, 60, 40]) log({ w: 10, l: 7, score, format: "fantasy" });
  log({ w: 12, l: 5, score: 130, format: "standard" }); // other format: never counted
  log({ dnf: true, picks: 3, mode: "unlimited" }); // a DNF: never counted
  log({ w: 16, l: 4, score: 70, champ: true, format: "fantasy" });
  log({ w: 15, l: 5, score: 82, champ: true, format: "fantasy" });

  const place = await fetchSeasonRank(95, "fantasy");
  assert(place && place.above === 3 && place.total === 7, "expected 3 fantasy seasons above 95 out of 7, got " + JSON.stringify(place));
  assert(await fetchUpsetRank(82, "fantasy") === 2, "a title at 82 should sit 2nd on the upsets board, counting itself");
  assert(await fetchUpsetRank(65, "fantasy") === 0, "no title scored at or below 65");
  auth._runs.clear();
});

// ---------- Through the real UI ----------
const { container } = await mount();
await flush();
const panel = () => container.querySelector(".panel");
async function signUp(email, username) {
  await click(findButtonByText(container, "Account"));
  await flush();
  await click(findButtonByText(panel(), "Create account"));
  await flush();
  const [e, u, p, p2] = [...panel().querySelectorAll("input")];
  await type(e, email);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();
}
async function draftFirstEligible() {
  let card = null;
  for (let i = 0; i < 10 && !card; i++) {
    await flush(1);
    card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
  }
  if (!card) throw new Error("no draftable player found");
  await click(card.querySelector("button.hit"));
  await flush();
  await click(card.querySelector(".drafts button.btn.solid"));
  await flush();
}
const stripCell = (label) => [...container.querySelectorAll(".result-hero .strip > div")].find((c) => c.querySelector(".l")?.textContent === label);

await signUp("moments@example.com", "moments");
const userId = [...auth._profiles.keys()].find((id) => auth._profiles.get(id).username === "moments");

await runTest("a finished season shows its real rank among every logged season", async () => {
  // Other players' logged Fantasy seasons, spread wide so the new one lands somewhere in the middle.
  let clock = Date.UTC(2026, 8, 2);
  const scores = [140, 125, 115, 105, 30, 20, 10];
  for (const score of scores) {
    const row = runLogRow("someone-else", "someone", { w: 9, l: 8, score, format: "fantasy", roster: [], date: (clock += 1000) });
    auth._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, row);
  }
  await click(findButtonByText(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush();
  for (let round = 0; round < 6; round++) await draftFirstEligible();
  await flush(8);

  const score = Number(stripCell("Team score")?.querySelector(".n").textContent);
  const expectedRank = scores.filter((s) => s > score).length + 1;
  const rankCell = stripCell("This season");
  assert(rankCell, "expected a This season cell once the rank arrives, got: " + container.querySelector(".result-hero")?.textContent);
  assert(rankCell.querySelector(".n").textContent === `#${expectedRank}`, `expected #${expectedRank} for a ${score} season, got ${rankCell.textContent}`);
  assert(rankCell.textContent.includes(`of ${scores.length + 1}`), "the total should include this season, got: " + rankCell.textContent);
  assert(container.querySelector(".result-hero .rec")?.textContent.match(/^\d+–\d+$/), "the record text stays exactly W–L");
  assert(container.querySelector(".result-hero .wl")?.textContent === "WinsLosses", "expected Wins and Losses labels under the record");
  assert(!text(container).includes("season played sitewide"), "the old best-ever rank line should be gone");
});

await runTest("the Leaderboard is black, crowns #1 and marks your own row", async () => {
  // Make this account #1 on Fantasy, with one other account below it.
  Object.assign(auth._profiles.get(userId), { best_score: 150.5, best_run: { w: 20, l: 0, roster: [] }, best_record: { w: 20, l: 0 } });
  auth._profiles.set("rival-id", { id: "rival-id", username: "rival", runs: 3, dnf: 0, wins: 30, losses: 21, champs: 0, perfect: 0, playoffs: 1, best_score: 99.1, best_run: { w: 12, l: 5, roster: [] }, recent: [] });
  await click(findButtonByText(container, "Leaderboard"));
  await flush(8);

  assert(container.firstElementChild.classList.contains("night"), "expected the Leaderboard to use the night scope, got class: " + container.firstElementChild.className);
  assert(text(container).includes("👑 Best Fantasy team ever"), "expected the best-ever card as the header");
  const rows = [...container.querySelectorAll("table.lb tbody tr")];
  const mine = rows.find((r) => r.textContent.includes("moments"));
  assert(mine?.classList.contains("me") && mine.textContent.includes("You"), "your own row should be marked, got: " + mine?.outerHTML);
  assert(mine.classList.contains("first") && mine.querySelector(".rk .crown"), "the #1 row should carry the crown");
  const rival = rows.find((r) => r.textContent.includes("rival"));
  assert(rival && !rival.classList.contains("me") && !rival.classList.contains("first"), "another player's row is neither yours nor #1");
  assert(!text(container).includes("Draft a friend's board") && !container.querySelector('input[aria-label="Challenge code"]'),
    "draft a friend's board belongs on Modes, not the Leaderboard");

  await click(findButtonByText(container, "Modes"));
  await flush();
  assert(!container.firstElementChild.classList.contains("night"), "leaving the Leaderboard drops the night scope");
  assert(container.querySelector('input[aria-label="Challenge code"]'), "the challenge code box is still on Modes");
});

await runTest("a forced title shows the Champions stamp and 🏆, with no rank to show", async () => {
  await click(findButtonByText(container, "Profile"));
  await flush();
  await click(findButtonByText(container, "Log out"));
  await flush();
  await signUp("admin-moments@example.com", "admin");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush();
  await click(findButtonByText(container, "Force championship win"));
  await flush(6);
  await new Promise((r) => setTimeout(r, 100));
  await flush(2);
  for (let i = 0; i < 10 && findButtonByText(container, "Skip to the end"); i++) {
    await click(findButtonByText(container, "Skip to the end"));
    await flush(2);
  }

  assert(container.querySelector(".result-hero .cel .stamp")?.textContent === "🏆 Champions", "expected the Champions stamp");
  assert(container.querySelector(".result-hero .oe")?.textContent === "🏆", "expected 🏆 beside the outcome");
  assert(container.querySelector(".result-hero .outcome")?.textContent.startsWith("Won the championship"), "the outcome text itself carries no emoji");
  assert(!stripCell("This season"), "a forced ending is never saved, so there's no rank cell");

  // Every tile's upset flag matches the win chance for that game at this team score.
  const score = Number(stripCell("Team score")?.querySelector(".n").textContent);
  let checked = 0;
  for (const tile of container.querySelectorAll(".log .g")) {
    const [, oppText] = [...tile.querySelectorAll(".o")].map((o) => o.textContent);
    const [, season, name] = oppText.match(/^(?:vs|at) (\d{4}) (.+)$/) || [];
    const matches = OPPS.filter((o) => String(o.season) === season && TEAMS[o.team][0] === name);
    if (matches.length !== 1) continue;
    const o = matches[0];
    const playoff = tile.classList.contains("po");
    const rating = playoff ? o.po : o.reg;
    const shouldFlag = tile.classList.contains("win") && winProb(score, rating) <= 0.35;
    assert(tile.classList.contains("up") === shouldFlag, `tile vs ${oppText} (${playoff ? "playoff" : "regular"}): expected up=${shouldFlag}`);
    checked++;
  }
  assert(checked >= 15, "expected to check most of the season's tiles, checked " + checked);
});

console.log("test-result-moments.mjs done");
