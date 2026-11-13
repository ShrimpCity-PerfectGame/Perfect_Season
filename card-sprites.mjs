// Putting a team's colours on a neutral sprite, in the browser. See CARDS.md.
//
// static/cards/<pose>.png is one drawing per archetype in the sheets' own colours: blue jersey, grey helmet and
// pants, tan skin (tools/cards/build-sprites.mjs cuts them). This module turns one into a particular card's
// player - that team's two colours and that player's skin tone - so fourteen images serve all 3,124 cards and
// there is no file per team.
//
// It keeps every pixel's SHADING and changes what it is a shade OF: a pixel is recognised by its hue, and its
// new colour takes the target's hue and saturation with the pixel's own lightness scaled against the middle
// tone of its region. So a fold in the jersey is still a fold, in purple.
//
// recolourPixels is pure - a typed array in, a typed array out - so tests/test-card-face.mjs holds the mapping
// with no canvas. paintSprite is the only part that touches the DOM, and it answers null rather than throw when
// there is no canvas to be had, so a card whose sprite cannot be painted still draws with the neutral one.
//
// KNOWN LIMIT: the helmet and the pants are the same grey on the owner's sheets, so they take the same colour.
// Telling them apart needs a sheet that paints them differently.
import { TEAMS } from "./game-logic.mjs";
import { ROLE_PLAYER } from "./card-logic.mjs";
import skinData from "./data/card-skin.json" with { type: "json" };

const hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
};
const rgb = (h, s, l) => {
  h /= 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const t = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return [t(h + 1 / 3) * 255, t(h) * 255, t(h - 1 / 3) * 255];
};
const hex = (x) => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)];
const median = (xs) => { if (!xs.length) return 0.5; xs.sort((a, b) => a - b); return xs[xs.length >> 1]; };

// What a neutral pixel IS, by its colour. The ranges are the sheets': measured on the owner's blue, grey and tan.
const JERSEY = 1, METAL = 2, SKIN = 3;
function kindOf(h, s, l) {
  if (h > 195 && h < 250 && s > 0.28 && l > 0.12 && l < 0.8) return JERSEY;
  if (h > 14 && h < 42 && s > 0.28 && l > 0.45 && l < 0.85) return SKIN;
  if (s < 0.1 && l > 0.3 && l < 0.85) return METAL;
  return 0; // outlines, white gloves and cleats, the ball: left exactly as drawn
}
const METAL_MID = 0.68; // the helmet's middle grey on the sheets; skin and jersey take theirs from the sprite

// data: RGBA bytes. colours: { jersey, metal, skin } as "#rrggbb". Returns a NEW array; alpha is never touched.
export function recolourPixels(data, colours) {
  const n = data.length / 4;
  const kind = new Uint8Array(n), light = new Float32Array(n);
  const jerseyL = [], skinL = [];
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] === 0) continue;
    const [h, s, l] = hsl(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    kind[p] = kindOf(h, s, l); light[p] = l;
    if (kind[p] === JERSEY) jerseyL.push(l); else if (kind[p] === SKIN) skinL.push(l);
  }
  const mid = { [JERSEY]: median(jerseyL), [SKIN]: median(skinL), [METAL]: METAL_MID };
  const to = { [JERSEY]: hsl(...hex(colours.jersey)), [METAL]: hsl(...hex(colours.metal)), [SKIN]: hsl(...hex(colours.skin)) };
  const out = new Uint8ClampedArray(data);
  for (let p = 0; p < n; p++) {
    const k = kind[p];
    if (!k) continue;
    const [h, s, l] = to[k];
    const c = rgb(h, s, Math.min(0.95, Math.max(0.03, l * light[p] / mid[k])));
    out[p * 4] = c[0]; out[p * 4 + 1] = c[1]; out[p * 4 + 2] = c[2];
  }
  return out;
}

// A player's skin tone. data/card-skin.json maps a pid to one of a handful of tones; anybody not in it gets the
// default. The list is filled in by hand and is EMPTY for now, so every card wears the default - a wrong tone
// on a named real person is worse than a neutral one (the design, 3.2).
export function skinFor(pid, data = skinData) {
  const tone = data.players?.[pid];
  return (tone && data.tones?.[tone]) || data.default;
}
export function cardColours(card, data = skinData) {
  const team = TEAMS[card.team];
  return { jersey: team ? team[2] : "#3155ff", metal: team ? team[3] : "#c9ced8", skin: skinFor(card.pid, data) };
}
// The sprites are served from /cards (build.mjs copies static/ to the site root). window.__ps_card_base__ moves
// that for the UI harness, which serves the repo itself and so finds them under /static/cards.
const spriteBase = () => (typeof window !== "undefined" && window.__ps_card_base__) || "/cards";
export const spriteFor = (card) => `${spriteBase()}/${card.archetype || ROLE_PLAYER}.png`;

// Painted sprites, remembered by pose and colours: a team's gunslinger is painted once however many cards wear
// it, and a card that has been painted before starts painted (card-face.jsx asks paintedSprite first) instead
// of flashing the neutral blue every time a grid re-draws.
//
// BOUNDED, oldest out first. Each entry is a data URL of 100 KB or so, and there are fourteen poses times
// thirty-two teams times a handful of skin tones of them to be had; a collection screen scrolled for an evening
// must not hold them all.
export const PAINT_CACHE_MAX = 160;
const painted = new Map();
const paintKey = (path, colours) => `${path}|${colours.jersey}|${colours.metal}|${colours.skin}`;
export const paintedSprite = (path, colours) => painted.get(paintKey(path, colours)) || null;
export const paintedCount = () => painted.size;

// Paint a loaded neutral sprite in a card's colours: a data URL, or null if this browser cannot do it (no
// canvas, or a canvas that will not hand its pixels back). `path` is the sprite's own address as spriteFor gave
// it - the key must not be img.src, which the browser has made absolute and paintedSprite cannot reproduce.
export function paintSprite(img, colours, path = img.src) {
  const key = paintKey(path, colours);
  if (painted.has(key)) return painted.get(key);
  let url = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const image = g.getImageData(0, 0, canvas.width, canvas.height);
    image.data.set(recolourPixels(image.data, colours));
    g.putImageData(image, 0, 0);
    url = canvas.toDataURL("image/png");
  } catch {
    url = null;
  }
  if (url) {
    painted.set(key, url);
    while (painted.size > PAINT_CACHE_MAX) painted.delete(painted.keys().next().value);
  }
  return url;
}
