create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  series text not null,
  code text not null,
  title text not null,
  quantity integer not null default 1 check (quantity > 0),
  source_url text not null,
  source_currency text not null check (source_currency in ('JPY', 'USD')),
  source_price numeric not null check (source_price >= 0),
  image_url text,
  change_percent numeric not null default 0,
  last_checked timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.price_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  card_id text not null,
  source_price numeric not null,
  source_currency text not null check (source_currency in ('JPY', 'USD')),
  php_price numeric not null,
  checked_at timestamptz not null default now(),
  foreign key (user_id, card_id) references public.cards(user_id, id) on delete cascade
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text,
  title text not null,
  message text not null,
  change_percent numeric not null default 0,
  automatic boolean not null default true,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_rates (
  user_id uuid primary key references auth.users(id) on delete cascade,
  jpy_rate numeric not null default 0.39,
  usd_rate numeric not null default 56.80,
  use_live_rate boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.fx_rates (
  currency text primary key check (currency in ('JPY', 'USD')),
  php_rate numeric not null,
  fetched_at timestamptz not null default now()
);

insert into public.fx_rates (currency, php_rate) values ('JPY', 0.39), ('USD', 56.80)
on conflict (currency) do nothing;

create index if not exists cards_source_url_idx on public.cards(source_url);
create index if not exists price_snapshots_user_card_time_idx on public.price_snapshots(user_id, card_id, checked_at desc);
create index if not exists notifications_user_time_idx on public.notifications(user_id, created_at desc);

alter table public.cards enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.notifications enable row level security;
alter table public.user_rates enable row level security;
alter table public.fx_rates enable row level security;

drop policy if exists "Users manage their cards" on public.cards;
create policy "Users manage their cards" on public.cards for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read their price history" on public.price_snapshots;
create policy "Users read their price history" on public.price_snapshots for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert their price history" on public.price_snapshots;
create policy "Users insert their price history" on public.price_snapshots for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users read their notifications" on public.notifications;
create policy "Users read their notifications" on public.notifications for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users update their notifications" on public.notifications;
create policy "Users update their notifications" on public.notifications for update
using ((select auth.uid()) = user_id);

drop policy if exists "Users delete their notifications" on public.notifications;
create policy "Users delete their notifications" on public.notifications for delete
using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their rates" on public.user_rates;
create policy "Users manage their rates" on public.user_rates for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Anyone reads FX rates" on public.fx_rates;
create policy "Anyone reads FX rates" on public.fx_rates for select using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-images', 'card-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users upload their card images" on storage.objects;
create policy "Users upload their card images" on storage.objects for insert to authenticated
with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users update their card images" on storage.objects;
create policy "Users update their card images" on storage.objects for update to authenticated
using (bucket_id = 'card-images' and owner_id = (select auth.uid())::text);

drop policy if exists "Users delete their card images" on storage.objects;
create policy "Users delete their card images" on storage.objects for delete to authenticated
using (bucket_id = 'card-images' and owner_id = (select auth.uid())::text);
