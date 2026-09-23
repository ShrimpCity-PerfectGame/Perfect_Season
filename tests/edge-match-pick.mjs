// Runs the REAL supabase/functions/match-pick/index.ts, against the same in-memory store tests/mock-versus.mjs
// keeps.
//
// It exists because neither Edge Function was executed by anything. Their rules live in versus-logic.mjs and are
// tested directly, which is most of what matters - but what is left is not nothing: who is asking, which write
// goes with which decision, what a failure answers, and the order it all happens in. All of that was held by
// assertions that read index.ts as TEXT and matched one spelling of one line, and the 2.0 sweeps found two of
// those passing while the thing they claimed to guard was broken. So this drives it instead.
//
// What is stubbed is only the edges Deno and PostgREST provide: `Deno.env`/`Deno.serve`, and a client with the
// handful of query shapes index.ts actually uses. The handler itself, versus-logic, the game data and every
// decision are the shipped code.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The npm: specifier Deno resolves for itself. Pointed at the stub below instead, which is the only file in
// this harness allowed to pretend to be anything.
const CLIENT_STUB = path.join(root, "build", "edge-supabase-stub.mjs");

const STUB_SOURCE = `
// Only the shapes index.ts asks for. Anything else throws by name rather than answering undefined, so a new
// call in the function is a loud failure here instead of a silent null two lines later.
export function createClient(url, key, opts) {
  const store = globalThis.__edge_store__;
  const asService = key === "service-role-key";
  const auth = {
    async getUser() {
      const token = opts?.global?.headers?.Authorization || "";
      const id = token.replace(/^Bearer /, "");
      const user = id && store.users.has(id) ? { id } : null;
      return { data: { user }, error: user ? null : { message: "bad jwt" } };
    },
  };
  const from = (table) => {
    const q = { table, filters: [], columns: "*", orderBy: null, patch: null, wantRows: false };
    const rows = () => {
      if (store.readFails?.[table]) return { error: { message: "read failed" }, data: null };
      let out = store.rowsOf(table);
      for (const [col, val] of q.filters) out = out.filter((r) => r[col] === val);
      if (q.orderBy) out = out.slice().sort((a, b) => (a[q.orderBy] > b[q.orderBy] ? 1 : a[q.orderBy] < b[q.orderBy] ? -1 : 0));
      return { data: out, error: null };
    };
    const api = {
      select(columns) { q.columns = columns; q.wantRows = true; return api; },
      eq(col, val) { q.filters.push([col, val]); return api; },
      order(col) { q.orderBy = col; return api; },
      update(patch) { q.patch = patch; return api; },
      async maybeSingle() { const r = rows(); return r.error ? r : { data: r.data[0] ?? null, error: null }; },
      then(resolve, reject) { return api.run().then(resolve, reject); },
      async run() {
        if (!asService) return { data: null, error: { message: "not the service role" } };
        if (q.patch) {
          if (store.writeFails?.[q.table]) return { data: null, error: { message: "write failed" } };
          // A test hook for the one window that matters and that no sequence of requests can open: something
          // landing between this request's read of the match and its write.
          store.beforeWrite?.(q.table);
          const r = rows();
          if (r.error) return r;
          for (const row of r.data) Object.assign(row, q.patch);
          return { data: q.wantRows ? r.data : null, error: null };
        }
        return rows();
      },
    };
    return api;
  };
  const rpc = async (name, args) => {
    if (!asService) return { data: null, error: { message: "not the service role" } };
    const fn = store.rpcs[name];
    if (!fn) throw new Error("the edge stub has no function " + name);
    if (store.rpcFails?.[name]) return { data: null, error: { message: name + " failed" } };
    return { data: fn(args), error: null };
  };
  return { auth, from, rpc };
}
`;

let cached = null;

// Bundles index.ts once per process and returns { invoke, store }. `store` is what the function reads and
// writes; a test fills it from tests/mock-versus.mjs's own maps, so both sides of a comparison see one truth.
export async function loadMatchPick() {
  if (!cached) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "build"), { recursive: true });
    await writeFile(CLIENT_STUB, STUB_SOURCE, "utf8");
    const out = path.join(root, "build", "match-pick.bundle.mjs");
    await build({
      entryPoints: [path.join(root, "supabase", "functions", "match-pick", "index.ts")],
      bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "silent",
      alias: { "npm:@supabase/supabase-js@2": CLIENT_STUB },
    });
    cached = out;
  }

  let handler = null;
  globalThis.Deno = {
    env: { get: (k) => ({ SUPABASE_URL: "http://edge.test", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })[k] },
    serve: (h) => { handler = h; },
  };
  // A fresh module each time, so initGameData and Deno.serve run against this test's globals.
  await import(`file://${cached.replace(/\\/g, "/")}?t=${Date.now()}-${Math.random()}`);
  if (!handler) throw new Error("index.ts never called Deno.serve");

  // One request, as a signed-in player. Returns { status, body }.
  const invoke = async (body, { userId = null, method = "POST", headers = {} } = {}) => {
    const res = await handler(new Request("http://edge.test/match-pick", {
      method,
      headers: { "Content-Type": "application/json", ...(userId ? { Authorization: `Bearer ${userId}` } : {}), ...headers },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    }));
    let parsed = null;
    try { parsed = await res.json(); } catch (e) { parsed = null; }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  return { invoke };
}

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
