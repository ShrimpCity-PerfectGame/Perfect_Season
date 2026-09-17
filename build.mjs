// Production build: bundles entry.jsx into public/page.js and copies the static page.html
// alongside it. A Node script (not a shell-substituted esbuild CLI flag) so the env-var
// injection works identically on Windows/PowerShell, macOS, Linux, and Vercel's build image.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { SITE_PAGES, sitePageBody, sitePageJsonLd, SITE_PAGE_CSS } from "./site-pages.mjs";

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

// The website mounts through entry.jsx. The Android app (tools/app/build-app.mjs) asks for its own entry, which
// adds the native wiring - so the site's bundle never carries any of it.
const entry = process.env.APP_ENTRY || "entry.jsx";

await esbuild.build({
  entryPoints: [entry],
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
  .replace("<!--ROBOTS-->", appEnv === "staging" ? '<meta name="robots" content="noindex, nofollow" />' : "");
writeFileSync("public/page.html", html);

// The pages search engines can read on their own (site-pages.mjs): the same shell as the app, with this page's
// own title, description, canonical, structured data, and its text inside #root where React replaces it on
// mount. Every swap is checked, so renaming a tag in page.html fails the build instead of quietly shipping a
// page carrying the home page's title. vercel.json serves each at its address.
const swap = (out, what, re, to) => {
  if (!re.test(out)) throw new Error(`build.mjs: no ${what} in page.html to fill in for the site pages`);
  return out.replace(re, () => to);
};
for (const page of SITE_PAGES) {
  const url = `${canonicalUrl}${page.path}`;
  let out = html;
  out = swap(out, "<title>", /<title>[^<]*<\/title>/, `<title>${page.title}</title>`);
  out = swap(out, "description", /<meta name="description" content="[^"]*"/, `<meta name="description" content="${page.description}"`);
  out = swap(out, "canonical", /<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`);
  out = swap(out, "og:url", /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`);
  out = swap(out, "og:title", /<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${page.title}"`);
  out = swap(out, "og:description", /<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${page.description}"`);
  out = swap(out, "twitter:title", /<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${page.title}"`);
  out = swap(out, "twitter:description", /<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${page.description}"`);
  out = swap(out, "structured data", /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n${JSON.stringify(sitePageJsonLd(page, canonicalUrl))}\n</script>`);
  out = swap(out, "page stylesheet", /<\/head>/, `<style>${SITE_PAGE_CSS}</style>\n</head>`);
  // The shell's <noscript> stands in for the app on the home page; here the page's own words already do,
  // and leaving both would give the page a second heading saying something else.
  out = swap(out, "noscript block", /<noscript>[\s\S]*?<\/noscript>\n?/, "");
  out = swap(out, "app root", /<div id="root"><\/div>/, `<div id="root">\n${sitePageBody(page)}\n</div>`);
  writeFileSync(`public/${page.file}`, out);
}

// Crawl files. Staging still allows crawling on purpose: a crawler has to fetch a page to see its
// noindex, and a robots.txt block would hide that. Only production gets a sitemap. Every screen of the app
// lives at "/", so the sitemap lists that plus the pages that answer for themselves (site-pages.mjs).
if (appEnv === "production" && canonicalUrl) {
  writeFileSync("public/robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${canonicalUrl}/sitemap.xml\n`);
  const today = new Date().toISOString().slice(0, 10);
  const urls = [`${canonicalUrl}/`, ...SITE_PAGES.map((p) => `${canonicalUrl}${p.path}`)];
  writeFileSync("public/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
} else {
  writeFileSync("public/robots.txt", "User-agent: *\nAllow: /\n");
  rmSync("public/sitemap.xml", { force: true });
}
console.log(`Built public/page.js and public/page.html (v${version}, ${appEnv}, ${siteUrl || "no SITE_URL"}, canonical ${canonicalUrl || "none"})`);
