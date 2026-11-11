alter table public.ai_editorial_ab_reviews
  add column if not exists control_quality_pass boolean,
  add column if not exists candidate_quality_pass boolean,
  add column if not exists control_spoiler boolean,
  add column if not exists candidate_spoiler boolean;

-- Preserve the candidate-side verdict recorded by the original form. The
-- control-side verdict cannot be reconstructed, so it deliberately remains
-- null for historical reviews. New reviews always write all four fields.
update public.ai_editorial_ab_reviews
set candidate_quality_pass = quality_pass,
    candidate_spoiler = spoiler
where candidate_quality_pass is null
   or candidate_spoiler is null;

comment on column public.ai_editorial_ab_reviews.control_quality_pass is
  'Blind reviewer quality verdict for the deterministic control copy.';
comment on column public.ai_editorial_ab_reviews.candidate_quality_pass is
  'Blind reviewer quality verdict for the AI candidate copy.';
comment on column public.ai_editorial_ab_reviews.control_spoiler is
  'Blind reviewer spoiler verdict for the deterministic control copy.';
comment on column public.ai_editorial_ab_reviews.candidate_spoiler is
  'Blind reviewer spoiler verdict for the AI candidate copy.';
