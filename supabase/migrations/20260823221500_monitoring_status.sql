alter table public.cards
  add column if not exists monitor_status text not null default 'pending',
  add column if not exists monitor_message text not null default 'Waiting for the next scheduled catalog check.',
  add column if not exists monitor_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cards_monitor_status_check'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_monitor_status_check
      check (monitor_status in ('pending', 'active', 'unsupported'));
  end if;
end $$;
