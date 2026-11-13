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
--   pack     pulled from a bought pack (ref: '<open id>:<n>') - only buy_pack below grants these
alter table public.card_grants drop constraint if exists card_grants_kind_check;
alter table public.card_grants add constraint card_grants_kind_check check (kind in ('starter', 'daily', 'gift', 'pack'));

-- The wallet's ledger learns a kind too: 'pack', a pack bought with coins. Its check is an INLINE one in
-- migration-wallet.sql's create table, which that file can never change on a database that already has the
-- table - so it is replaced here, by the name Postgres gave it (wallet_ledger_kind_check; confirmed on PGlite
-- and on the staging project). The list is the whole list: every kind migration-wallet.sql names, plus this.
-- Dropped by what it IS rather than by what it is called: a check on that table whose definition is the list of
-- kinds. If a database ever named it differently, dropping by name would do nothing, the old list would stay
-- beside the new one, and every pack purchase would fail on it - as a 500, which the screen calls "try again".
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.wallet_ledger'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%' and pg_get_constraintdef(oid) like '%''season''%'
  loop
    execute format('alter table public.wallet_ledger drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check
  check (kind in ('starting', 'welcome', 'season', 'daily', 'badge', 'minigame', 'purchase', 'pack'));

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

  if p_kind is null or p_kind not in ('starter', 'daily', 'gift', 'pack')
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

-- ============================================================================================================
-- Packs (v2.24.0). See CARDS.md 9.
--
-- WHAT IS IN A PACK IS NOT HERE. A pack's cards and odds are card-packs.mjs, which the browser prints and the
-- card-claim Edge Function rolls - one definition, so what is read is what is rolled. This table holds what an
-- owner changes without a release: the price, whether a pack is on sale, and a limited pack's stock.
--
-- `size` is the one thing held in both places, on purpose: buy_pack refuses a purchase that is not exactly that
-- many cards, so a function with a bug cannot grant twenty. tests/test-cards-sql.mjs holds it to the module.
--
-- Prices are public, like the shop's: anyone may read this table, nobody may write it.
create table if not exists public.card_packs (
  id          text primary key check (id ~ '^pack-[a-z0-9-]{1,40}$'),
  price       integer not null check (price > 0),
  size        integer not null check (size between 1 and 10),
  active      boolean not null default true,
  stock_total integer check (stock_total > 0),          -- null: not limited
  stock_left  integer check (stock_left >= 0),          -- null: not limited
  sort        integer not null default 0,
  check ((stock_total is null) = (stock_left is null))
);
alter table public.card_packs enable row level security;
drop policy if exists "packs are publicly readable" on public.card_packs;
create policy "packs are publicly readable" on public.card_packs for select using (true);
revoke insert, update, delete, truncate on public.card_packs from anon, authenticated;
grant select on public.card_packs to anon, authenticated;

-- The seed only ADDS missing rows, like shop_items': a price changed by hand survives a re-run. Edit it here
-- too when changing one, so a new database starts where the live ones are.
--
-- The prices are MEASURED, not guessed: tests/test-economy-security.mjs prints what a day of play buys and what
-- a card rated 100+ costs by each route, and holds them to bands. Legends is 3,000 because a 100+ card costs
-- about 3,960 coins through Standard packs and about 2,375 through Air raid; at the 1,500 first written here
-- the one pack that is CERTAIN to hold one was also the cheapest way to get one, by a wide margin.
insert into public.card_packs (id, price, size, stock_total, stock_left, sort) values
  ('pack-standard', 150, 3, null, null, 10),
  ('pack-air-raid', 250, 3, null, null, 20),
  ('pack-legends', 3000, 1, 5000, 5000, 30)
on conflict (id) do nothing;

-- buy_pack(user, pack, open id, cards): the stock, the coins and the cards, in ONE transaction.
--
-- The card-claim Edge Function has already chosen the cards (card-packs.mjs's rollPack, with a cryptographic
-- generator) and hands them over; everything that must not be the caller's word is decided here:
--   - the PRICE is this table's, read now. p_price is what the buyer's screen SHOWED: a pack that has since
--     become dearer is refused (price_changed) rather than charged at a price nobody agreed to. Cheaper is
--     simply charged cheaper. Null skips the question - for a caller with no screen.
--   - the STOCK is taken under a lock on the pack's row, so two buyers of the last one take turns.
--   - the COUNT of cards must be exactly the pack's size.
--   - the DEBIT goes through wallet_apply under (user, 'pack', open id), which is unique.
-- A raise anywhere rolls the whole call back: no coins without cards, no cards without coins.
--
-- THE OPEN ID IS WHAT MAKES A RETRY SAFE. The browser makes one per purchase and re-sends it if the answer
-- never arrives. A second call with an id that has already been charged changes nothing and answers with the
-- cards granted the FIRST time (the function rolled fresh ones for the retry; they are ignored), so a dropped
-- response or a double tap is one pack, shown once.
--
-- It returns { duplicate, cards: [{ card, finish }], balance, stock_left, price } and raises, in this order:
--   no_profile, guest_not_allowed, bad_open, unavailable (no such pack, or off sale), bad_grant (not exactly
--   `size` well-formed cards), sold_out, price_changed, not_enough, purchase_conflict.
-- wallet_lock comes before anything is decided on the balance, as in every function that moves coins.
drop function if exists public.buy_pack(uuid, text, text, jsonb);
create or replace function public.buy_pack(p_user uuid, p_pack text, p_open text, p_cards jsonb, p_price integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_balance bigint;
  v_granted jsonb;
  v_pack public.card_packs;
  v_entry jsonb;
  v_grants jsonb := '[]'::jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_i integer := 0;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  -- 8 to 36 characters: a uuid fits, and '<open>:<n>' still fits card_grants.ref's 40. No character that means
  -- anything to LIKE, because the duplicate answer below finds this open's cards by prefix.
  if p_open is null or p_open !~ '^[A-Za-z0-9-]{8,36}$' then
    raise exception 'bad_open' using errcode = 'P0001';
  end if;

  v_balance := public.wallet_lock(p_user);

  if exists (select 1 from public.wallet_ledger where user_id = p_user and kind = 'pack' and ref = p_open) then
    select coalesce(jsonb_agg(jsonb_build_object('card', g.card_id, 'finish', g.finish) order by g.ref), '[]'::jsonb)
      into v_cards
      from public.card_grants g
     where g.user_id = p_user and g.kind = 'pack' and g.ref like p_open || ':%';
    return jsonb_build_object('duplicate', true, 'cards', v_cards, 'balance', v_balance,
      'stock_left', (select stock_left from public.card_packs where id = p_pack), 'price', null);
  end if;

  select * into v_pack from public.card_packs where id = p_pack for update;
  if not found or not v_pack.active then
    raise exception 'unavailable' using errcode = 'P0001';
  end if;

  if p_cards is null or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) <> v_pack.size then
    raise exception 'bad_grant' using errcode = 'P0001';
  end if;
  for v_entry in select * from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(v_entry) <> 'object'
       or jsonb_typeof(v_entry -> 'card') is distinct from 'number'
       or (v_entry ->> 'card') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(v_entry -> 'finish') is distinct from 'string'
       or (v_entry ->> 'finish') not in ('base', 'silver', 'gold', 'prism') then
      raise exception 'bad_grant' using errcode = 'P0001';
    end if;
    v_grants := v_grants || jsonb_build_object('ref', p_open || ':' || v_i, 'card', (v_entry ->> 'card')::integer, 'finish', v_entry ->> 'finish');
    v_cards := v_cards || jsonb_build_object('card', (v_entry ->> 'card')::integer, 'finish', v_entry ->> 'finish');
    v_i := v_i + 1;
  end loop;

  if v_pack.stock_left is not null and v_pack.stock_left <= 0 then
    raise exception 'sold_out' using errcode = 'P0001';
  end if;
  if p_price is not null and v_pack.price > p_price then
    raise exception 'price_changed' using errcode = 'P0001';
  end if;
  if v_balance < v_pack.price then
    raise exception 'not_enough' using errcode = 'P0001';
  end if;

  update public.card_packs set stock_left = stock_left - 1 where id = p_pack and stock_left is not null;
  -- "is distinct from", as in shop_buy: wallet_apply answers 0 when the ledger already holds this key, which
  -- the check above has just ruled out, so anything but the full debit is rows edited by hand - and carrying
  -- on would hand over cards without charging for them.
  if public.wallet_apply(p_user, -v_pack.price, 'pack', p_open) is distinct from (-v_pack.price)::bigint then
    raise exception 'purchase_conflict' using errcode = 'P0001';
  end if;
  -- grant_cards skips a ref it has granted before. Nothing honest leaves '<open>:n' behind without its ledger
  -- row, but rows edited by hand could - and then this would charge in full and hand over fewer cards than it
  -- reports. Short means stop: the raise undoes the stock and the debit with it.
  v_granted := public.grant_cards(p_user, 'pack', v_grants);
  if jsonb_array_length(coalesce(v_granted -> 'granted', '[]'::jsonb)) <> v_pack.size then
    raise exception 'purchase_conflict' using errcode = 'P0001';
  end if;

  return jsonb_build_object('duplicate', false, 'cards', v_cards,
    'balance', (select balance from public.wallets where user_id = p_user),
    'stock_left', (select stock_left from public.card_packs where id = p_pack),
    'price', v_pack.price);
end;
$$;

revoke all on function public.buy_pack(uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.buy_pack(uuid, text, text, jsonb, integer) to service_role;
