create table if not exists public.profiles (
  id uuid primary key,
  display_name text not null,
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
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_id text not null references public.works(id) on delete cascade,
  rating smallint,
  my_comment text not null default '',
  ai_comment text not null default '',
  analysis_status text not null default 'pending',
  analysis_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

alter table public.archive_items add column if not exists rating smallint;
alter table public.archive_items add column if not exists my_comment text not null default '';
alter table public.archive_items add column if not exists ai_comment text not null default '';
alter table public.archive_items add column if not exists analysis_status text not null default 'pending';
alter table public.archive_items add column if not exists analysis_json jsonb;
alter table public.archive_items add column if not exists updated_at timestamptz not null default now();

create table if not exists public.taste_tags (
  user_id uuid not null,
  work_id text not null,
  tag text not null,
  category text not null,
  score double precision not null,
  evidence text,
  engine text not null default 'metadata-lexicon-v1',
  created_at timestamptz not null default now(),
  primary key (user_id, work_id, tag),
  foreign key (user_id, work_id)
    references public.archive_items(user_id, work_id) on delete cascade
);

create index if not exists archive_items_user_created_idx
  on public.archive_items (user_id, created_at desc);

create index if not exists taste_tags_user_score_idx
  on public.taste_tags (user_id, score desc);

alter table public.profiles enable row level security;
alter table public.works enable row level security;
alter table public.archive_items enable row level security;
alter table public.taste_tags enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.works from anon, authenticated;
revoke all on public.archive_items from anon, authenticated;
revoke all on public.taste_tags from anon, authenticated;

grant all on public.profiles to service_role;
grant all on public.works to service_role;
grant all on public.archive_items to service_role;
grant all on public.taste_tags to service_role;
