// Regression test for a live bug: a player's Sep 14 daily showed 19–1 in Chrome 152 (lost the
// championship to the 2023 Dolphins) while the server saved the same draft as 20–0. buildTimeline
// shuffled each playoff game's scoring plays with `sort(() => Math.random() - 0.5)`. How many times
// an engine calls a comparator like that is up to the engine, and every call draws from the seeded
// stream: Chrome 152's V8 sorts short arrays by plain binary insertion, while the older V8 in the
// server's Deno runtime first scans for a leading run, making more calls. After the first playoff
// game the two streams drifted, and so could every later playoff result.
//
// The sim now shuffles with smallTimSort, which makes the server's exact calls in any engine. These
// tests swap in Chrome's algorithm for Array.prototype.sort and check that nothing changes, and pin a
// checksum of 2,000 seasons so any future change to the random stream is a deliberate one: changing
// it re-deals every saved challenge code's season and needs the client and the Edge Function to
// ship together.
import { readFileSync } from "node:fs";
import * as gl from "../game-logic.mjs";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
gl.initGameData(data.players, data.opponents);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok - ${name}`); }
  else { console.log(`  FAIL - ${name}${detail ? ": " + JSON.stringify(detail) : ""}`); failures++; }
}

// How Chrome 152 calls a comparator on arrays of up to 14 items (checked against the real browser):
// binary insertion from the second item, with no leading-run pass.
const nativeSort = Array.prototype.sort;
function chromeStyleSort(compare) {
  if (!compare) return nativeSort.call(this);
  const a = this;
  for (let s = 1; s < a.length; s++) {
    const pivot = a[s];
    let lo = 0, hi = s;
    while (lo < hi) { const mid = lo + ((hi - lo) >> 1); if (compare(pivot, a[mid]) < 0) hi = mid; else lo = mid + 1; }
    for (let k = s; k > lo; k--) a[k] = a[k - 1];
    a[lo] = pivot;
  }
  return a;
}
function withSort(impl, fn) {
  Array.prototype.sort = impl;
  try { return fn(); } finally { Array.prototype.sort = nativeSort; }
}

// The reported draft: Lamar Jackson, Maurice Jones-Drew, Antonio Brown, Antonio Gates, then Rob
// Gronkowski and CeeDee Lamb at Flex.
function reportedDaily() {
  const lineup = "10802019|7672009|8242018|4862014|5632011|11262023";
  const sim = gl.withSeed(`${gl.dailySeed("2026-09-14", "fantasy")}#${lineup}`, () => gl.simulateSeason(119.4));
  return `${sim.w}–${sim.l} ${sim.outcome} ` + sim.games.filter((g) => g.playoff).map((g) => `${g.label} ${g.win ? "W" : "L"} ${g.us}-${g.them} vs ${g.opp}`).join(", ");
}
const SAVED = "20–0 Perfect season. 20–0. Divisional W 16-9 vs 2015 Broncos, Conference W 30-13 vs 2017 Steelers, Championship W 37-20 vs 2023 Dolphins";

const fnv = (s, h) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function checksum() {
  let h = 0x811c9dc5, deepPlayoffs = 0;
  for (let i = 0; i < 2000; i++) {
    const score = 60 + ((i * 7919) % 700) / 10;
    const sim = gl.withSeed(`replay-${i}`, () => gl.simulateSeason(score));
    if (sim.games.filter((g) => g.playoff).length >= 2) deepPlayoffs++;
    h = fnv(JSON.stringify(sim), h);
  }
  return { hash: h.toString(16).padStart(8, "0"), deepPlayoffs };
}
// Computed with the code as it was before this fix, on the V8 the server runs (Node 24's matches).
const PINNED = "aa2a6d91";

console.log("the reported daily");
check("replays as the 20–0 the server saved", reportedDaily() === SAVED, reportedDaily());
check("comes out the same with Chrome 152's sort algorithm", withSort(chromeStyleSort, reportedDaily) === SAVED, withSort(chromeStyleSort, reportedDaily));

console.log("every season");
const here = checksum();
check("2,000 seasons match the pinned checksum (the random stream hasn't changed)", here.hash === PINNED, here);
check("the checksum covers plenty of seasons with 2+ playoff games", here.deepPlayoffs > 400, here);
const chrome = withSort(chromeStyleSort, checksum);
check("the same 2,000 seasons come out identical with Chrome 152's sort algorithm", chrome.hash === PINNED, chrome);

console.log("smallTimSort");
// It still has to be a real sort for a consistent comparator: sorted and stable, the same as the
// engine's own sort, which the spec requires to be stable.
let sortOk = true;
for (let n = 0; n < 64 && sortOk; n++) {
  const items = Array.from({ length: n }, (_, i) => ({ i, k: (i * 37) % 7 }));
  const mine = gl.smallTimSort([...items], (a, b) => a.k - b.k).map((x) => x.i).join();
  const engine = [...items].sort((a, b) => a.k - b.k).map((x) => x.i).join();
  if (mine !== engine) { sortOk = false; check(`sorts ${n} items stably`, false, { mine, engine }); }
}
if (sortOk) check("sorts 0-63 items stably, the same as the engine's own sort", true);

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("test-sim-engine-independence.mjs: all passed");
