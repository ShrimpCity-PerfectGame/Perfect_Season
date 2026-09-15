// Rules shared by every part of the profile feature: the browser (profile.jsx, the avatar picker,
// storage-profile.js), the test mock, and the tests. The database enforces its own copy of the limits
// in supabase/migration-profiles.sql and migration-moderation.sql - keep both in step (the data tests
// check they agree). PROFILES.md is the contract this file is part of.
import { TEAMS } from "./game-logic.mjs";

export const BIO_MAX = 160;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const TEAM_CODES = Object.keys(TEAMS);

// ---------- Reports ----------
export const REPORT_REASONS = ["picture", "bio", "username", "other"];
export const REPORT_REASON_LABEL = { picture: "Picture", bio: "Bio", username: "Username", other: "Something else" };
export const REPORT_NOTE_MAX = 200;
export const REPORTS_PER_DAY = 10;

// ---------- Pictures ----------
export const AVATAR_BUCKET = "avatars";
export const AVATAR_SIZE = 256; // the square every uploaded photo is cropped and resized to
export const AVATAR_MAX_BYTES = 262144; // 256 KB, also the bucket's own limit
export const AVATAR_TYPES = ["image/webp", "image/jpeg", "image/png"];
const AVATAR_EXT = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
// An uploaded picture lives at "<user id>/<Date.now()>.<ext>": the player's own folder, and a new name
// every time, so no browser or CDN cache ever shows the previous picture.
export const avatarObjectPath = (userId, type, now = Date.now()) => `${userId}/${now}.${AVATAR_EXT[type]}`;
export function isOwnAvatarPath(userId, path) {
  if (typeof path !== "string" || !userId) return false;
  const [folder, file, extra] = path.split("/");
  return extra === undefined && folder === String(userId) && /^\d{10,16}\.(webp|jpg|png)$/.test(file || "");
}

// The default avatars anyone can pick for free. avatars.jsx draws them, and the database's
// avatar_presets table lists the same keys.
export const FREE_AVATAR_PRESETS = [
  { key: "football", name: "Football" },
  { key: "helmet", name: "Helmet" },
  { key: "trophy", name: "Trophy" },
  { key: "whistle", name: "Whistle" },
  { key: "foam-finger", name: "Foam finger" },
  { key: "goalposts", name: "Goalposts" },
  { key: "clipboard", name: "Clipboard" },
  { key: "stopwatch", name: "Stopwatch" },
  { key: "megaphone", name: "Megaphone" },
  { key: "jersey", name: "Jersey" },
  { key: "lightning", name: "Lightning" },
  { key: "crown", name: "Crown" },
];

// ---------- Bios ----------
// Characters a bio may not contain: control characters, line and paragraph separators (U+2028, U+2029 -
// a bio is one line), and invisible, direction-changing or deprecated format characters that can hide a
// word or flip how the text reads (including the Arabic letter mark, U+061C, and U+206A-U+206F). Zero-width
// joiners (U+200C, U+200D) are allowed, since emoji sequences need them - the word filter ignores them when
// it matches. supabase/migration-profiles.sql refuses the same set (save_profile and the bio constraint).
const DISALLOWED = "\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B\\u200E\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF";
export const hasDisallowedChars = (text) => new RegExp(`[${DISALLOWED}]`).test(String(text ?? ""));
// One line of plain text: runs of whitespace (newlines included) become one space, disallowed
// characters go, and the ends are trimmed. It never shortens the text - the editor shows the count,
// and the database rejects anything over BIO_MAX.
export function cleanBio(text) {
  return String(text ?? "").replace(/\s+/g, " ").replace(new RegExp(`[${DISALLOWED}]`, "g"), "").trim();
}
// Length the way the database counts it: char_length counts code points, where String.length counts
// UTF-16 units (an emoji is 1 there and 2 here).
export const bioLength = (text) => [...String(text ?? "")].length;

// ---------- Profile addresses ----------
export const profilePath = (username) => `/u/${encodeURIComponent(username)}`;
export function parseProfilePath(pathname) {
  const m = /^\/u\/([A-Za-z0-9_]{3,16})\/?$/.exec(pathname || "");
  return m ? m[1] : null;
}

// ---------- player_stats ----------
// What player_stats() (supabase/migration-runs-log.sql) returns for an account with no history. The
// SQL, the test mock (tests/mock-profile-stats.mjs) and mapPlayerStats below all follow PROFILES.md.
export const EMPTY_PLAYER_STATS = Object.freeze({
  since: null, by_ladder: [], wins: [], best_points: null, go_to_players: [], team_counts: [],
  by_format: {
    fantasy: { champs: 0, biggest_upset: null, best_gm: null },
    standard: { champs: 0, biggest_upset: null, best_gm: null },
  },
  dailies: { played: 0, best_score: null, best_w: null, best_l: null, best_rank: null },
  over_under: { played: 0, best: null },
  builds: { count: 0, best: null },
});
export const emptyPlayerStats = () => JSON.parse(JSON.stringify(EMPTY_PLAYER_STATS));

const num = (v) => (v == null ? null : Number(v));
const int = (v) => Number(v) || 0;
// player_stats() JSON as the app's camelCase shape. Postgres numerics can arrive as strings through
// some drivers, so every number is coerced here rather than at each use.
export function mapPlayerStats(json) {
  const s = json || EMPTY_PLAYER_STATS;
  const byFormat = (f) => {
    const b = s.by_format?.[f] || {};
    const u = b.biggest_upset, g = b.best_gm;
    return {
      champs: int(b.champs),
      biggestUpset: u ? { score: Number(u.score), w: int(u.w), l: int(u.l), ladder: u.ladder, createdAt: u.created_at ?? null } : null,
      bestGm: g ? { score: Number(g.score), w: int(g.w), l: int(g.l) } : null,
    };
  };
  return {
    since: s.since ?? null,
    byLadder: (s.by_ladder || []).map((r) => ({
      ladder: r.ladder, seasons: int(r.seasons), dnf: int(r.dnf), wins: int(r.wins), losses: int(r.losses),
      champs: int(r.champs), perfect: int(r.perfect), playoffs: int(r.playoffs),
      bestScore: num(r.best_score), bestScoreStd: num(r.best_score_std),
    })),
    wins: (s.wins || []).map((r) => ({ w: int(r.w), n: int(r.n) })),
    bestPoints: num(s.best_points),
    goToPlayers: (s.go_to_players || []).map((p) => ({ name: p.name, season: int(p.season), team: p.team, count: int(p.count) })),
    teamCounts: (s.team_counts || []).map((t) => ({ team: t.team, count: int(t.count) })),
    byFormat: { fantasy: byFormat("fantasy"), standard: byFormat("standard") },
    dailies: {
      played: int(s.dailies?.played), bestScore: num(s.dailies?.best_score),
      bestW: num(s.dailies?.best_w), bestL: num(s.dailies?.best_l), bestRank: num(s.dailies?.best_rank),
    },
    overUnder: { played: int(s.over_under?.played), best: num(s.over_under?.best) },
    builds: { count: int(s.builds?.count), best: s.builds?.best ? { pos: s.builds.best.pos, overall: Number(s.builds.best.overall) } : null },
  };
}
