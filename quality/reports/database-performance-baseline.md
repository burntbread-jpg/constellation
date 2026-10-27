# Stage 67 production database baseline

Measured on Supabase project `idjusulvcxrrlqqhzopp` on 2026-10-27 with `EXPLAIN (ANALYZE, BUFFERS)`. The catalog contained 131 works; the sampled account contained one archive item and 39 saved connections.

| Read path | Execution | Plan evidence | Buffers / sort |
| --- | ---: | --- | --- |
| pgvector catalog top 48 | 0.829 ms | `works_taste_vector_idx` HNSW index scan | 224 shared hits, 0 reads |
| archive latest 200 | 0.802 ms | single-user scan at current cardinality | 5 shared hits, 27 kB in-memory sort |
| constellation connections top 300 | 4.510 ms | `connections_user_source_idx` bitmap scan | 12 shared hits, 84 kB in-memory sort |

No disk reads or temporary-file spills occurred. The pgvector query already uses the cosine HNSW index. Stage 67 adds indexes matching the production ordering predicates:

- `archive_items_user_updated_idx (user_id, updated_at desc)`
- `connections_user_score_idx (user_id, score desc)`

The tables are currently too small for PostgreSQL to always prefer these indexes; that is expected. Re-run this baseline after either the catalog exceeds 10,000 works, an account exceeds 1,000 archive items, or p95 API latency breaches the committed budget.

The Stage 68 atomic limiter was also exercised three times against a limit of two. The third call returned `allowed=false`, `request_count=3`, `remaining=0`, and a positive `retry_after`, confirming durable fixed-window enforcement.
