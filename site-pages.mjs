// The two pages search engines can read on their own, and the copy they share with the app: /how-to-play
// (the same rules the How to play dialog shows) and /leaderboard (what each board ranks). Pure and
// framework-free, so perfect-season.jsx renders it as JSX and build.mjs writes it as HTML - one source of
// truth, since two copies of the rules would drift apart.
//
// The generated pages carry this text in the HTML itself, inside <div id="root">, where React replaces it the
// moment the app mounts: a crawler (or anyone with JavaScript off) reads the words, and everyone else gets the
// game. The app also answers these addresses - landing on one opens that screen - so the page a search result
// promises is the page that loads. Contract: CLAUDE.md, "Search engines".

export const HOWTO_PATH = "/how-to-play";
export const BOARD_PATH = "/leaderboard";

// Which site page an address names, or null for every other address (a profile, a challenge link, Modes).
// A trailing slash is the same page: Vercel serves both, so both must open the same screen.
export function parseSitePath(pathname) {
  const p = String(pathname || "").replace(/\/+$/, "") || "/";
  if (p === HOWTO_PATH) return "howto";
  if (p === BOARD_PATH) return "board";
  return null;
}

// A step's text, in pieces: a plain string, or one marked bold (`b`) and kept on one line (`nowrap`).
const b = (text) => ({ text, b: true });

// The rules, exactly as the How to play dialog shows them (perfect-season.jsx's HowTo).
export const HOWTO_STEPS = [
  ["Each round spins a ", b("team and a five-year era"), ", like “Rams, 1999–2005.” Draft one player from that board."],
  ["Fill six spots: ", b("QB, RB, WR, TE, and two Flex"), ". A Flex can be any RB, WR, or TE — and it's graded on raw production rather than against his own position, with no upper limit, so ", b("your best player is often worth more in Flex"), " than in his natural spot."],
  ["Every player shows ", b("his best season"), " for that team in that era. The stats are real. The fantasy points are hidden."],
  ["You get ", b("one team re-spin and one era re-spin"), " per draft. Use them wisely."],
  ["Play ", b("unlimited"), " drafts any time, or take the ", b("daily"), " — one draft a day, the same boards for everyone."],
  ["Pick a ", b("scoring format"), " before you draft. ", b("Fantasy"), " is full PPR, where every catch is worth a point. ", b("Championship"), " is standard scoring, where catches count for nothing and only yards and touchdowns do — so volume receivers drop and big-play threats rise. Each has its own leaderboard and its own daily."],
  ["Your six are graded, then your team plays ", b("17 games against real NFL teams"), " and, if you're good enough, the playoffs. Win them all for a ", b("perfect "), { text: "20–0", b: true, nowrap: true }, b(" season"), "."],
];
export const HOWTO_NOTE = "Grades compare each season to the top players at that position in the same era, with a bump for efficiency (QB rating, completion %, yards per carry). Flex is graded on raw production instead, with no positional comparison. Your QB counts a little more than the others.";

// What each leaderboard ranks. The numbers themselves are live in the app, never written into these pages -
// a page built yesterday must not claim to be today's standings.
const BOARDS = [
  ["Best team score", "The highest-graded roster ever drafted, in each scoring format. Fantasy is full PPR and Championship is standard scoring, and the two never rank against each other."],
  ["Today's Daily", "Everyone gets the same boards each day. The Daily leaderboard starts fresh every morning, and playing day after day builds a streak."],
  ["Points ladders", "Every draft scores ladder points against what a par draft would have managed, kept separately for Unlimited, Genius and GM mode."],
  ["Biggest upsets", "The lowest team score ever to win the championship - the roster that had no business going all the way."],
  ["Career records", "Wins, championships, playoff trips, the longest Daily streak and the best win percentage, on the Stats screen."],
];

export const SITE_PAGES = [
  {
    id: "howto",
    path: HOWTO_PATH,
    file: "how-to-play.html",
    nav: "How to play",
    title: "How to play Gridspin – football draft game rules",
    description: "How Gridspin works: spin a random NFL team and a five-year era, draft six real player seasons, then play 17 games and the playoffs. The rules, the scoring and the re-spins.",
    h1: "How to play Gridspin",
    intro: [
      "Gridspin is a free football draft game. Each round spins a random NFL team and a five-year era, you draft one real player season from that board, and your six-man roster plays a full 17-game season and then the playoffs. Win all 20 and you have gone perfect.",
      "Nothing in Gridspin costs money, and you can play without an account. Signing up saves your seasons, puts your best scores on the leaderboards and keeps your daily streak.",
    ],
    steps: HOWTO_STEPS,
    note: HOWTO_NOTE,
  },
  {
    id: "board",
    path: BOARD_PATH,
    file: "leaderboard.html",
    nav: "Leaderboards",
    title: "Gridspin leaderboards – the best football drafts",
    description: "What Gridspin's leaderboards rank: the best Fantasy and Championship team scores ever drafted, each day's Daily standings, the points ladders and career records.",
    h1: "Gridspin leaderboards",
    intro: [
      "Every finished season on Gridspin is graded, and the best of them land on a leaderboard. The standings change as people play, so this page says what each board ranks; open it to see today's names and scores.",
    ],
    boards: BOARDS,
  },
];
export const SITE_PAGE_BY_ID = Object.fromEntries(SITE_PAGES.map((p) => [p.id, p]));

// ---------- The HTML build.mjs writes (the app renders the same data as JSX) ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// One step, as HTML: bold pieces in <b>, and a piece that must not break in the app's own .nowrap span.
export const segmentsHtml = (segments) => segments.map((s) => {
  if (typeof s === "string") return esc(s);
  const text = s.nowrap ? `<span class="nowrap">${esc(s.text)}</span>` : esc(s.text);
  return s.b ? `<b>${text}</b>` : text;
}).join("");

// The page's own content, for inside <div id="root">. Every link is a real href, so a crawler can walk from
// one page to the next and the app can take over the click once it has mounted.
export function sitePageBody(page) {
  const links = SITE_PAGES.filter((p) => p.id !== page.id).map((p) => `<a href="${p.path}">${esc(p.h1)}</a>`);
  const parts = [
    "<div class=\"sp\">",
    "<p class=\"sp-brand\"><a href=\"/\">Gridspin</a> — spin an era, draft the greats, go 20–0.</p>",
    `<h1>${esc(page.h1)}</h1>`,
    ...page.intro.map((t) => `<p>${esc(t)}</p>`),
  ];
  if (page.steps) {
    parts.push(`<ol>${page.steps.map((s) => `<li>${segmentsHtml(s)}</li>`).join("")}</ol>`);
    parts.push(`<p class="sp-note">${esc(page.note)}</p>`);
  }
  if (page.boards) {
    parts.push(`<dl>${page.boards.map(([name, text]) => `<dt>${esc(name)}</dt><dd>${esc(text)}</dd>`).join("")}</dl>`);
  }
  parts.push(`<p class="sp-play"><a href="/">Play Gridspin</a>${links.length ? ` · ${links.join(" · ")}` : ""}</p>`, "</div>");
  return parts.join("\n");
}

// Enough style for the seconds before the app mounts, and for anyone reading with JavaScript off: the site's
// cream and ink, its display face for the heading, nothing else.
export const SITE_PAGE_CSS = `.sp{max-width:44rem;margin:0 auto;padding:28px 20px 48px;color:#101114;font:400 16px/1.6 Inter,system-ui,sans-serif}
.sp h1{margin:.3em 0 .5em;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:clamp(30px,6vw,44px);line-height:1.05;text-transform:uppercase}
.sp p,.sp dd{margin:0 0 1em}.sp ol{padding-left:1.2em}.sp li{margin-bottom:.7em}
.sp dt{font-weight:800}.sp dd{margin-left:0}
.sp a{color:#3155FF}.sp-brand,.sp-note{color:#5E5B52;font-size:14px}.nowrap{white-space:nowrap}`;

// What each page tells search engines it is: a page of this site, under the home page.
export function sitePageJsonLd(page, canonicalUrl) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${canonicalUrl}${page.path}#webpage`, url: `${canonicalUrl}${page.path}`, name: page.title, description: page.description, isPartOf: { "@id": `${canonicalUrl}/#website` } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Gridspin", item: `${canonicalUrl}/` },
        { "@type": "ListItem", position: 2, name: page.h1 },
      ] },
    ],
  };
}
