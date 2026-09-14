// Bundles the UI harness (tools/ui-harness/harness.jsx) into build/ui-harness.js. Separate from
// build.mjs on purpose: this bundle carries the in-memory Supabase mock and must never ship.
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tools/ui-harness/harness.jsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  outfile: "build/ui-harness.js",
  define: {
    "process.env.NODE_ENV": '"production"',
    SUPABASE_URL: '""',
    SUPABASE_ANON_KEY: '""',
    APP_VERSION: '"harness"',
    // "staging" shows the Test site banner; production layout is the default being audited.
    APP_ENV: JSON.stringify(process.env.APP_ENV === "staging" ? "staging" : "production"),
  },
});
console.log("Built build/ui-harness.js - open tools/ui-harness/harness.html");
