// Guests (v1.17.0): a visitor who finishes a season is signed in anonymously so that season can go on the
// leaderboard straight away, under a name the database gives them and a chip that says what they are. What
// such an account can't do is the daily - it can be made again and again, and the daily is one draft per
// account per day - or the shop, or a profile. What it can do is stop being one: an email and a name of its
// own, on the same account, so nothing it has played is left behind.
//
// The name rules and the trade-up are the database's, checked against the real SQL in
// tests/test-profile-data.mjs. What's checked here is the game: who posts, what's refused, what's shown.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, clickMode, assert, runTest, makeMockAuth,
} from "./helpers.mjs";

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
async function until(cond, what, rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}

const tab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
const accountTab = (c) => tab(c, "Account") || tab(c, "Profile");
const signedInAs = (c) => c.querySelector(".whoami .whoname")?.textContent || null;
const guestRow = (c) => [...c.querySelectorAll(".guestchip")].length;
const profileOf = (id) => auth._profiles.get(id) || null;
const theGuest = () => [...auth._profiles.values()].find((p) => p.guest) || null;

// A season, from the Modes screen to the result - the same way tests/test-shop-flow.mjs plays one.
async function draftFirstEligible(container) {
  let card = null;
  for (let i = 0; i < 10 && !card; i++) {
    await flush(1);
    card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
  }
  if (!card) throw new Error("no draftable player found");
  await click(card.querySelector("button.hit"));
  await flush();
  await click(card.querySelector(".drafts button.btn.solid"));
  await flush();
}
async function playSeason(container) {
  for (let round = 0; round < 6; round++) await draftFirstEligible(container);
  await flush(6);
  for (let i = 0; i < 8 && findButtonByText(container, "Skip to the end"); i++) {
    await click(findButtonByText(container, "Skip to the end"));
    await flush(4);
  }
  await until(() => container.querySelector(".result-hero .strip"), () => `the finished season, got: ${text(container).slice(0, 200)}`);
}
async function playUnlimited(container) {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush(3);
  await playSeason(container);
}

await runTest("a visitor who finishes a season is posted as a guest, without being asked for anything", async () => {
  const c = await open();
  assert(!signedInAs(c), "starts as nobody");
  await playUnlimited(c);
  await until(() => signedInAs(c), () => `the guest the season was posted as, got: ${text(c).slice(0, 200)}`);

  const row = theGuest();
  assert(row, "the database made an account for them");
  assert(/^Guest_[0-9A-F]{5}$/.test(row.username), `named as a guest, got ${row.username}`);
  assert(signedInAs(c) === row.username, `and the game says who they are, got ${signedInAs(c)}`);
  assert(row.runs === 1, `the season counted, got ${JSON.stringify({ runs: row.runs })}`);
  assert(/leaderboard as/i.test(text(c)), () => `the result screen says where it went, got: ${text(c).slice(0, 300)}`);
});

await runTest("a guest's name carries a chip on the leaderboard, and opens no profile", async () => {
  const c = await open();
  await playUnlimited(c);
  await until(() => signedInAs(c), "the guest");
  await click(tab(c, "Leaderboard"));
  await flush(8);
  await until(() => guestRow(c) > 0, () => `the guest's row on the board, got: ${text(c).slice(0, 300)}`);
  const name = theGuest().username;
  assert(text(c).includes(name), "the name is on the board");
  const links = [...c.querySelectorAll(".namelink")].map((b) => b.textContent);
  assert(!links.includes(name), `a guest's name isn't a link to a profile it doesn't have, got ${JSON.stringify(links)}`);
});

await runTest("the daily and the shop are for accounts, and say so", async () => {
  const c = await open();
  await playUnlimited(c);
  await until(() => signedInAs(c), "the guest");

  await click(tab(c, "Modes"));
  await until(() => findButtonByText(c, "Fantasy daily"), () => `the Modes tiles, got: ${text(c).slice(0, 200)}`);
  // The daily tile isn't one button: each format's daily is its own.
  await click(findButtonByText(c, "Fantasy daily"));
  await flush(4);
  assert(/one draft a day per account/i.test(text(c)), () => `the daily says it's for accounts, got: ${text(c).slice(0, 240)}`);
  assert(!c.querySelector(".card"), "and no daily board was dealt");
  assert(/Keep your seasons/i.test(text(c)), "and they're shown how to have one");
});

await runTest("the server refuses a guest's daily even when the app doesn't ask", async () => {
  // A real account plays the daily, and the submission the app sends is kept: it's a whole verified
  // season, the only kind submit-run accepts at all.
  const mock = makeMockAuth();
  await mock.auth.signUp({ email: "daily@example.com", password: "Password1", options: { data: { username: "Daily_Player" } } });
  const c = await open(mock);
  let sent = null;
  const invoke = auth.functions.invoke;
  auth.functions.invoke = (name, opts) => {
    if (name === "submit-run" && opts?.body?.mode?.kind === "daily") sent = opts.body;
    return invoke(name, opts);
  };
  await click(tab(c, "Modes"));
  await until(() => findButtonByText(c, "Fantasy daily"), () => `the daily, got: ${text(c).slice(0, 160)}`);
  await click(findButtonByText(c, "Fantasy daily"));
  await flush(4);
  await playSeason(c);
  await until(() => sent, () => `the daily the account sent, got: ${text(c).slice(0, 160)}`);

  // The same submission, from a guest: this is what a modified browser would try, and the answer is no.
  await auth.auth.signOut();
  const guest = await auth.auth.signInAnonymously();
  const uid = guest.data.user.id;
  const answer = await auth.functions.invoke("submit-run", { body: sent });
  // A refusal comes back the way storage.js reads one: the status, with the reason in the body.
  const body = await answer?.error?.context?.json?.().catch(() => null);
  const said = JSON.stringify({ status: answer?.error?.context?.status, body, data: answer?.data });
  assert(body?.reason === "guest_daily", `the daily is refused for a guest, got ${said.slice(0, 200)}`);
  assert(profileOf(uid).runs === 0, "and nothing is recorded for it");
  assert(auth._dailyRuns.size === 1, "the day's board still has only the account's own entry");
});

await runTest("a guest keeps its seasons: same account, own name, everything carried over", async () => {
  const c = await open();
  await playUnlimited(c);
  await until(() => signedInAs(c), "the guest");
  const before = theGuest();
  const uid = before.id;
  const coins = auth._wallet.balanceOf(uid);

  await click(accountTab(c));
  await until(() => findButtonByText(c, "Keep my seasons"), () => `the keep panel, got: ${text(c).slice(0, 200)}`);
  const [email, pw, username] = [...c.querySelectorAll(".panel input")];
  await type(email, "keeper@example.com");
  await type(pw, "Password1");
  await type(username, "Kept_It");
  await click(findButtonByText(c, "Keep my seasons"));
  await flush(8);

  const after = profileOf(uid);
  assert(after.username === "Kept_It" && after.guest === false, `the same account under its own name, got ${JSON.stringify({ u: after.username, g: after.guest })}`);
  assert(after.runs === before.runs, "the seasons it played are still there");
  assert(auth._wallet.balanceOf(uid) === coins, "so are the coins");
  await until(() => signedInAs(c) === "Kept_It", () => `the game shows the new name, got ${signedInAs(c)}`);
  assert(!/Keep your seasons/i.test(text(c)), "and stops asking");
});

// A guest has `user` set, so the header's Log in chip, the result screen's save panel and the
// profile's Log out are all hidden at once. That is fine until it is somebody who already HAS an
// account and simply played a season before signing in - on a new phone, say - at which point the app
// held no sign-in control anywhere, and the one thing left, Keep my seasons, refused their own email
// and their own username. The only ways out were clearing site data or guessing at their own /u/ address.
await runTest("a guest who already has an account can still reach it", async () => {
  const c = await open();
  await playUnlimited(c);
  await until(() => signedInAs(c), "the guest");

  await click(accountTab(c));
  await until(() => findButtonByText(c, "Keep my seasons"), "the keep panel");
  const out = [...c.querySelectorAll("button")].find((b) => /log in to it instead/i.test(b.textContent));
  assert(out, `the keep panel offers a way into an existing account, got: ${text(c).slice(0, 300)}`);

  // Taking it leaves the guest and lands on the ordinary sign-in, with a password field to use.
  await click(out);
  await flush(6);
  assert(!signedInAs(c), `no longer signed in as the guest, got ${signedInAs(c)}`);
  const inputs = [...c.querySelectorAll(".panel input")];
  assert(inputs.some((i) => i.type === "password"), `and the login form is up, got ${inputs.length} fields`);
});

await close();
