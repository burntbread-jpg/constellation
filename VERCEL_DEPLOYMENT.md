# Vercel deployment

The repository is deployed as an **Other** framework project:

- build command: `pnpm run build`
- static output: `dist/client`
- API entrypoint: `api/[...path].js`

`vercel.json` is the source of truth, so the dashboard does not need a manual output-directory override.

## Required production environment variables

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (public `sb_publishable_...` key)
- `SUPABASE_SERVICE_ROLE_KEY`
- `TMDB_READ_TOKEN`
- `GOOGLE_BOOKS_API_KEY`
- `HEALTH_MONITOR_TOKEN`

The metadata-review dashboard additionally uses `METADATA_REVIEWER_IDS` or `METADATA_REVIEWER_EMAILS`. The optional zero-cost editorial assistant uses the `LOCAL_AI_*` variables documented in `.env.example`.

## Supabase Auth on Vercel

The browser uses Supabase email Magic Links and stores only the user's short-lived session. API requests send the access token as a Bearer token. The server verifies that token with Supabase Auth before mapping the verified user ID to archive or reviewer operations.

The former Sites `oai-authenticated-user-*` headers are stripped by default because callers can forge them on Vercel. They are accepted only when the explicit server-only compatibility flag `TRUST_SITES_IDENTITY_HEADERS=true` is set; do not set that flag in Vercel production.

Supabase Auth URL Configuration must contain:

- Site URL: `https://constellation-swart.vercel.app`
- Redirect URL: `https://constellation-swart.vercel.app/**`

Never expose `SUPABASE_SERVICE_ROLE_KEY` in HTML, browser JavaScript, or `/api/auth-config`.

## Verification

After a production deployment:

1. Open `/api/health` and confirm HTTP 200.
2. Search for at least one film, book, and anime.
3. Confirm the browser shell and service worker load from the same bundle version.
4. Request a Magic Link, return to the production domain, confirm `/api/auth-session` returns the signed-in user, then sign out.
5. Confirm a forged `oai-authenticated-user-id` header cannot access `/api/archive`.
6. Check Vercel Function logs for `/api/search` and `/api/artwork` failures.
7. Point the Supabase scheduled-health URL to the final Vercel production domain before retiring the prior host.
