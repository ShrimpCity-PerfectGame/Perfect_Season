// The 1v1 store the shared edge harness reads: tests/mock-versus.mjs's own maps, plus the three service-role
// functions the real migration has and the mock's client-facing rpcs do not. They are the SQL's behaviour, not
// a second rulebook - each one only writes down what the caller worked out.
//
// The loader itself is tests/edge-harness.mjs, which runs the real index.ts. See its comment for why.
export { loadEdgeFunction } from "./edge-harness.mjs";
export const loadMatchPick = async () => (await import("./edge-harness.mjs")).loadEdgeFunction("match-pick");

// The store the stub reads: the mock's own maps, plus the three service-role functions the real migration has
// and the mock's client-facing rpcs do not. They are the SQL's behaviour, not a second rulebook - each one only
// writes down what the caller worked out.
export function storeFor(versus, state) {
  const matchRows = () => [...versus.tables.matches.values()];
  const pickRows = () => [...versus.tables.match_picks.values()];
  const byId = (id) => matchRows().find((m) => m.id === id) || null;
  const store = {
    users: { has: (id) => state.profiles.has(id) },
    readFails: {}, writeFails: {}, rpcFails: {}, beforeWrite: null,
    rowsOf: (table) => (table === "matches" ? matchRows() : pickRows()),
    insert() { throw new Error("1v1 writes picks through record_pick, never a bare insert"); },
    remove() { throw new Error("nothing in 1v1 deletes a row"); },
    rpcs: {
      // record_pick: under the match's lock, only if the revision has not moved.
      record_pick({ p_match, p_rev, p_pick, p_deadline }) {
        const m = byId(p_match);
        if (!m) return { error: "not_found" };
        if (m.status !== "drafting") return { error: "not_drafting" };
        if ((m.rev || 0) !== p_rev) return { error: "stale" };
        const taken = pickRows().some((p) => p.match_id === p_match
          && (p.pick_no === p_pick.pick_no
            || (p.kind === p_pick.kind && p.player_id === p_pick.player_id && p.team === p_pick.team && p.season === p_pick.season)));
        if (taken) return { error: "conflict" };
        versus.tables.match_picks.set(`${p_match}|${p_pick.pick_no}`, { match_id: p_match, ...p_pick, created_at: new Date().toISOString() });
        m.rev = (m.rev || 0) + 1;
        m.turn_deadline = p_deadline;
        return { ok: true, rev: m.rev };
      },
      abandon_match({ p_match }) {
        const m = byId(p_match);
        if (m && (m.status === "open" || m.status === "drafting")) {
          m.status = "abandoned";
          m.ended_at = new Date().toISOString();
          m.turn_deadline = null;
        }
        return { ok: true };
      },
      finish_match({ p_match, p_result, p_winner, p_loser }) {
        const m = byId(p_match);
        if (!m) return { error: "not_found" };
        if (m.status !== "drafting") return { ok: true, already_done: true };
        m.status = "done";
        m.result = p_result;
        m.winner_id = p_winner;
        m.ended_at = new Date().toISOString();
        m.turn_deadline = null;
        const w = p_winner && state.profiles.get(p_winner);
        const l = p_loser && state.profiles.get(p_loser);
        if (w && l) { w.pvp_wins = (w.pvp_wins || 0) + 1; l.pvp_losses = (l.pvp_losses || 0) + 1; }
        return { ok: true };
      },
    },
  };
  return store;
}
