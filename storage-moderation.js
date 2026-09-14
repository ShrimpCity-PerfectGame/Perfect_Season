// Reports and moderation. Contract: PROFILES.md. reports and moderators have no client policies at all;
// everything goes through the database functions in supabase/migration-moderation.sql, which check
// who is asking. Nothing here throws.
import { getClient, READ, rpcReason } from "./storage-core.js";
import { avatarUrl } from "./storage-profile.js";
import { AVATAR_BUCKET } from "./profile-rules.mjs";

const REPORT_REASONS = { limit: "limit", duplicate: "duplicate", self: "self", not_signed_in: "signed_out", no_such_player: "missing", bad_reason: "invalid", note_too_long: "invalid" };
const MOD_REASONS = { not_moderator: "not_moderator", taken: "taken", blocked: "blocked", invalid: "invalid", no_such_player: "missing", bad_action: "invalid" };

// Reports a player. reason is one of profile-rules.mjs's REPORT_REASONS.
//   { ok: true } | { ok: false, reason: "limit" | "duplicate" | "self" | "signed_out" | "missing" | "invalid" | "network" }
export async function reportPlayer(username, reason, note) {
  try {
    const { error } = await getClient().rpc("report_player", { p_username: username, p_reason: reason, p_note: note || "" });
    if (error) return { ok: false, reason: rpcReason(error, REPORT_REASONS) };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

// Whether the signed-in player is a moderator. false whenever it can't be checked.
export async function isModerator() {
  try {
    const { data, error } = await getClient().rpc("is_moderator", {}, READ);
    return !error && data === true;
  } catch (e) {
    return false;
  }
}

// Open reports grouped by reported player, oldest first. null if it can't be loaded.
//   [{ userId, username, avatarPath, avatarUrl, avatarPreset, bio, favoriteTeam, reports: [{ id, reason, note, reporter, createdAt }] }]
export async function fetchModQueue() {
  try {
    const { data, error } = await getClient().rpc("mod_queue", {}, READ);
    if (error || !Array.isArray(data)) return null;
    return data.map((r) => ({
      userId: r.user_id, username: r.username, avatarPath: r.avatar_path ?? null, avatarUrl: avatarUrl(r.avatar_path),
      avatarPreset: r.avatar_preset ?? null, bio: r.bio || "", favoriteTeam: r.favorite_team ?? null,
      reports: (r.reports || []).map((x) => ({ id: x.id, reason: x.reason, note: x.note || "", reporter: x.reporter, createdAt: x.created_at })),
    }));
  } catch (e) {
    return null;
  }
}

// A moderator action on one player: "remove_picture" | "clear_bio" | "rename" | "dismiss".
// newName is only for "rename". Removing a picture also deletes the file.
//   { ok: true } | { ok: false, reason: "not_moderator" | "taken" | "blocked" | "invalid" | "missing" | "network" }
export async function modAction(userId, action, newName) {
  try {
    const { data, error } = await getClient().rpc("mod_act", { p_user_id: userId, p_action: action, p_new_name: newName ?? null });
    if (error) return { ok: false, reason: rpcReason(error, MOD_REASONS) };
    if (data?.removed_path) {
      try { Promise.resolve(getClient().storage.from(AVATAR_BUCKET).remove([data.removed_path])).catch(() => {}); } catch (e) { /* best effort */ }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}
