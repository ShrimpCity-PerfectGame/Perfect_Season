// What the Android app has to do for itself, as plain functions with the native pieces passed in, so the
// tests can drive them without Capacitor or a device (tests/test-app-shell.mjs). entry-app.jsx is the
// wiring: it hands these @capacitor/app and @capacitor/share. Nothing here reaches the website - build.mjs
// only bundles entry-app.jsx when tools/app/build-app.mjs asks for it.

// The game hears every Back press first, through this event.
export const BACK_EVENT = "ps:back";

// Android's Back button. The game gets first refusal: it closes whatever is open over the screen, or leaves
// the screen for Modes (the handler in perfect-season.jsx), and says so by cancelling the event. What it
// doesn't take, Back does the ordinary way - a screen that pushed a history entry of its own (a profile,
// the shop) goes back to where it was opened from, and Back with nothing left leaves the app, which is what
// Android expects. Returns what it did, for the tests.
export function goBack({ canGoBack } = {}, { win = window, exitApp } = {}) {
  const asked = new win.CustomEvent(BACK_EVENT, { cancelable: true });
  win.dispatchEvent(asked);
  if (asked.defaultPrevented) return "handled";
  if (canGoBack) {
    win.history.back();
    return "back";
  }
  exitApp();
  return "exit";
}

// An Android web view has no navigator.share, so the game would quietly copy to the clipboard instead. This
// is the Web Share API over Android's share sheet, including the part the game reads: closing the sheet
// without sharing is an AbortError, which the game shows no status for - reporting it as success would tell
// a player their season had been shared when they had just decided not to. Any other failure is passed on,
// and the game falls back to copying.
export function nativeShare(share) {
  return async ({ title, text, url } = {}) => {
    try {
      await share({ title, text, url, dialogTitle: title || "Share" });
    } catch (e) {
      const message = String(e?.message || e);
      // "Share canceled" is the Android plugin's word for a dismissed sheet (SharePlugin.activityResult).
      if (!/cancel/i.test(message)) throw e;
      throw typeof DOMException === "function"
        ? new DOMException(message, "AbortError")
        : Object.assign(new Error(message), { name: "AbortError" });
    }
  };
}

// ---------- The system bars ----------
// Drawing under the bars means the page paints behind them, so their icons have to follow what is behind them:
// dark icons on the cream screens, light ones on the play screen's navy and the Leaderboard's black. Android's
// names are the other way round from what you'd guess - "DARK" is a dark screen, and it draws light icons.
export function barStyleFor(color) {
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(String(color));
  if (!rgb) return "DEFAULT"; // an unpainted or unreadable ground: leave the phone's own choice alone
  const [r, g, b] = rgb.slice(1).map(Number);
  // Rec. 601 luma, which is plenty: the only question is whether this ground is light or dark.
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "LIGHT" : "DARK";
}

// Keeps the bars in step with the screen. The app puts its theme scope on the root element's class
// (perfect-season.jsx: .ps, .ps.dark, .ps.night), so watching that one attribute catches every change, and the
// colour is read from the element rather than from a list of scopes - a new scope needs nothing here. `setStyle`
// is SystemBars.setStyle. Returns a function that stops watching, for the tests.
export function followSystemBars(setStyle, { doc = document, view = window, retry = 300 } = {}) {
  let last = null;
  let timer = null;
  let watcher = null;
  const apply = (root) => {
    const style = barStyleFor(view.getComputedStyle(root).backgroundColor);
    if (style === last) return;
    last = style;
    setStyle({ style });
  };
  const start = () => {
    // The root only exists once React has mounted, which is after this runs.
    const root = doc.querySelector(".ps");
    if (!root) { timer = view.setTimeout(start, retry); return; }
    apply(root);
    watcher = new view.MutationObserver(() => apply(root));
    watcher.observe(root, { attributes: true, attributeFilter: ["class"] });
  };
  start();
  return () => {
    if (timer != null) view.clearTimeout(timer);
    if (watcher) watcher.disconnect();
  };
}
