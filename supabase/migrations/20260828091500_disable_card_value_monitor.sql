-- Retire every database-side trigger for the former Card-Value monitor.
do $$
declare
  existing_job bigint;
begin
  if to_regclass('cron.job') is not null then
    for existing_job in
      select jobid from cron.job where jobname = 'cardboy-daily-price-check'
    loop
      perform cron.unschedule(existing_job);
    end loop;
  end if;
end
$$;

alter table public.cards
  alter column monitor_message set default 'Price updates come directly from Yuyutei through Update Queue.';

update public.cards
set monitor_message = 'Price updates come directly from Yuyutei through Update Queue.'
where monitor_message ilike '%Card-Value%'
   or monitor_message ilike '%scheduled%price%check%';
