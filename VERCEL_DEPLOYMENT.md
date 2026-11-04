# Vercel deployment

The repository is deployed as an **Other** framework project:

- build command: `pnpm run build`
- static output: `dist/client`
- API entrypoint: `api/[...path].js`

`vercel.json` is the source of truth, so the dashboard does not need a manual output-directory override.

## Required production environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TMDB_READ_TOKEN`
- `GOOGLE_BOOKS_API_KEY`
- `HEALTH_MONITOR_TOKEN`

The metadata-review dashboard additionally uses `METADATA_REVIEWER_IDS` or `METADATA_REVIEWER_EMAILS`. The optional zero-cost editorial assistant uses the `LOCAL_AI_*` variables documented in `.env.example`.

## Authentication migration note

The former Sites deployment supplied `oai-authenticated-user-*` identity headers. Vercel does not supply those application-user headers. Public discovery, search, artwork, metadata, recommendations, and health endpoints work through the Vercel adapter, but personal archive and reviewer operations must not be treated as authenticated until a Vercel-compatible application sign-in flow is connected. Do not replace this with IP-based identity or a shared public user ID.

## Verification

After a production deployment:

1. Open `/api/health` and confirm HTTP 200.
2. Search for at least one film, book, and anime.
3. Confirm the browser shell and service worker load from the same bundle version.
4. Check Vercel Function logs for `/api/search` and `/api/artwork` failures.
5. Point the Supabase scheduled-health URL to the final Vercel production domain before retiring the prior host.
