// Putting a team's colours on a neutral sprite, in the browser. See CARDS.md.
//
// static/cards/<pose>.png is one drawing per archetype in the sheets' own colours: blue jersey, grey helmet and
// pants, tan skin (tools/cards/build-sprites.mjs cuts them). This module turns one into a particular card's
// player - that team's two colours and that player's skin tone - so fourteen images serve all 3,124 cards and
// there is no file per team.
//
// It keeps every pixel's SHADING and changes what it is a shade OF: its new colour takes the target's hue and
// saturation with the pixel's own lightness scaled against the middle tone of its region. So a fold in the
// jersey is still a fold, in purple.
//
// GREY AND TAN ARE DECIDED A REGION AT A TIME, NOT A PIXEL AT A TIME (v2.24.2). A helmet's highlight and a white
// glove's shadow are the same grey, and a ball's shine is the same tan as a forearm, so no test on one pixel
// can tell them apart - the first version tried, and the owner's phone showed the result: helmets with their
// highlights scrubbed back to grey, the helmet colour bleeding onto gloves and cleats, and a pale dotted rim
// round every dark-skinned arm where the edge pixels fell outside the range. So the grey pixels are cut into
// connected regions (the black outlines are what separate them) and each region is helmet-or-pants as a WHOLE
// when enough of it is mid grey, or white kit as a whole when it is not. Skin and the ball go the same way.
//
// recolourPixels is pure - a typed array in, a typed array out - so tests/test-card-face.mjs holds the mapping
// with no canvas. paintSprite is the only part that touches the DOM, and it answers null rather than throw when
// there is no canvas to be had, so a card whose sprite cannot be painted still draws with the neutral one.
//
// KNOWN LIMITS: the helmet and the pants are the same grey on the owner's sheets, so they take the same colour;
// telling them apart needs a sheet that paints them differently. And a region is only as good as its outline:
// where a sheet draws a white stripe against the pants with no line between, they are one region, and the
// stripe stays white only because of the fade.
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

// What a neutral pixel MIGHT be, by its colour. The ranges are the sheets': measured on the owner's blue, grey
// and tan. Blue is always jersey. Grey and warm are only families - the region decides (see the top of the file).
const JERSEY = 1, METAL = 2, SKIN = 3;
const GREY = 2, WARM = 3; // a family shares its number with the kind it may become
function familyOf(r, g, b, h, s, l) {
  if (h > 195 && h < 250 && s > 0.28 && l > 0.12 && l < 0.8) return JERSEY;
  if (l > 0.3 && Math.max(r, g, b) - Math.min(r, g, b) < 40) return GREY; // helmet, pants - and every white thing
  if (h > 8 && h < 48 && s > 0.2 && l > 0.15 && l < 0.9) return WARM;      // skin - and the ball
  return 0; // outlines and anything else: left exactly as drawn
}
const METAL_MID = 0.68;   // the helmet's middle grey on the sheets; skin and jersey take theirs from the sprite
const GREY_IS_MID = 0.86; // darker than this is a grey; lighter is a white, or a highlight
const METAL_SHARE = 0.42; // a grey region this much mid grey is helmet or pants. Measured over the fourteen
                          // sheets: helmets and pants run 47-100%, gloves, cleats and facemasks 1-37%.
const WHITE_FROM = 0.84, WHITE_TO = 0.95; // inside a helmet, a grey fades back to white across this range, so a
                                          // highlight has no hard edge and a white stripe in the pants stays white
const SKIN_IS_LIGHT = 0.4, SKIN_SHARE = 0.5;  // a warm region mostly lighter than this is skin (its shadow under a
                                              // facemask included); the ball is darker still

// Cut one family's pixels into connected regions and call `decide` on each (a list of pixel indexes).
function eachRegion(family, want, w, n, decide) {
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (family[start] !== want || seen[start]) continue;
    const region = [start]; seen[start] = 1;
    for (let at = 0; at < region.length; at++) {
      const i = region[at], x = i % w;
      const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of near) if (j >= 0 && j < n && family[j] === want && !seen[j]) { seen[j] = 1; region.push(j); }
    }
    decide(region);
  }
}

// data: RGBA bytes, `width` pixels to a row (one row if not given). colours: { jersey, metal, skin } as "#rrggbb".
// Returns a NEW array; alpha is never touched.
export function recolourPixels(data, colours, width) {
  const n = data.length / 4, w = width > 0 ? width : n || 1;
  const family = new Uint8Array(n), kind = new Uint8Array(n), light = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] === 0) continue;
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    const [h, s, l] = hsl(r, g, b);
    family[p] = familyOf(r, g, b, h, s, l); light[p] = l;
    if (family[p] === JERSEY) kind[p] = JERSEY;
  }
  const share = (region, test) => region.reduce((c, i) => c + (test(light[i]) ? 1 : 0), 0) / region.length;
  eachRegion(family, GREY, w, n, (region) => {
    if (share(region, (l) => l < GREY_IS_MID) >= METAL_SHARE) for (const i of region) kind[i] = METAL;
  });
  eachRegion(family, WARM, w, n, (region) => {
    if (share(region, (l) => l > SKIN_IS_LIGHT) >= SKIN_SHARE) for (const i of region) kind[i] = SKIN;
  });
  const jerseyL = [], skinL = [];
  for (let p = 0; p < n; p++) {
    if (kind[p] === JERSEY) jerseyL.push(light[p]);
    else if (kind[p] === SKIN && light[p] > 0.45) skinL.push(light[p]); // the lit skin, not its shadow or its edge
  }
  const mid = { [JERSEY]: median(jerseyL), [SKIN]: median(skinL), [METAL]: METAL_MID };
  const to = { [JERSEY]: hsl(...hex(colours.jersey)), [METAL]: hsl(...hex(colours.metal)), [SKIN]: hsl(...hex(colours.skin)) };
  const out = new Uint8ClampedArray(data);
  for (let p = 0; p < n; p++) {
    const k = kind[p];
    if (!k) continue;
    const [h, s, l] = to[k];
    const c = rgb(h, s, Math.min(0.95, Math.max(0.03, l * light[p] / mid[k])));
    // how much of the new colour this pixel takes: all of it, except a helmet's whites
    const keep = k === METAL ? Math.min(1, Math.max(0, (light[p] - WHITE_FROM) / (WHITE_TO - WHITE_FROM))) : 0;
    for (let ch = 0; ch < 3; ch++) out[p * 4 + ch] = c[ch] * (1 - keep) + data[p * 4 + ch] * keep;
  }
  return out;
}

// A player's skin tone. data/card-skin.json maps a pid to one of a handful of tones; anybody not in it gets the
// default. The list is a first pass awaiting the owner's correction (tools/cards/build-card-skin.mjs writes it
// from lists of names); anybody nobody was sure of is absent and wears the default - a wrong tone
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
// A pack's picture. card-packs.mjs names it from the site root (/cards/packs/<id>.webp); this is that address
// with the same movable base the sprites have, so the harness finds it too.
export const packArt = (pack) => `${spriteBase()}${pack.art.replace(/^\/cards/, "")}`;

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
    image.data.set(recolourPixels(image.data, colours, canvas.width));
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
