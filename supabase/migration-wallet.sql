-- v1.12.0 Wallet & Shop, part 1: coins. Contract: SHOP.md (3.1).
--
-- Run after migration-moderation.sql and before migration-shop.sql. Re-runnable: every table is created if
-- missing, every function replaced, and the starting balances at the bottom pay once.
--
-- A wallet only goes up by playing and only goes down by spending, and never below zero. Every movement is a row
-- in wallet_ledger under a (user, kind, ref) that can only be recorded once, so the same season, badge or day's
-- minigame can't pay twice, and the same item can't be bought twice:
--
--   kind       amount                        ref
--   starting   + the starting balance        'career'
--   welcome    + 250                         'welcome'
--   season     + an Unlimited/Genius/GM      the challenge code
--   daily      + a Daily                     '<date>:<format>'
--   badge      + the badge's coins           the badge id
--   minigame   + 15                          '<game>:<UTC date>'
--   purchase   - the price                   the item id
--
-- None of these tables is client-writable or even client-readable: a player reads their own wallet through
-- wallet_state() and claims minigame coins through claim_minigame(), and the submit-run Edge Function (service
-- role) pays seasons and badges through credit_coins() and award_badges().

-- ---------- Tables ----------

create table if not exists public.wallets (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  balance     bigint not null default 0 check (balance >= 0),
  earned      bigint not null default 0 check (earned >= 0),
  spent       bigint not null default 0 check (spent >= 0),
  updated_at  timestamptz not null default now(),
  constraint wallets_balance_adds_up check (balance = earned - spent)
);

create table if not exists public.wallet_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      bigint not null check (amount <> 0),
  kind        text not null check (kind in ('starting', 'welcome', 'season', 'daily', 'badge', 'minigame', 'purchase')),
  ref         text not null check (char_length(ref) between 1 and 200),
  created_at  timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists wallet_ledger_user_recent_idx on public.wallet_ledger (user_id, created_at desc, id desc);

-- The badges whose coins have been paid (submit-run's award_badges). Badges themselves are worked out from stats
-- (badges.mjs); this only records that one has been rewarded, and it's what makes a badge item yours.
create table if not exists public.badge_awards (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  badge       text not null check (badge ~ '^[a-z0-9-]{1,40}$'),
  awarded_at  timestamptz not null default now(),
  primary key (user_id, badge)
);

-- The challenge codes an account has finished a season on. submit-run inserts here before it counts a free-mode
-- season, so the same draft can't count twice.
create table if not exists public.finished_codes (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  code        text not null check (char_length(code) between 1 and 32),
  created_at  timestamptz not null default now(),
  primary key (user_id, code)
);

alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.badge_awards enable row level security;
alter table public.finished_codes enable row level security;
-- No policies, and no privileges either, so a client's read is refused outright rather than coming back empty.
revoke all on table public.wallets, public.wallet_ledger, public.badge_awards, public.finished_codes from anon, authenticated;

-- ---------- Moving coins ----------
-- Internal: only the functions below (and migration-shop.sql's) call these.

-- The player's wallet row, locked until the transaction ends, and its balance. Creates an empty wallet first when
-- there's none, so there is always a row to lock. Every function that reads a balance or moves coins takes this
-- lock before anything else, which makes two purchases (or a purchase and a credit) at the same moment wait for
-- each other instead of both spending the same coins - and since every path locks the wallet before it touches
-- the ledger, two of them can't deadlock.
create or replace function public.wallet_lock(p_user uuid)
returns bigint language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_balance bigint;
begin
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance into v_balance from public.wallets where user_id = p_user for update;
  return v_balance;
end;
$$;

-- Moves p_amount coins into (positive) or out of (negative) the player's wallet and records why. Returns the
-- amount moved: p_amount, or 0 when that (user, kind, ref) is already recorded or the amount is 0. A debit the
-- balance can't cover breaks wallets' check and rolls the whole transaction back, so a caller checks the balance
-- first (under wallet_lock) and raises its own code.
--
-- The wallet row is updated rather than upserted: an upsert checks the row it would have inserted before it finds
-- the existing one, and a debit's proposed row has a negative balance.
create or replace function public.wallet_apply(p_user uuid, p_amount bigint, p_kind text, p_ref text)
returns bigint language plpgsql volatile security invoker set search_path = public, pg_temp as $$
declare
  v_rows integer;
begin
  if coalesce(p_amount, 0) = 0 then
    return 0;
  end if;
  perform public.wallet_lock(p_user);
  insert into public.wallet_ledger (user_id, amount, kind, ref) values (p_user, p_amount, p_kind, p_ref)
  on conflict (user_id, kind, ref) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 0;
  end if;
  update public.wallets
     set balance = balance + p_amount,
         earned = earned + greatest(p_amount, 0),
         spent = spent + greatest(-p_amount, 0),
         updated_at = now()
   where user_id = p_user;
  return p_amount;
end;
$$;

revoke execute on function public.wallet_lock(uuid) from public, anon, authenticated;
revoke execute on function public.wallet_apply(uuid, bigint, text, text) from public, anon, authenticated;

-- ---------- Paying seasons and badges ----------
-- Only the submit-run Edge Function calls these, with the service role, once it has replayed a season and counted
-- it. They still refuse a malformed call with a code rather than trusting their caller: a mistake here pays real
-- coins, and coins can't be taken back.

-- A finished season's coins: an Unlimited, Genius or GM season under its challenge code (kind 'season'), or a Daily
-- under '<date>:<format>' (kind 'daily'). A (kind, ref) pays once, so a season can't pay twice even if it somehow
-- got past submit-run's own duplicate guard. p_daily_cap is how many rows of this kind pay per UTC day - submit-run
-- sends rewards.mjs's paidSeasonsPerDay for a season and null for a Daily, which always pays. The count is taken
-- under the wallet lock, and the function is volatile, so the count sees whatever committed while it waited for the
-- lock: a burst of seasons finishing at once can't all find room under the cap. (Marked stable, it would count from
-- the snapshot it started with.)
create or replace function public.credit_coins(p_user uuid, p_amount bigint, p_kind text, p_ref text, p_daily_cap integer default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_credited bigint := 0;
  v_capped boolean := false;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no_such_player' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('season', 'daily') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 10000 then
    raise exception 'bad_amount' using errcode = 'P0001';
  end if;
  if p_ref is null or char_length(p_ref) not between 1 and 200 then
    raise exception 'bad_ref' using errcode = 'P0001';
  end if;
  perform public.wallet_lock(p_user);
  -- UTC midnight is worked out explicitly, since a bare date follows the session's time zone.
  if p_daily_cap is not null and (
       select count(*) from public.wallet_ledger
        where user_id = p_user and kind = p_kind
          and created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')) >= p_daily_cap then
    v_capped := true;
  else
    v_credited := public.wallet_apply(p_user, p_amount, p_kind, p_ref);
  end if;
  return jsonb_build_object(
    'credited', v_credited,
    'balance', (select balance from public.wallets where user_id = p_user),
    'capped', v_capped,
    -- wallet_apply pays nothing for a (kind, ref) that's already recorded.
    'duplicate', not v_capped and p_amount > 0 and v_credited = 0);
end;
$$;

-- The coins for the badges a player has, each paid once. badge_awards remembers every badge already rewarded -
-- the ones that pay nothing too, since a badge item in the shop belongs to whoever has its badge there. submit-run
-- sends every badge the player has now (rewards.mjs's badgeRewards, in catalog order), so a badge earned before
-- coins existed pays with the next finished season. The whole list is checked before anything is written.
create or replace function public.award_badges(p_user uuid, p_badges jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_entry jsonb;
  v_id text;
  v_coins numeric;
  v_rows integer;
  v_awarded jsonb := '[]'::jsonb;
  v_credited bigint := 0;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no_such_player' using errcode = 'P0001';
  end if;
  if p_badges is null or jsonb_typeof(p_badges) <> 'array' then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_badges) > 50 then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  for v_entry in select t.e from jsonb_array_elements(p_badges) with ordinality as t(e, n) order by t.n loop
    -- Each field is read only once its JSON type is known, so a malformed entry is refused rather than failing a
    -- cast. A whole number written with a fraction (100.0) is still a whole number.
    v_id := case when jsonb_typeof(v_entry) = 'object' and jsonb_typeof(v_entry->'id') = 'string' then v_entry->>'id' end;
    v_coins := case when jsonb_typeof(v_entry) = 'object' and jsonb_typeof(v_entry->'coins') = 'number' then (v_entry->>'coins')::numeric end;
    if v_id is null or v_id !~ '^[a-z0-9-]{1,40}$' or v_coins is null or v_coins < 0 or v_coins > 10000 or v_coins <> trunc(v_coins) then
      raise exception 'bad_request' using errcode = 'P0001';
    end if;
  end loop;
  perform public.wallet_lock(p_user);
  for v_entry in select t.e from jsonb_array_elements(p_badges) with ordinality as t(e, n) order by t.n loop
    insert into public.badge_awards (user_id, badge) values (p_user, v_entry->>'id') on conflict (user_id, badge) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_awarded := v_awarded || to_jsonb(v_entry->>'id');
      -- wallet_apply moves nothing for 0 coins, so a badge that pays nothing leaves no ledger row.
      v_credited := v_credited + public.wallet_apply(p_user, (v_entry->>'coins')::numeric::bigint, 'badge', v_entry->>'id');
    end if;
  end loop;
  return jsonb_build_object('awarded', v_awarded, 'credited', v_credited, 'balance', (select balance from public.wallets where user_id = p_user));
end;
$$;

-- service_role has execute on every new function in a Supabase project by default; it's granted here as well, so
-- paying seasons never rests on that setting. No client role can call either.
revoke execute on function public.credit_coins(uuid, bigint, text, text, integer), public.award_badges(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.credit_coins(uuid, bigint, text, text, integer), public.award_badges(uuid, jsonb) to service_role;

-- ---------- Minigame coins and reading your wallet ----------

-- Today's coins for Over/Under or Build-a-player, which the app claims once the player's run is saved. Those
-- games' scores are written by the browser, so all a claim can check is that the player has a row there from the
-- last 24 hours. The ledger key '<game>:<UTC date>' is what holds it to once a UTC day, however often it's called.
create or replace function public.claim_minigame(p_game text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_played boolean;
  v_credited bigint;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_game is null or p_game not in ('over_under', 'build') then
    raise exception 'bad_game' using errcode = 'P0001';
  end if;
  if p_game = 'over_under' then
    v_played := exists (select 1 from public.sou_runs where user_id = v_uid and created_at > now() - interval '24 hours');
  else
    v_played := exists (select 1 from public.builds where user_id = v_uid and created_at > now() - interval '24 hours');
  end if;
  if not v_played then
    raise exception 'not_played' using errcode = 'P0001';
  end if;
  perform public.wallet_lock(v_uid);
  -- to_char, not ::text, which would follow the session's DateStyle.
  v_credited := public.wallet_apply(v_uid, 15, 'minigame', p_game || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
  return jsonb_build_object('credited', v_credited, 'balance', (select balance from public.wallets where user_id = v_uid));
end;
$$;

-- Your balance, what you've earned and spent, and your 20 newest coin movements. Stable, so the app reads it as GET,
-- which PostgREST runs in a read-only transaction - so unlike the functions above it doesn't take the wallet lock,
-- which inserts and locks a row and would be refused there. It doesn't need to: it acts on nothing, and as a stable
-- function it reads the wallet and the ledger from one snapshot, so the balance and the movements always agree. It
-- creates no wallet either, so a player without one reads zeros.
create or replace function public.wallet_state()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_wallet public.wallets;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into v_wallet from public.wallets where user_id = v_uid;
  return jsonb_build_object(
    'balance', coalesce(v_wallet.balance, 0),
    'earned', coalesce(v_wallet.earned, 0),
    'spent', coalesce(v_wallet.spent, 0),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('amount', r.amount, 'kind', r.kind, 'ref', r.ref, 'created_at', r.created_at)
                       order by r.created_at desc, r.id desc)
        from (select l.id, l.amount, l.kind, l.ref, l.created_at from public.wallet_ledger l
               where l.user_id = v_uid order by l.created_at desc, l.id desc limit 20) r
    ), '[]'::jsonb));
end;
$$;

-- A signed-in player's own. Signed-out visitors can't call them at all.
revoke execute on function public.claim_minigame(text), public.wallet_state() from public, anon;
grant execute on function public.claim_minigame(text), public.wallet_state() to authenticated;

-- ---------- New accounts and starting balances ----------
-- The trigger first, then the one-time starting balances, so an account created while this file runs gets exactly
-- one of the two: created before the trigger exists, it's a profile the starting balances below pay; created after,
-- it has its welcome coins, and the starting balances skip it.

-- A new account's welcome coins, paid as its profile row is created (by the signup trigger, handle_new_user).
-- Security definer because it runs as whoever inserted the profile, and the wallet tables and wallet_apply are
-- closed to every client role.
create or replace function public.create_wallet()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.wallet_apply(new.id, 250, 'welcome', 'welcome');
  return null;
end;
$$;
-- A trigger function only: a trigger runs without its caller holding execute.
revoke execute on function public.create_wallet() from public, anon, authenticated;

drop trigger if exists profiles_create_wallet on public.profiles;
create trigger profiles_create_wallet after insert on public.profiles
  for each row execute function public.create_wallet();

-- Every account from before coins existed starts with its career so far: 20 a season, 2 a win, 10 a playoff trip,
-- 50 a title and 150 a perfect season, never less than a new account's 250 and at most 10,000. This is
-- rewards.mjs's startingBalance, which tests/test-wallet-sql.mjs holds it to - including counting a missing or
-- negative counter as nothing. An account that already has its starting balance or its welcome coins is skipped,
-- so a second run pays nobody.
do $$
declare
  v_player record;
begin
  for v_player in
    select p.id,
           least(10000, greatest(250,
             20 * greatest(coalesce(p.runs, 0), 0)::bigint + 2 * greatest(coalesce(p.wins, 0), 0)::bigint
             + 10 * greatest(coalesce(p.playoffs, 0), 0)::bigint + 50 * greatest(coalesce(p.champs, 0), 0)::bigint
             + 150 * greatest(coalesce(p.perfect, 0), 0)::bigint)) as coins
      from public.profiles p
     where not exists (select 1 from public.wallet_ledger l where l.user_id = p.id and l.kind in ('starting', 'welcome'))
     order by p.id
  loop
    perform public.wallet_apply(v_player.id, v_player.coins, 'starting', 'career');
  end loop;
end;
$$;
