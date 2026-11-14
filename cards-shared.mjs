// What the card screens borrow from the page that loads them. See CARDS.md 15.
//
// The card screens are a file of their own (public/cards.js, built by build.mjs from cards.jsx) that the page
// fetches the first time somebody opens Cards. That file must not carry a second React, a second Supabase
// client or a second game-logic.mjs - two Reacts break hooks outright, and a second game-logic would have its
// own empty BOARDS - so every import it makes of a module that is NOT one of the card files is answered from
// this table instead, at run time, by the page that is already running.
//
// THE KEYS ARE THE IMPORT SPECIFIERS, exactly as the card files write them. build.mjs reads this file's keys
// and fails the build if a card file imports something that is neither a card file nor listed here - so a new
// import cannot quietly become a second copy. Namespaces rather than picked names: an `import *` object is
// live, which is what keeps game-logic's `export let BOARDS` current after initGameData runs.
//
// In the tests and the UI harness the card screens are bundled in with everything else (esbuild inlines the
// dynamic import), nothing reads this table, and setting it costs nothing.
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as storage from "./storage.js";
import * as gameLogic from "./game-logic.mjs";
import * as rewards from "./rewards.mjs";
import * as cosmetics from "./cosmetics.jsx";

export const CARDS_SHARED = {
  "react": React,
  "react/jsx-runtime": JsxRuntime,
  "./storage.js": storage,
  "./game-logic.mjs": gameLogic,
  "./rewards.mjs": rewards,
  "./cosmetics.jsx": cosmetics,
};

if (typeof globalThis !== "undefined") globalThis.__ps_shared__ = CARDS_SHARED;
