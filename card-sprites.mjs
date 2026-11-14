// Putting a team's colours on a neutral sprite, in the browser. See CARDS.md.
//
// static/cards/<pose>.webp is one drawing per archetype in the sheets' own colours: blue jersey, grey helmet and
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
// The middle lightness of the pixels of one kind (brighter than `above`), from a count of each of 256 levels:
// a sprite is a quarter of a million pixels, and sorting them was a visible share of painting one.
function midLight(kind, light, want, above) {
  const counts = new Uint32Array(256); let total = 0;
  for (let p = 0; p < kind.length; p++) if (kind[p] === want && light[p] > above) { counts[Math.round(light[p] * 255)]++; total++; }
  if (!total) return 0.5;
  let seen = 0;
  for (let v = 0; v < 256; v++) { seen += counts[v]; if (seen * 2 > total) return v / 255; }
  return 0.5;
}

// What a neutral pixel MIGHT be, by its colour. The ranges are the sheets': measured on the owner's blue, grey
// and tan. Blue is always jersey. Grey and warm are only families - the region decides (see the top of the file).
const JERSEY = 1, METAL = 2, SKIN = 3;
const GREY = 2, WARM = 3; // a family shares its number with the kind it may become
// (Grey is settled before this is asked - recolourPixels tests it first, since it needs no hue.)
function familyOf(h, s, l) {
  if (h > 195 && h < 250 && s > 0.28 && l > 0.12 && l < 0.8) return JERSEY;
  if (h > 8 && h < 48 && s > 0.2 && l > 0.15 && l < 0.9) return WARM; // skin - and the ball
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

// Cut one family's pixels into connected regions. Each region whose share of pixels passing `test` (on
// lightness) reaches `need` has every pixel's kind set to that family's. One queue for the whole image, and no
// allocation per pixel: this runs on every card the first time it is painted.
function settleRegions(family, want, w, n, light, kind, test, need) {
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (family[start] !== want || seen[start]) continue;
    let size = 1, pass = 0; queue[0] = start; seen[start] = 1;
    for (let at = 0; at < size; at++) {
      const i = queue[at], x = i % w;
      if (test(light[i])) pass++;
      let j = i - 1; if (x > 0 && family[j] === want && !seen[j]) { seen[j] = 1; queue[size++] = j; }
      j = i + 1; if (x < w - 1 && family[j] === want && !seen[j]) { seen[j] = 1; queue[size++] = j; }
      j = i - w; if (j >= 0 && family[j] === want && !seen[j]) { seen[j] = 1; queue[size++] = j; }
      j = i + w; if (j < n && family[j] === want && !seen[j]) { seen[j] = 1; queue[size++] = j; }
    }
    if (pass / size >= need) for (let at = 0; at < size; at++) kind[queue[at]] = want;
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
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const l = (mx + mn) / 510; light[p] = l;
    if (l > 0.3 && mx - mn < 40) { family[p] = GREY; continue; } // helmet, pants - and every white thing
    if (mx === mn) continue;
    const d = mx - mn, s = l > 0.5 ? d / (510 - mx - mn) : d / (mx + mn);
    const h = 60 * (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
    family[p] = familyOf(h, s, l);
    if (family[p] === JERSEY) kind[p] = JERSEY;
  }
  settleRegions(family, GREY, w, n, light, kind, (l) => l < GREY_IS_MID, METAL_SHARE);
  settleRegions(family, WARM, w, n, light, kind, (l) => l > SKIN_IS_LIGHT, SKIN_SHARE);
  // the lit skin is its middle, not its shadow or its edge
  const mid = { [JERSEY]: midLight(kind, light, JERSEY, 0), [SKIN]: midLight(kind, light, SKIN, 0.45), [METAL]: METAL_MID };
  const to = { [JERSEY]: hsl(...hex(colours.jersey)), [METAL]: hsl(...hex(colours.metal)), [SKIN]: hsl(...hex(colours.skin)) };
  // A pixel's new colour depends only on its kind and its lightness, so each kind gets a table of 256 colours
  // and the image is a lookup - the colour maths runs 768 times, not once a pixel.
  const table = {};
  for (const k of [JERSEY, METAL, SKIN]) {
    const [h, s, l] = to[k], t = table[k] = new Float32Array(256 * 3);
    for (let v = 0; v < 256; v++) t.set(rgb(h, s, Math.min(0.95, Math.max(0.03, l * (v / 255) / mid[k]))), v * 3);
  }
  const out = new Uint8ClampedArray(data);
  for (let p = 0; p < n; p++) {
    const k = kind[p];
    if (!k) continue;
    const t = table[k], v = Math.round(light[p] * 255) * 3, i = p * 4;
    // how much of the ORIGINAL this pixel keeps: none of it, except a helmet's whites
    const keep = k === METAL ? Math.min(1, Math.max(0, (light[p] - WHITE_FROM) / (WHITE_TO - WHITE_FROM))) : 0;
    out[i] = t[v] * (1 - keep) + data[i] * keep;
    out[i + 1] = t[v + 1] * (1 - keep) + data[i + 1] * keep;
    out[i + 2] = t[v + 2] * (1 - keep) + data[i + 2] * keep;
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
export const spriteFor = (card) => `${spriteBase()}/${card.archetype || ROLE_PLAYER}.webp`;
// A pack's picture. card-packs.mjs names it from the site root (/cards/packs/<id>.webp); this is that address
// with the same movable base the sprites have, so the harness finds it too.
export const packArt = (pack) => `${spriteBase()}${pack.art.replace(/^\/cards/, "")}`;

// Painted sprites, remembered by pose and colours: a team's gunslinger is painted once however many cards wear
// it, and a card that has been painted before starts painted (card-face.jsx asks paintedSprite first) instead
// of flashing the neutral blue every time a grid re-draws.
//
// BOUNDED, oldest out first. Each entry is a data URL - 80 KB or so where the browser can write a WebP, and
// several times that where it cannot (Safari answers a PNG whatever it is asked for) - and there are fourteen
// poses times thirty-two teams times a handful of skin tones of them to be had; a collection screen scrolled
// for an evening must not hold them all.
export const PAINT_CACHE_MAX = 96;
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
    url = canvas.toDataURL("image/webp", 0.92); // a browser that cannot answers a PNG, which is fine
  } catch {
    url = null;
  }
  if (url) {
    painted.set(key, url);
    while (painted.size > PAINT_CACHE_MAX) painted.delete(painted.keys().next().value);
  }
  return url;
}
