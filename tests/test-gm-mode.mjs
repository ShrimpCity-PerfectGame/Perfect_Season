// GM mode: a player's salary is shown before selecting them, doesn't change based on which
// slot (named or Flex) they'd fill, the "Lock in" button cost matches what was shown up front, and
// the salary cap is enforced at BOTH doors into the draft - the Lock in button and the roster tile.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "GM mode").closest("button"));
await flush();

await runTest("every card shows a salary before being selected", async () => {
  const cards = container.querySelectorAll(".card");
  assert(cards.length > 0, "expected player cards on the board");
  const pills = container.querySelectorAll(".card .pill");
  assert(pills.length === cards.length, `expected every one of ${cards.length} cards to show a salary pill, got ${pills.length}`);
});

await runTest("a Flex-eligible player's salary is identical for its named slot and Flex", async () => {
  const card = [...container.querySelectorAll(".card")].find((c) => ["RB", "WR", "TE"].includes(c.querySelector(".pp")?.textContent) && !c.classList.contains("off"));
  const shown = card.querySelector(".pill").textContent;
  await click(card.querySelector("button.hit"));
  await flush();
  const slotButtons = [...card.querySelectorAll(".drafts button")].filter((b) => b.textContent.includes("Lock in"));
  assert(slotButtons.length >= 2, "expected at least a named-slot and a Flex button for this player");
  for (const b of slotButtons) {
    assert(b.textContent.includes(shown), `expected "${shown}" in every slot button, got: ${b.textContent}`);
  }
});

// A player over the cap has to be reached, not asserted into existence, so this drives a real GM
// draft from a challenge link - deterministic boards, the same every run. Drafting the most expensive
// player the rules still allow (which is what chasing the best roster looks like) leaves $20M against
// a $38M Ricky Williams on the fourth board.
await runTest("the roster tile enforces the salary cap, not just the Lock in button", async () => {
  // The bug: draft() has two call sites. Lock in checked the cap, the reserve and a dead board; the
  // roster slot tile was `disabled={!target}` and checked none of them. So GM, $19M left, a $42M
  // player - Lock in reads "$42M (over cap)" and is dead, and tapping the Flex tile next to it drafts
  // him anyway. The header turns red at $173M / $150M, the season finishes, submit-run refuses it 400
  // "over the salary cap", and the player is told it "will be included the next time a save goes
  // through", which was never true. This predates 2.0: the cap had never been enforced in the UI at all.
  setupDom("http://localhost/c/56RGAK?mode=gm");
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush(3);
  const howto = findButtonByText(container, "Got it, let's draft");
  if (howto) { await click(howto); await flush(); }
  await click(findButtonByText(container.querySelector(".challenge"), "Draft these boards"));
  await flush(4);

  const salary = (card) => Number((card.querySelector(".pill")?.textContent || "").replace(/[^0-9]/g, ""));
  const lockIns = (card) => [...card.querySelectorAll(".drafts button.btn.solid")].filter((b) => b.textContent.includes("Lock in"));
  const filled = () => [...container.querySelectorAll(".roster button.slot")].filter((b) => b.classList.contains("filled")).length;
  const capLeft = () => container.querySelector(".gmleft")?.textContent || "";

  // Spend down: the dearest player still on offer, three times.
  for (let pick = 0; pick < 3; pick++) {
    let cards = [];
    for (let i = 0; i < 10 && !cards.length; i++) {
      await flush(1);
      cards = [...container.querySelectorAll(".card")].filter((c) => !c.classList.contains("off"));
    }
    assert(cards.length, `board ${pick + 1} rendered`);
    const card = cards.sort((a, b) => salary(b) - salary(a))[0];
    await click(card.querySelector("button.hit"));
    await flush();
    const btn = lockIns(card).find((b) => !b.disabled);
    assert(btn, `something affordable on board ${pick + 1}`);
    await click(btn);
    await flush(2);
  }
  assert(filled() === 3, `three slots filled, got ${filled()}`);

  // The fourth board holds somebody the cap cannot take.
  let over = null;
  for (let i = 0; i < 10 && !over; i++) {
    await flush(1);
    for (const c of container.querySelectorAll(".card")) {
      if (c.classList.contains("off")) continue;
      await click(c.querySelector("button.hit"));
      await flush();
      if (lockIns(c).some((b) => b.textContent.includes("(over cap)"))) { over = c; break; }
    }
  }
  assert(over, "a player over the cap on this board - the link's boards are fixed, so this is deterministic");
  const name = over.querySelector(".pn")?.textContent || over.textContent.slice(0, 40);

  // Door one, which always worked.
  for (const b of lockIns(over)) assert(b.disabled, `Lock in for ${name} is dead: "${b.textContent}"`);

  // Door two, which never did. Only the tiles his position actually fits - the rest are dead because
  // nothing goes there, which is the ordinary case and not what is being measured.
  const labels = new Set(lockIns(over).map((b) => b.textContent.split("·")[1].trim().split(" ")[0]));
  const open = [...container.querySelectorAll(".roster button.slot")].filter((b) => !b.classList.contains("filled"));
  const tiles = open.filter((t) => labels.has(t.querySelector(".k")?.textContent));
  assert(tiles.length, `a tile ${name} would fit, among ${open.length} open (offered: ${[...labels].join(", ")})`);
  for (const t of tiles) {
    assert(t.disabled, `the ${t.querySelector(".k")?.textContent} tile refuses ${name} too, not just the button`);
    assert(/cannot go to/.test(t.getAttribute("aria-label") || ""), `and says why: "${t.getAttribute("aria-label")}"`);
  }

  // And tapping them changes nothing. That is `disabled` doing the work: React reads it off the fiber
  // props, so a click never reaches the handler however the DOM node is poked, and draft()'s own
  // draftBlock check is a backstop no test can reach from here - it is there for a THIRD door, which
  // is the whole failure this release keeps finding. Keep that in mind before trusting it.
  const before = capLeft();
  for (const t of open) { await click(t); await flush(2); }
  assert(filled() === 3, `still three slots filled after tapping every open tile, got ${filled()}`);
  assert(capLeft() === before, `and the cap has not moved: was "${before}", now "${capLeft()}"`);
});

console.log("test-gm-mode.mjs done");
