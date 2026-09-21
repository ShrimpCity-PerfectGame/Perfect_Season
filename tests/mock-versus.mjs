// The test mock's side of 1v1 (VERSUS.md): supabase/migration-versus.sql's matches, match_picks and their three
// functions, plus the match-pick Edge Function.
//
// The function half is a thin mirror on purpose, and it is worth saying why it can be: every rule a move is
// judged by lives in versus-logic.mjs's `decideMove`, which the real index.ts calls too. So this file and the
// server both do the same two things - say who is asking, and write down what decideMove returned - and there is
// no second copy of the rules to drift. What is mirrored here is only the writing down.
//
// A database function refusing something returns { error: "<code>" }, as the SQL does - matches' functions
// answer with a JSON error rather than raising, so a client can tell "you may not" from "it broke".
import * as V from "../versus-logic.mjs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// state: tests/mock-supabase.mjs's shared state ({ profiles, currentUserId, ... })
// onMatchChange(matchId): what Realtime does for free in production - tell both screens to read again.
export function makeVersus(state, { onMatchChange = () => {} } = {}) {
  const matches = new Map(); // code -> row (snake_case, as the real table)
  const matchPicks = new Map(); // "matchId|pickNo" -> row
  let nextId = 1;

  // Six characters, no 0/O or 1/I, like new_match_code(). Counted rather than random: a test that has to name
  // a match wants the same code twice, and nothing about the game depends on it being unguessable.
  const newCode = () => {
    let n = nextId, code = "";
    for (let i = 0; i < 6; i++) { code = CODE_ALPHABET[n % CODE_ALPHABET.length] + code; n = Math.floor(n / CODE_ALPHABET.length); }
    return code;
  };
  const picksOf = (matchId) => [...matchPicks.values()].filter((p) => p.match_id === matchId).sort((a, b) => a.pick_no - b.pick_no);
  const sideOf = (m, userId) => (m.host_id === userId ? "host" : m.guest_id === userId ? "guest" : null);
  const idOf = (m, side) => (side === "host" ? m.host_id : m.guest_id);
  const nameOf = (id) => (id ? state.profiles.get(id)?.username ?? null : null);

  // can_play_versus: signed in, has a profile, and isn't a guest (VERSUS.md 5).
  const canPlay = (userId) => {
    const p = userId && state.profiles.get(userId);
    return !!p && !p.guest;
  };

  // The picks as versus-logic wants them. `stolen_by` is stored as a user id, as in the table, so which side
  // that is has to be resolved against this match - exactly as index.ts does it.
  const asPicks = (m) => picksOf(m.id).map((r) => ({
    pickNo: r.pick_no, kind: r.kind, playerId: r.player_id, team: r.team, season: r.season,
    slot: r.slot, auto: r.auto, stolenBy: r.stolen_by ? sideOf(m, r.stolen_by) : null,
  }));

  function matchState({ p_code } = {}) {
    const m = matches.get(String(p_code || "").toUpperCase());
    if (!m) return null;
    return {
      id: m.id, code: m.code, hostId: m.host_id, guestId: m.guest_id,
      hostName: nameOf(m.host_id), guestName: nameOf(m.guest_id),
      format: m.format, status: m.status, turnDeadline: m.turn_deadline,
      respins: m.respins, dips: m.dips, swaps: m.swaps,
      result: m.result, winnerId: m.winner_id, createdAt: m.created_at,
      picks: picksOf(m.id).map((p) => ({
        pickNo: p.pick_no, userId: p.user_id, boardIdx: p.board_idx, kind: p.kind,
        playerId: p.player_id, team: p.team, season: p.season, slot: p.slot, auto: p.auto,
        // As a side, not an id - this is what a client replays the match from, and replayMatch thinks in
        // host/guest. Mirrors the same case expression in match_state's SQL.
        stolenBy: sideOf(m, p.stolen_by),
      })),
    };
  }

  function createMatch({ p_format } = {}) {
    const uid = state.currentUserId();
    if (!uid) return { error: "not_signed_in" };
    if (!canPlay(uid)) return { error: "guest_not_allowed" };
    // One open lobby per host: asking twice gives back the one already waiting, so a double tap doesn't leave a
    // trail of links nobody will open.
    const open = [...matches.values()].find((m) => m.host_id === uid && m.status === "open");
    if (open) return matchState({ p_code: open.code });
    const code = newCode();
    matches.set(code, {
      id: `match-${nextId++}`, code, host_id: uid, guest_id: null,
      format: p_format === "standard" ? "standard" : "fantasy", status: "open",
      turn_deadline: null, respins: [], dips: [], swaps: [],
      result: null, winner_id: null, created_at: new Date().toISOString(), ended_at: null,
    });
    return matchState({ p_code: code });
  }

  function joinMatch({ p_code } = {}) {
    const uid = state.currentUserId();
    if (!uid) return { error: "not_signed_in" };
    if (!canPlay(uid)) return { error: "guest_not_allowed" };
    const m = matches.get(String(p_code || "").toUpperCase());
    if (!m) return { error: "not_found" };
    // The host opening their own link is not an error; they get their lobby back.
    if (m.host_id === uid) return m.status === "open" ? matchState({ p_code: m.code }) : { error: "own_match" };
    if (m.guest_id) return m.guest_id === uid ? matchState({ p_code: m.code }) : { error: "already_full" };
    if (m.status !== "open") return { error: "already_started" };
    m.guest_id = uid;
    m.status = "drafting";
    m.turn_deadline = new Date(Date.now() + V.TURN_SECONDS * 1000).toISOString();
    onMatchChange(m.id); // how the host's lobby learns somebody arrived
    return matchState({ p_code: m.code });
  }

  // record_versus: the two columns move together or not at all.
  function recordVersus(winnerId, loserId) {
    const w = state.profiles.get(winnerId), l = state.profiles.get(loserId);
    if (!w || !l) return;
    w.pvp_wins = (w.pvp_wins || 0) + 1;
    l.pvp_losses = (l.pvp_losses || 0) + 1;
  }

  // The match-pick Edge Function. `now` is a test hook, standing in for the server's clock so a test can let a
  // turn run out without waiting 45 seconds.
  async function invokeMatchPick(body, { now = Date.now() } = {}) {
    const uid = state.currentUserId();
    if (!uid) return { error: { message: "unauthorized" } };
    const code = typeof body?.code === "string" ? body.code.toUpperCase() : "";
    const m = matches.get(code);
    if (!m) return { data: { error: "not_found", reason: "not_found" } };
    if (m.status !== "drafting") return { data: { error: "not_your_match", reason: "not_your_match" } };
    const side = sideOf(m, uid);
    if (!side) return { data: { error: "not_your_match", reason: "not_your_match" } };

    const decided = V.decideMove({
      code, format: m.format, side, move: body, now,
      picks: asPicks(m), respins: m.respins, dips: m.dips, swaps: m.swaps,
      deadline: m.turn_deadline ? Date.parse(m.turn_deadline) : 0,
    });
    if (!decided.ok) return { data: { error: decided.reason, reason: decided.reason } };

    const restartClock = () => { m.turn_deadline = new Date(now + V.TURN_SECONDS * 1000).toISOString(); };
    const changed = (payload) => { onMatchChange(m.id); return payload; };
    if (decided.action === "respin") {
      m.respins = [...m.respins, { pickNo: decided.pickNo, kind: decided.kind, by: side, key: decided.key }];
      restartClock();
      return changed({ data: { ok: true, board: decided.key } });
    }
    if (decided.action === "dip") {
      m.dips = [...m.dips, { boardIdx: decided.boardIdx, by: side }];
      restartClock();
      return changed({ data: { ok: true } });
    }
    if (decided.action === "swap") {
      m.swaps = [...m.swaps, { boardIdx: decided.boardIdx, by: side }];
      restartClock();
      return changed({ data: { ok: true } });
    }
    if (decided.action === "steal") {
      // The row changes hands rather than a second one being written - what keeps "drafted exactly once" true.
      const row = matchPicks.get(`${m.id}|${decided.pickNo}`);
      row.user_id = uid;
      row.slot = decided.slot;
      row.stolen_by = uid;
      restartClock();
      return changed({ data: { ok: true, slot: decided.slot } });
    }

    const o = decided.option;
    const key = `${m.id}|${decided.pickNo}`;
    if (matchPicks.has(key)) return { data: { error: "conflict", reason: "conflict" } };
    matchPicks.set(key, {
      match_id: m.id, pick_no: decided.pickNo, user_id: idOf(m, decided.side), board_idx: decided.boardIdx,
      kind: o.kind, player_id: o.kind === "player" ? o.id : null,
      team: o.kind === "player" ? null : o.team, season: o.season,
      slot: decided.slot, auto: decided.auto, stolen_by: null, created_at: new Date(now).toISOString(),
    });

    // Asked, never counted to sixteen: a double dip and a steal both move where the end of a match is.
    const after = V.replayMatch({ code, picks: asPicks(m), respins: m.respins, dips: m.dips, swaps: m.swaps });
    if (!after.done) { restartClock(); return changed({ data: { ok: true } }); }

    const result = V.matchResult({ code, format: m.format, host: after.roster.host, guest: after.roster.guest });
    m.status = "done";
    m.result = result;
    m.winner_id = result.winner ? idOf(m, result.winner) : null;
    m.ended_at = new Date(now).toISOString();
    m.turn_deadline = null;
    if (result.winner) recordVersus(m.winner_id, idOf(m, result.winner === "host" ? "guest" : "host"));
    return changed({ data: { ok: true, result } });
  }

  return {
    tables: { matches, match_picks: matchPicks },
    rpcs: { create_match: createMatch, join_match: joinMatch, match_state: matchState },
    invokeMatchPick,
    // Test-only: the state of a match as versus-logic sees it, for setting one up or asserting on it.
    _replay: (code) => {
      const m = matches.get(String(code || "").toUpperCase());
      return m ? V.replayMatch({ code: m.code, picks: asPicks(m), respins: m.respins, dips: m.dips, swaps: m.swaps }) : null;
    },
    _matches: matches,
  };
}
