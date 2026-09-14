// Turning a chosen photo into the picture that gets uploaded: decode it, crop the square the player
// framed, draw it at 256x256 and encode it as WebP (JPEG where the browser can't make WebP), under
// 256 KB. Redrawing on a canvas also drops the file's metadata, including a phone photo's GPS
// location. Browser-only (canvas). Contract: PROFILES.md.
//
// PHASE 0 PLACEHOLDER (agent D builds the real thing). The shape is final:
//   loadImage(file)           -> Promise<{ source, width, height }>  rejects { code: "unsupported" | "too_big" }
//   prepareAvatar(source, crop) -> Promise<{ blob, type }>           crop = { x, y, size } in source pixels
import { AVATAR_SIZE, AVATAR_MAX_BYTES, AVATAR_TYPES } from "./profile-rules.mjs";

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export { AVATAR_SIZE, AVATAR_MAX_BYTES, AVATAR_TYPES };

export async function loadImage(file) {
  throw { code: "unsupported" };
}

export async function prepareAvatar(source, crop) {
  throw { code: "unsupported" };
}
