// Profile links and addresses (1.11.0, PROFILES.md 7), through the whole app on the mock. Every username on
// the Leaderboard, the Stats boards and the Over/Under board opens that player's profile at /u/NAME; Back and
// Forward move between those screens without disturbing a draft or a challenge link; /u/NAME opens a
// profile on load, for guests too; and signup asks the database whether a username is allowed.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto,
  makeMockAuth, clickMode,
} from "./helpers.mjs";
import { runLogRow } from "../game-logic.mjs";

// The app's own day key (local time), for today's daily and Over/Under rows.
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// A player at the top of each board, each a different account, so a link that opened the wrong player shows.
function seedSite(auth) {
  const roster = [{ slot: "QB", name: "Tom Brady", season: 2007, team: "NE", ppr: 400, rating: 120 }];
  const account = (username, extra = {}) => {
    const id = `${username}-id`;
    auth._profiles.set(id, {
      id, username, runs: 1, dnf: 0, wins: 9, losses: 8, champs: 0, perfect: 0, playoffs: 0, recent: [],
      daily_streak: 0, daily_best_streak: 0, created_at: "2026-09-01T12:00:00.000Z", ...extra,
    });
    return id;
  };
  let clock = Date.UTC(2026, 8, 1);
  const logRun = (id, username, run) => {
    const row = runLogRow(id, username, { format: "fantasy", roster, date: (clock += 1000), ...run });
    auth._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, row);
  };
  account("topdog", { best_score: 120.5, best_run: { w: 20, l: 0, score: 120.5, roster }, best_record: { w: 20, l: 0 }, runs: 4, wins: 60, losses: 8, champs: 2, perfect: 1, playoffs: 3 });
  account("runnerup", { best_score: 110.2, best_run: { w: 17, l: 3, score: 110.2, roster }, best_record: { w: 17, l: 3 }, runs: 2, wins: 30, losses: 4, champs: 1, playoffs: 2 });
  account("laddergal", { points_unlimited: 9000 });
  const dan = account("dailydan");
  auth._dailyRuns.set(`${TODAY}:fantasy:${dan}`, { date: TODAY, format: "fantasy", user_id: dan, username: "dailydan", w: 15, l: 2, score: 99.9, outcome: "Lost in the divisional round" });
  account("winsking", { runs: 50, wins: 700, losses: 150 });
  account("champchaser", { runs: 45, wins: 400, losses: 365, champs: 40, playoffs: 20 });
  account("playoffpro", { runs: 45, wins: 500, losses: 265, champs: 3, playoffs: 44 });
  account("streaker", { runs: 3, wins: 20, losses: 31, daily_best_streak: 30 });
  account("sharpshooter", { runs: 3, wins: 51, losses: 0 });
  logRun(account("upsetkid"), "upsetkid", { w: 13, l: 7, score: 55.0, champ: true, playoffs: true });
  logRun(account("gmguru"), "gmguru", { w: 16, l: 4, score: 101.0, gm: true, playoffs: true });
  auth._builds.set("build-1", { id: "build-1", user_id: account("builder"), username: "builder", pos: "WR", overall: 140.0, filled: {} });
  const sou = account("souqueen");
  auth._souRuns.set(`${TODAY}:${sou}`, { date: TODAY, user_id: sou, username: "souqueen", score: 25 });
}

let app = null;
async function close() {
  if (!app) return;
  // Imported here, not at the top: react-dom must load after setupDom() (see tests/helpers.mjs).
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
// A fresh page at `url`, with How to play already seen. The previous page is unmounted first, so its
// listeners don't hear the shared mock's sign-ins.
async function open(url, auth, storage = makeStorage()) {
  await close();
  setupDom(url);
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(4);
  return app.container;
}

// `what` names the wait in the failure; a function is asked at the time, so it can say what was on screen.
async function until(cond, what, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}

const profileOf = (container) => container.querySelector("section.profile");
async function expectProfile(container, name, owner = false) {
  await until(() => profileOf(container)?.dataset.username === name,
    () => `${name}'s profile, got: ${profileOf(container)?.dataset.username ?? text(container).slice(0, 200)}`);
  assert(profileOf(container).dataset.owner === String(owner), `expected data-owner="${owner}" on ${name}'s profile, got ${profileOf(container).dataset.owner}`);
  assert(window.location.pathname === `/u/${name}`, `expected the address /u/${name}, got ${window.location.pathname}`);
}

// Back or Forward, as a browser does it: jsdom moves to the entry on a timer and fires popstate.
async function traverse(delta) {
  let popped = false;
  const onPop = () => { popped = true; };
  window.addEventListener("popstate", onPop);
  window.history.go(delta);
  for (let i = 0; i < 20 && !popped; i++) await flush(1);
  window.removeEventListener("popstate", onPop);
  assert(popped, `expected a popstate event after history.go(${delta})`);
  await flush(4);
}
const back = () => traverse(-1);
const forward = () => traverse(1);

async function signUp(container, email, username) {
  const panel = container.querySelector(".panel");
  await click(findButtonByText(panel, "Create account"));
  await flush();
  const [e, u, p, p2] = [...panel.querySelectorAll("input")];
  await type(e, email);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...panel.querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();
  await flush(4);
}
const tab = (container, label) => [...container.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));

const site = makeMockAuth();
seedSite(site);
const siteStorage = makeStorage();
siteStorage.data[`personal:ps-sou:${TODAY}`] = JSON.stringify({ score: 3 }); // today's Over/Under is done, so its board shows
let container = await open("http://localhost/", site, siteStorage);

await runTest("every name on the Leaderboard opens that player's profile, and Back returns to the board", async () => {
  await click(tab(container, "Leaderboard"));
  await flush(4);
  const table = (n) => [...container.querySelectorAll("table.lb")][n];
  const surfaces = [
    ["the best-ever card", () => container.querySelector(".champion .namelink"), "topdog"],
    ["the Top 10", () => table(0)?.querySelectorAll("tbody .namelink")[1], "runnerup"],
    ["today's daily board", () => table(1)?.querySelector("tbody .namelink"), "dailydan"],
    ["the points ladder", () => table(2)?.querySelector("tbody .namelink"), "laddergal"],
  ];
  for (const [where, find, name] of surfaces) {
    const link = find();
    assert(link?.textContent === name, `expected ${name} as a link on ${where}, got: ${link?.textContent}`);
    await click(link);
    await expectProfile(container, name);
    await back();
    assert(window.location.pathname === "/" && container.querySelector(".champion") && !profileOf(container), `Back from ${name} should return to the Leaderboard, got: ${text(container).slice(0, 200)}`);
    assert(tab(container, "Leaderboard").classList.contains("on"), "the Leaderboard tab is lit again");
  }
});

await runTest("every Stats board's names open profiles, and Back returns to Stats", async () => {
  await click(tab(container, "Stats"));
  await flush(4);
  const firstNameUnder = (heading) => {
    const h = [...container.querySelectorAll("h2.h")].find((x) => x.textContent === heading);
    for (let el = h?.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
      const link = el.querySelector(".namelink");
      if (link) return link;
    }
    return null;
  };
  const boards = [
    ["Best Fantasy lineups ever", "topdog"],
    ["🚨 Biggest Fantasy upsets", "upsetkid"],
    ["Most career wins", "winsking"],
    ["Most championships", "champchaser"],
    ["Most playoff appearances", "playoffpro"],
    ["Longest daily streak", "streaker"],
    ["Best win percentage", "sharpshooter"],
    ["Best Fantasy GM-mode score", "gmguru"],
    ["Highest-OVR created player", "builder"],
  ];
  for (const [heading, name] of boards) {
    const link = firstNameUnder(heading);
    assert(link?.textContent === name, `expected ${name} first on "${heading}", got: ${link?.textContent}`);
    await click(link);
    await expectProfile(container, name);
    await back();
    assert(window.location.pathname === "/" && firstNameUnder(heading)?.textContent === name, `Back from ${name} should return to Stats, got: ${text(container).slice(0, 200)}`);
  }
});

await runTest("the Over/Under board's names open profiles; Forward returns, and leaving a profile by a tab adds an entry", async () => {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Over/Under");
  await flush(4);
  const souLink = () => container.querySelector("table.lb .namelink");
  assert(souLink()?.textContent === "souqueen", `expected souqueen on today's Over/Under board, got: ${text(container).slice(0, 300)}`);
  await click(souLink());
  await expectProfile(container, "souqueen");
  await back();
  await until(() => souLink()?.textContent === "souqueen", "the Over/Under board back after Back");
  assert(window.location.pathname === "/", "the board's address is /");

  await forward();
  await expectProfile(container, "souqueen");
  await click(tab(container, "Modes"));
  await flush();
  assert(window.location.pathname === "/" && text(container).includes("Daily challenge"), "leaving a profile for a tab goes to / and shows that tab");
  await back();
  await expectProfile(container, "souqueen");
  await back();
  await until(() => souLink()?.textContent === "souqueen", "the Over/Under board, two entries back");
});

await runTest("an entry the app didn't write is read from its address", async () => {
  // A history entry with no screen of its own (a typed address, or an older page) still opens what its address names.
  window.history.pushState(null, "", "/u/runnerup");
  await back();
  await until(() => container.querySelector("table.lb .namelink"), "the Over/Under board");
  await forward();
  await expectProfile(container, "runnerup");
});

await runTest("a guest opening /u/NAME gets that profile, with or without a trailing slash or its capitals", async () => {
  container = await open("http://localhost/u/runnerup", site);
  await expectProfile(container, "runnerup", false);
  assert(tab(container, "Account") && !tab(container, "Account").classList.contains("on"), "a guest has the Account tab, not lit on someone else's profile");

  container = await open("http://localhost/u/runnerup/", site);
  await expectProfile(container, "runnerup", false); // the address loses its trailing slash

  container = await open("http://localhost/u/RunnerUp", site);
  await until(() => profileOf(container)?.dataset.username === "runnerup", "a case-insensitive match to open runnerup's profile");
});

await runTest("an unknown name shows the missing state, and an address that isn't a username shows Modes at /", async () => {
  container = await open("http://localhost/u/nosuchplayer", site);
  await until(() => container.querySelector(".profile-route")?.dataset.status === "missing", () => `the missing state, got: ${container.querySelector(".profile-route")?.dataset.status}`);
  assert(!profileOf(container), "no profile section for a player who doesn't exist");
  assert(window.location.pathname === "/u/nosuchplayer", "the address stays what was asked for");

  container = await open("http://localhost/u/x", site);
  assert(text(container).includes("Daily challenge") && window.location.pathname === "/", `expected Modes at /, got ${window.location.pathname}: ${text(container).slice(0, 200)}`);
});

await runTest("Share profile shares or copies the profile's address", async () => {
  container = await open("http://localhost/u/topdog", site);
  await expectProfile(container, "topdog");
  let copied = null;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => { copied = t; } }, configurable: true });
  await click(findButtonByText(profileOf(container), "Share profile"));
  await flush(3);
  assert(copied === "https://gridspin.test/u/topdog", `expected the profile's address copied, got: ${copied}`);

  let shared = null;
  Object.defineProperty(window.navigator, "share", { value: async (data) => { shared = data; }, configurable: true });
  await click(findButtonByText(profileOf(container), "Share profile"));
  await flush(3);
  assert(shared?.url === "https://gridspin.test/u/topdog", `expected the share sheet to get the address, got: ${JSON.stringify(shared)}`);
});

let linkerId = null;
await runTest("signing in on the Account tab shows your profile; your own name, the Profile tab and the header open it", async () => {
  container = await open("http://localhost/", site);
  await click(tab(container, "Account"));
  await flush();
  await signUp(container, "linker@example.com", "linker");
  await expectProfile(container, "linker", true);
  assert(text(container).includes("Log out"), "the owner view has Log out");
  assert(tab(container, "Profile").classList.contains("on"), "the Profile tab is lit on your own profile");
  assert(!findButtonByText(profileOf(container), "Reports"), "a player who isn't a moderator has no Reports entry");
  linkerId = [...site._profiles.values()].find((p) => p.username === "linker").id;

  Object.assign(site._profiles.get(linkerId), { best_score: 150.1, best_run: { w: 20, l: 0, score: 150.1, roster: [] }, best_record: { w: 20, l: 0 } });
  await click(tab(container, "Leaderboard"));
  await flush(4);
  const topRows = () => [...container.querySelectorAll("table.lb")][0].querySelectorAll("tbody tr");
  const mine = topRows()[0];
  assert(mine.classList.contains("me") && mine.querySelector(".namelink")?.textContent === "linker", `expected your own row first, got: ${mine.textContent}`);
  await click(mine.querySelector(".namelink"));
  await expectProfile(container, "linker", true);
  await back();
  await click([...topRows()].find((r) => r.textContent.includes("runnerup")).querySelector(".namelink"));
  await expectProfile(container, "runnerup", false);
  assert(!tab(container, "Profile").classList.contains("on"), "the Profile tab isn't lit on someone else's profile");

  await click(tab(container, "Profile"));
  await expectProfile(container, "linker", true);
  await back();
  await expectProfile(container, "runnerup", false);
  const whoami = container.querySelector(".whoami");
  assert(whoami?.getAttribute("aria-label") === "Your profile, linker", `the header keeps its label, got: ${whoami?.getAttribute("aria-label")}`);
  await click(whoami);
  await expectProfile(container, "linker", true);
});

await runTest("opening a profile mid-draft and coming back keeps the draft", async () => {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush(3);
  const card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
  await click(card.querySelector("button.hit"));
  await flush();
  await click(card.querySelector(".drafts button.btn.solid"));
  await flush(3);
  const code = container.querySelector(".seedline code")?.textContent;
  assert(code && text(container).includes("Pick 2 of 6"), "expected a draft one pick in");

  await click(container.querySelector(".whoami"));
  await expectProfile(container, "linker", true);
  assert(tab(container, "Draft").querySelector(".dot"), "the Draft tab marks the draft in progress");
  await back();
  assert(container.querySelector(".seedline code")?.textContent === code && text(container).includes("Pick 2 of 6"), `expected the same draft back, got: ${text(container).slice(0, 200)}`);

  await forward();
  await expectProfile(container, "linker", true);
  await click(tab(container, "Draft"));
  await flush();
  assert(container.querySelector(".seedline code")?.textContent === code && text(container).includes("Pick 2 of 6"), "the Draft tab brings the same draft back too");
  assert(site._profiles.get(linkerId).dnf === 0, `looking at a profile is never a DNF, got dnf=${site._profiles.get(linkerId).dnf}`);
  const saved = JSON.parse(window.storage.data["personal:ps-free-wip"] || "null");
  assert(saved?.history?.length === 1 && saved.mode.code === code, "the saved draft is untouched");
});

await runTest("a challenge link still offers its boards, resets the address to /, and survives a trip to a profile", async () => {
  container = await open("http://localhost/c/K3F9QZ?beat=7-10", site);
  assert(container.querySelector(".challenge")?.textContent.includes("K3F9QZ"), "expected the challenge card on Modes");
  assert(window.location.pathname === "/", `expected the address reset to /, got ${window.location.pathname}`);
  await click(tab(container, "Leaderboard"));
  await flush(4);
  await click(container.querySelector(".champion .namelink"));
  await expectProfile(container, "linker", true);
  await back();
  await click(tab(container, "Modes"));
  await flush();
  assert(container.querySelector(".challenge")?.textContent.includes("K3F9QZ"), "the challenge card is still waiting on Modes");
});

await runTest("signup refuses a taken or blocked username with the reason, and still takes a good one", async () => {
  const auth = makeMockAuth();
  auth._profiles.set("taken-id", { id: "taken-id", username: "takenname", runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] });
  const rpc = auth.rpc;
  auth.rpc = (name, args, opts) => {
    if (name === "check_username" && args?.p_username === "rudeword") return Promise.resolve({ data: "blocked", error: null });
    if (name === "check_username" && args?.p_username === "sneakyword") return Promise.resolve({ data: null, error: { message: "fetch failed" } });
    return rpc(name, args, opts);
  };
  container = await open("http://localhost/", auth);
  await click(tab(container, "Account"));
  await flush();
  const created = (name) => [...auth._profiles.values()].some((p) => p.username === name);

  await signUp(container, "rude@example.com", "rudeword");
  assert(container.querySelector(".err")?.textContent === "That username isn't allowed. Try another one.", `expected the blocked message, got: ${container.querySelector(".err")?.textContent}`);
  assert(!created("rudeword"), "a blocked name never reaches signup");

  await signUp(container, "taken@example.com", "takenname");
  assert(container.querySelector(".err")?.textContent === "That username is taken. Try another one.", `expected the taken message, got: ${container.querySelector(".err")?.textContent}`);

  // The check couldn't run, so signup goes ahead - and the signup trigger refuses the name.
  const signUpFn = auth.auth.signUp;
  auth.auth.signUp = async (args) => (args?.options?.data?.username === "sneakyword"
    ? { data: null, error: { status: 500, message: "Database error saving new user" } } : signUpFn(args));
  await signUp(container, "sneaky@example.com", "sneakyword");
  assert(container.querySelector(".err")?.textContent === "That username isn't allowed. Try another one.", `expected the trigger's refusal in words, got: ${container.querySelector(".err")?.textContent}`);
  auth.auth.signUp = signUpFn;

  await signUp(container, "good@example.com", "goodname");
  await expectProfile(container, "goodname", true);
});

await runTest("a moderator's own profile offers the Reports queue, and the header shows your picture", async () => {
  const auth = makeMockAuth();
  const storage = makeStorage();
  container = await open("http://localhost/", auth, storage);
  await click(tab(container, "Account"));
  await flush();
  await signUp(container, "mod@example.com", "modder");
  await expectProfile(container, "modder", true);
  const id = [...auth._profiles.values()].find((p) => p.username === "modder").id;
  assert(!findButtonByText(profileOf(container), "Reports"), "not a moderator yet");

  // Moderators are added in SQL, and checked when the session starts.
  auth._moderators.set(id, { user_id: id, added_at: new Date().toISOString() });
  auth._profileDetails.set(id, { user_id: id, bio: "", avatar_path: `${id}/1757800000000.webp`, avatar_preset: null, favorite_team: null, updated_at: new Date().toISOString() });
  container = await open("http://localhost/", auth, storage);
  await until(() => container.querySelector(".whoami img"), "the header picture");
  assert(container.querySelector(".whoami img").getAttribute("src") === `https://storage.mock/avatars/${id}/1757800000000.webp`, `expected the photo in the header, got: ${container.querySelector(".whoami img").getAttribute("src")}`);

  await click(tab(container, "Profile"));
  await expectProfile(container, "modder", true);
  await until(() => profileOf(container) && findButtonByText(profileOf(container), "Reports"), "the Reports entry on a moderator's own profile");
  await click(findButtonByText(profileOf(container), "Reports"));
  await until(() => text(container).includes("No open reports."), () => `the empty Reports queue, got: ${text(container).slice(0, 200)}`);
  assert(!profileOf(container), "the queue replaces the profile on screen");
  assert(window.location.pathname === "/" && tab(container, "Profile").classList.contains("on"), "the queue lives at / under the Profile tab");
  await back();
  await expectProfile(container, "modder", true);

  // Someone else's profile never offers it, even to a moderator.
  const other = "someone-id";
  auth._profiles.set(other, { id: other, username: "someone", runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] });
  container = await open("http://localhost/u/someone", auth, storage);
  await expectProfile(container, "someone", false);
  await flush(4);
  assert(!findButtonByText(profileOf(container), "Reports"), "a moderator visiting another profile gets no Reports entry");
});

await close();
console.log("test-profile-links.mjs done");
