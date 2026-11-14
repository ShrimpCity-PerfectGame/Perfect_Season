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
-- THE WHOLE LIST, HERE TOO (v2.28.1). This file replaces the check again further down, as battles added kinds,
-- and this first replacement used to list only the kinds that existed when packs shipped. Re-running the file
-- on a database that already HELD a 'card_win' row then failed right here - the intermediate check is validated
-- against every row - and took the whole migration with it. It happened on staging the first time somebody had
-- won a battle. Both lists are now the same list; add a kind to both.
alter table public.wallet_ledger add constraint wallet_ledger_kind_check
  check (kind in ('starting', 'welcome', 'season', 'daily', 'badge', 'minigame', 'purchase', 'pack', 'card_win', 'card_sell', 'card_gauntlet'));

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
-- p_grants is a JSON list of { "ref": text, "card": integer, "finish": text }, at most forty (a starter fill is up to thirty). For each entry
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
-- A COPY IS SOLD, NOT STACKED (v2.26.0, CARDS.md 12). An entry may carry "sell": the coins a copy of that card
-- is worth to its holder (rewards.mjs's cardSellCoins - the Edge Functions know the card's rating; this database
-- holds no catalog). When the account ALREADY holds that card in that finish, the grant still happens once -
-- its ledger row is written - but the count does not move: the coins are credited instead, under the wallet
-- ledger's (user, 'card_sell', '<kind>:<ref>'), and the entry comes back with "sold": <coins>. An entry with
-- no "sell" stacks as it always did, which is what a hand-out from the SQL editor does.
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
  v_sell integer;
  v_granted jsonb := '[]'::jsonb;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;

  if p_kind is null or p_kind not in ('starter', 'daily', 'gift', 'pack')
     or p_grants is null or jsonb_typeof(p_grants) <> 'array' or jsonb_array_length(p_grants) > 40 then
    raise exception 'bad_grant' using errcode = 'P0001';
  end if;
  for v_entry in select * from jsonb_array_elements(p_grants) loop
    if jsonb_typeof(v_entry) <> 'object'
       or jsonb_typeof(v_entry -> 'ref') is distinct from 'string'
       or char_length(v_entry ->> 'ref') not between 1 and 40
       or jsonb_typeof(v_entry -> 'card') is distinct from 'number'
       or (v_entry ->> 'card') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(v_entry -> 'finish') is distinct from 'string'
       or (v_entry ->> 'finish') not in ('base', 'silver', 'gold', 'prism')
       -- "sell" may be left out or null; when it is there it is a whole number of coins no card is worth more than
       or (jsonb_typeof(v_entry -> 'sell') is not null and jsonb_typeof(v_entry -> 'sell') not in ('null', 'number'))
       or (jsonb_typeof(v_entry -> 'sell') = 'number' and ((v_entry ->> 'sell') !~ '^[0-9]{1,5}$' or (v_entry ->> 'sell')::integer > 20000)) then
      raise exception 'bad_grant' using errcode = 'P0001';
    end if;
  end loop;

  -- A sale moves coins, so the wallet is locked before anything is decided - as in every function that does.
  if exists (select 1 from jsonb_array_elements(p_grants) e where jsonb_typeof(e -> 'sell') = 'number') then
    perform public.wallet_lock(p_user);
  end if;

  for v_entry in select * from jsonb_array_elements(p_grants) loop
    v_ref := v_entry ->> 'ref';
    v_card := (v_entry ->> 'card')::integer;
    v_finish := v_entry ->> 'finish';
    v_sell := case when jsonb_typeof(v_entry -> 'sell') = 'number' then (v_entry ->> 'sell')::integer else null end;
    v_new := null;
    insert into public.card_grants (user_id, kind, ref, card_id, finish)
    values (p_user, p_kind, v_ref, v_card, v_finish)
    on conflict (user_id, kind, ref) do nothing
    returning id into v_new;
    if v_new is not null then
      if v_sell is not null and exists (select 1 from public.card_owned
                                         where user_id = p_user and card_id = v_card and finish = v_finish and count >= 1) then
        if v_sell > 0 then
          perform public.wallet_apply(p_user, v_sell::bigint, 'card_sell', p_kind || ':' || v_ref);
        end if;
        v_granted := v_granted || jsonb_build_object('ref', v_ref, 'card', v_card, 'finish', v_finish, 'sold', v_sell);
      else
        insert into public.card_owned (user_id, card_id, finish, count)
        values (p_user, v_card, v_finish, 1)
        on conflict (user_id, card_id, finish) do update set count = public.card_owned.count + 1;
        v_granted := v_granted || jsonb_build_object('ref', v_ref, 'card', v_card, 'finish', v_finish);
      end if;
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
    -- ...with "sold" on the ones that were copies and turned into coins the first time (v2.26.0).
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('card', g.card_id, 'finish', g.finish, 'sold',
             (select l.amount from public.wallet_ledger l where l.user_id = p_user and l.kind = 'card_sell' and l.ref = 'pack:' || g.ref)))
             order by g.ref), '[]'::jsonb)
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
    -- "sell" rides through untouched: grant_cards is what checks it and what decides whether it applies.
    v_grants := v_grants || jsonb_strip_nulls(jsonb_build_object('ref', p_open || ':' || v_i, 'card', (v_entry ->> 'card')::integer, 'finish', v_entry ->> 'finish', 'sell', v_entry -> 'sell'));
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
  -- What came out, in the order it was rolled, with "sold" on a copy that turned into coins.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('card', g.value -> 'card', 'finish', g.value -> 'finish', 'sold', g.value -> 'sold')) order by g.ordinality), '[]'::jsonb)
    into v_cards from jsonb_array_elements(v_granted -> 'granted') with ordinality g;

  return jsonb_build_object('duplicate', false, 'cards', v_cards,
    'balance', (select balance from public.wallets where user_id = p_user),
    'stock_left', (select stock_left from public.card_packs where id = p_pack),
    'price', v_pack.price);
end;
$$;

revoke all on function public.buy_pack(uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.buy_pack(uuid, text, text, jsonb, integer) to service_role;

-- ============================================================================================================
-- Battles (v2.27.0: offense against offense). See CARDS.md 11.
--
-- A player keeps a DECK of thirty cards. On THE LADDER a run is CPU teams one after another until a loss; in
-- THE DAILY BATTLE everyone meets the same CPU team once. Either way the server deals a HAND of twelve from
-- the deck, the player fields six of them in an order, and the card-claim Edge Function plays the battle: it
-- holds the rules (card-logic.mjs), draws the luck, and calls the functions below to write down what happened.
--
-- Nothing here is the browser's to read or write directly - RLS is on with NO policy of any kind and the client
-- roles hold no grant - because card_runs.seed says which teams are still to come, and a deck or a hand is a
-- list of what somebody owns.
--   - a player reads their own state through card_battle_state()
--   - everybody signed in reads the boards through card_boards()
--
-- NO NAME SNAPSHOT, on purpose and unlike every older board: the two boards join profiles when they are read. A
-- guest can never own a card, so there is no guest row to mark, and a name read live cannot be left behind by a
-- rename.
--
-- THE FIRST VERSION OF THIS (v2.25.0, the test site only) was offense against a defense: card_runs carried a
-- `defense` and there was a card_showdowns table. Neither ever reached production. A database that has them is
-- cleared of them here, once - the `defense` column is how the old shape is recognised - so this file can be
-- re-run on any shape and never drops a run of the new kind.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'card_runs' and column_name = 'defense') then
    drop table public.card_runs;
  end if;
  drop table if exists public.card_showdowns;
  drop function if exists public.card_run_start(uuid, text, text);
  drop function if exists public.card_run_battle(uuid, bigint, integer, jsonb, boolean, text, jsonb, integer, integer);
  drop function if exists public.card_showdown_record(uuid, date, text, jsonb, numeric, jsonb);
end $$;

-- The deck a player saved: thirty { card, finish }. An account with no row here plays its best thirty, worked
-- out by the Edge Function from what it owns - so nobody has to build a deck before a first battle.
create table if not exists public.card_decks (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  cards      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.card_runs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  seed       text not null check (char_length(seed) between 8 and 64),
  wins       integer not null default 0 check (wins >= 0),
  -- The twelve cards dealt for the battle the run is on, and the six it is against. Stored, not derived: a hand
  -- that could be asked for again could be re-dealt by asking again.
  hand       jsonb not null,
  foe        jsonb not null,
  status     text not null default 'live' check (status in ('live', 'over')),
  -- The latest battle as the function reported it, so a browser whose answer was lost can still be shown it.
  last       jsonb,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
-- One live run an account. This index is what makes "start a run" twice at once come out as one run.
create unique index if not exists card_runs_one_live on public.card_runs (user_id) where status = 'live';
create index if not exists card_runs_user_idx on public.card_runs (user_id, wins desc);

-- One row a day an account, made when the day's hand is DEALT and finished when the battle is played.
create table if not exists public.card_dailies (
  date       date not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  hand       jsonb not null,
  rounds     integer check (rounds between 0 and 6),   -- null until played
  score      numeric(7,1),
  shown      jsonb,                                     -- the battle as it was shown
  dealt_at   timestamptz not null default now(),
  played_at  timestamptz,
  primary key (date, user_id)
);
create index if not exists card_dailies_day_idx on public.card_dailies (date, rounds desc, score desc);

-- A BATTLE IN PROGRESS (v2.28.0). A battle is played a round at a time, so the run - and the day - remembers
-- the rounds played so far, and a run remembers the order the categories will come up in. `cats` is the one
-- thing here that is a SECRET FROM ITS OWNER until it is played: card_battle_state never returns it. (The
-- daily battle's order is the day's and follows from the date, so it has no column.) card_dailies already has
-- a `rounds` - the number of rounds WON, for the board - so its list of rounds played is `log`.
alter table public.card_runs add column if not exists cats jsonb;
alter table public.card_runs add column if not exists rounds jsonb not null default '[]'::jsonb;
alter table public.card_dailies add column if not exists log jsonb not null default '[]'::jsonb;
-- A run dealt before v2.28.0 has no category order, so it cannot be played on: end it rather than strand it.
update public.card_runs set status = 'over', ended_at = now() where status = 'live' and cats is null;

alter table public.card_decks enable row level security;
alter table public.card_runs enable row level security;
alter table public.card_dailies enable row level security;
revoke all on public.card_decks from anon, authenticated;
revoke all on public.card_runs from anon, authenticated;
revoke all on public.card_dailies from anon, authenticated;
revoke all on sequence public.card_runs_id_seq from anon, authenticated;

-- The wallet's ledger learns 'card_win', a win on the ladder. Same replacement as 'pack' above, and for its reason.
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
  check (kind in ('starting', 'welcome', 'season', 'daily', 'badge', 'minigame', 'purchase', 'pack', 'card_win', 'card_sell', 'card_gauntlet'));

-- THE HISTORICAL GAUNTLET (v2.29.0, CARDS.md 13). One row an account: how many stages it has cleared, and the
-- attempt in progress if there is one (stage, hand, the secret category order, the rounds played). WHICH teams
-- the stages are is card-logic.mjs's - the database holds no catalog - so a stage here is a number.
create table if not exists public.card_gauntlets (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  cleared    integer not null default 0 check (cleared between 0 and 99),
  stage      integer check (stage between 0 and 99),   -- null: no attempt in progress
  hand       jsonb,
  cats       jsonb,                                    -- never returned by any read
  rounds     jsonb not null default '[]'::jsonb,
  last       jsonb,                                    -- the latest finished attempt as it was shown
  last_stage integer,
  cleared_at timestamptz,                              -- when `cleared` last went up; the board's tiebreak
  updated_at timestamptz not null default now()
);
alter table public.card_gauntlets enable row level security;
revoke all on public.card_gauntlets from anon, authenticated;

-- A list of { card, finish } of exactly p_size entries: is it well formed? Raises `p_reason` when it is not.
create or replace function public.card_list_check(p_list jsonb, p_size integer, p_reason text)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
begin
  if p_list is null or jsonb_typeof(p_list) <> 'array' or jsonb_array_length(p_list) <> p_size then
    raise exception '%', p_reason using errcode = 'P0001';
  end if;
  for v_entry in select * from jsonb_array_elements(p_list) loop
    if jsonb_typeof(v_entry) <> 'object'
       or jsonb_typeof(v_entry -> 'card') is distinct from 'number'
       or (v_entry ->> 'card') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(v_entry -> 'finish') is distinct from 'string'
       or (v_entry ->> 'finish') not in ('base', 'silver', 'gold', 'prism') then
      raise exception '%', p_reason using errcode = 'P0001';
    end if;
  end loop;
end;
$$;
revoke all on function public.card_list_check(jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.card_list_check(jsonb, integer, text) to service_role;

-- Does this account hold every card of a list? p_size entries of { card, finish }; raises bad_lineup for
-- anything that is not that, and answers false when one of them is not owned.
-- The Edge Function has already checked the list against the RULES (card-logic.mjs: the shape of a deck, of a
-- team, that a team came out of the hand); what it cannot know without asking is who owns what, and asking
-- here - inside the same transaction that writes - leaves no gap between the question and the write.
drop function if exists public.card_lineup_owned(uuid, jsonb);
create or replace function public.card_lineup_owned(p_user uuid, p_lineup jsonb, p_size integer default 6)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry jsonb;
begin
  perform public.card_list_check(p_lineup, p_size, 'bad_lineup');
  for v_entry in select * from jsonb_array_elements(p_lineup) loop
    if not exists (select 1 from public.card_owned
                    where user_id = p_user and card_id = (v_entry ->> 'card')::integer
                      and finish = v_entry ->> 'finish' and count >= 1) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.card_lineup_owned(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.card_lineup_owned(uuid, jsonb, integer) to service_role;

-- Everything an account owns, as [{ card, finish }], and the deck it saved (or null). What the Edge Function
-- deals a hand from. Service role only.
create or replace function public.card_deck_read(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'owned', coalesce((select jsonb_agg(jsonb_build_object('card', o.card_id, 'finish', o.finish) order by o.card_id, o.finish)
                         from public.card_owned o where o.user_id = p_user and o.count >= 1), '[]'::jsonb),
    'deck', (select d.cards from public.card_decks d where d.user_id = p_user));
$$;
revoke all on function public.card_deck_read(uuid) from public, anon, authenticated;
grant execute on function public.card_deck_read(uuid) to service_role;

-- card_deck_save(user, thirty cards): keep this deck. The Edge Function has checked its shape (5, 10, 10 and 5,
-- thirty different men); this checks that every card is theirs. Returns { saved: true }.
-- Raises no_profile, guest_not_allowed, bad_lineup, not_owned.
create or replace function public.card_deck_save(p_user uuid, p_cards jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_cards, 30) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  insert into public.card_decks (user_id, cards) values (p_user, p_cards)
  on conflict (user_id) do update set cards = excluded.cards, updated_at = now();
  return jsonb_build_object('saved', true);
end;
$$;
revoke all on function public.card_deck_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.card_deck_save(uuid, jsonb) to service_role;

-- card_run_start(user, seed, hand, foe, cats): the account's live run - the one it already has, or a new one.
-- The seed, the first hand, the first CPU team and the order of the first battle's categories are the Edge
-- Function's; they are simply ignored when a run is already live, so asking twice, or from two tabs, is one run
-- with one hand. Returns { id, wins, hand, foe, rounds, last, fresh }. Raises no_profile, guest_not_allowed, bad_run.
drop function if exists public.card_run_start(uuid, text, jsonb, jsonb);
create or replace function public.card_run_start(p_user uuid, p_seed text, p_hand jsonb, p_foe jsonb, p_cats jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_run public.card_runs;
  v_fresh boolean := false;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_seed is null or char_length(p_seed) not between 8 and 64
     or p_cats is null or jsonb_typeof(p_cats) <> 'array' or jsonb_array_length(p_cats) <> 6 then
    raise exception 'bad_run' using errcode = 'P0001';
  end if;
  perform public.card_list_check(p_hand, 12, 'bad_run');
  perform public.card_list_check(p_foe, 6, 'bad_run');

  select * into v_run from public.card_runs where user_id = p_user and status = 'live';
  if not found then
    begin
      insert into public.card_runs (user_id, seed, hand, foe, cats) values (p_user, p_seed, p_hand, p_foe, p_cats) returning * into v_run;
      v_fresh := true;
    exception when unique_violation then
      -- the other tab's insert landed between the select and this one: its run is the run
      select * into v_run from public.card_runs where user_id = p_user and status = 'live';
    end;
  end if;
  return jsonb_build_object('id', v_run.id, 'wins', v_run.wins, 'hand', v_run.hand, 'foe', v_run.foe, 'rounds', v_run.rounds, 'last', v_run.last, 'fresh', v_fresh);
end;
$$;
revoke all on function public.card_run_start(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.card_run_start(uuid, text, jsonb, jsonb, jsonb) to service_role;

-- card_run_round(user, run, step, round, card, rounds): write down one round that is NOT the last.
--   p_round   the number of rounds the Edge Function read before it rolled
--   p_card    the card played, as a one-entry list [{ card, finish }] - its ownership is checked HERE
--   p_rounds  the battle's rounds with the new one on the end
-- The row is locked and the count checked again, so the same round posted twice - a double tap, two tabs - is
-- played once: the second raises `stale` having changed nothing. The sixth round goes through card_run_battle,
-- which ends the battle. Returns { rounds }.
-- Raises no_profile, guest_not_allowed, bad_battle, no_run, stale, bad_lineup, not_owned - in that order.
create or replace function public.card_run_round(p_user uuid, p_run bigint, p_step integer, p_round integer, p_card jsonb, p_rounds jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_run public.card_runs;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_step is null or p_round is null or p_round < 0 or p_round > 4
     or p_rounds is null or jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) <> p_round + 1 then
    raise exception 'bad_battle' using errcode = 'P0001';
  end if;
  select * into v_run from public.card_runs where id = p_run and user_id = p_user and status = 'live' for update;
  if not found then raise exception 'no_run' using errcode = 'P0001'; end if;
  if v_run.wins <> p_step or jsonb_array_length(v_run.rounds) <> p_round then raise exception 'stale' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_card, 1) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  update public.card_runs set rounds = p_rounds where id = p_run;
  return jsonb_build_object('rounds', p_rounds);
end;
$$;
revoke all on function public.card_run_round(uuid, bigint, integer, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.card_run_round(uuid, bigint, integer, integer, jsonb, jsonb) to service_role;

-- card_run_battle: write down the END of a battle of a run - its sixth round - and pay it. ONE transaction.
-- (v2.28.0: a battle is played a round at a time, so this is only ever the last of six. It requires five rounds
-- already down, and starts the next battle's rounds empty with the category order it is handed in p_cats.)
--
--   p_run, p_step   the run and the number of wins the Edge Function read before it rolled. The row is locked
--                   and both are checked again here, so two requests that overlap - a double tap, two tabs -
--                   cannot both count: the second finds the run moved and raises `stale`, having changed nothing.
--   p_lineup        the six cards played, [{ card, finish }]. Ownership is checked HERE; that they came out of
--                   the hand was the function's to check, against the hand it read from this row.
--   p_win           what the function's roll came to
--   p_hand, p_foe, p_cats   the hand, the CPU team and the category order for the NEXT battle (a win); ignored on a loss
--   p_last          the battle as the browser will be shown it, kept on the row
--   p_coins, p_cap  what this win pays and how many wins pay per UTC day - rewards.mjs's
--
-- wallet_lock comes first, before anything is decided, as in every function that moves coins.
-- Returns { wins, status, hand, foe, credited, capped, balance }.
-- Raises no_profile, guest_not_allowed, bad_battle, no_run, stale, bad_lineup, not_owned - in that order.
drop function if exists public.card_run_battle(uuid, bigint, integer, jsonb, boolean, jsonb, jsonb, jsonb, integer, integer);
create or replace function public.card_run_battle(p_user uuid, p_run bigint, p_step integer, p_lineup jsonb,
  p_win boolean, p_hand jsonb, p_foe jsonb, p_cats jsonb, p_last jsonb, p_coins integer, p_cap integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_run public.card_runs;
  v_credited bigint := 0;
  v_capped boolean := false;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_win is null or p_step is null or p_last is null or jsonb_typeof(p_last) <> 'object'
     or p_coins is null or p_coins < 0 or p_coins > 100 or p_cap is null or p_cap < 0 then
    raise exception 'bad_battle' using errcode = 'P0001';
  end if;
  if p_win then
    perform public.card_list_check(p_hand, 12, 'bad_battle');
    perform public.card_list_check(p_foe, 6, 'bad_battle');
    if p_cats is null or jsonb_typeof(p_cats) <> 'array' or jsonb_array_length(p_cats) <> 6 then
      raise exception 'bad_battle' using errcode = 'P0001';
    end if;
  end if;

  perform public.wallet_lock(p_user);
  select * into v_run from public.card_runs where id = p_run and user_id = p_user and status = 'live' for update;
  if not found then raise exception 'no_run' using errcode = 'P0001'; end if;
  if v_run.wins <> p_step or jsonb_array_length(v_run.rounds) <> 5 then raise exception 'stale' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_lineup, 6) then raise exception 'not_owned' using errcode = 'P0001'; end if;

  if p_win then
    update public.card_runs set wins = wins + 1, hand = p_hand, foe = p_foe, cats = p_cats, rounds = '[]'::jsonb, last = p_last where id = p_run returning * into v_run;
    if p_coins > 0 then
      -- UTC midnight worked out explicitly, as credit_coins does: a bare date follows the session's time zone.
      if (select count(*) from public.wallet_ledger
           where user_id = p_user and kind = 'card_win'
             and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= p_cap then
        v_capped := true;
      else
        v_credited := public.wallet_apply(p_user, p_coins::bigint, 'card_win', p_run || ':' || v_run.wins);
      end if;
    end if;
  else
    update public.card_runs set status = 'over', ended_at = now(), rounds = '[]'::jsonb, last = p_last where id = p_run returning * into v_run;
  end if;

  return jsonb_build_object('wins', v_run.wins, 'status', v_run.status, 'hand', v_run.hand, 'foe', v_run.foe,
    'credited', v_credited, 'capped', v_capped,
    'balance', (select balance from public.wallets where user_id = p_user));
end;
$$;
revoke all on function public.card_run_battle(uuid, bigint, integer, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, integer, integer) from public, anon, authenticated;
grant execute on function public.card_run_battle(uuid, bigint, integer, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, integer, integer) to service_role;

-- card_run_end(user): walk away from the live run. It ends at the wins it has.
-- Returns { ended, wins } - ended false when there was no live run, which is not an error.
create or replace function public.card_run_end(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.card_runs;
begin
  update public.card_runs set status = 'over', ended_at = now()
   where user_id = p_user and status = 'live' returning * into v_run;
  if not found then return jsonb_build_object('ended', false, 'wins', 0); end if;
  return jsonb_build_object('ended', true, 'wins', v_run.wins);
end;
$$;
revoke all on function public.card_run_end(uuid) from public, anon, authenticated;
grant execute on function public.card_run_end(uuid) to service_role;

-- card_daily_deal(user, date, hand): the day's hand - the one already dealt, or this one. Dealt ONCE: the
-- second ask for a day answers with the first hand whatever it is handed, so changing a deck and asking again
-- cannot re-deal. Returns { hand, played, rounds, score, shown }.
-- Raises no_profile, guest_not_allowed, bad_daily.
create or replace function public.card_daily_deal(p_user uuid, p_date date, p_hand jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_row public.card_dailies;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_date is null then raise exception 'bad_daily' using errcode = 'P0001'; end if;
  perform public.card_list_check(p_hand, 12, 'bad_daily');
  insert into public.card_dailies (date, user_id, hand) values (p_date, p_user, p_hand)
  on conflict (date, user_id) do nothing;
  select * into v_row from public.card_dailies where date = p_date and user_id = p_user;
  return jsonb_build_object('hand', v_row.hand, 'log', v_row.log, 'played', v_row.played_at is not null,
    'rounds', v_row.rounds, 'score', v_row.score, 'shown', v_row.shown);
end;
$$;
revoke all on function public.card_daily_deal(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.card_daily_deal(uuid, date, jsonb) to service_role;

-- card_daily_round(user, date, round, card, rounds): one round of the day's battle that is NOT the last -
-- exactly what card_run_round is to a run. The day's row must have been dealt and not yet played.
-- Returns { log }. Raises no_profile, guest_not_allowed, bad_daily, no_hand, duplicate (already played),
-- stale, bad_lineup, not_owned.
create or replace function public.card_daily_round(p_user uuid, p_date date, p_round integer, p_card jsonb, p_rounds jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_row public.card_dailies;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_date is null or p_round is null or p_round < 0 or p_round > 4
     or p_rounds is null or jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) <> p_round + 1 then
    raise exception 'bad_daily' using errcode = 'P0001';
  end if;
  select * into v_row from public.card_dailies where date = p_date and user_id = p_user for update;
  if not found then raise exception 'no_hand' using errcode = 'P0001'; end if;
  if v_row.played_at is not null then raise exception 'duplicate' using errcode = 'P0001'; end if;
  if jsonb_array_length(v_row.log) <> p_round then raise exception 'stale' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_card, 1) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  update public.card_dailies set log = p_rounds where date = p_date and user_id = p_user;
  return jsonb_build_object('log', p_rounds);
end;
$$;
revoke all on function public.card_daily_round(uuid, date, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.card_daily_round(uuid, date, integer, jsonb, jsonb) to service_role;

-- (v2.28.0: this is the SIXTH round - five must already be in the day's log.)
-- card_daily_record: the day's battle, once. The row must have been dealt and not yet played; the lineup's
-- ownership is checked here. A second one changes nothing and answers with the FIRST, duplicate: true.
-- Returns { duplicate, rounds, score, shown }.
-- Raises no_profile, guest_not_allowed, bad_daily, no_hand (nothing dealt for that day), bad_lineup, not_owned.
create or replace function public.card_daily_record(p_user uuid, p_date date, p_lineup jsonb, p_rounds integer, p_score numeric, p_shown jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_row public.card_dailies;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_date is null or p_rounds is null or p_rounds < 0 or p_rounds > 6
     or p_score is null or p_score < -9999 or p_score > 9999
     or p_shown is null or jsonb_typeof(p_shown) <> 'object' then
    raise exception 'bad_daily' using errcode = 'P0001';
  end if;
  select * into v_row from public.card_dailies where date = p_date and user_id = p_user for update;
  if not found then raise exception 'no_hand' using errcode = 'P0001'; end if;
  if v_row.played_at is not null then
    return jsonb_build_object('duplicate', true, 'rounds', v_row.rounds, 'score', v_row.score, 'shown', v_row.shown);
  end if;
  if jsonb_array_length(v_row.log) <> 5 then raise exception 'stale' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_lineup, 6) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  update public.card_dailies set rounds = p_rounds, score = round(p_score, 1), shown = p_shown, played_at = now()
   where date = p_date and user_id = p_user returning * into v_row;
  return jsonb_build_object('duplicate', false, 'rounds', v_row.rounds, 'score', v_row.score, 'shown', v_row.shown);
end;
$$;
revoke all on function public.card_daily_record(uuid, date, jsonb, integer, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.card_daily_record(uuid, date, jsonb, integer, numeric, jsonb) to service_role;

-- card_gauntlet_start(user, stage, hand, cats): the attempt in progress - the one already going, WHATEVER stage
-- it is on, or a new one at p_stage. A stage is open once every one before it is cleared; a cleared stage may be
-- played again (it pays nothing). The hand and category order are the Edge Function's and are ignored when an
-- attempt is already going. Returns { cleared, stage, hand, rounds, fresh }.
-- Raises no_profile, guest_not_allowed, bad_gauntlet, locked.
create or replace function public.card_gauntlet_start(p_user uuid, p_stage integer, p_hand jsonb, p_cats jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_row public.card_gauntlets;
  v_fresh boolean := false;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_stage is null or p_stage < 0 or p_stage > 99
     or p_cats is null or jsonb_typeof(p_cats) <> 'array' or jsonb_array_length(p_cats) <> 6 then
    raise exception 'bad_gauntlet' using errcode = 'P0001';
  end if;
  perform public.card_list_check(p_hand, 12, 'bad_gauntlet');
  insert into public.card_gauntlets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into v_row from public.card_gauntlets where user_id = p_user for update;
  if v_row.stage is null then
    if p_stage > v_row.cleared then raise exception 'locked' using errcode = 'P0001'; end if;
    update public.card_gauntlets set stage = p_stage, hand = p_hand, cats = p_cats, rounds = '[]'::jsonb, updated_at = now()
     where user_id = p_user returning * into v_row;
    v_fresh := true;
  end if;
  return jsonb_build_object('cleared', v_row.cleared, 'stage', v_row.stage, 'hand', v_row.hand, 'rounds', v_row.rounds, 'fresh', v_fresh);
end;
$$;
revoke all on function public.card_gauntlet_start(uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.card_gauntlet_start(uuid, integer, jsonb, jsonb) to service_role;

-- card_gauntlet_round(user, stage, round, card, rounds): one round that is NOT the last - what card_run_round is
-- to a run. Returns { rounds }.
-- Raises no_profile, guest_not_allowed, bad_gauntlet, no_battle, stale, bad_lineup, not_owned - in that order.
create or replace function public.card_gauntlet_round(p_user uuid, p_stage integer, p_round integer, p_card jsonb, p_rounds jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_row public.card_gauntlets;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_stage is null or p_round is null or p_round < 0 or p_round > 4
     or p_rounds is null or jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) <> p_round + 1 then
    raise exception 'bad_gauntlet' using errcode = 'P0001';
  end if;
  select * into v_row from public.card_gauntlets where user_id = p_user and stage is not null for update;
  if not found then raise exception 'no_battle' using errcode = 'P0001'; end if;
  if v_row.stage <> p_stage or jsonb_array_length(v_row.rounds) <> p_round then raise exception 'stale' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_card, 1) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  update public.card_gauntlets set rounds = p_rounds, updated_at = now() where user_id = p_user;
  return jsonb_build_object('rounds', p_rounds);
end;
$$;
revoke all on function public.card_gauntlet_round(uuid, integer, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.card_gauntlet_round(uuid, integer, integer, jsonb, jsonb) to service_role;

-- card_gauntlet_finish: the sixth round - the attempt ends, win or lose, and a stage beaten FOR THE FIRST TIME
-- moves `cleared` on and pays p_coins. ONE transaction; wallet_lock first. The ledger row is
-- (user, 'card_gauntlet', '<stage>'), so a stage can pay once whatever else goes wrong.
-- Returns { cleared, first, credited, balance }.
-- Raises no_profile, guest_not_allowed, bad_gauntlet, no_battle, stale, bad_lineup, not_owned - in that order.
create or replace function public.card_gauntlet_finish(p_user uuid, p_stage integer, p_lineup jsonb, p_win boolean, p_last jsonb, p_coins integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_row public.card_gauntlets;
  v_first boolean;
  v_credited bigint := 0;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_stage is null or p_win is null or p_last is null or jsonb_typeof(p_last) <> 'object'
     or p_coins is null or p_coins < 0 or p_coins > 1000 then
    raise exception 'bad_gauntlet' using errcode = 'P0001';
  end if;
  perform public.wallet_lock(p_user);
  select * into v_row from public.card_gauntlets where user_id = p_user and stage is not null for update;
  if not found then raise exception 'no_battle' using errcode = 'P0001'; end if;
  if v_row.stage <> p_stage or jsonb_array_length(v_row.rounds) <> 5 then raise exception 'stale' using errcode = 'P0001'; end if;
  if not public.card_lineup_owned(p_user, p_lineup, 6) then raise exception 'not_owned' using errcode = 'P0001'; end if;
  v_first := p_win and v_row.stage = v_row.cleared;
  update public.card_gauntlets
     set cleared = cleared + (case when v_first then 1 else 0 end),
         cleared_at = case when v_first then now() else cleared_at end,
         stage = null, hand = null, cats = null, rounds = '[]'::jsonb, last = p_last, last_stage = p_stage, updated_at = now()
   where user_id = p_user returning * into v_row;
  if v_first and p_coins > 0 then
    v_credited := public.wallet_apply(p_user, p_coins::bigint, 'card_gauntlet', p_stage::text);
  end if;
  return jsonb_build_object('cleared', v_row.cleared, 'first', v_first, 'credited', v_credited,
    'balance', (select balance from public.wallets where user_id = p_user));
end;
$$;
revoke all on function public.card_gauntlet_finish(uuid, integer, jsonb, boolean, jsonb, integer) from public, anon, authenticated;
grant execute on function public.card_gauntlet_finish(uuid, integer, jsonb, boolean, jsonb, integer) to service_role;

-- card_gauntlet_quit(user): give up the attempt in progress. Nothing is lost but the attempt. { ended }.
create or replace function public.card_gauntlet_quit(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.card_gauntlets set stage = null, hand = null, cats = null, rounds = '[]'::jsonb, updated_at = now()
   where user_id = p_user and stage is not null;
  return jsonb_build_object('ended', found);
end;
$$;
revoke all on function public.card_gauntlet_quit(uuid) from public, anon, authenticated;
grant execute on function public.card_gauntlet_quit(uuid) to service_role;

-- card_battle_state(): what the signed-in caller's battle screens open on. Read-only, so the browser calls it
-- as a GET and supabase-js retries it. Nobody signed in, or an account with nothing, gets the same shape empty.
--   { today, deck, run: { id, wins, status, hand, foe, rounds, last } | null, best, paid_today,
--     daily: { hand, log, played, rounds, score, shown } | null }
-- `rounds` (a run) and `log` (the day) are the rounds of the battle IN PROGRESS, played so far. The order the
-- categories will come up in (card_runs.cats) is NOT here: it is secret until each round is played.
-- `run` is the account's LATEST run, live or over - a browser whose answer to a battle was lost on the way back
-- has to be able to learn that the run ended, and be shown the battle that ended it. `daily` is today's row if
-- a hand has been dealt. `today` is the server's UTC date, so the browser never has to guess the day.
-- The seed is not in here and must never be. Nor are the cards of the run's team that have not been played.
create or replace function public.card_battle_state()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'today', (now() at time zone 'utc')::date,
    'deck', (select d.cards from public.card_decks d where d.user_id = auth.uid()),
    -- THEIR CARDS ARE HIDDEN UNTIL PLAYED (v2.28.1): of the run's six, the ones already met are whole and the
    -- rest are their spot alone - the same thing card-logic.mjs's maskFoe does to every answer of the function.
    'run', (select jsonb_build_object('id', r.id, 'wins', r.wins, 'status', r.status, 'hand', r.hand,
                     'foe', (select jsonb_agg(case when f.ord <= jsonb_array_length(r.rounds) then f.e else jsonb_build_object('spot', f.e -> 'spot') end order by f.ord)
                               from jsonb_array_elements(r.foe) with ordinality as f(e, ord)),
                     'rounds', r.rounds, 'last', r.last)
              from public.card_runs r where r.user_id = auth.uid() order by r.id desc limit 1),
    'best', coalesce((select max(r.wins) from public.card_runs r where r.user_id = auth.uid()), 0),
    'paid_today', (select count(*) from public.wallet_ledger l
                    where l.user_id = auth.uid() and l.kind = 'card_win'
                      and l.created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')),
    'daily', (select jsonb_build_object('hand', s.hand, 'log', s.log, 'played', s.played_at is not null, 'rounds', s.rounds, 'score', s.score, 'shown', s.shown)
                from public.card_dailies s
               where s.user_id = auth.uid() and s.date = (now() at time zone 'utc')::date),
    -- The gauntlet (v2.29.0): stages cleared, and the attempt in progress if any. `cats` is not here either.
    'gauntlet', (select jsonb_build_object('cleared', g.cleared, 'stage', g.stage, 'hand', g.hand, 'rounds', g.rounds, 'last', g.last, 'last_stage', g.last_stage)
                   from public.card_gauntlets g where g.user_id = auth.uid())
  );
$$;
revoke all on function public.card_battle_state() from public, anon;
grant execute on function public.card_battle_state() to authenticated;

-- card_boards(limit): the two boards of the card area. The ladder - one row an account, its best run, live ones
-- included (a run still going has already won what it has won) - and today's daily battle: rounds won first,
-- then the six-round total, then who got there first. Names are read from profiles NOW (see the note at the top
-- of this section). Every order is fully tiebroken.
--   { today, runs: [{ username, wins }], daily: [{ username, rounds, score }] }
create or replace function public.card_boards(p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'today', (now() at time zone 'utc')::date,
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('username', t.username, 'wins', t.wins) order by t.wins desc, t.username collate "C")
        from (select p.username, max(r.wins) as wins
                from public.card_runs r join public.profiles p on p.id = r.user_id
               where not p.guest
               group by p.username
              having max(r.wins) > 0
               order by max(r.wins) desc, p.username collate "C"
               limit greatest(1, least(coalesce(p_limit, 25), 100))) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('username', t.username, 'rounds', t.rounds, 'score', t.score) order by t.rounds desc, t.score desc, t.played_at, t.username collate "C")
        from (select p.username, s.rounds, s.score, s.played_at
                from public.card_dailies s join public.profiles p on p.id = s.user_id
               where s.date = (now() at time zone 'utc')::date and s.played_at is not null and not p.guest
               order by s.rounds desc, s.score desc, s.played_at, p.username collate "C"
               limit greatest(1, least(coalesce(p_limit, 25), 100))) t), '[]'::jsonb),
    -- The gauntlet (v2.29.0): most stages cleared, then who got there first.
    'gauntlet', coalesce((
      select jsonb_agg(jsonb_build_object('username', t.username, 'cleared', t.cleared) order by t.cleared desc, t.cleared_at, t.username collate "C")
        from (select p.username, g.cleared, g.cleared_at
                from public.card_gauntlets g join public.profiles p on p.id = g.user_id
               where g.cleared > 0 and not p.guest
               order by g.cleared desc, g.cleared_at, p.username collate "C"
               limit greatest(1, least(coalesce(p_limit, 25), 100))) t), '[]'::jsonb)
  );
$$;
revoke all on function public.card_boards(integer) from public, anon;
grant execute on function public.card_boards(integer) to authenticated;

-- ============================================================================================================
-- Copies (v2.26.0). See CARDS.md 12.
--
-- A player holds ONE of a card in a finish. grant_cards sells a copy the moment it arrives (above); these two
-- deal with the copies that were already stacked before that rule existed, and with any a hand-out stacks later.
--
-- card_copies(user): the stacks, [{ card, finish, count }], most copies first. Service role only - the Edge
-- Function reads it, prices each from the catalog, and hands the prices to card_sell_copies.
create or replace function public.card_copies(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('card', t.card_id, 'finish', t.finish, 'count', t.count) order by t.count desc, t.card_id, t.finish), '[]'::jsonb)
    from (select card_id, finish, count from public.card_owned
           where user_id = p_user and count > 1
           order by count desc, card_id, finish limit 500) t;
$$;
revoke all on function public.card_copies(uuid) from public, anon, authenticated;
grant execute on function public.card_copies(uuid) to service_role;

-- card_sell_copies(user, sales, ref): sell every copy past the first, in ONE transaction.
-- p_sales is [{ card, finish, each }] - what ONE copy of that card sells for. For each, the row is locked and
-- whatever it holds past one is sold at that price, so the count the function read a moment ago does not have
-- to still be true: a stack that has since grown sells the new copy too, and one that is gone sells nothing.
-- The coins go in as one ledger row, (user, 'card_sell', 'copies:<ref>'); the ref is the caller's, one a call.
-- Calling it again sells nothing, because nothing is stacked any more.
-- Returns { copies, coins, balance }. Raises no_profile, guest_not_allowed, bad_sale.
create or replace function public.card_sell_copies(p_user uuid, p_sales jsonb, p_ref text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest boolean;
  v_entry jsonb;
  v_count integer;
  v_copies bigint := 0;
  v_coins bigint := 0;
begin
  select guest into v_guest from public.profiles where id = p_user;
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if v_guest then raise exception 'guest_not_allowed' using errcode = 'P0001'; end if;
  if p_ref is null or p_ref !~ '^[A-Za-z0-9-]{8,36}$'
     or p_sales is null or jsonb_typeof(p_sales) <> 'array' or jsonb_array_length(p_sales) > 500 then
    raise exception 'bad_sale' using errcode = 'P0001';
  end if;
  for v_entry in select * from jsonb_array_elements(p_sales) loop
    if jsonb_typeof(v_entry) <> 'object'
       or jsonb_typeof(v_entry -> 'card') is distinct from 'number'
       or (v_entry ->> 'card') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(v_entry -> 'finish') is distinct from 'string'
       or (v_entry ->> 'finish') not in ('base', 'silver', 'gold', 'prism')
       or jsonb_typeof(v_entry -> 'each') is distinct from 'number'
       or (v_entry ->> 'each') !~ '^[0-9]{1,5}$' or (v_entry ->> 'each')::integer > 20000 then
      raise exception 'bad_sale' using errcode = 'P0001';
    end if;
  end loop;

  perform public.wallet_lock(p_user);
  for v_entry in select * from jsonb_array_elements(p_sales) loop
    v_count := null;
    select count into v_count from public.card_owned
     where user_id = p_user and card_id = (v_entry ->> 'card')::integer and finish = v_entry ->> 'finish' and count > 1
       for update;
    if v_count is not null then
      update public.card_owned set count = 1
       where user_id = p_user and card_id = (v_entry ->> 'card')::integer and finish = v_entry ->> 'finish';
      v_copies := v_copies + (v_count - 1);
      v_coins := v_coins + (v_count - 1)::bigint * (v_entry ->> 'each')::integer;
    end if;
  end loop;
  if v_coins > 0 then
    perform public.wallet_apply(p_user, v_coins, 'card_sell', 'copies:' || p_ref);
  end if;
  return jsonb_build_object('copies', v_copies, 'coins', v_coins,
    'balance', (select balance from public.wallets where user_id = p_user));
end;
$$;
revoke all on function public.card_sell_copies(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.card_sell_copies(uuid, jsonb, text) to service_role;
