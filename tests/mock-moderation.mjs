// The test mock's side of supabase/migration-moderation.sql: moderators, reports, and the functions
// is_moderator, report_player, mod_queue and mod_act. Contract: PROFILES.md (3.3). Refusals throw
// new Error("<code>"), which tests/mock-supabase.mjs's rpc() returns as a PostgREST-style error.
//
// tests/test-moderation.mjs runs one sequence of calls through this and through the real SQL and requires
// the same results, so every check below is made in the same order as the SQL makes it.
import { REPORT_REASONS, REPORT_NOTE_MAX, REPORTS_PER_DAY, USERNAME_RE } from "../profile-rules.mjs";

const fail = (code) => { throw new Error(code); };
const DAY_MS = 24 * 60 * 60 * 1000;
// btrim(note, E' \t\n\r'): the database trims only these, where String.trim() would also take
// non-breaking and other Unicode spaces.
const trimNote = (text) => String(text ?? "").replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
// char_length counts code points; String.length counts UTF-16 units.
const charLength = (text) => [...text].length;
const time = (t) => Date.parse(t);
// Postgres orders uuids byte by byte, which for their lowercase text form is plain string order.
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Report ids are uuid-shaped and count up, so two reports made in the same millisecond still list in
// the order they were made (the SQL's microsecond timestamps never tie in practice).
const reportId = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// state: { profiles, runs, dailyRuns, souRuns, builds, currentUserId, isModerator }
// profileData: tests/mock-profile-data.mjs's makeProfileData result (profile_details and the word filter)
export function makeModeration(state, profileData) {
  const moderators = new Map(); // user_id -> { user_id, added_at }
  const reports = new Map(); // id -> row, the reports table's columns
  let nextId = 1;
  const isModerator = (uid) => !!uid && moderators.has(uid);
  const requireModerator = () => (isModerator(state.currentUserId()) ? state.currentUserId() : fail("not_moderator"));
  const byName = (name) => [...state.profiles.values()].find((r) => r.username === name) || null;
  // Rows a test put in through the _reports escape hatch may leave out columns that have defaults.
  const isOpen = (r) => (r.status ?? "open") === "open";
  const details = () => profileData.tables.profile_details;

  const rpcs = {
    is_moderator() {
      return isModerator(state.currentUserId());
    },

    report_player({ p_username, p_reason, p_note = "" } = {}) {
      const uid = state.currentUserId();
      if (!uid || !state.profiles.has(uid)) fail("not_signed_in");
      const target = byName(p_username) || fail("no_such_player");
      if (target.id === uid) fail("self");
      if (!REPORT_REASONS.includes(p_reason)) fail("bad_reason");
      const note = trimNote(p_note);
      if (charLength(note) > REPORT_NOTE_MAX) fail("note_too_long");
      // Resolved reports still count toward the limit, as in the SQL.
      const since = Date.now() - DAY_MS;
      if ([...reports.values()].filter((r) => r.reporter_id === uid && time(r.created_at) > since).length >= REPORTS_PER_DAY) fail("limit");
      if ([...reports.values()].some((r) => isOpen(r) && r.reporter_id === uid && r.target_id === target.id && r.reason === p_reason)) fail("duplicate");
      let id = reportId(nextId++);
      while (reports.has(id)) id = reportId(nextId++);
      reports.set(id, {
        id, reporter_id: uid, target_id: target.id, reason: p_reason, note, status: "open",
        created_at: new Date().toISOString(), resolved_by: null, resolved_at: null, action: null,
      });
      return { ok: true };
    },

    mod_queue() {
      requireModerator();
      const open = [...reports.values()].filter((r) => isOpen(r) && state.profiles.has(r.target_id))
        .sort((a, b) => time(a.created_at) - time(b.created_at) || byText(a.id, b.id));
      const groups = new Map(); // target_id -> { oldest, entry }
      for (const r of open) {
        if (!groups.has(r.target_id)) {
          const target = state.profiles.get(r.target_id);
          const d = details().get(r.target_id);
          groups.set(r.target_id, {
            oldest: time(r.created_at),
            entry: {
              user_id: target.id, username: target.username,
              avatar_path: d?.avatar_path ?? null, avatar_preset: d?.avatar_preset ?? null,
              // No details row means the player never saved anything.
              bio: d?.bio ?? "", favorite_team: d?.favorite_team ?? null,
              reports: [],
            },
          });
        }
        groups.get(r.target_id).entry.reports.push({
          id: r.id, reason: r.reason, note: r.note ?? "", reporter: state.profiles.get(r.reporter_id)?.username ?? null, created_at: r.created_at,
        });
      }
      return [...groups.values()].sort((a, b) => a.oldest - b.oldest || byText(a.entry.username, b.entry.username)).map((g) => g.entry);
    },

    mod_act({ p_user_id, p_action, p_new_name = null } = {}) {
      const mod = requireModerator();
      if (p_user_id == null || !state.profiles.has(p_user_id)) fail("no_such_player");
      const d = details().get(p_user_id);
      const now = new Date().toISOString();
      let reason = null;
      let removed_path = null;

      if (p_action === "remove_picture") {
        removed_path = d?.avatar_path ?? null;
        if (d) Object.assign(d, { avatar_path: null, avatar_preset: null, updated_at: now });
        reason = "picture";
      } else if (p_action === "clear_bio") {
        if (d) Object.assign(d, { bio: "", updated_at: now });
        reason = "bio";
      } else if (p_action === "rename") {
        // PostgREST hands the database a JSON number as text, so a number is checked as its digits.
        const name = p_new_name == null ? null : String(p_new_name);
        if (name == null || !USERNAME_RE.test(name)) fail("invalid");
        if (byName(name) || profileData.isReservedUsername(name)) fail("taken");
        if (!profileData.isClean(name)) fail("blocked");
        state.profiles.get(p_user_id).username = name;
        for (const table of [state.runs, state.dailyRuns, state.souRuns, state.builds]) {
          for (const row of table.values()) if (row.user_id === p_user_id) row.username = name;
        }
        reason = "username";
      } else if (p_action !== "dismiss") {
        fail("bad_action");
      }

      for (const r of reports.values()) {
        if (isOpen(r) && r.target_id === p_user_id && (p_action === "dismiss" || r.reason === reason)) {
          Object.assign(r, { status: p_action === "dismiss" ? "dismissed" : "actioned", resolved_by: mod, resolved_at: now, action: p_action });
        }
      }
      return { ok: true, removed_path };
    },
  };

  return { tables: { moderators, reports }, rpcs, isModerator };
}
