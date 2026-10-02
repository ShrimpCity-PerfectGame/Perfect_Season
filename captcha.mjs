// The CAPTCHA on sign-in, sign-up, password reset and - the one that matters here - the automatic guest
// account. CLAUDE.md has named this a pre-launch task since v1.17.0: a guest costs nothing to make, so
// anybody with a script can mint them freely, and every one counts toward Supabase's monthly active users as
// well as pushing the leaderboards about.
//
// **Cloudflare Turnstile, and the provider is not a toss-up.** Supabase supports hCaptcha and Turnstile, and
// only Turnstile has a mode that asks the player nothing. That is a requirement rather than a preference: the
// guest sign-in happens inside `postAsGuest`, after somebody has played a full seventeen-game season, with no
// form on screen to hang a challenge off. Making them solve a puzzle to have the season they just played
// counted is worse than the abuse it prevents. Turnstile runs invisibly for a plausible browser and only
// interrupts one it doubts.
//
// **It is inert until a site key exists**, and that is deliberate so the two halves can ship in the right
// order. Supabase's CAPTCHA setting is per project and covers every auth endpoint at once, so flipping it on
// before the client can send a token breaks every sign-in, signup, reset and guest account at the same
// moment. Ship this first (it does nothing without a key), then add the key and the switch. With no key there
// is no script, no request to Cloudflare and no token - byte for byte the behaviour before this file existed,
// which is also what keeps the tests and the UI harness offline.
const SITE_KEY = typeof CAPTCHA_SITE_KEY !== "undefined" ? CAPTCHA_SITE_KEY : "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// A challenge that never answers must not hold a sign-in open for ever: a blocked CDN, a corporate proxy or
// an ad blocker all look the same from here. Eight seconds is long enough for a slow phone and short enough
// that the player gets a sentence rather than a spinner.
const TIMEOUT_MS = 8000;

export const captchaConfigured = () => !!SITE_KEY;

let loading = null;
function loadScript() {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const el = document.createElement("script");
    el.src = SCRIPT;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(window.turnstile || null);
    // Never rejects. A missing challenge is a thing to report, not to throw through an auth call.
    el.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(el);
  });
  return loading;
}

// A token for one call. Tokens are single-use and short-lived, so this makes a fresh widget each time and
// takes it away afterwards rather than keeping one around - a reused token is refused, which would read to
// the player as "that didn't work" on a second attempt.
//
// Answers null for every way of not having one: no key configured, no browser, the script blocked, the
// challenge failed, or it took too long. The caller decides what that means; storage.js turns it into a
// sentence rather than passing undefined to Supabase.
export async function captchaToken() {
  if (!SITE_KEY) return null;
  const turnstile = await loadScript();
  if (!turnstile || typeof turnstile.render !== "function") return null;

  const host = document.createElement("div");
  // Off-screen rather than display:none - Turnstile declines to run in a container it cannot measure, and an
  // interactive challenge still needs somewhere to appear if it decides to ask.
  host.style.cssText = "position:fixed;left:-9999px;top:0;width:300px;height:65px";
  document.body.appendChild(host);

  let widgetId = null;
  const cleanUp = () => {
    try { if (widgetId !== null) turnstile.remove(widgetId); } catch (e) { /* already gone */ }
    try { host.remove(); } catch (e) { /* already gone */ }
  };

  return new Promise((resolve) => {
    let settled = false;
    const done = (token) => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(token);
    };
    const timer = setTimeout(() => done(null), TIMEOUT_MS);
    const finish = (token) => { clearTimeout(timer); done(token); };
    try {
      widgetId = turnstile.render(host, {
        sitekey: SITE_KEY,
        // Invisible unless Turnstile decides it needs to ask. This is the whole reason for the provider.
        appearance: "interaction-only",
        execution: "execute",
        callback: (token) => finish(token || null),
        "error-callback": () => { finish(null); return true; },
        "expired-callback": () => finish(null),
        "timeout-callback": () => finish(null),
      });
      turnstile.execute(widgetId);
    } catch (e) {
      finish(null);
    }
  });
}
