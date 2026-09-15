// Profiles: one player's profile for the profile screen, and saving your own bio, favorite team and
// picture. Contract: PROFILES.md. Nothing here throws - every failure comes back as a status or a
// reason the screen can put into words.
//
// profile_details has no client write policy at all. Saves go through the database functions
// save_profile and set_avatar (supabase/migration-profiles.sql), which enforce the limits and the
// word filter, so a modified browser can't skip them. The checks made here first are only there to
// answer without a round trip.
import { getClient, READ, rowToProfile, rpcReason } from "./storage-core.js";
import {
  AVATAR_BUCKET, AVATAR_TYPES, AVATAR_MAX_BYTES, avatarObjectPath, isOwnAvatarPath, cleanBio, bioLength, BIO_MAX,
  TEAM_CODES, USERNAME_RE, mapPlayerStats,
} from "./profile-rules.mjs";

// A stored picture's public address, or null.
export function avatarUrl(path) {
  if (typeof path !== "string" || !path) return null;
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
    bio: typeof row?.bio === "string" ? row.bio : "",
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
// own `stats` state (rowToProfile), `extra` is mapPlayerStats(player_stats()). `username` is the name
// as stored, which can differ in case from the one asked for.
export async function fetchPlayerProfile(username) {
  if (typeof username !== "string" || !username) return { status: "missing" };
  try {
    const { data, error } = await getClient().rpc("player_profile", { p_username: username }, READ);
    if (error) return { status: "error" };
    // The function returns null for no such player. Anything else without a profile row is a broken
    // response, not a missing player, so the screen offers a retry rather than "no such player".
    if (data == null) return { status: "missing" };
    const row = data.profile;
    if (!row || typeof row !== "object" || !row.id) return { status: "error" };
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
  if (!userId) return null;
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

// A failed database call's reason. A session the server no longer accepts (an expired or rejected JWT,
// which PostgREST reports as PGRST301-303 with HTTP 401) is "signed_out"; a function's own refusal is
// looked up in `table`; anything else - a dropped connection, a server error - is "network".
function callReason(error, status, table) {
  const code = String(error?.code || "");
  if (status === 401 || /^PGRST30[123]$/.test(code) || /\bjwt\b/i.test(String(error?.message || ""))) return "signed_out";
  return rpcReason(error, table);
}
const failed = (reason) => ({ ok: false, reason });

// Saves your bio and favorite team together. Pass both: the current value of whichever isn't changing.
//   { ok: true, details } | { ok: false, reason: "too_long" | "blocked" | "invalid" | "signed_out" | "network" }
export async function saveProfile(input) {
  const { bio, favoriteTeam } = input || {};
  const clean = cleanBio(bio);
  if (bioLength(clean) > BIO_MAX) return failed("too_long");
  const team = favoriteTeam || null;
  if (team !== null && !TEAM_CODES.includes(team)) return failed("invalid");
  try {
    const { data, error, status } = await getClient().rpc("save_profile", { p_bio: clean, p_favorite_team: team });
    if (error) return failed(callReason(error, status, SAVE_REASONS));
    if (!data || typeof data !== "object") return failed("network");
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return failed("network");
  }
}

// Deletes files without waiting and without ever failing the caller: a leftover file costs a few KB,
// while an error here would report a save that did land as failed.
function removeQuietly(paths) {
  try {
    Promise.resolve(getClient().storage.from(AVATAR_BUCKET).remove(paths)).catch(() => {});
  } catch (e) { /* best effort */ }
}
// After a picture change lands, the photo it replaced goes - but only a file in the player's own
// folder, so a bad previousPath can never remove someone else's (a moderator's storage policy would
// otherwise allow it).
function removePrevious(userId, previousPath, currentPath) {
  if (previousPath && previousPath !== currentPath && isOwnAvatarPath(userId, previousPath)) removeQuietly([previousPath]);
}

// Who the client's session belongs to: an id, null when signed out, or undefined if it can't be told
// (then the upload goes ahead and the server decides). getSession() refreshes an expired token, and
// when that refresh can't reach the server it reports no session along with an error - that's a
// connection problem, not a sign-out.
async function sessionUserId() {
  try {
    const { data, error } = await getClient().auth.getSession();
    if (error) return undefined;
    return data?.session?.user?.id ?? null;
  } catch (e) {
    return undefined;
  }
}
// Whether the upload kill switch is on: true/false, or null if the flag can't be read.
async function uploadsPaused() {
  try {
    const { data, error } = await getClient().from("site_flags").select("enabled").eq("key", "uploads_paused");
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? row.enabled === true : false;
  } catch (e) {
    return null;
  }
}
// A failed upload's reason. Storage errors (storage-js's StorageApiError) carry the Storage API's own
// statusCode/code ("413"/EntityTooLarge, "415"/InvalidMimeType, "403"/AccessDenied, ...) alongside the
// HTTP status, which differs between Storage versions - so all three are read, then the message.
async function uploadReason(error) {
  const statusCode = String(error?.statusCode ?? "");
  const code = String(error?.code ?? "");
  const status = Number(error?.status);
  const message = String(error?.message || "");
  if (statusCode === "413" || code === "EntityTooLarge" || status === 413 || /maximum allowed size|too large/i.test(message)) return "too_large";
  if (statusCode === "415" || code === "InvalidMimeType" || status === 415 || /mime type/i.test(message)) return "type";
  if (code === "InvalidJWT" || /\bjwt\b|exp claim/i.test(message)) return "signed_out";
  if (statusCode === "403" || code === "AccessDenied" || status === 403 || /row-level security/i.test(message)) {
    // The session was checked before uploading and the path is in the player's own folder, so the
    // insert policy refused it for the kill switch - unless the flag says uploads are on, in which case
    // the server no longer took the session.
    return (await uploadsPaused()) === false ? "signed_out" : "paused";
  }
  return "network";
}

// Uploads an already-cropped picture (the avatar picker makes the blob) and makes it your picture.
// The new file gets its own name with a one-year cache; set_avatar then makes it current, and only
// then is the previous photo deleted. If set_avatar fails, the new file is deleted instead.
//   { ok: true, details } | { ok: false, reason: "type" | "too_large" | "paused" | "invalid" | "signed_out" | "network" }
// "paused" is the upload kill switch (PROFILES.md, Moderation).
export async function saveAvatarPhoto(userId, blob, previousPath) {
  if (!userId) return failed("signed_out");
  if (!blob || typeof blob !== "object" || !AVATAR_TYPES.includes(blob.type) || !(blob.size > 0)) return failed("type");
  if (blob.size > AVATAR_MAX_BYTES) return failed("too_large");
  const session = await sessionUserId();
  if (session === null || (session !== undefined && session !== userId)) return failed("signed_out");
  const path = avatarObjectPath(userId, blob.type);
  let uploaded = false;
  try {
    const up = await getClient().storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
    if (!up || up.error) return failed(await uploadReason(up?.error));
    uploaded = true;
    const { data, error, status } = await getClient().rpc("set_avatar", { p_path: path, p_preset: null });
    if (error || !data || typeof data !== "object") {
      removeQuietly([path]);
      return failed(error ? callReason(error, status, AVATAR_REASONS) : "network");
    }
    removePrevious(userId, previousPath, path);
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    if (uploaded) removeQuietly([path]);
    return failed("network");
  }
}

// Shared by the two changes that don't upload anything: a default avatar, or no picture.
async function setAvatarWithout(previousPath, preset) {
  try {
    const { data, error, status } = await getClient().rpc("set_avatar", { p_path: null, p_preset: preset });
    if (error) return failed(callReason(error, status, AVATAR_REASONS));
    if (!data || typeof data !== "object") return failed("network");
    removePrevious(data.user_id, previousPath, data.avatar_path);
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return failed("network");
  }
}

// Picks one of the default avatars (replacing any photo, which is then deleted).
//   { ok: true, details } | { ok: false, reason: "invalid" | "signed_out" | "network" }
export async function setAvatarPreset(key, previousPath) {
  if (typeof key !== "string" || !key) return failed("invalid");
  return setAvatarWithout(previousPath, key);
}

// Back to the initial: no photo, no default avatar. A photo it replaces is deleted.
//   { ok: true, details } | { ok: false, reason: "signed_out" | "network" }
export async function removeAvatar(previousPath) {
  return setAvatarWithout(previousPath, null);
}

// Whether a username can be signed up with, asked before the signup itself so the form can say why.
//   "ok" | "taken" | "blocked" | "invalid", or null if the check couldn't run (signup still re-checks).
const USERNAME_RESULTS = ["ok", "taken", "blocked", "invalid"];
export async function checkUsername(name) {
  if (typeof name !== "string" || !USERNAME_RE.test(name)) return "invalid";
  try {
    const { data, error } = await getClient().rpc("check_username", { p_username: name }, READ);
    return !error && USERNAME_RESULTS.includes(data) ? data : null;
  } catch (e) {
    return null;
  }
}
