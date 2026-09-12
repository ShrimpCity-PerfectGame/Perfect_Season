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
