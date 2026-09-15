// The avatar picker (avatar-picker.jsx) in jsdom: the tabs, choosing a default avatar, removing a
// picture, busy and error states, and framing an uploaded photo. jsdom can't decode or draw images, so
// the picker's imageTools are swapped for fakes; the real image work is tested in Chrome by
// test-avatar-image.mjs.
import { setupDom, loadModule, renderComponent, click, flush, type, assert, runTest, findButtonByText } from "./helpers.mjs";
import { FREE_AVATAR_PRESETS } from "../profile-rules.mjs";

setupDom();
// No canvas in jsdom: without this every preview draw logs "not implemented".
window.HTMLCanvasElement.prototype.getContext = () => null;
const { act } = await import("react-dom/test-utils");
const { AvatarPicker, imageTools } = await loadModule("avatar-picker.jsx");
const realTools = { ...imageTools };

let shown = null;
async function show(props) {
  if (shown) await act(async () => shown.reactRoot.unmount());
  shown = await renderComponent(AvatarPicker, props);
  return shown;
}
function spies(extra = {}) {
  const calls = { photo: [], preset: [], remove: 0, cancel: 0 };
  const props = {
    username: "shrimpcity", current: { photoUrl: null, preset: null }, busy: false, error: "",
    onPhoto: async (blob) => { calls.photo.push(blob); },
    onPreset: async (key) => { calls.preset.push(key); },
    onRemove: async () => { calls.remove++; },
    onCancel: () => { calls.cancel++; },
    ...extra,
  };
  return { calls, props };
}
const tab = (c, name) => [...c.querySelectorAll("[role=tab]")].find((t) => t.textContent === name);
const selected = (c) => c.querySelector("[role=tab][aria-selected=true]")?.textContent;
const presetButtons = (c) => [...c.querySelectorAll(".ap-preset")];
const presetButton = (c, name) => presetButtons(c).find((b) => b.textContent === name);
const button = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent === text) || null;

async function chooseFile(c, file = new window.File(["not really a photo"], "me.jpg", { type: "image/jpeg" })) {
  const input = c.querySelector("input[type=file]");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); });
  await flush();
}
// jsdom has no PointerEvent; React reads pointerId and pointerType off whatever event arrives.
async function pointer(el, kind, x, y, id = 1) {
  const ev = new window.MouseEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: id });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  await act(async () => { el.dispatchEvent(ev); });
}
async function key(el, name) {
  await act(async () => { el.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
}

// A fake photo pipeline: an 800x600 "photo", and prepareAvatar records the crop it was given.
function fakePhotoTools() {
  const log = { crops: [], released: [] };
  const source = { name: "fake 800x600" };
  imageTools.loadImage = async () => ({ source, width: 800, height: 600 });
  imageTools.prepareAvatar = async (src, crop) => {
    assert(src === source, "prepareAvatar should get the loaded source");
    log.crops.push({ ...crop });
    return { blob: new window.Blob(["webp bytes"], { type: "image/webp" }), type: "image/webp" };
  };
  imageTools.releaseImage = (src) => log.released.push(src);
  return { log, source };
}
const restoreTools = () => Object.assign(imageTools, realTools);
const round = (crop) => Object.fromEntries(Object.entries(crop).map(([k, v]) => [k, Math.round(v * 100) / 100]));
const same = (a, b) => JSON.stringify(round(a)) === JSON.stringify(round(b));

await runTest("the tabs switch, starting on Upload photo unless the picture is a default avatar", async () => {
  const { props } = spies();
  const { container: c } = await show(props);
  assert(selected(c) === "Upload photo", `a player with no picture starts on Upload photo, got ${selected(c)}`);
  assert(button(c, "Choose a photo") && presetButtons(c).length === 0, "the upload tab shows Choose a photo and no avatars");
  const input = c.querySelector("input[type=file]");
  assert(input && input.getAttribute("accept") === "image/*", "the file input accepts images");

  await click(tab(c, "Choose an avatar"));
  assert(selected(c) === "Choose an avatar", "clicking the tab selects it");
  const names = presetButtons(c).map((b) => b.textContent);
  assert(names.join() === FREE_AVATAR_PRESETS.map((p) => p.name).join(), `expected the 12 defaults in order, got ${names.join(", ")}`);
  assert(presetButtons(c).every((b) => b.querySelector("svg.av-art")), "every default avatar tile shows its drawing");
  const panel = c.querySelector("[role=tabpanel]");
  assert(panel.getAttribute("aria-labelledby") === tab(c, "Choose an avatar").id, "the panel is labelled by its tab");

  await key(tab(c, "Choose an avatar"), "ArrowLeft");
  assert(selected(c) === "Upload photo" && document.activeElement === tab(c, "Upload photo"), "arrow keys move between tabs and focus the new one");

  const { container: c2 } = await show(spies({ current: { photoUrl: null, preset: "trophy" } }).props);
  assert(selected(c2) === "Choose an avatar", "a player with a default avatar starts on Choose an avatar");
});

await runTest("choosing a default avatar calls onPreset with its key, and the current one is marked", async () => {
  const { calls, props } = spies({ current: { photoUrl: null, preset: "trophy" } });
  const { container: c } = await show(props);
  const pressed = presetButtons(c).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
  assert(pressed.join() === "Trophy", `only the current avatar is marked, got ${pressed.join(", ")}`);
  await click(presetButton(c, "Helmet"));
  await flush();
  assert(calls.preset.join() === "helmet", `expected onPreset("helmet"), got ${JSON.stringify(calls.preset)}`);
  await click(presetButton(c, "Trophy"));
  await flush();
  assert(calls.preset.length === 1, "choosing the avatar you already have saves nothing");

  for (const p of FREE_AVATAR_PRESETS) {
    await click(presetButton(c, p.name));
    await flush();
  }
  const expected = ["helmet", ...FREE_AVATAR_PRESETS.map((p) => p.key).filter((k) => k !== "trophy")];
  assert(calls.preset.join() === expected.join(), `every tile sends its own key (and the current one none), got ${calls.preset.join(", ")}`);

  const { container: c2 } = await show(spies({ current: { photoUrl: "https://storage.mock/avatars/u/1.webp", preset: null } }).props);
  await click(tab(c2, "Choose an avatar"));
  assert(presetButtons(c2).every((b) => b.getAttribute("aria-pressed") === "false"), "with a photo, no default avatar is marked");
});

await runTest("Remove picture shows only when there is a picture and calls onRemove; Cancel calls onCancel", async () => {
  const none = spies();
  const { container: c } = await show(none.props);
  assert(!button(c, "Remove picture"), "no picture, no Remove picture");
  await click(button(c, "Cancel"));
  assert(none.calls.cancel === 1, "Cancel calls onCancel");

  const photo = spies({ current: { photoUrl: "https://storage.mock/avatars/u/1.webp", preset: null } });
  const { container: c2 } = await show(photo.props);
  await click(button(c2, "Remove picture"));
  await flush();
  assert(photo.calls.remove === 1, "Remove picture calls onRemove");

  const { container: c3 } = await show(spies({ current: { photoUrl: null, preset: "crown" } }).props);
  assert(button(c3, "Remove picture"), "a default avatar can be removed too");
});

await runTest("busy disables every control that saves, and the error message shows", async () => {
  const { calls, props } = spies({ current: { photoUrl: null, preset: "crown" } });
  const { container: c, rerender } = await show(props);
  await rerender({ ...props, busy: true });
  assert(presetButtons(c).every((b) => b.disabled), "every avatar tile is disabled while busy");
  assert(button(c, "Remove picture").disabled, "Remove picture is disabled while busy");
  assert(!button(c, "Cancel").disabled, "Cancel stays available");
  await click(presetButton(c, "Football"));
  await flush();
  assert(calls.preset.length === 0, "a disabled tile saves nothing");
  await click(tab(c, "Upload photo"));
  assert(button(c, "Choose a photo").disabled && c.querySelector("input[type=file]").disabled, "choosing a photo is disabled while busy");

  assert(!c.querySelector(".err"), "no error shown until there is one");
  await rerender({ ...props, busy: false, error: "That picture couldn't be saved. Try again." });
  const err = c.querySelector(".err");
  assert(err && err.getAttribute("role") === "alert" && err.textContent === "That picture couldn't be saved. Try again.", `the error prop should show as an alert, got ${err?.outerHTML}`);
  assert(!button(c, "Choose a photo").disabled, "the controls come back when busy ends");
});

await runTest("a file that won't load gets a friendly message, and the picker stays usable", async () => {
  try {
    const { container: c } = await show(spies().props);
    imageTools.loadImage = async () => { throw { code: "unsupported" }; };
    await chooseFile(c);
    assert(c.querySelector(".err")?.textContent === "That file isn't a picture we can use. Try a JPEG or PNG.", `expected the unsupported message, got ${c.querySelector(".err")?.textContent}`);
    assert(button(c, "Choose a photo") && !c.querySelector(".ap-stage canvas"), "no photo stage after a failed load");

    imageTools.loadImage = async () => { throw { code: "too_big" }; };
    await chooseFile(c);
    assert(c.querySelector(".err")?.textContent === "That picture is over 25 MB. Try a smaller one.", `expected the too-big message, got ${c.querySelector(".err")?.textContent}`);

    imageTools.loadImage = async () => { throw new Error("something unexpected"); };
    await chooseFile(c);
    assert(c.querySelector(".err")?.textContent === "That file isn't a picture we can use. Try a JPEG or PNG.", "an unexpected failure reads as an unusable file");

    fakePhotoTools();
    await chooseFile(c);
    assert(!c.querySelector(".err") && c.querySelector(".ap-stage canvas"), "a good file clears the message and opens the photo");
  } finally {
    restoreTools();
  }
});

await runTest("a photo is framed by dragging, the arrow keys and the zoom slider, and Use this photo sends the blob", async () => {
  try {
    const { log, source } = fakePhotoTools();
    const { calls, props } = spies();
    const { container: c, rerender } = await show(props);
    await chooseFile(c);
    const stage = c.querySelector(".ap-stage[role=group]");
    const slider = c.querySelector("input[type=range]");
    assert(stage && stage.getAttribute("aria-label") === "Photo position" && stage.tabIndex === 0, "the photo stage is a focusable, labelled group");
    assert(slider && c.querySelector(`label[for="${slider.id}"]`)?.textContent === "Zoom", "the zoom slider has a Zoom label");
    assert(slider.value === "0" && slider.getAttribute("aria-valuetext") === "100%", `the photo starts unzoomed, got ${slider.value} (${slider.getAttribute("aria-valuetext")})`);

    await click(button(c, "Use this photo"));
    await flush();
    assert(same(log.crops[0], { size: 600, x: 100, y: 0 }), `the first crop is the biggest centered square, got ${JSON.stringify(log.crops[0])}`);
    assert(calls.photo.length === 1 && calls.photo[0].type === "image/webp", "onPhoto gets the prepared blob");

    // The stage can't be measured in jsdom, so it's the 280px fallback: the circle is 229.6px across,
    // so 600 source pixels take 229.6 screen pixels. Dragging 38.27px left moves the crop 100px right.
    await pointer(stage, "pointerdown", 150, 150);
    assert(stage.classList.contains("ap-dragging"), "the stage shows it's being dragged");
    await pointer(stage, "pointermove", 150 - 38.2667, 150);
    await pointer(stage, "pointerup", 150 - 38.2667, 150);
    assert(!stage.classList.contains("ap-dragging"), "letting go ends the drag");
    await click(button(c, "Use this photo"));
    await flush();
    assert(same(log.crops[1], { size: 600, x: 200, y: 0 }), `dragging left should move the crop right, got ${JSON.stringify(log.crops[1])}`);

    await pointer(stage, "pointerdown", 150, 150);
    await pointer(stage, "pointermove", 400, 400);
    await pointer(stage, "pointerup", 400, 400);
    await click(button(c, "Use this photo"));
    await flush();
    assert(same(log.crops[2], { size: 600, x: 0, y: 0 }), `the crop can't leave the photo, got ${JSON.stringify(log.crops[2])}`);

    // ArrowLeft moves the photo left, so the crop moves 5% of its size right.
    await key(stage, "ArrowLeft");
    await key(stage, "ArrowLeft");
    await key(stage, "ArrowUp");
    await click(button(c, "Use this photo"));
    await flush();
    assert(same(log.crops[3], { size: 600, x: 60, y: 0 }), `arrow keys should move the crop, got ${JSON.stringify(log.crops[3])}`);

    // All the way in: 600 / 128 = 4.6875x, centered on the same point (360, 300).
    await type(slider, "100");
    assert(slider.getAttribute("aria-valuetext") === "469%", `fully zoomed should read 469%, got ${slider.getAttribute("aria-valuetext")}`);
    await click(button(c, "Use this photo"));
    await flush();
    assert(same(log.crops[4], { size: 128, x: 296, y: 236 }), `zooming should shrink the crop around its center, got ${JSON.stringify(log.crops[4])}`);
    assert(calls.photo.length === 5, "each Use this photo sends one blob");

    // Once the saved photo becomes the current picture, the stage goes back to showing it.
    await rerender({ ...props, current: { photoUrl: "https://storage.mock/avatars/u/2.webp", preset: null } });
    assert(!c.querySelector(".ap-stage canvas") && c.querySelector(".ap-empty img.av-photo"), "after the save lands, the new picture shows");
    assert(log.released.includes(source), "the photo's memory is released once it's done with");
  } finally {
    restoreTools();
  }
});

await runTest("pinching zooms around the fingers", async () => {
  try {
    const { log } = fakePhotoTools();
    const { container: c } = await show(spies().props);
    await chooseFile(c);
    const stage = c.querySelector(".ap-stage[role=group]");
    // Fingers at 100 and 180 (midpoint 140,140 is source point 400,300), then spread to 100 and 260.
    await pointer(stage, "pointerdown", 100, 140, 1);
    await pointer(stage, "pointerdown", 180, 140, 2);
    await pointer(stage, "pointermove", 260, 140, 2);
    await pointer(stage, "pointerup", 260, 140, 2);
    await pointer(stage, "pointerup", 100, 140, 1);
    await click(button(c, "Use this photo"));
    await flush();
    // Twice as far apart: half the crop, with source point 400,300 now under the new midpoint (180,140).
    assert(same(log.crops[0], { size: 300, x: 197.74, y: 150 }), `expected a 2x zoom around the fingers, got ${JSON.stringify(log.crops[0])}`);
  } finally {
    restoreTools();
  }
});

await runTest("the preview canvas is square at the stage's size and draws the crop into the circle", async () => {
  // Pins a bug seen in Chrome: a new canvas is 300x150, so checking only the width left a 300px stage
  // (any 1x desktop screen) with a stretched 300x150 picture.
  const draws = [];
  const fakeContext = (canvas) => ({
    canvas, setTransform() {}, clearRect() {}, fillRect() {},
    drawImage: (src, ...args) => draws.push({ size: [canvas.width, canvas.height], args: args.map((n) => Math.round(n * 10) / 10) }),
  });
  const stageWidth = Object.getOwnPropertyDescriptor(window.Element.prototype, "clientWidth");
  window.HTMLCanvasElement.prototype.getContext = function () { return fakeContext(this); };
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.classList.contains("ap-stage") ? 300 : 0; } });
  try {
    fakePhotoTools();
    const { container: c } = await show(spies().props);
    await chooseFile(c);
    await flush(5);
    const last = draws[draws.length - 1];
    assert(last, "the photo should be drawn on the stage");
    assert(last.size.join("x") === "300x300", `the canvas should be 300x300, got ${last.size.join("x")}`);
    // The circle is 246px (82% of 300) with a 27px margin; the 600px crop at x=100 fills it.
    assert(last.args.join() === "-14,27,328,246", `expected the photo drawn at -14,27 at 328x246, got ${last.args.join()}`);
  } finally {
    delete window.HTMLElement.prototype.clientWidth;
    if (stageWidth) Object.defineProperty(window.Element.prototype, "clientWidth", stageWidth);
    window.HTMLCanvasElement.prototype.getContext = () => null;
    restoreTools();
  }
});

await runTest("while a photo is prepared and saved the controls lock, and a failure to prepare says so", async () => {
  try {
    fakePhotoTools();
    let finish;
    const { calls, props } = spies({ onPhoto: (blob) => new Promise((resolve) => { finish = resolve; calls.photo.push(blob); }) });
    const { container: c } = await show(props);
    await chooseFile(c);
    await click(button(c, "Use this photo"));
    await flush();
    const saving = button(c, "Saving…");
    assert(saving && saving.disabled, "the button reads Saving… and is disabled while the save runs");
    assert(button(c, "Choose another").disabled && c.querySelector("input[type=range]").disabled, "the other photo controls lock too");
    assert(c.querySelector(".ap-picker").getAttribute("aria-busy") === "true", "the picker says it's busy");
    await act(async () => finish());
    await flush();
    assert(button(c, "Use this photo") && !button(c, "Use this photo").disabled, "the controls come back when the save finishes");

    imageTools.prepareAvatar = async () => { throw { code: "unsupported" }; };
    await click(button(c, "Use this photo"));
    await flush();
    assert(c.querySelector(".err")?.textContent === "That photo couldn't be turned into a picture. Try another one.", `expected the prepare failure message, got ${c.querySelector(".err")?.textContent}`);
    assert(calls.photo.length === 1, "nothing is sent when the photo can't be prepared");
  } finally {
    restoreTools();
  }
});

if (shown) await act(async () => shown.reactRoot.unmount());
console.log("test-avatar-picker.mjs done");
