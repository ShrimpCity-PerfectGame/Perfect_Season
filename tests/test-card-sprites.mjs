// The card sprites' SHAPE: one neutral PNG per archetype plus the role player, the size a card expects, and a
// pose table that agrees with the rules. No browser - a PNG says how big it is in its first 24 bytes.
//
// What this cannot see is whether a sprite LOOKS right (a number half-erased, stray paper, a neighbour's arm).
// tools/cards/build-sprites.mjs writes build/card-sprites-check.png for a person to look at, and says so.
import { readFileSync, existsSync, statSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { ARCHETYPES, ROLE_PLAYER } from "../card-logic.mjs";

const at = (f) => new URL(`../${f}`, import.meta.url);
const config = JSON.parse(readFileSync(at("tools/cards/poses.json"), "utf8"));
const wanted = [...ARCHETYPES.map((a) => a.id), ROLE_PLAYER];

await runTest("a pose for every archetype and the role player, and no others", async () => {
  assert(JSON.stringify(Object.keys(config.poses).sort()) === JSON.stringify([...wanted].sort()), "poses.json names exactly the archetypes plus role: " + Object.keys(config.poses));
  for (const [pose, [sheet, cell]] of Object.entries(config.poses)) {
    const s = config.sheets[sheet];
    assert(s && Number.isInteger(cell) && cell >= 0 && cell < s.cols * s.rows, `${pose} points at a real cell`);
    assert(existsSync(at(`tools/cards/${s.file}`)), `${pose}'s sheet is in the repo`);
  }
  assert(new Set(Object.values(config.poses).map((p) => p.join(":"))).size === wanted.length, "no two poses share a drawing");
});

await runTest("every sprite is a PNG of the size a card draws", async () => {
  const meta = JSON.parse(readFileSync(at("static/cards/sprites.json"), "utf8"));
  assert(JSON.stringify(Object.keys(meta).sort()) === JSON.stringify([...wanted].sort()), "sprites.json lists the same fourteen");
  for (const pose of wanted) {
    const file = at(`static/cards/${pose}.png`);
    assert(existsSync(file), `static/cards/${pose}.png exists`);
    const b = readFileSync(file);
    assert(b.subarray(1, 4).toString("latin1") === "PNG", `${pose}.png is a PNG`);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    assert(h === 300 && w >= 120 && w <= 340, `${pose}.png is 300 tall and a sensible width (${w}x${h})`);
    assert(meta[pose].w === w && meta[pose].h === h, `sprites.json agrees about ${pose}`);
    assert(b[25] === 6, `${pose}.png has an alpha channel - the paper was cleared`);
    assert(statSync(file).size < 200 * 1024, `${pose}.png is under 200 KB (${(statSync(file).size / 1024).toFixed(0)} KB)`);
  }
});

console.log("test-card-sprites.mjs done");
