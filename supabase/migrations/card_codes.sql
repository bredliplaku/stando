-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- A friend's card travels as a code. When a student scans a classmate's card in
-- Register Card ID → Scan a friend's card, the server keeps the Card ID and
-- returns an eight-character code. The classmate types the code, and the server
-- files the registration with the Card ID it stands for, so the Card ID never
-- appears on either screen. A code works once, for 30 minutes.

create table if not exists public.card_codes (
  code         text primary key,
  card_id      text not null,
  hardware_uid text,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 minutes'
);

-- Only the two functions below read or write codes.
alter table public.card_codes enable row level security;
revoke all on public.card_codes from anon, authenticated;

create or replace function public.create_card_code(p_card_id text, p_hardware_uid text)
returns text
language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_email text := public.jwt_email();
  v_card  text := btrim(coalesce(p_card_id, ''));
  -- 32 letters and digits that cannot be confused: no 0, O, 1 or I.
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code  text;
begin
  if v_email = '' then
    raise exception 'Sign in to scan a card.';
  end if;
  if v_card = '' or length(v_card) > 40 then
    raise exception 'That card could not be read. Scan it again.';
  end if;

  delete from public.card_codes where expires_at < now();

  if (select count(*) from public.card_codes
      where created_by = v_email and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'Too many cards scanned. Try again in a few minutes.';
  end if;

  -- Scanning the same card again shows the same code while it is still valid.
  select c.code into v_code
    from public.card_codes c
   where c.card_id = v_card and c.created_by = v_email
     and c.expires_at > now() + interval '5 minutes'
   limit 1;
  if v_code is not null then
    return v_code;
  end if;

  loop
    -- Bytes 0-5 and 10-11 of a version 4 UUID are random; 256 is a multiple of 32.
    v_bytes := uuid_send(gen_random_uuid());
    select string_agg(substr(v_alphabet, 1 + get_byte(v_bytes, t.i) % 32, 1), '' order by t.ord)
      into v_code
      from unnest(array[0, 1, 2, 3, 4, 5, 10, 11]) with ordinality as t(i, ord);
    exit when not exists (select 1 from public.card_codes where code = v_code);
  end loop;

  insert into public.card_codes (code, card_id, hardware_uid, created_by)
  values (v_code, v_card, nullif(btrim(coalesce(p_hardware_uid, '')), ''), v_email);
  return v_code;
end;
$$;
revoke all on function public.create_card_code(text, text) from public, anon;
grant execute on function public.create_card_code(text, text) to authenticated;

create or replace function public.submit_card_code_registration(p_code text, p_name text)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_email text := public.jwt_email();
  v_code  text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_row   public.card_codes;
begin
  if v_email = '' then
    raise exception 'Sign in to register your card.';
  end if;

  -- A used code is deleted, so each one works once.
  delete from public.card_codes
   where code = v_code and expires_at > now()
  returning * into v_row;
  if not found then
    return jsonb_build_object('result', 'error',
      'message', 'That code is wrong or has expired. Ask your friend to scan your card again.');
  end if;

  -- "Sent by" names the friend who scanned the card.
  insert into public.registrations (name, uid, email, submitted_at, sent_by)
  values (coalesce(nullif(btrim(coalesce(p_name, '')), ''), v_email), v_row.card_id, v_email, now(), v_row.created_by);

  return jsonb_build_object('result', 'success', 'message', 'Registration submitted successfully');
end;
$$;
revoke all on function public.submit_card_code_registration(text, text) from public, anon;
grant execute on function public.submit_card_code_registration(text, text) to authenticated;
