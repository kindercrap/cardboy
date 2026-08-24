create table if not exists public.price_monitor_status (
  id text primary key,
  status text not null default 'idle',
  trigger text not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  last_success_at timestamptz,
  processed_sources integer not null default 0,
  total_sources integer not null default 0,
  checked_sources integer not null default 0,
  observations integer not null default 0,
  movements integer not null default 0,
  unsupported_sources integer not null default 0,
  message text not null default 'Waiting for the next scheduled price check.',
  updated_at timestamptz not null default now(),
  constraint price_monitor_status_value_check
    check (status in ('idle', 'running', 'success', 'error')),
  constraint price_monitor_status_counts_check
    check (
      processed_sources >= 0 and total_sources >= 0 and checked_sources >= 0
      and observations >= 0 and movements >= 0 and unsupported_sources >= 0
    )
);

insert into public.price_monitor_status (id)
values ('daily')
on conflict (id) do nothing;

alter table public.price_monitor_status enable row level security;
revoke all on public.price_monitor_status from anon, authenticated;
