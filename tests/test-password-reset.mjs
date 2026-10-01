// Forgetting a password, end to end in the real app. Until v2.19.1 there was no way back at all: the auth
// surface was signUp, signInWithPassword, the two providers, updateUser and signOut, and `resetPasswordForEmail`
// appeared nowhere in the repo. An email signup that lost its password lost the account - and with it every
// season, badge, coin and daily streak on it, none of which exist anywhere else the player can reach.
//
// Two halves, and the second is the one worth driving: asking for the link is easy to get right, and the
// recovery session that comes back is real in every other way, so without the PASSWORD_RECOVERY branch the
// player is silently signed in and never asked for the password they came to set.
import {
  setupDom, makeStorage, mount, flush, click, type, assert, runTest, findButtonByText, makeMockAuth,
} from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const sb = makeMockAuth();
window.__ps_supabase__ = sb;
const { container } = await mount();
await flush();

const panel = () => container.querySelector(".panel");
// The tabs and the submit button share text ("Create account" is on both in signup mode); only the tab
// carries role="tab". Same trick test-accounts.mjs uses.
const submitButton = (labelText) =>
  [...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes(labelText));
const field = (labelText) => {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(labelText));
  return label && label.querySelector("input");
};
// Waits for the control rather than assuming the render has settled, and names it when it never arrives -
// a null passed to click() dies inside the harness and says nothing about which step went wrong.
const tap = async (label, where) => {
  let el = findButtonByText(container, label);
  for (let i = 0; i < 20 && !el; i++) { await flush(); el = findButtonByText(container, label); }
  assert(el, `${where}: no "${label}" button. Panel says: ${(panel() || container).textContent.replace(/\s+/g, " ").slice(0, 260)}`);
  await click(el);
  await flush();
};
const openAccount = async () => {
  await dismissHowTo();
  const nav = findButtonByText(container, "Account");
  assert(nav, `the Account tab is reachable: ${container.textContent.replace(/\s+/g, " ").slice(-240)}`);
  await click(nav);
  await flush();
};
// The first-run rules dialog opens over everything the first time an account appears on a device, which is
// correct and is also in the way here. Dismiss it the way a player does.
const dismissHowTo = async () => {
  const got = findButtonByText(container, "Got it, let's draft");
  if (got) { await click(got); await flush(); }
};
// Both of these wait for the SCREEN to agree rather than for a fixed number of flushes: the signed-out
// handler does a lot of state work (it clears every draft slot), so a count that is enough today is a flake
// tomorrow. Signing in has to settle before signing out, or the profile read still in flight lands after the
// sign-out has cleared everything and the screen is left showing an account nobody is in.
const settleSignedIn = async () => {
  for (let i = 0; i < 25 && !findButtonByText(container, "Log out"); i++) await flush();
  assert(findButtonByText(container, "Log out"), "signed in, and the screen has caught up");
  await dismissHowTo();
};
const signOut = async () => {
  await settleSignedIn();
  await sb.auth.signOut();
  for (let i = 0; i < 25 && findButtonByText(container, "Log out"); i++) await flush();
  assert(!findButtonByText(container, "Log out"), "signed out, and the screen says so");
};

await runTest("a forgotten password has a way back at all", async () => {
  await openAccount();
  const back = findButtonByText(container, "Forgotten your password?");
  assert(back, `there is a way back in from the log in form: ${container.textContent.slice(0, 220)}`);
  await click(back);
  await flush();
  assert(!field("Password"), "the password field is gone - not having it is the whole situation");
  assert(submitButton("Email me a link"), "and the button asks for a link instead");
  assert(findButtonByText(container, "Back to log in"), "with a way out that is not the browser's Back");
});

await runTest("it never says whether an address is registered", async () => {
  // This form must not become a way to ask a game with a public leaderboard of usernames who is signed up.
  // Supabase deliberately answers the same either way; so must the screen in front of it.
  await type(field("Email"), "nobody-at-all@example.com");
  await click(submitButton("Email me a link"));
  await flush();
  const strangerSaid = container.textContent;
  assert(/Check your email/i.test(strangerSaid), `it answers: ${strangerSaid.slice(0, 160)}`);
  assert(!/no account|not found|doesn't exist|isn't registered|unknown/i.test(strangerSaid),
    `and nothing about whether that address has an account: ${strangerSaid.slice(0, 220)}`);

  // Back to the form by the button the screen offers, not by remounting: the panel keeps its own mode, so
  // this is also the path a real player takes after sending one by mistake.
  await tap("Back to log in", "after sending one");
  assert(field("Password"), "the password field is back on the log in form");

  // Now an address that really does exist, and the two answers have to read the same.
  await sb.auth.signUp({ email: "locked-out@x.test", password: "lockedout", options: { data: { username: "lockedout" } } });
  await signOut();
  await openAccount();
  await tap("Forgotten your password?", "the second time round");
  await type(field("Email"), "locked-out@x.test");
  await click(submitButton("Email me a link"));
  await flush();
  const memberSaid = container.textContent;

  const shape = (t) => t.replace(/nobody-at-all@example\.com|locked-out@x\.test/g, "<email>").replace(/\s+/g, " ");
  assert(shape(strangerSaid) === shape(memberSaid),
    "the two answers are word for word the same, which is the whole point of it");

  // And what was actually asked for. redirectTo has to be this origin, because that is what the Supabase
  // project's Redirect URLs allowlist holds - a per-environment dashboard setting the repo cannot carry.
  const asked = sb._resetRequests;
  assert(asked.length === 2, `both went out: ${JSON.stringify(asked.map((a) => a.email))}`);
  assert(asked[1].email === "locked-out@x.test", "for the address typed in");
  assert(asked[1].redirectTo === `${window.location.origin}/`, `coming back here: ${asked[1].redirectTo}`);
});

await runTest("following the link asks for a new password, and the new one is what works after", async () => {
  // The link lands back on the site and supabase-js reads the recovery session out of the address. That
  // session is real, so PASSWORD_RECOVERY is the only thing that tells this apart from an ordinary sign-in.
  assert(sb._followRecoveryLink("locked-out@x.test"), "the link resolves to that account");
  await flush();
  await flush();
  assert(/Set a new password/i.test(container.textContent),
    `the app asks for one: ${container.textContent.slice(0, 220)}`);
  assert(container.querySelector("[role=dialog]"), "in a dialog, like the other things auth has to ask");

  // The same floor signing up uses, so the two forms cannot disagree about what a password is.
  await type(field("New password"), "123");
  await type(field("Confirm password"), "123");
  await click(findButtonByText(container, "Save password"));
  await flush();
  assert(/at least 6 characters/i.test(container.textContent), "a short one is refused");

  await type(field("New password"), "brand-new-pw");
  await type(field("Confirm password"), "different-pw");
  await click(findButtonByText(container, "Save password"));
  await flush();
  assert(/don't match/i.test(container.textContent), "and a mistyped confirmation");

  await type(field("New password"), "brand-new-pw");
  await type(field("Confirm password"), "brand-new-pw");
  await click(findButtonByText(container, "Save password"));
  await flush();
  await flush();
  assert(!/Set a new password/i.test(container.textContent), "a good one closes it");

  // The part that actually matters. Anything short of this is a form that merely looks like it worked.
  await signOut();
  const oldOne = await sb.auth.signInWithPassword({ email: "locked-out@x.test", password: "lockedout" });
  assert(oldOne.error, `the old password no longer works: ${JSON.stringify(oldOne.error || null)}`);
  const newOne = await sb.auth.signInWithPassword({ email: "locked-out@x.test", password: "brand-new-pw" });
  assert(!newOne.error, `and the new one does: ${JSON.stringify(newOne.error || null)}`);
  // The same account throughout - a reset that quietly made a new one would lose every season on it, which
  // is exactly what the player was trying to avoid.
  assert(newOne.data?.user?.id, "signing in lands on an account");
  await signOut();
});

await runTest("the dialog can be dismissed, and dismissing it breaks nothing", async () => {
  // Deliberately closable: the recovery session is real, so closing leaves them signed in with their old
  // password still working. Refusing to close would trap anyone who followed the link out of curiosity.
  await sb.auth.signUp({ email: "curious@x.test", password: "curiouspw", options: { data: { username: "curious" } } });
  await signOut();
  assert(sb._followRecoveryLink("curious@x.test"), "they follow the link");
  await flush();
  await flush();
  assert(/Set a new password/i.test(container.textContent), "and are asked");

  await tap("Not now", "dismissing the dialog");
  assert(!/Set a new password/i.test(container.textContent), "it closes");

  await signOut();
  const still = await sb.auth.signInWithPassword({ email: "curious@x.test", password: "curiouspw" });
  assert(!still.error, `and the password they already had still works: ${JSON.stringify(still.error || null)}`);
});

console.log("test-password-reset.mjs done");
