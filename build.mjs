// Production build: bundles entry.jsx into public/page.js and copies the static page.html
// alongside it. A Node script (not a shell-substituted esbuild CLI flag) so the env-var
// injection works identically on Windows/PowerShell, macOS, Linux, and Vercel's build image.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";

mkdirSync("public", { recursive: true });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn("Warning: SUPABASE_URL / SUPABASE_ANON_KEY are not set - the built bundle will fail to sign in.");
}

// Baked in at build time so a running site can say exactly which release it is. APP_ENV is
// "staging" on the test site, which makes it announce itself in the UI - the worst failure mode
// for a staging setup is not knowing which of the two sites you're looking at.
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const appEnv = process.env.APP_ENV || "production";
if (appEnv !== "production" && appEnv !== "staging") {
  throw new Error(`APP_ENV must be "production" or "staging", got "${appEnv}"`);
}

// The site's own address, for link previews (crawlers need absolute image URLs) and the link at the
// end of the share text. SITE_URL wins when set. Production is always gridspin.app, named here rather
// than read from Vercel, so it doesn't matter whether Vercel serves the apex or www as the primary
// domain. Staging names itself from VERCEL_PROJECT_PRODUCTION_URL (its *.vercel.app address).
const PRODUCTION_SITE_URL = "https://gridspin.app";
// Where production is actually served: Vercel forwards the apex to www, so www is the address search
// engines index (canonical, sitemap, link previews). People still type and share gridspin.app. If
// the apex ever becomes the primary domain in Vercel, set this to PRODUCTION_SITE_URL.
const PRODUCTION_CANONICAL_URL = "https://www.gridspin.app";
const trim = (u) => (u || "").replace(/\/+$/, "");
const siteUrl = trim(process.env.SITE_URL
  || (appEnv === "production" ? PRODUCTION_SITE_URL : "")
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : ""));
const canonicalUrl = trim(process.env.CANONICAL_URL || (appEnv === "production" ? PRODUCTION_CANONICAL_URL : siteUrl));
if (!siteUrl) console.warn("Warning: no SITE_URL - link previews get relative image paths and the share text has no link.");

await esbuild.build({
  entryPoints: ["entry.jsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  outfile: "public/page.js",
  // Half the bytes for phones to download and parse (about 1.6 MB to 0.8 MB before compression).
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    SUPABASE_URL: JSON.stringify(process.env.SUPABASE_URL || ""),
    SUPABASE_ANON_KEY: JSON.stringify(process.env.SUPABASE_ANON_KEY || ""),
    APP_VERSION: JSON.stringify(version),
    APP_ENV: JSON.stringify(appEnv),
    APP_SITE_URL: JSON.stringify(siteUrl),
  },
});

// Icons, the web manifest and the link preview image (see tools/brand/render.mjs) are served from
// the site root.
cpSync("static", "public", { recursive: true });

// page.html (used as-is for local dev, next to build/page.js and static/) points at "build/page.js"
// and "static/..."; public/ is flat, so rewrite the paths that differ rather than hand-maintain a
// second copy of the page, and fill in the absolute address link previews need.
// Staging must never be indexed: it would compete with the real site in search results.
// Asset paths are root-relative: the same page also answers challenge links (/c/CODE, see vercel.json),
// where a relative "page.js" would resolve to /c/page.js.
const html = readFileSync("page.html", "utf8")
  .replace("build/page.js", "/page.js")
  .replace(/"static\//g, '"/')
  .replace(/\/static\//g, "/")
  .replaceAll("%CANONICAL_URL%", canonicalUrl)
  .replace("%ROBOTS%", appEnv === "staging" ? '<meta name="robots" content="noindex, nofollow" />\n' : "");
writeFileSync("public/page.html", html);

// Crawl files. Staging still allows crawling on purpose: a crawler has to fetch a page to see its
// noindex, and a robots.txt block would hide that. Only production gets a sitemap. The site is one
// page - every screen lives at "/" - so the sitemap has one URL.
if (appEnv === "production" && canonicalUrl) {
  writeFileSync("public/robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${canonicalUrl}/sitemap.xml\n`);
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync("public/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${canonicalUrl}/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`);
} else {
  writeFileSync("public/robots.txt", "User-agent: *\nAllow: /\n");
  rmSync("public/sitemap.xml", { force: true });
}
console.log(`Built public/page.js and public/page.html (v${version}, ${appEnv}, ${siteUrl || "no SITE_URL"}, canonical ${canonicalUrl || "none"})`);
