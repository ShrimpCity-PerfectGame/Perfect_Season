// A daily that was played but never recorded, and how it gets recorded later.
//
// THE PROBLEM THIS EXISTS FOR. Since v2.17.0 Guess the Player and Century write a per-account record to
// the device the moment a daily finishes - before the submission, and whatever the submission answers -
// so that a refused save cannot be turned into a fresh attempt with the answer already on screen. That
// closed a real hole and opened a worse one: a player whose POST simply dropped lost the day AND the run.
// It happened on production on 2026-09-30, to a solved game, and there was nothing left to recover from.
//
// THE FIX, in one sentence: the record the device already writes becomes the outbox. It gains `saved`,
// and while that is false the run is still owed to the board, so the app re-sends it when it next has a
// reason to think the world has changed.
//
// WHY NOT A QUEUE OF ITS OWN. Because the record is already there, already per-account, already per-day,
// and already the thing the daily tile is gated on. A second structure would be a second thing to keep in
// step with the first, and the two would drift - which is this repo's most repeated failure.
//
// WHAT THIS MODULE MAY NOT DO. It may not make a held run BETTER than the one that was played. The
// caller writes the record once, at the end of the game, and this module only ever re-sends what is
// already there - it never builds a payload and never merges one. The gate that stops a second game
// being played for the same day lives in the screens, on this same record, and must stay there.

const sending = new Set(); // keys with a POST in the air, so a drain and a finish cannot both send

// Re-send a held run, once, if it is still owed and still for the day it claims.
//
//   key     the storage key the record lives under - also the in-flight lock
//   rec     the record, as the screen wrote it
//   day     today, in the same calendar the record was written in (UTC for both games)
//   retry   the reasons this game may be re-sent after (GUESS_RETRY / CENTURY_RETRY)
//   submit  (rec) => Promise<{ ok } | { ok: false, reason }>
//   keep    (next) => Promise<void>  - write the record back
//   drop    () => Promise<void>      - forget the record
//
// Returns "sent" | "held" | "retired" | "skipped", which is what the tests assert on.
export async function drainOne({ key, rec, day, retry, submit, keep, drop }) {
  if (!rec || rec.saved !== false) return "skipped";     // nothing owed
  if (!rec.day) { await drop(); return "retired"; }      // a record with no day cannot be filed
  // Only today's. A held run is not a way to score yesterday's guesses against today's player - the
  // server would refuse it as wrong_day anyway, but it must not be OFFERED, and a device that was shut
  // for a week should not wake up and post a stale board.
  if (rec.day !== day) { await drop(); return "retired"; }
  if (sending.has(key)) return "skipped";

  sending.add(key);
  try {
    const res = await submit(rec);
    if (res && res.ok) {
      // It is on the board. Keep the record - it is still what stops the day being replayed - but stop
      // owing it, and take the server's numbers over the client's where they differ.
      await keep({ ...rec, saved: true, solved: res.solved ?? rec.solved, tries: res.tries ?? rec.tries });
      return "sent";
    }
    const reason = res && res.reason;
    // `duplicate` means the row is in - from another device, or from a first attempt that landed after
    // the client had given up on it. Either way nothing is owed any more.
    if (reason === "duplicate") { await keep({ ...rec, saved: true }); return "sent"; }
    if (retry.includes(reason)) return "held";
    // Anything else is the server's verdict on the run itself. Re-sending cannot change it, and holding
    // it for ever would mean a record that never settles - so it retires, still spent, still unplayable.
    await keep({ ...rec, saved: true, unrecorded: true });
    return "retired";
  } catch (e) {
    return "held";      // a thrown drain is a dropped drain, not an answer
  } finally {
    sending.delete(key);
  }
}

// The same lock, for the screen's own first attempt - so a drain firing while finish() is still waiting
// cannot put a second copy of the same run in the air.
export async function sendOnce(key, send) {
  if (sending.has(key)) return { ok: false, reason: "in_flight" };
  sending.add(key);
  try { return await send(); } finally { sending.delete(key); }
}

// Test-only: forget every in-flight lock. A lock outliving its request would wedge the drain for the
// life of the tab, so the tests need to be able to prove the lock is released as well as taken.
export function _resetPending() { sending.clear(); }
