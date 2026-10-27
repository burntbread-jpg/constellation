# Stage 67 performance baseline

Deterministic Worker benchmark with mocked upstream I/O. All values are milliseconds. Production database plans are documented separately.

| Endpoint | Concurrency | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| health | 1 | 0.22 | 0.41 | 0.5 | 0.5 |
| health | 10 | 0.94 | 1.43 | 1.58 | 1.58 |
| health | 50 | 3.37 | 7.69 | 8.22 | 8.22 |
| search | 1 | 0.27 | 0.77 | 1.74 | 1.74 |
| search | 10 | 1.19 | 2 | 2.23 | 2.23 |
| search | 50 | 4.65 | 8.7 | 9.09 | 9.09 |
| archive | 1 | 0.15 | 0.29 | 0.42 | 0.42 |
| archive | 10 | 0.73 | 1.21 | 1.41 | 1.41 |
| archive | 50 | 3.27 | 6.09 | 6.28 | 6.28 |
| recommendations | 1 | 3.07 | 4.07 | 4.9 | 4.9 |
| recommendations | 10 | 16.02 | 29.12 | 32.25 | 32.25 |
| recommendations | 50 | 59.32 | 135.39 | 143.54 | 143.54 |

Result: **PASS**
