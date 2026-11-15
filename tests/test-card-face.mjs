// A card, drawn: the recolouring arithmetic with no canvas, what the card says aloud, that every text colour on
// it is readable, and - the part that matters when something goes wrong - that a card with no sprite is still a
// card. The recolouring itself only RUNS in a real browser; tools/ui-harness (screen=cardface) is where to look.
import { readFileSync } from "node:fs";
import { setupDom, loadModule, renderComponent, flush, assert, runTest } from "./helpers.mjs";

setupDom();
const sprites = await loadModule("card-sprites.mjs");
const face = await loadModule("card-face.jsx");
const logic = await import("../card-logic.mjs");
const { TEAMS } = await import("../game-logic.mjs");
logic.initCardData(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));
const all = [...logic.CARDS.values()];
const find = (name, season) => all.find((c) => c.name === name && c.season === season);

// The same WCAG math as tests/test-theme-contrast.mjs and tests/test-cosmetics.mjs.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hueOf = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0;
  const d = mx - mn; const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60;
};

await runTest("recolouring changes what a pixel is a shade OF, and nothing else", async () => {
  // jersey blue (mid), jersey blue (a darker fold), helmet grey, skin tan, a white glove, a black outline, clear paper
  const px = [[46, 102, 196, 255], [28, 64, 128, 255], [172, 172, 172, 255], [198, 140, 96, 255], [252, 252, 250, 255], [16, 16, 18, 255], [0, 0, 0, 0]];
  const data = new Uint8ClampedArray(px.flat());
  const out = sprites.recolourPixels(data, { jersey: "#4f2683", metal: "#ffc62f", skin: "#6f4329" });
  const at = (i) => [...out.slice(i * 4, i * 4 + 4)];
  assert(out !== data && data[0] === 46, "it returns a new array and leaves the one it was given alone");
  const purple = hueOf(0x4f, 0x26, 0x83), gold = hueOf(0xff, 0xc6, 0x2f), brown = hueOf(0x6f, 0x43, 0x29);
  assert(Math.abs(hueOf(...at(0)) - purple) < 3, "the jersey takes the jersey colour's hue: " + at(0));
  assert(Math.abs(hueOf(...at(1)) - purple) < 3, "so does the fold in it");
  const light = (p) => Math.max(p[0], p[1], p[2]) + Math.min(p[0], p[1], p[2]);
  assert(light(at(1)) < light(at(0)), "and the fold is still darker than the cloth beside it");
  assert(Math.abs(hueOf(...at(2)) - gold) < 4, "the helmet takes the second colour: " + at(2));
  assert(Math.abs(hueOf(...at(3)) - brown) < 4, "the skin takes the skin tone: " + at(3));
  // Hue alone would pass with the shading thrown away, or with every colour at full saturation. The mid-tone
  // pixel of each region has to land ON the target colour, since it is that region's middle.
  const near = (got, want) => got.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 6);
  assert(near(at(3), [0x6f, 0x43, 0x29]), "the only skin pixel is the skin tone itself: " + at(3));
  assert(JSON.stringify(at(4)) === JSON.stringify(px[4]), "a white glove is left exactly as drawn");
  assert(JSON.stringify(at(5)) === JSON.stringify(px[5]), "so is the outline");
  assert(JSON.stringify(at(6)) === JSON.stringify(px[6]), "and clear paper stays clear");
  for (let i = 0; i < px.length; i++) assert(out[i * 4 + 3] === px[i][3], "alpha is never touched");
  assert(sprites.recolourPixels(new Uint8ClampedArray(0), { jersey: "#000000", metal: "#000000", skin: "#000000" }).length === 0, "an empty image is an empty image");
});

await runTest("grey and tan are decided a region at a time, so nothing is scrubbed and nothing bleeds", async () => {
  // Reported from the owner's phone on the test site (v2.24.1): helmets with their highlights left grey, the
  // helmet colour on gloves and cleats, a pale rim round dark skin. One pixel cannot say which grey it is.
  const K = [16, 16, 18, 255], grey = [172, 172, 172, 255], shine = [226, 226, 226, 255], white = [252, 252, 250, 255];
  const shadow = [190, 190, 190, 255], tan = [198, 140, 96, 255], edge = [120, 80, 52, 255], ball = [110, 60, 36, 255];
  // row 0: a helmet - four greys and its highlight | outline | a glove - four whites and its shadow
  // row 1: an arm - four tans and its darker edge  | outline | the ball - five browns
  const rows = [[grey, grey, shine, grey, grey, K, white, white, shadow, white, white], [tan, tan, tan, tan, edge, K, ball, ball, ball, ball, ball]];
  const data = new Uint8ClampedArray(rows.flat().flat());
  const out = sprites.recolourPixels(data, { jersey: "#4f2683", metal: "#c60c30", skin: "#5f3b26" }, 11);
  const at = (x, y) => [...out.slice((y * 11 + x) * 4, (y * 11 + x) * 4 + 3)];
  const same = (x, y) => JSON.stringify(at(x, y)) === JSON.stringify(rows[y][x].slice(0, 3));
  const red = hueOf(0xc6, 0x0c, 0x30), brown = hueOf(0x5f, 0x3b, 0x26);
  const hueNear = (p, want) => Math.min(Math.abs(hueOf(...p) - want), 360 - Math.abs(hueOf(...p) - want)) < 6;
  assert(hueNear(at(0, 0), red), "the helmet takes the helmet colour: " + at(0, 0));
  assert(hueNear(at(2, 0), red) && at(2, 0)[0] - at(2, 0)[1] > 40, "and so does its highlight - left grey, that is the scrubbed helmet: " + at(2, 0));
  assert(at(2, 0)[1] > at(0, 0)[1], "which is still lighter than the helmet round it");
  assert(same(8, 0), "a white glove's shadow is the same grey as a helmet and is left alone: " + at(8, 0));
  assert(same(6, 0), "and the glove is still white");
  assert(hueNear(at(4, 1), brown) && at(4, 1)[0] < at(0, 1)[0], "the dark edge of an arm takes the skin tone too, darker - left tan, that is the pale rim: " + at(4, 1));
  assert(same(6, 1), "the ball is brown, and is nobody's skin: " + at(6, 1));
  // a helmet's own white - a stripe drawn against it with no outline between - stays white
  const strip = new Uint8ClampedArray([grey, grey, grey, grey, white, grey, grey, grey].flat());
  const s = sprites.recolourPixels(strip, { jersey: "#4f2683", metal: "#c60c30", skin: "#5f3b26" }, 8);
  assert(JSON.stringify([...s.slice(16, 19)]) === JSON.stringify(white.slice(0, 3)), "a white stripe inside the pants stays white");
});

await runTest("a card's colours are its team's and its player's", async () => {
  const peterson = find("Adrian Peterson", 2012);
  const c = sprites.cardColours(peterson);
  assert(c.jersey === TEAMS.MIN[2] && c.metal === TEAMS.MIN[3], "the team's two colours: " + JSON.stringify(c));
  const skin = JSON.parse(readFileSync(new URL("../data/card-skin.json", import.meta.url), "utf8"));
  // The list is a first pass the owner corrects (tools/cards/build-card-skin.mjs). What is held here is that
  // it can only say true things about the catalog: every key a real player, every tone a real tone.
  const pids = new Set(all.map((card) => String(card.pid)));
  const listed = Object.entries(skin.players);
  assert(listed.every(([pid]) => pids.has(pid)), "every listed pid is a player in the catalog");
  assert(listed.every(([, tone]) => Object.hasOwn(skin.tones, tone)), "every listed tone is one of the tones");
  const unlisted = all.find((card) => !Object.hasOwn(skin.players, card.pid));
  assert(unlisted && sprites.cardColours(unlisted).skin === skin.default, "a player nobody was sure of wears the default");
  assert(sprites.cardColours(peterson, { ...skin, players: {} }).skin === skin.default, "and so does everyone when the list is empty");
  const withTone = { ...skin, players: { [peterson.pid]: "t4" } };
  assert(sprites.cardColours(peterson, withTone).skin === skin.tones.t4, "a recorded tone is used");
  assert(sprites.skinFor(peterson.pid, { ...skin, players: { [peterson.pid]: "nope" } }) === skin.default, "a tone key that does not exist falls back to the default");
  assert(sprites.cardColours({ team: "XXX", pid: 1 }).jersey.startsWith("#"), "a team the game does not know still gets a colour");
  assert(sprites.spriteFor(find("Tom Brady", 2007)) === "/cards/gunslinger.webp", "a gunslinger's sprite");
  assert(sprites.spriteFor(all.find((x) => x.archetype === "role")) === "/cards/role.webp", "a role player's");
  for (const a of logic.ARCHETYPES) assert(readFileSync(new URL(`../static/cards/${a.id}.webp`, import.meta.url)).length > 1000, `there is a drawing for ${a.id}`);
});

await runTest("a card says who it is, in words", async () => {
  const brady = find("Tom Brady", 2007);
  const label = face.cardLabel(brady, "prism", 3);
  for (const part of ["2007 Tom Brady", "New England Patriots", "quarterback", `rated ${Math.round(brady.rating)} plus 15`, "Gunslinger", "Prism finish", "passing yards", "touchdowns", "yards per attempt", "3 copies"]) {
    assert(label.includes(part), `the label says "${part}": ${label}`);
  }
  assert(!face.cardLabel(brady, "base", 1).includes("plus") && !face.cardLabel(brady, "base", 1).includes("copies"), "a single Base card mentions neither a bonus nor copies");
  const labels = { QB: "Yd/att", RB: "Yd/car", WR: "Yd/rec", TE: "Yd/rec" };
  for (const pos of Object.keys(labels)) {
    const stats = face.cardStats(all.find((c) => c.pos === pos));
    assert(stats.length === 3 && stats[2][1] === labels[pos] && stats[1][1] === "TD", `${pos} shows yards, touchdowns and ${labels[pos]}`);
  }
  assert(face.cardStats({ pos: "RB", ry: 0, rtd: 0, car: 0 })[2][0] === "0.0", "no carries is 0.0 a carry, not NaN");
});

await runTest("the card on screen", async () => {
  const brady = find("Tom Brady", 2007);
  const { container, unmount } = await renderComponent(face.CardFace, { card: brady, finish: "gold", count: 3 });
  await flush();
  const el = container.querySelector("[data-card]");
  assert(el && el.getAttribute("role") === "img" && el.getAttribute("aria-label") === face.cardLabel(brady, "gold", 3), "one image, with the label");
  assert(el.dataset.card === String(brady.id) && el.dataset.finish === "gold" && el.classList.contains("cd-f-gold"), "it says which card and which finish");
  assert(el.querySelector(".cd-ovr").textContent === `${Math.round(brady.rating)}+10`, "a Gold card shows its +10: " + el.querySelector(".cd-ovr").textContent);
  assert(el.querySelector(".cd-count").textContent === "x3", "three copies shows x3");
  assert(el.querySelector(".cd-fin").textContent === "Gold" && el.querySelector(".cd-arch").textContent === "Gunslinger", "the finish and the archetype are words on the card");
  assert(el.querySelector(".cd-in").getAttribute("aria-hidden") === "true", "the printed card is hidden from a screen reader, which has the label");
  // No canvas in jsdom, and no image ever loads: the card is on its neutral sprite, and it is a whole card.
  const img = el.querySelector("img.cd-fig");
  assert(img.getAttribute("src") === "/cards/gunslinger.webp" && img.getAttribute("alt") === "", "the neutral sprite, decorative");
  img.dispatchEvent(new window.Event("error"));
  await flush();
  assert(img.hidden === true, "a sprite that fails to load is taken away rather than left as a broken image");
  assert(container.querySelector(".cd-nm").textContent.includes("Brady") && container.querySelector(".cd-st").textContent.includes("Pass yd"), "a sprite that fails to load leaves the name and the stats");
  unmount?.();

  const one = await renderComponent(face.CardFace, { card: all.find((c) => c.archetype === "role") });
  await flush();
  const plain = one.container.querySelector("[data-card]");
  assert(plain.dataset.finish === "base" && !plain.querySelector(".cd-count") && !plain.querySelector(".cd-ovr small"), "a single Base card has no count badge and no bonus");
  assert(plain.querySelector(".cd-arch").classList.contains("cd-role"), "a role player's label is the quiet one");
  one.unmount?.();
});

await runTest("in a browser that can paint: the sprite is recoloured once, and remembered", async () => {
  // jsdom loads no image and has no canvas, so the path a real browser takes - new Image, onload, paint, swap -
  // ran in no test until review pointed it out. Both are stubbed here, just far enough to walk it.
  let images = 0;
  const RealImage = window.Image, realGet = window.HTMLCanvasElement.prototype.getContext, realUrl = window.HTMLCanvasElement.prototype.toDataURL;
  window.Image = globalThis.Image = class { constructor() { images++; this.naturalWidth = 2; this.naturalHeight = 2; } set src(v) { this._src = v; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16) }), putImageData() {} });
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,PAINTED";
  try {
    const card = find("Antonio Gates", 2005);
    const a = await renderComponent(face.CardFace, { card });
    await flush();
    const img = a.container.querySelector("img.cd-fig");
    assert(img.getAttribute("src") === "data:image/png;base64,PAINTED", "the sprite was painted and swapped in: " + img.getAttribute("src").slice(0, 40));
    assert(images === 1, "from one image load");
    a.unmount?.();
    // The same card again - a filter flipped, a second copy on screen. It must START painted, with no second
    // load: starting on the neutral sprite made every card flash blue each time the grid re-drew.
    const b = await renderComponent(face.CardFace, { card });
    assert(b.container.querySelector("img.cd-fig").getAttribute("src") === "data:image/png;base64,PAINTED", "a card painted before starts painted");
    await flush();
    assert(images === 1, `and loads nothing again (${images} image loads)`);
    // The store of painted sprites is bounded: thousands of cards across 32 teams must not grow it for ever.
    for (let i = 0; i < sprites.PAINT_CACHE_MAX + 40; i++) sprites.paintSprite(new window.Image(), { jersey: "#" + String(100000 + i), metal: "#111111", skin: "#222222" }, "/cards/role.png");
    assert(sprites.paintedCount() <= sprites.PAINT_CACHE_MAX, `the paint store stops at ${sprites.PAINT_CACHE_MAX} (${sprites.paintedCount()})`);
    b.unmount?.();
  } finally {
    window.Image = globalThis.Image = RealImage; window.HTMLCanvasElement.prototype.getContext = realGet; window.HTMLCanvasElement.prototype.toDataURL = realUrl;
  }
});

await runTest("a sprite is painted no bigger than a card draws it, and a grid's sprites one a frame", async () => {
  // The owner's collection reached 600 cards on a phone and "it lags super bad". Profiled in Chrome: every card
  // painted its 546x640 sprite at full size and encoded it (two thirds of the time was the encoding), and a
  // grid's paints all ran in one unbroken stretch - 1.7 seconds for 24 cards on a desktop, with the page frozen.
  const React = (await import("react")).default;
  const act = React.act;
  const drawn = [];
  let paints = 0;
  const RealImage = window.Image, realGet = window.HTMLCanvasElement.prototype.getContext, realUrl = window.HTMLCanvasElement.prototype.toDataURL;
  const realFrame = globalThis.requestAnimationFrame;
  let size = [546, 640];
  window.Image = globalThis.Image = class { constructor() { [this.naturalWidth, this.naturalHeight] = size; } set src(v) { this._src = v; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } };
  window.HTMLCanvasElement.prototype.getContext = function () { const canvas = this; return { drawImage(img, x, y, w, h) { drawn.push([canvas.width, canvas.height, w, h]); }, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }; };
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,P" + (++paints);
  const frames = [];
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const frame = () => act(async () => { const run = frames.splice(0); for (const fn of run) fn(); await Promise.resolve(); });
  try {
    // THE SIZE. A figure is 118/172 of its card, the widest card is 172px, and the densest phones have three
    // pixels to one: 354. Painting all 640 rows was three times the pixels anybody would ever see.
    assert(sprites.PAINT_HEIGHT >= 354 && sprites.PAINT_HEIGHT <= 400, "tall enough for the largest card on a three-to-one screen, and no taller: " + sprites.PAINT_HEIGHT);
    sprites.paintSprite(new window.Image(), { jersey: "#123456", metal: "#111111", skin: "#222222" }, "/cards/size-big.webp");
    const [cw, ch, dw, dh] = drawn.at(-1);
    assert(ch === sprites.PAINT_HEIGHT && cw === Math.round(546 * sprites.PAINT_HEIGHT / 640) && dw === cw && dh === ch, "a 546x640 sprite is painted " + cw + "x" + ch + ", drawn to fill it");
    size = [170, 200];
    sprites.paintSprite(new window.Image(), { jersey: "#123457", metal: "#111111", skin: "#222222" }, "/cards/size-small.webp");
    assert(drawn.at(-1)[0] === 170 && drawn.at(-1)[1] === 200, "and a sprite smaller than that is not blown up: " + drawn.at(-1));
    size = [546, 640];

    // ONE A FRAME. Twelve role players of twelve teams, mounted together like a grid.
    const twelve = [];
    for (const c of all) { if (c.archetype === "role" && c.pos === "WR" && !twelve.some((x) => x.team === c.team) && !sprites.paintedSprite(sprites.spriteFor(c), sprites.cardColours(c))) twelve.push(c); if (twelve.length === 12) break; }
    assert(twelve.length === 12, "twelve cards that need twelve different paints");
    const Grid = ({ cards }) => React.createElement("div", null, cards.map((c) => React.createElement(face.CardFace, { key: c.id, card: c })));
    paints = 0; frames.length = 0;
    const g = await renderComponent(Grid, { cards: twelve });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const painted = () => [...g.container.querySelectorAll("img.cd-fig")].filter((img) => img.getAttribute("src").startsWith("data:")).length;
    assert(paints === 0 && painted() === 0 && frames.length === 1, "the images have loaded and nothing is painted yet - it waits for a frame: " + paints + " " + frames.length);
    await frame();
    assert(paints === 1 && painted() === 1, "the first frame paints ONE, and that card has it: " + paints + " " + painted());
    await frame(); await frame();
    assert(paints === 3 && painted() === 3, "one more each frame: " + paints);
    for (let n = 0; n < 12 && frames.length; n++) await frame();
    assert(paints === 12 && painted() === 12 && frames.length === 0, "until all twelve are painted, and then it stops asking for frames: " + paints + " " + frames.length);
    await act(async () => { g.reactRoot.unmount(); });

    // The same sprite in the same colours is painted once however many cards wear it, and a card that has gone
    // before its turn is not painted for nobody.
    const fresh = all.filter((c) => c.archetype === "role" && c.pos === "TE" && !twelve.some((x) => x.team === c.team) && !sprites.paintedSprite(sprites.spriteFor(c), sprites.cardColours(c)));
    const same = fresh.filter((c) => c.team === fresh[0].team && sprites.cardColours(c).skin === sprites.cardColours(fresh[0]).skin).slice(0, 2);
    const other = fresh.find((c) => c.team !== fresh[0].team);
    assert(same.length === 2 && other, "two cards that share a paint, and one that does not");
    paints = 0; frames.length = 0;
    const h = await renderComponent(Grid, { cards: [...same, other] });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { h.reactRoot.render(React.createElement(Grid, { cards: same })); }); // the third card leaves
    for (let n = 0; n < 6 && frames.length; n++) await frame();
    assert(paints === 1, "two cards in one sprite and colours are one paint, and the card that left is none: " + paints);
    assert([...h.container.querySelectorAll("img.cd-fig")].every((img) => img.getAttribute("src").startsWith("data:")), "and both cards wear it");
    await act(async () => { h.reactRoot.unmount(); });
  } finally {
    window.Image = globalThis.Image = RealImage; window.HTMLCanvasElement.prototype.getContext = realGet; window.HTMLCanvasElement.prototype.toDataURL = realUrl;
    globalThis.requestAnimationFrame = window.requestAnimationFrame = realFrame;
  }
});

await runTest("painting a sprite with no canvas answers null and never throws", async () => {
  const none = sprites.paintSprite({ src: "http://localhost/cards/role.png", naturalWidth: 10, naturalHeight: 10 }, { jersey: "#0a0b0c", metal: "#111111", skin: "#222222" }, "/cards/nocanvas.png");
  assert(none === null, "no canvas, no painted sprite: " + none);
});

await runTest("every piece of text on a card is readable", async () => {
  assert(face.CARD_TEXT_PAIRS.length >= 12, "the card lists its text colours");
  for (const [fg, bg, what] of face.CARD_TEXT_PAIRS) {
    const ratio = contrast(fg, bg);
    assert(ratio >= 4.5, `${what}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, under AA`);
  }
  // The pairs are only worth holding if the stylesheet is built from the same colours.
  for (const colour of Object.values(face.CARD_PAINT)) assert(face.CARD_FACE_CSS.includes(colour), `${colour} from CARD_PAINT is in the stylesheet`);
  assert(/prefers-reduced-motion:reduce\)\{[^}]*animation:none/.test(face.CARD_FACE_CSS), "the foil stops for reduced motion");
  assert(!/transform:[^;]*(translate|rotate|scale)[^;]*;[^}]*animation/.test(face.CARD_FACE_CSS.replace(/translateX\(-50%\)/g, "")), "the finishes move a background, not the card");
});

console.log("test-card-face.mjs done");
