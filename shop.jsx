// The shop and the wallet: cosmetics bought with coins and worn on your player card. Contract: SHOP.md (7.2).
// Classes are prefixed sh-.
//
// Props:
//   userId, username         the signed-in player
//   onBack()                 leave the shop
//   onDetailsSaved(details)  after an equip or showcase save (mapDetails shape)
//   onBalance(balance)       whenever the balance loads or changes
// Test hooks: the root is <section class="shop" data-balance=...>, with no data-balance until the shop has
// loaded; the tabs are buttons named by KIND_LABEL plus "Showcase"; each item is <article class="sh-item"
// data-item=... data-state="equipped|owned|buy|short|locked"> whose first button selects it, and the selected
// item's article holds its actions, buttons named "Buy", "Confirm purchase", "Equip" and "Take off"; the
// showcase is input[name="showcase"] checkboxes and a "Save showcase" button.
import { useEffect, useId, useRef, useState } from "react";
import { fetchShop, fetchWallet, fetchPlayerProfile, buyItem, equipItem, setShowcase } from "./storage.js";
import { SHOP_KINDS, KIND_LABEL, SHOP_ITEM_BY_ID, DEFAULT_ITEM, SHOWCASE_MAX, RARITY_LABEL, PACK_BY_ITEM } from "./shop-catalog.mjs";
import { BADGES, BADGE_BY_ID, badgeProgress } from "./badges.mjs";
import { Avatar } from "./avatars.jsx";
import { FramedAvatar, CardTheme, TitleLine, Coins, ItemPreview } from "./cosmetics.jsx";
import { cardBadges } from "./profile.jsx";
import { fmtDate } from "./ui-common.jsx";
import { TEAMS } from "./game-logic.mjs";

export const SHOP_CSS = `
/* ===== shop ===== */
/* A card shop: your player card in a display case, the stock as sleeved cards edged in their rarity, and a
   ledger of coins. Lime stays a fill - the one main action (Buy, Confirm purchase, Equip, Save showcase) and
   the Preview and Equipped tags. The card previews take their paint and text colors from their card theme. */
.sh-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 18px}
.sh-title{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(52px,9vw,72px);line-height:.85;letter-spacing:.01em;color:var(--ink)}
.sh-body{display:grid;gap:24px}
.sh-stage{display:grid;gap:12px;align-content:start;min-width:0}

/* The display case: a spotlit shelf with a label strip, like a graded card's slab. */
.sh-case{display:grid;gap:10px;min-width:0;padding:10px 10px 12px;border-radius:22px;
  background:radial-gradient(ellipse 75% 65% at 50% 18%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 72%),var(--surface2);
  box-shadow:inset 0 0 0 2px var(--line2)}
.sh-label{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:22px;margin:0;padding:0 6px;
  font-size:12px;font-weight:800;letter-spacing:.08em;line-height:1.2;text-transform:uppercase;color:var(--muted)}
.sh-try{padding:3px 9px;border-radius:999px;background:var(--accent);color:var(--on-accent);box-shadow:0 0 0 1.5px var(--ink)}
/* Card previews: layout only, laid out like the profile card - picture and name, then the badges. */
.sh-card{display:grid;gap:12px;min-width:0;padding:16px 16px 16px 14px;border-radius:16px}
.sh-card>*,.sh-mini>*{position:relative}
/* A name too long to sit beside the picture wraps under it instead of breaking mid-word ("longestname_1 / 234" on a
   320px phone, 16 capitals in the 330px case beside the stock on a tablet). Only a name wider than the whole card
   still breaks. */
.sh-head{display:flex;flex-wrap:wrap;align-items:center;gap:14px;min-width:0}
.sh-who{display:grid;gap:4px;min-width:0}
.sh-name{margin:0;font-family:var(--display);font-weight:400;font-size:32px;line-height:.95;color:var(--ink);overflow-wrap:anywhere}
.sh-long .sh-name{font-size:24px}
.sh-badges{display:flex;flex-wrap:wrap;gap:5px;margin:0;padding:0;list-style:none}
.sh-badges li{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:3px 10px 3px 3px;border-radius:999px;background:var(--surface2);
  box-shadow:inset 0 0 0 1.5px var(--tier);font-size:12px;font-weight:700;line-height:1.2;color:var(--ink)}
.sh-e{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--medal);font-size:13px;line-height:1}
.sh-t-bronze{--tier:var(--tier-bronze);--medal:var(--tier-bronze-fill)}
.sh-t-silver{--tier:var(--tier-silver);--medal:var(--tier-silver-fill)}
.sh-t-gold{--tier:var(--tier-gold);--medal:var(--tier-gold-fill)}
.sh-t-special{--tier:var(--tier-special);--medal:var(--tier-special-fill)}
.sh-pack{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
/* At least the 12px CardTheme asks for: a theme's trim (Team colors' stripes, the ticket's tear line, the gold bands)
   is in its outer 10px, and at 9px it ran under the picture's frame. */
.sh-mini{display:grid;min-width:0;padding:12px 16px 12px 12px;border-radius:12px}
.sh-mini .sh-head{gap:10px}
.sh-mini .sh-name{font-size:22px}
.sh-mini.sh-long .sh-name{font-size:18px}
.sh-bal{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0;padding:9px 14px 9px 16px;border-radius:14px;
  background:var(--surface);border:2px solid var(--ink);box-shadow:3px 3px 0 var(--hard)}
.sh-k{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sh-coins{font-family:var(--display);font-weight:400;font-size:30px;line-height:1}

/* Tabs and the stock */
.sh-shelf{display:grid;gap:14px;align-content:start;min-width:0}
.sh-tabs{display:flex;flex-wrap:wrap;gap:6px}
.sh-tab{padding:7px 14px;border:2px solid var(--line2);border-radius:999px;background:var(--surface);color:var(--muted);
  font-weight:700;font-size:14px;line-height:1.2;white-space:nowrap;transition:color .12s,border-color .12s}
.sh-tab.sh-on{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.sh-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(146px,1fr));grid-auto-flow:row dense;gap:12px}
/* An item's article has no box of its own: its tile is a grid cell, and its details, once it's selected, are a
   full-width row right under that tile's row (dense packing moves the tiles after it back up beside it). */
.sh-item{display:contents}
.sh-r-free{--rar:var(--line2)}
.sh-r-common{--rar:var(--muted)}
.sh-r-rare{--rar:var(--blue)}
.sh-r-epic{--rar:var(--violet)}
.sh-r-legendary{--rar:var(--tier-gold-fill)}
.sh-r-badge{--rar:var(--orange)}
.sh-tile{position:relative;display:grid;grid-template-areas:"win" "pick" "info" "bar";align-content:start;min-width:0;padding:7px 7px 12px;
  border-radius:16px;background:var(--surface);border:2px solid var(--ink);box-shadow:3px 3px 0 var(--hard);transition:transform .12s ease,box-shadow .12s ease}
.sh-tile:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--hard)}
.sh-tile.sh-open{box-shadow:0 0 0 3px var(--accent-ink),4px 4px 0 3px var(--hard)}
.sh-win{grid-area:win;position:relative;display:grid;place-items:center;height:96px;margin:0 0 8px;border-radius:10px;overflow:hidden;
  background:radial-gradient(ellipse 90% 85% at 50% 0%,color-mix(in srgb,var(--rar) 30%,transparent),transparent 75%),var(--surface2);
  box-shadow:inset 0 4px 0 var(--rar)}
.sh-r-legendary .sh-win{background:radial-gradient(ellipse 90% 85% at 50% 0%,color-mix(in srgb,var(--tier-gold-fill) 42%,transparent),transparent 75%),var(--surface2);
  box-shadow:inset 0 4px 0 var(--tier-gold-fill),inset 0 5px 0 var(--orange)}
/* The name is the button; its hit area covers the whole tile, above the preview and tags. */
.sh-pick{grid-area:pick;justify-self:stretch;min-width:0;margin:0;padding:0 5px;background:none;border:0;border-radius:0;text-align:left;
  font-family:var(--display);font-weight:400;font-size:21px;line-height:1.05;text-transform:uppercase;letter-spacing:.01em;color:var(--ink);overflow-wrap:anywhere}
.sh-pick::after{content:'';position:absolute;z-index:1;inset:-2px;border-radius:16px}
.sh-tile .sh-pick:focus-visible{outline:none}
.sh-tile .sh-pick:focus-visible::after{outline:3px solid var(--accent-ink);outline-offset:3px}
.sh-info{grid-area:info;display:flex;flex-wrap:wrap;align-items:center;gap:3px 10px;margin-top:6px;padding:0 5px;font-size:13px;font-weight:700;line-height:1.3;color:var(--muted)}
.sh-rar{display:inline-flex;align-items:center;gap:6px}
.sh-rar::before{content:'';flex:none;width:7px;height:7px;border-radius:1px;transform:rotate(45deg);background:var(--rar);box-shadow:0 0 0 1.5px var(--ink)}
.sh-price{color:var(--ink)}
.sh-line{flex-basis:100%;font-weight:600;color:var(--ink)}
/* In the price's place: an owned item has no price, and a corner tag covered the preview on narrow tiles. */
.sh-tag{padding:2px 8px;border-radius:999px;font-size:12px;font-weight:800;line-height:1.2;letter-spacing:.04em;text-transform:uppercase}
.sh-tag-equipped{background:var(--accent);color:var(--on-accent);box-shadow:0 0 0 1.5px var(--ink)}
.sh-tag-owned{background:var(--surface);color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink)}
.sh-bar{grid-area:bar;display:block;height:6px;margin:8px 5px 0;border-radius:999px;background:var(--line);overflow:hidden}
.sh-bar::before{content:'';display:block;width:calc(var(--p,0)*100%);height:100%;border-radius:inherit;background:var(--accent-ink)}
.sh-item[data-state="locked"] .sh-win>:not(.sh-lock){filter:grayscale(1);opacity:.4}
.sh-lock{position:absolute;right:8px;bottom:8px;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--medal);
  box-shadow:0 0 0 2px var(--ink);font-size:17px;line-height:1}

/* The selected item's details and actions */
.sh-detail{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:14px 18px;min-width:0;padding:15px 16px 16px;border-radius:16px;
  background:var(--surface);border:2px solid var(--ink);box-shadow:inset 0 5px 0 var(--rar),3px 3px 0 var(--hard)}
.sh-tryon{display:none;min-width:0}
.sh-dmain{flex:1 1 200px;display:grid;justify-items:start;gap:9px;min-width:0}
.sh-dhead{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:0}
.sh-dname{font-family:var(--display);font-weight:400;font-size:26px;line-height:1;text-transform:uppercase;color:var(--ink);overflow-wrap:anywhere}
.sh-dprice{font-size:16px}
.sh-dline{display:flex;align-items:center;gap:8px;margin:0;font-size:14.5px;font-weight:600;line-height:1.35;color:var(--ink)}
.sh-dline b{font-weight:800}
.sh-medal{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--medal);box-shadow:0 0 0 2px var(--ink);font-size:15px;line-height:1}
.sh-acts{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.sh-msg{margin:0;font-size:14px;font-weight:700;color:var(--win)}
.sh-msg:empty{margin-top:-9px}
.sh-msg.sh-bad{color:var(--loss)}

/* Showcase: earned badges as stickers to pick, numbered in the order they'll sit on the card. The checkbox
   covers its sticker, so the whole sticker is the target. */
.sh-show{display:grid;gap:14px;min-width:0;margin:0;padding:0;border:0}
.sh-legend{margin:0 0 10px;padding:0;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sh-chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.sh-chip{position:relative;display:flex;align-items:center;gap:10px;min-width:0;min-height:48px;padding:6px 10px 6px 6px;border-radius:999px;
  background:var(--surface);border:2px solid var(--line2);font-size:14px;font-weight:700;line-height:1.2;color:var(--ink);cursor:pointer;transition:border-color .12s}
.sh-chip input{position:absolute;inset:0;z-index:1;width:100%;height:100%;margin:0;opacity:0;font-size:16px;cursor:inherit}
.sh-chip .sh-e{width:32px;height:32px;font-size:18px}
.sh-bn{min-width:0;overflow-wrap:anywhere}
.sh-ord{flex:none;display:grid;place-items:center;width:26px;height:26px;margin-left:auto;border-radius:50%;background:var(--accent);color:var(--on-accent);font-size:14px;font-weight:800}
.sh-chip.sh-on{background:var(--ink);border-color:var(--ink);color:var(--bg);box-shadow:2px 2px 0 var(--hard)}
.sh-chip:has(input:disabled){opacity:.45;cursor:default}
.sh-chip:has(input:focus-visible){outline:3px solid var(--accent-ink);outline-offset:3px}
.sh-count{font-size:13px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.sh-empty{display:grid;justify-items:start;gap:10px;margin:0;font-size:14.5px;color:var(--muted)}

/* The wallet: three figures and a ledger */
.sh-wallet{display:grid;gap:12px;min-width:0}
.sh-wallet h2.h{margin:0}
.sh-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0}
.sh-sum>div{min-width:0;padding:9px 2px 0;border-top:3px solid var(--ink)}
.sh-sum dt{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.sh-sum dd{margin:6px 0 0;font-family:var(--display);font-weight:400;font-size:28px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
/* The balance's coin goes above its number when the column is too narrow for both: a six-figure balance ran into
   Earned beside it on a phone, and a seven-figure one on a tablet. */
.sh-sumcoins{flex-wrap:wrap;row-gap:4px}
.sh-ledgers{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
.sh-ledger{display:grid;grid-template-columns:minmax(72px,auto) minmax(0,1fr) auto;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14.5px}
.sh-amt{font-family:var(--display);font-weight:400;font-size:20px;line-height:1;color:var(--win);font-variant-numeric:tabular-nums}
.sh-amt.sh-neg{color:var(--ink)}
.sh-dot{display:none}
.sh-why{min-width:0;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.sh-when{font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap}

/* Wide enough for two columns: the case stays in view beside the stock while you browse. */
@media (min-width:760px){
  .sh-body{grid-template-columns:minmax(0,330px) minmax(0,1fr);align-items:start;column-gap:28px}
  .sh-stage{grid-row:span 2;position:sticky;top:calc(16px + var(--sa-top,0px))}
}
/* One column: the case is above the fold only at the top, so the selected item's details carry a small copy of
   the card wearing it. */
@media (max-width:759px){
  .sh-tryon{display:block}
}
@media (max-width:640px){
  .sh-top{margin-bottom:14px}
  .sh-name{font-size:28px}
  .sh-long .sh-name{font-size:22px}
  .sh-coins{font-size:26px}
  .sh-sum dd{font-size:23px}
  .sh-detail{padding:13px 12px 14px}
}
@media (max-width:400px){
  .sh-items{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .sh-pick{font-size:19px}
  .sh-sum{gap:8px}
  .sh-ledger{gap:10px}
}
@media (hover:hover){
  .sh-tile:hover{transform:translate(-1px,-2px);box-shadow:5px 6px 0 var(--hard)}
  .sh-tile.sh-open:hover{box-shadow:0 0 0 3px var(--accent-ink),6px 7px 0 3px var(--hard)}
  /* A mouse presses while it hovers, so the press has to come after the lift to show (as .btn's does). */
  .sh-tile:active{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--hard)}
  .sh-tab:hover:not(.sh-on){color:var(--ink);border-color:var(--ink)}
  .sh-chip:hover:not(.sh-on){border-color:var(--ink)}
}
@media (pointer:coarse){
  .sh-tab{min-height:44px;position:relative;z-index:1}
  .sh-pick{min-height:44px}
}
@media (prefers-reduced-motion:reduce){
  .sh-tile,.sh-tab,.sh-chip{transition:none}
  .sh-tile:hover,.sh-tile:active{transform:none}
}
`;

const TABS = [...SHOP_KINDS, "showcase"];
const TAB_LABEL = { ...KIND_LABEL, showcase: "Showcase" };
const FAILED = "That didn't go through. Try again.";
const SIGNED_OUT = "You're logged out. Log in again.";

const num = (n) => Number(n || 0).toLocaleString("en-US");
const itemName = (id) => SHOP_ITEM_BY_ID[id]?.name || id;
// What a slot wears: null in the database means the slot's default.
const worn = (equipped, slot) => equipped?.[slot] ?? DEFAULT_ITEM[slot];
// Only items this build knows how to draw: one added to shop_items before the browser has its look stays hidden.
const drawable = (item) => SHOP_ITEM_BY_ID[item?.id]?.kind === item?.kind;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// A long name takes a smaller size in a card preview rather than breaking mid-word.
const longName = (name) => String(name || "").length > 12;

// equipped (it's worn), owned, buy (you can afford it), short (you can't yet) or locked (a badge item you don't have).
export function itemState(item, shop) {
  if (item.owned) return item.kind !== "avatar_pack" && worn(shop.equipped, item.kind) === item.id ? "equipped" : "owned";
  if (item.badge) return "locked";
  return shop.balance >= (item.price || 0) ? "buy" : "short";
}

// A wallet ledger row in words, from its kind and ref (SHOP.md 3).
export function ledgerLabel(entry) {
  const { kind, ref } = entry || {};
  if (kind === "starting") return "Starting balance";
  if (kind === "welcome") return "Welcome coins";
  if (kind === "daily") return "Daily";
  if (kind === "season") return "Season";
  if (kind === "badge") return `${BADGE_BY_ID[ref]?.name || ref} badge`;
  if (kind === "minigame") {
    const game = String(ref || "").split(":")[0];
    return game === "build" ? "Build-a-player" : game === "over_under" ? "Over/Under" : "Minigame";
  }
  if (kind === "purchase") return itemName(ref);
  return kind || "";
}

export function WalletPanel({ wallet }) {
  const id = useId();
  if (!wallet) return null;
  const recent = Array.isArray(wallet.recent) ? wallet.recent : [];
  return (
    <section className="sh-wallet" aria-labelledby={`${id}-h`}>
      <h2 className="h" id={`${id}-h`}>Coins</h2>
      <dl className="sh-sum">
        <div><dt>Balance</dt><dd><Coins amount={wallet.balance} size={20} className="sh-sumcoins" /></dd></div>
        <div><dt>Earned</dt><dd>{num(wallet.earned)}</dd></div>
        <div><dt>Spent</dt><dd>{num(wallet.spent)}</dd></div>
      </dl>
      {recent.length > 0 && (
        <ol className="sh-ledgers" aria-label="Recent coins">
          {recent.map((e, i) => (
            <li className="sh-ledger" key={`${e.kind}:${e.ref}:${i}`}>
              <span className={`sh-amt${e.amount < 0 ? " sh-neg" : ""}`}>{e.amount < 0 ? "−" : "+"}{num(Math.abs(e.amount))}</span>
              <span className="sh-dot" aria-hidden="true"> · </span>
              <span className="sh-why">{ledgerLabel(e)}</span>
              {e.createdAt && Number.isFinite(Date.parse(e.createdAt)) && <time className="sh-when" dateTime={e.createdAt}>{fmtDate(e.createdAt)}</time>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Your player card as it would look: `wear` is { frame, card, title }.
function CardPreview({ username, details, team, wear, badges = [], compact = false }) {
  return (
    <CardTheme theme={wear.card} team={team} className={`${compact ? "sh-mini" : "sh-card"}${longName(username) ? " sh-long" : ""}`}>
      <div className="sh-head">
        <FramedAvatar frame={wear.frame} team={team} size={compact ? 44 : 72} username={username} photoUrl={details?.avatarUrl ?? null}
          preset={details?.avatarPreset ?? null} decorative />
        <div className="sh-who">
          <p className="sh-name">{username}</p>
          <TitleLine title={wear.title} />
        </div>
      </div>
      {!compact && badges.length > 0 && (
        <ul className="sh-badges">
          {badges.map((b) => <li key={b.id} className={`sh-t-${b.tier}`} data-badge={b.id}><span className="sh-e" aria-hidden="true">{b.emoji}</span>{b.name}</li>)}
        </ul>
      )}
    </CardTheme>
  );
}

// An avatar pack's pictures, named for screen readers.
function PackStrip({ pack, size }) {
  return (
    <span className="sh-pack" role="img" aria-label={pack.presets.map((p) => p.name).join(", ")}>
      {pack.presets.map((p) => <Avatar key={p.key} username={p.name} preset={p.key} size={size} decorative />)}
    </span>
  );
}

export function ShopScreen({ userId, username, onBack, onDetailsSaved, onBalance }) {
  const [status, setStatus] = useState("loading");
  const [shop, setShop] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [mine, setMine] = useState(null); // { for: username, status, profile } - your picture, team and badges
  const [tab, setTab] = useState("frame");
  const [selected, setSelected] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { at: item id | "showcase", text, bad }
  const [picks, setPicks] = useState(null); // unsaved showcase choices
  const id = useId();
  const request = useRef(0);
  const busyRef = useRef(false);
  const tabRefs = useRef([]);
  const detailRef = useRef(null);
  const confirmRef = useRef(null);

  // quiet: a refresh after a change, keeping the screen (and what it last showed, if the refresh fails).
  async function load({ quiet = false } = {}) {
    const ask = ++request.current;
    if (!quiet) setStatus("loading");
    const needProfile = !(mine && mine.for === username && mine.status === "ok");
    const [s, w, p] = await Promise.all([fetchShop(), fetchWallet(), needProfile ? fetchPlayerProfile(username) : null]);
    if (ask !== request.current) return;
    // Only your own account's profile counts: a name the app still has from before a moderator's rename can now
    // belong to someone else, whose picture and badges this must not show (or save to your showcase).
    const yours = p?.status === "ok" && p.profile?.id === userId;
    if (needProfile) setMine({ for: username, status: yours ? "ok" : "error", profile: yours ? p.profile : null });
    if (w) setWallet(w);
    if (s) {
      setShop(s);
      onBalance?.(s.balance);
    }
    if (!quiet) setStatus(s ? "ok" : "error");
  }
  useEffect(() => { load(); }, [userId, username]);

  // The detail row opens under its tile's row, which on a phone can be below the screen.
  useEffect(() => { if (selected) detailRef.current?.scrollIntoView?.({ block: "nearest" }); }, [selected]);
  // Buy and Confirm purchase replace each other, and an answered action swaps its buttons (a button that's
  // disabled or removed drops the keyboard to the top of the page): keep it in the selected item's details - or,
  // on the Showcase tab, where Save showcase disables itself while saving and once saved, in the showcase.
  function refocus() {
    // Lost means on the page itself - or still on a button that's been disabled or removed, which Chrome reports
    // until it moves focus to the page a moment later.
    const el = document.activeElement;
    if (el && el !== document.body && !el.disabled && document.contains(el)) return;
    if (tab === "showcase") {
      document.getElementById(`${id}-panel`)?.querySelector("input:not(:disabled), button:not(:disabled)")?.focus();
      return;
    }
    if (!selected) return;
    (detailRef.current?.querySelector("button:not(:disabled)") || document.getElementById(`${id}-pick-${selected}`))?.focus();
  }
  useEffect(() => { if (confirming) confirmRef.current?.focus(); else refocus(); }, [confirming]);
  useEffect(() => { if (!busy) refocus(); }, [busy]);

  const header = (
    <div className="sh-top">
      <h1 className="sh-title">Shop</h1>
      <button type="button" className="btn" onClick={() => onBack?.()}>Back</button>
    </div>
  );
  if (status !== "ok" || !shop) {
    return (
      <section className="shop">
        {header}
        {status === "error" ? (
          <div className="panel">
            <p>The shop didn't load.</p>
            <div className="frow"><button type="button" className="btn" onClick={() => load()}>Try again</button></div>
          </div>
        ) : <p className="muted">Loading the shop…</p>}
      </section>
    );
  }

  const profile = mine?.profile || null;
  const details = profile?.details || null;
  const team = TEAMS[details?.favoriteTeam] ? details.favoriteTeam : null;
  const progress = profile ? badgeProgress({ stats: profile.stats, extra: profile.extra, details: profile.details, joined: profile.joined }) : [];
  const earned = new Set(progress.filter((p) => p.earned).map((p) => p.id));
  const earnedBadges = BADGES.filter((b) => earned.has(b.id));
  const savedPicks = shop.equipped.showcase.filter((b) => earned.has(b));
  const chosen = picks ?? savedPicks;

  const items = shop.items.filter(drawable);
  const sel = items.find((i) => i.id === selected) || null;
  const selPack = sel?.kind === "avatar_pack" ? PACK_BY_ITEM[sel.id] : null;
  // The card wears the selected item over what's equipped.
  const wear = {
    frame: sel?.kind === "frame" ? sel.id : shop.equipped.frame,
    card: sel?.kind === "card" ? sel.id : shop.equipped.card,
    title: sel?.kind === "title" ? sel.id : shop.equipped.title,
  };
  const trying = !!(sel && (selPack || worn(shop.equipped, sel.kind) !== sel.id)) || (picks != null && !sameList(picks, savedPicks));
  const cardProps = { username, details, team, wear, badges: cardBadges(chosen, progress) };

  async function act(run) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    try { await run(); } finally { busyRef.current = false; setBusy(false); }
  }
  const say = (at, text, bad = false) => setMsg({ at, text, bad });
  // What a successful save changed, kept on screen even if the refresh after it fails.
  const showDetails = (d) => setShop((s) => ({ ...s, equipped: { frame: d.frame ?? null, card: d.cardTheme ?? null, title: d.title ?? null, showcase: d.showcase || [] } }));

  function chooseTab(next) {
    setTab(next);
    setSelected(null);
    setConfirming(false);
    setMsg(null);
    setPicks(null);
  }
  // Arrow keys, Home and End move between the tabs (the ARIA tabs pattern), each showing its panel as it's reached.
  function tabKey(e, index) {
    const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const next = (to + TABS.length) % TABS.length;
    chooseTab(TABS[next]);
    tabRefs.current[next]?.focus();
  }
  function choose(itemId) {
    setSelected((cur) => (cur === itemId ? null : itemId));
    setConfirming(false);
    setMsg(null);
  }

  const buy = (item) => act(async () => {
    const res = await buyItem(item.id);
    if (!res.ok) {
      setConfirming(false);
      // Owned, off sale or a badge's: the shop on screen is out of date, and the refresh shows why.
      if (res.reason === "not_enough") say(item.id, "You don't have enough coins for that.", true);
      else if (res.reason === "signed_out") say(item.id, SIGNED_OUT, true);
      else if (!["owned", "unavailable", "badge_only"].includes(res.reason)) {
        say(item.id, FAILED, true);
        return;
      }
      await load({ quiet: true });
      return;
    }
    onBalance?.(res.balance);
    // A frame, card theme or title goes on straight away. Confirm purchase stays (disabled) until that's
    // answered too, so the item doesn't flash through an Equip button on its way to Equipped.
    const put = item.kind === "avatar_pack" ? null : await equipItem(item.kind, item.id);
    setConfirming(false);
    setShop((s) => ({ ...s, balance: res.balance, items: s.items.map((i) => (i.id === item.id ? { ...i, owned: true } : i)) }));
    setWallet((w) => w && {
      ...w, balance: res.balance, spent: w.spent + (item.price || 0),
      recent: [{ amount: -(item.price || 0), kind: "purchase", ref: item.id, createdAt: new Date().toISOString() }, ...w.recent].slice(0, 20),
    });
    if (put?.ok) {
      showDetails(put.details);
      onDetailsSaved?.(put.details);
    }
    say(item.id, !put ? "Bought. Choose one in Edit profile." : put.ok ? "Bought and equipped." : "Bought.");
    await load({ quiet: true });
  });

  // id null takes the slot's item off.
  const equip = (item, itemId) => act(async () => {
    const res = await equipItem(item.kind, itemId);
    if (!res.ok) {
      if (res.reason === "not_owned" || res.reason === "invalid") await load({ quiet: true });
      else say(item.id, res.reason === "signed_out" ? SIGNED_OUT : FAILED, true);
      return;
    }
    showDetails(res.details);
    onDetailsSaved?.(res.details);
    say(item.id, itemId ? "Equipped." : "Taken off.");
    await load({ quiet: true });
  });

  const saveShowcase = () => act(async () => {
    const res = await setShowcase(chosen);
    if (!res.ok) {
      say("showcase", res.reason === "signed_out" ? SIGNED_OUT : FAILED, true);
      return;
    }
    showDetails(res.details);
    onDetailsSaved?.(res.details);
    setPicks(null);
    say("showcase", "Showcase saved.");
    await load({ quiet: true });
  });

  function actions(item, state, line) {
    if (state === "buy") {
      return confirming ? (
        <>
          <p className="sh-dline"><span>You'll have <b>{num(shop.balance - item.price)}</b> left.</span></p>
          <div className="sh-acts">
            <button type="button" className="btn solid" ref={confirmRef} disabled={busy} onClick={() => buy(item)}>Confirm purchase</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="sh-acts">
          <button type="button" className="btn solid" disabled={busy} onClick={() => { setMsg(null); setConfirming(true); }}>Buy</button>
        </div>
      );
    }
    if (state === "owned" && item.kind === "avatar_pack") return <p className="sh-dline">Choose one in Edit profile.</p>;
    if (state === "owned") {
      return <div className="sh-acts"><button type="button" className="btn solid" disabled={busy} onClick={() => equip(item, item.id)}>Equip</button></div>;
    }
    if (state === "equipped" && item.kind === "title") {
      return <div className="sh-acts"><button type="button" className="btn" disabled={busy} onClick={() => equip(item, null)}>Take off</button></div>;
    }
    if (state === "equipped") return <p className="sh-dline">Equipped</p>;
    if (state === "locked") {
      const badge = BADGE_BY_ID[item.badge];
      return <p className="sh-dline">{badge && <span className={`sh-medal sh-t-${badge.tier}`} aria-hidden="true">{badge.emoji}</span>}{line}</p>;
    }
    return <p className="sh-dline">{line}</p>;
  }

  function renderItem(item) {
    const state = itemState(item, shop);
    const open = selected === item.id;
    const name = itemName(item.id);
    const badge = item.badge ? BADGE_BY_ID[item.badge] : null;
    const pack = item.kind === "avatar_pack" ? PACK_BY_ITEM[item.id] : null;
    const ids = { pick: `${id}-pick-${item.id}`, info: `${id}-info-${item.id}`, detail: `${id}-detail-${item.id}` };
    // Free items are everyone's, so only a bought or awarded one says it's owned.
    const tag = state === "equipped" ? "Equipped" : state === "owned" && item.rarity !== "free" ? "Owned" : null;
    const line = state === "short" ? `${num(item.price - shop.balance)} more coins`
      : state === "locked" ? (earned.has(item.badge) ? "Unlocks after your next finished season" : `Earn the ${badge?.name || item.badge} badge`)
        : null;
    const note = msg && msg.at === item.id ? msg : null;
    return (
      <article key={item.id} className={`sh-item sh-r-${item.rarity}`} data-item={item.id} data-state={state}>
        <div className={`sh-tile${open ? " sh-open" : ""}`}>
          <button type="button" className="sh-pick" id={ids.pick} aria-expanded={open} aria-controls={open ? ids.detail : undefined}
            aria-describedby={ids.info} onClick={() => choose(item.id)}>{name}</button>
          <span className="sh-win" aria-hidden="true">
            <ItemPreview id={item.id} team={team} username={username} photoUrl={details?.avatarUrl ?? null} preset={details?.avatarPreset ?? null} />
            {state === "locked" && badge && <span className={`sh-lock sh-t-${badge.tier}`}>{badge.emoji}</span>}
          </span>
          <span className="sh-info" id={ids.info}>
            <span className="sh-rar">{RARITY_LABEL[item.rarity] || item.rarity}</span>
            {!item.owned && item.price != null && <Coins amount={item.price} size={14} className="sh-price" />}
            {tag && <span className={`sh-tag sh-tag-${state}`}>{tag}</span>}
            {line && <span className="sh-line">{line}</span>}
          </span>
          {state === "short" && <span className="sh-bar" style={{ "--p": Math.max(0, Math.min(1, shop.balance / item.price)) }} aria-hidden="true" />}
        </div>
        {open && (
          <div className="sh-detail" id={ids.detail} ref={detailRef}>
            <div className="sh-tryon" aria-hidden="true">{pack ? <PackStrip pack={pack} size={40} /> : <CardPreview {...cardProps} compact />}</div>
            <div className="sh-dmain">
              <p className="sh-dhead">
                <span className="sh-dname">{name}</span>
                {!item.owned && item.price != null && <Coins amount={item.price} size={18} className="sh-dprice" />}
              </p>
              {actions(item, state, line)}
              <p className={`sh-msg${note?.bad ? " sh-bad" : ""}`} role="status">{note?.text || ""}</p>
            </div>
          </div>
        )}
      </article>
    );
  }

  function showcasePanel() {
    if (mine?.status !== "ok") {
      return (
        <div className="sh-empty">
          <p>Your badges didn't load.</p>
          <button type="button" className="btn" onClick={() => load({ quiet: true })}>Try again</button>
        </div>
      );
    }
    if (!earnedBadges.length) return <p className="sh-empty">No badges yet.</p>;
    const note = msg && msg.at === "showcase" ? msg : null;
    return (
      <fieldset className="sh-show">
        <legend className="sh-legend">Pick up to {SHOWCASE_MAX}</legend>
        <div className="sh-chips">
          {earnedBadges.map((b) => {
            const at = chosen.indexOf(b.id);
            const on = at >= 0;
            return (
              <label key={b.id} className={`sh-chip sh-t-${b.tier}${on ? " sh-on" : ""}`}>
                <input type="checkbox" name="showcase" value={b.id} checked={on} disabled={busy || (!on && chosen.length >= SHOWCASE_MAX)}
                  onChange={(e) => { setMsg(null); setPicks(e.target.checked ? [...chosen, b.id].slice(0, SHOWCASE_MAX) : chosen.filter((x) => x !== b.id)); }} />
                <span className="sh-e" aria-hidden="true">{b.emoji}</span>
                <span className="sh-bn">{b.name}</span>
                {on && <span className="sh-ord" aria-hidden="true">{at + 1}</span>}
              </label>
            );
          })}
        </div>
        <div className="sh-acts">
          <button type="button" className="btn solid" disabled={busy || sameList(chosen, savedPicks)} onClick={saveShowcase}>Save showcase</button>
          <span className="sh-count">{chosen.length} of {SHOWCASE_MAX}</span>
        </div>
        <p className={`sh-msg${note?.bad ? " sh-bad" : ""}`} role="status">{note?.text || ""}</p>
      </fieldset>
    );
  }

  return (
    <section className="shop" data-balance={shop.balance}>
      {header}
      <div className="sh-body">
        <div className="sh-stage">
          <div className="sh-case">
            <p className="sh-label"><span>Your card</span>{trying && <span className="sh-try">Preview</span>}</p>
            <CardPreview {...cardProps} />
            {selPack && <PackStrip pack={selPack} size={48} />}
          </div>
          <p className="sh-bal"><span className="sh-k">Balance</span><Coins amount={shop.balance} size={24} className="sh-coins" /></p>
        </div>
        <div className="sh-shelf">
          <div className="sh-tabs" role="tablist" aria-label="Shop">
            {TABS.map((k, i) => (
              <button key={k} type="button" role="tab" id={`${id}-tab-${k}`} ref={(el) => { tabRefs.current[i] = el; }}
                className={`sh-tab${tab === k ? " sh-on" : ""}`} aria-selected={tab === k} aria-controls={tab === k ? `${id}-panel` : undefined}
                tabIndex={tab === k ? 0 : -1} onClick={() => chooseTab(k)} onKeyDown={(e) => tabKey(e, i)}>
                {TAB_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="sh-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
            {tab === "showcase" ? showcasePanel() : <div className="sh-items">{items.filter((i) => i.kind === tab).map(renderItem)}</div>}
          </div>
        </div>
        <WalletPanel wallet={wallet} />
      </div>
    </section>
  );
}
