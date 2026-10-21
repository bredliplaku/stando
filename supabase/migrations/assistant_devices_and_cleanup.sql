-- Stando: teaching assistants trust their own devices, and what is no longer
-- used goes. Run once in the Supabase SQL Editor, after
-- assistants_and_course_appearance.sql; running it again changes nothing.
--
-- 1. A staff card signs in only on a trusted device, a teaching assistant's too
--    (kiosk-login). An assistant trusts their own devices from their profile and
--    sees only those; lecturers and administrators still see every device.
-- 2. Gone: each account's own colours (courses have colours now) and
--    verify_staff_card (verify_scan_unlock_card replaced it).

-- ---------------------------------------------------------------------------
-- 1. Teaching assistants' devices
-- ---------------------------------------------------------------------------

-- Whether the signed-in account is a teaching assistant, assigned to a course or not.
create or replace function public.is_assistant_member()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from staff
    where lower(email) = public.jwt_email() and role = 'Assistant'
  );
$$;

create or replace function public.assistant_course_names()
returns text[]
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(c.name), '{}')
  from courses c
  where public.jwt_email() <> ''
    and public.is_assistant_member()
    and exists (
      select 1
      from unnest(string_to_array(coalesce(c.assistant_emails, ''), ',')) e
      where lower(trim(e)) = public.jwt_email()
    );
$$;

-- isAssistant: the profile offers Trusted devices to every assistant.
create or replace function public.check_admin_status()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'isGlobalAdmin',    public.is_global_admin(),
    'isAdmin',          public.is_any_admin(),
    'courses',          to_jsonb(public.admin_course_names()),
    'isAssistant',      public.is_assistant_member(),
    'assistantCourses', to_jsonb(public.assistant_course_names())
  );
$$;

-- The insert, rename and delete policies already limit everyone but
-- administrators to the devices they registered.
create or replace function public.can_trust_devices()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.is_staff_member() or public.is_any_admin() or public.is_assistant_member();
$$;

drop policy if exists devices_select on public.trusted_devices;
create policy devices_select on public.trusted_devices
  for select to authenticated
  using (is_staff_member() or is_any_admin() or (can_trust_devices() and lower(owner) = jwt_email()));

-- ---------------------------------------------------------------------------
-- 2. No longer used
-- ---------------------------------------------------------------------------

-- Each account's own colours (Settings → Theme), with its policies.
drop table if exists public.user_preferences;

-- The staff card check from before colleagues could unlock a lecturer's phone.
drop function if exists public.verify_staff_card(text[], text);
