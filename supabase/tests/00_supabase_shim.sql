-- Minimal stand-in for the parts of a Supabase project the Fluent schema
-- depends on, so `supabase/schema.sql` and the migrations can be applied to a
-- plain PostgreSQL 16 instance and exercised in CI or locally.
--
-- This file is a TEST FIXTURE. It is never applied to a real project — a hosted
-- Supabase database already provides `auth.users`, `auth.uid()` and the
-- anon/authenticated/service_role roles, and provides them with more behaviour
-- than is reproduced here.
--
-- Usage: see supabase/tests/README.md.

create schema if not exists auth;

-- The columns the app's foreign keys and the signup trigger actually touch.
create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase resolves the acting user from the JWT claims PostgREST puts into a
-- transaction-local GUC. The shim keeps the same contract so
-- `set_config('request.jwt.claims', …)` selects the acting user in tests.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

-- The three roles PostgREST switches into. `authenticator` is the login role
-- that performs the SET ROLE, exactly as in a hosted project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;
grant select on auth.users   to service_role;

-- STORAGE. Enough of `storage.buckets` and `storage.objects` for the private
-- book-import bucket's policies to be created and exercised. A hosted project's
-- Storage schema has far more (metadata, multipart uploads, triggers); what the
-- security tests need is the two columns the policies read — `bucket_id` and
-- `name` — and RLS behaving the way it does in production.
create schema if not exists storage;

create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name      text not null,
  owner     uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists storage_objects_bucket_name_idx
  on storage.objects (bucket_id, name);

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Supabase grants the API roles table privileges and relies on RLS to scope
-- them; mirroring that is what makes the RLS tests meaningful.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
