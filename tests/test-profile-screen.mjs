// The profile screen (profile.jsx) on its own, in jsdom: who gets which controls, the loading/missing/
// error states, which sections show for which data, the badge grid, the editor's saves against the mock
// database functions, and the share status. PROFILES.md 6.3 is the contract.
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import {
  setupDom, loadModule, renderComponent, click, flush, text, selectOption, assert, runTest, makeMockAuth, findButtonByText, root,
} from "./helpers.mjs";
import { veteranProfile, rookieProfile, VETERAN_STATS_JSON } from "./fixtures/profile-fixture.mjs";
import { BADGES, badgeProgress, topBadges } from "../badges.mjs";
import { bioLength, mapPlayerStats, emptyPlayerStats } from "../profile-rules.mjs";

setupDom();
// Nothing here should reach a real network client: every screen gets the mock, signed in or not.
window.__ps_supabase__ = makeMockAuth();
const { act } = await import("react");
const { ProfileScreen, PROFILE_CSS } = await loadModule("profile.jsx");

// A spy: calls it was given, and what it returns.
function spy(result) {
  const fn = (...args) => { fn.calls.push(args); return typeof result === "function" ? result(...args) : result; };
  fn.calls = [];
  return fn;
}
const noop = () => {};
const baseProps = (over = {}) => ({
  status: "ok", profile: veteranProfile(), isOwner: false, userId: null, rank: { fantasy: null, standard: null }, moderator: null,
  onRetry: noop, onShare: async () => "copied", onDetailsSaved: noop, onLogOut: noop, onPlay: noop, onOpenReports: noop, ...over,
});

// One screen at a time: the previous render is unmounted first.
let shown = null;
async function show(Component, props) {
  if (shown) await act(async () => shown.reactRoot.unmount());
  shown = await renderComponent(Component, props);
  await flush();
  return shown.container;
}
const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const hasButton = (c, label) => buttons(c).includes(label);
const button = (c, label) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === label) || null;
const headings = (c) => [...c.querySelectorAll("h2")].map((h) => h.textContent.trim());
// helpers.mjs's type() is for <input>; a textarea's value setter lives on its own prototype.
async function typeArea(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
async function signedInMock(username) {
  const mock = makeMockAuth();
  window.__ps_supabase__ = mock;
  const { data } = await mock.auth.signUp({ email: `${username}@example.com`, password: "Password1", options: { data: { username } } });
  return { mock, userId: data.user.id };
}

await runTest("loading, missing and error states; Try again calls onRetry", async () => {
  let c = await show(ProfileScreen, baseProps({ status: "loading", profile: undefined }));
  assert(text(c).includes("Loading profile"), "expected the loading line, got: " + text(c));
  assert(!c.querySelector("section.profile"), "no profile section while loading");

  c = await show(ProfileScreen, baseProps({ status: "missing", profile: undefined }));
  assert(text(c).includes("There's no player with that name."), "expected the missing message, got: " + text(c));

  const onRetry = spy();
  c = await show(ProfileScreen, baseProps({ status: "error", profile: undefined, onRetry }));
  assert(text(c).includes("The profile didn't load."), "expected the error message, got: " + text(c));
  await click(button(c, "Try again"));
  assert(onRetry.calls.length === 1, "Try again should call onRetry once, got " + onRetry.calls.length);
});

await runTest("the owner gets Edit profile, Share profile and Log out, and no Report", async () => {
  const onLogOut = spy();
  const p = veteranProfile();
  const c = await show(ProfileScreen, baseProps({ profile: p, isOwner: true, userId: p.id, onLogOut }));
  const root = c.querySelector("section.profile");
  assert(root && root.dataset.username === "shrimpcity" && root.dataset.owner === "true", "expected the root hook with data-username and data-owner=true");
  for (const label of ["Edit profile", "Share profile", "Log out"]) assert(hasButton(c, label), `owner should see ${label}, got: ${buttons(c)}`);
  assert(!hasButton(c, "Report"), "the owner can't report themselves");
  assert(!buttons(c).some((b) => b.startsWith("Reports")), "no Reports button for a player who isn't a moderator");
  await click(button(c, "Log out"));
  assert(onLogOut.calls.length === 1, "Log out should call onLogOut");
});

await runTest("a moderator on their own profile gets the Reports button", async () => {
  const onOpenReports = spy();
  const p = veteranProfile();
  const c = await show(ProfileScreen, baseProps({ profile: p, isOwner: true, userId: p.id, moderator: { openReports: 3 }, onOpenReports }));
  const reports = button(c, "Reports (3)");
  assert(reports, "expected Reports (3), got: " + buttons(c));
  await click(reports);
  assert(onOpenReports.calls.length === 1, "Reports should call onOpenReports");
});

await runTest("a signed-in visitor gets Share profile and Report, which opens the report sheet", async () => {
  const c = await show(ProfileScreen, baseProps({ userId: "someone-else" }));
  assert(c.querySelector("section.profile").dataset.owner === "false", "a visitor's view is data-owner=false");
  assert(hasButton(c, "Share profile") && hasButton(c, "Report"), "expected Share profile and Report, got: " + buttons(c));
  for (const label of ["Edit profile", "Log out"]) assert(!hasButton(c, label), `a visitor shouldn't see ${label}`);
  // moderation.jsx owns the sheet's markup; anything of its md- classes, or a dialog, anywhere on the page.
  const sheet = () => document.querySelector('[class*="md-"], [role="dialog"]');
  assert(!sheet(), "the report sheet starts closed");
  await click(button(c, "Report"));
  assert(sheet(), "Report should open moderation.jsx's ReportSheet");
  assert(button(c, "Report").getAttribute("aria-expanded") === "true", "Report should say it's expanded");
  await click(button(c, "Report"));
  assert(!sheet(), "pressing Report again closes the sheet");
});

await runTest("a guest gets Share profile only", async () => {
  const c = await show(ProfileScreen, baseProps({ userId: null }));
  assert(hasButton(c, "Share profile"), "a guest can share");
  for (const label of ["Report", "Edit profile", "Log out"]) assert(!hasButton(c, label), `a guest shouldn't see ${label}, got: ${buttons(c)}`);
});

await runTest("a rookie: the owner is sent to the draft, a visitor sees no seasons yet", async () => {
  const onPlay = spy();
  const p = rookieProfile();
  let c = await show(ProfileScreen, baseProps({ profile: p, isOwner: true, userId: p.id, onPlay }));
  assert(text(c).includes("Play your first season to start your record."), "expected the first-season prompt, got: " + text(c).slice(0, 300));
  await click(button(c, "Go to the draft"));
  assert(onPlay.calls.length === 1, "Go to the draft should call onPlay");
  assert(hasButton(c, "Log out"), "the rookie owner can still log out");
  assert(JSON.stringify(headings(c)) === JSON.stringify(["Badges"]), "a rookie shows only the badges section, got: " + headings(c));
  assert(!c.querySelector(".tiles"), "no headline tiles without a draft");

  c = await show(ProfileScreen, baseProps({ profile: rookieProfile(), userId: "someone-else" }));
  assert(text(c).includes("No seasons yet."), "a visitor sees No seasons yet");
  assert(!hasButton(c, "Go to the draft") && !text(c).includes("Play your first season"), "the draft prompt is the owner's alone");
  assert(text(c).includes("Joined"), "the card says when a draftless account joined");
});

await runTest("a veteran shows every section, in the contract's order", async () => {
  const p = veteranProfile();
  const c = await show(ProfileScreen, baseProps({ profile: p, isOwner: true, userId: p.id, rank: { fantasy: 3, standard: 1 } }));
  const expected = ["Badges", "Seasons by wins", "By mode", "Best Fantasy lineup", "Best Championship lineup", "Go-to players", "Records", "Minigames", "Recent drafts"];
  assert(JSON.stringify(headings(c)) === JSON.stringify(expected), "section order: " + JSON.stringify(headings(c)));
  const kids = [...c.querySelector("section.profile").children];
  assert(kids[0].classList.contains("pf-card"), "the player card comes first");
  assert(kids[1].classList.contains("tiles"), "headline tiles come right after the card");
  assert(kids[kids.length - 1].textContent.trim() === "Log out", "the owner's Log out comes last");

  const card = c.querySelector(".pf-card");
  assert(card.textContent.includes("Kansas City Chiefs"), "the card shows the favorite team");
  assert(card.textContent.includes(p.details.bio), "the card shows the bio");
  assert(card.textContent.includes("Drafting since"), "the card shows Drafting since");
  const top = topBadges(badgeProgress({ stats: p.stats, extra: p.extra, details: p.details, joined: p.joined }), 3);
  assert(top.length === 3 && top.every((b) => card.textContent.includes(b.name)), "the card shows the three best badges: " + top.map((b) => b.name));
  const tiles = c.querySelector(".tiles").textContent;
  assert(tiles.includes("#3 sitewide") && tiles.includes("#1 sitewide"), "best score tiles carry the sitewide ranks, got: " + tiles);
  assert(text(c).includes("Randy Moss") && text(c).includes("Most-drafted team"), "go-to players and the most-drafted team show");
  assert(text(c).includes("Daily ladder") && !/\bBank\b/.test(text(c)), "records show the ladder totals, not the bank");
  assert(!/shop/i.test(text(c)), "no shop explainer");
  const chartBars = c.querySelectorAll(".pf-chart li");
  assert(chartBars.length === 21, "the wins chart has a bar slot for 0 to 20 wins, got " + chartBars.length);
  assert(c.querySelector(".pf-chart li.pf-perfect .pf-bar"), "the 20-win bar is drawn (the fixture has a perfect season)");
  const chartName = c.querySelector('[role="img"] .pf-chart')?.closest('[role="img"]').getAttribute("aria-label") || "";
  const counts = Object.fromEntries(p.extra.wins.map((r) => [r.w, r.n]));
  assert(chartName.startsWith("Seasons by wins: ") && chartName.includes(`12 wins, ${counts[12]} seasons`) && chartName.includes(`20 wins, ${counts[20]} season`),
    "the chart reads out every count, got: " + chartName);
  assert(!/(: |; )[0-4] wins?,/.test(chartName), "empty bars (the fixture has nothing under 5 wins) aren't read out, got: " + chartName);
  assert(c.querySelector(".pf-card .pf-team [role='img']")?.getAttribute("aria-label") === "Favorite team", "the team swatch says what the team is");
});

await runTest("sections with nothing to show are left out", async () => {
  const p = veteranProfile();
  const stats = { ...p.stats, bestRunStd: null, bestScoreStd: null, recent: [] };
  const extra = mapPlayerStats({ ...VETERAN_STATS_JSON, wins: [], over_under: { played: 0, best: null }, builds: { count: 0, best: null }, go_to_players: [], team_counts: [], by_ladder: [] });
  let c = await show(ProfileScreen, baseProps({ profile: { ...p, stats, extra } }));
  let h = headings(c);
  for (const gone of ["Best Championship lineup", "Seasons by wins", "Minigames", "Recent drafts", "Go-to players", "By mode"]) {
    assert(!h.includes(gone), `${gone} should be left out, got: ${h}`);
  }
  for (const kept of ["Badges", "Best Fantasy lineup", "Records"]) assert(h.includes(kept), `${kept} should still show, got: ${h}`);

  const bare = { ...p.stats, bestRecord: null, dailyBestStreak: 0, points: { daily: 0, unlimited: 0, genius: 0, gm: 0 } };
  c = await show(ProfileScreen, baseProps({ profile: { ...p, stats: bare, extra: mapPlayerStats(emptyPlayerStats()) } }));
  h = headings(c);
  assert(!h.includes("Records"), "no Records without a single record or ladder point, got: " + h);
  assert(h.includes("Badges"), "badges always show");
});

await runTest("the badge grid shows every badge, earned ones marked and locked ones with progress", async () => {
  const p = veteranProfile();
  const c = await show(ProfileScreen, baseProps({ profile: p }));
  const progress = badgeProgress({ stats: p.stats, extra: p.extra, details: p.details, joined: p.joined });
  const items = [...c.querySelectorAll(".pf-badge")];
  assert(items.length === BADGES.length, `expected all ${BADGES.length} badges, got ${items.length}`);
  for (const pr of progress) {
    const el = c.querySelector(`.pf-badge[data-badge="${pr.id}"]`);
    assert(el, "missing badge " + pr.id);
    assert(el.dataset.earned === String(pr.earned), `${pr.id} should be earned=${pr.earned}`);
    const shownProgress = el.querySelector(".pf-bp")?.textContent;
    if (!pr.earned && pr.need > 1) assert(shownProgress === `${pr.have}/${pr.need}`, `${pr.id} should show ${pr.have}/${pr.need}, got ${shownProgress}`);
    else assert(!shownProgress, `${pr.id} shouldn't show a count (earned, or a yes/no badge)`);
    // Screen readers get the same facts as the colors: the name, the tier and how far along it is.
    const b = BADGES.find((x) => x.id === pr.id);
    const said = pr.earned ? "earned" : pr.need > 1 ? `${pr.have} of ${pr.need}` : "not earned yet";
    const label = el.querySelector("button").getAttribute("aria-label") || "";
    assert(label.startsWith(b.name) && label.toLowerCase().includes(b.tier) && label.endsWith(said), `${pr.id}'s accessible name should say "${said}", got "${label}"`);
  }
  const earned = progress.filter((x) => x.earned).length;
  assert(earned > 0 && earned < BADGES.length, "the fixture should have a mix of earned and locked badges");
  assert(text(c).includes(`${earned} of ${BADGES.length}`), "the heading counts earned badges");

  // A badge opens its details (how to earn it) and closes again.
  const locked = progress.find((x) => !x.earned && x.need > 1);
  const stk = c.querySelector(`.pf-badge[data-badge="${locked.id}"] button`);
  await click(stk);
  const how = BADGES.find((b) => b.id === locked.id).how;
  assert(stk.getAttribute("aria-expanded") === "true" && text(c).includes(how), `opening ${locked.id} should show "${how}"`);
  assert(c.querySelector(".pf-bdetail").textContent.includes(`${locked.have} of ${locked.need}`), "the details say how far along it is");
  await click(stk);
  assert(!c.querySelector(".pf-bdetail"), "pressing it again closes the details");
});

await runTest("editor: live bio count, Save disabled over 160, and a save calls onDetailsSaved", async () => {
  const { mock, userId } = await signedInMock("shrimpcity");
  const onDetailsSaved = spy();
  const p = veteranProfile({ id: userId });
  const c = await show(ProfileScreen, baseProps({ profile: p, isOwner: true, userId, onDetailsSaved }));
  await click(button(c, "Edit profile"));
  const bio = c.querySelector("textarea");
  assert(bio && bio.value === p.details.bio, "the editor starts from the saved bio");
  // jsdom doesn't lay out the stylesheet, so check the rules themselves: iOS zooms into anything under 16px.
  for (const cls of ["pf-text", "pf-select"]) {
    const rule = new RegExp(`\\.${cls}\\{[^}]*font-size:16px`).test(PROFILE_CSS);
    assert(rule && c.querySelector(`.${cls}`), `.${cls} should be a 16px field`);
  }
  const count = () => c.querySelector(".pf-count").textContent;
  assert(count() === `${bioLength(p.details.bio)}/160`, "count starts at the bio's length, got " + count());
  const save = () => button(c, "Save");
  assert(save().disabled, "Save starts disabled with nothing changed");

  await typeArea(bio, "x".repeat(161));
  assert(count() === "161/160", "count follows typing, got " + count());
  assert(save().disabled, "Save is disabled over 160 characters");

  // 160 code points but 170 UTF-16 units: counted the way the database counts.
  const emojiBio = "🏈".repeat(10) + "y".repeat(150);
  await typeArea(c.querySelector("textarea"), emojiBio);
  assert(count() === "160/160" && !save().disabled, "an emoji counts once; 160 is allowed, got " + count());

  await typeArea(c.querySelector("textarea"), "Tight ends win titles.");
  await selectOption(c.querySelector("select"), "BUF");
  await click(save());
  await flush();
  assert(onDetailsSaved.calls.length === 1, "a save should call onDetailsSaved once, got " + onDetailsSaved.calls.length);
  const saved = onDetailsSaved.calls[0][0];
  assert(saved.bio === "Tight ends win titles." && saved.favoriteTeam === "BUF", "onDetailsSaved gets the saved details, got " + JSON.stringify(saved));
  assert(mock._profileDetails.get(userId)?.favorite_team === "BUF", "the save went through save_profile");
  assert(text(c).includes("Saved."), "the editor says it saved");
  assert(c.querySelector(".pf-card").textContent.includes("Buffalo Bills"), "the card shows the new favorite team straight away");
  assert(c.querySelector(".pf-card").textContent.includes("Tight ends win titles."), "the card shows the new bio straight away");
});

await runTest("editor: a favorite team on its own saves, and No favorite clears it", async () => {
  const { userId } = await signedInMock("teamonly");
  const onDetailsSaved = spy();
  const c = await show(ProfileScreen, baseProps({ profile: veteranProfile({ id: userId }), isOwner: true, userId, onDetailsSaved }));
  await click(button(c, "Edit profile"));
  const options = [...c.querySelectorAll("select option")];
  assert(options.length === 33 && options[0].textContent === "No favorite", "32 teams plus No favorite, got " + options.length);
  await selectOption(c.querySelector("select"), "");
  await click(button(c, "Save"));
  await flush();
  assert(onDetailsSaved.calls.at(-1)?.[0].favoriteTeam === null, "No favorite saves as null");
  assert(!c.querySelector(".pf-card .pf-team"), "the card drops the team");
});

await runTest("editor: a refused bio says the word isn't allowed", async () => {
  const { mock, userId } = await signedInMock("blocked");
  const realRpc = mock.rpc;
  mock.rpc = (name, args) => (name === "save_profile" ? Promise.resolve({ data: null, error: { message: "bio_blocked", code: "P0001" } }) : realRpc(name, args));
  const onDetailsSaved = spy();
  const c = await show(ProfileScreen, baseProps({ profile: veteranProfile({ id: userId }), isOwner: true, userId, onDetailsSaved }));
  await click(button(c, "Edit profile"));
  await typeArea(c.querySelector("textarea"), "something the filter refuses");
  await click(button(c, "Save"));
  await flush();
  assert(text(c).includes("That bio has a word we don't allow."), "expected the blocked-bio message, got: " + text(c).slice(0, 400));
  assert(onDetailsSaved.calls.length === 0, "a refused save doesn't call onDetailsSaved");
  assert(c.querySelector("textarea").value === "something the filter refuses", "the draft stays for editing");
});

await runTest("share status text for each onShare result", async () => {
  for (const [result, message] of [["shared", "Shared."], ["copied", "Link copied."], ["failed", "Couldn't share the link."]]) {
    const onShare = spy(async () => result);
    const c = await show(ProfileScreen, baseProps({ onShare }));
    const status = c.querySelector('[role="status"]');
    assert(status && status.textContent === "", "no status before sharing");
    await click(button(c, "Share profile"));
    await flush();
    assert(onShare.calls.length === 1, "Share profile calls onShare");
    assert(status.textContent === message, `"${result}" should read "${message}", got "${status.textContent}"`);
  }
});

// The picture saves go through avatar-picker.jsx's callbacks. The picker is agent D's component with its
// own buttons, so this bundles profile.jsx with a stand-in picker that hands its props to the test.
await runTest("editor: picture changes save through the picker's callbacks", async () => {
  const outfile = path.join(root, "build", "test-profile-screen-picker.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, "profile.jsx")], bundle: true, format: "esm", jsx: "automatic", platform: "browser", outfile,
    external: ["react", "react-dom", "react-dom/client"],
    define: { APP_VERSION: '"test"', APP_ENV: '"production"', APP_SITE_URL: '"https://gridspin.test"' },
    plugins: [{
      name: "picker-stand-in",
      setup(build) {
        build.onResolve({ filter: /avatar-picker\.jsx$/ }, () => ({ path: "picker", namespace: "stand-in" }));
        build.onLoad({ filter: /.*/, namespace: "stand-in" }, () => ({
          loader: "jsx",
          contents: "export const PICKER_CSS = ''; export function AvatarPicker(props) { globalThis.__picker = props; return <div className='ap-stand-in' />; }",
        }));
      },
    }],
  });
  const { ProfileScreen: Screen } = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  const { mock, userId } = await signedInMock("pictures");
  const oldPath = `${userId}/1757000000000.webp`;
  mock._storageObjects.set(`avatars/${oldPath}`, { bucket: "avatars", path: oldPath, contentType: "image/webp", size: 100, owner: userId });
  const base = veteranProfile({ id: userId });
  const profile = { ...base, details: { ...base.details, avatarPreset: null, avatarPath: oldPath, avatarUrl: "https://storage.mock/avatars/" + oldPath } };
  const onDetailsSaved = spy();
  const c = await show(Screen, baseProps({ profile, isOwner: true, userId, onDetailsSaved }));
  await click(button(c, "Edit profile"));
  const openPicker = async () => { await click(button(c, "Change picture")); assert(c.querySelector(".ap-stand-in"), "Change picture opens the picker"); };

  await openPicker();
  assert(globalThis.__picker.current.photoUrl === profile.details.avatarUrl, "the picker gets the current picture");
  await act(async () => { await globalThis.__picker.onPreset("helmet"); });
  await flush();
  let saved = onDetailsSaved.calls.at(-1)?.[0];
  assert(saved?.avatarPreset === "helmet" && saved.avatarPath === null, "choosing a default avatar saves it, got " + JSON.stringify(saved));
  assert(!mock._storageObjects.has(`avatars/${oldPath}`), "the old photo is deleted once the new picture is set");
  assert(!c.querySelector(".ap-stand-in"), "the picker closes after a save");

  await openPicker();
  await act(async () => { await globalThis.__picker.onPhoto(new Blob(["fake webp"], { type: "image/webp" })); });
  await flush();
  saved = onDetailsSaved.calls.at(-1)?.[0];
  assert(saved?.avatarPath?.startsWith(`${userId}/`) && saved.avatarPreset === null, "a photo uploads to the player's own folder and becomes the picture, got " + JSON.stringify(saved));

  await openPicker();
  mock._siteFlags.get("uploads_paused").enabled = true;
  const calls = onDetailsSaved.calls.length;
  await act(async () => { await globalThis.__picker.onPhoto(new Blob(["another"], { type: "image/webp" })); });
  await flush();
  assert(onDetailsSaved.calls.length === calls, "a refused upload doesn't call onDetailsSaved");
  assert(c.querySelector(".ap-stand-in") && /paused/.test(globalThis.__picker.error), "the picker stays open with the paused message, got: " + globalThis.__picker.error);
  mock._siteFlags.get("uploads_paused").enabled = false;

  await act(async () => { await globalThis.__picker.onRemove(); });
  await flush();
  saved = onDetailsSaved.calls.at(-1)?.[0];
  assert(saved?.avatarPath === null && saved.avatarPreset === null, "Remove picture clears it, got " + JSON.stringify(saved));
});

if (shown) await act(async () => shown.reactRoot.unmount());
console.log("test-profile-screen.mjs done");
