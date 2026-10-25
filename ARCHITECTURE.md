# Taste Constellation architecture

`src/` is the canonical JavaScript source. `npm run build` composes its ordered modules into the two files consumed by Sites:

- `dist/client/app.js`: browser application
- `dist/server/index.js`: Sites server worker

The client is separated into core/detail rendering, recommendations, archive management, and event wiring. The server is separated into external providers, persistence and normalization, the Taste DNA engine, archive APIs, recommendations, and the router.

The source modules are concatenated deliberately. This preserves the existing browser and worker runtime without introducing a bundler or changing shared lexical state. `tests/build.test.mjs` prevents generated artifacts from drifting away from their source modules.

## Commands

- `npm run build` — generate deployable JavaScript and synchronize the root/client static files.
- `npm test` — run API, recommendation, data-integrity, and build-drift tests.
- `npm run check` — rebuild and run the complete suite before deployment.

## Continuous integration

- `.github/workflows/quality.yml` runs on every pull request and every push to `master`, with a manual dispatch option for release checks.
- The quality gate rebuilds the deployable artifacts, runs the complete Node test suite, evaluates the deterministic 30-work recommendation benchmark, and fails if generated deployment or quality-report files differ from the committed source state.
- The workflow has read-only repository permissions, cancels superseded runs on the same ref, and is capped at ten minutes.

## Operational health

- `GET /api/health` reports public configuration availability without making external calls.
- `GET /api/health/deep` is restricted to configured metadata reviewers and performs live Supabase table and pgvector RPC checks. It returns only readiness flags and latency, never credentials, row data, or database error details.
- The metadata review dialog renders those deep-check readiness flags as an operator dashboard and supports an explicit no-cache refresh. Authorization remains enforced by the server endpoint.
- Deep health also probes configured/free metadata providers and reports a rolling five-minute API 5xx/slow-request snapshot. Provider outages are warnings while database or pgvector failures are service degradation; the reviewer dashboard refreshes automatically every 60 seconds while open.
- Successful core health probes are retained for 30 days in a service-role-only table. The dashboard summarizes the latest 24 hours and highlights three or more consecutive warning/degraded checks without storing visitor identity or request payloads.
- Supabase Cron calls `POST /api/health/scheduled` every five minutes with Vault-backed monitor and Sites service-access tokens, so checks continue while the dashboard is closed. The endpoint is not authorized by visitor identity.
- Alert events are durable and service-role-only. A configured Slack/Discord-compatible webhook is notified only when the service first degrades, a warning persists for three checks, or a non-ready state recovers; failed deliveries remain queued for the next scheduled run.
- The reviewer operations panel shows the latest sanitized alert history, including pending or failed delivery state, without exposing webhook URLs, provider payloads, or raw delivery errors.
- Reviewers can acknowledge, resolve, and reopen operational incidents with required notes. A PostgreSQL function locks each alert and atomically updates its lifecycle snapshot plus an append-only action history; the dashboard exposes notes and timestamps but never reviewer identifiers.

Do not edit generated `dist/client/app.js` or `dist/server/index.js` directly. Change the corresponding `src/` module, then rebuild.

## Shared Supabase security

- The public game leaderboard remains a stable read-only API, but no longer relies on a view owner's privileges to bypass RLS. A trigger-maintained projection stores only leaderboard-safe fields in the unexposed `private` schema, and `public.leaderboard` reads it with `security_invoker`.
- Anonymous and authenticated roles receive only `SELECT` on the sanitized view and its private backing projection. They do not receive public access to `game_scores`, user IDs are omitted from the view, and the private trigger functions have no client execution grants.
