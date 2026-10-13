-- Settings → Theme: the colours an administrator or lecturer chooses belong to their
-- account, so they follow them to every device and website. Each person reads and
-- writes only their own row. Run once in the Supabase SQL editor; until then the
-- Theme tab stays hidden.

create table if not exists public.user_preferences (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- {"primary": "#3949ab", ...}: only the colours that differ from Stando's own.
  theme      jsonb check (theme is null or (jsonb_typeof(theme) = 'object' and octet_length(theme::text) <= 1000)),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Read own preferences" on public.user_preferences;
create policy "Read own preferences" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Add own preferences" on public.user_preferences;
create policy "Add own preferences" on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Change own preferences" on public.user_preferences;
create policy "Change own preferences" on public.user_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Remove own preferences" on public.user_preferences;
create policy "Remove own preferences" on public.user_preferences
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_preferences from anon;
grant select, insert, update, delete on public.user_preferences to authenticated;
