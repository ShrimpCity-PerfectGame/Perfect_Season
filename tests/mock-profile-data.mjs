// The test mock's side of supabase/migration-profiles.sql: profile_details, avatar_presets,
// blocked_words, site_flags, the avatars storage bucket with its policies, and the functions
// text_is_clean, save_profile, set_avatar, check_username, claim_username and player_profile.
// Contract: PROFILES.md.
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

// The shape of a name a guest is given (migration-profiles.sql's new_guest_name), which no client may pick.
// Broader than what the generator produces, deliberately: the rule is that nobody else may LOOK like a
// guest, and `Guest_ZZZZZ` used to be anybody's while rendering with no chip and a working profile link.
export const GUEST_NAME_RE = /^guest_[a-z0-9]{1,10}$/i;
export const newGuestName = (taken = new Set()) => {
  for (let i = 0; i < 20; i++) {
    const name = `Guest_${Math.random().toString(16).slice(2, 7).toUpperCase()}`;
    if (!taken.has(name)) return name;
  }
  return `Guest_${Date.now().toString(16).slice(-5).toUpperCase()}`;
};

// Usernames only one account may hold in any capitalization (migration-profiles.sql's username_is_reserved).
export const RESERVED_USERNAMES = ["admin"];

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
// 1. NFKC turns compatibility forms into the characters they stand for (full-width, mathematical, circled
//    and superscript letters, ligatures). NFD then splits every accented letter into its letter and its
//    accents: without it NFKC would rejoin an accent typed after a letter into an accented letter this
//    file doesn't list, and that letter would split the word instead of reading as a plain one.
// 2. Dropped: invisible characters (zero-width, soft hyphen, fillers, direction and format controls,
//    variation selectors, tags) and combining marks, so the accents NFD split off go, and so does an
//    accent or joiner typed inside a word.
export const FILTER_DROPPED = [
  [0xAD], [0x300, 0x36F], [0x61C], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180B, 0x180F], [0x1AB0, 0x1AFF], [0x1DC0, 0x1DFF],
  [0x200B, 0x200F], [0x202A, 0x202E], [0x2060, 0x206F], [0x20D0, 0x20FF], [0x3164], [0xFE00, 0xFE0F], [0xFE20, 0xFE2F], [0xFEFF],
  [0xFFA0], [0xFFF9, 0xFFFB], [0xE0000, 0xE0FFF],
].map(([from, to = from]) => [from, to]);
const dropped = (c) => {
  const n = c.codePointAt(0);
  return FILTER_DROPPED.some(([from, to]) => n >= from && n <= to);
};
// Letters written as two: sharp s (small and capital), ae and oe (small and capital).
export const FILTER_EXPANSIONS = [[cp(0xDF), "ss"], [cp(0x1E9E), "ss"], [cp(0xE6), "ae"], [cp(0xC6), "ae"], [cp(0x153), "oe"], [cp(0x152), "oe"]];
// 3. Every letter that can stand for a plain one becomes that lowercase letter: ASCII capitals, the Latin
//    letters that carry their mark in the letter itself (so NFD doesn't split them: o with stroke, d with
//    stroke, eth, h with stroke, dotless i, kra, l with stroke, t with stroke, script a and g), and the
//    Cyrillic and Greek letters that look like Latin ones (a pasted Cyrillic "c" in a word otherwise hides
//    it). Lowercasing only through this table, never toLowerCase()/lower(), keeps the result the same in
//    every browser and database locale.
const FOLD_GROUPS = {
  a: "A" + cp(0x251) + cp(0x410) + cp(0x430) + cp(0x391) + cp(0x3B1),
  b: "B" + cp(0x412) + cp(0x392),
  c: "C" + cp(0x421) + cp(0x441),
  d: "D" + cp(0xD0) + cp(0xF0) + cp(0x110, 0x111) + cp(0x501),
  e: "E" + cp(0x415) + cp(0x435) + cp(0x395),
  f: "F",
  g: "G" + cp(0x261),
  h: "H" + cp(0x126, 0x127) + cp(0x41D) + cp(0x4BB) + cp(0x397),
  i: "I" + cp(0x131) + cp(0x406) + cp(0x456) + cp(0x399) + cp(0x3B9),
  j: "J" + cp(0x408) + cp(0x458),
  k: "K" + cp(0x138) + cp(0x41A) + cp(0x43A) + cp(0x39A) + cp(0x3BA),
  l: "L" + cp(0x141, 0x142) + cp(0x4CF),
  m: "M" + cp(0x41C) + cp(0x39C),
  n: "N" + cp(0x39D),
  o: "O" + cp(0xD8) + cp(0xF8) + cp(0x41E) + cp(0x43E) + cp(0x39F) + cp(0x3BF),
  p: "P" + cp(0x420) + cp(0x440) + cp(0x3A1) + cp(0x3C1),
  q: "Q",
  r: "R",
  s: "S" + cp(0x405) + cp(0x455),
  t: "T" + cp(0x166, 0x167) + cp(0x422) + cp(0x3A4) + cp(0x3C4),
  u: "U" + cp(0x3C5),
  v: "V" + cp(0x3BD),
  w: "W",
  x: "X" + cp(0x425) + cp(0x445) + cp(0x3A7) + cp(0x3C7),
  y: "Y" + cp(0x423) + cp(0x443) + cp(0x3A5),
  z: "Z" + cp(0x396),
};
export let FILTER_FOLD_FROM = "", FILTER_FOLD_TO = "";
for (const [letter, chars] of Object.entries(FOLD_GROUPS)) {
  FILTER_FOLD_FROM += chars;
  FILTER_FOLD_TO += letter.repeat([...chars].length);
}
const FOLD = new Map([...FILTER_FOLD_FROM].map((c, i) => [c, [...FILTER_FOLD_TO][i]]));
// 4. Look-alikes (PROFILES.md 3.4, step 2).
export const FILTER_LOOKALIKE_FROM = "013457@$!|", FILTER_LOOKALIKE_TO = "oieastasil";
const LOOKALIKE = new Map([...FILTER_LOOKALIKE_FROM].map((c, i) => [c, FILTER_LOOKALIKE_TO[i]]));

// The four readings of a text the filter checks. Look-alikes mapped, and as typed: the same characters
// also sit next to words as punctuation or numbers, and read only with "!" as "i", "shit!" is the token
// "shiti" and "fuck1" is "fucki". And in each, every run of three or more of one letter cut to one
// ("fuuuck") and cut to two: a blocked word with a doubled letter otherwise gets through with that letter
// tripled, which the first cut reads as a single letter.
export function filterReadings(text) {
  let s = [...String(text ?? "").normalize("NFKC").normalize("NFD")].filter((c) => !dropped(c)).join("");
  for (const [from, to] of FILTER_EXPANSIONS) s = s.split(from).join(to);
  s = [...s].map((c) => FOLD.get(c) ?? c).join("");
  const mapped = [...s].map((c) => LOOKALIKE.get(c) ?? c).join("");
  return [mapped, s].flatMap((x) => [x.replace(/([a-z])\1{2,}/g, "$1"), x.replace(/([a-z])\1{2,}/g, "$1$1")]);
}

// text_is_clean(): false if any reading contains a blocked word. `entries` is [{ word, match }].
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
// avatar_folder_has_room(): the most files one player's avatars folder may hold before an upload is refused.
export const AVATAR_FOLDER_LIMIT = 10;

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
  // migration-profiles.sql's username_is_reserved: a reserved name that some account already holds, in any
  // capitalization.
  // Names no client may take: one a guest could be given (v1.17.0), whoever is asking, and "admin" once
  // some account holds it in any capitalization.
  const isReservedUsername = (name) => typeof name === "string"
    && (GUEST_NAME_RE.test(name)
      || (RESERVED_USERNAMES.includes(name.toLowerCase())
        && [...state.profiles.values()].some((r) => String(r.username).toLowerCase() === name.toLowerCase())));

  // Every column of the row, as to_jsonb gives it - v1.12.0's cosmetics (migration-shop.sql) included.
  const detailsJson = (d) => (d ? {
    user_id: d.user_id, bio: d.bio, avatar_path: d.avatar_path, avatar_preset: d.avatar_preset, favorite_team: d.favorite_team,
    frame: d.frame ?? null, card_theme: d.card_theme ?? null, title: d.title ?? null, showcase: [...(d.showcase || [])], updated_at: d.updated_at,
  } : null);
  // Also used by tests/mock-shop.mjs's equip_item and set_showcase, which write the same row.
  function upsertDetails(uid, patch) {
    const row = details.get(uid) || { user_id: uid, bio: "", avatar_path: null, avatar_preset: null, favorite_team: null, frame: null, card_theme: null, title: null, showcase: [] };
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
      // A paid pack's avatar needs the pack (SHOP.md 3.2); state.ownsAvatarPack is tests/mock-shop.mjs's, and
      // without the shop nothing paid is owned.
      if (p_preset != null) {
        const preset = presets.get(p_preset);
        if (!preset || !(preset.free || state.ownsAvatarPack?.(uid, preset.pack))) fail("bad_preset");
      }
      return upsertDetails(uid, { avatar_path: p_path ?? null, avatar_preset: p_preset ?? null });
    },
    // The name an account picks after signing in with Google: the only way a profile is made outside the
    // signup trigger, and never a rename (it refuses once the caller has one). Codes as the SQL returns them.
    claim_username({ p_username = null } = {}) {
      const uid = state.currentUserId();
      if (!uid) return "not_signed_in";
      const row = state.profiles.get(uid) || null;
      if (row && !row.guest) return "already_named";
      if (typeof p_username !== "string" || !USERNAME_RE.test(p_username)) return "invalid";
      if (isReservedUsername(p_username)) return "taken";
      if (!isClean(p_username)) return "blocked";
      if ([...state.profiles.values()].some((r) => r.username === p_username)) return "taken";
      if (!row) state.createProfile(uid, p_username);
      else state.renameAccount(uid, p_username); // a guest keeping what it played, under its own name
      return "ok";
    },
    check_username({ p_username = null } = {}) {
      if (typeof p_username !== "string" || !USERNAME_RE.test(p_username)) return "invalid";
      if ([...state.profiles.values()].some((r) => r.username === p_username)) return "taken";
      if (isReservedUsername(p_username)) return "taken";
      if (!isClean(p_username)) return "blocked";
      return "ok";
    },
    player_profile({ p_username = null } = {}) {
      if (p_username == null) return null;
      // A guest has no profile screen at all, so its address answers like any other name nobody holds.
      const all = [...state.profiles.values()].filter((r) => !r.guest);
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

  // Supabase Storage with this migration's policies on storage.objects: a signed-in player may read,
  // replace and delete objects only inside their own folder; may add one only named exactly
  // "<their id>/<10-16 digits>.webp|jpg|png", while their folder holds fewer than AVATAR_FOLDER_LIMIT files;
  // and may add or replace one only while uploads aren't paused. Moderators may also read and delete any
  // avatar (migration-moderation.sql).
  const storage = {
    from(bucket) {
      const ownFolder = (uid, path) => !!uid && firstFolder(path) === uid;
      const folderCount = (uid) => [...objects.values()].filter((o) => o.bucket === AVATAR_BUCKET && String(o.path).startsWith(`${uid}/`)).length;
      return {
        async upload(path, body, opts = {}) {
          if (bucket !== AVATAR_BUCKET) return storageError(404, "404", "NoSuchBucket", "Bucket not found");
          const uid = state.currentUserId();
          const type = opts.contentType || body?.type || "";
          const size = body?.size ?? body?.byteLength ?? body?.length ?? 0;
          const key = `${bucket}/${path}`;
          if (!uid || !isOwnAvatarPath(uid, path) || uploadsPaused() || folderCount(uid) >= AVATAR_FOLDER_LIMIT) {
            return storageError(400, "403", "AccessDenied", "new row violates row-level security policy");
          }
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
        // One folder's entries the caller may read, by name: files, and each subfolder once with a null id,
        // as the real API lists them.
        async list(prefix = "", opts = {}) {
          if (bucket !== AVATAR_BUCKET) return storageError(404, "404", "NoSuchBucket", "Bucket not found");
          const uid = state.currentUserId();
          const folder = String(prefix ?? "").replace(/\/+$/, "");
          const entries = new Map();
          for (const o of objects.values()) {
            if (!uid || o.bucket !== bucket || !(ownFolder(uid, o.path) || state.isModerator?.(uid))) continue;
            const parts = String(o.path).split("/");
            const inside = folder ? (parts[0] === folder && parts.length > 1 ? parts.slice(1) : null) : parts;
            if (!inside) continue;
            const name = inside[0];
            if (inside.length === 1) entries.set(name, { name, id: `${o.bucket}/${o.path}`, metadata: { size: o.size, mimetype: o.contentType } });
            else if (!entries.has(name)) entries.set(name, { name, id: null, metadata: null });
          }
          const sorted = [...entries.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          return { data: sorted.slice(opts.offset || 0, (opts.offset || 0) + (opts.limit || 100)), error: null };
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
    isReservedUsername,
    objects,
    upsertDetails,
  };
}
