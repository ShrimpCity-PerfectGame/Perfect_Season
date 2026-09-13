// Deploys the submit-run Edge Function to one environment's Supabase project.
//
// A Node script rather than an npm script with `$VAR` in it, for the same reason build.mjs is one:
// npm runs scripts through cmd.exe on Windows, where `$VAR` is not expanded and the CLI silently
// receives the literal string. Reading the env var here works identically everywhere.
//
// Usage: node deploy-function.mjs staging|production
//   staging    -> STAGING_PROJECT_REF
//   production -> PROD_PROJECT_REF
import { spawnSync } from "node:child_process";

const target = process.argv[2];
const REF_VAR = { staging: "STAGING_PROJECT_REF", production: "PROD_PROJECT_REF" }[target];
if (!REF_VAR) {
  console.error(`Usage: node deploy-function.mjs staging|production (got ${JSON.stringify(target)})`);
  process.exit(1);
}

const ref = process.env[REF_VAR];
if (!ref) {
  console.error(`${REF_VAR} is not set - it must be the target project's ref (20 lowercase letters).`);
  process.exit(1);
}
// Catch a malformed ref here rather than after a round trip to the API.
if (!/^[a-z]{20}$/.test(ref)) {
  console.error(`${REF_VAR}="${ref}" doesn't look like a project ref (expected 20 lowercase letters).`);
  process.exit(1);
}

console.log(`Deploying submit-run to ${target} (${ref})...`);
// --no-verify-jwt: the platform's own JWT gate runs before the function body and would reject the
// credential-less CORS preflight. The function checks the caller's JWT itself - see index.ts.
const r = spawnSync("npx", ["supabase", "functions", "deploy", "submit-run", "--no-verify-jwt", "--project-ref", ref], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
