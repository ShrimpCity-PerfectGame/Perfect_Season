// Production build: bundles entry.jsx into public/page.js and copies the static page.html
// alongside it. A Node script (not a shell-substituted esbuild CLI flag) so the env-var
// injection works identically on Windows/PowerShell, macOS, Linux, and Vercel's build image.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";

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
// end of the share text. SITE_URL wins when set - that's how the custom domain is pinned. Otherwise
// Vercel's VERCEL_PROJECT_PRODUCTION_URL: this project's production domain (its custom domain once
// one is added, the *.vercel.app address until then), so staging names itself and production names
// itself with no per-environment config.
const siteUrl = (process.env.SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/+$/, "");
if (!siteUrl) console.warn("Warning: no SITE_URL - link previews get relative image paths and the share text has no link.");

await esbuild.build({
  entryPoints: ["entry.jsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  outfile: "public/page.js",
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
const html = readFileSync("page.html", "utf8")
  .replace("build/page.js", "page.js")
  .replace(/(["/])static\//g, "$1")
  .replaceAll("%SITE_URL%", siteUrl);
writeFileSync("public/page.html", html);
console.log(`Built public/page.js and public/page.html (v${version}, ${appEnv}, ${siteUrl || "no SITE_URL"})`);
