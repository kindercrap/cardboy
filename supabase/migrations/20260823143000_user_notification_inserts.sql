drop policy if exists "Users insert their notifications" on public.notifications;
create policy "Users insert their notifications" on public.notifications for insert
with check ((select auth.uid()) = user_id);
