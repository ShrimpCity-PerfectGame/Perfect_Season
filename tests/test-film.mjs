// The films in tools/film/ (HANDOFF 1): five standalone HTML documents that render.mjs drives frame by
// frame into an MP4. Nothing in the repo checked any of them until v2.21.2, and the cost was not
// hypothetical - a Guess grid whose five columns were a different width in every row, every player name
// wrapped mid-name, a column heading drawn in the display face as a sixth guess, and a Century roster
// drafted in an order its own seed cannot deal all shipped in finished 1080x1920 MP4s. The one tool that
// could have caught any of it, tools/film/overlap.mjs, matched ZERO painted blocks inside the Guess film
// and printed "clean".
//
// This test is deliberately TEXT-ONLY: no Chrome, no ffmpeg, no puppeteer. That is what lets it live in
// run-all.mjs and run in a second, and it is the half of the problem that is actually checkable without a
// browser - every value a film HAND-COPIES from somewhere else in the repo. A film loads from a file://
// URL with no server, so it cannot import theme.mjs or site-pages.mjs; the copies are real and necessary,
// and this is the thing that stops them drifting. What it cannot see is layout, which is overlap.mjs's
// job and, ultimately, a human looking at a frame.
//
// It also holds the renderer's own contract (window.__seek / window.__duration), because render.mjs reads
// both and a film missing either fails late - after Chrome has launched, or worse, by silently rendering
// 1800 frames of a 15-second film.
import { readFileSync, readdirSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { THEME } from "../theme.mjs";
import { DATA_CREDIT } from "../site-pages.mjs";

const DIR = "tools/film";
const FILMS = readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();
const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");
const hex = (v) => String(v || "").trim().toLowerCase();

// Every film is found by reading the directory, never from a list in this file. A list is the thing that
// goes stale the moment somebody adds film six, which is exactly how CLAUDE.md's brand-mark census came to
// be wrong by three.
await runTest("every film in tools/film is covered, and there is more than one", async () => {
  assert(FILMS.length >= 5, `expected the five films, found ${FILMS.length}: ${FILMS.join(", ")}`);
  for (const f of FILMS) assert(read(f).includes("<style"), `${f} has no stylesheet - is it a film?`);
});

// --- the renderer's contract -------------------------------------------------------------------------
//
// `__duration` must sit OUTSIDE the `if (RENDER)` arm. spin-an-era.html and tiktok-ad.html had it inside,
// so a tool that asked how long the film was without first putting it in render mode saw nothing - and
// render.mjs then fell back to 30 seconds, which is 1800 frames for a 15-second cut, of which 900 are
// identical copies of the frozen final frame. It looked right in the log and was wrong in the file.
await runTest("every film publishes __seek and __duration, and __duration is not behind if (RENDER)", async () => {
  for (const f of FILMS) {
    const src = read(f);
    assert(/window\.__seek\s*=/.test(src), `${f}: no window.__seek - render.mjs cannot drive it`);
    assert(/window\.__duration\s*=/.test(src), `${f}: no window.__duration - render.mjs cannot size the render`);

    const dur = src.indexOf("window.__duration");
    const arm = src.indexOf("if (RENDER) {");
    if (arm > -1 && dur > arm) {
      // Only a problem if it is INSIDE that block; find where the block ends by matching braces.
      let depth = 0, end = arm;
      for (let i = arm + "if (RENDER) {".length - 1; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      assert(dur > end, `${f}: window.__duration is inside if (RENDER) - a tool that asks before render mode sees nothing`);
    }
  }
});

// --- the palette -------------------------------------------------------------------------------------
//
// Each film re-declares theme.mjs's dark scope in its own :root, because it cannot import it. Total
// agreement across five copies is exactly the state in which a palette change goes unnoticed: the app
// follows theme.mjs, tests/test-theme-contrast.mjs reads theme.mjs, and the films keep the old colour
// with nothing anywhere disagreeing.
const TOKEN_FOR = {
  navy: "bg", surface: "surface", surface2: "surface2", line: "line", line2: "line2",
  muted: "muted", win: "win", orange: "orange",
  qb: "qb", rb: "rb", wr: "wr", te: "te", flex: "flex",
};
const PALETTE_FOR = { cream: "cream", lime: "lime", ink: "ink" };

await runTest("every film's palette matches theme.mjs's dark scope", async () => {
  const dark = THEME.dark;
  let checked = 0;
  for (const f of FILMS) {
    const src = read(f);
    for (const [name, token] of Object.entries(TOKEN_FOR)) {
      const m = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(src);
      if (!m) continue;
      assert(dark[token] !== undefined, `theme.mjs's dark scope has no "${token}" - update TOKEN_FOR in this test`);
      assert(hex(m[1]) === hex(dark[token]),
        `${f}: --${name} is ${m[1]}, theme.mjs dark.${token} is ${dark[token]}`);
      checked++;
    }
  }
  assert(checked >= 20, `only ${checked} palette tokens checked across ${FILMS.length} films - the regexes have stopped matching`);
});

// --- the brand mark ----------------------------------------------------------------------------------
//
// CLAUDE.md: "Change every one together". The count in that paragraph was six-in-five for three releases
// after it stopped being true, because the only thing holding the copies together was a sentence asking
// somebody to run a grep. This holds them to static/icon.svg itself.
await runTest("every inlined brand mark matches static/icon.svg exactly", async () => {
  const svg = readFileSync("static/icon.svg", "utf8");
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1].trim());
  assert(paths.length >= 3, `static/icon.svg has ${paths.length} paths - this test assumed at least 3`);

  // Detection must NOT be "does this film contain the first path", which is what it was until a mutation
  // run caught it: changing one character of that path made the film look like it simply does not draw the
  // mark, so it was skipped and the drift passed. The marker has to be something a drifting path cannot
  // destroy. Every film embeds the mark as an svg carrying icon.svg's own viewBox, under id or class
  // "mark" - that is stable, and it is what the films' own scripts already address it by.
  const DRAWS_MARK = /<svg[^>]*viewBox="0 0 64 64"|(?:id|class)="mark"/;
  let films = 0;
  for (const f of FILMS) {
    const src = read(f);
    if (!DRAWS_MARK.test(src)) continue;   // this film does not draw the mark
    films++;
    for (const d of paths) {
      assert(src.includes(d),
        `${f} draws the mark but one of static/icon.svg's paths is missing or has drifted: ${d.slice(0, 48)}...`);
    }
  }
  assert(films >= 3, `only ${films} films carry the mark - if one stopped drawing it, say so here`);
});

// --- the licence credit ------------------------------------------------------------------------------
//
// DATA.md makes the attribution a LICENCE TERM, not a style choice, and says it lives in one constant
// "rendered in two places from that one definition so they cannot drift". The films are a third, fourth
// and fifth place, hand-flattened, and the films are the copies that travel off-site where the credit is
// actually read. A reword is already scheduled for the release that carries the first sale.
await runTest("every film's data credit is DATA_CREDIT, flattened", async () => {
  const want = DATA_CREDIT.before + DATA_CREDIT.source.text + DATA_CREDIT.middle
    + DATA_CREDIT.licence.text + DATA_CREDIT.after;
  const squash = (s) => s.replace(/\s+/g, " ").trim();

  let films = 0;
  for (const f of FILMS) {
    const src = read(f);
    if (!/nflverse/i.test(src)) continue;
    films++;
    const text = squash(src.replace(/<[^>]*>/g, " ").replace(/"\s*\+\s*"/g, ""));
    assert(text.includes(squash(want)),
      `${f}: its nflverse credit is not DATA_CREDIT flattened.\n   want: ${squash(want)}`);
  }
  assert(films >= 3, `only ${films} films carry the credit - CC BY 4.0 asks for it wherever the material is used`);
});

// --- no club imagery ---------------------------------------------------------------------------------
//
// DATA.md: "No logos, no helmets, no club imagery of any kind." The builders drop nflverse's headshot URLs
// for the same reason, and test-guess-pool and friends assert zero URLs in the shipped data files. A film
// is the easiest place to forget, because it is hand-written and never reviewed as product code.
await runTest("no film loads an image or an NFL-CDN asset", async () => {
  for (const f of FILMS) {
    const src = read(f);
    assert(!/<img\b/i.test(src), `${f} has an <img> - films draw with type and CSS, never club imagery`);
    assert(!/nfl\.com|nflcdn|static\.www\.nfl/i.test(src), `${f} references an NFL CDN`);
    const remote = [...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    for (const host of remote) {
      assert(/^(fonts\.googleapis\.com|fonts\.gstatic\.com|github\.com|creativecommons\.org|gridspin\.app|www\.w3\.org)$/.test(host),
        `${f} reaches ${host}; a film may only load Google Fonts, and may only LINK the credit's own addresses`);
    }
  }
});

// Gated on the exit code, not printed unconditionally. runTest catches a failed assertion, prints FAIL and
// sets process.exitCode - so a bare "passed" at the bottom of the file is a line that appears whether or not
// anything passed. That is not a hypothetical: it is how the first mutation run of THIS file reported six
// caught regressions as missed.
if (process.exitCode) console.log("\nfilm checks FAILED");
else console.log("film checks passed");
