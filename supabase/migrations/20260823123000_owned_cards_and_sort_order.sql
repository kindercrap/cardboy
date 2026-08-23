alter table public.cards
  add column if not exists is_owned boolean not null default true,
  add column if not exists sort_order integer not null default 0;

with ranked_cards as (
  select
    user_id,
    id,
    (row_number() over (partition by user_id order by created_at, id) - 1)::integer as position
  from public.cards
)
update public.cards as cards
set sort_order = ranked_cards.position
from ranked_cards
where cards.user_id = ranked_cards.user_id
  and cards.id = ranked_cards.id;

create index if not exists cards_user_sort_order_idx
  on public.cards(user_id, sort_order, created_at);
