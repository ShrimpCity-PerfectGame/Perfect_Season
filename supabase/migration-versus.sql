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
  -- The shareable half of gridspin.app/vs/<code>, and the seed the six boards are dealt from - the same way a
  -- challenge code seeds a single-player draft, so one string is the whole match's identity.
  code          text not null unique,
  host_id       uuid not null references auth.users(id) on delete cascade,
  guest_id      uuid references auth.users(id) on delete cascade,
  format        text not null default 'fantasy' check (format in ('fantasy', 'standard')),
  status        text not null default 'open' check (status in ('open', 'drafting', 'done', 'abandoned')),
  -- When the player on the clock loses the pick. The Edge Function reads it; a client that says time is up is
  -- checked against it, never believed.
  turn_deadline timestamptz,
  -- { hostScore, guestScore, winner, margin } - written once, by the server, when the twelfth pick lands.
  result        jsonb,
  winner_id     uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  ended_at      timestamptz
);
create index if not exists matches_host_idx on public.matches (host_id, status);
create index if not exists matches_guest_idx on public.matches (guest_id, status);

create table if not exists public.match_picks (
  match_id   uuid not null references public.matches(id) on delete cascade,
  -- 1 to 12: six boards, two picks each. The number alone says whose turn it was (VERSUS.md 1's snake order).
  pick_no    integer not null check (pick_no between 1 and 12),
  user_id    uuid not null references auth.users(id) on delete cascade,
  board_idx  integer not null check (board_idx between 0 and 5),
  player_id  integer not null,
  season     integer not null,
  slot       text not null check (slot in ('QB', 'RB', 'WR', 'TE', 'FLEX1', 'FLEX2')),
  -- The clock made this one, not the player.
  auto       boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, pick_no),
  -- The rule that makes a 1v1 draft a 1v1 draft: a player taken from a board is gone, for both sides.
  unique (match_id, player_id, season)
);

alter table public.matches enable row level security;
alter table public.match_picks enable row level security;

-- A match is public the moment it exists: its result goes on a board, and both players' screens read it
-- constantly. Nothing about it is private - and there is no insert, update or delete policy at all, for
-- anyone, so the Edge Function's service role is the only writer.
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select using (true);
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
    'result', m.result, 'winnerId', m.winner_id, 'createdAt', m.created_at,
    'picks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pickNo', p.pick_no, 'userId', p.user_id, 'boardIdx', p.board_idx,
        'playerId', p.player_id, 'season', p.season, 'slot', p.slot, 'auto', p.auto
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

  select code into v_code from public.matches
   where host_id = v_uid and status = 'open' order by created_at desc limit 1;
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

-- Realtime carries every change on these two tables to both screens (VERSUS.md 2). Adding them to the
-- publication is what makes that happen; it is idempotent, and a table already in it is left alone.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'matches') then
      alter publication supabase_realtime add table public.matches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'match_picks') then
      alter publication supabase_realtime add table public.match_picks;
    end if;
  end if;
end;
$$;
