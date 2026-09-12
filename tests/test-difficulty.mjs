// Plays N unlimited drafts end to end with a simple bot (first eligible player each round)
// and reports average wins / perfect-season rate. This is a floor, not the tuning benchmark:
// CLAUDE.md's ~15 avg wins / 2-4% perfect rate is measured against a "fantasy-savvy" drafter
// that picks the best available player, not merely the first eligible one.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, makeMockAuth } from "./helpers.mjs";

const N = Number(process.argv[2]) || 15;

async function draftOneSeason() {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush();
  await click(findButtonByText(container, "Start a draft"));
  await flush();

  for (let pick = 0; pick < 6; pick++) {
    let card = null;
    for (let i = 0; i < 10 && !card; i++) {
      await flush(1);
      card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
    }
    if (!card) throw new Error(`no draftable player found on pick ${pick + 1}`);
    await click(card.querySelector("button.hit"));
    await flush();
    const draftBtn = card.querySelector(".drafts button.btn.solid");
    if (!draftBtn) throw new Error(`no "Draft to" button after selecting a player on pick ${pick + 1}`);
    await click(draftBtn);
    await flush();
  }

  // The season and any playoffs resolve synchronously in finish(); only the reveal is animated.
  // Fast-forward it: skip playoff rounds when offered, otherwise give the 90ms-per-game regular
  // season ticker time to catch up.
  for (let i = 0; i < 20 && !findButtonByText(container, "Draft a new team"); i++) {
    const skip = findButtonByText(container, "Skip to the result");
    if (skip) { await click(skip); continue; }
    await new Promise((r) => setTimeout(r, 150));
    await flush(1);
  }
  assert(findButtonByText(container, "Draft a new team"), "season never finished after 20 fast-forward attempts");

  const recText = container.querySelector(".result-hero .rec")?.textContent || "";
  const [w, l] = (recText.match(/\d+/g) || []).map(Number);
  const perfect = !!container.querySelector(".cel.perfect");
  return { w, l, perfect };
}

const results = [];
for (let i = 0; i < N; i++) {
  results.push(await draftOneSeason());
  process.stdout.write(".");
}
console.log("");

const avgWins = results.reduce((a, r) => a + r.w, 0) / results.length;
const perfectRate = (results.filter((r) => r.perfect).length / results.length) * 100;

console.log(`Played ${N} drafts with a first-eligible-player bot.`);
console.log(`Average record: ${avgWins.toFixed(1)}-${(20 - avgWins).toFixed(1)}`);
console.log(`Perfect-season rate: ${perfectRate.toFixed(1)}%`);
console.log(`(CLAUDE.md's target of ~15 avg wins / 2-4% perfect is for a "fantasy-savvy" drafter that`);
console.log(` picks the best available player, not this bot's first-eligible heuristic - use this`);
console.log(` run to confirm the harness and grading pipeline still work end to end, not to tune balance.)`);
