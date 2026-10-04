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

// Since v2.21.2 a film may link tools/film/kit.css and kit.js instead of carrying the palette, the brand
// mark, the licence credit and the driver itself. Every assertion below is about what a film EFFECTIVELY
// contains, so it reads the same whether a value is inlined or inherited - which is the point: the checks
// do not get weaker because the duplication was removed, and the three already-posted films (which do not
// use the kit, and must not, being delivered work) are held to exactly what they were.
const KIT_CSS = readFileSync(`${DIR}/kit.css`, "utf8");
const KIT_JS = readFileSync(`${DIR}/kit.js`, "utf8");
const usesKit = (src) => /src="kit\.js"/.test(src);
const effective = (f) => {
  const src = read(f);
  return usesKit(src) ? src + "\n" + KIT_CSS + "\n" + KIT_JS : src;
};

await runTest("a film either carries the shell itself or links BOTH halves of the kit", async () => {
  for (const f of FILMS) {
    const src = read(f);
    if (!usesKit(src)) continue;
    assert(/href="kit\.css"/.test(src), `${f} loads kit.js but not kit.css - it will drive with no stage`);
    assert(/FILM\.start\(/.test(src), `${f} loads the kit but never calls FILM.start`);
  }
});

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
    const src = effective(f);
    assert(/window\.__seek\s*=|global\.__seek\s*=/.test(src), `${f}: no window.__seek - render.mjs cannot drive it`);
    assert(/window\.__duration\s*=|global\.__duration\s*=/.test(src), `${f}: no window.__duration - render.mjs cannot size the render`);

    const dur = Math.max(src.indexOf("window.__duration"), src.indexOf("global.__duration"));
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
    const src = effective(f);
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
    const src = effective(f);
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

  // NO skipping a film that fails to mention nflverse. That `continue` is how the two films carrying no
  // attribution AT ALL went unexamined: they were silently dropped from the loop and the `films >= 3` floor
  // was met by the three that did have it. Every film here shows real players off nflverse data, so every
  // film owes the credit - there is no honest reason for one of them to be exempt.
  let films = 0;
  for (const f of FILMS) {
    const src = effective(f);
    films++;
    const text = squash(src.replace(/<[^>]*>/g, " ").replace(/"\s*\+\s*"/g, ""));
    assert(text.includes(squash(want)),
      `${f}: its nflverse credit is not DATA_CREDIT flattened.\n   want: ${squash(want)}`);
  }
  assert(films === FILMS.length, `checked ${films} of ${FILMS.length} films - every one must be checked`);
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

// --- the credit has to survive into the FRAME -------------------------------------------------------
//
// A film can carry the attribution in its source, pass the check above, and still render an MP4 with none
// on it, because `body.render <something> { display:none }` hides it in exactly the mode that makes the
// video. This is NOT hypothetical and the first version of this test got the mechanism wrong: it assumed
// spin-an-era.html and tiktok-ad.html were hiding their credit, listed them as known-wrong, and moved on.
// What those two were actually doing was worse - their `.credit` is a PRODUCTION NOTE about the film
// ("A thirty-second title sequence...") which is rightly hidden with the transport, and the nflverse
// attribution was simply absent from the file. Measured in a browser: nflverse elements inside .stage, 0.
//
// So the rule is about the element that actually HOLDS the credit, whatever it is called: find the classes
// a film blanks in render mode, and require that none of them is the one carrying the attribution.
await runTest("the element carrying the data credit is not blanked in render mode", async () => {
  const noComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const want = DATA_CREDIT.before.trim().split(/\s+/).slice(0, 4).join(" ");   // "Player and team statistics"

  for (const f of FILMS) {
    const raw = noComments(read(f));
    const all = noComments(effective(f));

    // Which classes does this film blank once ?render=1 is on?
    const hidden = new Set();
    for (const m of all.matchAll(/body\.render([^{]*)\{([^}]*)\}/g)) {
      if (!/display\s*:\s*none/.test(m[2])) continue;
      for (const c of m[1].matchAll(/\.([A-Za-z][\w-]*)/g)) hidden.add(c[1]);
    }

    // Which class carries the credit? Either the text sits in the markup, or the kit fills `.credit` by JS.
    const carriers = new Set();
    for (const m of raw.matchAll(/class="([^"]*)"[^>]*>\s*([^<]{0,120})/g)) {
      if (m[2].includes(want)) for (const c of m[1].split(/\s+/)) if (c) carriers.add(c);
    }
    // Three of the films set the credit from JS onto an element they fetch by id - the text is never in the
    // markup at all, which is why a markup-only scan reported "nothing carries it" for tiktok-century. Follow
    // the assignment to the id, then the id to its classes.
    for (const m of raw.matchAll(/\$\(\s*"([\w-]+)"\s*\)\s*\.textContent\s*=[\s\S]{0,80}?Player and team statistics/g)) {
      const id = m[1];
      const el = new RegExp(`id="${id}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*id="${id}"`).exec(raw);
      if (el) for (const c of (el[1] || el[2]).split(/\s+/)) if (c) carriers.add(c);
    }
    if (usesKit(raw)) carriers.add("credit");
    assert(carriers.size > 0, `${f}: nothing in it carries the nflverse credit`);

    // Present is not the same as WIRED. A mutation run proved this: breaking the kit so it never assigns
    // the credit to an element left every check green, because the string was still sitting in kit.js.
    // A film that fills the credit from JS has to actually put it somewhere.
    if (usesKit(raw)) {
      assert(/\.credit[\s\S]{0,120}?textContent\s*=\s*CREDIT|credit\.textContent\s*=\s*CREDIT/.test(noComments(KIT_JS)),
        "kit.js holds the credit string but never assigns it to an element - every kit film would render without it");
    }
    // A non-kit film keeps the credit in its own markup or its own script - either way it is in the file
    // the carrier search above already read, so that search IS the wiring check for those.

    for (const c of carriers) {
      assert(!hidden.has(c),
        `${f}: .${c} carries the data credit and is display:none under body.render - the MP4 ships with no attribution`);
    }
  }
});

// Gated on the exit code, not printed unconditionally. runTest catches a failed assertion, prints FAIL and
// sets process.exitCode - so a bare "passed" at the bottom of the file is a line that appears whether or not
// anything passed. That is not a hypothetical: it is how the first mutation run of THIS file reported six
// caught regressions as missed.
if (process.exitCode) console.log("\nfilm checks FAILED");
else console.log("film checks passed");
