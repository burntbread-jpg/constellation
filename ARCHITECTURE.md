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

## Operational health

- `GET /api/health` reports public configuration availability without making external calls.
- `GET /api/health/deep` is restricted to configured metadata reviewers and performs live Supabase table and pgvector RPC checks. It returns only readiness flags and latency, never credentials, row data, or database error details.
- The metadata review dialog renders those deep-check readiness flags as an operator dashboard and supports an explicit no-cache refresh. Authorization remains enforced by the server endpoint.

Do not edit generated `dist/client/app.js` or `dist/server/index.js` directly. Change the corresponding `src/` module, then rebuild.
