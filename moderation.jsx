// Reporting a player, and the moderators' Reports queue. Contract: PROFILES.md (6.4). Classes are prefixed
// md-; the app's own classes (.btn, .h, .frow, .panel, .err, .muted) are reused as they are.
//   <ReportSheet username onClose />   a signed-in visitor reports `username`; calls reportPlayer
//   <ModerationQueue onOpenProfile />  moderators only; calls fetchModQueue and modAction.
//                                      onOpenProfile(username) opens that player's profile.
// Both are self-contained. The database functions behind them enforce every rule (a modified browser can
// call those directly), so the checks here only make the messages friendlier.
import { useEffect, useId, useRef, useState } from "react";
import { reportPlayer, fetchModQueue, modAction } from "./storage.js";
import { REPORT_REASONS, REPORT_REASON_LABEL, REPORT_NOTE_MAX, REPORTS_PER_DAY, USERNAME_RE, bioLength } from "./profile-rules.mjs";
import { cssVars } from "./theme.mjs";
import { Avatar } from "./avatars.jsx";
import { fmtDate } from "./ui-common.jsx";

export const MODERATION_CSS = `
/* ===== moderation.jsx: the Report sheet and the Reports queue ===== */
/* The sheet takes the cream tokens wherever it's mounted: the profile card it opens from is dark. */
.md-scrim{${cssVars("light")};position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;padding-top:16px;
  background:color-mix(in srgb,var(--ink) 55%,transparent);color:var(--ink);overflow-y:auto;overscroll-behavior:contain}
/* A bottom sheet on phones. Auto margins rather than centering, so a sheet taller than the screen
   scrolls from its top instead of being cut off above it. */
.md-sheet{position:relative;width:100%;max-width:520px;margin:auto auto 0;background:var(--bg);color:var(--ink);
  border:2px solid var(--ink);border-bottom:0;border-radius:18px 18px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));
  animation:md-rise .18s ease-out both}
.md-sheet:focus{outline:none}
@keyframes md-rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.md-x{position:absolute;top:10px;right:10px;width:44px;height:44px;display:grid;place-items:center;border-radius:12px;
  border:2px solid var(--line2);background:var(--surface);color:var(--ink);font-size:24px;line-height:1}
.md-sheet .md-title{padding-right:52px;margin-bottom:12px}
.md-case{text-transform:none}
.md-fieldset{border:0;margin:0;padding:0;min-width:0}
.md-legend{padding:0;margin:0 0 8px;font-size:13px;font-weight:700;color:var(--muted)}
.md-reasons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.md-reason{display:flex;align-items:center;gap:10px;min-height:48px;padding:10px 12px;border:2px solid var(--line2);border-radius:12px;
  background:var(--surface);color:var(--ink);font-weight:700;font-size:15px;line-height:1.2;cursor:pointer;transition:border-color .12s,background-color .12s}
.md-reason input{flex:none;width:18px;height:18px;margin:0;accent-color:var(--accent-ink)}
.md-reason:has(input:checked){border-color:var(--ink);background:color-mix(in srgb,var(--accent) 35%,var(--surface))}
.md-reason:has(input:focus-visible){outline:3px solid var(--accent-ink);outline-offset:2px}
.md-field{display:block;margin:14px 0 4px;font-size:13px;font-weight:700;color:var(--muted)}
.md-note,.md-input{display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;color:var(--ink);background:var(--surface);
  border:2px solid var(--line2);border-radius:10px;padding:9px 11px}
.md-note{min-height:88px;resize:vertical}
.md-input{min-height:44px}
.md-note:focus,.md-input:focus{outline:none;border-color:var(--accent-ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent-ink) 25%,transparent)}
.md-sheet .md-count{margin:4px 0 0;font-size:12.5px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
.md-sheet .md-count.over{color:var(--loss);font-weight:700}
.md-buttons{margin-top:14px}
.md-sheet .md-thanks{margin:4px 0 16px;font-size:16px;color:var(--ink)}

.md-queue{margin-bottom:24px}
.md-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}
.md-queue .md-sum{margin:0 0 12px;font-size:14px;color:var(--muted)}
.md-status{margin:0;font-size:14px;font-weight:700;color:var(--ink)}
.md-status:not(:empty){margin:0 0 12px;padding:10px 14px;border-radius:12px;background:var(--surface);border:2px solid var(--line);box-shadow:inset 4px 0 0 var(--win)}
.md-status:focus{outline:none}
.md-queue .md-empty{margin:4px 0 0;padding-top:12px;border-top:3px solid var(--ink);font-family:var(--display);font-weight:400;font-size:26px;line-height:1.1;text-transform:uppercase;color:var(--ink)}
.md-list{display:grid;gap:14px}
.md-player{min-width:0;background:var(--surface);border:2px solid var(--ink);border-radius:16px;padding:14px 16px 16px;box-shadow:4px 4px 0 var(--hard)}
.md-head{display:flex;align-items:center;gap:12px;min-width:0}
.md-headtext{min-width:0}
.md-name{margin:0;font-family:var(--display);font-weight:400;font-size:28px;line-height:1.05;overflow-wrap:anywhere}
.md-link{background:none;border:0;padding:0;margin:0;font:inherit;color:var(--ink);text-align:left;text-decoration:underline;
  text-decoration-thickness:2px;text-underline-offset:4px;text-decoration-color:var(--line2)}
.md-queue .md-meta{margin:3px 0 0;font-size:13px;color:var(--muted)}
.md-bio{margin:12px 0 0;padding-left:12px;border-left:3px solid var(--line2)}
.md-label{display:block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.md-queue .md-text{margin:2px 0 0;font-size:15px;color:var(--ink);overflow-wrap:anywhere}
.md-queue .md-text.none{color:var(--muted)}
.md-reports{list-style:none;margin:12px 0 0;padding:0;border-top:1px solid var(--line)}
.md-report{display:grid;justify-items:start;gap:4px;min-width:0;padding:10px 0;border-bottom:1px solid var(--line)}
.md-tag{font-size:12px;font-weight:800;line-height:1.2;border-radius:999px;padding:3px 10px;color:var(--ink);background:var(--surface2);box-shadow:inset 0 0 0 1px var(--line2)}
.md-queue .md-note-text{margin:0;max-width:100%;font-size:14.5px;color:var(--ink);overflow-wrap:anywhere}
.md-by{font-size:13px;color:var(--muted)}
.md-acts{margin-top:12px}
.md-step{margin-top:12px;padding:12px;border-radius:12px;background:var(--surface2);display:grid;gap:10px;min-width:0}
.md-queue .md-ask{margin:0;font-size:15px;font-weight:700;color:var(--ink);overflow-wrap:anywhere}
.md-step .md-label{margin-bottom:-6px}
.btn.md-danger{background:var(--loss);border-color:var(--loss);color:var(--bg)}

@media (hover:hover){
  .md-reason:hover{border-color:var(--ink)}
  .md-link:hover{text-decoration-color:var(--accent-ink)}
}
@media (max-width:359px){
  .md-reasons{grid-template-columns:1fr}
}
/* Wider screens: a dialog in the middle instead of a sheet. */
@media (min-width:600px){
  .md-scrim{padding:24px 16px}
  .md-sheet{margin:auto;border-bottom:2px solid var(--ink);border-radius:18px;padding:22px 22px 20px;box-shadow:8px 8px 0 var(--hard)}
}
@media (pointer:coarse){
  .md-link{position:relative}
  .md-link::after{content:'';position:absolute;left:-4px;right:-4px;top:-8px;bottom:-8px}
}
@media (prefers-reduced-motion:reduce){
  .md-sheet{animation:none}
  .md-reason{transition:none}
}
`;

// ---------- Report sheet ----------

const REPORT_ERROR = {
  limit: `You've sent ${REPORTS_PER_DAY} reports in the last 24 hours. Try again later.`,
  duplicate: "You've already reported this player for that. A moderator will look at it.",
  self: "You can't report yourself.",
  signed_out: "Log in to report a player.",
  missing: "We couldn't find that player. Their username may have changed.",
  invalid: `Pick a reason, and keep the note to ${REPORT_NOTE_MAX} characters.`,
  network: "The report didn't send. Check your connection and try again.",
};

export function ReportSheet({ username, onClose }) {
  const id = useId();
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const sheet = useRef(null);
  const closeButton = useRef(null);
  const pressedScrim = useRef(false);
  // The latest onClose, for the Escape listener that's added once.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const close = () => onCloseRef.current?.();

  useEffect(() => {
    const opener = document.activeElement;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back to wherever the sheet was opened from (the Report button).
      if (opener && opener !== document.body && document.contains(opener)) opener.focus?.({ preventScroll: true });
    };
  }, []);
  useEffect(() => { if (sent) closeButton.current?.focus({ preventScroll: true }); }, [sent]);

  // Tab stays inside the sheet: the × is always the first button and Cancel or Close the last.
  function keepFocusInside(e) {
    if (e.key !== "Tab" || !sheet.current) return;
    const buttons = [...sheet.current.querySelectorAll("button:not(:disabled)")];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (!first) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const trimmed = note.trim();
  const length = bioLength(trimmed); // code points, the way the database counts
  const tooLong = length > REPORT_NOTE_MAX;

  async function send(e) {
    e.preventDefault();
    if (busy) return;
    if (!reason || tooLong) { setError(REPORT_ERROR.invalid); return; }
    setBusy(true);
    setError("");
    const res = await reportPlayer(username, reason, trimmed);
    setBusy(false);
    if (res.ok) setSent(true);
    else setError(REPORT_ERROR[res.reason] || REPORT_ERROR.network);
  }

  return (
    // Closes on a tap that starts and ends on the dim backdrop - not on a text selection dragged out of the sheet.
    <div className="md-scrim" onPointerDown={(e) => { pressedScrim.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedScrim.current && e.target === e.currentTarget) close(); pressedScrim.current = false; }}>
      <div ref={sheet} className="md-sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} onKeyDown={keepFocusInside}>
        <button type="button" className="md-x" aria-label="Close" onClick={close}>×</button>
        <h2 className="h md-title" id={`${id}-title`}>Report <span className="md-case">{username}</span></h2>
        {sent ? (
          <>
            <p className="md-thanks" role="status">Thanks. A moderator will take a look.</p>
            <div className="frow"><button ref={closeButton} type="button" className="btn" onClick={close}>Close</button></div>
          </>
        ) : (
          <form onSubmit={send} noValidate>
            <fieldset className="md-fieldset">
              <legend className="md-legend">What's the problem?</legend>
              <div className="md-reasons">
                {REPORT_REASONS.map((r) => (
                  <label key={r} className="md-reason">
                    <input type="radio" name={`${id}-reason`} value={r} checked={reason === r} onChange={() => { setReason(r); setError(""); }} />
                    {REPORT_REASON_LABEL[r]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="md-field" htmlFor={`${id}-note`}>Note (optional)</label>
            <textarea id={`${id}-note`} className="md-note" rows={3} value={note} aria-describedby={`${id}-count`}
              onChange={(e) => { setNote(e.target.value); setError(""); }} />
            <p id={`${id}-count`} className={`md-count${tooLong ? " over" : ""}`}>{length}/{REPORT_NOTE_MAX}</p>
            {error && <p className="err" role="alert">{error}</p>}
            <div className="frow md-buttons">
              <button type="submit" className="btn solid" disabled={busy || !reason || tooLong}>{busy ? "Sending…" : "Send"}</button>
              <button type="button" className="btn" onClick={close}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------- Reports queue ----------

const USERNAME_RULE = "Usernames are 3 to 16 characters: letters, numbers, and underscores.";
function actionError(reason, action) {
  if (reason === "taken") return "That username is taken. Try another one.";
  if (reason === "blocked") return "That username isn't allowed. Try another one.";
  if (reason === "invalid") return action === "rename" ? USERNAME_RULE : "That action isn't available. Refresh the list and try again.";
  if (reason === "missing") return "That player doesn't exist anymore.";
  if (reason === "not_moderator") return "Only moderators can do that.";
  return "That didn't go through. Check your connection and try again.";
}
// The three actions that change a player's profile ask first. Dismiss only closes reports.
const CONFIRM = {
  remove_picture: { ask: (p) => `Remove ${p.username}'s picture?`, yes: "Remove", busy: "Removing…", done: (p) => `Removed ${p.username}'s picture.` },
  clear_bio: { ask: (p) => `Clear ${p.username}'s bio?`, yes: "Clear", busy: "Clearing…", done: (p) => `Cleared ${p.username}'s bio.` },
  rename: { ask: (p, name) => `Rename ${p.username} to ${name}?`, yes: "Rename", busy: "Renaming…", done: (p, name) => `Renamed ${p.username} to ${name}.` },
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const dayOf = (t) => (t && !Number.isNaN(Date.parse(t)) ? fmtDate(t) : "");

export function ModerationQueue({ onOpenProfile }) {
  const id = useId();
  const [queue, setQueue] = useState(null); // null until the first load lands
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(""); // what the last action did
  const loads = useRef(0);
  const root = useRef(null);
  const status = useRef(null);

  async function load() {
    const n = ++loads.current;
    const list = await fetchModQueue();
    if (n !== loads.current) return; // a newer load started after this one; its answer wins
    if (list) { setQueue(list); setFailed(false); } else setFailed(true);
  }
  useEffect(() => { load(); }, []);
  // When an action's player leaves the list, focus would drop to the page; hand it to the message instead.
  useEffect(() => {
    if (notice && root.current && !root.current.contains(document.activeElement)) status.current?.focus({ preventScroll: true });
  }, [queue]);

  const players = queue || [];
  const open = players.reduce((n, p) => n + p.reports.length, 0);
  return (
    <section ref={root} className="md-queue" aria-labelledby={`${id}-title`}>
      <div className="md-top">
        <h2 className="h" id={`${id}-title`}>Reports</h2>
        {queue && <button type="button" className="btn sm" onClick={() => { setNotice(""); load(); }}>Refresh</button>}
      </div>
      <p ref={status} className="md-status" role="status" tabIndex={-1}>{notice}</p>
      {failed && (
        <div className="panel">
          <p>The reports didn't load.</p>
          <button type="button" className="btn" onClick={load}>Try again</button>
        </div>
      )}
      {!queue && !failed && <p className="muted">Loading reports…</p>}
      {queue && !players.length && <p className="md-empty">No open reports.</p>}
      {players.length > 0 && (
        <>
          <p className="md-sum">{plural(open, "open report")} on {plural(players.length, "player")}</p>
          <div className="md-list">
            {players.map((p) => (
              <QueueItem key={p.userId} player={p} onOpenProfile={onOpenProfile} onDone={(text) => { setNotice(text); load(); }} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function QueueItem({ player, onOpenProfile, onDone }) {
  const id = useId();
  // null (the action buttons) | "remove_picture" | "clear_bio" (asking to confirm) | "rename" (asking for the
  // name) | "confirm_rename"
  const [step, setStep] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useRef(null);
  const focusNext = useRef(null);
  const newName = name.trim();
  const hasPicture = !!(player.avatarPath || player.avatarPreset);

  // Buttons come and go between steps; keep keyboard focus on the step that just appeared, or on the
  // button that opened the step that just closed.
  useEffect(() => {
    const key = focusNext.current;
    focusNext.current = null;
    if (!key || !card.current) return;
    const el = key === "actions" ? card.current.querySelector(".md-acts button") : card.current.querySelector(`[data-focus="${key}"]`);
    el?.focus({ preventScroll: true });
  }, [step]);
  function go(next, focusKey) {
    focusNext.current = focusKey;
    setError("");
    setStep(next);
  }

  async function act(action) {
    setBusy(true);
    setError("");
    const res = await modAction(player.userId, action, action === "rename" ? newName : undefined);
    setBusy(false);
    if (res.ok) {
      go(null, "actions");
      setName("");
      onDone(action === "dismiss" ? `Dismissed the reports on ${player.username}.` : CONFIRM[action].done(player, newName));
      return;
    }
    // Their reports went with the account, so the reload takes the card away; say why at the top.
    if (res.reason === "missing") { onDone(actionError("missing")); return; }
    if (action === "rename" && ["taken", "blocked", "invalid"].includes(res.reason)) go("rename", "name");
    else go(null, action);
    setError(actionError(res.reason, action));
  }

  function nextFromName(e) {
    e.preventDefault();
    if (!USERNAME_RE.test(newName)) { setError(USERNAME_RULE); return; }
    go("confirm_rename", "confirm");
  }

  // The action a confirmation step is asking about, if one is showing.
  const confirming = step === "confirm_rename" ? "rename" : step === "remove_picture" || step === "clear_bio" ? step : null;
  const n = player.reports.length;
  return (
    <article ref={card} className="md-player" aria-labelledby={`${id}-name`} data-username={player.username}>
      <div className="md-head">
        <Avatar username={player.username} photoUrl={player.avatarUrl} preset={player.avatarPreset} size={80} />
        <div className="md-headtext">
          <h3 className="md-name" id={`${id}-name`}>
            <button type="button" className="md-link" onClick={() => onOpenProfile?.(player.username)}>{player.username}</button>
          </h3>
          <p className="md-meta">{plural(n, "open report")}</p>
        </div>
      </div>
      <div className="md-bio">
        <span className="md-label">Bio</span>
        {player.bio ? <p className="md-text">{player.bio}</p> : <p className="md-text none">No bio</p>}
      </div>
      <ul className="md-reports">
        {player.reports.map((r) => (
          <li key={r.id} className="md-report">
            <span className="md-tag">{REPORT_REASON_LABEL[r.reason] || r.reason}</span>
            {r.note && <p className="md-note-text">{r.note}</p>}
            <span className="md-by">{[r.reporter && `Reported by ${r.reporter}`, dayOf(r.createdAt)].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>

      {step === null && (
        <div className="frow md-acts">
          {hasPicture && <button type="button" className="btn" data-focus="remove_picture" disabled={busy} onClick={() => go("remove_picture", "confirm")}>Remove picture</button>}
          {player.bio && <button type="button" className="btn" data-focus="clear_bio" disabled={busy} onClick={() => go("clear_bio", "confirm")}>Clear bio</button>}
          <button type="button" className="btn" data-focus="rename" disabled={busy} onClick={() => { setName(""); go("rename", "name"); }}>Rename player</button>
          <button type="button" className="btn" data-focus="dismiss" disabled={busy} onClick={() => act("dismiss")}>{busy ? "Dismissing…" : "Dismiss"}</button>
        </div>
      )}

      {step === "rename" && (
        <form className="md-step" onSubmit={nextFromName} noValidate>
          <label className="md-label" htmlFor={`${id}-new`}>New username for <span className="md-case">{player.username}</span></label>
          <input id={`${id}-new`} className="md-input" data-focus="name" value={name} maxLength={16} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setName(e.target.value); setError(""); }} />
          <div className="frow">
            <button type="submit" className="btn">Next</button>
            <button type="button" className="btn" onClick={() => go(null, "rename")}>Cancel</button>
          </div>
        </form>
      )}

      {confirming && (
        <div className="md-step" role="group" aria-labelledby={`${id}-ask`}>
          <p className="md-ask" id={`${id}-ask`}>{CONFIRM[confirming].ask(player, newName)}</p>
          <div className="frow">
            <button type="button" className="btn md-danger" disabled={busy} onClick={() => act(confirming)}>{busy ? CONFIRM[confirming].busy : CONFIRM[confirming].yes}</button>
            {step === "confirm_rename"
              ? <button type="button" className="btn" data-focus="confirm" disabled={busy} onClick={() => go("rename", "name")}>Back</button>
              : <button type="button" className="btn" data-focus="confirm" disabled={busy} onClick={() => go(null, step)}>Cancel</button>}
          </div>
        </div>
      )}

      {error && <p className="err" role="alert">{error}</p>}
    </article>
  );
}
