create table if not exists public.profiles (
  user_id text primary key,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.works (
  id text primary key,
  external_id text,
  title text not null,
  original_title text,
  creator text not null,
  release_year integer,
  media_type text not null,
  poster_url text,
  description text not null default '',
  tags jsonb not null default '[]'::jsonb,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.archive_items (
  user_id text not null references public.profiles(user_id) on delete cascade,
  work_id text not null references public.works(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

create index if not exists archive_items_user_created_idx
  on public.archive_items (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.archive_items enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.works from anon, authenticated;
revoke all on public.archive_items from anon, authenticated;

grant all on public.profiles to service_role;
grant all on public.works to service_role;
grant all on public.archive_items to service_role;
