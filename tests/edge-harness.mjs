// Runs a real supabase/functions/<name>/index.ts, in Node, against a store the caller supplies.
//
// It exists because neither Edge Function was executed by anything. Their rules live in game-logic.mjs and
// versus-logic.mjs and are tested directly, which is most of what matters - but what is left is not nothing:
// who is asking, which write goes with which decision, what a failure answers, and the order it all happens
// in. All of that was held by assertions that read index.ts as TEXT, and the 2.0 sweeps found two of those
// passing while the thing they claimed to guard was broken. The very first execution of match-pick found a
// ReferenceError in a fix written minutes earlier that no string could have caught.
//
// What is stubbed is only the edges Deno and PostgREST provide. The handler, the shared logic, the game data
// and every decision are the shipped code.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const CLIENT_STUB = path.join(root, "build", "edge-supabase-stub.mjs");

// A store is: { users, rowsOf(table), insert(table, row), remove(table, match), rpcs, and the three failure
// switches }. Only the shapes the functions actually ask for are here; anything else throws by name, so a new
// call in a function is a loud failure rather than a silent undefined two lines later.
const STUB_SOURCE = `
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
    const q = { table, filters: [], orderBy: null, patch: null, wantRows: false, mode: "select" };
    const rows = () => {
      if (store.readFails?.[table]) return { error: { message: "read failed" }, data: null };
      let out = store.rowsOf(table);
      for (const [col, val] of q.filters) out = out.filter((r) => r[col] === val);
      if (q.orderBy) out = out.slice().sort((a, b) => (a[q.orderBy] > b[q.orderBy] ? 1 : a[q.orderBy] < b[q.orderBy] ? -1 : 0));
      return { data: out, error: null };
    };
    const fail = (msg, code) => ({ data: null, error: { message: msg, code } });
    const api = {
      select(columns) { q.columns = columns; q.wantRows = true; return api; },
      eq(col, val) { q.filters.push([col, val]); return api; },
      order(col) { q.orderBy = col; return api; },
      update(patch) { q.mode = "update"; q.patch = patch; return api; },
      insert(row) { q.mode = "insert"; q.row = row; return api; },
      upsert(row, opts2) { q.mode = "upsert"; q.row = row; q.upsertOpts = opts2; return api; },
      delete() { q.mode = "delete"; return api; },
      async single() { const r = rows(); return r.error ? r : { data: r.data[0] ?? null, error: r.data.length ? null : { code: "PGRST116", message: "no rows" } }; },
      async maybeSingle() { const r = rows(); return r.error ? r : { data: r.data[0] ?? null, error: null }; },
      then(resolve, reject) { return api.run().then(resolve, reject); },
      async run() {
        if (!asService) return fail("not the service role");
        if (store.writeFails?.[q.table] && q.mode !== "select") return fail("write failed");
        if (q.mode === "update") {
          // A test hook for the one window that matters and that no sequence of requests can open: something
          // landing between this request's read and its write.
          store.beforeWrite?.(q.table, q.mode);
          const r = rows();
          if (r.error) return r;
          for (const row of r.data) Object.assign(row, q.patch);
          return { data: q.wantRows ? r.data : null, error: null };
        }
        if (q.mode === "insert" || q.mode === "upsert") {
          store.beforeWrite?.(q.table, q.mode);
          const res = store.insert(q.table, q.row, { upsert: q.mode === "upsert", opts: q.upsertOpts });
          return res?.error ? fail(res.error.message, res.error.code) : { data: q.wantRows ? [res?.row ?? q.row] : null, error: null };
        }
        if (q.mode === "delete") {
          store.remove(q.table, q.filters);
          return { data: null, error: null };
        }
        return rows();
      },
    };
    return api;
  };
  const rpc = async (name, args, rpcOpts) => {
    if (!asService) return { data: null, error: { message: "not the service role" } };
    const fn = store.rpcs[name];
    if (!fn) throw new Error("the edge stub has no function " + name);
    if (store.rpcFails?.[name]) return { data: null, error: { message: name + " failed" } };
    store.rpcCalls?.push({ name, args, opts: rpcOpts });
    return { data: fn(args), error: null };
  };
  return { auth, from, rpc };
}
`;

const bundles = new Map();

// Bundles supabase/functions/<name>/index.ts once per process and returns { invoke }.
export async function loadEdgeFunction(name) {
  if (!bundles.has(name)) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "build"), { recursive: true });
    await writeFile(CLIENT_STUB, STUB_SOURCE, "utf8");
    const out = path.join(root, "build", `${name}.bundle.mjs`);
    await build({
      entryPoints: [path.join(root, "supabase", "functions", name, "index.ts")],
      bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "silent",
      alias: { "npm:@supabase/supabase-js@2": CLIENT_STUB },
    });
    bundles.set(name, out);
  }

  let handler = null;
  globalThis.Deno = {
    env: { get: (k) => ({ SUPABASE_URL: "http://edge.test", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-role-key" })[k] },
    serve: (h) => { handler = h; },
  };
  // A fresh module each time, so initGameData and Deno.serve run against this test's globals.
  const file = bundles.get(name).replace(/\\/g, "/");
  await import(`file://${file}?t=${Date.now()}-${Math.random()}`);
  if (!handler) throw new Error(`${name}/index.ts never called Deno.serve`);

  // One request, as a signed-in player. Returns { status, body, headers }.
  return {
    invoke: async (body, { userId = null, method = "POST", headers = {} } = {}) => {
      const res = await handler(new Request(`http://edge.test/${name}`, {
        method,
        headers: { "Content-Type": "application/json", ...(userId ? { Authorization: `Bearer ${userId}` } : {}), ...headers },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      }));
      let parsed = null;
      try { parsed = await res.json(); } catch (e) { parsed = null; }
      return { status: res.status, body: parsed, headers: res.headers };
    },
  };
}
