-- Gangaya Finance database. Run once in Supabase -> SQL Editor. Safe to re-run.

create table if not exists public.profiles (
  id   uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','collector')),
  name text not null default ''
);

create table if not exists public.docs (
  collection text not null check (collection in ('members','villages','txns','rem')),
  id         text not null check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists docs_collection_created on public.docs (collection, created_at);

alter table public.profiles enable row level security;
alter table public.docs     enable row level security;
revoke all on public.profiles, public.docs from anon;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

-- Who may do what:
--   admin     : read everything, add/edit members, villages, loans, payments; mark receipts sent.
--   collector : read everything, ADD payments only.
--   nobody    : delete or edit a payment/loan record (records are permanent).
drop policy if exists profiles_self          on public.profiles;
drop policy if exists docs_read              on public.docs;
drop policy if exists docs_insert_admin      on public.docs;
drop policy if exists docs_insert_collector  on public.docs;
drop policy if exists docs_update_admin      on public.docs;
drop policy if exists docs_delete_admin      on public.docs;

create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
create policy docs_read on public.docs for select to authenticated
  using (public.my_role() in ('admin','collector'));
create policy docs_insert_admin on public.docs for insert to authenticated
  with check (public.my_role() = 'admin');
create policy docs_insert_collector on public.docs for insert to authenticated
  with check (public.my_role() = 'collector' and collection = 'txns');
create policy docs_update_admin on public.docs for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy docs_delete_admin on public.docs for delete to authenticated
  using (public.my_role() = 'admin' and collection <> 'txns');

-- Server-side checks: validation, trusted time and author on every payment/loan,
-- and payment/loan records can never be edited (only the receipt "sent" flag may change).
create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text; dd date;
begin
  if tg_op = 'INSERT' then
    if new.collection = 'txns' then
      if new.data->>'type' is null or new.data->>'type' not in ('pay','loan') then raise exception 'invalid record type'; end if;
      if coalesce((new.data->>'amt')::numeric, 0) <= 0 then raise exception 'amount must be positive'; end if;
      if coalesce(new.data->>'mid', '') = '' then raise exception 'member missing'; end if;
      if new.data->>'type' = 'loan' and coalesce((new.data->>'repay')::numeric, 0) < (new.data->>'amt')::numeric then
        raise exception 'total to return must be at least the loan amount'; end if;
      if new.data->>'type' = 'pay' and coalesce(new.data->>'mode', '') not in ('cash','upi') then
        raise exception 'mode must be cash or upi'; end if;
      select coalesce(nullif(name, ''), role) into nm from public.profiles where id = auth.uid();
      if new.data->>'past' = 'true' then
        -- History entered by the admin: the date is chosen by the admin, everything else is stamped by the server.
        if public.my_role() <> 'admin' then raise exception 'only the admin can add past records'; end if;
        if coalesce(new.data->>'d', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'a date is required for a past record'; end if;
        dd := (new.data->>'d')::date;
        if dd > (clock_timestamp() at time zone 'Asia/Kolkata')::date then raise exception 'a past record cannot be dated in the future'; end if;
        if dd < date '1990-01-01' then raise exception 'that date is too old'; end if;
        new.data := (new.data - 'entered_at') || jsonb_build_object(
          'ts', (extract(epoch from ((dd + case when new.data->>'type' = 'loan' then time '09:00' else time '12:00' end) at time zone 'Asia/Kolkata')) * 1000)::bigint,
          'by', coalesce(nm, 'user'), 'sent', true, 'past', true,
          'entered_at', (extract(epoch from clock_timestamp()) * 1000)::bigint);
      else
        new.data := (new.data - 'past' - 'entered_at') || jsonb_build_object(
          'ts',   (extract(epoch from clock_timestamp()) * 1000)::bigint,
          'd',    to_char(clock_timestamp() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'by',   coalesce(nm, 'user'),
          'sent', false);
      end if;
    end if;
  elsif tg_op = 'DELETE' then
    if old.collection = 'members' and exists (select 1 from public.docs t where t.collection = 'txns' and t.data->>'mid' = old.id) then
      raise exception 'this member has records; archive the member instead of deleting';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if new.collection <> old.collection or new.id <> old.id then raise exception 'a record cannot be moved'; end if;
    if old.collection = 'txns' and (new.data - 'sent') is distinct from (old.data - 'sent') then
      raise exception 'payment and loan records cannot be edited'; end if;
  end if;
  return new;
end $$;
drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before insert or update or delete on public.docs
  for each row execute function public.docs_guard();

-- Partial update used by the app (runs with the caller's permissions).
create or replace function public.doc_update(c text, i text, patch jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  update public.docs set data = data || patch where collection = c and id = i;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.doc_update(text, text, jsonb) from public;
grant execute on function public.doc_update(text, text, jsonb) to authenticated;

-- Live updates between the two phones.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
