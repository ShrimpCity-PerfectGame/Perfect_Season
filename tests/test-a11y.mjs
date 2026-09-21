// The accessibility floor, kept by axe-core in the real Chrome: every screen of the app, with no violations.
// It drives tools/ui-harness (the real app on the tests' mock data, seeded and signed in), because that is the
// only place every screen can be opened without a network or an account.
//
// What axe can't see is checked by hand elsewhere and named here so it isn't forgotten: colour is never the only
// thing that carries meaning (a roster chip says which slot it filled, in letters), the theme's text colours meet
// WCAG AA in every scope (tests/test-theme-contrast.mjs), touch targets are 44px on coarse pointers (the 1.8.0
// phone audit), and motion respects prefers-reduced-motion.
//
// The harness mounts some screens on their own (screen=profile, screen=shop), without the app's nav and main
// landmark, so those are opened through the app instead - a landmark violation there would be the harness's, not
// the game's.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assert, runTest } from "./helpers.mjs";
import { launch, sleep } from "../tools/ui-harness/audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AXE = readFileSync(path.join(root, "node_modules/axe-core/axe.min.js"), "utf8");
const HARNESS = pathToFileURL(path.join(root, "tools/ui-harness/harness.html")).href;

// The harness bundle is gitignored, so build it rather than assume a previous run left one.
execFileSync(process.execPath, ["tools/ui-harness/build.mjs"], { cwd: root, stdio: "pipe" });

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });

// Every screen, as a player reaches it: a query the harness understands, then the tab to click once it's up -
// or, for a screen that opens from a Modes tile rather than the nav, the tile's name.
const SCREENS = [
  ["Modes", "?as=player", null],
  ["the 1v1 lobby", "?as=player", { tile: "1v1" }],
  ["Modes as a guest", "?as=guest", null],
  ["the rules", "?as=player&howto=1", null],
  ["the Draft screen", "?as=player", "Draft"],
  ["the Leaderboard", "?as=player", "Leaderboard"],
  ["Stats", "?as=player", "Stats"],
  ["the Players index", "?as=player", "Players"],
  ["a profile", "?as=player", "Profile"],
];

for (const [name, query, tab] of SCREENS) {
  await runTest(`${name} has no accessibility violations`, async () => {
    await page.goto(HARNESS + query, { waitUntil: "load" });
    await sleep(1600);
    if (tab && tab.tile) {
      await page.evaluate((label) => [...document.querySelectorAll(".mode .mn")].find((e) => e.textContent === label)?.closest("button")?.click(), tab.tile);
      await sleep(2200);
    } else if (tab) {
      await page.evaluate((label) => [...document.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label))?.click(), tab);
      await sleep(2200);
    }
    await page.evaluate(AXE);
    const violations = await page.evaluate(async () => {
      const run = await window.axe.run(document, { resultTypes: ["violations"] });
      return run.violations.map((v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes[0]?.html?.slice(0, 90)}`);
    });
    assert(violations.length === 0, `expected none, got:\n    ${violations.join("\n    ")}`);
  });
}

// The one axe can't judge: a roster chip is coloured by slot, and the slot has to be readable without the colour.
await runTest("a roster chip says which slot it filled, not only in colour", async () => {
  await page.goto(`${HARNESS}?as=player`, { waitUntil: "load" });
  await sleep(1600);
  await page.evaluate(() => [...document.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith("Leaderboard"))?.click());
  await sleep(2400);
  const chips = await page.evaluate(() => [...document.querySelectorAll(".chips .chip")].slice(0, 6).map((c) => c.textContent.trim()));
  assert(chips.length > 0, "the best lineup's chips are on the Leaderboard");
  assert(chips.every((c) => /^(QB|RB|WR|TE|Flex)\b/.test(c)), `every chip names its slot, got ${JSON.stringify(chips)}`);
});

await browser.close();
console.log("test-a11y.mjs done");
