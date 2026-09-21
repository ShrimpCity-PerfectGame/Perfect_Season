// The browser's side of 1v1: the database functions in supabase/migration-versus.sql and the match-pick Edge
// Function. Contract: VERSUS.md. The app imports these from ./storage.js.
//
// Nothing here throws: a read that fails is null, a move that fails is { ok: false, reason }. `match_state` is
// stable and goes out as GET (READ), so a dropped connection is retried - which matters more here than anywhere
// else in the game, because it is the call a client makes to catch up after losing the connection mid-draft.
//
// Nothing here decides anything either. Whose turn it is, what is on the board and what a roster is worth are
// versus-logic.mjs's to say, from the rows these functions return; a move is judged by the Edge Function.
import { getClient, READ, callReason } from "./storage-core.js";

const failed = (reason) => ({ ok: false, reason });

// A match as every screen reads it - the lobby, the draft and a reload all take this shape.
//   { id, code, hostId, guestId, hostName, guestName, format, status, turnDeadline, respins, dips, swaps,
//     result, winnerId, createdAt, picks: [...] }
function mapMatch(data) {
  if (!data || typeof data !== "object" || data.error) return null;
  return {
    id: data.id, code: data.code, hostId: data.hostId ?? null, guestId: data.guestId ?? null,
    hostName: data.hostName ?? null, guestName: data.guestName ?? null,
    format: data.format === "standard" ? "standard" : "fantasy",
    status: data.status, turnDeadline: data.turnDeadline ?? null,
    respins: Array.isArray(data.respins) ? data.respins : [],
    dips: Array.isArray(data.dips) ? data.dips : [],
    swaps: Array.isArray(data.swaps) ? data.swaps : [],
    result: data.result ?? null, winnerId: data.winnerId ?? null, createdAt: data.createdAt ?? null,
    picks: (Array.isArray(data.picks) ? data.picks : []).filter((p) => p && typeof p === "object"),
  };
}

// Opens a lobby, or gives back the one already waiting.
//   { ok: true, match } | { ok: false, reason: "guest_not_allowed" | "signed_out" | "network" }
export async function createMatch(format) {
  try {
    const { data, error, status } = await getClient().rpc("create_match", { p_format: format === "standard" ? "standard" : "fantasy" });
    if (error) return failed(callReason(error, status, {}));
    if (data?.error) return failed(data.error === "not_signed_in" ? "signed_out" : data.error);
    return { ok: true, match: mapMatch(data) };
  } catch (e) {
    return failed("network");
  }
}

// Takes someone's invite. The host opening their own link gets their lobby back rather than an error.
//   { ok: true, match } | { ok: false, reason: "not_found" | "already_full" | "own_match" | "already_started"
//                                             | "guest_not_allowed" | "signed_out" | "network" }
export async function joinMatch(code) {
  if (typeof code !== "string" || !code) return failed("not_found");
  try {
    const { data, error, status } = await getClient().rpc("join_match", { p_code: code });
    if (error) return failed(callReason(error, status, {}));
    if (data?.error) return failed(data.error === "not_signed_in" ? "signed_out" : data.error);
    return { ok: true, match: mapMatch(data) };
  } catch (e) {
    return failed("network");
  }
}

// The whole match, for a screen that has just opened or reconnected. null for a code nobody has.
export async function fetchMatch(code) {
  if (typeof code !== "string" || !code) return null;
  try {
    const { data, error } = await getClient().rpc("match_state", { p_code: code }, READ);
    if (error) return null;
    return mapMatch(data);
  } catch (e) {
    return null;
  }
}

// One move: a pick, a powerup, or the claim that the clock has run out. The Edge Function decides; this only
// carries the answer back. Every refusal has a reason from VERSUS.md 4 and 7.
//   { ok: true, ...whatever the move returned } | { ok: false, reason }
export async function playMove(move) {
  try {
    const { data, error } = await getClient().functions.invoke("match-pick", { body: move });
    if (error) {
      // supabase-js turns any non-2xx into an `error` and hands the body over separately, so a refusal the
      // function answered carefully - not your turn, already taken, none left - arrives here looking exactly
      // like the network being down. Read it, the way submitRun does; without this every rule in VERSUS.md 4
      // and 7 reaches the player as "couldn't reach the server".
      let body = null;
      try { body = await error.context?.json?.(); } catch (e2) { /* no readable body: a real failure */ }
      return failed(body?.reason || body?.error || "network");
    }
    if (data?.reason || data?.error) return failed(data.reason || data.error);
    return { ok: true, ...data };
  } catch (e) {
    return failed("network");
  }
}

// Both screens watch the match itself rather than polling it (VERSUS.md 2): every change to the match row or its
// picks arrives here, and the screen re-reads. Long-lived, like subscribeSiteActivity - call unsubscribe on
// unmount.
//
// `onChange` is deliberately not handed the payload. Postgres sends the row that changed, but a screen needs the
// whole match (the other player's roster, the boards, whose turn it is), and rebuilding that from a stream of
// row deltas is a second source of truth waiting to disagree with match_state. So a change means "read again".
// `onStatus(live)` says whether the socket is actually delivering: true on SUBSCRIBED, false on an error, a
// timeout or a close. Without it a failed subscription was completely silent - the screen fell back to its
// two-second poll and simply felt slow, with nothing anywhere saying why. The caller uses it to poll faster
// when it is on its own, so a broken socket costs responsiveness rather than correctness.
export function subscribeMatch(matchId, onChange, onStatus = () => {}) {
  const client = getClient();
  const channel = client.channel(`match-${matchId}`);
  for (const table of ["matches", "match_picks"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table, filter: table === "matches" ? `id=eq.${matchId}` : `match_id=eq.${matchId}` }, () => onChange());
  }
  channel.subscribe((status) => onStatus(status === "SUBSCRIBED"));
  return { unsubscribe: () => client.removeChannel(channel) };
}

// The 1v1 board (VERSUS.md 10), for the Leaderboard screen: [{ username, wins, losses, pct }], best first.
export async function fetchVersusTop(limit = 20) {
  try {
    const { data, error } = await getClient().rpc("versus_top", { p_limit: limit }, READ);
    if (error || !Array.isArray(data)) return [];
    return data.filter((r) => r && typeof r === "object").map((r) => ({
      username: r.username, wins: Number(r.wins) || 0, losses: Number(r.losses) || 0,
      pct: r.pct == null ? null : Number(r.pct),
    }));
  } catch (e) {
    return [];
  }
}

// gridspin.app/vs/ABC123 - the whole matchmaking system (VERSUS.md 1). Built from the site's own address, the
// same way challengeLink is, so a staging build links to staging.
export const versusPath = (code) => `/vs/${encodeURIComponent(String(code || "").toUpperCase())}`;
export function parseVersusPath(pathname) {
  const m = /^\/vs\/([A-Za-z0-9]{4,12})\/?$/.exec(String(pathname || ""));
  return m ? m[1].toUpperCase() : null;
}
