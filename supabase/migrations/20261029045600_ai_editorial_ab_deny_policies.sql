drop policy if exists ai_editorial_ab_runs_deny_client on public.ai_editorial_ab_runs;
create policy ai_editorial_ab_runs_deny_client on public.ai_editorial_ab_runs for all to anon, authenticated using (false) with check (false);

drop policy if exists ai_editorial_ab_items_deny_client on public.ai_editorial_ab_items;
create policy ai_editorial_ab_items_deny_client on public.ai_editorial_ab_items for all to anon, authenticated using (false) with check (false);

drop policy if exists ai_editorial_ab_reviews_deny_client on public.ai_editorial_ab_reviews;
create policy ai_editorial_ab_reviews_deny_client on public.ai_editorial_ab_reviews for all to anon, authenticated using (false) with check (false);
