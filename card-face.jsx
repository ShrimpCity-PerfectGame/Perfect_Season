// One card, drawn. See CARDS.md, and docs/superpowers/specs/2026-11-13-card-collection/mockup.html for the look.
//
// A card is ARTWORK with fixed colours, the way a cosmetic frame is: it looks the same on the cream card area,
// on the dark battle screen and on the black leaderboard, so its paints are data here (CARD_PAINT) and not theme
// tokens. tests/test-card-face.mjs holds every text colour on it to WCAG AA against what it sits on, through
// CARD_TEXT_PAIRS - add a pair there whenever a new piece of text goes on the card.
//
// The whole card is one image to a screen reader: role="img" with a label that reads it out in a sentence.
// Colour is never the only signal - the finish is a word on the card as well as an edge.
import { useEffect, useState } from "react";
import { TEAMS } from "./game-logic.mjs";
import { FINISH_BONUS, archetypeLabel, ROLE_PLAYER } from "./card-logic.mjs";
import { cardColours, spriteFor, paintSprite, paintedSprite } from "./card-sprites.mjs";

export const CARD_PAINT = {
  paper: "#f4efe2", ink: "#14213d", muted: "#4d566d", line: "#c9c2b0",
  artHi: "#fbf8ef", artLo: "#d6cdb6", goldHi: "#fff6d0", goldLo: "#dcb85a",
  lime: "#c6f432", black: "#0b0b0d", cream: "#f4efe2", prismMuted: "#b9b4a6",
  baseEdge: "#d8d2c2",
};
// [text colour, what it sits on, what it is] - every piece of text on a card.
const P = CARD_PAINT;
export const CARD_TEXT_PAIRS = [
  [P.ink, P.paper, "name and stats on the card body"],
  [P.muted, P.paper, "first name, stat labels and Role player on the card body"],
  [P.lime, P.ink, "the archetype pill"],
  [P.cream, P.ink, "the position chip"],
  [P.ink, P.artLo, "rating and team on the art panel's darker end"],
  [P.muted, P.artLo, "the season on the art panel's darker end"],
  [P.ink, P.goldLo, "rating and team on a Gold card's art panel"],
  // The season sits at the BOTTOM of the art panel's gradient - its dark end - so that is what it is measured
  // against. It was first checked against the light end (6.75:1) while really sitting on 3.85:1; review caught it.
  // On a Gold card the muted grey cannot clear AA there, so the season is ink.
  [P.ink, P.goldLo, "the season on a Gold card's art panel (the gradient's dark end)"],
  [P.cream, P.black, "name and stats on a Prism card"],
  [P.prismMuted, P.black, "first name and stat labels on a Prism card"],
  [P.lime, P.black, "rating on a Prism card"],
  [P.ink, P.lime, "the position chip and finish label on a Prism card"],
  [P.ink, P.baseEdge, "the finish label on a Base card"],
  [P.ink, "#8b98a6", "the finish label on a Silver card's darkest stop"],
  [P.ink, "#bd8c26", "the finish label on a Gold card's darkest stop"],
];

const POS_WORD = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end" };
const FINISH_WORD = { base: "Base", silver: "Silver", gold: "Gold", prism: "Prism" };
const whole = (n) => Math.round(n).toLocaleString("en-US");
const per = (n, d) => (d > 0 ? (n / d).toFixed(1) : "0.0");
// Three stats, the same shape at every position: main yards, touchdowns, yards per touch.
export function cardStats(card) {
  if (card.pos === "QB") return [[whole(card.py), "Pass yd", "passing yards"], [card.ptd, "TD", "touchdowns"], [per(card.py, card.att), "Yd/att", "yards per attempt"]];
  if (card.pos === "RB") return [[whole(card.ry), "Rush yd", "rushing yards"], [card.rtd, "TD", "touchdowns"], [per(card.ry, card.car), "Yd/car", "yards per carry"]];
  return [[whole(card.rcy), "Rec yd", "receiving yards"], [card.rctd, "TD", "touchdowns"], [per(card.rcy, card.rec), "Yd/rec", "yards per catch"]];
}
export function cardLabel(card, finish = "base", count = 1) {
  const team = TEAMS[card.team];
  const stats = cardStats(card).map(([value, , words]) => `${value} ${words}`).join(", ");
  const bonus = FINISH_BONUS[finish] ? ` plus ${FINISH_BONUS[finish]}` : "";
  return `${card.season} ${card.name}, ${team ? `${team[1]} ${team[0]}` : card.team} ${POS_WORD[card.pos] || card.pos}, rated ${Math.round(card.rating)}${bonus}, `
    + `${archetypeLabel(card.archetype)}, ${FINISH_WORD[finish] || finish} finish. ${stats}.${count > 1 ? ` ${count} copies.` : ""}`;
}

export function CardFace({ card, finish = "base", count = 1 }) {
  const neutral = spriteFor(card);
  const colours = cardColours(card);
  // A sprite painted before starts painted: no second load, and no flash of the neutral blue when a grid re-draws.
  const [src, setSrc] = useState(() => paintedSprite(neutral, colours) || neutral);
  useEffect(() => {
    let live = true;
    const ready = paintedSprite(neutral, colours);
    setSrc(ready || neutral);
    if (ready || typeof Image === "undefined") return undefined;
    const img = new Image();
    // A sprite that fails to load, or a canvas that will not paint it, leaves the card on the neutral drawing
    // (or on none) - the name, rating and stats do not depend on it.
    img.onload = () => { const url = paintSprite(img, colours, neutral); if (live && url) setSrc(url); };
    img.onerror = () => {};
    img.src = neutral;
    return () => { live = false; };
  }, [neutral, colours.jersey, colours.metal, colours.skin]);

  const [first, ...rest] = card.name.split(" ");
  const bonus = FINISH_BONUS[finish] || 0;
  const role = card.archetype === ROLE_PLAYER;
  return (
    <div className={`cd-card cd-f-${finish}`} role="img" aria-label={cardLabel(card, finish, count)} data-card={card.id} data-finish={finish}
      style={{ "--cd-a": colours.jersey, "--cd-b": colours.metal }}>
      <div className="cd-in" aria-hidden="true">
        <div className="cd-art">
          <span className="cd-pos">{card.pos}</span>
          <span className="cd-ovr">{Math.round(card.rating)}{bonus > 0 && <small>+{bonus}</small>}</span>
          <span className="cd-tm">{card.team}</span>
          <span className="cd-yr">{card.season}</span>
          <img className="cd-fig" alt="" src={src} onError={(e) => { e.currentTarget.hidden = true; }} />
        </div>
        <div className="cd-nm"><small>{rest.length ? first : ""}</small>{rest.length ? rest.join(" ") : first}</div>
        <div className={`cd-arch${role ? " cd-role" : ""}`}>{archetypeLabel(card.archetype)}</div>
        <div className="cd-st">
          {cardStats(card).map(([value, label]) => <div key={label}>{value}<span>{label}</span></div>)}
        </div>
      </div>
      <span className="cd-fin" aria-hidden="true">{FINISH_WORD[finish]}</span>
      {count > 1 && <span className="cd-count" aria-hidden="true">x{count}</span>}
    </div>
  );
}

// Sized by --cd-w so a grid can shrink a card without redrawing it; every length below is a share of that.
export const CARD_FACE_CSS = `
.cd-card{--cd-w:172px;--cd-u:calc(var(--cd-w) / 172);--cd-edge:${P.baseEdge};position:relative;width:var(--cd-w);height:calc(var(--cd-u) * 252);border-radius:calc(var(--cd-u) * 12);padding:calc(var(--cd-u) * 4);background:var(--cd-edge);box-shadow:0 calc(var(--cd-u) * 6) 0 rgba(0,0,0,.35);flex:none;font-family:Inter,system-ui,sans-serif;text-align:left;margin-bottom:calc(var(--cd-u) * 12)}
.cd-card .cd-in{position:relative;height:100%;border-radius:calc(var(--cd-u) * 9);overflow:hidden;background:${P.paper};color:${P.ink};display:flex;flex-direction:column}
.cd-card .cd-art{position:relative;height:calc(var(--cd-u) * 122);background:linear-gradient(160deg,${P.artHi},${P.artLo});overflow:hidden;flex:none}
.cd-card .cd-art::before{content:"";position:absolute;inset:0;background:linear-gradient(112deg,transparent 0 50%,var(--cd-a) 50% 58%,var(--cd-b) 58% 62%,transparent 62%);opacity:.85}
.cd-card .cd-pos{position:absolute;left:calc(var(--cd-u) * 8);top:calc(var(--cd-u) * 8);font-weight:800;font-size:calc(var(--cd-u) * 11);letter-spacing:.08em;background:${P.ink};color:${P.cream};padding:calc(var(--cd-u) * 3) calc(var(--cd-u) * 7);border-radius:calc(var(--cd-u) * 4);line-height:1.2}
.cd-card .cd-ovr{position:absolute;left:calc(var(--cd-u) * 8);top:calc(var(--cd-u) * 32);font-family:Anton,Impact,sans-serif;font-size:calc(var(--cd-u) * 36);line-height:1;color:${P.ink}}
.cd-card .cd-ovr small{font-size:.4em;margin-left:.15em;vertical-align:top}
.cd-card .cd-tm{position:absolute;left:calc(var(--cd-u) * 9);top:calc(var(--cd-u) * 74);font-weight:800;font-size:calc(var(--cd-u) * 12);letter-spacing:.16em;color:${P.ink}}
.cd-card .cd-yr{position:absolute;left:calc(var(--cd-u) * 9);top:calc(var(--cd-u) * 93);font-family:Anton,Impact,sans-serif;font-size:calc(var(--cd-u) * 17);line-height:1;letter-spacing:.08em;color:${P.muted}}
.cd-card .cd-fig{position:absolute;right:calc(var(--cd-u) * 2);bottom:calc(var(--cd-u) * 1);height:calc(var(--cd-u) * 118);width:auto;max-width:none;filter:drop-shadow(calc(var(--cd-u) * 2) calc(var(--cd-u) * 3) 0 rgba(0,0,0,.22))}
.cd-card .cd-nm{font-family:Anton,Impact,sans-serif;font-size:calc(var(--cd-u) * 22);line-height:1;text-transform:uppercase;padding:calc(var(--cd-u) * 9) calc(var(--cd-u) * 9) calc(var(--cd-u) * 2);letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cd-card .cd-nm small{display:block;font-family:Inter,system-ui,sans-serif;font-weight:600;font-size:calc(var(--cd-u) * 10);letter-spacing:.14em;color:${P.muted};margin-bottom:calc(var(--cd-u) * 3);min-height:1em}
.cd-card .cd-arch{margin:calc(var(--cd-u) * 6) calc(var(--cd-u) * 9) 0;align-self:flex-start;font-weight:800;font-size:calc(var(--cd-u) * 10);text-transform:uppercase;letter-spacing:.08em;background:${P.ink};color:${P.lime};padding:calc(var(--cd-u) * 4) calc(var(--cd-u) * 8);border-radius:999px;line-height:1.2}
.cd-card .cd-arch.cd-role{background:transparent;color:${P.muted};padding-left:0}
.cd-card .cd-st{margin-top:auto;display:grid;grid-template-columns:repeat(3,1fr);border-top:calc(var(--cd-u) * 2) solid ${P.ink};font-variant-numeric:tabular-nums}
.cd-card .cd-st div{text-align:center;padding:calc(var(--cd-u) * 6) 0 calc(var(--cd-u) * 7);font-weight:800;font-size:calc(var(--cd-u) * 13);line-height:1.15}
.cd-card .cd-st div+div{border-left:1px solid ${P.line}}
.cd-card .cd-st span{display:block;font-weight:600;font-size:calc(var(--cd-u) * 8);letter-spacing:.1em;text-transform:uppercase;color:${P.muted}}
.cd-card .cd-fin{position:absolute;left:50%;bottom:calc(var(--cd-u) * -10);transform:translateX(-50%);font-weight:800;font-size:calc(var(--cd-u) * 9);letter-spacing:.15em;text-transform:uppercase;background:var(--cd-edge);color:${P.ink};padding:calc(var(--cd-u) * 3) calc(var(--cd-u) * 9);border-radius:999px;white-space:nowrap;line-height:1.3}
.cd-card .cd-count{position:absolute;right:calc(var(--cd-u) * -6);top:calc(var(--cd-u) * -8);font-weight:800;font-size:calc(var(--cd-u) * 12);background:${P.ink};color:${P.cream};padding:calc(var(--cd-u) * 3) calc(var(--cd-u) * 7);border-radius:999px;line-height:1.2;box-shadow:0 2px 0 rgba(0,0,0,.35)}
.cd-card.cd-f-silver{--cd-edge:linear-gradient(135deg,#e9eef3,#9aa7b4 35%,#f7fafc 50%,#8b98a6 70%,#dde4ea)}
.cd-card.cd-f-gold{--cd-edge:linear-gradient(135deg,#f9e7a0,#c9952b 35%,#fff4c4 50%,#bd8c26 70%,#f2d675)}
.cd-card.cd-f-gold .cd-art{background:linear-gradient(160deg,${P.goldHi},${P.goldLo})}
.cd-card.cd-f-gold .cd-yr{color:${P.ink}}
.cd-card.cd-f-silver .cd-in::after,.cd-card.cd-f-gold .cd-in::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 38%,rgba(255,255,255,.45) 50%,transparent 62%);background-size:250% 100%;background-repeat:no-repeat;animation:cd-sheen 3.2s linear infinite;pointer-events:none}
.cd-card.cd-f-prism{--cd-edge:linear-gradient(135deg,#ff5fa2,#ffd166,#c6f432,#4cc9f0,#b388ff,#ff5fa2);background-size:300% 300%;animation:cd-prism 6s linear infinite}
.cd-card.cd-f-prism .cd-in{background:${P.black};color:${P.cream}}
.cd-card.cd-f-prism .cd-art{background:radial-gradient(circle at 68% 40%,#2b1c4d,${P.black} 75%)}
.cd-card.cd-f-prism .cd-ovr{color:${P.lime}}
.cd-card.cd-f-prism .cd-tm{color:${P.cream}}
.cd-card.cd-f-prism .cd-yr,.cd-card.cd-f-prism .cd-nm small,.cd-card.cd-f-prism .cd-st span,.cd-card.cd-f-prism .cd-arch.cd-role{color:${P.prismMuted}}
.cd-card.cd-f-prism .cd-pos,.cd-card.cd-f-prism .cd-fin{background:${P.lime};color:${P.ink}}
.cd-card.cd-f-prism .cd-st{border-top-color:${P.lime}}
.cd-card.cd-f-prism .cd-st div+div{border-left-color:#3a3a40}
.cd-card.cd-f-prism .cd-fig{filter:drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 7px #4cc9f0)}
/* The gleam starts and ends OFF the card, and the gradient does not repeat. It used to tile, so as one band left
   on the right its copy was already half-way across - and the loop cut it off there (owner's phone, 2.25.0). */
@keyframes cd-sheen{from{background-position:150% 0}to{background-position:-150% 0}}
@keyframes cd-prism{from{background-position:0% 50%}to{background-position:300% 50%}}
@media (prefers-reduced-motion:reduce){.cd-card.cd-f-prism,.cd-card .cd-in::after{animation:none}}
`;
