alter table public.ai_editorial_ab_runs
  add column if not exists min_reviews_per_work smallint not null default 2
    check (min_reviews_per_work between 2 and 10),
  add column if not exists min_agreement_rate numeric(5,4) not null default 0.70
    check (min_agreement_rate between 0 and 1);

comment on column public.ai_editorial_ab_runs.min_reviews_per_work is
  'Minimum number of distinct independent reviewers required for each work.';
comment on column public.ai_editorial_ab_runs.min_agreement_rate is
  'Minimum pairwise agreement across preference, quality and spoiler decisions.';
