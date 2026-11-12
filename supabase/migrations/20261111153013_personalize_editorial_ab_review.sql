alter table public.ai_editorial_ab_runs
  alter column min_reviews_per_work set default 1;

alter table public.ai_editorial_ab_runs
  drop constraint if exists ai_editorial_ab_runs_min_reviews_per_work_check;

update public.ai_editorial_ab_runs
set min_reviews_per_work = 1,
    updated_at = now()
where min_reviews_per_work <> 1;

alter table public.ai_editorial_ab_runs
  add constraint ai_editorial_ab_runs_min_reviews_per_work_check
  check (min_reviews_per_work = 1);

alter table public.ai_editorial_ab_reviews
  drop constraint if exists ai_editorial_ab_reviews_control_score_check,
  drop constraint if exists ai_editorial_ab_reviews_candidate_score_check;

alter table public.ai_editorial_ab_reviews
  add constraint ai_editorial_ab_reviews_control_score_check
    check (control_score between 1 and 3),
  add constraint ai_editorial_ab_reviews_candidate_score_check
    check (candidate_score between 1 and 3);

comment on column public.ai_editorial_ab_runs.min_reviews_per_work is
  'Exactly one review by the run owner is used for personal editorial calibration.';
