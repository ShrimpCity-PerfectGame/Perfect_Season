// The Android app's entry point. It is the website's entry (entry.jsx mounts the same game, against the same
// Supabase project) plus the two things a phone app has to do for itself:
//
//   - the hardware Back button, which a web view knows nothing about;
//   - the system share sheet, since an Android web view has no navigator.share, and the game's own share would
//     silently fall back to copying to the clipboard;
//   - the status and gesture bars, which the page now draws under and so has to keep readable.
//
// All three live in app-shell.mjs, where the tests can drive them; this file is only the wiring to
// Capacitor. Nothing here runs on the website: build.mjs only uses this entry when tools/app/build-app.mjs
// asks for it (APP_ENTRY), so the site's bundle never carries Capacitor.
import "./entry.jsx";
import { registerPlugin } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Share } from "@capacitor/share";
import { followSystemBars, goBack, nativeShare } from "./app-shell.mjs";

NativeApp.addListener("backButton", (info) => goBack(info, { exitApp: () => NativeApp.exitApp() }));

if (!navigator.share) navigator.share = nativeShare((options) => Share.share(options));

// Capacitor's own plugin, built into the Android library rather than a package of its own.
const SystemBars = registerPlugin("SystemBars");
// Never fatal: bars that keep the phone's own icon colour are a blemish, not a broken game.
followSystemBars((options) => SystemBars.setStyle(options).catch((e) => console.warn("SystemBars.setStyle:", e)));
