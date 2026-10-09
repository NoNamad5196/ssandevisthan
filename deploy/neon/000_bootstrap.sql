-- User-authorized replacement for Supabase. New dedicated Neon Free project only.
-- Apply before supabase/migrations/*.sql, then 004_runtime.sql. No managed Auth is assumed.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create table auth.users(id uuid primary key,created_at timestamptz not null default now());
alter table auth.users enable row level security;
revoke all on auth.users from public,anon,authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
-- Bucket contract registry. Actual private S3 bucket is provisioned by neon.ts.
create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
revoke all on storage.buckets from public,anon,authenticated;
