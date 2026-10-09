-- Existing projects may still link profiles.id to auth.users from an earlier
-- Supabase Auth implementation. Sites supplies its own authenticated identity,
-- so application profiles must not require a matching auth.users row.
alter table public.profiles drop constraint if exists profiles_id_fkey;
