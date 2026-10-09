create table auth.anonymous_sessions(
  owner_id uuid primary key references auth.users(id) on delete cascade,
  refresh_hash text not null unique,previous_hash text,refresh_ciphertext text not null,
  rotated_at timestamptz not null default now(),created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days'
);
create index sessions_previous_idx on auth.anonymous_sessions(previous_hash) where previous_hash is not null;
create table auth.creation_events(id bigint generated always as identity primary key,ip_hash text not null,created_at timestamptz not null default now());
create index creation_events_ip_idx on auth.creation_events(ip_hash,created_at desc);
create table public.schedule_ticks(minute timestamptz primary key);
alter table auth.anonymous_sessions enable row level security;
alter table auth.creation_events enable row level security;
alter table public.schedule_ticks enable row level security;
revoke all on auth.anonymous_sessions,auth.creation_events,public.schedule_ticks from public,anon,authenticated;
-- Contract fields remain identical; these defaults describe the actual Node normalizer.
alter table public.upload_sessions alter column normalizer_version set default 'sharp-webp-v3-1';
