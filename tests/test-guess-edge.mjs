// The REAL supabase/functions/submit-guess/index.ts, executed.
//
// guess-logic.mjs is tested directly, so what is left here is what tests/edge-harness.mjs calls the rest: who is
// asking, which write goes with which decision, what a failure answers, and the order it happens in.
//
// The one that matters most: the ANSWER is recomputed from the date and never taken from the request, and it is
// only sent back once the row is written - so there is no way to ask what the player is and then keep playing.
import { assert, runTest } from "./helpers.mjs";
import { loadEdgeFunction } from "./edge-harness.mjs";
import { readFileSync } from "node:fs";
import {
  initGuessData, GUESS_PLAYERS, GUESS_TRIES, guessAnswerFor, guessAnswerForSeed,
} from "../guess-logic.mjs";

initGuessData(JSON.parse(readFileSync(new URL("../data/guess-pool.json", import.meta.url), "utf8")));

const { invoke } = await loadEdgeFunction("submit-guess");

const ME = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const NAMELESS = "33333333-3333-4333-8333-333333333333";
const today = () => new Date().toISOString().slice(0, 10);

function store() {
  const profiles = new Map([
    [ME, { id: ME, username: "someone", guest: false }],
    [GUEST, { id: GUEST, username: "Guest_ab12c", guest: true }],
  ]);
  const guesses = [];
  const s = {
    users: { has: (id) => id === ME || id === GUEST || id === NAMELESS },
    readFails: {}, writeFails: {}, rpcFails: {}, throwOn: {}, beforeWrite: null, rpcCalls: [],
    profiles, guesses,
    rowsOf: (t) => (t === "profiles" ? [...profiles.values()] : t === "guess_runs" ? guesses : []),
    insert(t, row) {
      if (t !== "guess_runs") return { row };
      if (row.day != null && guesses.some((r) => r.day === row.day && r.user_id === row.user_id)) {
        return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      const p = profiles.get(row.user_id);
      if (!p) return { error: { code: "P0001", message: "no_profile" } };
      guesses.push({ ...row, username: p.username, guest: p.guest, id: guesses.length + 1 });
      return { row };
    },
    remove() {},
    rpcs: {},
  };
  return s;
}

// A losing game: the first eight players who are not the answer.
const missesFor = (answer) => GUESS_PLAYERS.filter((p) => p.id !== answer.id).slice(0, GUESS_TRIES).map((p) => p.id);

await runTest("a solved daily is verified, counted and written", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const answer = guessAnswerFor(today());
  const wrong = GUESS_PLAYERS.find((p) => p.id !== answer.id);
  const res = await invoke({ variant: "daily", day: today(), guesses: [wrong.id, answer.id] }, { userId: ME });
  assert(res.status === 200 && res.body?.ok, `it saves: ${res.status} ${JSON.stringify(res.body)}`);
  assert(res.body.solved === true, "it knows the game was solved");
  assert(res.body.tries === 2, `in two: ${res.body.tries}`);
  assert(res.body.answer?.id === answer.id, `and says who it was: ${res.body.answer?.name}`);
  assert(res.body.rows.length === 2, `with a row per guess: ${res.body.rows.length}`);
  assert(s.guesses.length === 1 && s.guesses[0].solved === true, `one row written: ${JSON.stringify(s.guesses.map((g) => g.tries))}`);
  assert(s.guesses[0].answer === answer.id, "recording the answer it checked against");
  assert(s.guesses[0].username === "someone" && s.guesses[0].guest === false, "under the account's own name");
});

await runTest("the result is the FUNCTION's, whatever the client claims", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const answer = guessAnswerFor(today());
  const wrong = GUESS_PLAYERS.filter((p) => p.id !== answer.id).slice(0, 3).map((p) => p.id);
  const res = await invoke({
    variant: "daily", day: today(), guesses: wrong,
    solved: true, tries: 1, answer: wrong[0], outcome: "Got it first guess.", username: "admin",
  }, { userId: ME });
  assert(res.status === 200, `it still saves: ${res.status}`);
  assert(res.body.solved === false, `the claimed win is ignored: ${res.body.solved}`);
  assert(s.guesses[0].solved === false && s.guesses[0].tries === 3, `and nothing claimed reached the row: ${JSON.stringify(s.guesses[0])}`);
  assert(s.guesses[0].answer === answer.id, "the answer is the day's, not the one sent");
  assert(s.guesses[0].username === "someone", "and the name came from the account");
});

await runTest("a game that runs out of guesses is recorded as a loss", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const res = await invoke({ variant: "daily", day: today(), guesses: missesFor(guessAnswerFor(today())) }, { userId: ME });
  assert(res.status === 200 && res.body.solved === false, `a loss saves: ${res.status} ${res.body?.solved}`);
  assert(res.body.tries === GUESS_TRIES, `after all ${GUESS_TRIES}: ${res.body.tries}`);
  assert(res.body.answer?.id, "and it says who it was, which is the whole point of the end screen");
});

await runTest("the daily's date is the function's clock, and a stale tab is told", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const answer = guessAnswerFor(today());
  const res = await invoke({ variant: "daily", day: "2020-01-01", guesses: [answer.id] }, { userId: ME });
  assert(res.status === 400 && res.body?.reason === "wrong_day", `refused: ${res.status} ${JSON.stringify(res.body)}`);
  assert(s.guesses.length === 0, "and nothing was written");
  // With no day sent at all, the function still uses its own.
  const ok = await invoke({ variant: "daily", guesses: [answer.id] }, { userId: ME });
  assert(ok.status === 200 && ok.body.day === today(), `its own date is used: ${ok.body?.day}`);
});

await runTest("the daily is once per account", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const answer = guessAnswerFor(today());
  const first = await invoke({ variant: "daily", day: today(), guesses: [answer.id] }, { userId: ME });
  assert(first.status === 200, `the first goes in: ${first.status}`);
  const second = await invoke({ variant: "daily", day: today(), guesses: missesFor(answer) }, { userId: ME });
  assert(second.status === 409 && second.body?.reason === "duplicate", `the second is a duplicate: ${second.status}`);
  assert(s.guesses.length === 1, `and only one row exists: ${s.guesses.length}`);
});

await runTest("a guest plays practice and is refused the daily", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const no = await invoke({ variant: "daily", day: today(), guesses: [guessAnswerFor(today()).id] }, { userId: GUEST });
  assert(no.status === 403 && no.body?.reason === "guest_daily", `the daily is refused: ${no.status}`);
  assert(s.guesses.length === 0, "and nothing was written");
  const code = "PRACTICE";
  const yes = await invoke({ variant: "practice", seed: code, guesses: [guessAnswerForSeed(code).id] }, { userId: GUEST });
  assert(yes.status === 200 && yes.body.solved, `practice is allowed: ${yes.status} ${JSON.stringify(yes.body?.error)}`);
  assert(s.guesses[0].guest === true, "and carries the guest flag from the account");
  assert(s.guesses[0].day === null, "with no day, so it stays off the daily board");
});

await runTest("who is asking", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const g = [guessAnswerFor(today()).id];
  assert((await invoke({ variant: "daily", guesses: g })).status === 401, "no token is unauthorized");
  assert((await invoke({ variant: "daily", guesses: g }, { userId: "nobody" })).status === 401, "an unknown token too");
  assert((await invoke(null, { userId: ME, method: "GET" })).status === 405, "GET is not allowed");
  const pre = await invoke(null, { userId: ME, method: "OPTIONS" });
  assert(pre.status === 200 && pre.headers.get("Access-Control-Allow-Origin"), "the preflight answers with CORS");
  const nameless = await invoke({ variant: "practice", seed: "ABCD1234", guesses: g }, { userId: NAMELESS });
  assert(nameless.status === 400 && /no profile/.test(nameless.body?.error || ""), `an account with no name is told: ${nameless.status}`);
  assert(s.guesses.length === 0, "and none of them wrote anything");
});

await runTest("an illegal game is refused with the rule it broke", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const answer = guessAnswerFor(today());
  const other = GUESS_PLAYERS.filter((p) => p.id !== answer.id);
  const cases = [
    [{ variant: "daily", day: today(), guesses: [] }, "no_guesses", "an empty game"],
    [{ variant: "daily", day: today(), guesses: other.slice(0, GUESS_TRIES + 1).map((p) => p.id) }, "too_many", "nine guesses"],
    [{ variant: "daily", day: today(), guesses: [other[0].id, other[0].id] }, "repeat_guess", "the same player twice"],
    [{ variant: "daily", day: today(), guesses: ["Nobody At All|2015|QB"] }, "unknown_player", "somebody who does not exist"],
    [{ variant: "daily", day: today(), guesses: [7] }, "bad_guess", "a guess that is not an id"],
    [{ variant: "daily", day: today(), guesses: [answer.id, other[0].id] }, "guessed_past_the_end", "guessing on after winning"],
  ];
  for (const [body, reason, what] of cases) {
    const res = await invoke(body, { userId: ME });
    assert(res.status === 400 && res.body?.reason === reason,
      `${what} -> ${reason} (got ${res.status} ${JSON.stringify(res.body)})`);
  }
  assert(s.guesses.length === 0, "and not one of them was written");
  assert((await invoke({ variant: "daily", day: today() }, { userId: ME })).status === 400, "no guesses at all is refused");
});

await runTest("a practice seed has to be a code somebody could be sent", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  for (const seed of ["", "ab", "lower-case", "WAY-TOO-LONG-FOR-A-CODE-AT-ALL", null, 7]) {
    const res = await invoke({ variant: "practice", seed, guesses: [GUESS_PLAYERS[0].id] }, { userId: ME });
    assert(res.status === 400 && res.body?.reason === "bad_code", `${JSON.stringify(seed)} is refused: ${res.status}`);
  }
  assert(s.guesses.length === 0, "and nothing was written");
});

await runTest("a failed read or write says the save failed and writes nothing", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const g = [guessAnswerFor(today()).id];
  s.readFails.profiles = true;
  assert((await invoke({ variant: "daily", guesses: g }, { userId: ME })).status === 500, "a failed profile read");
  s.readFails.profiles = false;
  s.writeFails.guess_runs = true;
  const write = await invoke({ variant: "daily", guesses: g }, { userId: ME });
  assert(write.status === 500 && s.guesses.length === 0, `a failed insert writes nothing: ${write.status}`);
  s.writeFails.guess_runs = false;
  s.throwOn.profiles = true;
  const threw = await invoke({ variant: "daily", guesses: g }, { userId: ME });
  assert(threw.status === 500 && threw.headers.get("Access-Control-Allow-Origin"),
    `a thrown error keeps its CORS headers: ${threw.status}`);
});

console.log("test-guess-edge.mjs done");
