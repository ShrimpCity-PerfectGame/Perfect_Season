// The anti-robot check on sign-in, sign-up, password reset and the automatic guest account (captcha.mjs).
// CLAUDE.md has named this a pre-launch task since v1.17.0: a guest costs nothing to make, so a script can
// mint them freely, and every one counts toward Supabase's monthly active users as well as pushing the
// leaderboards about.
//
// The thing this file exists to hold is the ORDER the two halves ship in. Supabase's CAPTCHA setting is per
// project and covers every auth endpoint at once, so a switch flipped before the client can send a token
// breaks every sign-in, signup, reset and guest account at the same moment. The client therefore ships first
// and must be **completely inert** until a site key exists: no script, no request to Cloudflare, no token.
// That is what the first test checks, and it is the one that matters.
import { setupDom, loadModule, assert, runTest } from "./helpers.mjs";

setupDom();
const { captchaToken, captchaConfigured } = await loadModule("captcha.mjs");
const storage = await loadModule("storage.js");

await runTest("with no site key it does nothing at all, which is how it ships first", async () => {
  // The test bundle defines no CAPTCHA_SITE_KEY, exactly as a build with none does - the `typeof` guard in
  // captcha.mjs is what makes an undefined identifier mean "off" rather than a ReferenceError at load.
  assert(captchaConfigured() === false, "it reports itself unconfigured");

  const before = document.querySelectorAll("script").length;
  const token = await captchaToken();
  assert(token === null, `and hands back no token: ${JSON.stringify(token)}`);
  // The part that makes shipping it safe: nothing is fetched, so a player's browser talks to nobody new and
  // the privacy page's "no third-party scripts" stays true until the key is added.
  assert(document.querySelectorAll("script").length === before, "no script is added to the page");
  assert(!document.querySelector('script[src*="challenges.cloudflare.com"]'), "nothing is loaded from Cloudflare");
  // ...and nothing is left behind in the DOM either.
  assert(!document.querySelector('div[style*="-9999px"]'), "and no widget container is left in the page");
});

await runTest("every auth call Supabase protects goes through it", async () => {
  // Supabase's setting covers sign-in, sign-up, password reset and the anonymous sign-in together. A call
  // that cannot carry a token is a call that breaks the moment the switch is flipped, so the list has to be
  // complete - this reads storage.js itself rather than trusting that it was remembered.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../storage.js", import.meta.url), "utf8");
  for (const fn of ["authSignUp", "authSignIn", "authSignInAsGuest", "authResetPassword"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}(`));
    const end = body.indexOf("\n}");
    assert(/withCaptcha/.test(body.slice(0, end)), `${fn} asks for a token`);
  }
  // signInWithOAuth is deliberately NOT in that list: the page leaves for Google, which does its own
  // checking, and Supabase does not challenge the redirect.
  const oauth = src.slice(src.indexOf("export async function authSignInWithGoogle("));
  assert(!/withCaptcha/.test(oauth.slice(0, oauth.indexOf("\n}"))), "signing in with Google is not challenged");
});

await runTest("a challenge that will not answer becomes a sentence, not a silent failure", async () => {
  // When a key IS configured and the token comes back null - a blocked CDN, a proxy, an ad blocker - sending
  // the call anyway earns Supabase's own captcha refusal, which reaches the player as "Something went wrong"
  // and sends them looking for a problem with their password. mapAuthError says what actually happened.
  const said = storage.mapAuthError({ __captcha: true, message: "The anti-robot check didn't load. Turn off any ad blocker for this site and try again." });
  assert(/anti-robot check/i.test(said), `it says what failed: ${said}`);
  assert(/ad blocker/i.test(said), "and what to do about it");

  // And Supabase's own wording, whatever shape it arrives in.
  const theirs = storage.mapAuthError({ message: "captcha protection: request disallowed (invalid-input-response)" });
  assert(/anti-robot/i.test(theirs) && !/Something went wrong/.test(theirs),
    `their refusal is translated too: ${theirs}`);
});

console.log("test-captcha.mjs done");
