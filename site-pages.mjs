// The pages search engines can read on their own, and the copy they share with the app: /how-to-play (the same
// rules the How to play dialog shows), /leaderboard (what each board ranks), and /privacy, which is words only -
// no screen in the app answers it, so its built page carries no bundle at all. Pure and
// framework-free, so perfect-season.jsx renders it as JSX and build.mjs writes it as HTML - one source of
// truth, since two copies of the rules would drift apart.
//
// The generated pages carry this text in the HTML itself, inside <div id="root">, where React replaces it the
// moment the app mounts: a crawler (or anyone with JavaScript off) reads the words, and everyone else gets the
// game. The app also answers these addresses - landing on one opens that screen - so the page a search result
// promises is the page that loads. Contract: CLAUDE.md, "Search engines".

import { THEME } from "./theme.mjs";

// The light scope's tokens, so the pages are painted in the same colors as the app.
const T = THEME.light;

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
  ["Biggest upsets", "The lowest team score ever to win the championship — the roster that had no business going all the way."],
  ["Career records", "Wins, championships, playoff trips, the longest Daily streak and the best win percentage, on the Stats screen."],
];

// Where someone writes to about their account or their data. A role address on the site's own domain rather
// than a person's mailbox: it can be forwarded anywhere, and it doesn't put a personal address in front of
// every crawler that reads this page.
export const PRIVACY_CONTACT = "privacy@gridspin.app";
export const PRIVACY_UPDATED = "21 September 2026";

// What Gridspin keeps, said plainly and accurately - every line below is something the code actually does.
// If the code changes, this changes with it.
const PRIVACY_SECTIONS = [
  ["Playing without an account", [
    "You can play Gridspin without signing up, and nothing is asked of you to do it. A draft in progress is kept in your own browser so you can come back to it, and it never leaves your device until a season is finished.",
    "When you finish a season, the site makes a guest account for you so the score can go on the leaderboard. A guest account holds no personal information at all: no email address, no name you gave it - just a name the site generates, like Guest_4F2A1, and the seasons played under it. You can turn it into a real account later, and everything carries over.",
  ]],
  ["Accounts", [
    "An account is an email address, a password and the username you pick. The password is handled by Supabase, the service that runs the database and sign-ins, and is stored only as a hash - nobody at Gridspin can read it.",
    "If you sign in with Google instead, Google sends the site your email address, your name and a link to your profile picture. The email address is what identifies the account; the name and picture link sit unused in the account record, and the game shows only the username you choose.",
    "Account emails are sent for one reason: running the account - confirming an address, resetting a password. There is no mailing list and no marketing.",
  ]],
  ["What other people can see", [
    "Your username, your scores, your records, your best lineups and your badges are public: that is what a leaderboard is. So are anything you write in your bio, the picture you choose and the team you pick as your favourite.",
    "Your email address is never shown to anyone, whether you signed up with it or arrived through Google.",
  ]],
  ["What the game records as you play", [
    "Every finished season and every abandoned one: the boards you were dealt, the players you drafted, the score, the result and when it happened. The same for the daily, for Over/Under and for Build-a-player.",
    "The coins a season earns, the badges it unlocks and anything bought in the shop. Coins are a game score - there is no real money anywhere in Gridspin and nothing to buy with real money.",
  ]],
  ["Pictures", [
    "A profile picture is cropped to 256 by 256 in your own browser before it is uploaded, and every piece of metadata the file carried - where and when it was taken, what took it - is removed in the process. What reaches the server is the picture and nothing else.",
    "Pictures are stored in a public bucket, which means anyone with the address of the file can open it, the same as any image on any website. A moderator can remove a picture or a bio that breaks the site's rules.",
  ]],
  ["Where it all lives, and who else sees it", [
    "The database, the sign-ins and the pictures are held by Supabase. The site itself is served by Vercel. Both keep ordinary server logs to run the service, which include IP addresses and the times requests were made.",
    "The typefaces come from Google Fonts, so Google's servers receive the request for them when a page loads. Nothing else on the site is loaded from anywhere else: there are no adverts, no analytics, no tracking pixels and no third-party scripts.",
    "Nothing is sold, rented or handed to anyone else.",
  ]],
  ["What is kept on your device", [
    "A draft in progress, the scoring format you last chose, whether you have seen the rules, and - if you are signed in - the token that keeps you signed in. It lives in your browser's own storage rather than in advertising cookies, and clearing your browser data removes it.",
  ]],
  ["Your choices", [
    `You can change or clear your bio, your picture and your favourite team whenever you like, from your profile. To have your account and everything recorded under it deleted, write to ${PRIVACY_CONTACT} from the address the account uses, and it will be removed.`,
    "A guest account identifies nobody, so there is nothing to delete - stopping playing is enough. If you would rather its scores came off the leaderboard, write in and say which name it was.",
  ]],
  ["Children", [
    "Gridspin is not aimed at children under 13, and no data is knowingly kept from them. If you believe a child has made an account, write in and it will be removed.",
  ]],
  ["Changes to this page", [
    `This page says what the site does today, and it is updated when the site changes. It was last updated on ${PRIVACY_UPDATED}.`,
  ]],
];

// Each page carries the day its own words last changed, for the sitemap's <lastmod>. It used to be the build
// date on every URL, and Vercel rebuilds the site on every push - so all four claimed to have been modified
// today whenever anything in the game changed, which is exactly the signal Google says it stops believing.
// "/" is the app itself and genuinely does change with every release, so that one keeps the build date.
//
// Bump the date beside a page when you change its copy, the same way PRIVACY_UPDATED is bumped - and
// tests/test-build-seo.mjs checks the sitemap says what these say.
export const SITE_PAGES = [
  {
    id: "howto",
    path: HOWTO_PATH,
    file: "how-to-play.html",
    updated: "2026-09-20",
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
    updated: "2026-09-20",
    nav: "Leaderboards",
    title: "Gridspin leaderboards – the best football drafts",
    description: "What Gridspin's leaderboards rank: the best Fantasy and Championship team scores ever drafted, each day's Daily standings, the points ladders and career records.",
    h1: "Gridspin leaderboards",
    intro: [
      "Every finished season on Gridspin is graded, and the best of them land on a leaderboard. The standings change as people play, so this page says what each board ranks; open it to see today's names and scores.",
    ],
    boards: BOARDS,
  },
  {
    id: "privacy",
    path: "/privacy",
    file: "privacy.html",
    // PRIVACY_UPDATED in words, and this in the sitemap: change both together.
    updated: "2026-09-21",
    nav: "Privacy",
    title: "Gridspin privacy policy - what the game keeps",
    description: "What Gridspin records, what other players can see, where it is kept, and how to have an account and its data deleted. No adverts, no analytics, nothing sold.",
    h1: "Privacy policy",
    // A page of words with nothing behind it: no screen in the app answers this address, so the built page is
    // the whole thing and build.mjs leaves the game's bundle off it. That also means it reads with JavaScript
    // off, which is what a policy should do.
    standalone: true,
    intro: [
      "Gridspin is a free football game. It keeps as little about you as it can: an email address if you want an account, the name you pick, and the seasons you play. There are no adverts, no analytics and no trackers, and nothing is sold or handed to anyone else.",
      `Anything below can be undone by writing to ${PRIVACY_CONTACT}.`,
    ],
    sections: PRIVACY_SECTIONS,
    contact: PRIVACY_CONTACT,
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
// one page to the next and the app can take over the click once it has mounted. It opens the way the game does:
// the mark, the wordmark and a kicker, then the heading.
export function sitePageBody(page) {
  const parts = [
    "<div class=\"spg\">",
    "<a class=\"spg-brand\" href=\"/\">",
    "<img src=\"/icon.svg\" width=\"38\" height=\"38\" alt=\"\" />",
    "<span class=\"spg-word\">Gridspin</span>",
    "<span class=\"spg-kicker\">🏈 Football draft game</span>",
    "</a>",
    `<h1>${esc(page.h1)}</h1>`,
    ...page.intro.map((t, i) => `<p${i === 0 ? ' class="spg-lede"' : ""}>${esc(t)}</p>`),
  ];
  if (page.steps) {
    parts.push(`<ol class="spg-steps">${page.steps.map((s) => `<li>${segmentsHtml(s)}</li>`).join("")}</ol>`);
    parts.push(`<p class="spg-note">${esc(page.note)}</p>`);
  }
  if (page.sections) {
    for (const [heading, paragraphs] of page.sections) {
      parts.push(`<h2 class="spg-h2">${esc(heading)}</h2>`);
      parts.push(...paragraphs.map((t) => `<p>${esc(t)}</p>`));
    }
  }
  if (page.boards) {
    parts.push(`<dl class="spg-boards">${page.boards.map(([name, text]) => `<dt>${esc(name)}</dt><dd>${esc(text)}</dd>`).join("")}</dl>`);
  }
  const others = SITE_PAGES.filter((p) => p.id !== page.id)
    .map((p) => `<a class="spg-btn" href="${p.path}">${esc(p.h1)}</a>`);
  parts.push(`<p class="spg-cta"><a class="spg-btn spg-solid" href="/">Play Gridspin</a>${others.join("")}</p>`, "</div>");
  return parts.join("\n");
}

// How the page looks in the seconds before the app mounts, and to anyone reading with JavaScript off. It borrows
// the game's own look - cream and ink, Anton for the display face, the tactile button with its hard offset
// shadow - from the same theme.mjs tokens the app uses, so the two can't drift apart. Class names are prefixed
// spg-: this <style> stays in the head after React replaces the content, and must never style the app (the app
// already owns .sp, on the draft screen's sticky bar).
export const SITE_PAGE_CSS = `.spg{max-width:46rem;margin:0 auto;padding:26px 20px 52px;background:${T.bg};color:${T.ink};font:400 16px/1.65 Inter,system-ui,sans-serif}
.spg-brand{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px;text-decoration:none;color:${T.ink}}
.spg-word{font-family:Anton,Impact,sans-serif;font-size:24px;line-height:1;text-transform:uppercase;letter-spacing:.02em}
.spg-kicker{font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;background:${T.surface};border:2px solid ${T.ink};border-radius:999px;padding:4px 10px}
.spg h1{margin:0 0 14px;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:clamp(34px,7vw,54px);line-height:.95;text-transform:uppercase;text-wrap:balance}
.spg p{margin:0 0 14px}
.spg-lede{font-size:18px}
.spg-steps{margin:0 0 16px;padding-left:1.3em}
.spg-steps li{margin-bottom:10px}
.spg-h2{margin:26px 0 10px;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:24px;line-height:1.05;
  text-transform:uppercase;letter-spacing:.01em}
.spg-boards{margin:0}
.spg-boards dt{margin-top:16px;font-family:Anton,Impact,sans-serif;font-weight:400;font-size:19px;text-transform:uppercase;letter-spacing:.01em}
.spg-boards dd{margin:4px 0 0}
.spg-note{margin-top:20px;padding-top:12px;border-top:2px solid ${T.line};color:${T.muted};font-size:14px}
.spg-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
.spg-btn{display:inline-flex;align-items:center;border:2px solid ${T.ink};border-radius:10px;background:${T.surface};color:${T.ink};
  padding:9px 15px;font-weight:700;font-size:14px;line-height:1.2;text-decoration:none;box-shadow:3px 3px 0 ${T.hard}}
.spg-solid{background:${T.accent};color:${T.onAccent};font-family:Anton,Impact,sans-serif;font-weight:400;font-size:16px;text-transform:uppercase;letter-spacing:.03em}
.spg .nowrap{white-space:nowrap}`;

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
