// Builds the web bundle the Android app ships (Capacitor's webDir, capacitor.config.json). It is the same
// build.mjs the site runs, pointed at one environment, with page.html copied in as index.html - the app opens at
// "/" the way the site does, and every asset path is already root-relative, which is exactly what the web view
// serves.
//
//   node tools/app/build-app.mjs             the staging database, with the "Test site" banner
//   node tools/app/build-app.mjs production  the real one
//
// Which Supabase project each environment uses comes from the environment (SUPABASE_URL, SUPABASE_ANON_KEY) or
// from tools/app/env.local.json, which is gitignored. Both values are public - they ship inside every build of
// the site - but they're the owner's to hand out, so they stay out of the repo. The service_role key is never
// used here or anywhere a client can reach.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = process.argv[2] || "staging";
if (target !== "staging" && target !== "production") {
  console.error(`Usage: node tools/app/build-app.mjs [staging|production] (got ${JSON.stringify(target)})`);
  process.exit(1);
}

// The site's own address for share links and link previews: a test build must point at the test site, so a code
// shared from it opens the site that recorded it.
const SITE = { staging: "https://perfect-season-staging.vercel.app", production: "https://gridspin.app" };

const localFile = path.join(root, "tools/app/env.local.json");
const local = existsSync(localFile) ? JSON.parse(readFileSync(localFile, "utf8")) : {};
const supabaseUrl = process.env.SUPABASE_URL || local[target]?.url;
const supabaseKey = process.env.SUPABASE_ANON_KEY || local[target]?.anonKey;
if (!supabaseUrl || !supabaseKey) {
  console.error(`No Supabase settings for ${target}. Set SUPABASE_URL and SUPABASE_ANON_KEY, or fill in tools/app/env.local.json:`);
  console.error(`  { "${target}": { "url": "https://<ref>.supabase.co", "anonKey": "<the anon key, the one in the site's bundle>" } }`);
  process.exit(1);
}
if (/service_role/.test(supabaseKey)) {
  console.error("That looks like the service_role key. Only the anon key belongs in a build.");
  process.exit(1);
}

const env = {
  ...process.env,
  // The app's own entry: the same game, plus the hardware Back button and Android's share sheet.
  APP_ENTRY: "entry-app.jsx",
  APP_ENV: target,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: supabaseKey,
  SITE_URL: SITE[target],
  CANONICAL_URL: SITE[target],
};
execFileSync(process.execPath, ["build.mjs"], { cwd: root, env, stdio: "inherit" });

// public/ -> app/www, with page.html as the app's entry. robots.txt and the sitemap are for crawlers, and the
// service worker is the website's (it is how a browser installs the site and how it works offline) - an app
// serves all of this from the phone already. Everything else - the bundle, the icons, the manifest, the pages
// of their own - comes along.
const www = path.join(root, "app/www");
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(path.join(root, "public"), www, {
  recursive: true,
  filter: (src) => !/[\\/](robots\.txt|sitemap\.xml|sw\.js)$/.test(src),
});
const index = path.join(www, "index.html");
renameSync(path.join(www, "page.html"), index);

// The app draws under the status and gesture bars, so the page's own background reaches them and they take the
// colour of whatever screen you're on - the cream of Modes, the play screen's navy, the Leaderboard's black. That
// needs viewport-fit=cover, which also turns on the env(safe-area-inset-*) padding the stylesheet already carries
// (0 everywhere else). Only the app asks for it: on the website the same tag would push the page under an iPhone's
// notch for no gain. Asserted, like build.mjs's own swaps, so an edited meta tag fails the build instead of
// quietly shipping a page that sits under the clock.
const shell = readFileSync(index, "utf8");
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
if (!shell.includes(viewport)) {
  console.error(`Couldn't find the viewport tag in ${index} - has page.html changed?`);
  process.exit(1);
}
writeFileSync(index, shell.replace(viewport, viewport.replace("initial-scale=1", "initial-scale=1, viewport-fit=cover")));

const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
console.log(`Built app/www for the ${target} database (v${version}, ${SITE[target]}) - run "npx cap sync android" next.`);
