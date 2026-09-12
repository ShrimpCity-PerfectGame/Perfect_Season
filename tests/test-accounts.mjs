// Signup, login, and stats persistence across a simulated reload.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();

let { container, reactRoot } = await mount();
await flush();

const EMAIL = "testuser1@example.com";
const USERNAME = "testuser1";
const PASSWORD = "Password1";

function panel() { return container.querySelector(".panel"); }
function inputs() { return [...panel().querySelectorAll("input")]; }
// The signup/login tab and the submit button can share text ("Create account" appears on
// both once in signup mode); the tab carries role="tab", the submit button does not.
function submitButton(labelText) {
  return [...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes(labelText));
}

await runTest("Account nav shows the auth panel", async () => {
  await click(findButtonByText(container, "Account"));
  await flush();
  assert(panel(), "expected an auth panel on the Account view");
});

await runTest("sign up creates an account with a blank record", async () => {
  await click(findButtonByText(panel(), "Create account"));
  await flush();
  const [emailInput, uInput, pInput, p2Input] = inputs();
  await type(emailInput, EMAIL);
  await type(uInput, USERNAME);
  await type(pInput, PASSWORD);
  await type(p2Input, PASSWORD);
  await click(submitButton("Create account"));
  await waitForCrypto();
  const t = text(container);
  assert(t.includes(USERNAME), "expected username to show after signup, got: " + t.slice(0, 300));
  assert(t.includes("Play your first season to start your record"), "expected a blank record for a new account");
});

await runTest("logging out returns to the auth panel", async () => {
  await click(findButtonByText(container, "Log out"));
  await flush();
  assert(panel(), "expected the auth panel back after logout");
});

await runTest("wrong password is rejected", async () => {
  const [emailInput, pInput] = inputs();
  await type(emailInput, EMAIL);
  await type(pInput, "wrongpassword");
  await click(submitButton("Log in"));
  await waitForCrypto();
  assert(text(container).toLowerCase().includes("incorrect"), "expected an incorrect-password error");
});

await runTest("logging back in restores the same account", async () => {
  const [emailInput, pInput] = inputs();
  await type(emailInput, EMAIL);
  await type(pInput, PASSWORD);
  await click(submitButton("Log in"));
  await waitForCrypto();
  assert(text(container).includes(USERNAME), "expected to be logged back in as " + USERNAME);
});

await runTest("account persists across a simulated reload", async () => {
  // Unmount and remount over the same storage backing, standing in for a page refresh:
  // the session cookie (personal, not shared) should auto-restore the login.
  reactRoot.unmount();
  const remount = await mount();
  container = remount.container;
  reactRoot = remount.reactRoot;
  await flush();
  await click(findButtonByText(container, "Profile"));
  await flush();
  assert(text(container).includes(USERNAME), "expected the session to auto-restore on reload, got: " + text(container).slice(0, 300));
});

console.log("test-accounts.mjs done");
