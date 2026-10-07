-- Run in Supabase -> SQL Editor AFTER the two users exist (Authentication -> Users -> Add user, tick "Auto Confirm User",
-- or run scripts/create-users.js which does that for you). This only assigns the roles; it never stores passwords.
insert into public.profiles (id, role, name)
select id, 'admin', 'Sravan' from auth.users where email = 'durgasravan21@gmail.com'
on conflict (id) do update set role = excluded.role, name = excluded.name;

insert into public.profiles (id, role, name)
select id, 'collector', 'Father' from auth.users where email = 'challagollasridevi@gmail.com'
on conflict (id) do update set role = excluded.role, name = excluded.name;
