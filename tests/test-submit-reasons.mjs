// What a failed submission is CALLED, and what the outbox then does with it.
//
// This is the seam that lost a player's daily on production on 2026-09-30. Everything either side of it
// was tested and correct: submit-guess names a reason for every answer it gives, and pending-daily.mjs
// holds the reasons it is told to hold. Nothing tested the translation between them - the mocks in
// tests/mock-guess.mjs and tests/mock-century.mjs stand in for the whole functions.invoke layer, so
// `error.context.json()` had never been exercised by anything.
//
// What it got wrong: a failure that is not the function's fault was given the same name as a verdict
// this client cannot read. Both came back "network", `network` is deliberately not retryable, and
// drainOne therefore retired a played daily for good and wrote `unrecorded` - a field nothing reads. The
// run was gone and nobody was told.
//
// The rule these tests pin, which is the function's own contract: EVERY answer submit-guess and
// submit-century give a POST names a reason. So a body with no reason in it did not come from the
// function - it is the platform in between, and that is transient. A body that does name a reason, and
// one this client has never heard of, is a newer function's verdict, and re-sending cannot change it.
//
//   node tests/test-submit-reasons.mjs
import { assert, runTest } from "./helpers.mjs";
import { drainOne, _resetPending } from "../pending-daily.mjs";

const DAY = "2026-09-30";

// A stand-in for the one thing the real modules touch: getClient().functions.invoke(). `answer` is what
// invoke resolves to, exactly as supabase-js shapes it - { data, error }, where a FunctionsHttpError
// carries the response on `error.context`.
function withClient(answer, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prev = had ? globalThis.window : undefined;
  globalThis.window = { ...(prev || {}), __ps_supabase__: { functions: { invoke: async () => answer } } };
  return fn().finally(() => { if (had) globalThis.window = prev; else delete globalThis.window; });
}

// The two shapes a real failure arrives in.
const httpError = (body) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { json: async () => body } },
});
const unreadable = () => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { json: async () => { throw new Error("not json"); } } },
});

const { submitGuess, GUESS_RETRY } = await import("../storage-guess.js");
const { submitCentury, CENTURY_RETRY } = await import("../storage-century.js");

const GAMES = [
  {
    name: "Guess",
    retry: GUESS_RETRY,
    send: (answer) => withClient(answer, () => submitGuess({ variant: "daily", day: DAY, guesses: ["a"] })),
    known: "guest_daily",
  },
  {
    name: "Century",
    retry: CENTURY_RETRY,
    send: (answer) => withClient(answer, () => submitCentury({ variant: "daily", day: DAY, picks: [] })),
    known: "guest_daily",
  },
];

// The whole point of a name is what the outbox does with it, so every case below is checked through to
// the verdict rather than stopping at the string.
async function outcomeOf(reason, retry) {
  _resetPending();
  let kept = null;
  return drainOne({
    key: "k", rec: { day: DAY, solved: true, tries: 4, guesses: ["a"], saved: false }, day: DAY, retry,
    submit: async () => ({ ok: false, reason }),
    keep: async (next) => { kept = next; },
    drop: async () => {},
  }).then((r) => ({ verdict: r, kept }));
}

for (const g of GAMES) {
  await runTest(`${g.name}: a refusal the client knows is passed straight through`, async () => {
    const res = await g.send(httpError({ error: "the daily is for accounts", reason: g.known }));
    assert(res.ok === false && res.reason === g.known, `expected ${g.known}, got ${JSON.stringify(res)}`);
  });

  await runTest(`${g.name}: nothing readable came back, so it never arrived - offline, and held`, async () => {
    for (const answer of [unreadable(), httpError(null)]) {
      const res = await g.send(answer);
      assert(res.reason === "offline", `expected offline, got ${JSON.stringify(res)}`);
      const { verdict } = await outcomeOf(res.reason, g.retry);
      assert(verdict === "held", `offline must be held, got ${verdict}`);
    }
  });

  // The rule the author of GUESS_RETRY was protecting, and it still holds: a verdict this client cannot
  // read must not be re-sent on every focus until midnight.
  await runTest(`${g.name}: a reason this client has never heard of is a verdict - network, and retired`, async () => {
    const res = await g.send(httpError({ error: "some rule added later", reason: "invented_later" }));
    assert(res.reason === "network", `an unknown reason should be network, got ${JSON.stringify(res)}`);
    assert(!g.retry.includes("network"), "and network must stay off the retry list");
    const { verdict, kept } = await outcomeOf(res.reason, g.retry);
    assert(verdict === "retired", `an unknown verdict retires, got ${verdict}`);
    assert(kept && kept.unrecorded === true, "and settles the record as unrecorded");
  });

  // THE REGRESSION. Before v2.18.2 this returned "network" as well, and the run was retired and lost.
  await runTest(`${g.name}: a body with no reason in it is the platform, not a verdict - held, not lost`, async () => {
    // What a Functions relay, a gateway or a worker that failed to boot actually sends back: JSON, but
    // none of it the function's own. The function names a reason on every answer it gives a POST.
    for (const body of [{ error: "Internal Server Error" }, { msg: "upstream connect error" }, {}]) {
      const res = await g.send(httpError(body));
      assert(res.reason === "server",
        `a body with no reason is the platform, expected server, got ${JSON.stringify(res)} for ${JSON.stringify(body)}`);
      assert(g.retry.includes(res.reason), `and ${res.reason} must be retryable`);
      const { verdict, kept } = await outcomeOf(res.reason, g.retry);
      assert(verdict === "held", `the run must be held for another go, got ${verdict}`);
      assert(kept === null, "and must not be settled as unrecorded");
    }
  });

  await runTest(`${g.name}: a 200 that is not ok is the platform too - held, not lost`, async () => {
    for (const data of [{}, { ok: false }, null]) {
      const res = await g.send({ data, error: null });
      assert(res.reason === "server", `expected server, got ${JSON.stringify(res)} for ${JSON.stringify(data)}`);
      const { verdict } = await outcomeOf(res.reason, g.retry);
      assert(verdict === "held", `a 200 without ok must be held, got ${verdict}`);
    }
  });

  await runTest(`${g.name}: a success is a success`, async () => {
    const res = await g.send({ data: { ok: true, solved: true, tries: 4 }, error: null });
    assert(res.ok === true && res.tries === 4, `expected the server's numbers, got ${JSON.stringify(res)}`);
  });

  await runTest(`${g.name}: invoke throwing is a dead radio, not an answer`, async () => {
    const res = await withClient(null, async () => {
      globalThis.window.__ps_supabase__ = { functions: { invoke: async () => { throw new TypeError("Failed to fetch"); } } };
      return g.name === "Guess"
        ? submitGuess({ variant: "daily", day: DAY, guesses: ["a"] })
        : submitCentury({ variant: "daily", day: DAY, picks: [] });
    });
    assert(res.reason === "offline", `a thrown invoke is offline, got ${JSON.stringify(res)}`);
    const { verdict } = await outcomeOf(res.reason, g.retry);
    assert(verdict === "held", `and is held, got ${verdict}`);
  });
}

// The two lists are meant to be the same list twice. They are read by two screens and one module, and a
// difference between them would mean a held Century and a held Guess behaving differently for reasons
// nobody chose.
await runTest("the two retry lists have not drifted apart", async () => {
  assert(JSON.stringify(GUESS_RETRY) === JSON.stringify(CENTURY_RETRY),
    `GUESS_RETRY ${JSON.stringify(GUESS_RETRY)} vs CENTURY_RETRY ${JSON.stringify(CENTURY_RETRY)}`);
});

console.log("test-submit-reasons.mjs done");
