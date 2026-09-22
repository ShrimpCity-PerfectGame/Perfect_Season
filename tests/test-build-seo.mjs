// What search engines get from each environment's build: production is indexable at its one real
// address with a sitemap, and staging (and every *.vercel.app copy) tells them to stay away, so the
// test site and the old addresses never compete with gridspin.app in search results.
//
// Runs the real build.mjs, which writes public/ (gitignored); it's left holding the staging build.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_PAGES } from "../site-pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok - ${name}`);
  else { console.log(`  FAIL - ${name}${detail ? ": " + String(detail).slice(0, 300) : ""}`); failures++; }
}
function build(env) {
  const clean = { ...process.env };
  for (const k of ["APP_ENV", "SITE_URL", "CANONICAL_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) delete clean[k];
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, env: { ...clean, ...env }, stdio: "pipe" });
  const read = (f) => (existsSync(path.join(root, "public", f)) ? readFileSync(path.join(root, "public", f), "utf8") : null);
  return {
    html: read("page.html"), robots: read("robots.txt"), sitemap: read("sitemap.xml"), js: read("page.js"),
    pages: Object.fromEntries(SITE_PAGES.map((p) => [p.id, read(p.file)])),
  };
}
// The words a crawler must find in a page's own HTML, with the tags taken out. A page with a bundle ends at
// the script that replaces them; a standalone one (the privacy policy) has no script, so it ends at the body.
const staticText = (html) => {
  const body = (html || "").match(/<div id="root">([\s\S]*?)<\/div>\s*(?:<script|<\/body>)/);
  return body ? body[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
};
const attr = (html, re) => (html.match(re) || [])[1];

console.log("page.html as authored");
const raw = readFileSync(path.join(root, "page.html"), "utf8");
// It's opened as-is for local checks: a bare text placeholder in <head> would end up on the page.
check("the robots placeholder is an HTML comment, used once", !raw.includes("%ROBOTS%") && raw.split("<!--ROBOTS-->").length === 2);

console.log("production build");
const prod = build({});
check("the robots placeholder is gone from the built page", !prod.html.includes("<!--ROBOTS-->"));
check("canonical is the address Vercel serves", attr(prod.html, /<link rel="canonical" href="([^"]+)"/) === "https://www.gridspin.app/", prod.html);
check("link previews use the same address", attr(prod.html, /property="og:image" content="([^"]+)"/) === "https://www.gridspin.app/og.png");
check("no noindex", !/name="robots"/.test(prod.html));
check("no unfilled placeholders", !/%[A-Z_]+%/.test(prod.html), prod.html.match(/%[A-Z_]+%/));
check("robots.txt allows crawling and names the sitemap", /Allow: \//.test(prod.robots || "") && (prod.robots || "").includes("Sitemap: https://www.gridspin.app/sitemap.xml"), prod.robots);
check("sitemap lists the home page", (prod.sitemap || "").includes("<loc>https://www.gridspin.app/</loc>"), prod.sitemap);
let ld = null;
try { ld = JSON.parse(attr(prod.html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/)); } catch (e) { /* reported below */ }
check("structured data is valid JSON naming the site", ld && ld["@graph"].some((n) => n["@type"] === "WebSite" && n.name === "Gridspin" && n.url === "https://www.gridspin.app/"), ld && JSON.stringify(ld));
check("the share link people see stays gridspin.app", prod.js.includes('"https://gridspin.app"'));
// A ceiling, not a budget: what it catches is a build that forgot to minify, which is about 1.9 MB. It was
// 1,000,000 until v1.19.0, when 1v1's defenses and kickers (data/versus-pool.json, 67 KB packed) took the real
// bundle past it - the bundle was already ~988 KB. If this needs raising again, ask first whether the thing
// being added belongs in the page every visitor loads: the honest fix for that file is to load it when the 1v1
// screen opens rather than at startup, which needs the service worker to learn about a second chunk.
check("the bundle is minified", prod.js.length < 1_200_000, `${prod.js.length} bytes`);
check("the tab title leads with the name", /<title>Gridspin – /.test(prod.html));
// The same page answers challenge links (/c/CODE), where relative asset paths would break.
check("the app and icons load from root-relative paths", prod.html.includes('<script src="/page.js">') && prod.html.includes('href="/icon.svg"') && prod.html.includes('href="/site.webmanifest"') && !/(src|href)="(?!\/|https?:)[^"]+\.(js|svg|png|webmanifest)"/.test(prod.html), prod.html.match(/(src|href)="[^"]+"/g));

// The pages that answer for themselves (site-pages.mjs): each has its own address, title, description and
// text in the HTML, so a search result can send someone straight to the rules or the boards.
console.log("pages of their own");
check("every site page was built", SITE_PAGES.every((p) => prod.pages[p.id]), SITE_PAGES.map((p) => `${p.file}: ${!!prod.pages[p.id]}`).join(", "));
const homeTitle = attr(prod.html, /<title>([^<]*)<\/title>/);
const homeDesc = attr(prod.html, /<meta name="description" content="([^"]*)"/);
for (const page of SITE_PAGES) {
  const html = prod.pages[page.id] || "";
  const at = `${page.path}`;
  check(`${at} has its own tab title`, attr(html, /<title>([^<]*)<\/title>/) === page.title && page.title !== homeTitle, attr(html, /<title>([^<]*)<\/title>/));
  check(`${at} has its own description`, attr(html, /<meta name="description" content="([^"]*)"/) === page.description && page.description !== homeDesc);
  check(`${at} is canonical at its own address`, attr(html, /<link rel="canonical" href="([^"]+)"/) === `https://www.gridspin.app${page.path}`);
  check(`${at} shares that address and title with its link preview`,
    attr(html, /property="og:url" content="([^"]+)"/) === `https://www.gridspin.app${page.path}`
    && attr(html, /property="og:title" content="([^"]+)"/) === page.title
    && attr(html, /name="twitter:title" content="([^"]+)"/) === page.title);
  check(`${at} is indexable`, !/name="robots"/.test(html));
  check(`${at} has no unfilled placeholders`, !/%[A-Z_]+%/.test(html), html.match(/%[A-Z_]+%/));
  let pld = null;
  try { pld = JSON.parse(attr(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/)); } catch (e) { /* reported below */ }
  const web = pld && pld["@graph"].find((n) => n["@type"] === "WebPage");
  check(`${at} says what it is, as part of the site`,
    !!web && web.url === `https://www.gridspin.app${page.path}` && web.isPartOf["@id"] === "https://www.gridspin.app/#website"
    && pld["@graph"].some((n) => n["@type"] === "BreadcrumbList"), pld && JSON.stringify(pld).slice(0, 200));
  // The whole point: the words are in the HTML, not only in the rendered app.
  const text = staticText(html);
  check(`${at} carries its own words in the HTML`, text.includes(page.h1) && page.intro.every((p) => text.includes(p)), text.slice(0, 160));
  if (page.steps) check(`${at} carries the rules themselves`, text.includes("one team re-spin and one era re-spin") && text.includes(page.note.slice(0, 40)), text.slice(0, 200));
  if (page.boards) check(`${at} lists what each board ranks`, page.boards.every(([name]) => text.includes(name)), text.slice(0, 200));
  const linksTo = (href) => new RegExp(`<a[^>]*href="${href}"`).test(html);
  check(`${at} links to the game and the other page`,
    /<a[^>]*href="\/"[^>]*>Play Gridspin<\/a>/.test(html) && linksTo("/") && SITE_PAGES.filter((o) => o.id !== page.id).every((o) => linksTo(o.path)),
    (html.match(/<a[^>]*href="[^"]*"/g) || []).join(" "));
  // Its own words replace the shell's <noscript> stand-in, so the page has one heading, not two.
  check(`${at} has one heading and no leftover stand-in`, !/<noscript>/.test(html) && (html.match(/<h1[ >]/g) || []).length === 1, (html.match(/<h1[^>]*>[^<]*/g) || []).join(" | "));
  // Same shell as the app: one head to maintain. A page the app has a screen for also loads the bundle, so the
  // game takes over the moment it arrives; a standalone one (the privacy policy) deliberately doesn't, so its
  // words survive and it reads with JavaScript off.
  check(`${at} uses the same head as the home page`,
    html.includes('href="/icon.svg"') && html.includes('href="/site.webmanifest"')
    && html.includes('<meta name="theme-color" content="#F7F4EA" />'));
  check(`${at} ${page.standalone ? "carries no bundle, so its words stay" : "loads the app, which takes over its words"}`,
    html.includes('<script src="/page.js">') === !page.standalone,
    (html.match(/<script[^>]*>/g) || []).join(" "));
}
check("the sitemap lists every page of its own", SITE_PAGES.every((p) => (prod.sitemap || "").includes(`<loc>https://www.gridspin.app${p.path}</loc>`)), prod.sitemap);
// Each page says when its own words last changed, and only "/" - the app, which really does change every
// release - carries the build date. Stamping today on all four told a crawler the whole site changes daily,
// which is how lastmod stops being believed, and it is a claim that was simply untrue of three of them.
const stamp = (path) => ((prod.sitemap || "").match(new RegExp(`<loc>https://www\.gridspin\.app${path.replace("/", "\/")}</loc><lastmod>([0-9-]+)</lastmod>`)) || [])[1];
check("the home page's lastmod is this build", stamp("/") === new Date().toISOString().slice(0, 10), stamp("/"));
check("every other page says when its own words last changed",
  SITE_PAGES.every((p) => stamp(p.path) === p.updated),
  SITE_PAGES.map((p) => `${p.path} sitemap=${stamp(p.path)} declared=${p.updated}`).join(" | "));

console.log("staging build");
const stg = build({ APP_ENV: "staging", VERCEL_PROJECT_PRODUCTION_URL: "perfect-season-staging.vercel.app" });
check("noindex", /<meta name="robots" content="noindex, nofollow" \/>/.test(stg.html));
check("canonical points at staging itself", attr(stg.html, /<link rel="canonical" href="([^"]+)"/) === "https://perfect-season-staging.vercel.app/");
check("robots.txt doesn't block crawling (a crawler must fetch a page to see its noindex)", !/Disallow/.test(stg.robots || "x"), stg.robots);
check("no sitemap", stg.sitemap === null);
check("the pages of their own are noindexed too, at staging's own address",
  SITE_PAGES.every((p) => /<meta name="robots" content="noindex, nofollow" \/>/.test(stg.pages[p.id] || "")
    && attr(stg.pages[p.id], /<link rel="canonical" href="([^"]+)"/) === `https://perfect-season-staging.vercel.app${p.path}`),
  SITE_PAGES.map((p) => attr(stg.pages[p.id] || "", /<link rel="canonical" href="([^"]+)"/)).join(", "));

console.log("vercel.json");
const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const rule = (vercel.headers || []).find((h) => h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex"));
const hostRe = rule && new RegExp(`^${rule.has.find((c) => c.type === "host").value}$`);
// Staging and any other *.vercel.app copy are told to stay away. The two ORIGINAL production addresses are
// not: they serve production's own HTML, whose canonical points at www.gridspin.app - and a noindex on a
// page that points at another is the one signal pair that can carry the noindex across to it. This test used
// to require all three to match, which is why the exemption shipped inert for a release: the `$` in
// `(?!perfect-season-t9sk$|...)` anchored to the end of the HOST, so the lookahead could never fire, and the
// assertion that would have caught it was asserting the bug.
check("staging and other *.vercel.app copies send noindex", !!hostRe && hostRe.test("perfect-season-staging.vercel.app") && hostRe.test("some-preview-xyz.vercel.app"));
check("the two legacy production addresses do not", !!hostRe && !hostRe.test("perfect-season-t9sk.vercel.app") && !hostRe.test("perfect-season-beta.vercel.app"));
check("gridspin.app itself is never noindexed", !!hostRe && !hostRe.test("gridspin.app") && !hostRe.test("www.gridspin.app"));
// The redirects and the security headers, neither of which anything read until now: you could delete the
// whole "redirects" array, or all five headers, and the suite stayed green. Worse, adding a redirect whose
// source is "/" would make the home page an infinite 308 - a total outage that no test would notice.
const redirects = vercel.redirects || [];
const clean = { "/page.html": "/", "/how-to-play.html": "/how-to-play", "/leaderboard.html": "/leaderboard", "/privacy.html": "/privacy" };
for (const [from, to] of Object.entries(clean)) {
  check(`${from} redirects to ${to}`, redirects.some((r) => r.source === from && r.destination === to && r.permanent === true));
}
// A redirect whose source is also a rewrite DESTINATION is fine (the rewrite is internal and resolves
// against the filesystem). A redirect whose source is a rewrite SOURCE is a loop: the address redirects,
// and the address it redirects to rewrites straight back to it.
const rewriteSources = new Set((vercel.rewrites || []).map((r) => r.source));
const looping = redirects.filter((r) => rewriteSources.has(r.source));
check("no redirect points at an address that rewrites back to it", looping.length === 0, looping);
check("nothing redirects the home page", !redirects.some((r) => r.source === "/"), redirects);

const always = (vercel.headers || []).find((h) => h.source === "/(.*)" && !h.has);
const sent = Object.fromEntries((always?.headers || []).map((x) => [x.key, x.value]));
check("every response sends nosniff", sent["X-Content-Type-Options"] === "nosniff", sent);
check("...a referrer policy", /^strict-origin/.test(sent["Referrer-Policy"] || ""), sent);
check("...and refuses to be framed", /frame-ancestors 'none'/.test(sent["Content-Security-Policy"] || "") && sent["X-Frame-Options"] === "DENY", sent);
// Only frame-ancestors, deliberately: a real policy has to allow inline styles (the stylesheet is injected
// as a string), Supabase over REST and websockets, and data:/blob: images for the avatars.
check("the CSP is frame-ancestors alone, so it can't break the app", (sent["Content-Security-Policy"] || "").split(";").filter(Boolean).length === 1, sent);
check("the hardware the game never asks for is turned off", /camera=\(\)/.test(sent["Permissions-Policy"] || "") && /geolocation=\(\)/.test(sent["Permissions-Policy"] || ""), sent);

check("challenge links (/c/CODE) serve the app", (vercel.rewrites || []).some((r) => r.source === "/c/:code" && r.destination === "/page.html"));
check("challenge links with a trailing slash serve the app too", (vercel.rewrites || []).some((r) => r.source === "/c/:code/" && r.destination === "/page.html"));
check("challenge links are kept out of search results", (vercel.headers || []).some((h) => h.source === "/c/(.*)" && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex")));
// Profiles (1.11.0) are public at /u/NAME but noindexed for now.
check("profile addresses (/u/NAME) serve the app", (vercel.rewrites || []).some((r) => r.source === "/u/:name" && r.destination === "/page.html"));
check("profile addresses with a trailing slash serve the app too", (vercel.rewrites || []).some((r) => r.source === "/u/:name/" && r.destination === "/page.html"));
check("profiles are kept out of search results", (vercel.headers || []).some((h) => h.source === "/u/(.*)" && !h.has && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex")));
// The pages of their own are the opposite case: served at their address, and meant to be indexed.
for (const page of SITE_PAGES) {
  check(`${page.path} is served, with or without a trailing slash`,
    [page.path, `${page.path}/`].every((s) => (vercel.rewrites || []).some((r) => r.source === s && r.destination === `/${page.file}`)),
    JSON.stringify(vercel.rewrites));
  check(`${page.path} is never noindexed`, !(vercel.headers || []).some((h) => !h.has && new RegExp(`^${h.source.replace(/\(\.\*\)/, ".*")}$`).test(page.path)
    && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex")));
}

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("test-build-seo.mjs: all passed");
