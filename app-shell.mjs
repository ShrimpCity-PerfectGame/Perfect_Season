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
