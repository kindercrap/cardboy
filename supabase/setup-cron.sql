-- CardBoy intentionally has no unattended price-check schedule.
-- Run this once to remove the former Card-Value cron job if it exists.

do $$
declare
  existing_job bigint;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  for existing_job in
    select jobid from cron.job where jobname = 'cardboy-daily-price-check'
  loop
    perform cron.unschedule(existing_job);
  end loop;
end
$$;
