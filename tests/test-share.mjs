// The Wordle-style share card (1.10.0) and the challenge links it carries. The card is spoiler-free:
// the record, a square per game, the playoffs and a link - never the players. Unlimited shares link to
// the exact boards (/c/CODE?beat=W-L), and opening one offers those boards on the Modes screen.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto,
  makeMockAuth, clickMode, loadAppModule,
} from "./helpers.mjs";
import { OPPS, TEAMS } from "../game-logic.mjs";

setupDom();
window.storage = makeStorage();
window.__ps_supabase__ = makeMockAuth();
const app = await loadAppModule();

// Real opponents, so upsets are worked out from real ratings: a weak team the score beats comfortably,
// and a strong one it only beats as an underdog (a 35% chance or less).
const byReg = OPPS.filter((o) => o.reg != null).sort((a, b) => a.reg - b.reg);
const weak = byReg[0], strong = byReg[byReg.length - 1];
// The weakest playoff team, so a playoff win here is an ordinary one rather than an upset.
const poOpp = OPPS.filter((o) => o.po != null).sort((a, b) => a.po - b.po)[0];
const score = Math.max(weak.reg, poOpp.po) + 10;
assert(strong.reg - score >= 6, "test setup: the strong opponent must make a win an upset");
const game = (o, win, extra) => ({ opp: `${o.season} ${TEAMS[o.team][0]}`, oppTeam: o.team, win, ...extra });
const squaresIn = (line) => Array.from(line).filter((ch) => ["🟩", "🟥", "🟨"].includes(ch));

// 17 regular-season games: an upset win in week 8, losses in weeks 11 and 16.
const regular = Array.from({ length: 17 }, (_, i) => (i === 7 ? game(strong, true) : game(weak, ![10, 15].includes(i))));
const season = (playoffs, extra = {}) => {
  const games = [...regular, ...playoffs];
  const w = games.filter((g) => g.win).length;
  return { games, w, l: games.length - w, score, format: "fantasy", outcome: "Missed the playoffs", champ: false, ...extra };
};
const daily = { kind: "daily", date: "2026-09-14", format: "fantasy" };

await runTest("the card: title and record, a square per game in rows of six, playoffs, score and link", async () => {
  const result = season([game(poOpp, true, { playoff: true }), game(poOpp, false, { playoff: true })], { outcome: "Lost to the 2007 Patriots in the conference round" });
  const lines = app.shareText(result, daily, { rank: 3, total: 1234 }).split("\n");
  assert(lines[0] === `Gridspin Daily 1 · ${result.w}–${result.l}`, "a playoff exit gets no emoji, got: " + lines[0]);
  assert(lines.slice(1, 4).map((l) => squaresIn(l).length).join(",") === "6,6,5", "expected 17 squares in rows of 6, 6 and 5, got: " + lines.slice(1, 4).join(" | "));
  const reg = lines.slice(1, 4).flatMap(squaresIn);
  assert(reg[7] === "🟨" && reg.filter((s) => s === "🟨").length === 1, "the underdog win (and only it) is yellow, got: " + reg.join(""));
  assert(reg[10] === "🟥" && reg[15] === "🟥" && reg.filter((s) => s === "🟥").length === 2, "losses are red, got: " + reg.join(""));
  assert(lines[4] === "Playoffs 🟩🟥", "expected the playoff squares, got: " + lines[4]);
  assert(lines[5] === `Team score ${score.toFixed(1)} · #3 of 1,234 seasons`, "expected score and rank, got: " + lines[5]);
  assert(lines[6] === "https://gridspin.test" && lines.length === 7, "a daily ends with the site's address, got: " + lines.slice(6).join(" | "));
});

await runTest("daily numbers count up from launch day, and the formats and outcomes are labeled", async () => {
  assert(app.dailyNumber("2026-09-14") === 1 && app.dailyNumber("2026-09-20") === 7 && app.dailyNumber("2027-09-14") === 366, "Daily 1 is launch day");
  // A season carries its own scoring format (finish() stamps it), which is what the card reads.
  const missed = app.shareText(season([], { format: "standard" }), { ...daily, date: "2026-09-15", format: "standard" }, null).split("\n");
  assert(missed[0].startsWith("Gridspin Daily 2 · Championship 🧊 "), "a Championship daily is named, and a missed postseason gets 🧊, got: " + missed[0]);
  assert(missed.includes("Missed the playoffs") && !missed.some((l) => l.startsWith("Playoffs")), "no playoff squares when there were no playoffs, got: " + missed.join(" | "));
  assert(missed.includes(`Team score ${score.toFixed(1)}`), "no rank yet means no rank on the card, got: " + missed.join(" | "));

  const perfectGames = [...regular.map((g) => ({ ...g, win: true })), ...[1, 2, 3].map(() => game(poOpp, true, { playoff: true }))];
  const perfect = app.shareText({ games: perfectGames, w: 20, l: 0, score, format: "fantasy", champ: true, outcome: "Perfect season. 20–0." }, daily, null);
  assert(perfect.startsWith("Gridspin Daily 1 🏆 20–0 PERFECT"), "a perfect season says so, got: " + perfect.split("\n")[0]);
});

await runTest("Unlimited shares link to the exact boards, with the variant, scoring and record to beat", async () => {
  const result = season([game(poOpp, true, { playoff: true }), game(poOpp, false, { playoff: true })],
    { format: "standard", outcome: "Lost to the 2007 Patriots in the conference round" });
  const gm = { kind: "free", code: "K3F9QZ", gm: true, format: "standard" };
  const lines = app.shareText(result, gm, null).split("\n");
  assert(lines[0].startsWith("Gridspin GM mode · Championship"), "expected the variant and scoring in the title, got: " + lines[0]);
  const link = `https://gridspin.test/c/K3F9QZ?beat=${result.w}-${result.l}&mode=gm&scoring=championship`;
  assert(lines[lines.length - 1] === `Beat my boards: ${link}`, "expected the challenge link last, got: " + lines[lines.length - 1]);

  const url = new URL(link);
  const back = app.parseChallengeLink(url.pathname, url.search);
  assert(back && back.code === "K3F9QZ" && back.gm && !back.genius && back.format === "standard" && back.beat.w === result.w && back.beat.l === result.l,
    "the link reads back to the same boards, variant, scoring and record, got: " + JSON.stringify(back));
  const plain = app.parseChallengeLink("/c/abcd", "");
  assert(plain && plain.code === "ABCD" && !plain.gm && !plain.genius && plain.format === "fantasy" && plain.beat === null, "a bare link is plain Unlimited, got: " + JSON.stringify(plain));
  assert(app.parseChallengeLink("/c/ab", "") === null && app.parseChallengeLink("/x/ABCD", "") === null && app.parseChallengeLink("/c/ABCD/extra", "") === null, "only /c/CODE is a challenge link");
  assert(app.parseChallengeLink("/c/ABCD", "?beat=30-1").beat === null, "an impossible record isn't shown");
});

await runTest("opening a challenge link offers the boards, and drafting them keeps the variant and scoring", async () => {
  setupDom("http://localhost/c/K3F9QZ?beat=7-10&mode=gm&scoring=championship");
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush(3);
  const howto = findButtonByText(container, "Got it, let's draft");
  if (howto) { await click(howto); await flush(); }

  const card = container.querySelector(".challenge");
  assert(card, "expected the challenge card on the Modes screen, got: " + text(container).slice(0, 300));
  const t = card.textContent;
  assert(t.includes("They went 7–10") && t.includes("K3F9QZ") && t.includes("GM mode") && t.includes("Championship"), "expected the record to beat, code, variant and scoring, got: " + t);
  assert(window.location.pathname === "/", "the address goes back to / so a reload doesn't keep offering it, got: " + window.location.pathname);

  await click(findButtonByText(card, "Draft these boards"));
  await flush(4);
  const seedline = container.querySelector(".seedline");
  assert(seedline?.querySelector("code")?.textContent === "K3F9QZ", "expected the friend's boards, got: " + seedline?.textContent);
  assert(seedline.textContent.includes("GM mode") && seedline.textContent.includes("Championship"), "expected GM mode under Championship scoring, got: " + seedline.textContent);
  assert(container.querySelectorAll(".card .pill").length > 0, "expected GM mode's salary pills on the board");
  assert(!container.querySelector(".challenge"), "the card is gone once taken");
});

await runTest("Not now puts the challenge away", async () => {
  setupDom("http://localhost/c/ABCD12");
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush(3);
  const howto = findButtonByText(container, "Got it, let's draft");
  if (howto) { await click(howto); await flush(); }
  const card = container.querySelector(".challenge");
  assert(card && card.textContent.includes("Can you beat") && card.textContent.includes("Fantasy"), "a link with no record still offers the boards, got: " + card?.textContent);
  await click(findButtonByText(card, "Not now"));
  await flush();
  assert(!container.querySelector(".challenge"), "expected the card to go away");
});

await runTest("a signed-in player with an Unlimited draft going is warned, and taking the challenge is one DNF", async () => {
  setupDom();
  const storage = makeStorage();
  window.storage = storage;
  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  let { container } = await mount();
  await flush();
  await click(findButtonByText(container, "Account"));
  await flush();
  await click(findButtonByText(container.querySelector(".panel"), "Create account"));
  await flush();
  const [email, u, p, p2] = [...container.querySelector(".panel").querySelectorAll("input")];
  await type(email, "challenger@example.com");
  await type(u, "challenger");
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...container.querySelector(".panel").querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();
  const userId = [...auth._profiles.keys()][0];
  await click(findButtonByText(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush(3);
  assert(container.querySelector(".seedline code"), "expected an Unlimited draft dealt");

  // Then a friend's link arrives: same device, same account.
  setupDom("http://localhost/c/ZZ99ZZ?beat=12-6");
  window.storage = storage;
  window.__ps_supabase__ = auth;
  ({ container } = await mount());
  await flush(6);
  const card = container.querySelector(".challenge");
  assert(card?.querySelector(".warn")?.textContent.includes("DNF"), "expected the DNF warning, got: " + card?.textContent);
  await click(findButtonByText(card, "Draft these boards"));
  await flush(6);
  assert(container.querySelector(".seedline code")?.textContent === "ZZ99ZZ", "expected the friend's boards");
  assert(auth._profiles.get(userId).dnf === 1, `expected one DNF for the abandoned draft, got ${auth._profiles.get(userId).dnf}`);
});

console.log("test-share.mjs done");
