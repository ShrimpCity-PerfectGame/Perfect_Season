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
  ["the duel lobby", "?as=player", { tile: "Duel" }],
  // The screen a whole match is played on, which nothing automated used to see - the lobby was the only 1v1
  // screen on this list, and a rules button with no accessible name, a missing h2 and a roster strip saying
  // "filled" in colour alone all went out under it. Both halves: your turn, and the other player's.
  ["the duel board", "?screen=versus", null],
  ["the duel board while the other player picks", "?screen=versus&waiting=1", null],
  ["Modes as a guest", "?as=guest", null],
  // The Mini games screen itself (v2.10.0), which is now the only way to any of the three side modes.
  ["Mini games", "?as=player", { tile: "Mini games" }],
  ["the rules", "?as=player&howto=1", null],
  ["the Draft screen", "?as=player", "Draft"],
  ["the Leaderboard", "?as=player", "Leaderboard"],
  ["Stats", "?as=player", "Stats"],
  ["the Players index", "?as=player", "Players"],
  ["a profile", "?as=player", "Profile"],
  // The three nobody was opening. "the Draft screen" above is the Draft NAV TAB - the history list -
  // not the board a draft is actually played on, so the board's own heading order was never checked:
  // it went from its h1 straight to the positions' h3s, which is the bug the duel board had already
  // fixed. Over/Under and Build-a-player were not on this list at all, and neither named itself with
  // an h1. Each is opened from its Modes tile, the way a player reaches it.
  ["the draft board", "?as=player", { tile: "Unlimited" }],
  ["Over/Under", "?as=player", { tile: "Over/Under" }],
  ["Build-a-player", "?as=player", { tile: "Build-a-player" }],
  // Century (v2.9.0), both halves, for the reason the duel has two entries: the menu and the BOARD are different
  // screens, and the board is where the mode lives - a heading order over four position sections, a roster strip
  // that has to name its slots rather than colour them, and a board of buttons whose disabled ones have to say
  // why. It goes on this list from its first release rather than being added after something ships broken.
  ["Century", "?as=player", { tile: "Century" }],
  ["the Century board", "?screen=century", null],
  // And the result, which is the payoff and the one Century screen with big lime type on a dark hero. Nothing
  // else opens it without playing seven picks by hand, so the harness locks the last slot in on load.
  ["the Century result", "?screen=century&finish=1", null],
  // Guess the Player (v2.13.0), all three halves, and the GRID is the reason: it is the one screen in the game
  // whose whole signal is colour, so it is also the one where a missing word costs the most. The menu, the grid
  // part-played with all three states on screen, and the end screen that names the player.
  ["Guess the Player", "?as=player", { tile: "Guess the Player" }],
  ["the Guess the Player grid", "?screen=guess", null],
  ["the Guess the Player result", "?screen=guess&finish=1", null],
];

for (const [name, query, tab] of SCREENS) {
  await runTest(`${name} has no accessibility violations`, async () => {
    await page.goto(HARNESS + query, { waitUntil: "load" });
    await sleep(1600);
    if (tab && tab.tile) {
      // Since v2.10.0 the three side modes sit behind a Mini games tile rather than on Modes. A tile that is
      // not on screen is looked for there, the same indirection tests/helpers.mjs's clickMode does - so an
      // entry above still names the screen it means rather than the route to it.
      await page.evaluate((label) => {
        const find = () => [...document.querySelectorAll(".mode .mn")].find((e) => e.textContent === label)?.closest("button");
        if (find()) { find().click(); return; }
        const mini = [...document.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Mini games")?.closest("button");
        if (mini) mini.click();
      }, tab.tile);
      await sleep(1400);
      await page.evaluate((label) => [...document.querySelectorAll(".mode .mn")].find((e) => e.textContent === label)?.closest("button")?.click(), tab.tile);
      await sleep(2200);
    } else if (tab) {
      await page.evaluate((label) => [...document.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label))?.click(), tab);
      await sleep(2200);
    }
    // An ARIA attribute that names an id nothing has. axe does not reliably report these, and a screen reader
    // following one simply finds nothing - so it is a silent failure in exactly the place silence is worst.
    // Century's own board tabs shipped one: only the open tab panel was rendered, so the other tab pointed at
    // an id that was not in the document. Checked on every screen, because it costs nothing to.
    const dangling = await page.evaluate(() => {
      const out = [];
      for (const attr of ["aria-controls", "aria-labelledby", "aria-describedby", "aria-activedescendant"]) {
        for (const el of document.querySelectorAll(`[${attr}]`)) {
          for (const id of el.getAttribute(attr).split(/\s+/).filter(Boolean)) {
            if (!document.getElementById(id)) {
              out.push(`<${el.tagName.toLowerCase()} class="${(el.className || "").toString().slice(0, 30)}"> ${attr}="${id}"`);
            }
          }
        }
      }
      return [...new Set(out)];
    });
    assert(dangling.length === 0, `ARIA references point at nothing: ${dangling.join(" | ")}`);

    await page.evaluate(AXE);
    const violations = await page.evaluate(async () => {
      const run = await window.axe.run(document, { resultTypes: ["violations"] });
      return run.violations.map((v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes[0]?.html?.slice(0, 90)}`);
    });
    assert(violations.length === 0, `expected none, got:\n    ${violations.join("\n    ")}`);
  });
}

// The other thing axe can't judge: whether a row of cells is still a ROW. Guess the Player's grid draws its five
// cells in five columns, and a class collision turned a winning row - five cells in the same state at once - into
// a stack in one column: `.hit` is the draft card's clickable area (`all:unset;display:block`) and the cell's
// state class was called the same thing. Nothing could catch it - jsdom has no layout, and axe measures the
// colours, which were right. So the check is geometric, in a real browser, on the one row where every cell
// changes at once.
await runTest("the guess grid draws a row across, even when every cell is green", async () => {
  await page.goto(`${HARNESS}?screen=guess&finish=1`, { waitUntil: "load" });
  await sleep(2600);
  const rows = await page.evaluate(() => [...document.querySelectorAll(".gp-grid tbody tr")].map((tr) => ({
    cells: tr.children.length,
    displays: [...tr.children].map((c) => getComputedStyle(c).display),
    lefts: [...tr.children].map((c) => Math.round(c.getBoundingClientRect().left)),
    states: [...tr.children].map((c) => c.className),
  })));
  assert(rows.length > 1, `the end screen shows the guesses: ${rows.length}`);
  const won = rows[rows.length - 1];
  // The winning row is the one that matters and it is identified by SHAPE, not by a class name: five cells in
  // one state. Pinning the name would make a rename fail this test for the wrong reason - and renaming is what
  // fixed the bug it guards.
  assert(new Set(won.states.slice(1)).size === 1 && won.states.length === 6,
    `the last row has every cell in one state: ${JSON.stringify(won.states)}`);
  for (const row of rows) {
    assert(row.displays.every((d) => d === "table-cell"), `every cell is a table cell: ${JSON.stringify(row.displays)}`);
    assert(new Set(row.lefts).size === row.cells, `and sits in a column of its own: ${JSON.stringify(row.lefts)}`);
  }
  // Every column lines up down the grid, which is what makes the grid readable at all.
  const first = rows[0].lefts;
  for (const row of rows) assert(row.lefts.every((x, i) => Math.abs(x - first[i]) <= 1), `columns line up: ${JSON.stringify(row.lefts)}`);
});

// The player's name is the one thing on a row you have to READ, and a fixed table layout with no widths gave it
// a sixth of a phone: every row said "Tyler C...", "Davant...", "Penei ...". Checked at the widths phones
// actually are, in a real browser, because nothing else can see a clipped box.
await runTest("a player's name is readable on a phone, not cut off", async () => {
  for (const width of [320, 375, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${HARNESS}?screen=guess&guesses=5`, { waitUntil: "load" });
    await sleep(2400);
    const out = await page.evaluate(() => ({
      overflows: document.documentElement.scrollWidth > window.innerWidth,
      names: [...document.querySelectorAll(".gp-grid .gp-name")].map((el) => ({
        text: el.textContent,
        // A clipped box is wider inside than out. An ellipsis would hide the half of the name that identifies
        // him - "Davant..." could be Davante Adams or Davante Davis - so a long name wraps instead.
        clipped: el.scrollWidth > el.clientWidth + 1,
      })),
      cells: [...document.querySelectorAll(".gp-grid .gp-cell")].map((td) => ({
        text: td.textContent.trim().slice(0, 8),
        clipped: td.scrollWidth > td.clientWidth + 1,
      })),
    }));
    assert(out.names.length > 0, `the grid has rows at ${width}px`);
    const cut = out.names.filter((n) => n.clipped);
    assert(cut.length === 0, `no name is cut off at ${width}px: ${cut.map((n) => n.text).join(", ")}`);
    const cutCells = out.cells.filter((c) => c.clipped);
    assert(cutCells.length === 0, `no cell is cut off at ${width}px: ${cutCells.map((c) => c.text).join(", ")}`);
    assert(!out.overflows, `and the page does not scroll sideways at ${width}px`);
  }
  await page.setViewport({ width: 390, height: 844 });
});

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
