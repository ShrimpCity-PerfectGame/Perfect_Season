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

  const decided = V.decideMove({
    code, format: match.format, side, move,
    picks: await readPicks(service, match),
    respins: match.respins || [], dips: match.dips || [], steals: match.steals || [],
    deadline: match.turn_deadline ? Date.parse(match.turn_deadline) : 0,
  });
  if (!decided.ok) return json({ error: decided.reason, reason: decided.reason }, decided.status);

  // Each of these writes exactly what decideMove said to, and nothing else. The clock restarts on every one of
  // them: a powerup is a turn's worth of thinking too.
  if (decided.action === "respin") {
    const respins = [...(match.respins || []), { pickNo: decided.pickNo, kind: decided.kind, by: decided.side, key: decided.key }];
    const { error } = await service.from("matches").update({ respins, turn_deadline: nextDeadline() }).eq("id", match.id);
    return error ? json({ error: "failed to save" }, 500) : json({ ok: true, board: decided.key });
  }
  if (decided.action === "dip") {
    const dips = [...(match.dips || []), { boardIdx: decided.boardIdx, at: decided.at, by: decided.side }];
    const { error } = await service.from("matches").update({ dips, turn_deadline: nextDeadline() }).eq("id", match.id);
    return error ? json({ error: "failed to save" }, 500) : json({ ok: true });
  }
  if (decided.action === "steal") {
    // Appended to the match, exactly as a re-spin or a dip is. It used to UPDATE the victim's pick row to the
    // thief's user_id and slot - the only write in the game that rewrote who a row belonged to - which could
    // not express a steal of anything but the pick just made, because a row has nowhere to say WHEN it changed
    // hands. `at` is that when: the turn the thief spent on it.
    const steals = [...(match.steals || []), { at: decided.at, by: decided.side, pickNo: decided.pickNo, slot: decided.slot }];
    const { error } = await service.from("matches").update({ steals, turn_deadline: nextDeadline() }).eq("id", match.id);
    return error ? json({ error: "failed to save" }, 500) : json({ ok: true, slot: decided.slot });
  }

  const option = decided.option;
  const { error: writeError } = await service.from("match_picks").insert({
    match_id: match.id, pick_no: decided.pickNo, user_id: idOf(match, decided.side), board_idx: decided.boardIdx,
    kind: option.kind, player_id: option.kind === "player" ? option.id : null,
    team: option.kind === "player" ? null : option.team, season: option.season,
    slot: decided.slot, auto: decided.auto,
  });
  // A taken pick_no means the other client got there first - a client that is behind, not a failure worth a 500.
  // It re-reads the match and sees the pick it missed. Only 23505 (unique_violation) means that, though: every
  // other write failure was reported as "already picked" too, which told a player to try again over a check
  // constraint that will refuse them forever, and hid the constraint from whoever had to debug it.
  if (writeError) {
    if (writeError.code === "23505") return json({ error: "already picked", reason: "conflict" }, 409);
    console.error("match_picks insert failed", writeError);
    return json({ error: "failed to save" }, 500);
  }

  // Re-read rather than assume, and let versus-logic say whether that was the last pick: a double dip and a
  // steal both move where the end of a match is, so counting to sixteen here would be wrong.
  const after = V.replayMatch({
    code, picks: await readPicks(service, match),
    respins: match.respins || [], dips: match.dips || [], steals: match.steals || [],
  });
  if (!after.done) {
    // Checked, like every other write in this handler. Silently failing leaves the PREVIOUS player's
    // deadline in place, so the next one starts their turn with whatever was left of it - and an opponent
    // posting `claim: "clock"` can have autoPick spend that turn before their screen has even drawn.
    const { error: deadlineError } = await service.from("matches").update({ turn_deadline: nextDeadline() }).eq("id", match.id);
    if (deadlineError) return json({ error: "failed to save" }, 500);
    return json({ ok: true });
  }

  const result = V.matchResult({ code, format: match.format, host: after.roster.host, guest: after.roster.guest });
  if (!result) return json({ error: "failed to grade" }, 500);
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
