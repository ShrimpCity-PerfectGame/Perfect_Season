// The test mock's side of supabase/migration-moderation.sql: moderators, reports, and the functions
// is_moderator, report_player, mod_queue and mod_act. Contract: PROFILES.md. Refusals throw
// new Error("<code>"), which tests/mock-supabase.mjs's rpc() returns as a PostgREST-style error.
//
// PHASE 0 STARTING POINT (agent F completes it): the happy paths work; the daily limit, renames and
// the other checks are agent F's.
import { REPORT_REASONS, REPORT_NOTE_MAX } from "../profile-rules.mjs";

const fail = (code) => { throw new Error(code); };

// state: { profiles, runs, dailyRuns, souRuns, builds, currentUserId }
// profileData: tests/mock-profile-data.mjs's makeProfileData result
export function makeModeration(state, profileData) {
  const moderators = new Map(); // user_id -> { user_id, added_at }
  const reports = new Map(); // id -> row
  let nextId = 1;
  const isModerator = (uid) => !!uid && moderators.has(uid);
  const requireModerator = () => (isModerator(state.currentUserId()) ? state.currentUserId() : fail("not_moderator"));
  const byName = (name) => [...state.profiles.values()].find((r) => r.username === name) || null;

  const rpcs = {
    is_moderator() {
      return isModerator(state.currentUserId());
    },
    report_player({ p_username, p_reason, p_note = "" } = {}) {
      const uid = state.currentUserId() || fail("not_signed_in");
      const target = byName(p_username) || fail("no_such_player");
      if (target.id === uid) fail("self");
      if (!REPORT_REASONS.includes(p_reason)) fail("bad_reason");
      const note = String(p_note ?? "").trim();
      if ([...note].length > REPORT_NOTE_MAX) fail("note_too_long");
      const open = [...reports.values()].some((r) => r.status === "open" && r.reporter_id === uid && r.target_id === target.id && r.reason === p_reason);
      if (open) fail("duplicate");
      const id = `report-${nextId++}`;
      reports.set(id, { id, reporter_id: uid, target_id: target.id, reason: p_reason, note, status: "open", created_at: new Date().toISOString(), resolved_by: null, resolved_at: null, action: null });
      return { ok: true };
    },
    mod_queue() {
      requireModerator();
      const groups = new Map();
      for (const r of [...reports.values()].filter((x) => x.status === "open").sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
        const target = state.profiles.get(r.target_id);
        if (!target) continue;
        if (!groups.has(r.target_id)) {
          const d = profileData.tables.profile_details.get(r.target_id);
          groups.set(r.target_id, { user_id: r.target_id, username: target.username, avatar_path: d?.avatar_path ?? null, avatar_preset: d?.avatar_preset ?? null, bio: d?.bio ?? "", favorite_team: d?.favorite_team ?? null, reports: [] });
        }
        groups.get(r.target_id).reports.push({ id: r.id, reason: r.reason, note: r.note, reporter: state.profiles.get(r.reporter_id)?.username ?? null, created_at: r.created_at });
      }
      return [...groups.values()];
    },
    mod_act({ p_user_id, p_action } = {}) {
      const mod = requireModerator();
      if (!state.profiles.get(p_user_id)) fail("no_such_player");
      const d = profileData.tables.profile_details.get(p_user_id);
      let removed_path = null;
      if (p_action === "remove_picture") { removed_path = d?.avatar_path ?? null; if (d) Object.assign(d, { avatar_path: null, avatar_preset: null }); }
      else if (p_action === "clear_bio") { if (d) d.bio = ""; }
      else if (p_action !== "dismiss") fail("bad_action");
      const status = p_action === "dismiss" ? "dismissed" : "actioned";
      for (const r of reports.values()) {
        if (r.status === "open" && r.target_id === p_user_id) Object.assign(r, { status, resolved_by: mod, resolved_at: new Date().toISOString(), action: p_action });
      }
      return { ok: true, removed_path };
    },
  };

  return { tables: { moderators, reports }, rpcs, isModerator };
}
