# Gridspin — the shop revamp

A plan, not a contract. `SHOP.md` describes the shop that exists; this describes the one being built and the
order to build it in. Delete it when it is done.

**The goal.** Give the shop enough to be worth opening, and give the game one honest way to make money — a
one-off $3.99 Supporter unlock that removes ads and unlocks cosmetics of its own.

---

## 1. Where it stands

**Shipped to staging** (2.5.0 through 2.8.0), not yet on production:

- **Win celebrations** — a fifth item kind and a fifth equip slot. An overlay over the result screen when a
  season wins the title. Five items; Champion is earned by the Undefeated badge, not sold.
- **Supporter** — the entitlement itself: a `supporters` row, `profiles.supporter` kept in step by a trigger,
  the `supporter` rarity gated in `shop_state` / `shop_buy` / `equip_item`.
- **Name colours** (2.7.0) — nine looks on the boards, the duel screen and the header. See Phase 2.
- **The supporter set is complete** (2.8.0) — Orbit (frame), Cosmos (card), Stargazer (avatar pack) join the
  title, the nameplate, the name colour and the celebration, so supporter fills **every slot**. That matters
  for §3: $3.99 needs enough behind it to be worth paying, and "two items" was the reason Phase 3 was told to
  wait. It no longer is.

**Not built:** payment, ads, and everything else in §4.

---

## 2. The rules every item obeys

These are not preferences. Each one is enforced by a test that will refuse the work, and most of them were
learned by being refused.

**Cosmetic only, and now load-bearing.** Nothing bought or unlocked may touch drafts, scores, leaderboards,
the daily or duels. This was a design preference while the shop took only coins; the moment real money is
involved it is a promise.

**Money buys time, never advantage** (§5). The earlier draft of this line was *"different, not better"*, and
the 2× coin decision retired it: a multiplier gives supporters the same cosmetics sooner. What survives is the
part that matters — nothing bought changes a draft, a score, a board, the daily or a duel, and coins reach
cosmetics only.

**The best thing in the game stays earned.** Badge items (Undefeated, Dynasty, Cinderella) are the reward for
playing well. Supporter runs beside that ladder, never above it. A 20–0 is 4.5% of finished seasons; it should
outrank a card payment.

**Text is the hard part.** A name, a title, a nameplate — anything with text — renders on **cream** (Modes,
Stats), **navy** (play, duel) and **true black** (Leaderboard), and every text colour must clear WCAG AA on all
three. `tests/test-theme-contrast.mjs` and `tests/test-cosmetics.mjs` enforce it, and a card theme has to
publish what it paints behind text (`cardPaint`). **This is why "custom colours — pick your own" cannot ship as
a colour picker**: free choice and a contrast guarantee are not both true. Constrained, pre-validated palettes
only.

**Every colour is named data.** Anything painted in `COSMETICS_CSS` must exist in `COLORS` or `PALETTE`.

**Motion stops.** Every animated selector needs `animation:none` under `prefers-reduced-motion` — per selector,
not by hiding a parent. And no commas inside an `animation` shorthand (`cubic-bezier(…)` breaks the keyframes
check); name the easing instead.

**Base CSS before `@media`.** A base rule after a responsive block loses to it.

### What a new item *kind* costs

Measured on celebrations. Budget this whenever the plan says "a new kind":

| | |
|---|---|
| `shop-catalog.mjs` | `SHOP_KINDS`, `KIND_LABEL`, `EQUIP_SLOTS`, `DEFAULT_ITEM`, the items |
| `migration-shop.sql` | the `kind` check (**drop and re-add by name** — `create table if not exists` leaves an old database's constraint alone), the seed, a `profile_details` column, the ordering array, and the three functions |
| mirrors | `tests/mock-shop.mjs`, `tests/mock-profile-data.mjs`, `storage-shop.js`, `storage-profile.js` |
| inventories that refuse a quiet addition | functions, triggers, tables, added columns, refusal codes, text orderings, the `profile_details` row shape (in **four** places) |
| docs | `SHOP.md`, `CLAUDE.md`, changelog |

**Deploy shape:** every shop change is `migration-shop.sql` first, then the client. Adding a column or a kind
means the order genuinely matters, unlike a function replacement.

---

## 3. Money

### 3.1 The product

**One-off, $3.99.** Not a subscription — no churn, no dunning, no "my card expired and my card theme vanished",
and no implicit promise to ship supporter content every month. The entitlement never expires, which is most of
why the database side was a table and a trigger rather than a billing system.

It buys: the supporter cosmetics, and **no ads, permanently** — including for anyone who bought before ads
existed. That is the obligation that makes the entitlement permanent rather than convenient.

### 3.2 Payment

**Stripe on the web is the only route open today.** There is no Play Console account, no release signing key
and nothing published, so store billing is unavailable — and the planned coin packs are blocked on the same
thing.

Shape:

1. Stripe product + price, one-off.
2. Hosted Checkout from the shop, with the account id in metadata.
3. A `stripe-webhook` Edge Function: **verify the signature**, then insert `supporters` with
   `source = 'stripe'` and `reference = <payment intent>`.
4. Refunds and chargebacks delete the row. The trigger already clears the flag and takes the items off.

The entitlement is already store-proofed: `source` accepts `play` and `apple`, so a store build later
reconciles to the same row rather than a second system.

**Obligations that come with taking money**, none of them optional: terms, a working refund path, Stripe Tax,
and the privacy policy updated to mention payment data. The policy page already exists (`site-pages.mjs`).

### 3.3 Ads

Not built. When they are:

- **Read `profiles.supporter` before rendering anything.** It is on `profiles` — public select, no client write
  — specifically so the decision happens at load, not after a shop call.
- Never on the draft or result screens. Those are the game.
- **Ship ads *after* payment works.** Ads with no way to remove them is the worst possible order.

---

## 4. What to build, in order

### Phase 1 — celebrations + the supporter gate ✅ built, unshipped

Ships as one update with whatever else is ready. Grant supporter by hand until §3.2 exists:

```sql
insert into supporters (user_id, source, note)
select id, 'grant', 'why' from profiles where username = 'NAME';
```

### Phase 2 — names ✅ built, unshipped

The highest-visibility cosmetic in the game. The rendering turned out to be three places, not two: `NameLink`
for every board, `DuelName` for the duel screen (colour only — a name there is never a profile link, because
that screen is a draft on a clock), and the header's own name, which is painted from what YOU have equipped
rather than from the boards' read. That last one is why the play screen has one at all: it is the only name on
it. The context they share, `BoardWear`, had to move to ui-common.jsx, because versus.jsx reads it and a screen
file never imports the main component back.

- **Nameplates** — a banner behind the name. Easier than coloured text: the plate is a fill, the text stays a
  token, so contrast is unchanged.
- **Animated / coloured names** — the one people actually want, and the one §2 bites hardest. Fixed palettes
  validated against all three scopes; animation off under reduced motion; the **guest chip** must stay legible
  beside it.

Done, both halves, and the second half is the one worth writing down. The contrast fight had a clear answer
first: **no colour clears AA as text on all three CARD scopes** (lime 1.28:1 on cream, game blue 3.19:1 on the
dark card), so on the player card "coloured animated names" became eleven nameplates, four of them drifting a
gradient - the colour carries its own background, every stop is checked against the ink, and the drift is
`background-position` only.

Then it shipped to staging, and the answer to "where is the animated name text" was that there wasn't any.
**The conclusion had been drawn one step too wide.** "No colour works on all three scopes" is only fatal if a
look has to BE one colour - and it doesn't. A look can be named once per scope, exactly as theme.mjs names
every token three times, with the app handing in the scope it is drawing. Deep on cream, bright on black, the
same identity either way, and every stop stays measurable because each is measured against one known surface
instead of three at once. That is v2.7.0: nine name colours on the boards, six of them drifting.

What stays true from the first pass: **a colour picker still cannot ship.** Free choice and a contrast
guarantee are not both true. A curated, pre-validated set is a different thing, and the earlier note here
overstated the limit by not making that distinction.

The **supporter star** is done too, and the plan was wrong about what it would cost. There is no eight-board
pass: every name renders through one `NameLink`, so the flag arrives there in a context and the six board
functions were never touched. That is also the better design — `guest` is snapshotted onto a row because it
was true when the row was written, but supporter changes when somebody buys, so a per-row copy would be stale
on everything already written.

### Phase 3 — payment (§3.2)

Only once Phase 2 has landed. $3.99 needs enough behind it to be worth paying; two items is not.

### Phase 4 — ads (§3.3)

After Phase 3, never before.

### Phase 5 — profile themes

A whole-page re-skin, the biggest item of the lot. Today's `CardTheme` covers the player card only; extending
it to the page multiplies the surface that has to publish `behindText`. Worth doing, worth doing last.

### Anywhere — identity

Cheap and independent of the rest:

- **Favourite player** beside the existing favourite team. The full pool and a search UI already exist
  (`PlayerIndex`).
- **Pinned badge** at the top of a profile. `set_showcase` already holds three; pinning one is a variation.

---

## 5. Decisions

**A supporter icon beside the name: yes.** Small, next to the name, the way the guest chip already works.

*Turned out cheaper than this, see Phase 2 — kept for the reasoning.* `guest` travels with the name through
about eight boards, each of which had to be given it separately — `stats_card`, `best_gm`, `biggest_upsets`, `sou_runs` and `builds` carry it as a column, and
every board renders through one `NameLink`. A supporter icon needs the same treatment: `site_stats`,
`ladder_best`, `versus_top`, `fetchLeaderboardTop`, the daily board and the minigame boards all have to carry
the flag alongside the name, or the icon appears on some boards and not others. Do it as one pass, not per
board, and add it to `NameLink` rather than to each caller.

**No coin packs.** Two ways to spend money is one more than this game needs. Supporter is the simpler promise.

**Supporter earns 2× coins from playing.** Decided — with the framing change it forces written down:

> The old line was *"supporter items are different, not better."* A multiplier is not different, it is faster to
> the same things. The line becomes: **money buys time, never advantage.** Coins buy only cosmetics, so 2× still
> touches no draft, score, leaderboard, daily or duel — but the rule in CLAUDE.md has to say the new thing, not
> the old one.

Two things it drags with it:

- **It doubles the accepted exploit ceilings.** `tests/test-economy-security.mjs` documents and prices them: the
  minigames pay 15 a day to anyone holding the row, and searching codes offline tops out near 7,000 coins a day.
  For a supporter those become 30 and ~14,000. All cosmetic, so nothing is broken — but that test prints the
  numbers and they need re-pricing with the multiplier in them.
- **It is server-side, and mirrored.** `submit-run` credits coins through `credit_coins`; `rewards.mjs` is shared
  with the browser because the result screen prints the breakdown line by line. Applied in one and not the other,
  the screen and the wallet disagree. Put the multiplier in `rewards.mjs` (which both import), have submit-run
  read `profiles.supporter` it has already fetched, and give the ledger an honest line — a doubled season should
  read as doubled, not as a bigger mystery number.
  **Scope: seasons only.** Decided. A finished season and the badges it pays double; the minigame claim and the
  welcome coins do not. That keeps the multiplier in one place — submit-run, which already reads the profile —
  and leaves `claim_minigame` alone, which is SQL-side and would otherwise need the flag threaded into it for a
  15-coin claim. It also means the minigame half of the accepted exploit ceiling does not move at all; only the
  code-grinding half does.

## 6. Still open

Nothing. Every question this plan raised has an answer above:

| | |
|---|---|
| Price | **$3.99**, one-off, USD |
| Supporter icon on the boards | yes, small, beside the name |
| Coin packs | no |
| 2× coins | yes, **seasons only** |
