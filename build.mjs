// Production build: bundles entry.jsx into public/page.js and copies the static page.html
// alongside it. A Node script (not a shell-substituted esbuild CLI flag) so the env-var
// injection works identically on Windows/PowerShell, macOS, Linux, and Vercel's build image.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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
  },
});

// page.html (used as-is for local dev, next to build/page.js) points at "build/page.js";
// public/ is flat, so page.js sits right next to it - rewrite the one path that differs
// rather than hand-maintain a second copy of the page.
const html = readFileSync("page.html", "utf8").replace("build/page.js", "page.js");
writeFileSync("public/page.html", html);
console.log(`Built public/page.js and public/page.html (v${version}, ${appEnv})`);
