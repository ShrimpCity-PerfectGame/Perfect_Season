// Thin persistence seam. shared=true keys are sitewide (leaderboard-visible - accounts, stats,
// daily-challenge results); shared=false keys are per-device only (session, draft-in-progress
// snapshots, the howto-seen flag). In tests and local dev, `window.storage` is a mock/shim
// (tests/helpers.mjs's makeStorage(), or entry.jsx's localStorage shim); in production,
// entry.jsx installs a real Supabase-backed implementation here instead. Nothing in this file
// or its callers needs to know which backend is actually behind window.storage - that's the
// point of the seam.
export async function sget(key, shared) {
  try { const r = await window.storage.get(key, shared); return r && r.value ? JSON.parse(r.value) : null; }
  catch (e) { return null; }
}
export async function sset(key, val, shared) {
  try { const r = await window.storage.set(key, JSON.stringify(val), shared); return !!r; }
  catch (e) { return false; }
}
export async function sdel(key, shared) {
  try { await window.storage.delete(key, shared); } catch (e) { /* already gone */ }
}
// Clearing a saved draft overwrites it first, then deletes. If the delete doesn't land, the
// empty snapshot still fails validDraft, so a finished draft can't come back as "5 of 6 picked".
export async function clearDraft(key) {
  await sset(key, { cleared: true, history: [] }, false);
  await sdel(key, false);
}

// ---------- Leaderboard / daily-board queries ----------
// For now these still list-then-fetch-everything against window.storage, exactly like the code
// they replaced - same cost, same behavior, just given real names. Once a real Supabase backend
// is wired in, only these four functions' internals change to real targeted SQL queries; every
// caller in perfect-season.jsx already expects this shape and won't need to change again.
const STATS_PREFIX = "stats:";
const DAILY_PREFIX = (date) => `daily:${date}:`;

async function fetchAllStats() {
  const res = await window.storage.list(STATS_PREFIX, true);
  const keys = (res?.keys || []).map((k) => (typeof k === "string" ? k : k.key)).filter(Boolean);
  const rows = [];
  for (let i = 0; i < keys.length; i += 10) {
    const batch = await Promise.all(keys.slice(i, i + 10).map(async (k) => {
      const v = await sget(k, true);
      return v ? { ...v, id: k.slice(STATS_PREFIX.length) } : null;
    }));
    rows.push(...batch.filter(Boolean));
  }
  return rows;
}

export async function fetchLeaderboardTop(limit = 10) {
  const rows = await fetchAllStats();
  return rows.filter((q) => q.bestScore != null).sort((a, b) => b.bestScore - a.bestScore).slice(0, limit);
}

// How many players sit strictly above this score - callers add 1 for a 1-based rank.
export async function fetchOwnRank(score) {
  const rows = await fetchAllStats();
  return rows.filter((q) => q.bestScore != null && q.bestScore > score).length;
}

export async function fetchSiteTotals() {
  const rows = await fetchAllStats();
  const totals = rows.reduce((t, q) => ({ runs: t.runs + (q.runs || 0) + (q.dnf || 0), perfect: t.perfect + (q.perfect || 0) }), { runs: 0, perfect: 0 });
  return { ...totals, players: rows.length };
}

export async function fetchDailyTop(date, limit = 10) {
  const res = await window.storage.list(DAILY_PREFIX(date), true);
  const keys = (res?.keys || []).map((k) => (typeof k === "string" ? k : k.key)).filter(Boolean);
  const rows = [];
  for (let i = 0; i < keys.length; i += 10) {
    const batch = await Promise.all(keys.slice(i, i + 10).map((k) => sget(k, true)));
    rows.push(...batch.filter(Boolean));
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}
