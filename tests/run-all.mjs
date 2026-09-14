// Runs every tests/test-*.mjs file, one after another (they share build/test-component.mjs, so never
// in parallel), and exits non-zero if any failed. test-difficulty.mjs is a benchmark, not a pass/fail
// test, so it's left out.
//
//   node tests/run-all.mjs              every test file
//   node tests/run-all.mjs profile      only files whose name contains "profile"
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((f) => /^test-.*\.mjs$/.test(f) && f !== "test-difficulty.mjs")
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)))
  .sort();

const failed = [];
const started = Date.now();
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: path.resolve(dir, ".."), encoding: "utf8" });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  // Most suites set process.exitCode on a failure; a few only print FAIL. Treat either as a failure.
  const bad = r.status !== 0 || /\bFAIL\b/.test(out);
  console.log(`${bad ? "FAIL" : "ok  "} ${f} (${secs}s)`);
  if (bad) {
    failed.push(f);
    console.log(out.split(/\r?\n/).filter((l) => /FAIL|Error|assert/i.test(l)).slice(0, 12).map((l) => `     ${l}`).join("\n"));
  }
}
console.log(`\n${files.length - failed.length}/${files.length} test files passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (failed.length) {
  console.log(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
