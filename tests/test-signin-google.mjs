// Signing in with Google, from the app's side: the account arrives with no name, so it has no profile
// row either (migration-profiles.sql's handle_new_user), and the game asks for one before it will let the
// account be anything. The rules that refuse a name are the database's - tests/test-profile-data.mjs runs
// the same list through the real SQL and through the mock - so what's checked here is the flow: who the
// game thinks you are at each step, what it says when a name won't do, and that the account is complete
// (name, profile, welcome coins) the moment it isn't asking any more.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";
import { BLOCKED_WORDS_SEED } from "./mock-profile-data.mjs";

const BLOCKED = BLOCKED_WORDS_SEED.find((b) => b.match === "word").word;

let app = null;
let auth = null;
async function close() {
  if (!app) return;
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
async function open(mock = makeMockAuth()) {
  await close();
  setupDom("http://localhost/");
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  auth = mock;
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(4);
  return app.container;
}

async function until(cond, what, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}
const dialog = (c) => c.querySelector('[role="dialog"][aria-labelledby="pickname-title"]');
const nameField = (c) => dialog(c)?.querySelector("input");
const errorIn = (c) => dialog(c)?.querySelector(".err")?.textContent || "";
const signedInAs = (c) => c.querySelector(".whoami .whoname")?.textContent || null;
const tab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
// The same tab either way: it says Account to a guest and Profile to whoever is signed in.
const accountTab = (c) => tab(c, "Account") || tab(c, "Profile");
// The account the mock's Google gives back, and what the database would hold for it.
const profileOf = (id) => auth._profiles.get(id) || null;

// Signs in through the app's own button, the way a player does.
async function continueWithGoogle(c) {
  await click(accountTab(c));
  await flush(2);
  await click(findButtonByText(c, "Continue with Google"));
  await flush(6);
}
async function claim(c, name) {
  await type(nameField(c), name);
  await click(findButtonByText(dialog(c), "That's my name"));
  await flush(6);
}

await runTest("a first Google sign-in asks for a name before the account is anything", async () => {
  const c = await open();
  assert(!dialog(c), "nothing is asked of a guest");
  await continueWithGoogle(c);
  assert(dialog(c), () => `the name is asked for, got: ${text(c).slice(0, 160)}`);
  assert(!signedInAs(c), "and until it's answered the game doesn't show anyone as signed in");
  assert(auth._profiles.size === 0, "no profile exists yet, so the account is on no board and owns nothing");
  assert(text(dialog(c)).includes("google@example.com"), `the dialog says which account it is, got: ${text(dialog(c)).slice(0, 120)}`);
});

await runTest("a name the database won't take is refused, with a reason, and nothing is created", async () => {
  const c = await open();
  auth._profiles.set("someone", { id: "someone", username: "Taken_Name" });
  await continueWithGoogle(c);

  await claim(c, "ab");
  assert(/3 to 16/.test(errorIn(c)), `too short says the rule, got: ${errorIn(c)}`);
  await claim(c, `${BLOCKED}_99`);
  assert(/isn't allowed/.test(errorIn(c)), `a blocked word says so, got: ${errorIn(c)}`);
  await claim(c, "Taken_Name");
  assert(/taken/i.test(errorIn(c)), `a name in use says so, got: ${errorIn(c)}`);
  assert(dialog(c), "the dialog stays up through all of it");
  assert(auth._profiles.size === 1, "and none of those attempts created an account");
});

await runTest("a name it will take completes the account: profile, welcome coins, and in you go", async () => {
  const c = await open();
  await continueWithGoogle(c);
  await claim(c, "Gridiron_Sam");
  assert(!dialog(c), () => `the dialog goes, got: ${text(c).slice(0, 160)}`);
  await flush(4);
  assert(signedInAs(c) === "Gridiron_Sam", () => `and the header shows the name, got ${signedInAs(c)}`);
  const id = [...auth._profiles.keys()][0];
  assert(profileOf(id)?.username === "Gridiron_Sam", "the profile is the one the database made");
  assert(auth._wallet.balanceOf(id) === 250, `with the welcome coins, got ${auth._wallet.balanceOf(id)}`);
});

await runTest("the same Google account comes straight back in, with no questions", async () => {
  const c = await open();
  await continueWithGoogle(c);
  await claim(c, "Second_Time");
  await flush(4);
  assert(signedInAs(c) === "Second_Time", "signed in the first time");

  // Sign out, then back in with the same address: the account has a name now, so nothing is asked.
  await click(accountTab(c));
  await until(() => findButtonByText(c, "Log out"), () => `the profile's Log out, got: ${text(c).slice(0, 160)}`);
  await click(findButtonByText(c, "Log out"));
  await flush(6);
  assert(!signedInAs(c), "signed out");
  await continueWithGoogle(c);
  assert(!dialog(c), () => `nothing is asked the second time, got: ${text(c).slice(0, 160)}`);
  assert(signedInAs(c) === "Second_Time", () => `and it's the same account, got ${signedInAs(c)}`);
});

await runTest("signing out of the dialog leaves a guest, not a half-made account", async () => {
  const c = await open();
  await continueWithGoogle(c);
  assert(dialog(c), "the name is asked for");
  await click(findButtonByText(dialog(c), "Sign out"));
  await flush(4);
  assert(!dialog(c) && !signedInAs(c), () => `a guest again, got: ${text(c).slice(0, 160)}`);
  assert(auth._profiles.size === 0, "and nothing was left behind");
});

await runTest("an account that already has a name is never asked for one", async () => {
  const mock = makeMockAuth();
  // The account exists with its name before Google hands the session over, which is every account that
  // signed up with an email, and every Google account after its first time.
  await mock.auth.signUp({ email: "has-an-account@example.com", password: "Password1", options: { data: { username: "Email_Player" } } });
  await mock.auth.signOut();
  const c = await open(mock);
  const { act } = await import("react-dom/test-utils");
  await act(async () => { auth._googleSignIn("has-an-account@example.com"); });
  await flush(8);
  assert(!dialog(c), () => `no dialog for an account that has a name, got: ${text(c).slice(0, 160)}`);
  assert(signedInAs(c) === "Email_Player", () => `it signs straight in, got ${signedInAs(c)}`);
});

await runTest("coming back from Google without signing in says so, and tidies the address", async () => {
  await close();
  setupDom("http://localhost/?error=access_denied&error_description=The+user+denied+the+request");
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(6);
  const c = app.container;
  assert(/didn't finish/.test(text(c)) && /denied the request/.test(text(c)), () => `the game says what happened, got: ${text(c).slice(0, 200)}`);
  assert(window.location.pathname === "/" && !window.location.search, `the address is tidied, got ${window.location.pathname}${window.location.search}`);
  assert(!dialog(c), "and nobody is asked to pick a name");
});

await close();
