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
// WHY there is no token, when there is none. Three different things wear the same shape - no token - and
// they do not want the same sentence, which is what v2.20.4 is for:
//
//   blocked      - the script never loaded. The player's own ad blocker or a proxy, and they can act on it.
//   refused      - the challenge ran and would not issue a token. Cloudflare judging the browser. Telling a
//                  wrongly-flagged person to turn off an ad blocker sends them to fix what was never wrong.
//   misconfigured- a bad sitekey or an unlisted domain. The OWNER's mistake; no player can do anything about
//                  it, and they should not be asked to.
//
// The codes come from Cloudflare's own table (developers.cloudflare.com/turnstile/troubleshooting/
// client-side-errors/error-codes/): 110*/400* are sitekey and domain problems, all marked "Retry: No";
// 200500 is the iframe failing to load; 300* and 600* are "bot behavior detected". A real 600010 off the
// staging site is what this was written from, not a guess at what the codes might be.
export function captchaReasonForCode(code) {
  const c = String(code == null ? "" : code);
  if (/^(110100|110110|110200|400020|400021|400070)/.test(c)) return "misconfigured";
  if (/^200500/.test(c)) return "blocked";
  return "refused";
}

// Answers `{ token, reason }`, never a bare string: `token` is null for every way of not having one, and
// `reason` says which way so the caller can say something true. `off` means no key is configured, which is
// not a failure at all - it is how this ships before the switch is thrown, and the caller carries on.
export async function captchaToken() {
  if (!SITE_KEY) return { token: null, reason: "off" };
  const turnstile = await loadScript();
  // The script did not load, or loaded without its API. Nothing ran, so this is the blocked case.
  if (!turnstile || typeof turnstile.render !== "function") return { token: null, reason: "blocked" };

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
    const done = (token, reason) => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve({ token: token || null, reason: token ? null : reason });
    };
    // The script loaded and the widget rendered, so a silent eight seconds is not an ad blocker: it is a
    // challenge that never answered. "refused" is the honest reading and the honest sentence.
    const timer = setTimeout(() => done(null, "refused"), TIMEOUT_MS);
    const finish = (token, reason) => { clearTimeout(timer); done(token, reason); };
    try {
      widgetId = turnstile.render(host, {
        sitekey: SITE_KEY,
        // Invisible unless Turnstile decides it needs to ask. This is the whole reason for the provider.
        appearance: "interaction-only",
        execution: "execute",
        callback: (token) => finish(token || null, "refused"),
        // The one place the code is readable at all. Returning true keeps Turnstile from drawing its own
        // error state in a container nobody can see.
        "error-callback": (code) => {
          // Printed rather than shown: a player should never read an internal code, but a report of "it
          // says it can't confirm my browser" is undiagnosable without one, and this goes nowhere but the
          // console - no third party, which is what the privacy policy promises.
          try { console.warn("[gridspin] anti-robot check failed:", code); } catch (e) { /* no console */ }
          finish(null, captchaReasonForCode(code));
          return true;
        },
        "expired-callback": () => finish(null, "refused"),
        "timeout-callback": () => finish(null, "refused"),
      });
      turnstile.execute(widgetId);
    } catch (e) {
      finish(null, "blocked");
    }
  });
}
