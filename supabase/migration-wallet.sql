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

-- ---------- Paying seasons and badges, minigames, reading your wallet (agent I) ----------
-- credit_coins, award_badges, claim_minigame, wallet_state (SHOP.md 3.1).

-- ---------- New accounts and starting balances (agent I) ----------
-- create_wallet() and its trigger, then the one-time starting balances - in that order, so an account created
-- while this file runs gets exactly one of the two.
