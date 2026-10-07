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

Do not edit generated `dist/client/app.js` or `dist/server/index.js` directly. Change the corresponding `src/` module, then rebuild.
