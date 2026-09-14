// Choosing a picture: upload a photo (crop, then a 256x256 image is made in the browser) or pick one
// of the default avatars. Contract: PROFILES.md. Classes are prefixed ap-.
//
// PHASE 0 PLACEHOLDER (agent D builds the real thing). The props are final:
//   username    - for the preview's initial
//   current     - { photoUrl, preset } as the player has them now
//   busy        - a save is in flight; disable the controls
//   error       - a message to show from the last failed save, or ""
//   onPhoto     - (blob) => Promise: the cropped image, ready for storage-profile.js's saveAvatarPhoto
//   onPreset    - (key) => Promise: a default avatar was chosen
//   onRemove    - () => Promise: back to the initial
//   onCancel    - () => void: close without changes
import { AVATAR_PRESETS } from "./avatars.jsx";

export const PICKER_CSS = `
.ap-picker{display:flex;flex-direction:column;gap:12px}
`;

export function AvatarPicker({ username, current, busy, error, onPhoto, onPreset, onRemove, onCancel }) {
  return (
    <div className="ap-picker">
      <div className="frow" role="group" aria-label="Default avatars">
        {AVATAR_PRESETS.map((p) => (
          <button key={p.key} type="button" className="btn" disabled={busy} aria-pressed={current?.preset === p.key} onClick={() => onPreset?.(p.key)}>{p.name}</button>
        ))}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="frow">
        {(current?.photoUrl || current?.preset) && <button type="button" className="btn" disabled={busy} onClick={() => onRemove?.()}>Remove picture</button>}
        <button type="button" className="btn" onClick={() => onCancel?.()}>Cancel</button>
      </div>
    </div>
  );
}
