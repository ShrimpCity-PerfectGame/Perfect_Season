// Cosmetics (cosmetics.jsx, SHOP.md 7.1) in jsdom: every frame, card theme, title and shop thumbnail renders with its
// test hook; null and unknown ids fall back to the defaults; Team colors for all 32 teams and for none; every card
// theme's text is readable (WCAG AA) on what it paints; every animation stops under reduced motion; the stylesheet
// styles only cs- classes, in colors cosmetics.jsx names as data; and the avatar packs (avatars.jsx) are all drawn.
import { setupDom, loadModule, renderComponent, assert, runTest } from "./helpers.mjs";
import { THEME, PALETTE, TEXT_TOKENS } from "../theme.mjs";
import { TEAMS } from "../game-logic.mjs";
import { SHOP_ITEMS, SHOP_ITEM_BY_ID, DEFAULT_ITEM, AVATAR_PACKS } from "../shop-catalog.mjs";
import { FREE_AVATAR_PRESETS } from "../profile-rules.mjs";

setupDom();
const { act } = await import("react-dom/test-utils");
const React = (await import("react")).default;
const h = React.createElement;
const cosmetics = await loadModule("cosmetics.jsx");
const { FramedAvatar, CardTheme, TitleLine, Coin, Coins, ItemPreview, COSMETICS_CSS, CARD_THEME_SCOPE, COLORS, cardPaint, teamCardColors, frameReach } = cosmetics;
const { Avatar, AVATAR_PRESETS } = await loadModule("avatars.jsx");

const FRAMES = SHOP_ITEMS.filter((i) => i.kind === "frame").map((i) => i.id);
const CARDS = SHOP_ITEMS.filter((i) => i.kind === "card").map((i) => i.id);
const TITLES = SHOP_ITEMS.filter((i) => i.kind === "title").map((i) => i.id);
const TEAM_CODES = Object.keys(TEAMS);

// The same WCAG math as tests/test-theme-contrast.mjs.
const luminance = (hex) => {
  const [r, g, b] = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let shown = null;
async function show(element) {
  if (shown) await act(async () => shown.reactRoot.unmount());
  shown = await renderComponent(() => element);
  return shown.container;
}
const px = (v) => Number.parseFloat(v || "0");

await runTest("every frame renders with its hook at the header, list and card sizes, inside max(3, size/10)", async () => {
  for (const size of [24, 40, 56, 84, 96]) {
    const c = await show(h("div", null, FRAMES.map((id) => h(FramedAvatar, { key: id, frame: id, team: "KC", size, username: "shrimpcity", preset: "helmet", decorative: true }))));
    const frames = [...c.querySelectorAll(".cs-frame")];
    assert(frames.map((f) => f.dataset.frame).join() === FRAMES.join(), `${size}px: expected a frame per catalog id, got ${frames.map((f) => f.dataset.frame).join()}`);
    for (const f of frames) {
      const id = f.dataset.frame;
      assert(f.classList.contains(`cs-frame-${id.replace("frame-", "")}`), `${size}px ${id}: wears its own look, got ${f.className}`);
      assert(f.dataset.team === "KC", `${size}px ${id}: data-team is the team`);
      const reach = px(f.style.padding);
      assert(reach >= 1 && reach <= Math.max(3, size / 10), `${size}px ${id}: the ring reaches ${reach}px, over max(3, size/10)`);
      const av = f.querySelector(":scope > .av");
      assert(av && av.style.width === `${size}px` && av.getAttribute("aria-hidden") === "true", `${size}px ${id}: the picture is the Avatar at its size`);
      const plate = f.querySelector(".cs-plate");
      assert(!!plate === (id === "frame-undefeated" && size >= 56), `${size}px ${id}: only the card-sized Undefeated frame has the 20-0 plate`);
      if (plate) assert(plate.getAttribute("aria-hidden") === "true", "the plate is decorative");
    }
    assert(frameReach(size) === Math.max(3, Math.floor(size / 10)), `frameReach(${size})`);
  }
  // A picture that isn't decorative keeps its name, inside any frame.
  const c = await show(h(FramedAvatar, { frame: "frame-gold", username: "shrimpcity", className: "pf-ring" }));
  const f = c.querySelector(".cs-frame");
  assert(f.classList.contains("pf-ring") && f.querySelector(".av").getAttribute("aria-label") === "shrimpcity's picture", "className passes through and the picture keeps its label");
});

await runTest("null and unknown ids fall back to the defaults", async () => {
  for (const frame of [null, undefined, "", "frame-nope", "card-night", "title-film-room"]) {
    const c = await show(h(FramedAvatar, { frame, username: "joe", size: 40 }));
    const f = c.querySelector(".cs-frame");
    assert(f.dataset.frame === DEFAULT_ITEM.frame && f.classList.contains("cs-frame-ink"), `frame ${JSON.stringify(frame)} should be Ink, got ${f.dataset.frame} ${f.className}`);
  }
  for (const theme of [null, undefined, "", "card-nope", "frame-gold"]) {
    const c = await show(h(CardTheme, { theme }, "hi"));
    const card = c.querySelector(".cs-card");
    assert(card.dataset.card === DEFAULT_ITEM.card && card.classList.contains("cs-card-navy") && card.classList.contains("cs-dark"),
      `theme ${JSON.stringify(theme)} should be Navy in the dark scope, got ${card.dataset.card} ${card.className}`);
  }
  for (const title of [null, undefined, "", "title-nope", "frame-lime"]) {
    const c = await show(h("div", null, h(TitleLine, { title })));
    assert(c.firstElementChild.childElementCount === 0, `title ${JSON.stringify(title)} renders nothing, got ${c.innerHTML}`);
  }
  const c = await show(h("div", null, h(ItemPreview, { id: "nope" }), h(ItemPreview, { id: null })));
  assert(c.firstElementChild.childElementCount === 0, "an unknown item has no thumbnail");
});

await runTest("Team colors: all 32 teams wear their own colors, and no team wears the default", async () => {
  assert(TEAM_CODES.length === 32, "32 teams");
  const c = await show(h("div", null, TEAM_CODES.map((code) => h("div", { key: code, "data-code": code },
    h(FramedAvatar, { frame: "frame-team", team: code, size: 40, username: code }),
    h(CardTheme, { theme: "card-team", team: code }, code)))));
  for (const code of TEAM_CODES) {
    const row = c.querySelector(`[data-code="${code}"]`);
    const f = row.querySelector(".cs-frame");
    assert(f.classList.contains("cs-frame-team") && f.dataset.frame === "frame-team", `${code}: the Team colors frame`);
    assert(f.style.getPropertyValue("--tc1") === TEAMS[code][2] && f.style.getPropertyValue("--tc2") === TEAMS[code][3], `${code}: the frame gets the team's two colors`);
    const card = row.querySelector(".cs-card");
    const t = teamCardColors(code);
    assert(card.classList.contains("cs-card-team") && card.classList.contains(`cs-${CARD_THEME_SCOPE["card-team"]}`) && card.dataset.team === code, `${code}: the Team colors card`);
    assert(card.style.getPropertyValue("--cs-team-fill") === t.fill && card.style.getPropertyValue("--cs-team-dark") === t.dark
      && card.style.getPropertyValue("--cs-team-bright") === t.bright, `${code}: the card's paint variables are teamCardColors'`);
    assert([TEAMS[code][2], TEAMS[code][3]].sort().join() === [t.dark, t.bright].sort().join() && luminance(t.dark) <= luminance(t.bright), `${code}: trim is the team's own two colors, darker first`);
    assert(t.fill !== COLORS.teamFloor, `${code}: the fill carries some of the team's color, got the bare floor`);
  }
  for (const team of [null, "", "ZZZ"]) {
    const c2 = await show(h("div", null, h(FramedAvatar, { frame: "frame-team", team, username: "joe" }), h(CardTheme, { theme: "card-team", team }, "x")));
    const f = c2.querySelector(".cs-frame");
    const card = c2.querySelector(".cs-card");
    assert(f.dataset.frame === "frame-team" && f.classList.contains("cs-frame-ink") && !f.style.getPropertyValue("--tc1") && f.dataset.team === undefined,
      `team ${JSON.stringify(team)}: the Team colors frame keeps its id but wears Ink, got ${f.className}`);
    assert(card.dataset.card === "card-team" && card.classList.contains("cs-card-navy") && card.classList.contains("cs-dark") && !card.style.getPropertyValue("--cs-team-fill"),
      `team ${JSON.stringify(team)}: the Team colors card keeps its id but paints Navy, got ${card.className}`);
  }
});

await runTest("every card theme renders its paint class and scope, as any element, keeping the caller's layout and props", async () => {
  assert(JSON.stringify(Object.keys(CARD_THEME_SCOPE).sort()) === JSON.stringify([...CARDS].sort()), "CARD_THEME_SCOPE covers exactly the catalog's card themes");
  for (const id of CARDS) {
    const scope = CARD_THEME_SCOPE[id];
    assert(["dark", "night", "light"].includes(scope), `${id}: scope ${scope}`);
    const c = await show(h(CardTheme, { theme: id, team: "SEA", as: "section", className: "pf-card", "aria-label": "Player card", "data-x": "1", style: { marginTop: "3px" } },
      h("h1", null, "shrimpcity")));
    const card = c.firstElementChild;
    assert(card.tagName === "SECTION" && card.dataset.card === id && card.classList.contains("cs-card") && card.classList.contains(`cs-${scope}`)
      && card.classList.contains(`cs-card-${id.replace("card-", "")}`) && card.classList.contains("pf-card"), `${id}: got <${card.tagName} class="${card.className}">`);
    assert(card.getAttribute("aria-label") === "Player card" && card.dataset.x === "1" && card.style.marginTop === "3px" && card.querySelector("h1")?.textContent === "shrimpcity",
      `${id}: props, style and children pass through`);
    assert(cardPaint(id, "SEA").scope === scope, `${id}: cardPaint agrees on the scope`);
  }
});

await runTest("titles render their names with the hook, and a title on a chip for the shop", async () => {
  for (const id of TITLES) {
    const c = await show(h("div", null, h(TitleLine, { title: id, className: "x" })));
    const p = c.querySelector("p.cs-title");
    assert(p && p.dataset.title === id && p.textContent === SHOP_ITEM_BY_ID[id].name && p.classList.contains("x"), `${id}: got ${c.innerHTML}`);
  }
});

await runTest("Coins reads \"1,240 coins\", with the coin itself decorative", async () => {
  for (const [amount, words] of [[1240, "1,240 coins"], [15000, "15,000 coins"], [0, "0 coins"], [undefined, "0 coins"]]) {
    const c = await show(h(Coins, { amount, size: 18, className: "pf-bal" }));
    const root = c.querySelector(".cs-coins");
    assert(root.textContent === words, `Coins ${amount} should read "${words}", got "${root.textContent}"`);
    assert(root.classList.contains("pf-bal") && root.querySelector("svg").getAttribute("aria-hidden") === "true" && root.querySelector("svg").getAttribute("width") === "18", "the coin is decorative and sized");
  }
  const c = await show(h(Coin, { size: 14 }));
  assert(c.querySelector("svg.cs-coin[aria-hidden=true]")?.getAttribute("height") === "14", "Coin draws at its size");
});

await runTest("every catalog item has a decorative thumbnail made only of inline elements", async () => {
  for (const item of SHOP_ITEMS) {
    const c = await show(h("button", null, h(ItemPreview, { id: item.id, team: "KC", username: "shrimpcity", preset: "trophy" })));
    const prev = c.querySelector(".cs-preview");
    assert(prev && prev.getAttribute("aria-hidden") === "true" && prev.dataset.preview === item.id, `${item.id}: a hidden .cs-preview`);
    assert(!prev.querySelector("div,p,section,ul,ol,li,h1,h2,h3"), `${item.id}: only inline elements, so it can sit in a button - got ${prev.innerHTML}`);
    if (item.kind === "frame") assert(prev.querySelector(`.cs-frame[data-frame="${item.id}"]`), `${item.id}: a framed picture`);
    if (item.kind === "card") assert(prev.querySelector(`.cs-card[data-card="${item.id}"]`), `${item.id}: a swatch painted in the theme`);
    if (item.kind === "title") assert(prev.textContent === item.name, `${item.id}: the title on a chip`);
    if (item.kind === "avatar_pack") {
      const keys = [...prev.querySelectorAll(".av")].map((a) => a.dataset.preset).join();
      assert(keys === AVATAR_PACKS.find((p) => p.item === item.id).presets.map((p) => p.key).join(), `${item.id}: its four avatars, got ${keys}`);
    }
  }
});

await runTest("the avatar packs: 12 more presets, not free, named from the catalog, every one drawn", async () => {
  assert(AVATAR_PRESETS.length === FREE_AVATAR_PRESETS.length + 12, `expected 24 presets, got ${AVATAR_PRESETS.length}`);
  assert(new Set(AVATAR_PRESETS.map((p) => p.key)).size === AVATAR_PRESETS.length, "preset keys are unique");
  const starter = AVATAR_PRESETS.filter((p) => p.pack === "starter");
  assert(JSON.stringify(starter) === JSON.stringify(FREE_AVATAR_PRESETS.map((p) => ({ ...p, pack: "starter", free: true }))), "the starter set is unchanged and first");
  for (const pack of AVATAR_PACKS) {
    const mine = AVATAR_PRESETS.filter((p) => p.pack === pack.pack);
    assert(JSON.stringify(mine) === JSON.stringify(pack.presets.map((p) => ({ ...p, pack: pack.pack, free: false }))), `${pack.pack}: presets as the catalog lists them, got ${JSON.stringify(mine)}`);
  }
  const c = await show(h("div", null, AVATAR_PRESETS.map((p) => h(Avatar, { key: p.key, username: "zed", preset: p.key, size: 24 }))));
  for (const el of c.querySelectorAll(".av")) {
    assert(el.querySelector("svg.av-art") && el.textContent === "", `${el.dataset.preset}: drawn, not the initial`);
  }
});

// ---------- contrast ----------
// Navy is today's card exactly (SHOP.md 7.1), and its lime --glow, at its very brightest in the top-left corner
// (18% lime over navy, under the picture), takes the dark scope's qb position color below AA. No card shows a
// position color, and every other token reads there, so qb is the one expected exception, pinned so a new one fails.
const NAVY_GLOW_BELOW_AA = ["qb"];

await runTest("every card theme's text is AA-readable on everything it paints behind text (all 32 teams on Team colors)", async () => {
  const failures = [];
  for (const id of CARDS) {
    for (const team of id === "card-team" ? [...TEAM_CODES, null] : [null, "KC"]) {
      const paint = cardPaint(id, team);
      const t = THEME[paint.scope];
      assert(Array.isArray(paint.behindText) && paint.behindText.length > 0, `${id}: lists what it paints behind text`);
      for (const bg of paint.behindText) {
        assert(/^#[0-9A-F]{6}$/.test(bg), `${id}: ${bg} is a solid color`);
        for (const token of TEXT_TOKENS) {
          const ratio = contrast(t[token], bg);
          if (ratio < 4.5) failures.push(`${id}${team ? ` (${team})` : ""}: ${token} ${t[token]} on ${bg} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
  assert(failures.length === 0, `below AA:\n  ${failures.join("\n  ")}`);

  const navy = cardPaint("card-navy");
  const low = TEXT_TOKENS.filter((k) => contrast(THEME.dark[k], navy.glow) < 4.5);
  assert(JSON.stringify(low) === JSON.stringify(NAVY_GLOW_BELOW_AA), `Navy's glow corner: expected only ${NAVY_GLOW_BELOW_AA} below AA, got ${low.join(", ") || "none"}`);
  for (const k of NAVY_GLOW_BELOW_AA) assert(contrast(THEME.dark[k], navy.glow) >= 3, `${k} on Navy's glow corner stays at least 3:1`);
});

// ---------- the stylesheet ----------
// A small parser for COSMETICS_CSS: top-level rules, @keyframes and @media blocks, in order.
function parseCss(css) {
  const block = (src, media) => {
    const items = [];
    let pos = 0;
    for (;;) {
      const open = src.indexOf("{", pos);
      if (open < 0) break;
      const head = src.slice(pos, open).trim();
      let depth = 1, end = open + 1;
      while (depth && end < src.length) { if (src[end] === "{") depth++; else if (src[end] === "}") depth--; end++; }
      const body = src.slice(open + 1, end - 1);
      if (head.startsWith("@media")) items.push({ type: "media", query: head, rules: block(body, head) });
      else if (head.startsWith("@keyframes")) items.push({ type: "keyframes", name: head.split(/\s+/)[1], body });
      else items.push({ type: "rule", selectors: head.split(",").map((s) => s.trim()), decls: declarations(body), media });
      pos = end;
    }
    return items;
  };
  const declarations = (body) => Object.fromEntries(body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const at = d.indexOf(":");
    return [d.slice(0, at).trim(), d.slice(at + 1).trim()];
  }));
  return block(css.replace(/\/\*[\s\S]*?\*\//g, ""), null);
}
const CSS = parseCss(COSMETICS_CSS);
const allRules = CSS.flatMap((i) => (i.type === "media" ? i.rules : i.type === "rule" ? [i] : []));

await runTest("every animation in COSMETICS_CSS stops under prefers-reduced-motion", async () => {
  const reduced = CSS.filter((i) => i.type === "media" && /prefers-reduced-motion:\s*reduce/.test(i.query)).flatMap((i) => i.rules);
  const stopped = (selector, prop) => reduced.some((r) => r.selectors.includes(selector) && r.decls[prop] === "none");
  const moving = allRules.filter((r) => !reduced.includes(r));
  let animations = 0;
  const keyframes = new Set(CSS.filter((i) => i.type === "keyframes").map((i) => i.name));
  for (const r of moving) {
    for (const prop of ["animation", "animation-name", "transition"]) {
      if (!r.decls[prop] || r.decls[prop] === "none") continue;
      if (prop !== "transition") {
        animations++;
        for (const name of r.decls[prop].split(",").map((a) => a.trim().split(/\s+/).find((w) => keyframes.has(w)))) {
          assert(name, `${r.selectors.join()}: ${prop} names a @keyframes in COSMETICS_CSS (${r.decls[prop]})`);
        }
      }
      const base = prop === "transition" ? "transition" : "animation";
      for (const s of r.selectors) assert(stopped(s, base), `${s} has ${prop}: ${r.decls[prop]}, but no ${base}:none under prefers-reduced-motion`);
    }
  }
  assert(animations >= 2, `expected the Flame frame's animations to be found, got ${animations}`);
  const flame = moving.filter((r) => r.selectors.some((s) => s.startsWith(".cs-frame-flame")) && r.decls.animation && r.decls.animation !== "none");
  assert(flame.length === 2, "Flame animates both its layers");
});

await runTest("COSMETICS_CSS styles only cs- classes, base rules before media queries, in colors named as data", async () => {
  for (const r of allRules) {
    for (const s of r.selectors) {
      const classes = [...s.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      assert(classes.length > 0 && classes.every((c) => c.startsWith("cs-")), `selector "${s}" styles a class outside cs-`);
    }
  }
  const firstMedia = CSS.findIndex((i) => i.type === "media");
  assert(firstMedia > 0 && CSS.slice(firstMedia).every((i) => i.type === "media"), "every base rule and @keyframes comes before the first @media block");

  const allowed = new Set([...Object.values(COLORS), ...Object.values(PALETTE)].map((c) => c.toUpperCase()));
  const css = decodeURIComponent(COSMETICS_CSS.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
  const hexes = [...css.matchAll(/#([0-9A-Fa-f]{6})\b/g)].map((m) => `#${m[1].toUpperCase()}`);
  const rgbs = [...css.matchAll(/rgba?\((\d+),(\d+),(\d+)/g)].map((m) => `#${m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`);
  assert(hexes.length > 20 && rgbs.length > 0, "found the stylesheet's colors");
  const stray = [...new Set([...hexes, ...rgbs])].filter((c) => !allowed.has(c));
  assert(stray.length === 0, `colors in COSMETICS_CSS that aren't in COLORS or PALETTE: ${stray.join(", ")}`);
  assert(!/#[0-9A-Fa-f]{3}\b/.test(css.replace(/#[0-9A-Fa-f]{6}\b/g, "")), "no short hex colors either");
});

if (shown) await act(async () => shown.reactRoot.unmount());
console.log("test-cosmetics.mjs done");
