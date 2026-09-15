// The test mock's side of supabase/migration-profiles.sql: profile_details, avatar_presets,
// blocked_words, site_flags, the avatars storage bucket with its policies, and the functions
// text_is_clean, save_profile, set_avatar, check_username and player_profile. Contract: PROFILES.md.
// tests/test-profile-data.mjs runs the same calls through the real SQL (PGlite) and through this mock
// and requires the same results, and tests/test-word-filter.mjs does the same for the word filter, so
// every screen test that saves a bio or checks a username is testing what the database does.
//
// A database function that refuses something throws new Error("<code>") (for example "bio_blocked");
// tests/mock-supabase.mjs's rpc() turns that into the { data: null, error: { message, code } } a real
// PostgREST call returns. Storage calls return errors shaped like storage-js's StorageApiError.
import {
  BIO_MAX, bioLength, hasDisallowedChars, TEAM_CODES, USERNAME_RE, FREE_AVATAR_PRESETS, isOwnAvatarPath,
  AVATAR_BUCKET, AVATAR_TYPES, AVATAR_MAX_BYTES,
} from "../profile-rules.mjs";

// ---------- The word filter ----------
// The list migration-profiles.sql seeds, copied. test-word-filter.mjs fails if the two ever differ.
// Profanity matches as a whole word, slurs anywhere - except where a slur is part of ordinary words or
// names, which keeps it to whole words. See PROFILES.md 3.4 for what must pass and what must be blocked.
export const BLOCKED_WORDS_SEED = [
  ["asshole", "word"], ["bitch", "word"], ["blowjob", "word"], ["bullshit", "word"], ["cocksucker", "word"],
  ["cunt", "word"], ["dickhead", "word"], ["dildo", "word"], ["dipshit", "word"], ["faggot", "anywhere"],
  ["fuck", "anywhere"], ["gook", "word"], ["jizz", "word"], ["nigga", "anywhere"], ["nigger", "anywhere"],
  ["raghead", "word"], ["retard", "word"], ["retarded", "word"], ["shit", "word"], ["shithead", "word"],
  ["shitty", "word"], ["slut", "word"], ["towelhead", "word"], ["twat", "word"], ["wanker", "word"],
  ["wetback", "word"], ["whore", "word"],
].map(([word, match]) => ({ word, match }));

// Matching reads a normalized copy of the text; the text itself is never changed. text_is_clean() in
// the SQL spells out these same tables, and test-word-filter.mjs runs every character in them through
// both. Characters are given by code point so nothing invisible or look-alike hides in this file.
const cp = (from, to = from) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).join("");
//
// Dropped first: zero-width and other invisible characters, and combining accents, so a decomposed
// "i" followed by U+0301 reads as a plain "i".
export const FILTER_INVISIBLE = [
  [0xAD], [0x34F], [0x300, 0x36F], [0x180E], [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x2069], [0xFE00, 0xFE0F], [0xFEFF],
].map(([from, to]) => cp(from, to)).join("");
const INVISIBLE = new Set(FILTER_INVISIBLE);
// Letters written as two: sharp s (small and capital), ae and oe (small and capital).
export const FILTER_EXPANSIONS = [[cp(0xDF), "ss"], [cp(0x1E9E), "ss"], [cp(0xE6), "ae"], [cp(0xC6), "ae"], [cp(0x153), "oe"], [cp(0x152), "oe"]];
// Then every letter that can stand for a plain one becomes that lowercase letter: ASCII capitals,
// accented Latin letters in both cases, full-width letters, and the Cyrillic and Greek letters that
// look like Latin ones (a pasted Cyrillic "c" in the middle of a word otherwise hides it). Lowercasing
// only through this table, never toLowerCase()/lower(), keeps the result the same in every browser and
// database locale.
const FOLD_GROUPS = {
  a: "A" + cp(0xC0, 0xC5) + cp(0xE0, 0xE5) + cp(0x100, 0x105) + cp(0x410) + cp(0x430) + cp(0x391) + cp(0x3B1) + cp(0x212B),
  b: "B" + cp(0x412) + cp(0x392),
  c: "C" + cp(0xC7) + cp(0xE7) + cp(0x106, 0x10D) + cp(0x421) + cp(0x441),
  d: "D" + cp(0xD0) + cp(0xF0) + cp(0x10E, 0x111) + cp(0x501),
  e: "E" + cp(0xC8, 0xCB) + cp(0xE8, 0xEB) + cp(0x112, 0x11B) + cp(0x415) + cp(0x435) + cp(0x395),
  f: "F",
  g: "G" + cp(0x11C, 0x123),
  h: "H" + cp(0x124, 0x127) + cp(0x41D) + cp(0x4BB) + cp(0x397),
  i: "I" + cp(0xCC, 0xCF) + cp(0xEC, 0xEF) + cp(0x128, 0x131) + cp(0x406) + cp(0x456) + cp(0x399) + cp(0x3B9),
  j: "J" + cp(0x134, 0x135) + cp(0x408) + cp(0x458),
  k: "K" + cp(0x136, 0x138) + cp(0x41A) + cp(0x43A) + cp(0x39A) + cp(0x3BA) + cp(0x212A),
  l: "L" + cp(0x139, 0x142) + cp(0x4CF),
  m: "M" + cp(0x41C) + cp(0x39C),
  n: "N" + cp(0xD1) + cp(0xF1) + cp(0x143, 0x148) + cp(0x39D),
  o: "O" + cp(0xD2, 0xD6) + cp(0xD8) + cp(0xF2, 0xF6) + cp(0xF8) + cp(0x14C, 0x151) + cp(0x41E) + cp(0x43E) + cp(0x39F) + cp(0x3BF),
  p: "P" + cp(0x420) + cp(0x440) + cp(0x3A1) + cp(0x3C1),
  q: "Q",
  r: "R" + cp(0x154, 0x159),
  s: "S" + cp(0x15A, 0x161) + cp(0x17F) + cp(0x218, 0x219) + cp(0x405) + cp(0x455),
  t: "T" + cp(0x162, 0x167) + cp(0x21A, 0x21B) + cp(0x422) + cp(0x3A4) + cp(0x3C4),
  u: "U" + cp(0xD9, 0xDC) + cp(0xF9, 0xFC) + cp(0x168, 0x173) + cp(0x3C5),
  v: "V" + cp(0x3BD),
  w: "W" + cp(0x174, 0x175),
  x: "X" + cp(0x425) + cp(0x445) + cp(0x3A7) + cp(0x3C7),
  y: "Y" + cp(0xDD) + cp(0xFD) + cp(0xFF) + cp(0x176, 0x178) + cp(0x423) + cp(0x443) + cp(0x3A5),
  z: "Z" + cp(0x179, 0x17E) + cp(0x396),
};
export let FILTER_FOLD_FROM = "", FILTER_FOLD_TO = "";
Object.entries(FOLD_GROUPS).forEach(([letter, chars], i) => {
  const all = chars + cp(0xFF21 + i) + cp(0xFF41 + i); // full-width capital and small
  FILTER_FOLD_FROM += all;
  FILTER_FOLD_TO += letter.repeat([...all].length);
});
const FOLD = new Map([...FILTER_FOLD_FROM].map((c, i) => [c, [...FILTER_FOLD_TO][i]]));
// Look-alikes (PROFILES.md 3.4, step 2).
export const FILTER_LOOKALIKE_FROM = "013457@$!|", FILTER_LOOKALIKE_TO = "oieastasil";
const LOOKALIKE = new Map([...FILTER_LOOKALIKE_FROM].map((c, i) => [c, FILTER_LOOKALIKE_TO[i]]));

// The two readings of a text the filter checks: with look-alikes mapped, and as typed. Mapping is a
// second reading rather than the only one because the same characters also sit next to words as
// punctuation or numbers - read only with "!" as "i", "shit!" is the token "shiti" and "fuck1" is
// "fucki", and neither would match.
export function filterReadings(text) {
  let s = [...String(text ?? "")].filter((c) => !INVISIBLE.has(c)).join("");
  for (const [from, to] of FILTER_EXPANSIONS) s = s.split(from).join(to);
  s = [...s].map((c) => FOLD.get(c) ?? c).join("");
  // Runs of three or more of the same letter count as one ("fuuuck").
  const collapse = (x) => x.replace(/([a-z])\1{2,}/g, "$1");
  return [collapse([...s].map((c) => LOOKALIKE.get(c) ?? c).join("")), collapse(s)];
}

// text_is_clean(): false if either reading contains a blocked word. `entries` is [{ word, match }].
export function textIsClean(text, entries) {
  const list = [...entries];
  for (const reading of filterReadings(text)) {
    // A 'word' entry matches a whole token, or the token less a plural "s" or "es".
    const tokens = reading.split(/[^a-z]+/).filter(Boolean);
    const candidates = new Set(tokens.flatMap((t) => [t, t.endsWith("s") ? t.slice(0, -1) : "", t.endsWith("es") ? t.slice(0, -2) : ""]));
    // An 'anywhere' entry matches inside the letters with everything else removed ("f.u c-k").
    const letters = reading.replace(/[^a-z]+/g, "");
    if (list.some((b) => (b.match === "anywhere" ? letters.includes(b.word) : candidates.has(b.word)))) return false;
  }
  return true;
}

const fail = (code) => { throw new Error(code); };

// An object name's first folder, the way the storage policies read it with storage.foldername(name):
// "a/b/c.png" -> "a", and a name with no folder has none.
const firstFolder = (path) => {
  const parts = String(path ?? "").split("/");
  return parts.length > 1 ? parts[0] : null;
};
// Shaped like storage-js's StorageApiError: `status` is the HTTP status, `statusCode` and `code` come from
// the Storage API's error body.
const storageError = (status, statusCode, code, message) => ({ data: null, error: { name: "StorageApiError", message, status, statusCode, code } });

// state: { profiles, runs, dailyRuns, souRuns, builds, currentUserId, isModerator }
// playerStats: tests/mock-profile-stats.mjs's playerStats(state, userId)
export function makeProfileData(state, { playerStats }) {
  const details = new Map(); // user_id -> row
  const presets = new Map(FREE_AVATAR_PRESETS.map((p) => [p.key, { key: p.key, pack: "starter", free: true }]));
  const blockedWords = new Map(BLOCKED_WORDS_SEED.map((b) => [b.word, { ...b }])); // word -> { word, match }
  const siteFlags = new Map([["uploads_paused", { key: "uploads_paused", enabled: false }]]);
  // "bucket/path" -> { bucket, path, contentType, size, owner, cacheControl, publicUrl? }
  const objects = new Map();

  // Reads the table live, so a test can add or remove words through auth._blockedWords.
  const isClean = (text) => textIsClean(text, blockedWords.values());

  const detailsJson = (d) => (d ? { user_id: d.user_id, bio: d.bio, avatar_path: d.avatar_path, avatar_preset: d.avatar_preset, favorite_team: d.favorite_team, updated_at: d.updated_at } : null);
  function upsertDetails(uid, patch) {
    const row = details.get(uid) || { user_id: uid, bio: "", avatar_path: null, avatar_preset: null, favorite_team: null };
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    details.set(uid, row);
    return detailsJson(row);
  }
  // The functions act only on the caller's own row, and only for a signed-in player with an account.
  const player = () => {
    const uid = state.currentUserId();
    if (!uid || !state.profiles.has(uid)) fail("not_signed_in");
    return uid;
  };
  const uploadsPaused = () => !!siteFlags.get("uploads_paused")?.enabled;

  const rpcs = {
    save_profile({ p_bio = null, p_favorite_team = null } = {}) {
      const uid = player();
      const bio = String(p_bio ?? "").trim();
      if (bioLength(bio) > BIO_MAX) fail("bio_too_long");
      if (hasDisallowedChars(bio)) fail("bio_invalid");
      if (!isClean(bio)) fail("bio_blocked");
      const team = p_favorite_team ?? null;
      if (team !== null && !TEAM_CODES.includes(team)) fail("bad_team");
      return upsertDetails(uid, { bio, favorite_team: team });
    },
    set_avatar({ p_path = null, p_preset = null } = {}) {
      const uid = player();
      if (p_path != null && p_preset != null) fail("bad_request");
      if (p_path != null && !isOwnAvatarPath(uid, p_path)) fail("bad_path");
      if (p_preset != null && !presets.get(p_preset)?.free) fail("bad_preset");
      return upsertDetails(uid, { avatar_path: p_path ?? null, avatar_preset: p_preset ?? null });
    },
    check_username({ p_username = null } = {}) {
      if (typeof p_username !== "string" || !USERNAME_RE.test(p_username)) return "invalid";
      if ([...state.profiles.values()].some((r) => r.username === p_username)) return "taken";
      if (!isClean(p_username)) return "blocked";
      return "ok";
    },
    player_profile({ p_username = null } = {}) {
      if (p_username == null) return null;
      const all = [...state.profiles.values()];
      let row = all.find((r) => r.username === p_username);
      if (!row) {
        const lower = String(p_username).toLowerCase();
        const matches = all.filter((r) => String(r.username).toLowerCase() === lower);
        if (matches.length === 1) row = matches[0];
      }
      if (!row) return null;
      return { profile: { ...row }, details: detailsJson(details.get(row.id)), stats: playerStats(state, row.id) };
    },
  };

  // Supabase Storage with this migration's policies on storage.objects: a signed-in player may add,
  // read, replace and delete objects only inside their own folder, and may add or replace one only while
  // uploads aren't paused. Moderators may also delete any avatar (migration-moderation.sql).
  const storage = {
    from(bucket) {
      const ownFolder = (uid, path) => !!uid && firstFolder(path) === uid;
      return {
        async upload(path, body, opts = {}) {
          if (bucket !== AVATAR_BUCKET) return storageError(404, "404", "NoSuchBucket", "Bucket not found");
          const uid = state.currentUserId();
          const type = opts.contentType || body?.type || "";
          const size = body?.size ?? body?.byteLength ?? body?.length ?? 0;
          const key = `${bucket}/${path}`;
          if (!ownFolder(uid, path) || uploadsPaused()) return storageError(400, "403", "AccessDenied", "new row violates row-level security policy");
          if (!AVATAR_TYPES.includes(type)) return storageError(415, "415", "InvalidMimeType", `mime type ${type} is not supported`);
          if (size > AVATAR_MAX_BYTES) return storageError(413, "413", "EntityTooLarge", "The object exceeded the maximum allowed size");
          if (objects.has(key) && !opts.upsert) return storageError(409, "409", "KeyAlreadyExists", "The resource already exists");
          objects.set(key, { bucket, path, contentType: type, size, owner: uid, cacheControl: opts.cacheControl ?? null });
          return { data: { path, fullPath: key }, error: null };
        },
        // Like the real API: objects the caller may not delete (or that don't exist) are skipped, not
        // reported, and `data` lists what was actually removed.
        async remove(paths) {
          if (bucket !== AVATAR_BUCKET) return storageError(404, "404", "NoSuchBucket", "Bucket not found");
          const uid = state.currentUserId();
          const removed = [];
          for (const path of Array.isArray(paths) ? paths : []) {
            const key = `${bucket}/${path}`;
            if (!objects.has(key) || !uid) continue;
            if (ownFolder(uid, path) || state.isModerator?.(uid)) {
              objects.delete(key);
              removed.push({ name: path, bucket_id: bucket });
            }
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
