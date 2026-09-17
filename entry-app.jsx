// The Android app's entry point. It is the website's entry (entry.jsx mounts the same game, against the same
// Supabase project) plus the two things a phone app has to do for itself:
//
//   - the hardware Back button, which a web view knows nothing about;
//   - the system share sheet, since an Android web view has no navigator.share, and the game's own share would
//     silently fall back to copying to the clipboard.
//
// Nothing here runs on the website: build.mjs only uses this entry when tools/app/build-app.mjs asks for it
// (APP_ENTRY), so the site's bundle never carries Capacitor.
import "./entry.jsx";
import { App as NativeApp } from "@capacitor/app";
import { Share } from "@capacitor/share";

// Back goes back through the game's own screens (a profile, the shop, the Leaderboard - see pathFor in
// perfect-season.jsx). With nothing left to go back to, Back leaves the app, which is what Android expects.
NativeApp.addListener("backButton", ({ canGoBack }) => {
  if (canGoBack) window.history.back();
  else NativeApp.exitApp();
});

// The game asks for navigator.share first and copies to the clipboard when it isn't there. Giving the web view
// one that opens Android's share sheet means a shared season goes out the normal way.
if (!navigator.share) {
  navigator.share = async ({ title, text, url } = {}) => {
    try {
      await Share.share({ title, text, url, dialogTitle: title || "Share" });
    } catch (e) {
      // Dismissing the sheet is not a failure: reporting it as one would make the game copy the text to the
      // clipboard instead and tell the player it had copied something they chose not to share.
      if (/cancel/i.test(String(e?.message || e))) return;
      throw e;
    }
  };
}
