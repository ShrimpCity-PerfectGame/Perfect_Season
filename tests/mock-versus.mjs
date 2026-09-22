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

// What supabase-js hands a caller for a non-2xx from an Edge Function: an error carrying the Response, which
// the body has to be read out of.
const httpError = (reason, status) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => ({ error: reason, reason }) } },
});

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

  // The picks as versus-logic wants them. match_picks is append-only, so this is a spelling change and nothing
  // more - a steal lives on the match, in m.steals.
  const asPicks = (m) => picksOf(m.id).map((r) => ({
    pickNo: r.pick_no, kind: r.kind, playerId: r.player_id, team: r.team, season: r.season,
    slot: r.slot, auto: r.auto,
  }));

  function matchState({ p_code } = {}) {
    const m = matches.get(String(p_code || "").toUpperCase());
    if (!m) return null;
    return {
      id: m.id, code: m.code, hostId: m.host_id, guestId: m.guest_id,
      hostName: nameOf(m.host_id), guestName: nameOf(m.guest_id),
      format: m.format, status: m.status, turnDeadline: m.turn_deadline,
      respins: m.respins, dips: m.dips, steals: m.steals,
      result: m.result, winnerId: m.winner_id, createdAt: m.created_at,
      picks: picksOf(m.id).map((p) => ({
        pickNo: p.pick_no, userId: p.user_id, boardIdx: p.board_idx, kind: p.kind,
        playerId: p.player_id, team: p.team, season: p.season, slot: p.slot, auto: p.auto,
      })),
    };
  }

  function createMatch({ p_format } = {}) {
    const uid = state.currentUserId();
    if (!uid) return { error: "not_signed_in" };
    if (!canPlay(uid)) return { error: "guest_not_allowed" };
    // One match at a time, and on either side of it: asking again gives back the one already going, so a double
    // tap doesn't leave a trail of links nobody will open - and a player who went back to Modes mid-draft is
    // returned to their match rather than parked in a new lobby while that one auto-picks for them.
    const mine = [...matches.values()]
      .filter((m) => (m.host_id === uid || m.guest_id === uid) && (m.status === "open" || m.status === "drafting"))
      .sort((a, b) => (a.status === b.status ? 0 : a.status === "drafting" ? -1 : 1));
    if (mine.length) return matchState({ p_code: mine[0].code });
    const code = newCode();
    matches.set(code, {
      id: `match-${nextId++}`, code, host_id: uid, guest_id: null,
      format: p_format === "standard" ? "standard" : "fantasy", status: "open",
      turn_deadline: null, respins: [], dips: [], steals: [],
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

  // finish_match: the result and both records, once, in one go. The SQL takes a row lock and re-checks the
  // status so a second caller counts nothing; here the status check alone is that, since nothing runs in
  // parallel. A win with no matching loss is refused on both sides - a record that never balances.
  function finishMatch(m, result, now) {
    if (m.status !== "drafting") return { ok: true, already_done: true };
    m.status = "done";
    m.result = result;
    m.winner_id = result.winner ? idOf(m, result.winner) : null;
    m.ended_at = new Date(now).toISOString();
    m.turn_deadline = null;
    if (!result.winner) return { ok: true };
    const w = state.profiles.get(m.winner_id);
    const l = state.profiles.get(idOf(m, result.winner === "host" ? "guest" : "host"));
    if (!w || !l) return { ok: true };
    w.pvp_wins = (w.pvp_wins || 0) + 1;
    l.pvp_losses = (l.pvp_losses || 0) + 1;
    return { ok: true };
  }

  // The match-pick Edge Function. `now` is a test hook, standing in for the server's clock so a test can let a
  // turn run out without waiting 45 seconds.
  async function invokeMatchPick(body, { now = Date.now() } = {}) {
    // Every refusal below comes back the way the real function's does - a non-2xx, which supabase-js reports as
    // an `error` with the body behind error.context - and with the status index.ts actually sends. These five
    // were the ones still shaped as a tidy { data }, which is exactly the shape that let every refusal reach a
    // player as "couldn't reach the server" while every test passed: no test could tell a client that reads
    // error.context from one that doesn't, on the paths most likely to fire. `conflict` is the worst of them,
    // because it is the ordinary two-players-racing case.
    const uid = state.currentUserId();
    if (!uid) return httpError("unauthorized", 401);
    const code = typeof body?.code === "string" ? body.code.toUpperCase() : "";
    if (!code) return httpError("not_found", 400);
    const m = matches.get(code);
    if (!m) return httpError("not_found", 404);
    if (m.status !== "drafting") return httpError("not_your_match", 409);
    const side = sideOf(m, uid);
    if (!side) return httpError("not_your_match", 403);

    const decided = V.decideMove({
      code, format: m.format, side, move: body, now,
      picks: asPicks(m), respins: m.respins, dips: m.dips, steals: m.steals,
      deadline: m.turn_deadline ? Date.parse(m.turn_deadline) : 0,
    });
    // A refusal comes back the way the real one does: supabase-js reports any non-2xx as an `error` and puts
    // the body behind error.context. Returning a tidy { data } here instead is what let every refusal reach a
    // player as "couldn't reach the server" while every test passed.
    if (!decided.ok) return httpError(decided.reason, decided.status || 409);

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
    if (decided.action === "steal") {
      // Appended to the match, as a dip is. Nothing rewrites a pick row: match_picks is append-only.
      m.steals = [...m.steals, { at: decided.at, by: decided.side, pickNo: decided.pickNo, slot: decided.slot }];
      restartClock();
      return changed({ data: { ok: true, slot: decided.slot } });
    }

    const o = decided.option;
    const key = `${m.id}|${decided.pickNo}`;
    if (matchPicks.has(key)) return httpError("conflict", 409); // the other client got there first
    matchPicks.set(key, {
      match_id: m.id, pick_no: decided.pickNo, user_id: idOf(m, decided.side), board_idx: decided.boardIdx,
      kind: o.kind, player_id: o.kind === "player" ? o.id : null,
      team: o.kind === "player" ? null : o.team, season: o.season,
      slot: decided.slot, auto: decided.auto, created_at: new Date(now).toISOString(),
    });

    // Asked, never counted to sixteen: a double dip and a steal both move where the end of a match is.
    const after = V.replayMatch({ code, picks: asPicks(m), respins: m.respins, dips: m.dips, steals: m.steals });
    if (!after.done) { restartClock(); return changed({ data: { ok: true } }); }

    const result = V.matchResult({ code, format: m.format, host: after.roster.host, guest: after.roster.guest });
    if (!result) return changed(httpError("failed to grade", 500));
    finishMatch(m, result, now);
    return changed({ data: { ok: true, result } });
  }

  // versus_top: wins, then fewest losses, then name - fully tiebroken, like every other board.
  function versusTop({ p_limit } = {}) {
    const limit = Math.max(1, Math.min(Number(p_limit) || 20, 100));
    return [...state.profiles.values()]
      .filter((p) => !p.guest && (p.pvp_wins || 0) + (p.pvp_losses || 0) > 0)
      .sort((a, b) => (b.pvp_wins || 0) - (a.pvp_wins || 0)
        || (a.pvp_losses || 0) - (b.pvp_losses || 0)
        || a.username.localeCompare(b.username))
      .slice(0, limit)
      .map((p) => {
        const games = (p.pvp_wins || 0) + (p.pvp_losses || 0);
        return {
          username: p.username, wins: p.pvp_wins || 0, losses: p.pvp_losses || 0,
          pct: games ? Math.round((100 * (p.pvp_wins || 0)) / games) : null,
        };
      });
  }

  return {
    tables: { matches, match_picks: matchPicks },
    rpcs: { create_match: createMatch, join_match: joinMatch, match_state: matchState, versus_top: versusTop },
    invokeMatchPick,
    // Test-only: the state of a match as versus-logic sees it, for setting one up or asserting on it.
    _replay: (code) => {
      const m = matches.get(String(code || "").toUpperCase());
      return m ? V.replayMatch({ code: m.code, picks: asPicks(m), respins: m.respins, dips: m.dips, steals: m.steals }) : null;
    },
    _matches: matches,
  };
}
