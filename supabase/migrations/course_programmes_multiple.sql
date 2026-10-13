-- A course can belong to several programmes (a course shared by two degrees, say).
-- Follows course_programmes.sql: the programme each course had stays as its first.
-- Run once in the Supabase SQL editor. Stando reads the old single programme until then.

alter table public.courses
  add column if not exists programme_ids integer[] not null default '{}';

update public.courses
   set programme_ids = array[programme_id]
 where programme_id is not null
   and programme_ids = '{}';

create index if not exists courses_programme_ids_idx on public.courses using gin (programme_ids);

-- save_course_settings: as before, but programmeIds (a list; administrators only, [] clears it)
-- replaces programmeId. A programmeId alone, from a page not yet reloaded, still works.
create or replace function public.save_course_settings(p jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_is_global boolean := public.is_global_admin();
  v_original  text    := coalesce(p ->> 'originalName', '');
  v_new_name  text    := coalesce(p ->> 'courseName', '');
  v_row  public.courses;
  v_json jsonb;
  v_rec  public.courses;
  v_was_archived  boolean;
  v_will_archived boolean;
  v_eis     text;
  v_name    text;
  v_suffix  text;
  v_base    text;
  v_programmes jsonb;
begin
  if not public.is_course_admin(v_original) then
    return jsonb_build_object('result', 'error', 'message', 'Authorization failed.');
  end if;

  -- delete
  if coalesce((p ->> 'isDelete')::boolean, false) then
    if not v_is_global then
      return jsonb_build_object('result', 'error', 'message', 'Only Global Admins can delete courses.');
    end if;
    delete from courses where name = v_original;
    delete from attendance_logs where course_name = v_original;
    delete from deleted_logs where course_name = v_original;
    return jsonb_build_object('result', 'success', 'message', 'Course and data deleted.');
  end if;

  -- manual rename validation
  if v_original <> '' and v_new_name <> '' and v_original <> v_new_name then
    if length(v_new_name) > 100 then
      return jsonb_build_object('result', 'error', 'message', 'Course name too long.');
    end if;
    if v_new_name ~ '[][:\\/?*]' then
      return jsonb_build_object('result', 'error', 'message', 'Invalid characters in name.');
    end if;
    if exists (select 1 from courses where name = v_new_name) then
      return jsonb_build_object('result', 'error',
        'message', format('A course named "%s" already exists.', v_new_name));
    end if;
  end if;

  if length(btrim(coalesce(p ->> 'courseTitle', ''))) > 150 then
    return jsonb_build_object('result', 'error', 'message', 'Course name is too long (max 150 characters).');
  end if;

  -- The programmes, as a sorted list without repeats.
  if p ? 'programmeIds' then
    if jsonb_typeof(p -> 'programmeIds') <> 'array'
       or exists (select 1 from jsonb_array_elements_text(p -> 'programmeIds') as e(value) where e.value !~ '^[0-9]{1,9}$') then
      return jsonb_build_object('result', 'error', 'message', 'Programmes must be a list of programmes.');
    end if;
    select coalesce(jsonb_agg(ids.id order by ids.id), '[]'::jsonb) into v_programmes
      from (select distinct e.value::integer as id from jsonb_array_elements_text(p -> 'programmeIds') as e(value)) ids;
  elsif p ? 'programmeId' then
    v_programmes := case when nullif(p ->> 'programmeId', '') is null then '[]'::jsonb
                         else jsonb_build_array((p ->> 'programmeId')::integer) end;
  end if;

  if v_programmes is not null and exists (
       select 1 from jsonb_array_elements_text(v_programmes) as e(value)
        where not exists (select 1 from programmes where programmes.id = e.value::integer)) then
    return jsonb_build_object('result', 'error', 'message', 'A programme chosen no longer exists. Reload Stando and choose again.');
  end if;

  if v_original <> '' then
    select * into v_row from courses where name = v_original;
    if not found then
      return jsonb_build_object('result', 'error', 'message', 'Course not found.');
    end if;
    v_json := to_jsonb(v_row);
  else
    v_json := '{}'::jsonb;
  end if;

  -- non-globals may only change defaultHours and availableSections
  if v_is_global then
    if v_new_name <> ''                          then v_json := v_json || jsonb_build_object('name', v_new_name); end if;
    if p ? 'courseTitle'                         then v_json := v_json || jsonb_build_object('title', nullif(btrim(p ->> 'courseTitle'), '')); end if;
    if coalesce(p ->> 'startDate', '') <> ''     then v_json := v_json || jsonb_build_object('start_date', p ->> 'startDate'); end if;
    if coalesce(p ->> 'endDate', '') <> ''       then v_json := v_json || jsonb_build_object('end_date', p ->> 'endDate'); end if;
    if coalesce(p ->> 'holidayWeeks', '') <> ''  then v_json := v_json || jsonb_build_object('holiday_weeks', p ->> 'holidayWeeks'); end if;
    if coalesce(p ->> 'holidayStartDate', '') <> '' then v_json := v_json || jsonb_build_object('holiday_start_date', p ->> 'holidayStartDate'); end if;
    if p ? 'eisId'                               then v_json := v_json || jsonb_build_object('eis_id', p ->> 'eisId'); end if;
    if coalesce(p ->> 'adminEmails', '') <> ''   then v_json := v_json || jsonb_build_object('admin_emails', p ->> 'adminEmails'); end if;
    if p ? 'archived'                            then v_json := v_json || jsonb_build_object('archived', coalesce((p ->> 'archived')::boolean, false)); end if;
    if v_programmes is not null                  then v_json := v_json || jsonb_build_object('programme_ids', v_programmes); end if;
  end if;
  if p ? 'defaultHours'      then v_json := v_json || jsonb_build_object('default_hours', p ->> 'defaultHours'); end if;
  if p ? 'availableSections' then v_json := v_json || jsonb_build_object('available_sections', p ->> 'availableSections'); end if;

  -- Archive/unarchive auto-suffixing (existing courses only, needs an EIS ID)
  if v_original <> '' then
    v_was_archived  := coalesce(v_row.archived, false);
    v_will_archived := coalesce((v_json ->> 'archived')::boolean, v_was_archived);
    v_eis  := coalesce(v_json ->> 'eis_id', '');
    v_name := v_json ->> 'name';

    if v_eis <> '' then
      v_suffix := '_' || v_eis;

      if v_will_archived and not v_was_archived then
        -- archiving: append the EIS suffix unless it is already there
        if right(v_name, length(v_suffix)) <> v_suffix
           and not exists (select 1 from courses where name = v_name || v_suffix and name <> v_original) then
          v_json := v_json || jsonb_build_object('name', v_name || v_suffix);
        end if;

      elsif (not v_will_archived) and v_was_archived then
        -- unarchiving: drop the suffix only when the base code is free
        if right(v_name, length(v_suffix)) = v_suffix then
          v_base := left(v_name, length(v_name) - length(v_suffix));
          if v_base <> '' and not exists (select 1 from courses where name = v_base and name <> v_original) then
            v_json := v_json || jsonb_build_object('name', v_base);
          end if;
        end if;
      end if;
    end if;
  end if;

  v_rec := jsonb_populate_record(null::public.courses, v_json);

  if v_original <> '' then
    update courses set
      name               = v_rec.name,
      title              = v_rec.title,
      start_date         = v_rec.start_date,
      end_date           = v_rec.end_date,
      holiday_weeks      = v_rec.holiday_weeks,
      holiday_start_date = v_rec.holiday_start_date,
      default_hours      = v_rec.default_hours,
      eis_id             = v_rec.eis_id,
      admin_emails       = v_rec.admin_emails,
      available_sections = v_rec.available_sections,
      archived           = coalesce(v_rec.archived, archived),
      programme_ids      = coalesce(v_rec.programme_ids, '{}')
    where name = v_original;

    -- keep dependent rows consistent whenever the name actually changed
    -- (covers manual rename AND the archive/unarchive auto-suffix)
    if v_rec.name is not null and v_rec.name <> v_original then
      update attendance_logs set course_name = v_rec.name where course_name = v_original;
      update deleted_logs    set course_name = v_rec.name where course_name = v_original;
      update absences        set course      = v_rec.name where course      = v_original;
    end if;
  else
    if not v_is_global then
      return jsonb_build_object('result', 'error', 'message', 'Only Global Admins can create new courses.');
    end if;
    if exists (select 1 from courses where name = v_new_name) then
      return jsonb_build_object('result', 'error',
        'message', format('A course named "%s" already exists.', v_new_name));
    end if;
    v_json := v_json || jsonb_build_object('name', v_new_name);
    v_rec := jsonb_populate_record(null::public.courses, v_json);
    insert into courses
      (name, title, start_date, end_date, holiday_weeks, holiday_start_date,
       default_hours, eis_id, admin_emails, available_sections, archived, programme_ids)
    values
      (v_rec.name, v_rec.title, v_rec.start_date, v_rec.end_date, v_rec.holiday_weeks, v_rec.holiday_start_date,
       v_rec.default_hours, v_rec.eis_id, v_rec.admin_emails, v_rec.available_sections,
       coalesce(v_rec.archived, false), coalesce(v_rec.programme_ids, '{}'));
  end if;

  return jsonb_build_object('result', 'success', 'message', 'Course settings saved.');
end;
$function$;

-- delete_programme: its courses take the programme its students move to, or simply lose it.
create or replace function public.delete_programme(p_id integer, p_move_to integer default null::integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_moved integer;
begin
  if not public.is_global_admin() then
    raise exception 'Only administrators can delete programmes.';
  end if;
  if p_move_to = p_id then
    raise exception 'Choose another programme for its students.';
  end if;
  if p_move_to is not null and not exists (select 1 from public.programmes where id = p_move_to) then
    raise exception 'The programme chosen for its students no longer exists.';
  end if;
  if p_move_to is null and exists (select 1 from public.students where programme_id = p_id) then
    raise exception 'Students study this programme now. Reload Stando and choose where they move.';
  end if;

  update public.students set programme_id = p_move_to where programme_id = p_id;
  get diagnostics v_moved = row_count;
  update public.registrations set programme_id = p_move_to where programme_id = p_id;
  update public.courses
     set programme_ids = case
           when p_move_to is null or p_move_to = any(programme_ids) then array_remove(programme_ids, p_id)
           else array_replace(programme_ids, p_id, p_move_to)
         end
   where p_id = any(programme_ids);

  delete from public.programmes where id = p_id;
  if not found then
    raise exception 'That programme no longer exists.';
  end if;

  return jsonb_build_object('result', 'success', 'moved', v_moved);
end;
$function$;

-- The single programme is now the list's job.
drop index if exists public.courses_programme_id_idx;
alter table public.courses drop column if exists programme_id;
