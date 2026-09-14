// Player pictures: an uploaded photo, one of the default avatars, or the player's initial - in that
// order, falling back to the next when the one before is missing or fails to load. Contract:
// PROFILES.md. Classes are prefixed av-.
//
// PHASE 0 PLACEHOLDER (agent D builds the real thing): the default avatars render as the initial for
// now, and AVATAR_CSS is minimal. The component's props are final.
import { useState } from "react";
import { FREE_AVATAR_PRESETS } from "./profile-rules.mjs";

// Every default avatar: [{ key, name, pack, free }]. Agent D adds the artwork.
export const AVATAR_PRESETS = FREE_AVATAR_PRESETS.map((p) => ({ ...p, pack: "starter", free: true }));

export const AVATAR_CSS = `
.av{position:relative;display:inline-grid;place-items:center;flex:none;border-radius:50%;overflow:hidden;background:var(--accent);color:var(--on-accent);box-shadow:inset 0 0 0 2px var(--ink);font-family:var(--display);line-height:1}
.av img{width:100%;height:100%;object-fit:cover;display:block}
`;

// size is in CSS pixels. decorative hides it from screen readers when a name sits right beside it.
export function Avatar({ username = "", photoUrl = null, preset = null, size = 40, className = "", decorative = false }) {
  const [failed, setFailed] = useState(null);
  const showPhoto = photoUrl && failed !== photoUrl;
  const label = decorative ? undefined : `${username}'s picture`;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.5) };
  return (
    <span className={`av ${className}`.trim()} style={style} role={decorative ? undefined : "img"} aria-label={label} aria-hidden={decorative ? "true" : undefined} data-preset={!showPhoto && preset ? preset : undefined}>
      {showPhoto
        ? <img src={photoUrl} alt="" onError={() => setFailed(photoUrl)} />
        : (username.charAt(0) || "?").toUpperCase()}
    </span>
  );
}
