// What the service worker does with each request, as a plain function of the request and the site's own
// origin - so the rules can be checked without a service worker runtime (tests/test-pwa.mjs). service-worker.js
// is the only caller; build.mjs bundles the two into public/sw.js.
//
// The one rule that matters most: anything that isn't this site's own files is left alone. Every account,
// leaderboard, wallet and submit-run call goes to Supabase on another origin, and a cached answer to any of
// them would be a lie - a stale leaderboard, a balance that has already been spent, a season saved twice.

// The faces the page asks for (page.html). Google serves the stylesheet from one host and the font files from
// another, both under URLs that change when the font does, so they can be kept as long as there's room.
export const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// The site's own files that never carry anything player-specific, so a stale copy is only ever last week's
// artwork. Everything else of ours (robots.txt, the sitemap) is the crawlers' business, not the app's.
const ASSET = /^\/(?:icon(?:-\d+|-maskable-\d+)?\.(?:png|svg)|favicon-\d+\.png|apple-touch-icon\.png|og\.png|site\.webmanifest)$/;

// The bundle. Its name never changes between releases, so it is fetched fresh whenever there is a network:
// a season played on last week's bundle can be scored differently by submit-run, which ships with the current
// one (CLAUDE.md, "the client and the Edge Function must ship together").
export const BUNDLE = "/page.js";

// "page" and "bundle" are fetched first and only fall back to what's stored; "asset" and "font" are served
// from store and refreshed behind the player's back; null means the worker never touches the request.
export function planFor(request, origin) {
  if (request.method !== "GET") return null;
  // A page: the app itself, a profile, a challenge link, the rules, the leaderboard - every one of them is
  // the same shell, so any of them can stand in for another when there's no network.
  if (request.mode === "navigate") return "page";
  let url;
  try { url = new URL(request.url, origin); } catch (e) { return null; }
  if (FONT_HOSTS.includes(url.host)) return "font";
  if (url.origin !== new URL(origin).origin) return null; // Supabase, and anything else out there
  if (url.pathname === BUNDLE) return "bundle";
  if (ASSET.test(url.pathname)) return "asset";
  return null;
}
