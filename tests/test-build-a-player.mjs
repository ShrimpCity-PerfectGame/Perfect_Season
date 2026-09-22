// Build-a-player is standalone: no roster, no 6-slot draft. You choose the position, then roll
// a team + their active player from last season (with a brief animated reveal), take one
// attribute (graded F-A+ off his real stats) from him, repeat until every attribute is filled,
// then roll a random real team-season (any year) and watch an animated sim of whether swapping
// your build into their lineup would have helped them win it all.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Build-a-player").closest("button"));
await flush();

// The team-then-player roll animation is a deliberately slow, decelerating reveal (~4s: a team
// spin, a hold, a player spin, a hold) rather than react-act's synchronous test helpers, so wait
// it out with real timers instead of flush().
async function waitForBuildStage() {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 60));
    await flush(1);
    if (container.querySelector(".panel .frow button")) return;
  }
  throw new Error("attribute-pick buttons never appeared after the roll animation");
}

await runTest("choosing a position rolls a team and player, then lets you build without ever starting a draft", async () => {
  assert(container.querySelector("h1.h, h2.h")?.textContent === "Build-a-player", "expected the position-choice screen first");
  const posBtn = [...container.querySelectorAll(".frow button")].find((b) => ["Quarterbacks", "Running backs", "Wide receivers", "Tight ends"].includes(b.textContent));
  assert(posBtn, "expected a position choice button");
  await click(posBtn);
  await flush();

  await waitForBuildStage();
  const heading = container.querySelector("h1.h, h2.h")?.textContent;
  // \s: the space before the dash is non-breaking, so the heading never wraps with the dash first.
  assert(/^Build-a-player\s- /.test(heading), "expected the build screen heading after the roll animation, got: " + heading);

  for (let i = 0; i < 9; i++) {
    const btn = container.querySelector(".panel .frow button");
    assert(btn, `round ${i}: expected an attribute-pick button, only got: ` + text(container).slice(0, 200));
    await click(btn);
    if (i < 8) await waitForBuildStage(); // the 9th pick goes straight to "done", no reroll/animation
    else await flush();
  }

  assert(container.querySelector("h1.h, h2.h")?.textContent.startsWith("Build complete"), "expected the build-complete summary after 9 attributes, got: " + container.querySelector("h1.h, h2.h")?.textContent);
  assert(!container.querySelector(".roster"), "Build-a-player must never open the normal 6-slot roster/draft");
  assert(!text(container).includes("Pick 1 of 6"), "Build-a-player must never start a normal draft");
  const rows = [...container.querySelectorAll(".panel .rc")];
  assert(rows.length === 9, "expected 9 graded attributes in the summary, got " + rows.length);
  assert(rows.every((r) => r.querySelector(".alt")?.textContent.includes("from ")), "expected each attribute to name the real player it came from");
  assert(auth._builds.size === 0, "a guest's build must not be logged sitewide (no account to attribute it to)");
});

await runTest("giving him his shot shows a scoreboard-style reveal (live record + game log), no roster involved", async () => {
  await click(findButtonByText(container, "Give him his shot"));
  await flush();

  // setupDom() simulates prefers-reduced-motion for every test (see helpers.mjs), so this and
  // the earlier roll animation resolve to their final state immediately rather than ticking in
  // real time - correct, deliberate behavior (respecting reduced-motion), not a shortcut around
  // testing it. The animated pacing itself is a manual/browser concern; here we confirm the
  // scoreboard-style markup (live record, game log) is what actually renders once resolved,
  // replacing the old plain W-L tile grid.
  for (let i = 0; i < 60 && !findButtonByText(container, "Build another"); i++) {
    await new Promise((r) => setTimeout(r, 60));
    await flush(1);
  }
  assert(findButtonByText(container, "Build another"), "expected the reveal to finish and show the final record");
  assert(container.querySelector(".result-hero .led"), "expected a scoreboard-style live record display, not the old plain tile grid");
  const t = text(container);
  assert(/\d+–\d+/.test(t), "expected a W-L record in the result, got: " + t.slice(0, 300));
  assert(container.querySelectorAll(".log .g").length >= 17, "expected a full game log (17 regular season games, plus any playoffs) once finished, got " + container.querySelectorAll(".log .g").length);
  assert(!container.querySelector(".roster"), "the sim result must not involve the normal roster");
});

await runTest("completing a build while logged in logs it sitewide for the Stats screen's created-players tally", async () => {
  await click(findButtonByText(container, "Account"));
  await flush();
  const panel = () => container.querySelector(".panel");
  await click(findButtonByText(panel(), "Create account"));
  await flush();
  const [emailInput, uInput, pInput, p2Input] = [...panel().querySelectorAll("input")];
  await type(emailInput, "bapuser1@example.com");
  await type(uInput, "bapuser1");
  await type(pInput, "Password1");
  await type(p2Input, "Password1");
  await click([...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();

  await click(findButtonByText(container, "Modes"));
  await flush();
  await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Build-a-player").closest("button"));
  await flush();

  const posBtn = [...container.querySelectorAll(".frow button")].find((b) => ["Quarterbacks", "Running backs", "Wide receivers", "Tight ends"].includes(b.textContent));
  await click(posBtn);
  await flush();
  await waitForBuildStage();
  for (let i = 0; i < 9; i++) {
    const btn = container.querySelector(".panel .frow button");
    await click(btn);
    if (i < 8) await waitForBuildStage();
    else await flush();
  }

  assert(auth._builds.size === 1, "expected exactly one logged build after a logged-in completion, got " + auth._builds.size);
  const build = [...auth._builds.values()][0];
  assert(build.username === "bapuser1", "expected the build attributed to the logged-in account, got: " + build.username);
  assert(["QB", "RB", "WR", "TE"].includes(build.pos), "expected a real position, got: " + build.pos);
  assert(typeof build.overall === "number" && build.overall > 0, "expected a numeric overall score, got: " + build.overall);
});

console.log("test-build-a-player.mjs done");
