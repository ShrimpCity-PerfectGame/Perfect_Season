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
const { captchaToken, captchaConfigured, captchaReasonForCode } = await loadModule("captcha.mjs");
const storage = await loadModule("storage.js");

await runTest("with no site key it does nothing at all, which is how it ships first", async () => {
  // The test bundle defines no CAPTCHA_SITE_KEY, exactly as a build with none does - the `typeof` guard in
  // captcha.mjs is what makes an undefined identifier mean "off" rather than a ReferenceError at load.
  assert(captchaConfigured() === false, "it reports itself unconfigured");

  const before = document.querySelectorAll("script").length;
  const { token, reason } = await captchaToken();
  assert(token === null, `and hands back no token: ${JSON.stringify(token)}`);
  // "off" is not a failure and must never become one: it is how this ships before the switch is thrown, and
  // storage.js carries on without a token rather than refusing the call.
  assert(reason === "off", `and says why, so nobody reads it as a failure: ${JSON.stringify(reason)}`);
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

// ---------------------------------------------------------------------------------------------------------
// Three ways to have no token, and only one of them is the player's to fix (v2.20.4). Written from what the
// live rollout actually produced rather than from what the codes might be: Cloudflare answered 600010 - "bot
// behavior detected" - to an automated browser within minutes of staging's widget going live, and "turn off
// any ad blocker" is the wrong thing to tell someone it has flagged wrongly. They have none to turn off.
await runTest("a refusal, a block and a misconfiguration are told apart", async () => {
  // Cloudflare's own error-code table, quoted in captcha.mjs. The sitekey and domain codes are the ones it
  // marks "Retry: No", and they are the owner's mistake rather than anything the visitor did.
  for (const code of ["110100", "110110", "110200", "400020", "400021", "400070"]) {
    assert(captchaReasonForCode(code) === "misconfigured", `${code} is ours to fix, got ${captchaReasonForCode(code)}`);
  }
  assert(captchaReasonForCode("200500") === "blocked", "an iframe that could not load is a block");
  // The ones that mean "bot behavior detected", including the real code off the live site.
  for (const code of ["600010", "600", "300030", "110600", "110620"]) {
    assert(captchaReasonForCode(code) === "refused", `${code} is a refusal, got ${captchaReasonForCode(code)}`);
  }
  // An unknown code must land somewhere honest rather than throw or blame an ad blocker.
  assert(captchaReasonForCode(undefined) === "refused", "no code at all still answers");
});

await runTest("and each one reaches the player as different advice", async () => {
  // storage.js's own sentences, asked for rather than copied here: a test that asserts on strings it wrote
  // itself proves only that it can write strings, and that is the exact shape that let v2.20.1 ship a
  // sentence no screen ever showed. This goes through mapAuthError too, which is the path a screen uses.
  const said = (reason) => storage.mapAuthError({ __captcha: true, __captchaReason: reason,
    message: storage.captchaSentence(reason) });

  assert(/ad blocker/i.test(said("blocked")), "a blocked script names the ad blocker, which is the one the player can act on");
  // The point of the whole release: a wrongly-flagged person must NOT be sent to turn off an ad blocker.
  assert(!/ad blocker/i.test(said("refused")), `a refusal does not blame an ad blocker: ${said("refused")}`);
  assert(/VPN|privacy browser/i.test(said("refused")), `it names what might actually be it: ${said("refused")}`);
  assert(!/ad blocker/i.test(said("misconfigured")), "and neither does our own mistake");
  assert(/on us/i.test(said("misconfigured")), `which says whose it is: ${said("misconfigured")}`);
  // All three still read as the same feature, so a player who sees two of them knows it is one thing.
  for (const r of ["blocked", "refused", "misconfigured"]) {
    assert(/anti-robot check/i.test(said(r)), `${r} names the feature: ${said(r)}`);
  }
});

await runTest("the real refusal Supabase sends is still translated", async () => {
  // Taken verbatim from the live staging project the first time the switch was thrown, rather than invented:
  // this is what a player gets if the client's token goes missing between here and there.
  const theirs = storage.mapAuthError({ message: "captcha protection: request disallowed (no captcha_token found)" });
  assert(/anti-robot/i.test(theirs) && !/Something went wrong/.test(theirs), `translated: ${theirs}`);
});

console.log("test-captcha.mjs done");
