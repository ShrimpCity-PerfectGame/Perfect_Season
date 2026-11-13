-- Cards: who owns what (v2.23.0). See CARDS.md.
--
-- Run it AFTER migration-shop.sql, then re-run migration-profiles.sql (delete_account learns to erase cards).
-- Safe to re-run: every object is "if not exists" or "create or replace", and each policy is dropped before it
-- is made. It reads public.profiles and nothing else, and nothing here is read by a `language sql` function,
-- so no other migration's creation depends on it.
--
-- TWO TABLES, AND NO BROWSER WRITES EITHER. RLS is on with a single SELECT policy each (your own rows) and no
-- insert, update or delete policy at all - the shape wallets, inventory and century_runs already have. A card
-- is worth something to the player holding it, so "which cards do I own" must not be a thing a modified
-- browser can state. The only writer is grant_cards below, and only service_role may execute it: the
-- card-claim Edge Function for a starter deck, submit-run for the daily card.
--
--   card_owned   what a player holds: one row per (card, finish), with a count. Copies stack.
--   card_grants  the ledger: one row per card ever handed out, under a unique (user, kind, ref).
--
-- WHY A LEDGER AS WELL AS A COUNT. The unique key on card_grants is what makes a grant happen ONCE. A starter
-- deck is the refs 'starter:0' .. 'starter:7'; a daily card is the ref '<date>'. A second tab, a retried
-- request, a daily finished in the other scoring format - each arrives with a ref that is already taken and
-- changes nothing. It is the same idea as wallet_ledger's unique (user, kind, ref), for the same reason, and
-- like that table it also answers "where did this card come from" after the fact.
--
-- card_id is a number out of data/cards.json, the frozen catalog. There is deliberately no cards table here
-- and no foreign key: the catalog is a file both the browser and the Edge Functions carry, and the functions
-- are what choose a card, so they are what guarantee the id is real.

create table if not exists public.card_owned (
  user_id  uuid not null references auth.users (id) on delete cascade,
  card_id  integer not null check (card_id > 0),
  finish   text not null check (finish in ('base', 'silver', 'gold', 'prism')),
  count    integer not null check (count > 0),
  first_at timestamptz not null default now(),
  primary key (user_id, card_id, finish)
);

create table if not exists public.card_grants (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  ref        text not null check (char_length(ref) between 1 and 40),
  card_id    integer not null check (card_id > 0),
  finish     text not null check (finish in ('base', 'silver', 'gold', 'prism')),
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);

-- The kinds a card can be granted under. A NAMED constraint, dropped and re-added on every run, because
-- `create table if not exists` leaves an existing table's checks exactly as they were: an inline check here
-- could never learn a new kind, and the next plan adds one (packs). The same trap shop_items.kind and
-- guess_runs.tries each fell into once.
--   starter  the eight cards of a starter deck (refs starter:0 .. starter:7)
--   daily    the card a finished daily draft earns (ref: the date)
--   gift     handed out by hand, from the SQL editor (ref: anything unique for that player) - see CARDS.md 8.6
alter table public.card_grants drop constraint if exists card_grants_kind_check;
alter table public.card_grants add constraint card_grants_kind_check check (kind in ('starter', 'daily', 'gift'));

alter table public.card_owned enable row level security;
alter table public.card_grants enable row level security;

drop policy if exists "a player reads their own cards" on public.card_owned;
create policy "a player reads their own cards" on public.card_owned
  for select using (auth.uid() = user_id);
drop policy if exists "a player reads their own card grants" on public.card_grants;
create policy "a player reads their own card grants" on public.card_grants
  for select using (auth.uid() = user_id);

-- Supabase grants the client roles everything on a new table by default and leaves RLS to say no. Take the
-- writes away outright as well, so the answer does not rest on a policy nobody wrote.
revoke insert, update, delete, truncate on public.card_owned from anon, authenticated;
revoke insert, update, delete, truncate on public.card_grants from anon, authenticated;
grant select on public.card_owned to anon, authenticated;
grant select on public.card_grants to anon, authenticated;
revoke all on sequence public.card_grants_id_seq from anon, authenticated;

-- grant_cards(user, kind, grants): hand a player cards, each exactly once.
--
-- p_grants is a JSON list of { "ref": text, "card": integer, "finish": text }, at most twenty. For each entry
-- the ledger row is inserted "on conflict do nothing"; only when that insert really happened is the card added
-- to card_owned. So the return says what was NEW:
--
--   { "granted": [ { ref, card, finish }, ... ], "duplicate": true|false }
--
-- `duplicate` is true only when something was asked for and none of it was new - the whole claim had already
-- been made. An empty list is just empty.
--
-- It refuses, by raising (errcode P0001, the message is the reason):
--   no_profile         the account has no profile row (a Google sign-in that has not picked a name)
--   guest_not_allowed  a guest account. Cards are for accounts, like the shop: a guest costs nothing to make
--   bad_grant          anything malformed - not a list, too long, a bad ref, card or finish, an unknown kind
--
-- EXACTLY ONCE, UNDER REAL CONCURRENCY. Two transactions granting the same (user, kind, ref) at the same moment:
-- the second's `insert ... on conflict do nothing` waits on the first's uncommitted row, then inserts nothing
-- and returns no id, so it adds no card; the count's own upsert is row-locked. Refs are walked in the order
-- given and every caller gives a starter deck's in the same order, so two claims cannot deadlock.
-- tests/test-cards-sql.mjs cannot show this - PGlite is one connection - so it is argued here.
--
-- EVERYTHING IS CHECKED BEFORE ANYTHING IS WRITTEN, and a raise rolls back the call, so a list with one bad
-- entry in it grants nothing. The Edge Functions build these lists themselves and never send a bad one; the
-- checks are here because this function is the boundary and they are not.
create or replace function public.grant_cards(p_user uuid, p_kind text, p_grants jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_entry jsonb;
  v_ref text;
  v_card integer;
  v_finish text;
  v_new bigint;
  v_granted jsonb := '[]'::jsonb;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;

  if p_kind is null or p_kind not in ('starter', 'daily', 'gift')
     or p_grants is null or jsonb_typeof(p_grants) <> 'array' or jsonb_array_length(p_grants) > 20 then
    raise exception 'bad_grant' using errcode = 'P0001';
  end if;
  for v_entry in select * from jsonb_array_elements(p_grants) loop
    if jsonb_typeof(v_entry) <> 'object'
       or jsonb_typeof(v_entry -> 'ref') is distinct from 'string'
       or char_length(v_entry ->> 'ref') not between 1 and 40
       or jsonb_typeof(v_entry -> 'card') is distinct from 'number'
       or (v_entry ->> 'card') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(v_entry -> 'finish') is distinct from 'string'
       or (v_entry ->> 'finish') not in ('base', 'silver', 'gold', 'prism') then
      raise exception 'bad_grant' using errcode = 'P0001';
    end if;
  end loop;

  for v_entry in select * from jsonb_array_elements(p_grants) loop
    v_ref := v_entry ->> 'ref';
    v_card := (v_entry ->> 'card')::integer;
    v_finish := v_entry ->> 'finish';
    v_new := null;
    insert into public.card_grants (user_id, kind, ref, card_id, finish)
    values (p_user, p_kind, v_ref, v_card, v_finish)
    on conflict (user_id, kind, ref) do nothing
    returning id into v_new;
    if v_new is not null then
      insert into public.card_owned (user_id, card_id, finish, count)
      values (p_user, v_card, v_finish, 1)
      on conflict (user_id, card_id, finish) do update set count = public.card_owned.count + 1;
      v_granted := v_granted || jsonb_build_object('ref', v_ref, 'card', v_card, 'finish', v_finish);
    end if;
  end loop;

  return jsonb_build_object(
    'granted', v_granted,
    'duplicate', jsonb_array_length(p_grants) > 0 and jsonb_array_length(v_granted) = 0
  );
end;
$$;

revoke all on function public.grant_cards(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.grant_cards(uuid, text, jsonb) to service_role;
