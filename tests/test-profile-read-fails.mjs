// What the app does when reading a profile simply doesn't work.
//
// `fetchProfile` returned `rowToProfile(data)` and threw the error away, so "the read failed" and "this
// account has no profile row" were the same value: `null`. Both are real states - an account signed in
// with Google has no profile until it claims a name (PROFILES.md) - and confusing them cost three
// separate lockouts. postgrest-js retries a GET only on a dropped connection or a 503/520, so a 500,
// 502, 504 or 429 arrives as a plain error, and so does any outage lasting past its ~7s of backoff.
//
// `_failReads("profiles", n)` makes the next n reads fail the way PostgREST reports a 500: an error with
// no PGRST116 on it.
//
// Two of the three are here. The third - a failed read during login, which turned the username into ""
// and so made every `if (user)` in the app read as nobody being signed in - shares the same one-line
// cause and the same fix, but I could not find an assertion that tells the broken state from the fixed
// one through the DOM: both end up on the Account tab, because "" is falsy either way. It is covered by
// the contract fetchProfile now has, not by a test of its own.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, makeMockAuth,
} from "./helpers.mjs";

// The nav tab specifically - "Account" also appears on "Create account" and in the footer, so a
// plain text search clicks the wrong thing and lands you somewhere harmless-looking.
const navTab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
const accountTab = (c) => navTab(c, "Account") || navTab(c, "Profile");
const panel = (c) => c.querySelector(".panel");

let mounted = null;
async function app(mock) {
  // Tear the previous one down first, the way tests/test-guest-accounts.mjs does - setupDom replaces
  // the document underneath, and a React root still pointing at the old one renders into nothing.
  if (mounted) {
    const { act } = await import("react-dom/test-utils");
    await act(async () => { mounted.reactRoot.unmount(); });
    mounted = null;
  }
  setupDom("http://localhost/");
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  window.__ps_supabase__ = mock;
  mounted = await mount();
  await flush(4);
  return mounted.container;
}

// adoptSession gives a failed read a second go after 600ms of REAL time, which flush() does not
// advance - so a test that only flushes is looking at the screen while it is still deciding.
async function settled(times = 4) {
  await new Promise((r) => setTimeout(r, 900));
  await flush(times);
}

async function anAccount(mock, username) {
  const c = await app(mock);
  await click(accountTab(c));
  await flush();
  await click(findButtonByText(panel(c), "Create account"));
  await flush();
  const [email, u, p, p2] = [...panel(c).querySelectorAll("input")];
  await type(email, `${username}@example.com`);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...panel(c).querySelectorAll("button")]
    .find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await flush(6);
  return c;
}

await runTest("a failed read does not raise the un-dismissable name dialog on a named account", async () => {
  const mock = makeMockAuth();
  await anAccount(mock, "Named");
  // Signed in with a profile. Now every read fails, and the session is adopted again - which is what
  // happens on every page load and every time the tab is brought back to the front.
  mock._failReads("profiles", 100000);
  const c = await app(mock);
  await settled(6);

  // PickName has no close button, no Escape and no backdrop click, and claim_username answers
  // `already_named` to an account that already has one - so raising it here was a dead end.
  const shown = text(c);
  assert(!/Pick your name|pick a name/i.test(shown),
    `no name dialog for an account that has one, got: ${shown.slice(0, 260)}`);
  assert(/didn't load|didn.t load/i.test(shown), `it says so instead, got: ${shown.slice(0, 260)}`);
});

await runTest("a guest that has kept its seasons stops being a guest even if the re-read fails", async () => {
  const mock = makeMockAuth();
  const c = await app(mock);
  // A guest, made the way finishing a season makes one.
  await mock.auth.signInAnonymously();
  // Wait for the app to actually adopt it - the tab only says "Profile" once it has.
  for (let i = 0; i < 40 && !navTab(c, "Profile"); i++) await flush(2);
  const uid = [...mock._profiles.keys()][0];
  assert(mock._profiles.get(uid).guest === true, "started as a guest");
  assert(navTab(c, "Profile"), `the guest is signed in, got: ${text(c).slice(-200)}`);

  await click(accountTab(c));
  for (let i = 0; i < 40 && !findButtonByText(c, "Keep my seasons"); i++) await flush(2);
  assert(findButtonByText(c, "Keep my seasons"), `the keep panel is up, got: ${text(c).slice(-200)}`);
  const fields = [...panel(c).querySelectorAll("input")];
  assert(fields.length >= 3, `with its three fields, got ${fields.length}`);
  await type(fields[0], "kept@example.com");
  await type(fields[1], "Password1");
  await type(fields[2], "Kept_Name");
  // The trade-up itself works; only the re-read afterwards fails.
  mock._failReads("profiles", 100000);
  await click(findButtonByText(c, "Keep my seasons"));
  await settled(8);

  // The database has already done it...
  const row = mock._profiles.get(uid);
  assert(row.username === "Kept_Name" && row.guest === false,
    `the account is no longer a guest: ${JSON.stringify({ u: row.username, g: row.guest })}`);
  // ...and the app has to agree, or it keeps refusing the daily, the shop and Duel under the new name,
  // while Keep my seasons can only ever answer `already_named` on a second press.
  assert(!/Keep your seasons/i.test(text(c)),
    `and stops asking, got: ${text(c).slice(0, 260)}`);
});

console.log("test-profile-read-fails.mjs done");
