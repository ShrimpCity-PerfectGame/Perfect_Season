// The profile screen - your own and everyone else's. Contract: PROFILES.md (6.3). Classes are prefixed
// pf-; the player card (.pf-card) is in the dark scope (perfect-season.jsx's stylesheet lists it).
//
// Props:
//   status          "loading" | "ok" | "missing" | "error"
//   profile         storage-profile.js's fetchPlayerProfile profile, when status is "ok"
//   isOwner         the signed-in player is looking at their own profile
//   userId          the signed-in player's id, or null for a guest
//   rank            { fantasy, standard }: 1-based sitewide rank of each best score, or null values
//   moderator       { openReports } for a moderator looking at their own profile, otherwise null
//   onRetry()       reload after an error
//   onShare()       -> Promise<"shared" | "copied" | "failed" | "cancelled">: share or copy the profile
//                      link ("cancelled": the share sheet was closed, so no status is shown)
//   onDetailsSaved(details)  after the bio, favorite team or picture is saved (mapDetails shape)
//   onLogOut()      owner only
//   onPlay()        owner with no drafts yet: go to the draft
//   onOpenReports() moderator: open the Reports queue
//   wallet          { balance } for the owner, else null (v1.12.0, SHOP.md 7.3)
//   onOpenShop()    owner: open the shop
// Test hooks: the root is <section class="profile" data-username=... data-owner="true|false">; the
// owner view has a "Log out" button; an owner with no drafts sees "Play your first season to start
// your record." and a "Go to the draft" button.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar } from "./avatars.jsx";
import { FramedAvatar, CardTheme, TitleLine, Coins } from "./cosmetics.jsx";
import { AvatarPicker } from "./avatar-picker.jsx";
import { ReportSheet } from "./moderation.jsx";
import { BADGE_BY_ID, badgeProgress, topBadges } from "./badges.mjs";
import {
  FORMAT_LABEL, LADDER_LABEL, teamVars, gradeTier, grade, fmtDate, outcomeSentence, draftsOf, scoreOf, runOf, RosterRows,
} from "./ui-common.jsx";
import { BIO_MAX, TEAM_CODES, bioLength, cleanBio, mapPlayerStats } from "./profile-rules.mjs";
import { saveProfile, saveAvatarPhoto, setAvatarPreset, removeAvatar } from "./storage.js";
import { TEAMS, FORMATS, LADDERS, nextStreak } from "./game-logic.mjs";
import { PALETTE } from "./theme.mjs";

export const PROFILE_CSS = `
/* ===== profile ===== */
.pf-sec{margin:0 0 28px}
.pf-hd{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;margin:0 0 10px}
.pf-hd .h{margin:0}
.pf-meta{font-size:13px;font-weight:700;color:var(--muted)}
.panel p.pf-msg{margin:0}
.pf-msgact{margin-top:12px}
/* Badge tiers: --tier reads as text (the deep metal on cream), --medal is the bright fill. */
.pf-t-bronze{--tier:var(--tier-bronze);--medal:var(--tier-bronze-fill)}
.pf-t-silver{--tier:var(--tier-silver);--medal:var(--tier-silver-fill)}
.pf-t-gold{--tier:var(--tier-gold);--medal:var(--tier-gold-fill)}
.pf-t-special{--tier:var(--tier-special);--medal:var(--tier-special-fill)}

/* The player card: the page's navy scoreboard moment (dark tokens), with the app's sticker edge. */
.pf-card{position:relative;display:grid;gap:14px;margin:0 0 20px;padding:20px 20px 18px;border-radius:18px;
  background:var(--bg);border:2px solid ${PALETTE.ink};box-shadow:4px 4px 0 ${PALETTE.ink}}
.pf-card::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(ellipse 60% 90% at 0% 0%,var(--glow),transparent 62%),radial-gradient(color-mix(in srgb,var(--ink) 5%,transparent) 1px,transparent 1.4px) 0 0/6px 6px}
.pf-card>*{position:relative}
.pf-head{display:flex;align-items:center;gap:16px;min-width:0}
.pf-ring{flex:none;display:grid;place-items:center;padding:4px;border-radius:50%;background:var(--ink)}
.pf-id{display:grid;gap:8px;min-width:0}
.pf-name{margin:0;font-family:var(--display);font-weight:400;font-size:clamp(34px,6.2vw,54px);line-height:.95;color:var(--ink);overflow-wrap:anywhere}
.pf-team{margin:0;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--ink)}
.pf-swatch{flex:none;width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,var(--tc1) 0 50%,var(--tc2) 50%);box-shadow:0 0 0 2px var(--ink)}
.pf-tops{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.pf-tops li{display:inline-flex;align-items:center;gap:7px;padding:4px 12px 4px 4px;border-radius:999px;background:var(--surface2);box-shadow:inset 0 0 0 1.5px var(--tier);
  font-size:13px;font-weight:700;line-height:1.2;color:var(--ink)}
.pf-tops .pf-e{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--medal);font-size:14px;line-height:1}
/* Clipped to its own box: a bio of stacked combining marks would otherwise spill over the card. */
.pf-bio{margin:0;max-width:62ch;font-size:16px;line-height:1.45;color:var(--ink);overflow-wrap:anywhere;overflow:hidden}
.pf-facts{display:flex;flex-wrap:wrap;gap:10px 30px;margin:0;padding:12px 0 0;border-top:1px solid var(--line2)}
.pf-facts>div{display:grid;gap:4px}
.pf-facts dt{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pf-facts dd{margin:0;font-family:var(--display);font-weight:400;font-size:24px;line-height:1;color:var(--ink)}
.pf-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.pf-status{font-size:14px;font-weight:700;color:var(--ink)}
.pf-status.pf-bad{color:var(--loss)}

/* Editor */
.pf-editor{display:grid;gap:18px}
.pf-form{display:grid;gap:18px}
.pf-field{display:grid;gap:8px;justify-items:start;min-width:0}
.pf-label{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pf-pic{display:flex;align-items:center;flex-wrap:wrap;gap:14px}
.pf-text{display:block;width:100%;max-width:560px;min-height:96px;field-sizing:content;resize:vertical;margin:0;padding:10px 12px;font:inherit;font-size:16px;line-height:1.4;
  color:var(--ink);background:var(--surface);border:2px solid var(--line2);border-radius:10px}
.pf-select{max-width:100%;min-width:0;padding:9px 12px;font:inherit;font-size:16px;color:var(--ink);background:var(--surface);border:2px solid var(--line2);border-radius:10px}
.pf-text:focus,.pf-select:focus{outline:none;border-color:var(--accent-ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent-ink) 25%,transparent)}
.pf-count{font-size:13px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.pf-count.pf-over{color:var(--loss)}
.pf-teampick{display:flex;align-items:center;gap:10px;max-width:100%}
.panel p.pf-saved{margin:0;font-weight:700;color:var(--win)}

/* Badges: a sheet of stickers. Earned ones are medal-colored with an ink edge and a check; locked ones
   are dimmed, with a ring filling in toward the goal. Opening one shows its details on a full-width row
   right under it - dense packing moves the stickers after it back up into the row they came from. */
.pf-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));grid-auto-flow:row dense;gap:14px 4px;margin:0;padding:0;list-style:none}
.pf-badge{display:flex;min-width:0}
.pf-stk{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:4px 0 2px;background:none;border:0;border-radius:12px;text-align:center;color:var(--ink)}
.pf-disc{position:relative;display:grid;place-items:center;width:54px;height:54px;border-radius:50%;transition:transform .14s ease;
  background:radial-gradient(closest-side,var(--surface) calc(100% - 6px),transparent calc(100% - 5px)),conic-gradient(var(--tier) calc(var(--p,0)*360deg),var(--line2) 0)}
.pf-emo{font-size:25px;line-height:1;filter:grayscale(1);opacity:.5}
.pf-badge.pf-on .pf-disc{background:radial-gradient(closest-side,var(--surface) calc(100% - 7px),transparent calc(100% - 6px)),var(--medal);box-shadow:0 0 0 2px var(--ink),2px 3px 0 2px var(--ink)}
.pf-badge.pf-on .pf-emo{filter:none;opacity:1}
.pf-badge.pf-on .pf-disc::after{content:'\\2713';position:absolute;right:-6px;bottom:-5px;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;
  background:var(--accent);color:var(--on-accent);box-shadow:0 0 0 2px var(--ink);font-size:12px;font-weight:900;line-height:1}
.pf-bn{font-size:12px;font-weight:700;line-height:1.2;color:var(--muted);overflow-wrap:break-word;hyphens:auto}
.pf-badge.pf-on .pf-bn{color:var(--ink)}
.pf-bp{font-size:12px;font-weight:700;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums}
.pf-stk[aria-expanded="true"] .pf-disc{outline:3px solid var(--accent-ink);outline-offset:4px}
.pf-bdetail{grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:12px 16px;border-radius:14px;background:var(--surface);border:2px solid var(--line);box-shadow:inset 5px 0 0 var(--tier)}
.pf-bdetail p{margin:0}
.pf-bemo{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--medal);box-shadow:0 0 0 2px var(--ink);font-size:25px;line-height:1}
.pf-bdetail.pf-locked .pf-bemo{background:var(--surface2);box-shadow:0 0 0 2px var(--line2)}
.pf-bdetail.pf-locked .pf-bemo span{filter:grayscale(1);opacity:.6}
.pf-btext{display:grid;gap:3px;min-width:0}
.pf-bname{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:22px;line-height:1.05;color:var(--ink)}
.pf-bmeta{font-size:13px;font-weight:700;color:var(--muted)}
.pf-tier{color:var(--tier)}
.pf-bhow{font-size:14.5px;line-height:1.35;color:var(--ink)}

/* Seasons by wins: one scale for every bar, 0 to 20 wins, a perfect season in lime. Phones get a bar
   per row, so every count fits beside its bar; wider screens get columns. */
.pf-chart{display:grid;gap:3px;margin:0;padding:0;list-style:none}
.pf-chart li{display:grid;grid-template-columns:22px minmax(0,1fr);align-items:center;gap:8px}
.pf-x{font-size:12px;font-weight:700;line-height:14px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums}
.pf-bin{display:flex;align-items:center;gap:6px;min-width:0;height:14px;border-left:1px solid var(--line2)}
.pf-bar{flex:none;width:calc(var(--v)*(100% - 46px));min-width:3px;height:10px;border-radius:0 4px 4px 0;background:var(--ink);
  transform-origin:left center;animation:pf-grow-x .5s cubic-bezier(.2,.7,.3,1) both}
.pf-n{font-size:12px;font-weight:700;line-height:1;white-space:nowrap;color:var(--ink);font-variant-numeric:tabular-nums}
.pf-chart .pf-perfect .pf-x{color:var(--ink)}
.pf-chart .pf-perfect .pf-bar{min-width:14px;background:var(--accent);box-shadow:inset 0 0 0 2px var(--ink)}
@keyframes pf-grow-x{from{transform:scaleX(0)}to{transform:none}}
@keyframes pf-grow-y{from{transform:scaleY(0)}to{transform:none}}

/* By mode: a stat table, the mode names pinned while the stats scroll on a phone. Separate borders,
   because collapsed ones don't travel with a sticky cell. */
.pf-scroll{overflow-x:auto;overscroll-behavior-x:contain;background:var(--bg)}
.pf-table{width:100%;border-collapse:separate;border-spacing:0;font-size:14px}
.pf-table th,.pf-table td{padding:10px 9px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}
.pf-table thead th,.pf-table thead td{vertical-align:bottom;border-bottom:2px solid var(--ink)}
.pf-table thead th{white-space:normal;font-size:12px;font-weight:800;line-height:1.25;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.pf-table td{font-weight:700;font-variant-numeric:tabular-nums}
.pf-table tbody th{text-align:left;font-family:var(--display);font-weight:400;font-size:19px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink)}
.pf-table .pf-stick{position:sticky;left:0;z-index:1;padding-left:0;padding-right:14px;background:var(--bg);box-shadow:inset -1px 0 0 var(--line)}
.pf-table tbody .pf-l-genius{color:var(--genius)}
.pf-table tbody .pf-l-gm{color:var(--gm)}

/* Go-to players and the most-drafted team */
.pf-rows{margin:0 0 14px;padding:0;list-style:none;border-top:2px solid var(--ink)}
.pf-rows li{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.pf-rk{font-family:var(--display);font-weight:400;font-size:24px;line-height:1;color:var(--muted)}
.pf-who{display:grid;gap:2px;min-width:0}
.pf-pn{font-weight:700;overflow-wrap:anywhere}
.pf-pt{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--muted)}
.pf-dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--tc1);box-shadow:0 0 0 2px var(--tc2)}
.pf-ct{font-size:14px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.pf-fav{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:var(--surface);border:2px solid var(--line)}
.pf-flag{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--tc1) 0 55%,var(--tc2) 55%);box-shadow:inset 0 0 0 2px var(--ink)}
.pf-k{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}

/* Records: a record book, label on the left and the number on the right */
.pf-book{margin:0;border-top:2px solid var(--ink)}
.pf-book>div{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid var(--line)}
.pf-book dt{min-width:0;font-size:14.5px;font-weight:600;color:var(--ink)}
.pf-book dt small{display:block;margin-top:2px;font-size:13px;font-weight:500;color:var(--muted)}
.pf-book dd{flex:none;margin:0;font-family:var(--display);font-weight:400;font-size:26px;line-height:1;white-space:nowrap;color:var(--ink)}
.pf-sec h3.h{margin-top:20px}
.pf-out{padding-top:14px;border-top:1px solid var(--line)}

@media (max-width:640px){
  .pf-card{gap:12px;padding:16px 14px 14px}
  .pf-head{gap:12px}
  .pf-name{font-size:clamp(27px,8.6vw,32px)}
  .pf-facts dd{font-size:21px}
  .pf-table th,.pf-table td{padding:9px 8px}
  .pf-book dd{font-size:23px}
}
/* A long name goes under the picture below 440px: beside it, 16 characters broke mid-word at 402-420px
   (412px is the commonest Android width). */
@media (max-width:440px){
  .pf-head.pf-long{flex-direction:column;align-items:flex-start}
}
/* A phone on its side: a shorter card, so its buttons are on the first screen. */
@media (max-height:500px) and (orientation:landscape){
  .pf-card{gap:8px;padding:12px 16px}
  .pf-name{font-size:30px}
  .pf-facts{padding-top:8px}
  .pf-facts dd{font-size:19px}
}
@media (min-width:641px){
  .pf-chart{grid-template-columns:repeat(21,minmax(0,1fr));align-items:stretch;gap:0 2px;height:210px}
  .pf-chart li{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) auto;align-items:stretch;gap:6px}
  .pf-x{grid-row:2;text-align:center}
  .pf-bin{grid-row:1;height:auto;flex-direction:column-reverse;justify-content:flex-start;gap:4px;border-left:0;border-bottom:1px solid var(--line2)}
  .pf-bar{width:min(24px,100%);min-width:0;height:calc(var(--v)*(100% - 22px));min-height:3px;border-radius:4px 4px 0 0;transform-origin:center bottom;animation-name:pf-grow-y}
  .pf-chart .pf-perfect .pf-bar{min-width:0;min-height:12px}
}
@media (hover:hover){
  .pf-stk:hover .pf-disc{transform:translateY(-2px) rotate(-4deg)}
}
@media (pointer:coarse){
  .pf-stk{position:relative;z-index:1;min-height:44px}
  .pf-select{min-height:44px}
}
@media (prefers-reduced-motion:reduce){
  .pf-bar{animation:none}
  .pf-disc{transition:none}
  .pf-stk:hover .pf-disc{transform:none}
}
`;

const TIER_LABEL = { bronze: "Bronze", silver: "Silver", gold: "Gold", special: "Special" };
const SHARE_STATUS = { shared: "Shared.", copied: "Link copied.", failed: "Couldn't share the link." };
const BIO_ERROR = {
  blocked: "That bio has a word we don't allow.",
  too_long: `Bios can be ${BIO_MAX} characters at most.`,
  invalid: "That couldn't be saved. Check your bio and try again.",
  signed_out: "You're logged out. Log in again to save.",
  network: "That didn't save. Check your connection and try again.",
};
const PICTURE_ERROR = {
  type: "That file isn't a picture we can use. Try a JPEG or PNG.",
  too_large: "That picture is too big. Try a smaller one.",
  paused: "Picture uploads are paused right now. Try again later.",
  invalid: "That picture couldn't be saved. Try another one.",
  signed_out: "You're logged out. Log in again to change your picture.",
  network: "That didn't save. Check your connection and try again.",
};
const EMPTY_DETAILS = { bio: "", avatarPath: null, avatarUrl: null, avatarPreset: null, favoriteTeam: null, updatedAt: null };
const EMPTY_EXTRA = mapPlayerStats(null);

const num = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
// City and nickname, skipping an empty part: Washington's city is blank, which read " Washington" and sorted
// it above Arizona.
const teamName = (code) => (TEAMS[code] ? [TEAMS[code][1], TEAMS[code][0]].filter(Boolean).join(" ") : code);
const teamStyle = (code) => (TEAMS[code] ? teamVars(code) : undefined);
const TEAM_OPTIONS = [...TEAM_CODES].sort((a, b) => teamName(a).localeCompare(teamName(b)));
// A chart label has a column's width to fit in, so big counts shorten (the list's hidden text has them in full).
const compact = (n) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n >= 9950 ? 0 : 1).replace(/\.0$/, "")}k`);
const monthYear = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" });

const pad2 = (n) => String(n).padStart(2, "0");
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
// A daily streak is only still going if the last daily was today or yesterday - the same test the Daily
// screen makes, through game-logic.mjs's nextStreak.
function liveStreak(s) {
  const today = todayKey();
  return s.dailyStreak && (s.dailyLast === today || nextStreak(s, today) > 1) ? s.dailyStreak : 0;
}
// The runs log started partway through the site's life, so an older account's first logged run can be
// later than the day it signed up. The earlier of the two is the closer answer.
function draftingSince(profile) {
  const times = [profile.extra?.since, profile.joined].map((t) => (t ? Date.parse(t) : NaN)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

export function ProfileScreen(props) {
  const { status, profile, onRetry } = props;
  if (status === "loading") return <p className="muted">Loading profile…</p>;
  if (status === "missing") return <div className="panel"><p className="pf-msg">There's no player with that name.</p></div>;
  if (status !== "ok" || !profile) {
    return (
      <div className="panel">
        <p className="pf-msg">The profile didn't load.</p>
        <div className="pf-msgact"><button className="btn" onClick={() => onRetry?.()}>Try again</button></div>
      </div>
    );
  }
  // Keyed by player, so an open editor, report or badge never carries over to someone else's profile.
  return <ProfileView key={profile.id ?? profile.username} {...props} />;
}

function ProfileView({ profile, isOwner, userId, rank, moderator, onShare, onDetailsSaved, onLogOut, onPlay, onOpenReports, wallet, onOpenShop }) {
  // A save shows on the screen straight away. The parent hears about it through onDetailsSaved and may
  // pass the new details back in; once it does, its copy is the one shown.
  const [saved, setSaved] = useState(null);
  const details = (saved && saved.base === profile.details ? saved.value : profile.details) || EMPTY_DETAILS;
  const s = profile.stats || {};
  const x = profile.extra || EMPTY_EXTRA;
  const progress = useMemo(() => badgeProgress({ stats: s, extra: x, details, joined: profile.joined }), [profile, details]);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(null);
  const drafted = draftsOf(s) > 0;

  async function share() {
    setShared(null); // cleared first, so the same result twice is announced twice
    setSharing(true);
    let result;
    try { result = await onShare?.(); } catch (e) { result = "failed"; }
    setSharing(false);
    setShared(SHARE_STATUS[result] ? result : null);
  }
  function detailsSaved(next) {
    setSaved({ base: profile.details, value: next });
    onDetailsSaved?.(next);
  }

  return (
    <section className="profile" data-username={profile.username} data-owner={isOwner ? "true" : "false"}>
      <PlayerCard profile={profile} details={details} progress={progress} isOwner={isOwner} signedIn={!!userId} moderator={moderator}
        drafted={drafted} editing={editing} reporting={reporting} sharing={sharing} shared={shared}
        onEdit={() => setEditing((v) => !v)} onReport={() => setReporting((v) => !v)} onShare={share} onOpenReports={() => onOpenReports?.()}
        wallet={isOwner ? wallet : null} onOpenShop={isOwner ? onOpenShop : null} />
      {isOwner && editing && (
        <ProfileEditor username={profile.username} details={details} userId={userId} onSaved={detailsSaved} onClose={() => setEditing(false)} />
      )}
      {!isOwner && userId && reporting && <ReportSheet username={profile.username} onClose={() => setReporting(false)} />}

      {drafted ? <HeadlineTiles s={s} rank={rank} /> : (
        <div className="panel">
          <p className="pf-msg">{isOwner ? "Play your first season to start your record." : "No seasons yet."}</p>
          {isOwner && <div className="pf-msgact"><button className="btn solid" onClick={() => onPlay?.()}>Go to the draft</button></div>}
        </div>
      )}
      <BadgeGrid progress={progress} />
      <WinsChart wins={x.wins} />
      <ModeTable ladders={x.byLadder} />
      {FORMATS.filter((f) => runOf(s, f)).map((f) => <BestLineup key={f} format={f} run={runOf(s, f)} />)}
      <GoToPlayers players={x.goToPlayers} teams={x.teamCounts} />
      <Records s={s} x={x} />
      <Minigames x={x} />
      <RecentDrafts recent={s.recent} />
      {isOwner && <div className="pf-out"><button className="btn" onClick={() => onLogOut?.()}>Log out</button></div>}
    </section>
  );
}

function PlayerCard({ profile, details, progress, isOwner, signedIn, moderator, drafted, editing, reporting, sharing, shared, onEdit, onReport, onShare, onOpenReports, wallet, onOpenShop }) {
  const s = profile.stats || {};
  const top = topBadges(progress, 3);
  const team = TEAMS[details.favoriteTeam] ? details.favoriteTeam : null;
  const since = drafted ? draftingSince(profile) : profile.joined ? Date.parse(profile.joined) : null;
  const streak = liveStreak(s);
  return (
    <CardTheme theme={details.cardTheme} team={team} className="pf-card">
      {/* A long name goes under the picture on a narrow phone rather than breaking beside it (Anton is
          about 0.45em a letter, so a dozen letters is where it stops fitting next to the picture). */}
      <div className={`pf-head${profile.username.length > 11 ? " pf-long" : ""}`}>
        <FramedAvatar className="pf-ring" frame={details.frame} team={team} username={profile.username} photoUrl={details.avatarUrl}
          preset={details.avatarPreset} size={84} decorative />
        <div className="pf-id">
          <h1 className="pf-name">{profile.username}</h1>
          <TitleLine title={details.title} />
          {team && (
            <p className="pf-team"><span className="pf-swatch" style={teamVars(team)} role="img" aria-label="Favorite team" />{teamName(team)}</p>
          )}
        </div>
      </div>
      {top.length > 0 && (
        <ul className="pf-tops" aria-label="Best badges">
          {top.map((b) => <li key={b.id} className={`pf-t-${b.tier}`}><span className="pf-e" aria-hidden="true">{b.emoji}</span>{b.name}</li>)}
        </ul>
      )}
      {details.bio && <p className="pf-bio">{details.bio}</p>}
      {(Number.isFinite(since) || streak > 0) && (
        <dl className="pf-facts">
          {Number.isFinite(since) && <div><dt>{drafted ? "Drafting since" : "Joined"}</dt><dd>{monthYear(since)}</dd></div>}
          {streak > 0 && <div><dt>Daily streak</dt><dd><span aria-hidden="true">🔥 </span>{streak}</dd></div>}
        </dl>
      )}
      <div className="pf-actions">
        {isOwner && <button className="btn" aria-expanded={editing} onClick={onEdit}>Edit profile</button>}
        {/* Lime for the one main action: sharing, unless an empty record's Go to the draft is on screen. */}
        <button className={`btn${drafted || !isOwner ? " solid" : ""}`} onClick={onShare} disabled={sharing}>Share profile</button>
        {!isOwner && signedIn && <button className="btn" aria-expanded={reporting} onClick={onReport}>Report</button>}
        {isOwner && moderator && <button className="btn" onClick={onOpenReports}>Reports ({num(moderator.openReports)})</button>}
        {isOwner && onOpenShop && <button className="btn" onClick={() => onOpenShop()}>Shop</button>}
        {isOwner && wallet && <Coins amount={wallet.balance} />}
        <span className={`pf-status${shared === "failed" ? " pf-bad" : ""}`} role="status">{shared ? SHARE_STATUS[shared] : ""}</span>
      </div>
    </CardTheme>
  );
}

function ProfileEditor({ username, details, userId, onSaved, onClose }) {
  const [bio, setBio] = useState(details.bio || "");
  const [team, setTeam] = useState(details.favoriteTeam || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text } from the last save
  const [picking, setPicking] = useState(false);
  const [picBusy, setPicBusy] = useState(false);
  const [picError, setPicError] = useState("");
  const id = useId();
  const panelRef = useRef(null);
  const pictureButton = useRef(null);
  const wasPicking = useRef(false);
  // The editor opens under the card, which on a phone (or one on its side) is below the screen - Edit profile
  // looked like it did nothing. Brought just into view, without animating.
  useEffect(() => { panelRef.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  // When the picker closes (a save or Cancel), focus goes back to the button that opened it, not the page.
  useEffect(() => {
    if (wasPicking.current && !picking) pictureButton.current?.focus?.();
    wasPicking.current = picking;
  }, [picking]);
  // Counted the way it will be saved (cleanBio: one line, trimmed), in code points like the database.
  const length = bioLength(cleanBio(bio));
  const over = length > BIO_MAX;
  const changed = cleanBio(bio) !== (details.bio || "") || (team || null) !== (details.favoriteTeam || null);

  async function save(e) {
    e.preventDefault();
    if (over || busy || !changed) return;
    setBusy(true);
    setMsg(null);
    const res = await saveProfile({ bio, favoriteTeam: team || null });
    setBusy(false);
    if (res?.ok) {
      onSaved(res.details);
      setBio(res.details.bio || "");
      setTeam(res.details.favoriteTeam || "");
      setMsg({ ok: true, text: "Saved." });
    } else {
      setMsg({ ok: false, text: BIO_ERROR[res?.reason] || BIO_ERROR.network });
    }
  }
  // Every picture change saves as soon as it's chosen; the picker closes once it has.
  const pictureSave = (run) => async (...args) => {
    setPicBusy(true);
    setPicError("");
    let res;
    try { res = await run(...args); } catch (e) { res = { ok: false, reason: "network" }; }
    setPicBusy(false);
    if (res?.ok) {
      onSaved(res.details);
      setPicking(false);
    } else {
      setPicError(PICTURE_ERROR[res?.reason] || PICTURE_ERROR.network);
    }
    return res;
  };

  return (
    <div className="panel pf-editor" ref={panelRef}>
      <div className="pf-field" role="group" aria-labelledby={`${id}-pic`}>
        <span className="pf-label" id={`${id}-pic`}>Picture</span>
        {picking ? (
          <AvatarPicker username={username} current={{ photoUrl: details.avatarUrl, preset: details.avatarPreset }} busy={picBusy} error={picError}
            onPhoto={pictureSave((blob) => saveAvatarPhoto(userId, blob, details.avatarPath))}
            onPreset={pictureSave((key) => setAvatarPreset(key, details.avatarPath))}
            onRemove={pictureSave(() => removeAvatar(details.avatarPath))}
            onCancel={() => { setPicking(false); setPicError(""); }} />
        ) : (
          <div className="pf-pic">
            <Avatar username={username} photoUrl={details.avatarUrl} preset={details.avatarPreset} size={64} />
            <button type="button" className="btn" ref={pictureButton} onClick={() => setPicking(true)}>{details.avatarUrl || details.avatarPreset ? "Change picture" : "Add a picture"}</button>
          </div>
        )}
      </div>
      {/* The picker stays outside the form, so none of its buttons can submit the bio. */}
      <form className="pf-form" onSubmit={save}>
        <div className="pf-field">
          <label className="pf-label" htmlFor={`${id}-bio`}>Bio</label>
          {/* A bio is one line, so Enter doesn't start another (it still finishes typing in an input method). */}
          <textarea id={`${id}-bio`} className="pf-text" rows={3} value={bio} aria-describedby={`${id}-count`} aria-invalid={over || undefined}
            onChange={(e) => { setBio(e.target.value); setMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault(); }} />
          <span id={`${id}-count`} className={`pf-count${over ? " pf-over" : ""}`}>{length}/{BIO_MAX}</span>
        </div>
        <div className="pf-field">
          <label className="pf-label" htmlFor={`${id}-team`}>Favorite team</label>
          <span className="pf-teampick">
            {TEAMS[team] && <span className="pf-swatch" style={teamVars(team)} aria-hidden="true" />}
            <select id={`${id}-team`} className="pf-select" value={team} onChange={(e) => { setTeam(e.target.value); setMsg(null); }}>
              <option value="">No favorite</option>
              {TEAM_OPTIONS.map((code) => <option key={code} value={code}>{teamName(code)}</option>)}
            </select>
          </span>
        </div>
        {msg && <p className={msg.ok ? "pf-saved" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        <div className="frow">
          <button type="submit" className="btn solid" disabled={over || busy || !changed}>{busy ? "Saving…" : "Save"}</button>
          <button type="button" className="btn" onClick={onClose}>{changed ? "Cancel" : "Done"}</button>
        </div>
      </form>
    </div>
  );
}

function HeadlineTiles({ s, rank }) {
  const rankNote = (r) => (r ? `, ${r === 1 ? "👑 " : ""}#${num(r)} sitewide` : "");
  const tiles = [
    { k: "drafts", n: num(draftsOf(s)), l: `Drafts${s.dnf ? `, ${num(s.dnf)} DNF` : ""}` },
    { k: "champs", n: num(s.champs), l: "Championships" },
    { k: "perfect", n: num(s.perfect), l: "Perfect seasons" },
    { k: "playoffs", n: s.runs ? `${Math.round((100 * (s.playoffs || 0)) / s.runs)}%` : "–", l: "Made the playoffs" },
    ...FORMATS.filter((f) => scoreOf(s, f) != null).map((f) => ({ k: f, n: Number(scoreOf(s, f)).toFixed(1), l: `Best ${FORMAT_LABEL[f]} score${rankNote(rank?.[f])}` })),
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => <div className="tile" key={t.k}><div className="n">{t.n}</div><div className="l">{t.l}</div></div>)}
    </div>
  );
}

function BadgeGrid({ progress }) {
  const [open, setOpen] = useState(null);
  const id = useId();
  // A badge in the bottom row opens its details below the screen on a phone; bring them just into view.
  const detailRef = useRef(null);
  useEffect(() => { if (open) detailRef.current?.scrollIntoView?.({ block: "nearest" }); }, [open]);
  const earned = progress.filter((p) => p.earned).length;
  return (
    <div className="pf-sec">
      <div className="pf-hd"><h2 className="h">Badges</h2><span className="pf-meta">{earned} of {progress.length}</span></div>
      <ul className="pf-badges">
        {progress.map((p) => {
          const b = BADGE_BY_ID[p.id];
          if (!b) return null;
          const counted = p.need > 1;
          const isOpen = open === p.id;
          const status = p.earned ? "Earned" : counted ? `${num(p.have)} of ${num(p.need)}` : "Not earned yet";
          return (
            <Fragment key={p.id}>
              <li className={`pf-badge pf-t-${b.tier}${p.earned ? " pf-on" : ""}`} data-badge={p.id} data-earned={p.earned ? "true" : "false"}
                style={{ "--p": p.earned ? 1 : Math.min(1, p.have / p.need) }}>
                {/* The name a screen reader hears carries what the colors and the ring show. */}
                <button type="button" className="pf-stk" aria-label={`${b.name}, ${TIER_LABEL[b.tier]}, ${status.toLowerCase()}`}
                  aria-expanded={isOpen} aria-controls={isOpen ? `${id}-${p.id}` : undefined} onClick={() => setOpen(isOpen ? null : p.id)}>
                  <span className="pf-disc" aria-hidden="true"><span className="pf-emo">{b.emoji}</span></span>
                  <span className="pf-bn">{b.name}</span>
                  {!p.earned && counted && <span className="pf-bp">{num(p.have)}/{num(p.need)}</span>}
                </button>
              </li>
              {isOpen && (
                <li ref={detailRef} className={`pf-bdetail pf-t-${b.tier}${p.earned ? "" : " pf-locked"}`} id={`${id}-${p.id}`}>
                  <span className="pf-bemo" aria-hidden="true"><span>{b.emoji}</span></span>
                  <div className="pf-btext">
                    <p className="pf-bname">{b.name}</p>
                    <p className="pf-bmeta"><span className="pf-tier">{TIER_LABEL[b.tier]}</span> · {status}</p>
                    <p className="pf-bhow">{b.how}</p>
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ul>
    </div>
  );
}

function WinsChart({ wins }) {
  const counts = Array(21).fill(0);
  for (const r of wins || []) if (r.w >= 0 && r.w <= 20) counts[r.w] += r.n;
  const max = Math.max(...counts);
  if (max <= 0) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  // Read out as one picture with every count in full, rather than 21 bars of numbers without context.
  const summary = counts.map((n, w) => (n ? `${w} ${w === 1 ? "win" : "wins"}, ${plural(n, "season")}` : null)).filter(Boolean).join("; ");
  return (
    <div className="pf-sec">
      <div className="pf-hd"><h2 className="h">Seasons by wins</h2><span className="pf-meta">{plural(total, "season")}</span></div>
      <div role="img" aria-label={`Seasons by wins: ${summary}`}>
        <ol className="pf-chart">
          {counts.map((n, w) => (
            <li key={w} className={w === 20 ? "pf-perfect" : undefined} style={{ "--v": n / max }}>
              <span className="pf-x">{w}</span>
              <span className="pf-bin">
                {n > 0 && <span className="pf-bar" />}
                {n > 0 && <span className="pf-n">{compact(n)}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// A row per mode played and a column per stat, most telling first. On a phone the mode names stay put
// while the stats scroll sideways, like any sports site's stat table.
function ModeTable({ ladders }) {
  const rows = (ladders || []).filter((r) => r.seasons + r.dnf > 0);
  if (!rows.length) return null;
  const score = (v) => (v != null ? Number(v).toFixed(1) : "–");
  const cols = [
    ["Seasons", (r) => num(r.seasons)],
    ["Record", (r) => `${num(r.wins)}–${num(r.losses)}`],
    ["Titles", (r) => num(r.champs)],
    ["Playoffs", (r) => num(r.playoffs)],
    rows.some((r) => r.perfect) && ["Perfect", (r) => num(r.perfect)],
    rows.some((r) => r.dnf) && ["DNF", (r) => num(r.dnf)],
    rows.some((r) => r.bestScore != null) && [`Best ${FORMAT_LABEL.fantasy}`, (r) => score(r.bestScore)],
    rows.some((r) => r.bestScoreStd != null) && [`Best ${FORMAT_LABEL.standard}`, (r) => score(r.bestScoreStd)],
  ].filter(Boolean);
  return (
    <div className="pf-sec">
      <h2 className="h">By mode</h2>
      <div className="pf-scroll">
        <table className="pf-table">
          <thead>
            <tr><td className="pf-stick" />{cols.map(([label]) => <th scope="col" key={label}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ladder}>
                <th scope="row" className={`pf-stick pf-l-${r.ladder}`}>{LADDER_LABEL[r.ladder] || r.ladder}</th>
                {cols.map(([label, value]) => <td key={label}>{value(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BestLineup({ format, run }) {
  const summary = [`${run.w}–${run.l}`, `team score ${Number(run.score).toFixed(1)}`, run.date ? fmtDate(run.date) : null].filter(Boolean).join(", ");
  return (
    <div className="pf-sec">
      <h2 className="h">Best {FORMAT_LABEL[format]} lineup</h2>
      <p className="note" style={{ marginTop: 0 }}>{summary}. {outcomeSentence(run.outcome)}</p>
      {Array.isArray(run.roster) && run.roster.length > 0 && <RosterRows roster={run.roster} />}
    </div>
  );
}

function GoToPlayers({ players, teams }) {
  const top = (players || []).slice(0, 5);
  const fav = (teams || []).find((t) => t.count > 0);
  if (!top.length && !fav) return null;
  return (
    <div className="pf-sec">
      <h2 className="h">Go-to players</h2>
      {top.length > 0 && (
        <ol className="pf-rows">
          {top.map((p, i) => (
            <li key={`${p.name}|${p.season}|${p.team}`}>
              <span className="pf-rk">{i + 1}</span>
              <span className="pf-who">
                <span className="pf-pn">{p.name}</span>
                <span className="pf-pt"><span className="pf-dot" style={teamStyle(p.team)} aria-hidden="true" />{p.season} {TEAMS[p.team]?.[0] ?? p.team}</span>
              </span>
              <span className="pf-ct">{plural(p.count, "draft")}</span>
            </li>
          ))}
        </ol>
      )}
      {fav && (
        <div className="pf-fav" style={teamStyle(fav.team)}>
          <span className="pf-flag" aria-hidden="true" />
          <span className="pf-who"><span className="pf-k">Most-drafted team</span><span className="pf-pn">{teamName(fav.team)}</span></span>
          <span className="pf-ct">{plural(fav.count, "pick")}</span>
        </div>
      )}
    </div>
  );
}

function Records({ s, x }) {
  const rows = [];
  const add = (k, label, value, detail, emoji) => rows.push({ k, label, value, detail, emoji });
  if (s.bestRecord) add("record", "Best record", `${s.bestRecord.w}–${s.bestRecord.l}`);
  if (s.dailyBestStreak > 0) add("streak", "Longest daily streak", plural(s.dailyBestStreak, "day"), null, "🔥");
  if (x.bestPoints != null) add("points", "Most points in one draft", num(x.bestPoints), null, "⚡");
  const d = x.dailies || {};
  if (d.bestRank != null) add("rank", "Best daily finish", `#${num(d.bestRank)}`, `${plural(d.played, "daily", "dailies")} played`, d.bestRank === 1 ? "👑" : null);
  if (d.bestScore != null) add("daily", "Best daily score", Number(d.bestScore).toFixed(1), d.bestW != null ? `${d.bestW}–${d.bestL}` : null);
  for (const f of FORMATS) {
    const u = x.byFormat?.[f]?.biggestUpset;
    if (u) add(`upset-${f}`, `Biggest ${FORMAT_LABEL[f]} upset`, u.score.toFixed(1), `${u.w}–${u.l}${u.ladder && u.ladder !== "unlimited" ? `, ${LADDER_LABEL[u.ladder] || u.ladder}` : ""}`, "🚨");
  }
  for (const f of FORMATS) {
    const g = x.byFormat?.[f]?.bestGm;
    if (g) add(`gm-${f}`, `Best ${FORMAT_LABEL[f]} GM score`, g.score.toFixed(1), `${g.w}–${g.l}`);
  }
  // Ladder totals only: the points bank belongs to the shop, which isn't open yet.
  const ladders = LADDERS.filter((l) => Math.round(s.points?.[l] || 0) !== 0);
  if (!rows.length && !ladders.length) return null;
  return (
    <div className="pf-sec">
      <h2 className="h">Records</h2>
      {rows.length > 0 && (
        <dl className="pf-book">
          {rows.map((r) => (
            <div key={r.k}>
              <dt>{r.emoji && <span aria-hidden="true">{r.emoji} </span>}{r.label}{r.detail && <small>{r.detail}</small>}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {ladders.length > 0 && (
        <>
          <h3 className="h">Ladder points</h3>
          <div className="tiles">
            {ladders.map((l) => <div className="tile" key={l}><div className="n">{num(Math.round(s.points[l]))}</div><div className="l">{LADDER_LABEL[l]} ladder</div></div>)}
          </div>
        </>
      )}
    </div>
  );
}

function Minigames({ x }) {
  const ou = x.overUnder || {};
  const b = x.builds || {};
  const tiles = [];
  if (ou.played > 0) tiles.push({ k: "ou", n: ou.best != null ? num(ou.best) : "–", l: `Best Over/Under score, ${num(ou.played)} played` });
  if (b.count > 0) tiles.push({ k: "built", n: num(b.count), l: "Players created" });
  if (b.best) tiles.push({ k: "build", n: grade(b.best.overall), cls: gradeTier(b.best.overall), l: `Best build: ${b.best.pos}, ${Number(b.best.overall).toFixed(1)} OVR` });
  if (!tiles.length) return null;
  return (
    <div className="pf-sec">
      <h2 className="h">Minigames</h2>
      <div className="tiles">
        {tiles.map((t) => <div className="tile" key={t.k}><div className={`n${t.cls ? ` ${t.cls}` : ""}`}>{t.n}</div><div className="l">{t.l}</div></div>)}
      </div>
    </div>
  );
}

// Every draft, abandoned ones included, the way the account screen has always listed them.
function RecentDrafts({ recent }) {
  if (!recent?.length) return null;
  return (
    <div className="pf-sec">
      <h2 className="h">Recent drafts</h2>
      <div className="recent">
        {recent.map((r, i) => r.dnf ? (
          <div className="rr dnf" key={i}>
            <span className="muted">{r.date ? fmtDate(r.date) : ""}</span>
            <span className="rec2">DNF</span>
            <span className="muted">Reset {r.picks ? `after ${r.picks} pick${r.picks > 1 ? "s" : ""}` : "before the first pick"}</span>
            <span className="sc2 muted">–</span>
          </div>
        ) : (
          <div className="rr" key={i}>
            <span className="muted">{r.date ? fmtDate(r.date) : ""}</span>
            <span className="rec2">{r.w}–{r.l}</span>
            <span>{r.mode === "daily" ? "Daily: " : ""}{r.outcome}</span>
            <span className="sc2 muted">{r.score != null ? Number(r.score).toFixed(1) : "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
