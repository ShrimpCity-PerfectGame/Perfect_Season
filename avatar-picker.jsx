// Choosing a picture: upload a photo (drag and zoom it into the circle, then a 256x256 image is made in
// the browser) or pick one of the default avatars. Contract: PROFILES.md, and SHOP.md (7.1) for the packs.
// Classes are prefixed ap-.
//
//   username    - for the preview's initial
//   current     - { photoUrl, preset } as the player has them now
//   busy        - a save is in flight; disable the controls
//   error       - a message to show from the last failed save, or ""
//   ownedPacks  - the avatar packs the player owns, by pack name ("sideline", ...); the starter set is always
//                 theirs. The others show dimmed, with "In the shop", and can't be chosen.
//   onPhoto     - (blob) => Promise: the cropped image, ready for storage-profile.js's saveAvatarPhoto
//   onPreset    - (key) => Promise: a default avatar was chosen
//   onRemove    - () => Promise: back to the initial
//   onCancel    - () => void: close without changes
import { useEffect, useId, useRef, useState } from "react";
import { Avatar, AVATAR_PRESETS } from "./avatars.jsx";
import { AVATAR_PACKS } from "./shop-catalog.mjs";
import { loadImage, prepareAvatar, releaseImage, BACKDROP } from "./avatar-image.mjs";

// The groups on Choose an avatar, Starter first, then the shop's packs in catalog order.
const PACK_GROUPS = [
  { pack: "starter", name: "Starter" },
  ...AVATAR_PACKS.map((p) => ({ pack: p.pack, name: p.name })),
].map((g) => ({ ...g, presets: AVATAR_PRESETS.filter((p) => p.pack === g.pack) }));

// The image work, behind one object so the jsdom tests (which have no canvas) can swap in fakes. The
// app never changes it.
export const imageTools = { loadImage, prepareAvatar, releaseImage };

const LOAD_ERRORS = {
  unsupported: "That file isn't a picture we can use. Try a JPEG or PNG.",
  too_big: "That picture is over 25 MB. Try a smaller one.",
};
const PREPARE_ERROR = "That photo couldn't be turned into a picture. Try another one.";

// The circle is this share of the stage; the rest shows the photo faded, so you can see what's cut.
const CIRCLE = 0.82;
const STAGE_FALLBACK = 280; // CSS px, when the stage can't be measured (the test DOM has no layout)
// Zoom goes in until the circle spans 128 source pixels (at least 2x, at most 8x): closer than that
// just enlarges pixels.
const zoomLimit = (image) => Math.min(8, Math.max(2, Math.min(image.width, image.height) / 128));

function fitCrop(crop, image) {
  const short = Math.min(image.width, image.height);
  const size = Math.min(short, Math.max(short / zoomLimit(image), crop.size));
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  return { size, x: clamp(crop.x, image.width - size), y: clamp(crop.y, image.height - size) };
}
const centeredCrop = (image) => {
  const size = Math.min(image.width, image.height);
  return { size, x: (image.width - size) / 2, y: (image.height - size) / 2 };
};

export const PICKER_CSS = `
/* Full width of wherever it sits: sized to its content, the avatar grid worked out six columns and ran past
   a phone's screen, hiding half the avatars. */
.ap-picker{display:flex;flex-direction:column;gap:14px;min-width:0;width:100%}
.ap-tabs{display:flex;align-self:flex-start;max-width:100%;border:2px solid var(--btn-line);border-radius:10px;overflow:hidden;background:var(--surface)}
.ap-tab{flex:1 1 auto;background:none;border:none;padding:8px 14px;font-weight:700;font-size:14px;line-height:1.2;color:var(--muted);transition:background-color .12s,color .12s}
.ap-tab+.ap-tab{border-left:2px solid var(--btn-line)}
.ap-tab[aria-selected=true]{background:var(--accent);color:var(--on-accent)}
@media (hover:hover){.ap-tab:hover:not([aria-selected=true]){color:var(--ink)}}
.ap-panel{display:flex;flex-direction:column;align-items:flex-start;gap:12px;min-width:0}
.ap-stage{position:relative;width:min(100%,300px);aspect-ratio:1;border-radius:16px;overflow:hidden;background:var(--surface2);
  touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}
.ap-stage.ap-dragging{cursor:grabbing}
.ap-stage:focus-visible{outline:3px solid var(--accent-ink);outline-offset:3px}
.ap-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
/* The circle the picture will be: a ring, with everything outside it washed toward the background. */
.ap-circle{position:absolute;left:9%;top:9%;width:82%;height:82%;border-radius:50%;pointer-events:none;
  box-shadow:0 0 0 2px var(--ink),0 0 0 400px color-mix(in srgb,var(--bg) 62%,transparent)}
.ap-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:12px;text-align:center;
  border:2px dashed var(--line2);background:var(--surface);cursor:default;touch-action:auto}
/* Two classes deep, so .panel p's margins don't win when the picker sits in a panel. */
.ap-panel .ap-note{margin:0;font-size:13px;color:var(--muted)}
.ap-zoom{display:flex;align-items:center;gap:12px;width:min(100%,300px)}
.ap-zoom-label{display:block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.ap-zoom input{flex:1;min-width:0;margin:0;height:28px;font-size:16px;accent-color:var(--accent-ink);cursor:pointer}
.ap-zoom input:focus-visible{outline:3px solid var(--accent-ink);outline-offset:3px;border-radius:4px}
.ap-zoom input:disabled{cursor:default;opacity:.45}
/* Arrow keys mean nothing on a phone, so touch screens get the shorter hint. */
.ap-hint-touch{display:none}
/* Choose an avatar: one group per pack, each a label and a grid. Flex columns, not grids: inside a grid track the
   avatar grid's width:100% has nothing definite to resolve against, so auto-fill sized it to its 640px max-width
   and it ran off a phone's screen. */
.ap-packs{display:flex;flex-direction:column;gap:18px;width:100%;min-width:0}
.ap-pack{display:flex;flex-direction:column;gap:8px;min-width:0}
.ap-panel .ap-packname{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0;font-size:12px;font-weight:800;line-height:1.3;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.ap-shop{padding:2px 8px;border-radius:999px;background:var(--surface2);box-shadow:inset 0 0 0 1.5px var(--line2);color:var(--ink);font-size:12px;font-weight:700;letter-spacing:0;text-transform:none}
/* 88px tiles: three columns from about 360px, two below - narrower, "Stopwatch" and "Megaphone" broke mid-word. */
.ap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;width:100%;max-width:640px;margin:0;padding:0;list-style:none}
.ap-preset,.ap-lock{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;padding:12px 4px 8px;
  border:2px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);font-weight:700;font-size:13px;line-height:1.2;
  transition:transform .12s ease,border-color .12s,box-shadow .12s}
/* A pack in the shop: its avatars dimmed on a dashed tile, their names still readable. */
.ap-lock{border-style:dashed;border-color:var(--line2);background:transparent;color:var(--muted);transition:none}
.ap-dim{display:grid;opacity:.4;filter:grayscale(.6)}
.ap-preset[aria-pressed=true]{border-color:var(--ink);box-shadow:3px 3px 0 var(--hard)}
/* The current one gets a lime check badge in its corner. */
.ap-preset[aria-pressed=true]::before{content:"";position:absolute;top:5px;right:5px;width:20px;height:20px;border-radius:50%;background:var(--accent);box-shadow:inset 0 0 0 2px var(--on-accent)}
.ap-preset[aria-pressed=true]::after{content:"";position:absolute;top:9px;right:12px;width:5px;height:9px;border:solid var(--on-accent);border-width:0 2.5px 2.5px 0;transform:rotate(45deg)}
.ap-preset:disabled{opacity:.45;cursor:default}
@media (hover:hover){.ap-preset:hover:not(:disabled){border-color:var(--ink);transform:translateY(-2px)}}
.ap-preset:active:not(:disabled){transform:translateY(1px)}
.ap-name{max-width:100%;overflow-wrap:anywhere}
/* Keeps both tab labels on one line in a 320px-wide phone's panel. */
@media (max-width:360px){.ap-tab{padding:8px 8px;font-size:13px}}
@media (pointer:coarse){
  .ap-tab{min-height:44px}
  .ap-zoom input{height:44px}
  /* Above any neighbouring text link's enlarged hit area, as CLAUDE.md's touch rules ask. */
  .ap-tab,.ap-preset,.ap-stage,.ap-zoom input{position:relative;z-index:1}
  .ap-hint-fine{display:none}
  .ap-hint-touch{display:inline}
}
/* A phone on its side: a smaller stage, so Use this photo is on screen with the circle. */
@media (max-height:500px) and (orientation:landscape){
  .ap-stage,.ap-zoom{width:min(100%,200px)}
}
@media (prefers-reduced-motion:reduce){
  .ap-tab,.ap-preset{transition:none}
  .ap-preset:hover:not(:disabled),.ap-preset:active:not(:disabled){transform:none}
}
`;

// Draws the photo on the stage: the crop square fills the circle, and the rest of the photo shows around it.
function drawStage(canvas, image, crop, cssSize) {
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const px = Math.round(cssSize * dpr);
  // Both sides: a new canvas is 300x150, so on a 1x screen with a 300px stage the width already matches.
  if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
  const circle = cssSize * CIRCLE, inset = (cssSize - circle) / 2, scale = circle / crop.size;
  const x = inset - crop.x * scale, y = inset - crop.y * scale, w = image.width * scale, h = image.height * scale;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = BACKDROP; // what transparent pixels become in the upload
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(image.source, x, y, w, h);
}

export function AvatarPicker({ username, current, busy, error, ownedPacks, onPhoto, onPreset, onRemove, onCancel }) {
  const id = useId();
  const photoUrl = current?.photoUrl || null;
  const preset = current?.preset || null;
  // The pack of the avatar the player already wears counts as theirs too: the database only let them choose it
  // because they own it, and the shop's list may still be loading.
  const currentPack = AVATAR_PRESETS.find((p) => p.key === preset)?.pack;
  const owns = (pack) => pack === "starter" || pack === currentPack || (Array.isArray(ownedPacks) && ownedPacks.includes(pack));
  const [tab, setTab] = useState(preset && !photoUrl ? "presets" : "upload");
  const [image, setImage] = useState(null); // { source, width, height } from loadImage
  const [crop, setCrop] = useState(null); // { x, y, size } in source pixels
  const [opening, setOpening] = useState(false);
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState("");
  const [stagePx, setStagePx] = useState(0);
  const locked = !!busy || working;

  const imageRef = useRef(null);
  const cropRef = useRef(null);
  cropRef.current = crop;
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const tabRefs = useRef({});
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  // photoUrl as it was when "Use this photo" was pressed: once the saved photo replaces it, the stage
  // goes back to showing the current picture.
  const submittedFrom = useRef(undefined);

  const replaceImage = (next) => {
    const old = imageRef.current;
    imageRef.current = next;
    setImage(next);
    setCrop(next ? centeredCrop(next) : null);
    if (old && old !== next) imageTools.releaseImage?.(old.source);
  };
  useEffect(() => () => { if (imageRef.current) imageTools.releaseImage?.(imageRef.current.source); }, []);
  // The picker replaces the button that opened it, so keyboard and screen-reader focus would otherwise drop to
  // the page: it starts on the selected tab instead.
  useEffect(() => { tabRefs.current[tab]?.focus?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (submittedFrom.current !== undefined && photoUrl !== submittedFrom.current) {
      submittedFrom.current = undefined;
      replaceImage(null);
    }
  }, [photoUrl]);

  // The stage's size in CSS pixels, kept current as the layout changes.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !image) return undefined;
    const measure = () => setStagePx(el.clientWidth);
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [image, tab]);

  useEffect(() => {
    if (!image || !crop || !stagePx || tab !== "upload") return undefined;
    const frame = requestAnimationFrame(() => drawStage(canvasRef.current, image, crop, stagePx));
    return () => cancelAnimationFrame(frame);
  }, [image, crop, stagePx, tab]);

  const stageSize = () => stagePx || STAGE_FALLBACK;

  async function chooseFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // so picking the same file again still counts as a change
    if (!file || locked) return;
    setLocalError("");
    setOpening(true);
    try {
      replaceImage(await imageTools.loadImage(file));
    } catch (err) {
      setLocalError(LOAD_ERRORS[err?.code] || LOAD_ERRORS.unsupported);
    } finally {
      setOpening(false);
    }
  }

  async function usePhoto() {
    if (!image || !crop || locked) return;
    setLocalError("");
    setWorking(true);
    let prepared;
    try {
      prepared = await imageTools.prepareAvatar(image.source, crop);
    } catch (err) {
      setWorking(false);
      setLocalError(PREPARE_ERROR);
      return;
    }
    submittedFrom.current = photoUrl;
    try {
      await onPhoto?.(prepared.blob);
    } catch (err) {
      // A failed save comes back through the error prop.
    }
    setWorking(false);
  }

  // Waits out a save the parent reports through busy and error; the picker only guards against doubles.
  async function run(action) {
    if (locked) return;
    setLocalError("");
    setWorking(true);
    try {
      await action?.();
    } catch (err) {
      // reported through the error prop
    }
    setWorking(false);
  }

  // ---- dragging and pinching the photo ----
  const startGesture = () => {
    gesture.current = { crop: cropRef.current, points: [...pointers.current.values()].map((p) => ({ ...p })) };
  };
  function pointerDown(e) {
    if (!image || locked || (e.pointerType === "mouse" && e.button !== 0)) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* not capturable (test DOM) */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
    setDragging(true);
  }
  function pointerMove(e) {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = [...pointers.current.values()];
    const circle = stageSize() * CIRCLE;
    if (now.length === 1) {
      // Dragging the photo right moves the crop square left over it.
      const scale = circle / g.crop.size;
      setCrop(fitCrop({ size: g.crop.size, x: g.crop.x - (now[0].x - g.points[0].x) / scale, y: g.crop.y - (now[0].y - g.points[0].y) / scale }, image));
      return;
    }
    // Two fingers: zoom by how far apart they've moved, keeping the photo under their midpoint.
    const [a0, b0] = g.points, [a1, b1] = now;
    const spread = Math.hypot(a1.x - b1.x, a1.y - b1.y) / (Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1);
    const rect = stageRef.current.getBoundingClientRect();
    const inset = (stageSize() - circle) / 2;
    const s0 = circle / g.crop.size;
    const sourceX = g.crop.x + ((a0.x + b0.x) / 2 - rect.left - inset) / s0;
    const sourceY = g.crop.y + ((a0.y + b0.y) / 2 - rect.top - inset) / s0;
    const size = fitCrop({ ...g.crop, size: g.crop.size / spread }, image).size;
    const s1 = circle / size;
    setCrop(fitCrop({ size, x: sourceX - ((a1.x + b1.x) / 2 - rect.left - inset) / s1, y: sourceY - ((a1.y + b1.y) / 2 - rect.top - inset) / s1 }, image));
  }
  function pointerUp(e) {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size) startGesture();
    else { gesture.current = null; setDragging(false); }
  }
  function stageKey(e) {
    const moves = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (!image || locked || !moves[e.key]) return;
    e.preventDefault();
    const [dx, dy] = moves[e.key];
    setCrop((c) => fitCrop({ ...c, x: c.x + dx * c.size * 0.05, y: c.y + dy * c.size * 0.05 }, image));
  }
  function zoomTo(value) {
    const zoom = zoomLimit(image) ** (value / 100);
    const size = Math.min(image.width, image.height) / zoom;
    setCrop((c) => fitCrop({ size, x: c.x + c.size / 2 - size / 2, y: c.y + c.size / 2 - size / 2 }, image));
  }

  // Arrow keys move between the tabs, as in any tab list.
  function tabKey(e) {
    const order = ["upload", "presets"];
    const at = order.indexOf(tab);
    const next = {
      ArrowRight: order[(at + 1) % order.length], ArrowLeft: order[(at + order.length - 1) % order.length],
      Home: order[0], End: order[order.length - 1],
    }[e.key];
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const shownError = localError || error || "";
  const zoomValue = image && crop ? Math.round((100 * Math.log(Math.min(image.width, image.height) / crop.size)) / Math.log(zoomLimit(image))) : 0;
  const tabProps = (name) => ({
    type: "button", role: "tab", id: `${id}-tab-${name}`, "aria-controls": `${id}-panel-${name}`, "aria-selected": tab === name,
    tabIndex: tab === name ? 0 : -1, className: "ap-tab", ref: (el) => { tabRefs.current[name] = el; },
    onClick: () => setTab(name), onKeyDown: tabKey,
  });

  return (
    <div className="ap-picker" aria-busy={locked || opening ? "true" : undefined}>
      <div className="ap-tabs" role="tablist" aria-label="Picture">
        <button {...tabProps("upload")}>Upload photo</button>
        <button {...tabProps("presets")}>Choose an avatar</button>
      </div>

      {tab === "upload" ? (
        <div className="ap-panel" role="tabpanel" id={`${id}-panel-upload`} aria-labelledby={`${id}-tab-upload`}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={chooseFile} disabled={locked} />
          {image && crop ? (
            <>
              <div ref={stageRef} className={`ap-stage${dragging ? " ap-dragging" : ""}`} role="group" aria-label="Photo position"
                aria-describedby={`${id}-hint`} tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove}
                onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={stageKey}>
                <canvas ref={canvasRef} aria-hidden="true" />
                <div className="ap-circle" aria-hidden="true" />
              </div>
              <p className="ap-note" id={`${id}-hint`}>
                <span className="ap-hint-fine">Drag or use the arrow keys to move the photo.</span>
                <span className="ap-hint-touch">Drag to move the photo.</span>
              </p>
              <div className="ap-zoom">
                <label className="ap-zoom-label" htmlFor={`${id}-zoom`}>Zoom</label>
                <input id={`${id}-zoom`} type="range" min="0" max="100" step="1" value={zoomValue} disabled={locked}
                  aria-valuetext={`${Math.round((100 * Math.min(image.width, image.height)) / crop.size)}%`}
                  onChange={(e) => zoomTo(Number(e.target.value))} />
              </div>
              <div className="frow">
                <button type="button" className="btn solid" disabled={locked} onClick={usePhoto}>{working ? "Saving…" : "Use this photo"}</button>
                <button type="button" className="btn" disabled={locked || opening} onClick={() => fileRef.current?.click()}>Choose another</button>
              </div>
            </>
          ) : (
            <div className="ap-stage ap-empty">
              <Avatar username={username || ""} photoUrl={photoUrl} preset={preset} size={96} decorative />
              {opening
                ? <p className="ap-note" role="status">Opening the photo…</p>
                : <button type="button" className="btn" disabled={locked} onClick={() => fileRef.current?.click()}>Choose a photo</button>}
            </div>
          )}
        </div>
      ) : (
        <div className="ap-panel" role="tabpanel" id={`${id}-panel-presets`} aria-labelledby={`${id}-tab-presets`}>
          <div className="ap-packs">
            {PACK_GROUPS.map((g) => {
              const labelId = `${id}-pack-${g.pack}`;
              const owned = owns(g.pack);
              return (
                <div key={g.pack} className="ap-pack" data-pack={g.pack} data-owned={owned ? "true" : "false"}>
                  <p className="ap-packname" id={labelId}>{g.name}{!owned && <span className="ap-shop">In the shop</span>}</p>
                  {owned ? (
                    <div className="ap-grid" role="group" aria-labelledby={labelId}>
                      {g.presets.map((p) => {
                        const isCurrent = !photoUrl && preset === p.key;
                        return (
                          <button key={p.key} type="button" className="ap-preset" aria-pressed={isCurrent} disabled={locked}
                            onClick={() => { if (!isCurrent) run(() => onPreset?.(p.key)); }}>
                            <Avatar username={username || ""} preset={p.key} size={56} decorative />
                            <span className="ap-name">{p.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    // Not options at all until the pack is bought: a list to look at, with nothing to focus or press.
                    <ul className="ap-grid" aria-labelledby={labelId}>
                      {g.presets.map((p) => (
                        <li key={p.key} className="ap-lock" data-preset={p.key}>
                          <span className="ap-dim"><Avatar username={username || ""} preset={p.key} size={56} decorative /></span>
                          <span className="ap-name">{p.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {shownError && <p className="err" role="alert">{shownError}</p>}
      <div className="frow">
        {(photoUrl || preset) && <button type="button" className="btn" disabled={locked} onClick={() => run(onRemove)}>Remove picture</button>}
        <button type="button" className="btn" onClick={() => onCancel?.()}>Cancel</button>
      </div>
    </div>
  );
}
