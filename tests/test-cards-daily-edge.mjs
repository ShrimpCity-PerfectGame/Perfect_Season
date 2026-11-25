// The daily card, through the REAL supabase/functions/submit-run/index.ts (tests/edge-harness.mjs). Finishing
// the daily draft earns one card off that day's boards - and the rule that matters more than the card is that
// IT CAN NEVER COST A SEASON: the season is already saved and paid by the time the card is chosen, so a grant
// that fails, throws, or is switched off answers `card: null` and nothing else changes.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { loadEdgeFunction } from "./edge-harness.mjs";
import { makeCards } from "./mock-cards.mjs";
import * as GL from "../game-logic.mjs";
import { initCardData, CARDS, cardBoardKey, FINISHES } from "../card-logic.mjs";

const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
GL.initGameData(data.players, data.opponents);
initCardData(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));
const { invoke } = await loadEdgeFunction("submit-run");

const ME = "11111111-1111-4111-8111-111111111111";
const today = () => new Date().toISOString().slice(0, 10);

// A real, legal draft from a seed, the way the client plays one (the same walk tests/test-tamper-resistance.mjs uses).
function legitTrace(seed) {
  const seq = GL.seededSequence(seed);
  const roster = {}; const drafted = new Set(); const history = [];
  let seqIdx = GL.boardAt(seq, 0, roster);
  for (let n = 0; n < GL.SLOTS.length; n++) {
    const key = seq[seqIdx];
    const open = GL.SLOTS.filter((s) => !roster[s]);
    const player = GL.BOARDS[key].find((p) => !drafted.has(p.id) && open.some((s) => GL.fits(p.pos, s)));
    const slot = open.find((s) => GL.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot });
    roster[slot] = player; drafted.add(player.id);
    if (history.length < GL.SLOTS.length) seqIdx = GL.boardAt(seq, seqIdx + 1, roster);
  }
  return { history, seq };
}

function store({ on = true, mode = "1" } = {}) {
  const profiles = new Map([[ME, {
    id: ME, username: "someone", guest: false, rev: 0, created_at: "2026-11-01T00:00:00.000Z",
    runs: 4, dnf: 1, wins: 30, losses: 38, champs: 0, perfect: 0, playoffs: 1,
    best_score: 91.2, best_run: null, best_record: null, best_score_std: null, best_run_std: null,
    points_daily: 0, points_unlimited: 120, points_genius: 0, points_gm: 0,
    points_bank: 120, points_day: null, recent: [],
    daily_streak: 0, daily_last: null, daily_best_streak: 0,
  }]]);
  const cards = makeCards({ profiles, currentUserId: () => null });
  const tables = { runs: [], daily_runs: [], finished_codes: [], profile_details: [] };
  globalThis.__edge_env__ = on ? { CARDS_ENABLED: mode } : {};
  const testers = [];
  const s = {
    users: { has: (id) => profiles.has(id) },
    readFails: {}, writeFails: {}, rpcFails: {}, throwOn: {}, beforeWrite: null, rpcCalls: [],
    profiles, cards, tables, testers,
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : table === "card_testers" ? testers : tables[table] || []),
    insert(table, row) {
      // daily_runs' primary key is (date, format, user_id): one daily per format per day.
      if (table === "daily_runs" && tables.daily_runs.some((r) => r.date === row.date && (r.format || "fantasy") === (row.format || "fantasy") && r.user_id === row.user_id)) {
        return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      (tables[table] || (tables[table] = [])).push(row);
      return { row };
    },
    remove() {},
    rpcs: {
      credit_coins: (a) => ({ credited: a.p_amount, balance: 250 + a.p_amount, capped: false, duplicate: false }),
      player_stats: () => ({}),
      award_badges: () => ({ awarded: [], credited: 0, balance: 0 }),
      grant_cards: (a) => cards.grantCards(a.p_user, a.p_kind, a.p_grants),
    },
  };
  globalThis.__edge_store__ = s;
  return s;
}
const called = (s, name) => s.rpcCalls.filter((c) => (c?.name ?? c?.[0]) === name);
const daily = (format) => {
  const date = today();
  const trace = legitTrace(GL.dailySeed(date, format));
  return { date, trace, // the scoring format rides at the top level of the body, never inside mode (submit-run reads it only there)
    send: () => invoke({ mode: { kind: "daily", date }, format, history: trace.history, seq: trace.seq, gm: false }, { userId: ME }) };
};

await runTest("finishing the daily earns one card off that day's boards", async () => {
  const s = store();
  const d = daily("fantasy");
  const res = await d.send();
  assert(res.status === 200 && res.body.ok === true, "the daily saved: " + JSON.stringify(res.body).slice(0, 200));
  const card = res.body.card;
  assert(card && CARDS.has(card.id) && FINISHES.includes(card.finish), "and the answer carries a real card: " + JSON.stringify(card));
  const boards = new Set(d.trace.history.map((h) => h.key));
  assert(boards.has(cardBoardKey(CARDS.get(card.id))), `off one of the day's boards (${cardBoardKey(CARDS.get(card.id))} of ${[...boards]})`);
  // ...and not just anybody on them: one of the six players this draft took.
  const got = CARDS.get(card.id);
  assert(d.trace.history.some((h) => h.key === cardBoardKey(got) && h.season === got.season), `it is a player the draft took: ${got.name} ${got.season}`);
  const owned = s.cards.owned(ME);
  assert(owned.length === 1 && owned[0].card_id === card.id && owned[0].finish === card.finish && owned[0].count === 1, "the account now owns it");
  const g = s.cards.grants(ME);
  assert(g.length === 1 && g[0].kind === "daily" && g[0].ref === d.date, "granted under the day, and nothing else: " + JSON.stringify(g));
});

await runTest("set to testers, only the list earns a daily card - and everybody's season is saved", async () => {
  const s = store({ mode: "testers" });
  const out = await daily("fantasy").send();
  assert(out.status === 200 && out.body.ok === true && out.body.coins, "a player not on the list still has the daily saved and paid");
  assert(out.body.card === null && s.cards.owned(ME).length === 0 && called(s, "grant_cards").length === 0, "and is granted no card: " + JSON.stringify(out.body.card));
  const t = store({ mode: "testers" });
  t.testers.push({ user_id: ME });
  const inn = await daily("fantasy").send();
  assert(inn.status === 200 && inn.body.card && t.cards.owned(ME).length === 1, "a tester earns the day's card: " + JSON.stringify(inn.body.card));
  // The list failing to read costs the card and nothing else.
  const b = store({ mode: "testers" });
  b.testers.push({ user_id: ME });
  b.readFails.card_testers = true;
  const bad = await daily("fantasy").send();
  assert(bad.status === 200 && bad.body.ok === true && bad.body.card === null && b.profiles.get(ME).runs === 5, "a list that cannot be read: the season is saved, and there is no card");
});

await runTest("one card a day, whichever scoring format's daily was played", async () => {
  const s = store();
  const first = await daily("fantasy").send();
  const second = await daily("standard").send();
  assert(first.body.card && second.status === 200 && second.body.ok === true, "both dailies saved");
  assert(second.body.card === null, "the second daily of the day earns no second card: " + JSON.stringify(second.body.card));
  assert(s.cards.owned(ME).reduce((n, o) => n + o.count, 0) === 1, "and the account owns one");
  assert(second.body.coins, "but it was still paid its coins");
});

await runTest("a card that cannot be granted never costs the season", async () => {
  for (const [how, arm] of [["the grant answers with an error", (s) => { s.rpcFails.grant_cards = true; }], ["the grant throws", (s) => { s.rpcs.grant_cards = () => { throw new Error("boom"); }; }]]) {
    const s = store(); arm(s);
    const res = await daily("fantasy").send();
    assert(res.status === 200 && res.body.ok === true, `${how}: the season is still saved (${res.status} ${JSON.stringify(res.body).slice(0, 120)})`);
    assert(res.body.coins && res.body.run, `${how}: and paid, with its run`);
    assert(res.body.card === null, `${how}: and the answer says there is no card`);
    assert(s.profiles.get(ME).runs === 5, `${how}: the profile counted the season`);
  }
});

await runTest("a grant that never answers does not hold the season's answer", async () => {
  const s = store();
  s.rpcs.grant_cards = () => new Promise(() => {}); // the database took the call and never came back
  const started = Date.now();
  const res = await Promise.race([daily("fantasy").send(), new Promise((r) => setTimeout(() => r({ status: 0, body: { hung: true } }), 9000))]);
  assert(!res.body.hung, "the function answered rather than waiting for ever");
  assert(res.status === 200 && res.body.ok === true && res.body.coins && res.body.card === null, "saved and paid, with no card: " + JSON.stringify(res.body).slice(0, 140));
  assert(Date.now() - started < 6000, `and within a few seconds (${Date.now() - started} ms)`);
});

await runTest("with the server's switch off no card is chosen at all", async () => {
  const s = store({ on: false });
  const res = await daily("fantasy").send();
  assert(res.status === 200 && res.body.ok === true && res.body.card === null, "saved, no card: " + JSON.stringify(res.body.card));
  assert(called(s, "grant_cards").length === 0 && s.cards.owned(ME).length === 0, "and grant_cards was never called");
});

await runTest("only a daily earns one", async () => {
  const s = store();
  const trace = legitTrace("CARDS01");
  const res = await invoke({ mode: { kind: "free", code: "CARDS01" }, history: trace.history, seq: trace.seq, gm: false }, { userId: ME });
  assert(res.status === 200 && res.body.ok === true, "the Unlimited season saved: " + JSON.stringify(res.body).slice(0, 160));
  assert(res.body.card === null && s.cards.owned(ME).length === 0, "and earned no card");
});

console.log("test-cards-daily-edge.mjs done");
