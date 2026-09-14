// The test mock's side of supabase/migration-profiles.sql: profile_details, avatar_presets,
// blocked_words, site_flags, the avatars storage bucket, and the functions save_profile, set_avatar,
// check_username and player_profile. Contract: PROFILES.md.
//
// A database function that refuses something throws new Error("<code>") (for example "bio_blocked");
// tests/mock-supabase.mjs's rpc() turns that into the { data: null, error: { message, code } } a real
// PostgREST call returns.
//
// PHASE 0 STARTING POINT (agent B completes it): the happy paths work, the limits are checked, and the
// word filter lets everything through until isClean is written.
import {
  BIO_MAX, bioLength, hasDisallowedChars, TEAM_CODES, USERNAME_RE, FREE_AVATAR_PRESETS, isOwnAvatarPath,
  AVATAR_BUCKET, AVATAR_TYPES, AVATAR_MAX_BYTES,
} from "../profile-rules.mjs";

const fail = (code) => { throw new Error(code); };

// state: { profiles, runs, dailyRuns, souRuns, builds, currentUserId, isModerator }
// playerStats: tests/mock-profile-stats.mjs's playerStats(state, userId)
export function makeProfileData(state, { playerStats }) {
  const details = new Map(); // user_id -> row
  const presets = new Map(FREE_AVATAR_PRESETS.map((p) => [p.key, { key: p.key, pack: "starter", free: true }]));
  const blockedWords = new Map(); // word -> { word, match }
  const siteFlags = new Map([["uploads_paused", { key: "uploads_paused", enabled: false }]]);
  const objects = new Map(); // "bucket/path" -> { bucket, path, contentType, size, owner, publicUrl? }

  // The word filter. PHASE 0: everything is clean.
  function isClean(text) {
    return true;
  }

  const detailsJson = (d) => d && { user_id: d.user_id, bio: d.bio, avatar_path: d.avatar_path, avatar_preset: d.avatar_preset, favorite_team: d.favorite_team, updated_at: d.updated_at };
  function upsertDetails(uid, patch) {
    const row = details.get(uid) || { user_id: uid, bio: "", avatar_path: null, avatar_preset: null, favorite_team: null };
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    details.set(uid, row);
    return detailsJson(row);
  }
  const signedIn = () => state.currentUserId() || fail("not_signed_in");

  const rpcs = {
    save_profile({ p_bio, p_favorite_team } = {}) {
      const uid = signedIn();
      const bio = String(p_bio ?? "").trim();
      if (bioLength(bio) > BIO_MAX) fail("bio_too_long");
      if (hasDisallowedChars(bio)) fail("bio_invalid");
      if (!isClean(bio)) fail("bio_blocked");
      if (p_favorite_team != null && !TEAM_CODES.includes(p_favorite_team)) fail("bad_team");
      return upsertDetails(uid, { bio, favorite_team: p_favorite_team ?? null });
    },
    set_avatar({ p_path = null, p_preset = null } = {}) {
      const uid = signedIn();
      if (p_path != null && p_preset != null) fail("bad_request");
      if (p_path != null && !isOwnAvatarPath(uid, p_path)) fail("bad_path");
      if (p_preset != null && !presets.get(p_preset)?.free) fail("bad_preset");
      return upsertDetails(uid, { avatar_path: p_path, avatar_preset: p_preset });
    },
    check_username({ p_username } = {}) {
      const name = String(p_username ?? "");
      if (!USERNAME_RE.test(name)) return "invalid";
      if ([...state.profiles.values()].some((r) => r.username === name)) return "taken";
      if (!isClean(name)) return "blocked";
      return "ok";
    },
    player_profile({ p_username } = {}) {
      const all = [...state.profiles.values()];
      let row = all.find((r) => r.username === p_username);
      if (!row) {
        const lower = String(p_username ?? "").toLowerCase();
        const matches = all.filter((r) => String(r.username).toLowerCase() === lower);
        if (matches.length === 1) row = matches[0];
      }
      if (!row) return null;
      return { profile: { ...row }, details: detailsJson(details.get(row.id)) || null, stats: playerStats(state, row.id) };
    },
  };

  const storageError = (statusCode, message) => ({ data: null, error: { statusCode, message } });
  const storage = {
    from(bucket) {
      return {
        async upload(path, body, opts = {}) {
          const uid = state.currentUserId();
          const type = opts.contentType || body?.type;
          const size = body?.size ?? 0;
          if (bucket === AVATAR_BUCKET) {
            if (!uid || String(path).split("/")[0] !== uid || siteFlags.get("uploads_paused")?.enabled) {
              return storageError("403", "new row violates row-level security policy");
            }
            if (!AVATAR_TYPES.includes(type)) return storageError("415", `mime type ${type} is not supported`);
            if (size > AVATAR_MAX_BYTES) return storageError("413", "The object exceeded the maximum allowed size");
          }
          const key = `${bucket}/${path}`;
          if (objects.has(key) && !opts.upsert) return storageError("409", "The resource already exists");
          objects.set(key, { bucket, path, contentType: type, size, owner: uid });
          return { data: { path }, error: null };
        },
        async remove(paths) {
          const uid = state.currentUserId();
          const removed = [];
          for (const path of paths || []) {
            const key = `${bucket}/${path}`;
            const mine = uid && String(path).split("/")[0] === uid;
            if (objects.has(key) && (mine || state.isModerator?.(uid))) { objects.delete(key); removed.push({ name: path }); }
          }
          return { data: removed, error: null };
        },
        getPublicUrl(path) {
          const o = objects.get(`${bucket}/${path}`);
          return { data: { publicUrl: o?.publicUrl || `https://storage.mock/${bucket}/${path}` } };
        },
      };
    },
  };

  return {
    tables: { profile_details: details, avatar_presets: presets, blocked_words: blockedWords, site_flags: siteFlags },
    rpcs,
    storage,
    isClean,
    objects,
  };
}
