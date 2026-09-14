// Profiles: one player's profile for the profile screen, and saving your own bio, favorite team and
// picture. Contract: PROFILES.md. Nothing here throws - every failure comes back as a status or a
// reason the screen can put into words.
//
// profile_details has no client write policy at all. Saves go through the database functions
// save_profile and set_avatar (supabase/migration-profiles.sql), which enforce the limits and the
// word filter, so a modified browser can't skip them.
import { getClient, READ, rowToProfile, rpcReason } from "./storage-core.js";
import {
  AVATAR_BUCKET, AVATAR_TYPES, AVATAR_MAX_BYTES, avatarObjectPath, cleanBio, bioLength, BIO_MAX, mapPlayerStats,
} from "./profile-rules.mjs";

// A stored picture's public address, or null.
export function avatarUrl(path) {
  if (!path) return null;
  try {
    const { data } = getClient().storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) {
    return null;
  }
}

// A profile_details row (or null, for a player who never saved any) in the app's shape.
export function mapDetails(row) {
  return {
    bio: row?.bio || "",
    avatarPath: row?.avatar_path ?? null,
    avatarUrl: avatarUrl(row?.avatar_path),
    avatarPreset: row?.avatar_preset ?? null,
    favoriteTeam: row?.favorite_team ?? null,
    updatedAt: row?.updated_at ?? null,
  };
}

// Everything the profile screen shows for one player, in one read (player_profile()).
//   { status: "ok", profile } | { status: "missing" } | { status: "error" }
// profile = { id, username, joined, details, stats, extra } - `stats` is the same shape as the app's
// own `stats` state (rowToProfile), `extra` is mapPlayerStats(player_stats()).
export async function fetchPlayerProfile(username) {
  try {
    const { data, error } = await getClient().rpc("player_profile", { p_username: username }, READ);
    if (error) return { status: "error" };
    if (!data || !data.profile) return { status: "missing" };
    const row = data.profile;
    return {
      status: "ok",
      profile: {
        id: row.id, username: row.username, joined: row.created_at ?? null,
        details: mapDetails(data.details), stats: rowToProfile(row), extra: mapPlayerStats(data.stats),
      },
    };
  } catch (e) {
    return { status: "error" };
  }
}

// The signed-in player's own details, for the header picture. null if they can't be loaded.
export async function fetchProfileDetails(userId) {
  try {
    const { data, error } = await getClient().from("profile_details").select("*").eq("user_id", userId);
    if (error) return null;
    return mapDetails(Array.isArray(data) ? data[0] || null : data);
  } catch (e) {
    return null;
  }
}

const SAVE_REASONS = { bio_too_long: "too_long", bio_blocked: "blocked", bio_invalid: "invalid", bad_team: "invalid", not_signed_in: "signed_out" };
const AVATAR_REASONS = { bad_path: "invalid", bad_preset: "invalid", bad_request: "invalid", not_signed_in: "signed_out" };

// Saves your bio and favorite team together (either can be unchanged).
//   { ok: true, details } | { ok: false, reason: "too_long" | "blocked" | "invalid" | "signed_out" | "network" }
export async function saveProfile({ bio, favoriteTeam }) {
  const clean = cleanBio(bio);
  if (bioLength(clean) > BIO_MAX) return { ok: false, reason: "too_long" };
  try {
    const { data, error } = await getClient().rpc("save_profile", { p_bio: clean, p_favorite_team: favoriteTeam || null });
    if (error) return { ok: false, reason: rpcReason(error, SAVE_REASONS) };
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

// Storage API errors don't carry the database's codes; sort them by what they say.
function uploadReason(error) {
  const status = String(error?.statusCode ?? error?.status ?? "");
  const msg = String(error?.message || "").toLowerCase();
  if (status === "413" || /too large|maximum allowed size|exceeded/.test(msg)) return "too_large";
  if (/mime|content type|not supported/.test(msg)) return "type";
  if (status === "403" || /row-level security|unauthorized|not allowed/.test(msg)) return "paused";
  return "network";
}
const removeQuietly = (paths) => {
  try { Promise.resolve(getClient().storage.from(AVATAR_BUCKET).remove(paths)).catch(() => {}); } catch (e) { /* best effort */ }
};

// Uploads an already-cropped picture (the avatar picker makes the blob) and makes it your picture.
// The previous photo, if any, is deleted after the switch lands.
//   { ok: true, details } | { ok: false, reason: "type" | "too_large" | "paused" | "invalid" | "signed_out" | "network" }
// "paused" is the upload kill switch (PROFILES.md, Moderation).
export async function saveAvatarPhoto(userId, blob, previousPath) {
  if (!blob || !AVATAR_TYPES.includes(blob.type)) return { ok: false, reason: "type" };
  if (blob.size > AVATAR_MAX_BYTES) return { ok: false, reason: "too_large" };
  const path = avatarObjectPath(userId, blob.type);
  try {
    const up = await getClient().storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (up?.error) return { ok: false, reason: uploadReason(up.error) };
    const { data, error } = await getClient().rpc("set_avatar", { p_path: path, p_preset: null });
    if (error) {
      removeQuietly([path]);
      return { ok: false, reason: rpcReason(error, AVATAR_REASONS) };
    }
    if (previousPath && previousPath !== path) removeQuietly([previousPath]);
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

// Picks one of the default avatars (replacing any photo, which is then deleted).
export async function setAvatarPreset(key, previousPath) {
  try {
    const { data, error } = await getClient().rpc("set_avatar", { p_path: null, p_preset: key });
    if (error) return { ok: false, reason: rpcReason(error, AVATAR_REASONS) };
    if (previousPath) removeQuietly([previousPath]);
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

// Back to the initial: no photo, no default avatar.
export async function removeAvatar(previousPath) {
  try {
    const { data, error } = await getClient().rpc("set_avatar", { p_path: null, p_preset: null });
    if (error) return { ok: false, reason: rpcReason(error, AVATAR_REASONS) };
    if (previousPath) removeQuietly([previousPath]);
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

// Whether a username can be signed up with, asked before the signup itself so the form can say why.
//   "ok" | "taken" | "blocked" | "invalid", or null if the check couldn't run (signup still re-checks).
export async function checkUsername(name) {
  try {
    const { data, error } = await getClient().rpc("check_username", { p_username: name }, READ);
    if (error || typeof data !== "string") return null;
    return data;
  } catch (e) {
    return null;
  }
}
