-- v1.12.0 Wallet & Shop, part 2: the shop. Contract: SHOP.md (3.2).
--
-- Run after migration-wallet.sql, then re-run migration-profiles.sql (its set_avatar lets a player pick the
-- avatars from a pack they own). Re-runnable: v1.13.0's new titles and avatar packs arrive by re-running this file.
--
-- Everything sold is cosmetic: a frame around your picture, your player card's theme, a title under your name,
-- or a pack of avatars. Nothing bought changes a draft or a score. Prices are rows here, so changing one takes a
-- line of SQL and no deploy:
--
--   update shop_items set price = 1500 where id = 'frame-lime';
--   update shop_items set active = false where id = 'frame-lime';   -- off sale; owners keep it
--
-- The seeds below only add missing items, so a change made that way survives a re-run - edit the seed as well if
-- a new database should get it too. Names and looks live in the browser (shop-catalog.mjs, cosmetics.jsx).

-- ---------- Tables ----------

create table if not exists public.shop_items (
  id      text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  kind    text not null check (kind in ('frame', 'card', 'title', 'avatar_pack')),
  rarity  text not null check (rarity in ('free', 'common', 'rare', 'epic', 'legendary', 'badge')),
  price   integer check (price is null or price between 1 and 1000000),
  -- The badges.mjs id that unlocks a badge item.
  badge   text check (badge is null or badge ~ '^[a-z0-9-]{1,40}$'),
  active  boolean not null default true,
  sort    integer not null default 0
);
-- Free and badge items have no price; everything else has one and no badge. Named, so a re-run replaces it.
alter table public.shop_items drop constraint if exists shop_items_price_fits_rarity;
alter table public.shop_items add constraint shop_items_price_fits_rarity check (
  case rarity
    when 'free' then price is null and badge is null
    when 'badge' then price is null and badge is not null
    else price is not null and badge is null
  end);

-- The launch catalog (SHOP.md 6.2; shop-catalog.mjs's SHOP_ITEMS, which tests/test-shop-sql.mjs checks this against).
insert into public.shop_items (id, kind, rarity, price, badge, sort) values
  ('frame-ink', 'frame', 'free', null, null, 10),
  ('frame-lime', 'frame', 'common', 750, null, 20),
  ('frame-team', 'frame', 'rare', 2000, null, 30),
  ('frame-gold', 'frame', 'epic', 6000, null, 40),
  ('frame-flame', 'frame', 'legendary', 15000, null, 50),
  ('frame-undefeated', 'frame', 'badge', null, 'undefeated', 60),
  ('card-navy', 'card', 'free', null, null, 10),
  ('card-night', 'card', 'common', 750, null, 20),
  ('card-turf', 'card', 'rare', 2000, null, 30),
  ('card-team', 'card', 'rare', 2000, null, 40),
  ('card-ticket', 'card', 'epic', 6000, null, 50),
  ('card-gold-foil', 'card', 'legendary', 15000, null, 60),
  ('card-dynasty', 'card', 'badge', null, 'dynasty', 70),
  ('title-film-room', 'title', 'common', 750, null, 10),
  ('title-waiver-hawk', 'title', 'common', 750, null, 20),
  ('title-draft-guru', 'title', 'rare', 2000, null, 30),
  ('title-cap-wizard', 'title', 'rare', 2000, null, 40),
  ('title-war-room', 'title', 'epic', 6000, null, 50),
  ('title-sleeper-agent', 'title', 'epic', 6000, null, 60),
  ('title-first-overall', 'title', 'legendary', 15000, null, 70),
  ('title-the-goat', 'title', 'legendary', 15000, null, 80),
  ('title-undefeated', 'title', 'badge', null, 'undefeated', 90),
  ('title-daily-winner', 'title', 'badge', null, 'daily-winner', 100),
  ('title-cinderella', 'title', 'badge', null, 'cinderella', 110),
  ('pack-sideline', 'avatar_pack', 'common', 750, null, 10),
  ('pack-trophy-room', 'avatar_pack', 'rare', 2000, null, 20),
  ('pack-night-game', 'avatar_pack', 'epic', 6000, null, 30),
  ('pack-draft-day', 'avatar_pack', 'legendary', 15000, null, 40),
  ('pack-hall-of-fame', 'avatar_pack', 'legendary', 15000, null, 50)
on conflict (id) do nothing;

-- v1.13.0 put four titles ahead of the badge titles, which a database seeded by v1.12.0 has at 50, 60 and 70 - the new
-- titles' places now. Each moves back only from exactly that place, so a sort changed by hand stays and a re-run
-- changes nothing.
update public.shop_items s set sort = v.sort
  from (values ('title-undefeated', 50, 90), ('title-daily-winner', 60, 100), ('title-cinderella', 70, 110)) as v(id, was, sort)
 where s.id = v.id and s.sort = v.was;

-- What each player has bought. Free items belong to everyone and a badge item to whoever has its badge in
-- badge_awards, so only bought items get rows.
create table if not exists public.inventory (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  item_id      text not null references public.shop_items(id),
  acquired_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- The avatar packs' avatars (shop-catalog.mjs's AVATAR_PACKS; avatars.jsx draws them). Picking one needs its pack's
-- shop item (set_avatar in migration-profiles.sql), so giving a pack to everyone is a shop change -
-- `update shop_items set rarity = 'free', price = null where id = 'pack-sideline';` - never a change here. Like the
-- items above, a re-run only adds missing rows.
insert into public.avatar_presets (key, pack, free) values
  ('headset', 'sideline', false), ('cooler', 'sideline', false), ('pylon', 'sideline', false), ('penalty-flag', 'sideline', false),
  ('title-ring', 'trophy-room', false), ('medal', 'trophy-room', false), ('banner', 'trophy-room', false), ('game-ball', 'trophy-room', false),
  ('floodlights', 'night-game', false), ('scoreboard', 'night-game', false), ('fireworks', 'night-game', false), ('blimp', 'night-game', false),
  ('podium', 'draft-day', false), ('draft-card', 'draft-day', false), ('the-call', 'draft-day', false), ('draft-cap', 'draft-day', false),
  ('gold-jacket', 'hall-of-fame', false), ('bust', 'hall-of-fame', false), ('laurels', 'hall-of-fame', false), ('the-hall', 'hall-of-fame', false)
on conflict (key) do nothing;

-- What a player wears. Null is the default: the Ink frame, the Navy card, no title.
alter table public.profile_details add column if not exists frame text references public.shop_items(id);
alter table public.profile_details add column if not exists card_theme text references public.shop_items(id);
alter table public.profile_details add column if not exists title text references public.shop_items(id);
-- The badges chosen for the card, in order. set_showcase checks each id; the card shows only earned ones.
alter table public.profile_details add column if not exists showcase text[] not null default '{}';
alter table public.profile_details drop constraint if exists profile_details_showcase_shape;
alter table public.profile_details add constraint profile_details_showcase_shape check (cardinality(showcase) <= 3);

alter table public.shop_items enable row level security;
alter table public.inventory enable row level security;
drop policy if exists "shop items are publicly readable" on public.shop_items;
create policy "shop items are publicly readable" on public.shop_items for select using (true);
-- No policies and no privileges: a player sees what they own through shop_state().
revoke all on table public.inventory from anon, authenticated;

-- ---------- The shop's functions ----------
-- shop_state, shop_buy, equip_item and set_showcase (SHOP.md 3.2). They're for signed-in players only: execute
-- is revoked from public and anon at the bottom, so a signed-out call is refused before it runs, and a session
-- whose account is gone gets not_signed_in. A refusal raises its code as the whole message (PROFILES.md 3), which
-- storage-shop.js maps to a reason. tests/mock-shop.mjs mirrors all four, and tests/test-shop-sql.mjs checks the
-- two agree.
--
-- You own an item when it's free (everyone does), when you bought it (an inventory row), or - a badge item - when
-- its badge is in badge_awards, which submit-run fills as it pays the badge's coins: a badge item unlocks with the
-- first finished season after its badge is earned. shop_state, shop_buy and equip_item each spell this rule out.

-- Everything the shop screen shows, in one read:
--   { "balance", "items": [{ "id", "kind", "rarity", "price", "badge", "active", "sort", "owned" }],
--     "equipped": { "frame", "card", "title", "showcase" } }
-- The items are everything on sale plus anything you own that's been taken off sale (you can still wear it), in
-- shop order: kind (frame, card, title, avatar_pack), then sort, then id - in plain code-point order, since the
-- default collation differs between installs. It takes no wallet lock, because a stable function can't and
-- nothing is decided on this balance, so a player with no wallet yet reads 0. Stable, so the browser reads it as
-- a GET. No details row means nothing is worn: nulls and no showcase.
create or replace function public.shop_state()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_worn public.profile_details;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select * into v_worn from public.profile_details where user_id = v_uid;
  return jsonb_build_object(
    'balance', coalesce((select w.balance from public.wallets w where w.user_id = v_uid), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind, 'rarity', s.rarity, 'price', s.price, 'badge', s.badge,
               'active', s.active, 'sort', s.sort, 'owned', s.owned)
             order by array_position(array['frame', 'card', 'title', 'avatar_pack'], s.kind), s.sort, s.id collate "C")
        from (
          select i.*,
                 i.rarity = 'free'
                 or exists (select 1 from public.inventory v where v.user_id = v_uid and v.item_id = i.id)
                 or (i.badge is not null
                     and exists (select 1 from public.badge_awards b where b.user_id = v_uid and b.badge = i.badge)) as owned
            from public.shop_items i
        ) s
       where s.active or s.owned
    ), '[]'::jsonb),
    'equipped', jsonb_build_object(
      'frame', v_worn.frame, 'card', v_worn.card_theme, 'title', v_worn.title,
      'showcase', to_jsonb(coalesce(v_worn.showcase, '{}'::text[])))
  );
end;
$$;

-- Buys one item with coins: { "ok": true, "balance": <after the purchase>, "item": <id> }. Refuses, checked in
-- this order: not_signed_in; unavailable (no such item, or off sale); badge_only (a badge item comes with its
-- badge and is never sold); owned (a free item, or one already bought); not_enough.
--
-- The wallet lock comes before anything else is read, so two purchases at the same moment - the same item twice,
-- or two items the balance covers only one of - take turns, and the second reads what the first did (owned, or
-- the lower balance) instead of both spending the same coins. Should anything get past that, inventory's primary
-- key refuses a second copy and wallets' balance check an overdraft, rolling that purchase back. The inventory
-- row and the ledger's purchase row are written in the same transaction: a purchase is both or neither.
create or replace function public.shop_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_item public.shop_items;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  -- And not a guest: a guest has no profile screen and no shop (CLAUDE.md, Guests), and every rule that
  -- matters is enforced here rather than in the browser, because these functions ARE the boundary. Coins
  -- keep arriving - claim_minigame and submit-run's rewards are deliberately not gated, so what a guest
  -- earns waits for them - and it is spending and wearing them that waits too.
  if exists (select 1 from public.profiles where id = v_uid and guest) then
    raise exception 'guest_not_allowed' using errcode = 'P0001';
  end if;
  v_balance := public.wallet_lock(v_uid);
  select * into v_item from public.shop_items where id = p_item;
  if not found or not v_item.active then
    raise exception 'unavailable' using errcode = 'P0001';
  end if;
  if v_item.badge is not null then
    raise exception 'badge_only' using errcode = 'P0001';
  end if;
  if v_item.rarity = 'free' or exists (select 1 from public.inventory where user_id = v_uid and item_id = v_item.id) then
    raise exception 'owned' using errcode = 'P0001';
  end if;
  if v_balance < v_item.price then
    raise exception 'not_enough' using errcode = 'P0001';
  end if;
  insert into public.inventory (user_id, item_id) values (v_uid, v_item.id);
  -- wallet_apply records (player, 'purchase', item) only once and returns 0 when the ledger already has it. With
  -- no inventory row that can only happen after rows were edited by hand (an inventory row deleted to take an item
  -- back, say). Carrying on would hand the item over without charging for it, so refuse instead, which rolls the
  -- inventory row back too. Buying again can't clear it: put the inventory row back, or delete that ledger row.
  -- "is distinct from", so a price nulled by hand (past shop_items' check) can't slip through as free either.
  if public.wallet_apply(v_uid, -v_item.price, 'purchase', v_item.id) is distinct from -v_item.price then
    raise exception 'purchase_conflict' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'ok', true,
    'balance', (select w.balance from public.wallets w where w.user_id = v_uid),
    'item', v_item.id);
end;
$$;

-- Wears an item you own in its slot - frame, card (the card theme) or title, each taking items of its own kind -
-- or, with a null item, takes the slot's item off (back to the default: the Ink frame, the Navy card, no title).
-- Returns the details row, like save_profile. Refuses, in this order: not_signed_in; bad_slot; bad_item (no such
-- item, or not the slot's kind); not_owned. An item taken off sale can still be worn by the players who own it.
-- Only that slot's column changes (and updated_at, as with every save); a first save creates the row.
create or replace function public.equip_item(p_slot text, p_item text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_item public.shop_items;
  v_row public.profile_details;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  -- Not a guest, for the reason shop_buy gives.
  if exists (select 1 from public.profiles where id = v_uid and guest) then
    raise exception 'guest_not_allowed' using errcode = 'P0001';
  end if;
  if p_slot is null or p_slot not in ('frame', 'card', 'title') then
    raise exception 'bad_slot' using errcode = 'P0001';
  end if;
  if p_item is not null then
    select * into v_item from public.shop_items where id = p_item;
    if not found or v_item.kind <> p_slot then
      raise exception 'bad_item' using errcode = 'P0001';
    end if;
    if not (v_item.rarity = 'free'
            or exists (select 1 from public.inventory where user_id = v_uid and item_id = v_item.id)
            or (v_item.badge is not null
                and exists (select 1 from public.badge_awards where user_id = v_uid and badge = v_item.badge))) then
      raise exception 'not_owned' using errcode = 'P0001';
    end if;
  end if;
  if p_slot = 'frame' then
    insert into public.profile_details as d (user_id, frame) values (v_uid, p_item)
    on conflict (user_id) do update set frame = excluded.frame, updated_at = now()
    returning d.* into v_row;
  elsif p_slot = 'card' then
    insert into public.profile_details as d (user_id, card_theme) values (v_uid, p_item)
    on conflict (user_id) do update set card_theme = excluded.card_theme, updated_at = now()
    returning d.* into v_row;
  else
    insert into public.profile_details as d (user_id, title) values (v_uid, p_item)
    on conflict (user_id) do update set title = excluded.title, updated_at = now()
    returning d.* into v_row;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- The badges on your card, in order: at most three, none null, none twice, each shaped like a badges.mjs id -
-- otherwise bad_showcase. Null saves none. Returns the details row. A multi-dimensional array isn't a list of
-- ids, so it's bad_showcase too (the row would hold it, and the card would read [["a"]]); an array numbered from
-- somewhere other than 1 is saved renumbered. It doesn't check the badges are earned: badges are worked out in
-- the browser from a player's stats, one earned since their last finished season isn't in badge_awards yet, and
-- the card shows only the earned ones anyway.
create or replace function public.set_showcase(p_badges text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_badges text[] := coalesce(p_badges, '{}'::text[]);
  v_row public.profile_details;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  -- Not a guest, for the reason shop_buy gives.
  if exists (select 1 from public.profiles where id = v_uid and guest) then
    raise exception 'guest_not_allowed' using errcode = 'P0001';
  end if;
  if cardinality(v_badges) > 3
     or coalesce(array_ndims(v_badges), 1) > 1
     or exists (select 1 from unnest(v_badges) as b(id) where b.id is null or b.id !~ '^[a-z0-9-]{1,40}$')
     or (select count(distinct b.id) from unnest(v_badges) as b(id)) <> cardinality(v_badges) then
    raise exception 'bad_showcase' using errcode = 'P0001';
  end if;
  v_badges := array(select b.id from unnest(v_badges) with ordinality as b(id, n) order by b.n);
  insert into public.profile_details as d (user_id, showcase) values (v_uid, v_badges)
  on conflict (user_id) do update set showcase = excluded.showcase, updated_at = now()
  returning d.* into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.shop_state(), public.shop_buy(text), public.equip_item(text, text),
  public.set_showcase(text[]) from public, anon;
grant execute on function public.shop_state(), public.shop_buy(text), public.equip_item(text, text),
  public.set_showcase(text[]) to authenticated;
