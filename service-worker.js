// The service worker, which is what makes gridspin.app installable - a browser only offers "Install app" for a
// site that can answer for itself with no network - and what lets a draft carry on through a dead spot on the
// train. build.mjs bundles this with sw-rules.mjs into public/sw.js and stamps BUILD_ID, so every deploy gets a
// store of its own and the one before it is thrown away. entry.jsx registers it; the Android app doesn't (it is
// already serving these files from the phone).
//
// What is never stored is in sw-rules.mjs: everything that isn't this site's own files, which is every call to
// Supabase. The pages and the bundle are always fetched when there is a network, and what's stored is only ever
// the fallback, so a player is never left running last week's game against this week's server.
import { BUNDLE, pageKey, planFor } from "./sw-rules.mjs";

const CACHE = `gridspin-${BUILD_ID}`;
// Enough to open the game with no network at all, from the first visit: the page, the bundle, and what a
// home-screen icon needs.
const SHELL = ["/", BUNDLE, "/site.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not leave the site without a worker at all, so they're added one by one.
    await Promise.all(SHELL.map((path) => cache.add(path).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Worth storing: our own files answered normally, and a font, which comes back opaque because the page asks
// for it without CORS. Anything else - a 404, a redirect to a login, an error page - is passed on and forgotten.
const worthStoring = (response, plan) =>
  response && (response.ok || (plan === "font" && response.type === "opaque"));

// A page is stored under its path with the query dropped (sw-rules.mjs's pageKey, which explains why);
// everything else under the request it came from.
const keyFor = (request, plan) => (plan === "page" ? pageKey(request, self.location.origin) || "/" : request);

// Storing happens on a copy and off to one side, through event.waitUntil, so the page is never kept waiting
// for it and the browser doesn't stop the worker halfway through.
async function store(request, response, plan) {
  if (!worthStoring(response, plan)) return;
  const cache = await caches.open(CACHE);
  await cache.put(keyFor(request, plan), response).catch(() => {});
}

// The network, with what's stored as the fallback. A page falls back to the shell as well, so a profile or a
// challenge link opened offline still starts the game rather than showing the browser's dinosaur.
async function fromNetwork(event, plan) {
  const request = event.request;
  try {
    const response = await fetch(request);
    event.waitUntil(store(request, response.clone(), plan));
    return response;
  } catch (e) {
    const stored = await caches.match(keyFor(request, plan));
    if (stored) return stored;
    // A page nobody has opened before - /privacy, say - still starts the game from the shell rather than
    // showing the browser's dinosaur.
    if (plan === "page") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw e;
  }
}

// What's stored, straight away, and a fresh copy fetched behind the player's back for next time.
async function fromStore(event, plan) {
  const request = event.request;
  const stored = await caches.match(request);
  const fetching = fetch(request)
    .then(async (response) => { await store(request, response.clone(), plan); return response; })
    .catch(() => null);
  event.waitUntil(fetching);
  if (stored) return stored;
  const fresh = await fetching;
  if (fresh) return fresh;
  throw new Error(`nothing stored for ${request.url}`);
}

self.addEventListener("fetch", (event) => {
  const plan = planFor(event.request, self.location.origin);
  if (!plan) return; // the browser handles it, exactly as if there were no worker
  event.respondWith(plan === "page" || plan === "bundle" ? fromNetwork(event, plan) : fromStore(event, plan));
});
