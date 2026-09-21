-- 1v1 (v1.19.0). Contract: VERSUS.md.
--
-- Two players draft from the same boards, alternating, and the second picker's choices depend on what the
-- first one just took - so unlike every other mode, no browser can hold the truth. The picks live here, and
-- only the match-pick Edge Function (service role) ever writes them: it owns every rule that decides a pick,
-- because it needs game-logic.mjs to know what a board holds and what fits a slot.
--
-- What this file owns is the shape, who may read it, and the three things that don't need the game's rules:
-- opening a lobby, joining one, and reading the whole state back after a reload.
--
-- Only adds objects, so it is safe to re-run; running it twice pays nobody twice and drops nothing.
--
-- Runbook:
--   End a match that is stuck:   update public.matches set status = 'abandoned', ended_at = now() where code = 'ABC123';
--   Take a farmed result back:   see VERSUS.md 5 - delete the match row (the picks follow) and decrement
--                                pvp_wins / pvp_losses on the two profiles by hand.

-- ---------- Tables ----------

create table if not exists public.matches (
  id            uuid primary key default gen_random_uuid(),
  -- The shareable half of gridspin.app/vs/<code>, and the seed the eight boards are dealt from - the same way a
  -- challenge code seeds a single-player draft, so one string is the whole match's identity.
  code          text not null unique,
  host_id       uuid not null references auth.users(id) on delete cascade,
  guest_id      uuid references auth.users(id) on delete cascade,
  format        text not null default 'fantasy' check (format in ('fantasy', 'standard')),
  status        text not null default 'open' check (status in ('open', 'drafting', 'done', 'abandoned')),
  -- When the player on the clock loses the pick. The Edge Function reads it; a client that says time is up is
  -- checked against it, never believed.
  turn_deadline timestamptz,
  -- Every re-spin spent: { pickNo, kind, by, key } (VERSUS.md 7). Keyed by the pick it changes the board for -
  -- an odd pickNo is the leader's and moves the board for both players, an even one is the follower's and moves
  -- only their own. This list is what lets a client that reconnects rebuild the boards as they were played.
  respins       jsonb not null default '[]'::jsonb,
  -- Every double dip spent: { boardIdx, by } (VERSUS.md 7). Whoever took two off a board gives up the next one,
  -- so this is what tells a replay that a board is drafted three times and the one after it once.
  dips          jsonb not null default '[]'::jsonb,
  -- Both sides' scores, the parts they were built from, and the football final (VERSUS.md 6) - written once, by
  -- the server, when the sixteenth pick lands. The higher score always wins; nothing here is a coin toss.
  result        jsonb,
  winner_id     uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists matches_host_idx on public.matches (host_id, status);
create index if not exists matches_guest_idx on public.matches (guest_id, status);

create table if not exists public.match_picks (
  match_id   uuid not null references public.matches(id) on delete cascade,
  -- 1 to 16: eight boards, two picks each. The number alone says whose turn it was (VERSUS.md 1's snake order).
  pick_no    integer not null check (pick_no between 1 and 16),
  user_id    uuid not null references auth.users(id) on delete cascade,
  board_idx  integer not null check (board_idx between 0 and 7),
  -- Which of the board's three pools it came from (VERSUS.md 6). Every board carries all three, so a player may
  -- take a defense fifth or a kicker first; the column is what keeps the three from being read as each other.
  kind       text not null default 'player' check (kind in ('player', 'dst', 'k')),
  player_id  integer,  -- a player: his id in data/players.json. Null for a defense or a kicker.
  team       text,     -- a defense or a kicker: whose. Null for a player.
  season     integer not null,
  slot       text not null check (slot in ('QB', 'RB', 'WR', 'TE', 'FLEX1', 'FLEX2', 'DST', 'K')),
  -- The clock made this one, not the player.
  auto       boolean not null default false,
  -- Set when the other player STOLE this pick (VERSUS.md 7): user_id and slot are then the thief's, and this
  -- says who did it. The row is updated rather than a second one written, which is deliberate - the option is
  -- still drafted exactly once, so the two unique constraints below go on meaning what they say.
  stolen_by  uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (match_id, pick_no),
  -- One identity or the other, never both and never neither.
  constraint match_picks_identity check ((kind = 'player') = (player_id is not null)
                                     and (kind in ('dst', 'k')) = (team is not null)),
  -- The rule that makes a 1v1 draft a 1v1 draft: what one player takes from a board is gone, for both sides.
  -- Two constraints because the two identities are different columns; each ignores the other's rows, since a
  -- null never conflicts in a unique index. `kind` is in the second so a team's defense and its kicker from the
  -- same year are not read as the same thing.
  unique (match_id, kind, player_id, season),
  unique (match_id, kind, team, season),
  -- And one player never fills the same slot twice. The two above stop an OPTION being drafted twice; this
  -- stops a roster being overwritten, which is a different write: a steal is the only thing in the game that
  -- rewrites user_id and slot on a row that already exists, so it is the only thing that could put two picks
  -- of one player's in one slot and leave them a slot short at the end - which grades as null and wedges the
  -- match. The rules refuse that already; this is the database refusing it too. Named, because it is added
  -- again below for databases that already have this table.
  constraint match_picks_one_per_slot unique (match_id, user_id, slot)
);

-- Added after the fact for a table that may already exist, since this file is re-run rather than replaced.
alter table public.match_picks add column if not exists stolen_by uuid references auth.users(id) on delete set null;
alter table public.matches add column if not exists dips  jsonb not null default '[]'::jsonb;
-- Steal the pick was cut, and its column goes with it. Dropped rather than left behind: 1v1 has never shipped,
-- so no real match ever wrote to it, and an unexplained empty jsonb column is the kind of thing the next reader
-- spends twenty minutes proving was never wired to anything.
alter table public.matches drop column if exists swaps;
-- The same for the one-slot-per-player constraint, which is in the create above and so would never reach a
-- database that already has the table. Postgres has no `add constraint if not exists`, hence the block.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'match_picks_one_per_slot') then
    alter table public.match_picks add constraint match_picks_one_per_slot unique (match_id, user_id, slot);
  end if;
end $$;

alter table public.matches enable row level security;
alter table public.match_picks enable row level security;

-- A match in progress or finished is public: its result goes on a board, and both players' screens read it
-- constantly. There is no insert, update or delete policy at all, for anyone, so the Edge Function's service
-- role is the only writer.
--
-- An OPEN lobby is the exception, and has to be. Its code IS the invite - the only thing standing between a
-- match and whoever turns up - so a readable `matches` meant anyone could `select code from matches where
-- status = 'open'` and walk into a lobby meant for somebody's friend, as often as they liked. That locks the
-- invited player out, and hands the host a match they did not ask for against a stranger.
--
-- Nothing legitimate is lost: every client reads through match_state, which is security definer and bypasses
-- this, so a player holding the code still sees their lobby whether or not they are in it yet.
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select
  using (status <> 'open' or auth.uid() in (host_id, guest_id));
drop policy if exists match_picks_read on public.match_picks;
create policy match_picks_read on public.match_picks for select using (true);

-- ---------- Records ----------
-- Kept apart from wins and championships on purpose (VERSUS.md 1): a head-to-head result and a 20-0 season are
-- different things, and mixing them would move boards that already mean something.
alter table public.profiles add column if not exists pvp_wins   integer not null default 0;
alter table public.profiles add column if not exists pvp_losses integer not null default 0;

-- ---------- Opening and joining ----------

-- Six characters from an alphabet with no 0/O or 1/I in it, because this code gets read aloud and typed by
-- hand. Retried until unused; the unique index is the real guarantee.
create or replace function public.new_match_code()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  for i in 1..30 loop
    v_code := '';
    for j in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.matches where code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke execute on function public.new_match_code() from public, anon, authenticated;

-- Whether an account may play at all. Guests may not (VERSUS.md 5): a guest account costs nothing to make, so
-- two tabs would farm the board. An account with no profile at all (signed in with Google, no name yet) can't
-- either - there would be nothing to show on the board.
create or replace function public.can_play_versus(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.guest);
$$;
revoke execute on function public.can_play_versus(uuid) from public, anon, authenticated;

-- The match a player is in right now, as JSON: the row plus its picks. One shape for every caller - the lobby,
-- the draft screen and a reload all read this. Stable, so the client asks for it as a GET and gets supabase-js's
-- retry for free (CLAUDE.md, "Reads retry themselves").
create or replace function public.match_state(p_code text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when m.id is null then null else jsonb_build_object(
    'id', m.id, 'code', m.code, 'hostId', m.host_id, 'guestId', m.guest_id,
    'hostName', (select username from public.profiles where id = m.host_id),
    'guestName', (select username from public.profiles where id = m.guest_id),
    'format', m.format, 'status', m.status, 'turnDeadline', m.turn_deadline,
    'respins', m.respins, 'dips', m.dips,
    'result', m.result, 'winnerId', m.winner_id, 'createdAt', m.created_at,
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pickNo', p.pick_no, 'userId', p.user_id, 'boardIdx', p.board_idx, 'kind', p.kind,
        'playerId', p.player_id, 'team', p.team, 'season', p.season, 'slot', p.slot, 'auto', p.auto,
        -- As a SIDE, not an id: this is what a client replays the match from (versus-logic.mjs's replayMatch),
        -- and it thinks in host/guest. Everything else about who is who it can read off the match row.
        'stolenBy', case when p.stolen_by = m.host_id then 'host'
                         when p.stolen_by = m.guest_id then 'guest' end
      ) order by p.pick_no)
      from public.match_picks p where p.match_id = m.id), '[]'::jsonb)
  ) end
  from (select * from public.matches where code = upper(coalesce(p_code, ''))) m;
$$;
grant execute on function public.match_state(text) to anon, authenticated;

-- Opening a lobby. One at a time: asking again gives back the one already waiting, so a double tap doesn't
-- leave a trail of empty lobbies with links nobody will ever open.
-- Returns the match as match_state does, or { error: <code> }: not_signed_in | guest_not_allowed.
create or replace function public.create_match(p_format text default 'fantasy')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_format text := case when p_format in ('fantasy', 'standard') then p_format else 'fantasy' end;
  v_code text;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if not public.can_play_versus(v_uid) then return jsonb_build_object('error', 'guest_not_allowed'); end if;

  -- A match already in progress comes back instead of a new lobby, and on either side of it. Only `open` was
  -- looked for, so a player who went back to Modes mid-draft and tapped 1v1 again got a brand-new lobby to
  -- wait in while the match they had walked away from auto-picked their whole roster for them. There is no
  -- legitimate reason to hold two at once, and this is also how a reconnecting player finds their way back.
  select code into v_code from public.matches
   where status in ('open', 'drafting') and (host_id = v_uid or guest_id = v_uid)
   order by case status when 'drafting' then 0 else 1 end, created_at desc limit 1;
  if v_code is null then
    v_code := public.new_match_code();
    insert into public.matches (code, host_id, format) values (v_code, v_uid, v_format);
  end if;
  return public.match_state(v_code);
end;
$$;
revoke execute on function public.create_match(text) from public, anon;
grant execute on function public.create_match(text) to authenticated;

-- Taking someone's invite. The first person through the link is the opponent; everyone after is told it's full.
-- Returns the match, or { error: <code> }:
--   not_signed_in | guest_not_allowed | not_found | own_match | already_full | already_started
create or replace function public.join_match(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  m public.matches%rowtype;
begin
  if v_uid is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if not public.can_play_versus(v_uid) then return jsonb_build_object('error', 'guest_not_allowed'); end if;

  -- Locked, so two people opening the same link at the same moment can't both become the opponent.
  select * into m from public.matches where code = upper(coalesce(p_code, '')) for update;
  if m.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if m.host_id = v_uid then
    -- The host opening their own link is not an error; they get their lobby back.
    return case when m.status = 'open' then public.match_state(m.code) else jsonb_build_object('error', 'own_match') end;
  end if;
  if m.guest_id is not null then
    return case when m.guest_id = v_uid then public.match_state(m.code) else jsonb_build_object('error', 'already_full') end;
  end if;
  if m.status <> 'open' then return jsonb_build_object('error', 'already_started'); end if;

  update public.matches
     set guest_id = v_uid, status = 'drafting', turn_deadline = now() + interval '45 seconds'
   where id = m.id;
  return public.match_state(m.code);
end;
$$;
revoke execute on function public.join_match(text) from public, anon;
grant execute on function public.join_match(text) to authenticated;

-- ---------- Recording a result ----------

-- The two record columns move together or not at all, which is why this is a function rather than two updates
-- from the Edge Function: a win that didn't record the loss would be a board nobody could explain. Service role
-- only - no client may call it, the same as every other writer of profiles.
create or replace function public.record_versus(p_winner uuid, p_loser uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  with w as (update public.profiles set pvp_wins = pvp_wins + 1 where id = p_winner returning 1)
  update public.profiles set pvp_losses = pvp_losses + 1 where id = p_loser and exists (select 1 from w);
$$;
revoke execute on function public.record_versus(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_versus(uuid, uuid) to service_role;

-- Ending a match: the result and both records, once, in one transaction.
--
-- The Edge Function used to do this as two unguarded calls - write the result, then record_versus - and neither
-- checked its answer. Every way that could go wrong was permanent. A failed record left a match marked done
-- with neither player's record moved and nothing able to retry it, because the function refuses a match that is
-- no longer `drafting`. Retrying the other order double-counted the win instead, since record_versus is a bare
-- increment. And a failed status write left sixteen picks on a `drafting` row, which answers already_finished
-- to every later move: a match nobody can finish, grade or leave.
--
-- One function fixes all of it. The row is locked and re-checked, so whichever caller gets there first is the
-- one that counts and a second is told `already_done` rather than incrementing anything twice; and because the
-- records and the status commit together, a failure leaves the match exactly as it was, for the next call to
-- finish properly.
create or replace function public.finish_match(p_match uuid, p_result jsonb, p_winner uuid, p_loser uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  -- Not an error the caller has to handle: the other screen's clock claim got here first, which is exactly what
  -- is supposed to happen when both players' tabs notice the sixteenth pick at once.
  if m.status <> 'drafting' then return jsonb_build_object('ok', true, 'already_done', true); end if;

  update public.matches
     set status = 'done', result = p_result, winner_id = p_winner,
         ended_at = now(), turn_deadline = null
   where id = p_match;

  -- A draw moves neither, and a match missing a profile on either side moves neither - a win with no
  -- corresponding loss would be a record that never balances.
  if p_winner is not null and p_loser is not null
     and exists (select 1 from public.profiles where id = p_winner)
     and exists (select 1 from public.profiles where id = p_loser) then
    update public.profiles set pvp_wins = pvp_wins + 1 where id = p_winner;
    update public.profiles set pvp_losses = pvp_losses + 1 where id = p_loser;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.finish_match(uuid, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_match(uuid, jsonb, uuid, uuid) to service_role;

-- The 1v1 board (VERSUS.md 10): ranked by wins, then by how few losses they took getting them, then by name so
-- the order is fully tiebroken - the rule every other board here follows. Only accounts that have played one
-- appear. Stable, so the client asks for it as a GET and gets supabase-js's retry for free.
--
-- 1v1's own function rather than a column in site_stats(): that one is mirrored by tests/helpers.mjs and held
-- to the SQL by tests/test-runs-sql.mjs, and a head-to-head board has nothing to do with the runs log.
create or replace function public.versus_top(p_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row), '[]'::jsonb) from (
    select jsonb_build_object(
      'username', p.username, 'wins', p.pvp_wins, 'losses', p.pvp_losses,
      'pct', case when p.pvp_wins + p.pvp_losses > 0
                  then round((100.0 * p.pvp_wins / (p.pvp_wins + p.pvp_losses))::numeric, 0)::int end
    ) as row
    from public.profiles p
    where p.pvp_wins + p.pvp_losses > 0 and not p.guest
    order by p.pvp_wins desc, p.pvp_losses asc, p.username asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) top;
$$;
grant execute on function public.versus_top(integer) to anon, authenticated;

-- Realtime carries every change on these two tables to both screens (VERSUS.md 2). Adding them to the
-- publication is what makes that happen; it is idempotent, and a table already in it is left alone.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
      alter publication supabase_realtime add table public.matches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_picks') then
      alter publication supabase_realtime add table public.match_picks;
    end if;
  end if;
end;
$$;

-- REPLICA IDENTITY FULL, which Realtime needs to do its half of the job here. Both tables have RLS on, and
-- Realtime evaluates that policy per subscriber before it delivers anything - so it has to be able to see the
-- columns the policy names. With the default identity an UPDATE carries only the primary key in its old
-- record, and `matches`' policy reads `status`, `host_id` and `guest_id`: none of which are the primary key.
-- The cost is write amplification on the WAL, which for two tables holding a handful of rows each is nothing,
-- and the alternative is a socket that silently delivers nothing and a match that only moves when the poll
-- gets round to it.
alter table public.matches replica identity full;
alter table public.match_picks replica identity full;
