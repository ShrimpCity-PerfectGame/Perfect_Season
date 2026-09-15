// What search engines get from each environment's build: production is indexable at its one real
// address with a sitemap, and staging (and every *.vercel.app copy) tells them to stay away, so the
// test site and the old addresses never compete with gridspin.app in search results.
//
// Runs the real build.mjs, which writes public/ (gitignored); it's left holding the staging build.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  return { html: read("page.html"), robots: read("robots.txt"), sitemap: read("sitemap.xml"), js: read("page.js") };
}
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
check("the bundle is minified", prod.js.length < 1_000_000, `${prod.js.length} bytes`);
check("the tab title leads with the name", /<title>Gridspin – /.test(prod.html));
// The same page answers challenge links (/c/CODE), where relative asset paths would break.
check("the app and icons load from root-relative paths", prod.html.includes('<script src="/page.js">') && prod.html.includes('href="/icon.svg"') && prod.html.includes('href="/site.webmanifest"') && !/(src|href)="(?!\/|https?:)[^"]+\.(js|svg|png|webmanifest)"/.test(prod.html), prod.html.match(/(src|href)="[^"]+"/g));

console.log("staging build");
const stg = build({ APP_ENV: "staging", VERCEL_PROJECT_PRODUCTION_URL: "perfect-season-staging.vercel.app" });
check("noindex", /<meta name="robots" content="noindex, nofollow" \/>/.test(stg.html));
check("canonical points at staging itself", attr(stg.html, /<link rel="canonical" href="([^"]+)"/) === "https://perfect-season-staging.vercel.app/");
check("robots.txt doesn't block crawling (a crawler must fetch a page to see its noindex)", !/Disallow/.test(stg.robots || "x"), stg.robots);
check("no sitemap", stg.sitemap === null);

console.log("vercel.json");
const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const rule = (vercel.headers || []).find((h) => h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex"));
const hostRe = rule && new RegExp(`^${rule.has.find((c) => c.type === "host").value}$`);
check("every *.vercel.app address sends noindex", !!hostRe && ["perfect-season-t9sk.vercel.app", "perfect-season-beta.vercel.app", "perfect-season-staging.vercel.app"].every((h) => hostRe.test(h)));
check("gridspin.app itself is never noindexed", !!hostRe && !hostRe.test("gridspin.app") && !hostRe.test("www.gridspin.app"));
check("challenge links (/c/CODE) serve the app", (vercel.rewrites || []).some((r) => r.source === "/c/:code" && r.destination === "/page.html"));
check("challenge links with a trailing slash serve the app too", (vercel.rewrites || []).some((r) => r.source === "/c/:code/" && r.destination === "/page.html"));
check("challenge links are kept out of search results", (vercel.headers || []).some((h) => h.source === "/c/(.*)" && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex")));
// Profiles (1.11.0) are public at /u/NAME but noindexed for now.
check("profile addresses (/u/NAME) serve the app", (vercel.rewrites || []).some((r) => r.source === "/u/:name" && r.destination === "/page.html"));
check("profile addresses with a trailing slash serve the app too", (vercel.rewrites || []).some((r) => r.source === "/u/:name/" && r.destination === "/page.html"));
check("profiles are kept out of search results", (vercel.headers || []).some((h) => h.source === "/u/(.*)" && !h.has && h.headers.some((x) => x.key === "X-Robots-Tag" && x.value === "noindex")));

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log("test-build-seo.mjs: all passed");
