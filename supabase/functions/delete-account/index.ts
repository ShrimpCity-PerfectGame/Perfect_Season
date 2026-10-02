// Closing an account: the three steps SQL cannot do by itself, in the one order that works.
//
// public.delete_account (migration-profiles.sql) does the database half and explains why it ANONYMISES rather
// than deletes - the short version is that every foreign key from a player cascades, so a real delete takes
// the other player's half of every duel, shrinks every sitewide total, and pays a stranger a gold badge,
// because the daily rank behind `daily-winner` is computed live from who else played that day.
//
// What is left over needs a service role and a storage client, so it lives here:
//
//   1. THE PICTURE, FIRST. It is in a PUBLIC bucket and it is the most personal thing the game holds. SQL
//      cannot reach storage, so delete_account hands back the path - and it can only do that before it
//      deletes profile_details, which is the only record of whose file it was. Delete the object, then call
//      the function. The other order orphans the picture permanently, readable by anyone who had the link.
//      In practice this reads the folder rather than trusting one path, because an upload that failed
//      halfway can leave a file the row never pointed at (storage-profile.js's clearLeftovers, same idea).
//   2. THE DATABASE. delete_account, with the service role so it works for the by-hand route too.
//   3. THE SIGN-IN. auth.users belongs to Supabase, so the email comes off through the admin API and the
//      account is then SOFT-deleted. Soft is not a half-measure here, it is the whole design: a hard delete
//      removes the auth.users row, and that is exactly what every cascade is anchored to. shouldSoftDelete
//      keeps the row (setting deleted_at and disabling the account), so the games survive and nobody can
//      sign in again.
//
// The address is replaced rather than blanked, because an auth user needs one: a .invalid address (RFC 2606)
// can never receive mail and identifies nobody. The username that signup stored in user_metadata goes too.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AVATAR_BUCKET = "avatars";

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    return await handle(req, json);
  } catch (e) {
    console.error("delete-account:", e);
    return json({ error: "failed to close the account", reason: "server" }, 500);
  }
});

async function handle(req: Request, json: (body: unknown, status?: number) => Response) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized", reason: "signed_out" }, 401);
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized", reason: "signed_out" }, 401);

  // Only ever the caller's own account. There is no id in the body on purpose: the one thing this function
  // must never become is a way to close somebody else's. The by-hand route (a request to the address on
  // /privacy) calls the SQL function directly with the service role instead - see PROFILES.md's runbook.
  const uid = user.id;
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. The picture, before the row that names it. Everything under <uid>/ - an upload that failed halfway can
  // leave a file profile_details never pointed at, and a deletion that misses it leaves a readable photo.
  const { data: files, error: listError } = await service.storage.from(AVATAR_BUCKET).list(uid, { limit: 100 });
  if (listError) {
    console.error("delete-account list:", listError);
    return json({ error: "failed to close the account", reason: "server" }, 500);
  }
  if (files && files.length) {
    const paths = files.map((f) => `${uid}/${f.name}`);
    const { error: rmError } = await service.storage.from(AVATAR_BUCKET).remove(paths);
    // A picture left behind is the one failure worth refusing over: it is public, and the row that says whose
    // it is goes away in the next step. Better to answer "try again" than to erase the only pointer to it.
    if (rmError) {
      console.error("delete-account remove:", rmError);
      return json({ error: "failed to close the account", reason: "server" }, 500);
    }
  }

  // 2. The database.
  const { data: closed, error: rpcError } = await service.rpc("delete_account", { p_user: uid });
  if (rpcError) {
    console.error("delete-account rpc:", rpcError);
    return json({ error: "failed to close the account", reason: "server" }, 500);
  }
  if (closed?.error) return json({ error: "could not close the account", reason: closed.error }, 400);

  // 3. The sign-in. Both halves are best-effort in the sense that the account is ALREADY anonymous by now -
  // so a failure here is logged and reported rather than silently swallowed, but nothing is left half-done in
  // the database. The player is told to write in if it happens.
  const scrubbed = `deleted-${uid}@gridspin.invalid`;
  const { error: updateError } = await service.auth.admin.updateUserById(uid, {
    email: scrubbed,
    user_metadata: {},
    app_metadata: {},
  });
  if (updateError) console.error("delete-account scrub:", updateError);

  // shouldSoftDelete: true keeps the auth.users row. A hard delete here would cascade every table the SQL
  // function just took such care to preserve.
  const { error: softError } = await service.auth.admin.deleteUser(uid, true);
  if (softError) console.error("delete-account soft delete:", softError);

  if (updateError || softError) {
    return json({
      error: "the account is closed, but the sign-in could not be removed",
      reason: "signin_left",
      name: closed?.name ?? null,
    }, 500);
  }
  return json({ ok: true, name: closed?.name ?? null });
}
