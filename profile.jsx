// The profile screen - your own and everyone else's. Contract: PROFILES.md. Classes are prefixed pf-;
// the player card (.pf-card) is in the dark scope (perfect-season.jsx's stylesheet lists it).
//
// PHASE 0 PLACEHOLDER (agent C builds the real screen). The props and the test hooks are final:
//   status          "loading" | "ok" | "missing" | "error"
//   profile         storage-profile.js's fetchPlayerProfile profile, when status is "ok"
//   isOwner         the signed-in player is looking at their own profile
//   userId          the signed-in player's id, or null for a guest
//   rank            { fantasy, standard }: 1-based sitewide rank of each best score, or null values
//   moderator       { openReports } for a moderator looking at their own profile, otherwise null
//   onRetry()       reload after an error
//   onShare()       -> Promise<"shared" | "copied" | "failed">: share or copy the profile link
//   onDetailsSaved(details)  after the bio, favorite team or picture is saved (mapDetails shape)
//   onLogOut()      owner only
//   onPlay()        owner with no drafts yet: go to the draft
//   onOpenReports() moderator: open the Reports queue
// Test hooks: the root is <section class="profile" data-username=... data-owner="true|false">; the
// owner view has a "Log out" button; an owner with no drafts sees "Play your first season to start
// your record." and a "Go to the draft" button.
import { useState } from "react";
import { Avatar } from "./avatars.jsx";
import { ReportSheet } from "./moderation.jsx";
import { draftsOf } from "./ui-common.jsx";

export const PROFILE_CSS = `
.pf-card{background:var(--bg);border-radius:18px;padding:18px;margin-bottom:16px;display:flex;flex-direction:column;gap:10px}
.pf-name{font-family:var(--display);font-weight:400;font-size:40px;line-height:1;margin:0;overflow-wrap:anywhere}
`;

export function ProfileScreen({ status, profile, isOwner, userId, rank, moderator, onRetry, onShare, onDetailsSaved, onLogOut, onPlay, onOpenReports }) {
  const [reporting, setReporting] = useState(false);
  if (status === "loading") return <p className="muted">Loading profile…</p>;
  if (status === "missing") return <div className="panel"><p style={{ margin: 0 }}>There's no player with that name.</p></div>;
  if (status !== "ok" || !profile) {
    return <div className="panel"><p>The profile didn't load.</p><button className="btn" onClick={() => onRetry?.()}>Try again</button></div>;
  }
  const s = profile.stats;
  return (
    <section className="profile" data-username={profile.username} data-owner={isOwner ? "true" : "false"}>
      <div className="pf-card">
        <Avatar username={profile.username} photoUrl={profile.details.avatarUrl} preset={profile.details.avatarPreset} size={72} decorative />
        <h1 className="pf-name">{profile.username}</h1>
        {profile.details.bio && <p style={{ margin: 0 }}>{profile.details.bio}</p>}
        <div className="frow">
          <button className="btn" onClick={() => onShare?.()}>Share profile</button>
          {!isOwner && userId && <button className="btn" onClick={() => setReporting(true)}>Report</button>}
          {isOwner && moderator && <button className="btn" onClick={() => onOpenReports?.()}>Reports ({moderator.openReports})</button>}
        </div>
      </div>
      {reporting && <ReportSheet username={profile.username} onClose={() => setReporting(false)} />}
      {draftsOf(s) === 0 ? (
        <div className="panel">
          <p style={{ margin: 0 }}>{isOwner ? "Play your first season to start your record." : "No seasons yet."}</p>
          {isOwner && <div style={{ marginTop: 10 }}><button className="btn solid" onClick={() => onPlay?.()}>Go to the draft</button></div>}
        </div>
      ) : (
        <div className="tiles">
          <div className="tile"><div className="n">{draftsOf(s).toLocaleString()}</div><div className="l">Drafts</div></div>
          <div className="tile"><div className="n">{s.champs}</div><div className="l">Championships</div></div>
          <div className="tile"><div className="n">{s.perfect}</div><div className="l">Perfect seasons</div></div>
        </div>
      )}
      {isOwner && <button className="linkbtn" onClick={() => onLogOut?.()}>Log out</button>}
    </section>
  );
}
