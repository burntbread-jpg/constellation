# Performance budgets

Stage 67 fixes a reproducible server baseline before production traffic grows.

| Path | c1 p95/p99 | c10 p95/p99 | c50 p95/p99 | Reason |
| --- | ---: | ---: | ---: | --- |
| `/api/health` | 25/50 ms | 40/75 ms | 75/150 ms | in-process readiness response |
| `/api/search` | 100/175 ms | 150/225 ms | 225/300 ms | provider fan-out with deterministic mocked I/O |
| `/api/archive` | 60/120 ms | 90/180 ms | 180/360 ms | authenticated persistence path |
| `/api/recommendations` | 150/300 ms | 250/450 ms | 450/700 ms | ranking, pgvector candidate path, and diversification |

The CI benchmark measures application overhead at concurrency 1, 10, and 50. Each level has its own ceiling because a request in a concurrent batch includes CPU queueing time on the shared two-core GitHub runner. The earlier single ceiling caused healthy c50 fan-out work to fail nondeterministically; these ceilings are based on the observed Linux runner baseline while remaining stricter than user-visible network budgets. External network latency is intentionally excluded so regressions remain attributable and repeatable. Production Supabase queries are separately captured with `EXPLAIN (ANALYZE, BUFFERS)` in `quality/reports/database-performance-baseline.md`.

Any p95 or p99 breach fails CI. Budgets may only be raised with a written reason and a fresh production query plan.
