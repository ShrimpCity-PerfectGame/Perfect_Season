// The shop and the wallet. Contract: SHOP.md (7.2). Classes are prefixed sh-.
//
// PHASE 0 STUB: a plain but working version of the contract - its props, its flow (select, Buy, Confirm purchase,
// equip, take off, showcase) and its test hooks - so the app can be built and tested against it. Agent L replaces
// it with the real screen; the hooks must survive.
//
// Props:
//   userId, username         the signed-in player
//   onBack()                 leave the shop
//   onDetailsSaved(details)  after an equip or showcase save (mapDetails shape)
//   onBalance(balance)       whenever the balance loads or changes
import { useEffect, useRef, useState } from "react";
import { fetchShop, fetchWallet, fetchPlayerProfile, buyItem, equipItem, setShowcase } from "./storage.js";
import { SHOP_KINDS, KIND_LABEL, SHOP_ITEM_BY_ID, DEFAULT_ITEM, SHOWCASE_MAX, RARITY_LABEL } from "./shop-catalog.mjs";
import { BADGES, BADGE_BY_ID, badgeProgress } from "./badges.mjs";
import { Coins, ItemPreview } from "./cosmetics.jsx";

export const SHOP_CSS = `
/* ===== shop ===== */
.sh-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.sh-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:0 0 20px}
.sh-item{border:1.5px solid var(--line2);border-radius:14px;padding:12px;display:grid;gap:6px;align-content:start}
.sh-wallet ul{margin:0;padding-left:18px}
`;

const num = (n) => Number(n || 0).toLocaleString("en-US");
const itemName = (id) => SHOP_ITEM_BY_ID[id]?.name || id;
// What's worn in a slot: null in the database means the slot's default.
const worn = (equipped, slot) => equipped?.[slot] ?? DEFAULT_ITEM[slot];

function stateOf(item, shop) {
  if (item.owned) return item.kind !== "avatar_pack" && worn(shop.equipped, item.kind) === item.id ? "equipped" : "owned";
  if (item.badge) return "locked";
  return shop.balance >= (item.price || 0) ? "buy" : "short";
}

// A wallet ledger row in words.
function ledgerLabel(entry) {
  const { kind, ref } = entry || {};
  if (kind === "starting") return "Starting balance";
  if (kind === "welcome") return "Welcome coins";
  if (kind === "daily") return "Daily";
  if (kind === "season") return "Season";
  if (kind === "badge") return `${BADGE_BY_ID[ref]?.name || ref} badge`;
  if (kind === "minigame") return String(ref || "").startsWith("over_under") ? "Over/Under" : "Build-a-player";
  if (kind === "purchase") return itemName(ref);
  return kind || "";
}

export function WalletPanel({ wallet }) {
  if (!wallet) return null;
  return (
    <section className="sh-wallet">
      <h2 className="h">Coins</h2>
      <p><Coins amount={wallet.balance} /> · earned {num(wallet.earned)} · spent {num(wallet.spent)}</p>
      {wallet.recent.length > 0 && (
        <ul>
          {wallet.recent.map((e, i) => (
            <li className="sh-ledger" key={`${e.kind}:${e.ref}:${i}`}>{e.amount > 0 ? "+" : "−"}{num(Math.abs(e.amount))} · {ledgerLabel(e)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ShopScreen({ userId, username, onBack, onDetailsSaved, onBalance }) {
  const [status, setStatus] = useState("loading");
  const [shop, setShop] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("frame");
  const [selected, setSelected] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [picks, setPicks] = useState(null);
  const request = useRef(0);

  async function load() {
    const mine = ++request.current;
    const [s, w, p] = await Promise.all([fetchShop(), fetchWallet(), fetchPlayerProfile(username)]);
    if (mine !== request.current) return;
    setShop(s);
    setWallet(w);
    setProfile(p?.status === "ok" ? p.profile : null);
    setStatus(s ? "ok" : "error");
    if (s) onBalance?.(s.balance);
  }
  useEffect(() => { load(); }, [userId, username]);

  if (status === "loading") return <p className="muted">Loading the shop…</p>;
  if (status === "error") {
    return (
      <div className="panel">
        <p>The shop didn't load.</p>
        <div className="frow"><button className="btn" onClick={load}>Try again</button><button className="btn" onClick={() => onBack?.()}>Back</button></div>
      </div>
    );
  }

  const progress = profile ? badgeProgress({ stats: profile.stats, extra: profile.extra, details: profile.details, joined: profile.joined }) : [];
  const earned = new Set(progress.filter((p) => p.earned).map((p) => p.id));
  const chosen = picks ?? shop.equipped.showcase.filter((id) => earned.has(id));

  async function act(run) {
    setBusy(true);
    setMsg("");
    try { await run(); } finally { setBusy(false); }
  }
  const buy = (item) => act(async () => {
    const res = await buyItem(item.id);
    setConfirming(false);
    if (!res.ok) {
      if (res.reason === "not_enough") setMsg("You don't have enough coins for that.");
      else if (res.reason === "owned" || res.reason === "unavailable") await load();
      else setMsg("That didn't go through. Try again.");
      return;
    }
    onBalance?.(res.balance);
    if (item.kind === "avatar_pack") {
      setMsg("Bought. Choose one in Edit profile.");
    } else {
      const eq = await equipItem(item.kind, item.id);
      if (eq.ok) onDetailsSaved?.(eq.details);
      setMsg(eq.ok ? "Bought and equipped." : "Bought.");
    }
    await load();
  });
  const equip = (slot, id) => act(async () => {
    const res = await equipItem(slot, id);
    if (!res.ok) { setMsg("That didn't go through. Try again."); return; }
    onDetailsSaved?.(res.details);
    await load();
  });
  const saveShowcase = () => act(async () => {
    const res = await setShowcase(chosen);
    if (!res.ok) { setMsg("That didn't go through. Try again."); return; }
    onDetailsSaved?.(res.details);
    setPicks(null);
    setMsg("Showcase saved.");
    await load();
  });

  return (
    <section className="shop" data-balance={shop.balance}>
      <div className="frow">
        <h1 className="h">Shop</h1>
        <Coins amount={shop.balance} />
        <button className="btn" onClick={() => onBack?.()}>Back</button>
      </div>
      <div className="sh-tabs" role="tablist">
        {[...SHOP_KINDS, "showcase"].map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className="btn" onClick={() => { setTab(k); setSelected(null); setConfirming(false); setMsg(""); }}>
            {k === "showcase" ? "Showcase" : KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {msg && <p className="note" role="status">{msg}</p>}

      {tab === "showcase" ? (
        <div className="sh-showcase">
          {BADGES.filter((b) => earned.has(b.id)).map((b) => (
            <label key={b.id} className="frow">
              <input type="checkbox" name="showcase" value={b.id} checked={chosen.includes(b.id)}
                disabled={!chosen.includes(b.id) && chosen.length >= SHOWCASE_MAX}
                onChange={(e) => setPicks(e.target.checked ? [...chosen, b.id] : chosen.filter((id) => id !== b.id))} />
              {b.emoji} {b.name}
            </label>
          ))}
          <button className="btn solid" disabled={busy} onClick={saveShowcase}>Save showcase</button>
        </div>
      ) : (
        <div className="sh-items">
          {shop.items.filter((item) => item.kind === tab).map((item) => {
            const state = stateOf(item, shop);
            const open = selected === item.id;
            const badge = item.badge ? BADGE_BY_ID[item.badge] : null;
            return (
              <article key={item.id} className="sh-item" data-item={item.id} data-state={state}>
                <ItemPreview id={item.id} team={profile?.details?.favoriteTeam} username={username}
                  photoUrl={profile?.details?.avatarUrl} preset={profile?.details?.avatarPreset} />
                <button className="linkbtn" aria-pressed={open} onClick={() => { setSelected(item.id); setConfirming(false); setMsg(""); }}>{itemName(item.id)}</button>
                <span className="muted">{RARITY_LABEL[item.rarity] || item.rarity}{item.price ? ` · ${num(item.price)}` : ""}</span>
                {state === "short" && <span className="muted">{num(item.price - shop.balance)} more coins</span>}
                {state === "locked" && <span className="muted">{earned.has(item.badge) ? "Unlocks after your next finished season" : `Earn the ${badge?.name || item.badge} badge`}</span>}
                {open && state === "buy" && !confirming && <button className="btn solid" disabled={busy} onClick={() => setConfirming(true)}>Buy</button>}
                {open && state === "buy" && confirming && (
                  <div className="frow">
                    <button className="btn solid" disabled={busy} onClick={() => buy(item)}>Confirm purchase</button>
                    <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
                  </div>
                )}
                {open && state === "owned" && item.kind !== "avatar_pack" && <button className="btn" disabled={busy} onClick={() => equip(item.kind, item.id)}>Equip</button>}
                {open && state === "equipped" && item.kind === "title" && <button className="btn" disabled={busy} onClick={() => equip("title", null)}>Take off</button>}
              </article>
            );
          })}
        </div>
      )}
      <WalletPanel wallet={wallet} />
    </section>
  );
}
