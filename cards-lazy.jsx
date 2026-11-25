// The card screens, fetched when they are first needed rather than carried by every visitor. See CARDS.md 15.
//
// cards.jsx and everything only it reads (the battle, the card face, the rules, the packs, the sprites) is
// about 100 KB that a production visitor never draws while cards are off, and that most visitors never open
// even where they are on. On the site, build.mjs turns the import below into a fetch of /cards.js; in the tests
// and the UI harness esbuild inlines it, so one code path serves both and a test still sees the real screens.
//
// Three answers, as everywhere else in this app: loading, loaded, and could-not-load. A fetch that failed is
// not "no cards" - the screen says so and offers another go, and the next attempt really is a new fetch.
//
// The stylesheet travels with the screens (it used to be part of APP_CSS) and is drawn BESIDE them, after the
// app's own <style> in the document, so the source order the card rules were written against is unchanged.
import { useEffect, useState } from "react";
import "./cards-shared.mjs";

let pending = null;
export function loadCards() {
  if (!pending) pending = import("./cards.jsx").catch((e) => { pending = null; throw e; });
  return pending;
}

function useCards() {
  const [got, setGot] = useState(null); // null: loading. "error". Or the module.
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setGot(null);
    loadCards().then((m) => { if (live) setGot(m); }, () => { if (live) setGot("error"); });
    return () => { live = false; };
  }, [tries]);
  return [got, () => setTries((n) => n + 1)];
}

export function LazyCardsScreen(props) {
  const [mod, retry] = useCards();
  if (mod === null) return <p className="note" role="status" data-cards-loading>Loading cards…</p>;
  if (mod === "error") {
    return (
      <div className="panel" data-cards-failed>
        <p role="alert">Couldn't load the card screens. Check your connection and try again.</p>
        <div><button className="btn" onClick={retry}>Try again</button> <button className="linkbtn" onClick={props.onBack}>Back</button></div>
      </div>
    );
  }
  return <><style>{mod.CARDS_CSS}</style><mod.CardsScreen {...props} /></>;
}

// The daily card under a finished season. It is an extra, so while it loads - or if it cannot - there is
// simply nothing there: the season above it never waits on it.
export function LazySeasonCard(props) {
  const [mod] = useCards();
  if (!mod || mod === "error") return null;
  return <><style>{mod.CARDS_CSS}</style><mod.SeasonCard {...props} /></>;
}
