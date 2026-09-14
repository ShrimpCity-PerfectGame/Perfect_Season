// Every text color in both themes has to be readable against every surface it can sit on (WCAG AA,
// 4.5:1). Pure data check against theme.mjs - no DOM.
//
// The specific trap this exists for: electric lime is the brand accent and looks great as a fill,
// but as text on cream it's about 1.2:1. A single `color: var(--accent)` in the light scope would
// ship invisible text, and nothing else in the suite would notice.
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

for (const scope of ["light", "dark"]) {
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

await runTest("both scopes define exactly the same tokens", async () => {
  // A token missing from one scope silently inherits the other scope's value inside `.dark`
  // panels - e.g. cream text on cream.
  const light = Object.keys(THEME.light).sort().join(",");
  const dark = Object.keys(THEME.dark).sort().join(",");
  assert(light === dark, `token sets differ:\n light: ${light}\n dark:  ${dark}`);
  assert(cssVars("light").includes("--accent-ink:") && cssVars("dark").includes("--on-accent:"), "cssVars should emit kebab-case names");
});

console.log("test-theme-contrast.mjs done");
