// Every move in a 1v1 match. Contract: VERSUS.md 4 and 7.
//
// Unlike submit-run, which checks a finished draft afterwards, this function IS the draft: a 1v1 board is picked
// from twice and the second player's legal choices depend on the first player's pick, so no browser can hold the
// truth (VERSUS.md 2). The picks live in the database and only this function's service role writes them -
// matches and match_picks have public select and no client write policy at all.
//
// **This file decides nothing.** It says who is asking, hands the match's rows to versus-logic.mjs's decideMove,
// and writes down whatever comes back. Every rule lives there, in the same module the browser draws the board
// with, for the reason game-logic.mjs exists: a rule enforced on one side and not the other is a rule that will
// drift, and this one would drift into "the pick I made didn't happen". It also means the rules are tested
// without a Deno runtime or a mock that mirrors them - tests/test-versus-rules.mjs drives the real thing.
//
//   POST { code, boardIdx, kind, playerId | team, season, slot }   make a pick
//   POST { code, claim: "clock" }                                  the clock ran out; checked against the row
//   POST { code, respin: "team" | "era" }                          a re-spin (VERSUS.md 7)
//   POST { code, steal: true, pickNo, slot }                      take any one player off their roster
//   POST { code, dip: true }                                       take two off this board, give up the next
import { createClient } from "npm:@supabase/supabase-js@2";
import * as GL from "../../../game-logic.mjs";
import * as V from "../../../versus-logic.mjs";
import gameData from "../../../data/players.json" with { type: "json" };
import versusPool from "../../../data/versus-pool.json" with { type: "json" };

GL.initGameData(gameData.players, gameData.opponents);
V.initVersusData(versusPool);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same reasoning as submit-run's: the browser calls this cross-origin, so every response - the preflight
// included - carries these or the fetch is blocked before this code runs.
function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const sideOf = (match: any, userId: string) =>
  (match.host_id === userId ? "host" : match.guest_id === userId ? "guest" : null);
const idOf = (match: any, side: string) => (side === "host" ? match.host_id : match.guest_id);
const nextDeadline = () => new Date(Date.now() + V.TURN_SECONDS * 1000).toISOString();

// The picks as versus-logic wants them, in pick order - snake_case to camelCase and nothing else. match_picks
// is append-only, so a row means exactly what it said when it was written; a steal is a record on the match.
const rowsToPicks = (_match: any, rows: any[]) => (rows || []).map((r: any) => ({
  pickNo: r.pick_no, kind: r.kind, playerId: r.player_id, team: r.team,
  season: r.season, slot: r.slot, auto: r.auto,
}));

// Throws rather than returning [] on a failed read, and the handler answers 500. A dropped select used to
// present an empty match to decideMove, which says "board 0, pick 1" - harmless for a pick, where the primary
// key refuses it, but a RE-SPIN would be appended for pick 1 and retroactively replace board 0, orphaning every
// pick already made on it. One bad minute on the database, and the match is unrecoverable.
const readPicks = async (service: any, match: any) => {
  const { data, error } = await service.from("match_picks").select("*").eq("match_id", match.id).order("pick_no");
  if (error) throw new Error(`could not read the picks: ${error.message}`);
  return rowsToPicks(match, data ?? []);
};

// Everything below runs inside handle(), so an unexpected throw still answers with the CORS headers. Without
// that wrapper readPicks' deliberate throw came back headerless, which a browser reports as a network failure -
// so the screen said "That didn't work." instead of the refusal, undoing the hardening it was written for.
Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    return await handle(req, json);
  } catch (e) {
    console.error("match-pick:", e);
    return json({ error: "failed to save" }, 500);
  }
});

async function handle(req: Request, json: (body: unknown, status?: number) => Response) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);

  let move: any;
  try { move = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  // `slot` reaches fits() -> slot.startsWith(), so anything that isn't a string threw a TypeError. Every
  // other field is already coerced safely (boardIdx strict-compares, the numbers go through Number() and
  // refuse as NaN), and the steal branch whitelists its own slot - this is the pick branch catching up.
  if ("slot" in move && typeof move.slot !== "string") return json({ error: "bad move", reason: "not_your_turn" }, 400);
  const code = typeof move?.code === "string" ? move.code.toUpperCase() : "";
  if (!code) return json({ error: "no match", reason: "not_found" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // The error is read, not discarded - the same distinction readPicks above is careful about. Told
  // `not_found`, versus.jsx puts "That match doesn't exist." over a live board while the turn clock keeps
  // running; the match is fine, only the read failed. PGRST116 is the one error that means "no such row".
  const { data: match, error: matchError } = await service.from("matches").select("*").eq("code", code).maybeSingle();
  if (matchError) return json({ error: "could not read the match" }, 500);
  if (!match) return json({ error: "no match", reason: "not_found" }, 404);
  if (match.status !== "drafting") return json({ error: "not playing", reason: "not_your_match" }, 409);
  const side = sideOf(match, user.id);
  if (!side) return json({ error: "not your match", reason: "not_your_match" }, 403);

  const picks = await readPicks(service, match);
  const powerups = { respins: match.respins || [], dips: match.dips || [], steals: match.steals || [] };

  // Every sixteen picks are in but the row still says `drafting`: the grade, or the write that records it,
  // did not go through last time. Finishing is therefore the FIRST thing this handler tries, on any request,
  // from either player - which is what makes it retryable. It used to be reachable only as the tail of the
  // sixteenth pick, so one failure there left the match `drafting` with nothing able to post again
  // (decideMove refuses a match it replays as finished): both screens sat on "Working out the result...", and
  // create_match handed both players back into the dead match for every duel they tried afterwards.
  // Recovery was the runbook, by hand, per match.
  const replayed = V.replayMatch({ code, ...powerups, picks });
  if (replayed.done) return await finish(service, match, replayed, json);

  const decided = V.decideMove({
    code, format: match.format, side, move, picks, ...powerups,
    deadline: match.turn_deadline ? Date.parse(match.turn_deadline) : 0,
  });
  if (!decided.ok) return json({ error: decided.reason, reason: decided.reason }, decided.status);

  // Each of these writes exactly what decideMove said to, and nothing else. The clock restarts on every one of
  // them: a powerup is a turn's worth of thinking too.
  // Every one of these is conditional on the revision this request read, and bumps it - see `rev` in
  // migration-versus.sql. Two requests for one match are ordinary, not exotic: the player on the clock can move
  // at the moment their opponent claims the expired clock. Unguarded, the loser of that race wrote its decision
  // anyway, against a board the winner had already changed underneath it.
  const bump = async (fields: Record<string, unknown>) => {
    const { data, error } = await service.from("matches")
      .update({ ...fields, rev: (match.rev ?? 0) + 1, turn_deadline: nextDeadline() })
      .eq("id", match.id).eq("rev", match.rev ?? 0).select("id");
    if (error) return json({ error: "failed to save" }, 500);
    // No row means somebody else moved the match between this request's read and its write. Not a failure: the
    // client re-reads and plays the turn again against what is actually there, exactly as it does for a pick
    // the other client got to first.
    if (!data || !data.length) return json({ error: "already picked", reason: "conflict" }, 409);
    return null;
  };

  if (decided.action === "respin") {
    const respins = [...(match.respins || []), { pickNo: decided.pickNo, kind: decided.kind, by: decided.side, key: decided.key }];
    return (await bump({ respins })) || json({ ok: true, board: decided.key });
  }
  if (decided.action === "dip") {
    const dips = [...(match.dips || []), { boardIdx: decided.boardIdx, at: decided.at, by: decided.side }];
    return (await bump({ dips })) || json({ ok: true });
  }
  if (decided.action === "steal") {
    // Appended to the match, exactly as a re-spin or a dip is. It used to UPDATE the victim's pick row to the
    // thief's user_id and slot - the only write in the game that rewrote who a row belonged to - which could
    // not express a steal of anything but the pick just made, because a row has nowhere to say WHEN it changed
    // hands. `at` is that when: the turn the thief spent on it.
    const steals = [...(match.steals || []), { at: decided.at, by: decided.side, pickNo: decided.pickNo, slot: decided.slot }];
    return (await bump({ steals })) || json({ ok: true, slot: decided.slot });
  }

  // The pick and the clock move together, under the match's own lock, and only if the revision has not moved -
  // see record_pick in migration-versus.sql. A plain insert here could not be conditional on anything: the
  // decision above is made in JavaScript, outside any transaction, so there was a window in which a powerup
  // could land between this request's read of the match and its write. The row then named a player who was no
  // longer on the board, replayMatch dropped it, and the match became ungradeable.
  const option = decided.option;
  const { data: written, error: writeError } = await service.rpc("record_pick", {
    p_match: match.id,
    p_rev: match.rev ?? 0,
    p_pick: {
      pick_no: decided.pickNo, user_id: idOf(match, decided.side), board_idx: decided.boardIdx,
      kind: option.kind, player_id: option.kind === "player" ? option.id : null,
      team: option.kind === "player" ? null : option.team, season: option.season,
      slot: decided.slot, auto: decided.auto,
    },
    p_deadline: new Date(nextDeadline()).toISOString(),
  });
  if (writeError) {
    console.error("record_pick failed", writeError);
    return json({ error: "failed to save" }, 500);
  }
  // `conflict` is the other client having got there first, and `stale` is a powerup having landed under this
  // request - a client that is behind, either way, not a failure worth a 500. It re-reads and plays the turn
  // again against what is actually there.
  if (written?.error === "conflict" || written?.error === "stale") return json({ error: "already picked", reason: "conflict" }, 409);
  if (written?.error) {
    console.error("record_pick refused", written.error);
    return json({ error: "failed to save" }, 500);
  }

  // Re-read rather than assume, and let versus-logic say whether that was the last pick: a double dip and a
  // steal both move where the end of a match is, so counting to sixteen here would be wrong. record_pick has
  // already set the next deadline, so an unfinished match needs no further write.
  const after = V.replayMatch({ code, picks: await readPicks(service, match), ...powerups });
  if (!after.done) return json({ ok: true });
  return await finish(service, match, after, json);
}

// Grades a match whose picks are all in, and records it. Split out because it is reached from two places now:
// the tail of the last pick, and the top of the handler for any later request - which is what makes a failure
// here recoverable instead of permanent. `json` is handed in rather than closed over: it belongs to the
// request, and this function sits outside the one that has it.
async function finish(service: any, match: any, state: any, json: (body: unknown, status?: number) => Response) {
  // A pick that was written but is not on the board the replay deals cannot be graded around: the roster has a
  // hole in it, matchResult answers null, and no later move can fill it. Retrying forever would leave both
  // players on "Working out the result..." and create_match handing them back into it, which is the brick this
  // whole path exists to avoid - so the match ends instead, with no result and nothing recorded for either
  // player. The screen for that already exists. It should now be unreachable (matches.rev closed the race that
  // produced it), so it is logged loudly rather than quietly handled.
  if (state.missing?.length) {
    console.error("match cannot be replayed - abandoning", match.code, JSON.stringify(state.missing));
    await service.rpc("abandon_match", { p_match: match.id });
    return json({ error: "unplayable", reason: "unplayable" }, 409);
  }
  const result = V.matchResult({ code: match.code, format: match.format, host: state.roster.host, guest: state.roster.guest });
  if (!result) {
    console.error("failed to grade", match.code);
    return json({ error: "failed to grade", reason: "grading" }, 500);
  }
  const winnerId = result.winner ? idOf(match, result.winner) : null;
  // The result and both records land together, or neither does - one locked transaction in the database rather
  // than two writes here that nothing checked. See finish_match in migration-versus.sql for what each of the
  // old failure modes cost. A failure leaves the match untouched and finishable; a second caller is told the
  // first one already did it, which is what happens when both screens notice the sixteenth pick at once.
  const { data: done, error: finishError } = await service.rpc("finish_match", {
    p_match: match.id,
    p_result: result,
    p_winner: winnerId,
    p_loser: result.winner ? idOf(match, result.winner === "host" ? "guest" : "host") : null,
  });
  if (finishError || done?.error) return json({ error: "failed to save" }, 500);
  return json({ ok: true, result });
}
