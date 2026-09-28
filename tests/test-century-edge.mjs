// The REAL supabase/functions/submit-century/index.ts, executed.
//
// century-logic.mjs is tested directly and holds every rule, so what is left for this file is what the harness
// note in tests/edge-harness.mjs calls the rest: who is asking, which write goes with which decision, what a
// failure answers, and the order it all happens in. All four have been wrong in this repo before, and none of
// them is visible in a test that reads a function's source as text.
//
// What matters most here, and is checked below: the score written is the one the FUNCTION computed. A mode whose
// board takes a number from the client is a mode with no board at all, and this one has a replayable trace, which
// is the whole argument for century_runs not being client-writable (migration-century.sql).
import { assert, runTest } from "./helpers.mjs";
import { loadEdgeFunction } from "./edge-harness.mjs";
import { readFileSync } from "node:fs";
import {
  initCenturyData, CENTURY_SLOTS, CENTURY_BOARDS, centuryPlan, centuryTeamsDealt, centuryRespinTeam,
  centuryFits, centuryCeiling, centuryDailySeed, centuryScore,
} from "../century-logic.mjs";
import { hashStr } from "../game-logic.mjs";

const pool = JSON.parse(readFileSync(new URL("../data/season-2025.json", import.meta.url), "utf8"));
initCenturyData(pool);

const { invoke } = await loadEdgeFunction("submit-century");

const ME = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const NAMELESS = "33333333-3333-4333-8333-333333333333"; // signed in with Google, no profile yet
const today = () => new Date().toISOString().slice(0, 10);

function store() {
  const profiles = new Map([
    [ME, { id: ME, username: "someone", guest: false }],
    [GUEST, { id: GUEST, username: "Guest_ab12c", guest: true }],
  ]);
  const century = [];
  return {
    users: { has: (id) => id === ME || id === GUEST || id === NAMELESS },
    readFails: {}, writeFails: {}, rpcFails: {}, throwOn: {}, beforeWrite: null, rpcCalls: [],
    profiles, century,
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : table === "century_runs" ? century : []),
    insert(table, row) {
      if (table !== "century_runs") return { row };
      // The partial unique index on (day, user_id) where day is not null. Stated here because the daily being
      // once per account is the rule, and a stub that let a second one through would test nothing.
      if (row.day != null && century.some((r) => r.day === row.day && r.user_id === row.user_id)) {
        return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      // use_account_username: the name and the guest flag come from the account, never from the row.
      const p = profiles.get(row.user_id);
      if (!p) return { error: { code: "P0001", message: "no_profile" } };
      century.push({ ...row, username: p.username, guest: p.guest, id: century.length + 1 });
      return { row };
    },
    remove() {},
    rpcs: {},
  };
}

// A legal game from a seed, played by the perfect-knowledge bot the balance numbers use.
function play(seed, respunAt = -1) {
  const dealt = centuryTeamsDealt(seed, respunAt);
  const roster = {};
  const names = new Set();
  const picks = [];
  for (let i = 0; i < dealt.length; i++) {
    let best = null, bestSlot = null;
    for (const slot of CENTURY_SLOTS) {
      if (roster[slot]) continue;
      for (const p of CENTURY_BOARDS[dealt[i]]) {
        if (!centuryFits(p.pos, slot) || names.has(p.name)) continue;
        if (!best || p.td > best.td) { best = p; bestSlot = slot; }
      }
    }
    roster[bestSlot] = best;
    names.add(best.name);
    picks.push(respunAt === i ? { slot: bestSlot, name: best.name, respun: true } : { slot: bestSlot, name: best.name });
  }
  return { picks, score: centuryScore(roster), roster };
}

const CODE = "CENTURY1";

await runTest("an Unlimited run is verified, scored by the function, and written", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const game = play(CODE);
  const res = await invoke({ variant: "unlimited", seed: CODE, picks: game.picks }, { userId: ME });
  assert(res.status === 200 && res.body?.ok, `it saves: ${res.status} ${JSON.stringify(res.body)}`);
  assert(res.body.score === game.score, `the score is the one the rules give: ${res.body.score} vs ${game.score}`);
  assert(res.body.ceiling === centuryCeiling(CODE), `the ceiling is computed: ${res.body.ceiling}`);
  assert(res.body.goal === 100, `the goal travels with the answer: ${res.body.goal}`);
  assert(res.body.roster.length === 7, `seven slots come back: ${res.body.roster.length}`);
  assert(res.body.teams.join(",") === centuryPlan(CODE).join(","),
    `the teams are recomputed from the seed: ${res.body.teams}`);
  assert(s.century.length === 1, `one row written: ${s.century.length}`);
  assert(s.century[0].day === null, "an Unlimited run carries no day");
  assert(s.century[0].score === game.score && s.century[0].seed === CODE, "the row holds the function's score");
  assert(s.century[0].username === "someone" && s.century[0].guest === false,
    "the name came from the account, not the request");
  // Unlimited is unlimited: a second run lands too.
  const again = await invoke({ variant: "unlimited", seed: "CENTURY2", picks: play("CENTURY2").picks }, { userId: ME });
  assert(again.status === 200 && s.century.length === 2, `a second Unlimited run lands: ${again.status}`);
});

await runTest("the score is the FUNCTION's, whatever the client claims", async () => {
  // The reason this mode is not client-writable. Every number a submission could lie with is sent, wrong.
  const s = store();
  globalThis.__edge_store__ = s;
  const game = play(CODE);
  const res = await invoke({
    variant: "unlimited", seed: CODE, picks: game.picks,
    score: 999, hit: true, ceiling: 999, outcome: "Century. 999 touchdowns.", roster: [], username: "admin", guest: false,
  }, { userId: ME });
  assert(res.status === 200, `it still saves: ${res.status}`);
  assert(res.body.score === game.score, `the claimed score is ignored: ${res.body.score}`);
  assert(s.century[0].score === game.score && s.century[0].ceiling === centuryCeiling(CODE),
    `and nothing claimed reached the row: ${JSON.stringify({ score: s.century[0].score, ceiling: s.century[0].ceiling })}`);
  assert(s.century[0].outcome.includes(String(game.score)), `the outcome line is derived: ${s.century[0].outcome}`);
  assert(s.century[0].username === "someone", "and the username still came from the account");
});

await runTest("the daily's seed is the function's clock, and the client's day is only checked", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const seed = centuryDailySeed(today());
  const game = play(seed);
  // The client sends no seed at all for a daily. If the function took one, this would score against CODE.
  const res = await invoke({ variant: "daily", day: today(), picks: game.picks, seed: CODE }, { userId: ME });
  assert(res.status === 200 && res.body?.ok, `it saves: ${res.status} ${JSON.stringify(res.body)}`);
  assert(res.body.seed === seed, `the seed is the daily's: ${res.body.seed}`);
  assert(res.body.day === today() && s.century[0].day === today(), `the day is recorded: ${s.century[0].day}`);
  assert(res.body.score === game.score, `and it scored against the daily's teams: ${res.body.score}`);
});

await runTest("a stale tab is told its day has passed, not recorded against a board it never saw", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const seed = centuryDailySeed(today());
  const res = await invoke({ variant: "daily", day: "2020-01-01", picks: play(seed).picks }, { userId: ME });
  assert(res.status === 400 && res.body?.reason === "wrong_day", `refused: ${res.status} ${JSON.stringify(res.body)}`);
  assert(s.century.length === 0, "and nothing was written");
});

await runTest("the daily is once per account", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const seed = centuryDailySeed(today());
  const game = play(seed);
  const first = await invoke({ variant: "daily", day: today(), picks: game.picks }, { userId: ME });
  assert(first.status === 200, `the first goes in: ${first.status}`);
  const second = await invoke({ variant: "daily", day: today(), picks: play(seed, 2).picks }, { userId: ME });
  assert(second.status === 409 && second.body?.reason === "duplicate",
    `the second is refused as a duplicate: ${second.status} ${JSON.stringify(second.body)}`);
  assert(s.century.length === 1, `and only one row exists: ${s.century.length}`);
});

await runTest("a guest plays Unlimited and is refused the daily", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const seed = centuryDailySeed(today());
  const no = await invoke({ variant: "daily", day: today(), picks: play(seed).picks }, { userId: GUEST });
  assert(no.status === 403 && no.body?.reason === "guest_daily", `the daily is refused: ${no.status} ${JSON.stringify(no.body)}`);
  assert(s.century.length === 0, "and nothing was written");
  const yes = await invoke({ variant: "unlimited", seed: CODE, picks: play(CODE).picks }, { userId: GUEST });
  assert(yes.status === 200, `Unlimited is allowed: ${yes.status} ${JSON.stringify(yes.body)}`);
  assert(s.century[0].guest === true, "and the row carries the guest flag from the account");
});

await runTest("an account with no profile yet is told so, not handed a trigger's exception", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const res = await invoke({ variant: "unlimited", seed: CODE, picks: play(CODE).picks }, { userId: NAMELESS });
  assert(res.status === 400 && /no profile/.test(res.body?.error || ""), `a sentence: ${res.status} ${JSON.stringify(res.body)}`);
  assert(s.century.length === 0, "and nothing was written");
});

await runTest("who is asking", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const game = play(CODE);
  const anon = await invoke({ variant: "unlimited", seed: CODE, picks: game.picks });
  assert(anon.status === 401, `no token is unauthorized: ${anon.status}`);
  const bogus = await invoke({ variant: "unlimited", seed: CODE, picks: game.picks }, { userId: "not-a-user" });
  assert(bogus.status === 401, `an unknown token is unauthorized: ${bogus.status}`);
  const get = await invoke(null, { userId: ME, method: "GET" });
  assert(get.status === 405, `GET is not allowed: ${get.status}`);
  const pre = await invoke(null, { userId: ME, method: "OPTIONS" });
  assert(pre.status === 200 && pre.headers.get("Access-Control-Allow-Origin"),
    `the preflight answers with CORS: ${pre.status}`);
  assert(s.century.length === 0, "and none of them wrote anything");
});

await runTest("an illegal run is refused with the rule it broke", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const game = play(CODE);
  const cases = [
    [{ variant: "unlimited", seed: CODE, picks: game.picks.slice(0, 6) }, "wrong_length", "six picks"],
    [{ variant: "unlimited", seed: CODE, picks: game.picks.map((p) => ({ ...p, name: "Nobody At All" })) }, "not_on_board", "invented players"],
    [{ variant: "unlimited", seed: CODE, picks: game.picks.map((p) => ({ ...p, respun: true })) }, "two_respins", "seven re-spins"],
    [{ variant: "unlimited", seed: CODE, picks: game.picks.map((p) => ({ ...p, slot: "QB" })) }, "slot_taken", "everyone at quarterback"],
  ];
  for (const [body, reason, what] of cases) {
    const res = await invoke(body, { userId: ME });
    assert(res.status === 400 && res.body?.reason === reason,
      `${what} -> ${reason} (got ${res.status} ${JSON.stringify(res.body)})`);
  }
  assert(s.century.length === 0, "and not one of them was written");
  const nothing = await invoke({ variant: "unlimited", seed: CODE }, { userId: ME });
  assert(nothing.status === 400, `no picks at all is refused: ${nothing.status}`);
});

await runTest("an Unlimited seed has to be a code somebody could be challenged with", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  for (const seed of ["", "ab", "lower-case", "WAY-TOO-LONG-TO-BE-A-CODE-AT-ALL", null, 7, { a: 1 }]) {
    const res = await invoke({ variant: "unlimited", seed, picks: play(CODE).picks }, { userId: ME });
    assert(res.status === 400 && res.body?.reason === "bad_code",
      `${JSON.stringify(seed)} is refused: ${res.status} ${JSON.stringify(res.body)}`);
  }
  assert(s.century.length === 0, "and nothing was written");
});

// A code the code box would accept that hashes to the same value as `target`. hashStr is FNV-1a/32, so it is
// invertible: hash every four-character prefix forward, walk every four-character suffix BACKWARD from the
// target, and the two meet. 1.7 million each way, about a second - which is the point. Passing the daily's own
// seed in proves nothing, because it is refused for its lower-case letters before the reserved check is reached;
// a real attempt looks exactly like an ordinary challenge code, and this is how one is made.
function collidingCode(target) {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
  const PRIME = 16777619;
  // PRIME is odd, so it is invertible mod 2^32; Newton's iteration gets there in 32 doublings.
  let ip = 1;
  for (let i = 0; i < 32; i++) ip = Math.imul(ip, (2 - Math.imul(PRIME, ip)) >>> 0) >>> 0;
  const fwd = (h, c) => Math.imul((h ^ c) >>> 0, PRIME) >>> 0;
  const back = (h, c) => (Math.imul(h, ip) >>> 0 ^ c) >>> 0;
  const seen = new Map();
  for (const a of ALPHA) { const ha = fwd(2166136261, a.charCodeAt(0));
    for (const b of ALPHA) { const hb = fwd(ha, b.charCodeAt(0));
      for (const c of ALPHA) { const hc = fwd(hb, c.charCodeAt(0));
        for (const d of ALPHA) { const hd = fwd(hc, d.charCodeAt(0));
          if (!seen.has(hd)) seen.set(hd, a + b + c + d); } } } }
  for (const a of ALPHA) { const ha = back(target, a.charCodeAt(0));
    for (const b of ALPHA) { const hb = back(ha, b.charCodeAt(0));
      for (const c of ALPHA) { const hc = back(hb, c.charCodeAt(0));
        for (const d of ALPHA) { const hd = back(hc, d.charCodeAt(0));
          const pre = seen.get(hd);
          if (pre) return pre + d + c + b + a; } } } }
  return null;
}

await runTest("a code that hashes to a daily's seed is refused", async () => {
  // The prize is the seven TEAMS, not the row: a code that hashes to a daily's seed deals that daily's seven
  // teams bit for bit, so the check has to be on the hash and not the spelling.
  const s = store();
  globalThis.__edge_store__ = s;
  const seed = centuryDailySeed(today());
  // The naive attempt, refused for its shape before anything else looks at it.
  const plain = await invoke({ variant: "unlimited", seed, picks: play(seed).picks }, { userId: ME });
  assert(plain.status === 400 && plain.body?.reason === "bad_code",
    `the daily seed itself is not a code: ${plain.status} ${JSON.stringify(plain.body)}`);
  // The real one: an ordinary-looking eight-character code that deals the daily's board.
  const code = collidingCode(hashStr(seed));
  assert(code && /^[A-Z0-9]{8}$/.test(code) && hashStr(code) === hashStr(seed),
    `a colliding code was found: ${code}`);
  assert(centuryPlan(code).join(",") === centuryPlan(seed).join(","),
    `and it really does deal the daily's teams: ${centuryPlan(code)}`);
  const res = await invoke({ variant: "unlimited", seed: code, picks: play(code).picks }, { userId: ME });
  assert(res.status === 400 && res.body?.reason === "reserved_code",
    `${code} is refused as reserved: ${res.status} ${JSON.stringify(res.body)}`);
  assert(s.century.length === 0, "and nothing was written");
});

await runTest("a run with a re-spin is replayed against the team the re-spin dealt", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const game = play(CODE, 3);
  const res = await invoke({ variant: "unlimited", seed: CODE, picks: game.picks }, { userId: ME });
  assert(res.status === 200 && res.body?.ok, `it saves: ${res.status} ${JSON.stringify(res.body)}`);
  assert(res.body.respunAt === 3, `the re-spin is found: ${res.body.respunAt}`);
  assert(res.body.teams[3] === centuryRespinTeam(CODE, 3, centuryPlan(CODE)),
    `and step 3 replayed as the spare: ${res.body.teams[3]}`);
  assert(res.body.ceiling === centuryCeiling(CODE, 3),
    `the ceiling is for the teams actually dealt: ${res.body.ceiling} vs ${centuryCeiling(CODE, 3)}`);
  assert(res.body.ceiling !== centuryCeiling(CODE) || centuryCeiling(CODE, 3) === centuryCeiling(CODE),
    "and not for the plan it would have been without the re-spin");
});

await runTest("a failed read or write says the save failed and writes nothing", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  s.readFails.profiles = true;
  const read = await invoke({ variant: "unlimited", seed: CODE, picks: play(CODE).picks }, { userId: ME });
  assert(read.status === 500 && /failed to save/.test(read.body?.error || ""), `a failed profile read: ${read.status}`);
  s.readFails.profiles = false;
  s.writeFails.century_runs = true;
  const write = await invoke({ variant: "unlimited", seed: CODE, picks: play(CODE).picks }, { userId: ME });
  assert(write.status === 500, `a failed insert: ${write.status} ${JSON.stringify(write.body)}`);
  assert(s.century.length === 0, "and nothing landed");
  // And a thrown error still answers with CORS, or the browser reads it as the network being down.
  s.writeFails.century_runs = false;
  s.throwOn.profiles = true;
  const threw = await invoke({ variant: "unlimited", seed: CODE, picks: play(CODE).picks }, { userId: ME });
  assert(threw.status === 500 && threw.headers.get("Access-Control-Allow-Origin"),
    `a thrown error keeps its CORS headers: ${threw.status}`);
});

console.log("test-century-edge.mjs done");
