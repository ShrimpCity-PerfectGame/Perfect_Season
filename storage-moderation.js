// Reports and moderation. Contract: PROFILES.md (4.2). reports and moderators have no client policies at
// all; everything goes through the database functions in supabase/migration-moderation.sql, which check
// who is asking. Nothing here throws: every failure comes back as a reason the screens put into words.
import { getClient, READ, rpcReason } from "./storage-core.js";
import { avatarUrl } from "./storage-profile.js";
import { AVATAR_BUCKET, isOwnAvatarPath } from "./profile-rules.mjs";

// What each database refusal means to the app. Anything else - a dropped connection, a server error, a
// function that isn't deployed yet - is "network" (storage-core.js's rpcReason).
const REPORT_REFUSALS = {
  limit: "limit", duplicate: "duplicate", self: "self", not_signed_in: "signed_out",
  no_such_player: "missing", bad_reason: "invalid", note_too_long: "invalid",
  // A guest may not report, for the reason a guest may not play the daily: the account costs nothing to
  // make, so six throwaways would put 24 open reports on somebody. Unmapped, this fell through to
  // "network" and told them their connection had failed - forever, for a rule rather than a fault.
  guest_not_allowed: "guest",
};
const MOD_REFUSALS = {
  not_moderator: "not_moderator", taken: "taken", blocked: "blocked", invalid: "invalid",
  no_such_player: "missing", bad_action: "invalid",
  // Raised in two functions and, for a release, mapped in neither - REPORT_REFUSALS above got it and this did
  // not. Renaming a guest strands the account (migration-moderation.sql), so mod_act refuses it, and unmapped
  // that refusal told a moderator their connection had failed.
  guest_not_allowed: "guest",
};

// PostgREST answers a request whose sign-in token has expired or doesn't verify with HTTP 401 (codes
// PGRST301-303) before any function runs, so there's no refusal code to read.
const signedOut = (res) => res?.status === 401 || /^PGRST30[123]$/.test(String(res?.error?.code || ""));

// Reports a player. reason is one of profile-rules.mjs's REPORT_REASONS.
//   { ok: true } | { ok: false, reason: "limit" | "duplicate" | "self" | "guest" | "signed_out" | "missing" | "invalid" | "network" }
export async function reportPlayer(username, reason, note) {
  try {
    const res = await getClient().rpc("report_player", { p_username: username, p_reason: reason, p_note: note || "" });
    if (res?.error) return { ok: false, reason: signedOut(res) ? "signed_out" : rpcReason(res.error, REPORT_REFUSALS) };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "network" };
  }
}

// Whether the signed-in player is a moderator. false whenever it can't be checked.
export async function isModerator() {
  try {
    const res = await getClient().rpc("is_moderator", {}, READ);
    return !res?.error && res?.data === true;
  } catch (e) {
    return false;
  }
}

const text = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

// Open reports grouped by reported player, oldest first (the database orders them). null if they can't be
// loaded - including for anyone who isn't a moderator.
//   [{ userId, username, guest, avatarPath, avatarUrl, avatarPreset, bio, favoriteTeam, reports: [{ id, reason, note, reporter, createdAt }] }]
export async function fetchModQueue() {
  try {
    const res = await getClient().rpc("mod_queue", {}, READ);
    if (res?.error || !Array.isArray(res?.data)) return null;
    return res.data
      .filter((r) => r && r.user_id && r.username)
      .map((r) => ({
        // The queue still lists a guest - an old report against one has to be dismissable - and this is how the
        // screen knows not to offer Rename, which mod_act refuses anyway.
        userId: r.user_id, username: text(r.username), guest: r.guest === true,
        avatarPath: r.avatar_path ?? null, avatarUrl: avatarUrl(r.avatar_path), avatarPreset: r.avatar_preset ?? null,
        bio: text(r.bio), favoriteTeam: r.favorite_team ?? null,
        reports: (Array.isArray(r.reports) ? r.reports : []).filter((x) => x && x.id).map((x) => ({
          id: x.id, reason: text(x.reason), note: text(x.note), reporter: x.reporter ?? null, createdAt: x.created_at ?? null,
        })),
      }));
  } catch (e) {
    return null;
  }
}

// A moderator action on one player: "remove_picture" | "clear_bio" | "rename" | "dismiss". newName is only
// for "rename". Removing a picture also deletes the file, which the moderator storage policy allows.
//   { ok: true } | { ok: false, reason: "not_moderator" | "taken" | "blocked" | "invalid" | "missing" | "network" }
export async function modAction(userId, action, newName) {
  let res;
  try {
    res = await getClient().rpc("mod_act", { p_user_id: userId, p_action: action, p_new_name: action === "rename" ? newName ?? null : null });
  } catch (e) {
    return { ok: false, reason: "network" };
  }
  if (res?.error) return { ok: false, reason: rpcReason(res.error, MOD_REFUSALS) };
  // The action has landed by now, so a file that can't be deleted doesn't make it a failure. Best effort,
  // like storage-profile.js's removal of a replaced photo.
  // Only ever a file in that player's own folder: the moderator storage policy could delete any avatar, so a
  // path that isn't theirs (the database never returns one) is left alone.
  const removed = res?.data?.removed_path;
  if (isOwnAvatarPath(userId, removed)) {
    try { Promise.resolve(getClient().storage.from(AVATAR_BUCKET).remove([removed])).catch(() => {}); } catch (e) { /* best effort */ }
  }
  return { ok: true };
}
