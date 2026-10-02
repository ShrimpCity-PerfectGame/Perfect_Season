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
import {
  setupDom, loadModule, assert, runTest, makeStorage, makeMockAuth, mount, flush, click, type, findButtonByText,
} from "./helpers.mjs";

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

// ---------------------------------------------------------------------------------------------------------
// The CALL SITES, which is the half v2.20.1 shipped without. Everything above holds the token and the
// sentence; none of it asks whether any SCREEN shows that sentence - and of the four calls withCaptcha wraps,
// only signup reached mapAuthError. The test above calls mapAuthError directly, which is exactly the shape
// CLAUDE.md warns about twice (the GM cap's two doors, and the names on Century's and Guess's boards): an
// assertion that touches no door passes while the door is shut.
//
// So these drive the real forms with the error storage.js hands them and read what the player is told. All
// of it is latent while there is no site key and live the moment one is set, which is why it is worth having
// before the key rather than after.

// What withCaptcha answers when the challenge will not answer. Built here rather than imported, because
// CAPTCHA_FAILED is module-private - the contract between storage.js and every screen is the SHAPE, an
// `__captcha` flag beside a sentence, and `SAID` keeps the two from drifting apart.
const BLOCKED = { __captcha: true, message: "The anti-robot check didn't load. Turn off any ad blocker for this site and try again." };
const SAID = storage.mapAuthError(BLOCKED);

window.storage = makeStorage();
const sb = makeMockAuth();
window.__ps_supabase__ = sb;
const { container } = await mount();
await flush();

const panel = () => container.querySelector(".panel");
// The tabs and the submit button share their text; only the tab carries role="tab". Same trick
// tests/test-accounts.mjs and tests/test-password-reset.mjs use.
const submitButton = (label) =>
  [...(panel()?.querySelectorAll("button") || [])].find((b) => !b.hasAttribute("role") && b.textContent.includes(label));
const field = (label) => {
  const l = [...container.querySelectorAll("label")].find((x) => x.textContent.trim().startsWith(label));
  return l && l.querySelector("input");
};
const openAccount = async () => {
  // The first-run rules dialog opens over everything; dismiss it the way a player does.
  const got = findButtonByText(container, "Got it, let's draft");
  if (got) { await click(got); await flush(); }
  const nav = findButtonByText(container, "Account");
  assert(nav, `the Account tab is reachable: ${container.textContent.replace(/\s+/g, " ").slice(-200)}`);
  await click(nav);
  await flush();
};
const shown = () => (panel() || container).textContent.replace(/\s+/g, " ");

await runTest("signing in names the challenge, instead of blaming a password that is right", async () => {
  await openAccount();
  const real = sb.auth.signInWithPassword;
  sb.auth.signInWithPassword = async () => ({ data: null, error: BLOCKED });
  try {
    await type(field("Email"), "someone@x.test");
    await type(field("Password"), "the-right-password");
    await click(submitButton("Log in"));
    await flush();
    // The failure mode this replaces: the player retypes the password, then resets a password they never
    // lost, and the reset screen tells them to check a connection that is fine.
    assert(!/Incorrect email or password/i.test(shown()), `it does not blame the password: ${shown().slice(0, 200)}`);
    assert(shown().includes(SAID), `it says what actually failed: ${shown().slice(0, 200)}`);
  } finally { sb.auth.signInWithPassword = real; }
});

await runTest("...and the vague wording is still there for every other refusal", async () => {
  // The point of "Incorrect email or password" is that it does not answer whether an address is registered
  // (v2.19.1). A captcha failure is not an answer about the address either, which is why naming it is safe -
  // but nothing else may become specific on the way past.
  const real = sb.auth.signInWithPassword;
  sb.auth.signInWithPassword = async () => ({ data: null, error: { message: "Invalid login credentials" } });
  try {
    await type(field("Email"), "someone@x.test");
    await type(field("Password"), "wrong-one");
    await click(submitButton("Log in"));
    await flush();
    assert(/Incorrect email or password/i.test(shown()), `the vague sentence survives: ${shown().slice(0, 200)}`);
    assert(!/anti-robot/i.test(shown()), "and nothing claims a challenge failed when none did");
  } finally { sb.auth.signInWithPassword = real; }
});

await runTest("asking for a reset link names it too, rather than the connection", async () => {
  const forgot = findButtonByText(container, "Forgotten your password?");
  assert(forgot, `the way to the reset form: ${shown().slice(0, 200)}`);
  await click(forgot);
  await flush();
  const real = sb.auth.resetPasswordForEmail;
  sb.auth.resetPasswordForEmail = async () => ({ data: null, error: BLOCKED });
  try {
    await type(field("Email"), "someone@x.test");
    await click(submitButton("Email me a link"));
    await flush();
    assert(!/Check your email/i.test(shown()), "it does not claim an email is on its way");
    assert(shown().includes(SAID), `it says what failed: ${shown().slice(0, 200)}`);
    assert(!/Check your connection/i.test(shown()), "and does not send them hunting a network fault");
  } finally { sb.auth.resetPasswordForEmail = real; }
});

await runTest("the fourth door is a guest's season, and this one is read rather than driven", async () => {
  // postAsGuest is reached only after a full seventeen-game season, which this file cannot afford to play -
  // tests/test-guest-accounts.mjs is where that flow lives. So this is a source check on purpose, and what it
  // holds is only that the door EXISTS; the three tests above hold what a player is actually told. The reason
  // it matters: "Make an account and it'll be saved" is the one piece of advice that cannot work when the
  // anti-robot check is what failed, because a signup carries a token through the same blocked widget.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../perfect-season.jsx", import.meta.url), "utf8");
  const from = src.indexOf("async function postAsGuest(");
  assert(from > 0, "postAsGuest is still called that");
  const body = src.slice(from, src.indexOf("\n  }", from));
  assert(/captchaSaid/.test(body), "postAsGuest names a blocked challenge instead of advising an account that fails the same way");
});

console.log("test-captcha.mjs done");
