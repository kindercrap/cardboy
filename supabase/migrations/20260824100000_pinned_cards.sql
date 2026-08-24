alter table public.cards
  add column if not exists is_pinned boolean not null default false;

create index if not exists cards_user_pinned_sort_order_idx
  on public.cards(user_id, is_pinned desc, sort_order, created_at);
