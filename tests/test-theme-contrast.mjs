// Every text color in both themes has to be readable against every surface it can sit on (WCAG AA,
// 4.5:1). Pure data check against theme.mjs - no DOM.
//
// The specific trap this exists for: electric lime is the brand accent and looks great as a fill,
// but as text on cream it's about 1.2:1. A single `color: var(--accent)` in the light scope would
// ship invisible text, and nothing else in the suite would notice.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { THEME, PALETTE, TEXT_TOKENS, SURFACE_TOKENS, cssVars } from "../theme.mjs";

const luminance = (hex) => {
  const [r, g, b] = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const scope of Object.keys(THEME)) {
  await runTest(`${scope} theme: every text color is readable on every surface`, async () => {
    const t = THEME[scope];
    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACE_TOKENS) {
        const ratio = contrast(t[text], t[surface]);
        assert(ratio >= 4.5, `${scope}: ${text} ${t[text]} on ${surface} ${t[surface]} is ${ratio.toFixed(2)}:1 (needs 4.5)`);
      }
    }
  });

  await runTest(`${scope} theme: text on a lime fill is readable`, async () => {
    const t = THEME[scope];
    const ratio = contrast(t.onAccent, t.accent);
    assert(ratio >= 4.5, `${scope}: onAccent on accent is ${ratio.toFixed(2)}:1`);
  });
}

await runTest("lime is never a text color in the light theme", async () => {
  // Guards the rule itself, not just today's values: if someone later points a light-scope text
  // token at the lime, this fails even before contrast is computed.
  for (const text of TEXT_TOKENS) {
    assert(THEME.light[text].toUpperCase() !== PALETTE.lime.toUpperCase(), `light theme uses lime for text token "${text}"`);
  }
  assert(contrast(PALETTE.lime, THEME.light.bg) < 2, "sanity: lime on cream really is unreadable, which is why this rule exists");
});

await runTest("every scope defines exactly the same tokens", async () => {
  // A token missing from one scope silently inherits another scope's value inside `.dark` or
  // `.night` panels - e.g. cream text on cream.
  const light = Object.keys(THEME.light).sort().join(",");
  for (const scope of Object.keys(THEME)) {
    const keys = Object.keys(THEME[scope]).sort().join(",");
    assert(keys === light, `token sets differ:\n light: ${light}\n ${scope}: ${keys}`);
  }
  assert("night" in THEME, "expected the Leaderboard's night scope to exist and be checked");
  assert(cssVars("light").includes("--accent-ink:") && cssVars("dark").includes("--on-accent:"), "cssVars should emit kebab-case names");
});

await runTest("every var(--x) the app paints with is a token or is set somewhere", async () => {
  // The silent one. A name that is in NO scope is not caught by the same-token-set check above - that holds
  // the scopes to each other, and a name none of them has is missing from all of them equally. `var(--lamp)`
  // was the sitewide 20-0 bar's fill, defined nowhere, so the bar rendered its correct width in no colour at
  // all and looked empty from the day it shipped. Nothing else in the suite could see it: it is not text, so
  // no contrast rule applies, and the element is there in the DOM with the right geometry.
  const files = ["perfect-season.jsx", "profile.jsx", "shop.jsx", "cosmetics.jsx", "moderation.jsx",
                 "avatars.jsx", "avatar-picker.jsx", "ui-common.jsx", "versus.jsx"];
  const tokens = new Set(Object.keys(THEME.light).map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`));
  const used = new Map();
  const set = new Set();
  for (const f of files) {
    // Block comments go first, and they cover both kinds here - the stylesheet's /* */ and JSX's
    // {/* */}. A comment explaining a bad name would otherwise BE the bad name, which is how this
    // first ran: the note left where var(--lamp) used to be failed the test that replaced it.
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(f);
    }
    // Set as a CSS declaration (`--x:`) or as a style-object key, which carries its quote (`"--x":`) - the
    // team colours, the card themes and the mode tints all arrive that way and are perfectly legitimate.
    for (const m of text.matchAll(/(--[a-z0-9-]+)["']?\s*:/gi)) set.add(m[1]);
  }
  assert(used.size > 40, `found the custom properties the app uses, got ${used.size}`);
  const missing = [...used.keys()].filter((v) => !tokens.has(v) && !set.has(v));
  assert(missing.length === 0, `painted with a custom property nothing ever sets:\n  ${
    missing.map((v) => `${v} (in ${[...used.get(v)].join(", ")})`).join("\n  ")}`);
});

console.log("test-theme-contrast.mjs done");
