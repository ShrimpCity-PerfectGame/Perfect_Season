// Cosmetics: how shop items look where they're worn - a frame around a picture, a player card's theme, a title
// under a name - plus the coin. Contract: SHOP.md (7.1). Classes are prefixed cs-.
//
// PHASE 0 STUB. The exports, props and test hooks (data-frame, data-card, data-title) are the contract; the looks
// are placeholders for agent K: every frame is today's ink ring and every card theme today's navy card.
import { Avatar } from "./avatars.jsx";
import { PALETTE } from "./theme.mjs";
import { SHOP_ITEM_BY_ID, DEFAULT_ITEM, PACK_BY_ITEM } from "./shop-catalog.mjs";

// Which theme.mjs scope each card theme's text uses. perfect-season.jsx maps the cs-dark, cs-night and cs-light
// classes to those scopes.
export const CARD_THEME_SCOPE = {
  "card-navy": "dark", "card-night": "night", "card-turf": "dark", "card-team": "dark",
  "card-ticket": "light", "card-gold-foil": "light", "card-dynasty": "night",
};

export const COSMETICS_CSS = `
/* ===== cosmetics ===== */
.cs-frame{flex:none;display:inline-grid;place-items:center;border-radius:50%}
.cs-title{margin:0;font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.cs-coins{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.cs-coin{flex:none;display:block}
.cs-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.cs-preview{display:inline-flex;align-items:center;gap:4px}
.cs-swatch{display:block;width:56px;height:36px;border-radius:8px}
`;

// An id of the given kind from the catalog, or null.
const known = (id, kind) => (id && SHOP_ITEM_BY_ID[id]?.kind === kind ? id : null);

// A picture in its frame. `size` is the picture's own size; the frame sits outside it.
export function FramedAvatar({ frame = null, team = null, size = 40, username = "", photoUrl = null, preset = null, decorative = false, className = "" }) {
  const id = known(frame, "frame") || DEFAULT_ITEM.frame;
  return (
    <span className={`cs-frame cs-frame-${id} ${className}`.trim()} data-frame={id} data-team={team || undefined}>
      <Avatar username={username} photoUrl={photoUrl} preset={preset} size={size} decorative={decorative} />
    </span>
  );
}

// A player card's paint and text scope. `className` carries the card's layout.
export function CardTheme({ theme = null, team = null, as: Tag = "div", className = "", children, ...rest }) {
  const id = known(theme, "card") || DEFAULT_ITEM.card;
  const scope = CARD_THEME_SCOPE[id] || "dark";
  return (
    <Tag {...rest} className={`cs-card cs-${scope} cs-card-${id} ${className}`.trim()} data-card={id} data-team={team || undefined}>
      {children}
    </Tag>
  );
}

// The title under a name, or nothing.
export function TitleLine({ title = null, className = "" }) {
  const id = known(title, "title");
  if (!id) return null;
  return <p className={`cs-title ${className}`.trim()} data-title={id}>{SHOP_ITEM_BY_ID[id].name}</p>;
}

// The coin: the Gridspin re-spin arrow on a lime disc. Decorative - Coins says the number in words.
export function Coin({ size = 16 }) {
  return (
    <svg className="cs-coin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.5" fill={PALETTE.lime} stroke={PALETTE.ink} strokeWidth="2" />
      <path d="M15.6 8.4A5 5 0 1 1 8.4 8.4" fill="none" stroke={PALETTE.ink} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 5.6 7.3 6.1 8.9 8.5Z" fill={PALETTE.ink} />
    </svg>
  );
}

// An amount of coins: the coin and "1,240", read as "1,240 coins".
export function Coins({ amount = 0, size = 16, className = "" }) {
  return (
    <span className={`cs-coins ${className}`.trim()}>
      <Coin size={size} />
      <span>{Number(amount || 0).toLocaleString("en-US")}</span>
      <span className="cs-sr"> coins</span>
    </span>
  );
}

// The thumbnail a shop tile shows for an item. Decorative: the tile names the item.
export function ItemPreview({ id, team = null, username = "", photoUrl = null, preset = null }) {
  const item = SHOP_ITEM_BY_ID[id];
  if (!item) return null;
  if (item.kind === "frame") {
    return (
      <span className="cs-preview" aria-hidden="true">
        <FramedAvatar frame={id} team={team} size={40} username={username} photoUrl={photoUrl} preset={preset} decorative />
      </span>
    );
  }
  if (item.kind === "card") return <CardTheme theme={id} team={team} className="cs-preview cs-swatch" aria-hidden="true" />;
  if (item.kind === "title") return <span className="cs-preview" aria-hidden="true"><TitleLine title={id} /></span>;
  const pack = PACK_BY_ITEM[id];
  return (
    <span className="cs-preview" aria-hidden="true">
      {(pack?.presets || []).map((p) => <Avatar key={p.key} username={p.name} preset={p.key} size={24} decorative />)}
    </span>
  );
}
