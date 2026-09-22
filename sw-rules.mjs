// What the service worker does with each request, as a plain function of the request and the site's own
// origin - so the rules can be checked without a service worker runtime (tests/test-pwa.mjs). service-worker.js
// is the only caller; build.mjs bundles the two into public/sw.js.
//
// The one rule that matters most: anything that isn't this site's own files is left alone. Every account,
// leaderboard, wallet and submit-run call goes to Supabase on another origin, and a cached answer to any of
// them would be a lie - a stale leaderboard, a balance that has already been spent, a season saved twice.

import { SITE_PAGE_PATHS } from "./site-paths.mjs";

// The faces the page asks for (page.html). Google serves the stylesheet from one host and the font files from
// another, both under URLs that change when the font does, so they can be kept as long as there's room.
export const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// The site's own files that never carry anything player-specific, so a stale copy is only ever last week's
// artwork. Everything else of ours (robots.txt, the sitemap) is the crawlers' business, not the app's.
const ASSET = /^\/(?:icon(?:-\d+|-maskable-\d+)?\.(?:png|svg)|favicon-\d+\.png|apple-touch-icon\.png|og\.png|site\.webmanifest)$/;

// The pages build.mjs writes a file for. Which one answers an address is decided by its PATH alone -
// everything else (a profile, a challenge link, a duel) is served the app's own shell - so that is what a
// page is stored under, with the query string dropped. See pageKey.
//
// Injected by build.mjs from site-pages.mjs's own list, not written out here: kept by hand, adding the
// per-format leaderboard or the Daily archive CLAUDE.md names as the next step would store that page's HTML
// under "/", and offline the home page, every challenge link and every profile would serve it instead of
// the game. It is imported from site-paths.mjs, which holds nothing but the addresses - site-pages.mjs
// also carries every word of the How to play steps and the privacy policy, and none of that belongs in a
// service worker. tests/test-pwa.mjs holds the two lists to each other.
const PAGE_PATHS = new Set(["/", ...SITE_PAGE_PATHS]);

// Whether a path names one of our own files rather than a screen. Usernames are [A-Za-z0-9_] and challenge
// and match codes are alphanumeric, so nothing the app routes has a dot in its last segment.
const isFile = (pathname) => pathname.slice(pathname.lastIndexOf("/") + 1).includes(".");

// Where a page is kept in the store. Keyed by the request itself, as it was, two things went wrong.
//
// The serious one: signing in with Google comes back to "/?code=<authorization code>" - Supabase's PKCE flow -
// and the worker wrote that address into Cache Storage, where it stayed until the next deploy threw the store
// away. The code is single-use, short-lived, and in the address bar and the history anyway; it is still a
// credential, and this site should not be the one filing a copy of it. The same goes for anything else that
// ever arrives in a query.
//
// The other: every distinct address was an entry of its own. Twenty shared challenge links meant twenty copies
// of the same shell, and nothing ever removed one - the store is only emptied when a new release replaces it.
//
// So: the path, without its query, if it is one of the four pages; the shell otherwise.
export function pageKey(request, origin) {
  let url;
  try { url = new URL(request.url, origin); } catch (e) { return null; }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return new URL(PAGE_PATHS.has(path) ? path : "/", origin).href;
}

// The bundle. Its name never changes between releases, so it is fetched fresh whenever there is a network:
// a season played on last week's bundle can be scored differently by submit-run, which ships with the current
// one (CLAUDE.md, "the client and the Edge Function must ship together").
export const BUNDLE = "/page.js";

// "page" and "bundle" are fetched first and only fall back to what's stored; "asset" and "font" are served
// from store and refreshed behind the player's back; null means the worker never touches the request.
export function planFor(request, origin) {
  if (request.method !== "GET") return null;
  let url;
  try { url = new URL(request.url, origin); } catch (e) { return null; }
  if (FONT_HOSTS.includes(url.host)) return "font";
  if (url.origin !== new URL(origin).origin) return null; // Supabase, and anything else out there
  // A page: the app itself, a profile, a challenge link, the rules, the leaderboard - every one of them is
  // the same shell, so any of them can stand in for another when there's no network.
  //
  // But only if it IS one. Somebody opening /icon.svg or /page.js in a tab of its own is a navigation too,
  // and since pages are stored under their path with the shell as the fallback, that put an image under the
  // "/" key - after which, offline, the home page and every challenge link and profile served the image
  // instead of the game. Such a request is left to the browser entirely (null, not "bundle" or "asset"):
  // it is a top-level navigation, so answering it from the store would be answering the wrong question,
  // and offline it is the browser's own error page rather than the shell.
  if (request.mode === "navigate") return isFile(url.pathname) ? null : "page";
  if (url.pathname === BUNDLE) return "bundle";
  if (ASSET.test(url.pathname)) return "asset";
  return null;
}
