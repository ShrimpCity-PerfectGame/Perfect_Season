// Admin tools: gated to the "admin" account, can jump to any board, force a specific player
// into a slot, and force a scripted season ending for testing win/loss animations.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth, clickMode } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
const { container } = await mount();
await flush();

function panel() { return container.querySelector(".panel"); }

await runTest("a regular account sees no admin panel", async () => {
  await click(findButtonByText(container, "Account"));
  await flush();
  await click(findButtonByText(panel(), "Create account"));
  await flush();
  const [e, u, p, p2] = [...panel().querySelectorAll("input")];
  await type(e, "regularuser@test.com");
  await type(u, "regularuser");
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();

  await click(findButtonByText(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush();
  assert(!text(container).includes("Admin tools"), "a regular account should not see the admin panel");
});

await runTest("logging in as admin shows the admin panel", async () => {
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Profile"));
  await flush();
  await click(findButtonByText(container, "Log out"));
  await flush();

  await click(findButtonByText(panel(), "Create account"));
  await flush();
  const [e, u, p, p2] = [...panel().querySelectorAll("input")];
  await type(e, "admin@test.com");
  await type(u, "admin");
  await type(p, "AdminPass1");
  await type(p2, "AdminPass1");
  await click([...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();

  await click(findButtonByText(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush();
  assert(text(container).includes("Admin tools"), "the admin account should see the admin panel");
});

await runTest("forcing an outcome auto-fills the roster and skips to the scripted result", async () => {
  await click(findButtonByText(container, "Force missed playoffs"));
  await flush(6);
  await new Promise((r) => setTimeout(r, 100));
  await flush(2);
  const outcome = container.querySelector(".outcome")?.textContent;
  const rec = container.querySelector(".result-hero .rec")?.textContent;
  assert(outcome === "Missed the playoffs", "expected the forced missed-playoffs outcome, got: " + outcome);
  assert(rec === "7–10", "expected a 7-10 record for the missed-playoffs scenario, got: " + rec);
});

await runTest("forcing a board and a specific player lands them in the chosen slot", async () => {
  const forcedCode = container.querySelector(".seedline code")?.textContent;
  await click(findButtonByText(container, "Run it back"));
  await flush(6);
  // The ending was forced from the first board: that dealt draft is over, not abandoned. It used to stay
  // saved, so Run it back charged the admin account a real DNF for it.
  const admin = [...auth._profiles.values()].find((p) => p.username === "admin");
  assert(admin.dnf === 0, `a forced ending must not lead to a DNF, got dnf=${admin.dnf}`);
  assert(container.querySelector(".seedline code")?.textContent !== forcedCode, "expected fresh boards after the forced season");

  const input = panel().querySelector('input[placeholder="Force a player by name"]');
  await type(input, "Tom Brady");
  await flush();
  const row = [...panel().querySelectorAll("div")].find((d) => d.textContent.includes("Tom Brady") && d.textContent.includes("2007"));
  const qbBtn = [...row.querySelectorAll("button")].find((b) => b.textContent === "QB");
  await click(qbBtn);
  await flush();

  assert(container.querySelector(".roster .slot.pos-QB .v")?.textContent === "Tom Brady", "expected Tom Brady force-drafted into QB");
  assert(container.querySelector(".pickno span")?.textContent === "Pick 2 of 6", "expected the draft to advance to pick 2 after the forced pick");
});

console.log("test-admin.mjs done");
