# Taste Constellation release roadmap

> 출시 완성도 95점 목표의 최신 고정 실행 순서와 합격 기준은 [`quality/RELEASE_TO_95_PLAN.md`](quality/RELEASE_TO_95_PLAN.md)를 따른다. 아래 64~73 표는 이전 제품·운영 마일스톤의 추적 기록이다.

The numbered release roadmap below is canonical. Security hardening work that was
previously labelled as stages 67–72 is tracked separately as **S67–S72** so it
does not replace the product and operations milestones.

| Stage | Scope | Status | Remaining acceptance criteria |
| --- | --- | --- | --- |
| 64 | CI quality gate | Complete | Keep build, unit tests and recommendation evaluation required in CI. |
| 65 | Real-browser E2E | Complete | Maintain signed-in search → save → constellation → connection → restore journeys on desktop and mobile. |
| 66 | Accessibility and mobile QA | Partial | Automated Axe and performance budgets exist; finish manual screen-reader and physical-device checks. |
| 67 | Load and performance baseline | Not started | Measure search, recommendations, archive and pgvector latency; inspect slow queries with `EXPLAIN (ANALYZE, BUFFERS)`. |
| 68 | Distributed rate limiting | Not started | Replace the process-local `Map` limiter with shared durable state and test multiple workers. |
| 69 | Backup and disaster recovery | Partial | User archive export/import exists; run and document a database backup, migration replay and restore drill. |
| 70 | Privacy and retention | Partial | Privacy and account deletion flows exist; define and automate retention for feedback, reports, recommendation edges and operational logs. |
| 71 | Metadata expansion | In progress | Continue reducing missing poster, year and creator fields in the reviewed canonical catalogue. |
| 72 | Recommendation learning metrics | Partial | Feedback and personalization exist; add privacy-minimised aggregate save, like, hide and cross-media transition metrics. |
| 73 | Optional AI enhancement | Deferred | Connect only a stable free/local model as an assistive layer; keep deterministic editorial fallbacks. |

## Completed security track

| Security stage | Scope | Status |
| --- | --- | --- |
| S67 | Dependency supply-chain audit | Complete |
| S68 | Pin GitHub Actions by commit | Complete |
| S69 | CodeQL analysis | Complete |
| S70 | Git-history secret scan | Complete |
| S71 | CycloneDX SBOM | Complete |
| S72 | Build provenance attestation | Complete |
