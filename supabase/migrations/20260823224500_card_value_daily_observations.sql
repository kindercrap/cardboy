alter table public.cards
  add column if not exists card_value_url text;

alter table public.cards
  alter column monitor_message set default 'Waiting for the next scheduled Card-Value check.';

update public.cards
set monitor_message = 'Waiting for the next scheduled Card-Value check.'
where monitor_status = 'pending'
  and monitor_message = 'Waiting for the next scheduled catalog check.';

create table if not exists public.daily_price_observations (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  card_id text not null,
  card_number text not null,
  variant text,
  card_value_url text not null,
  yuyutei_url text,
  price numeric not null check (price >= 0),
  currency text not null default 'JPY' check (currency = 'JPY'),
  source text not null default 'yuyutei' check (source = 'yuyutei'),
  source_via text not null default 'card-value.jp' check (source_via = 'card-value.jp'),
  price_change numeric,
  percentage_change numeric,
  observed_at timestamptz not null default now(),
  observation_day date not null default ((now() at time zone 'Asia/Manila')::date),
  foreign key (user_id, card_id) references public.cards(user_id, id) on delete cascade,
  unique (user_id, card_id, source, source_via, observation_day)
);

create index if not exists daily_price_observations_card_time_idx
  on public.daily_price_observations(user_id, card_id, observed_at desc);

create index if not exists cards_card_value_url_idx
  on public.cards(card_value_url)
  where card_value_url is not null;

alter table public.daily_price_observations enable row level security;

drop policy if exists "Users read their daily price observations" on public.daily_price_observations;
create policy "Users read their daily price observations"
  on public.daily_price_observations for select
  using ((select auth.uid()) = user_id);
