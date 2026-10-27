# Performance budgets

Stage 67 fixes a reproducible server baseline before production traffic grows.

| Path | p95 budget | p99 budget | Reason |
| --- | ---: | ---: | --- |
| `/api/health` | 25 ms | 50 ms | in-process readiness response |
| `/api/search` | 75 ms | 150 ms | provider fan-out with deterministic mocked I/O |
| `/api/archive` | 60 ms | 120 ms | authenticated persistence path |
| `/api/recommendations` | 150 ms | 300 ms | ranking, pgvector candidate path, and diversification |

The CI benchmark measures application overhead at concurrency 1, 10, and 50. External network latency is intentionally excluded so regressions remain attributable and repeatable. Production Supabase queries are separately captured with `EXPLAIN (ANALYZE, BUFFERS)` in `quality/reports/database-performance-baseline.md`.

Any p95 or p99 breach fails CI. Budgets may only be raised with a written reason and a fresh production query plan.
