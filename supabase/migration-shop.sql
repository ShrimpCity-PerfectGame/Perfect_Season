-- v1.12.0 Wallet & Shop, part 2: the shop. Contract: SHOP.md (3.2).
--
-- Run after migration-wallet.sql, then re-run migration-profiles.sql (its set_avatar lets a player pick the
-- avatars from a pack they own). Re-runnable.
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
  ('title-undefeated', 'title', 'badge', null, 'undefeated', 50),
  ('title-daily-winner', 'title', 'badge', null, 'daily-winner', 60),
  ('title-cinderella', 'title', 'badge', null, 'cinderella', 70),
  ('pack-sideline', 'avatar_pack', 'common', 750, null, 10),
  ('pack-trophy-room', 'avatar_pack', 'rare', 2000, null, 20),
  ('pack-night-game', 'avatar_pack', 'epic', 6000, null, 30)
on conflict (id) do nothing;

-- What each player has bought. Free items belong to everyone and a badge item to whoever has its badge in
-- badge_awards, so only bought items get rows.
create table if not exists public.inventory (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  item_id      text not null references public.shop_items(id),
  acquired_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- The avatar packs' avatars (shop-catalog.mjs's AVATAR_PACKS; avatars.jsx draws them). Picking one needs its pack.
insert into public.avatar_presets (key, pack, free) values
  ('headset', 'sideline', false), ('cooler', 'sideline', false), ('pylon', 'sideline', false), ('penalty-flag', 'sideline', false),
  ('title-ring', 'trophy-room', false), ('medal', 'trophy-room', false), ('banner', 'trophy-room', false), ('game-ball', 'trophy-room', false),
  ('floodlights', 'night-game', false), ('scoreboard', 'night-game', false), ('fireworks', 'night-game', false), ('blimp', 'night-game', false)
on conflict (key) do update set pack = excluded.pack, free = excluded.free;

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

-- ---------- The shop's functions (agent J) ----------
-- shop_state, shop_buy, equip_item, set_showcase (SHOP.md 3.2).
