// Reporting a player, and the moderators' Reports queue. Contract: PROFILES.md. Classes are prefixed
// md-.
//
// PHASE 0 PLACEHOLDER (agent F builds the real thing). The props are final:
//   <ReportSheet username onClose />       - a signed-in visitor reports `username`; calls reportPlayer
//   <ModerationQueue onOpenProfile />      - moderators only; calls fetchModQueue and modAction.
//                                            onOpenProfile(username) opens that player's profile.
import { useState } from "react";
import { reportPlayer } from "./storage.js";
import { REPORT_REASONS, REPORT_REASON_LABEL } from "./profile-rules.mjs";

export const MODERATION_CSS = `
.md-sheet{display:flex;flex-direction:column;gap:10px}
`;

export function ReportSheet({ username, onClose }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="panel md-sheet" role="dialog" aria-label={`Report ${username}`}>
      {sent ? <p>Thanks. A moderator will take a look.</p> : (
        <div className="frow">
          {REPORT_REASONS.map((r) => (
            <button key={r} type="button" className="btn" onClick={async () => { const res = await reportPlayer(username, r, ""); if (res.ok) setSent(true); }}>{REPORT_REASON_LABEL[r]}</button>
          ))}
        </div>
      )}
      <button type="button" className="linkbtn" onClick={() => onClose?.()}>Close</button>
    </div>
  );
}

export function ModerationQueue({ onOpenProfile }) {
  return <p className="muted">No open reports.</p>;
}
