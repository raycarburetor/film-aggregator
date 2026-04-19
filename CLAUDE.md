# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Next.js dev server on http://localhost:3000
- `npm run build` / `npm run start` — production build / serve
- `npm run lint` — ESLint via `next lint`
- `npm run db:test` — TS smoke test that queries the configured Postgres and prints a sample (validates env + SSL mapping)

### Data pipeline
- `npm run aggregate` — scrape all cinemas → `data/listings.json` (no DB writes)
- `npm run aggregate:db` — aggregate + `db-seed` + `db-prune` (JSON-driven full sync)
- `npm run aggregate:all:db` — full production flow used by CI: runs each per-cinema scraper as a child process (Letterboxd disabled during scraping for speed), seeds + prunes DB, then runs Letterboxd HTTP enrichment in chunks (`--chunk=100 --force`)
- `npm run aggregate:<key>` / `npm run aggregate:<key>:db` — per-cinema scrape; `:db` variants use `CINEMA_SCOPE=<key>` so `db-seed`/`db-prune` only touch that cinema's rows
- `npm run enrich:letterboxd:db:http` — Letterboxd rating backfill over DB (HTTP, no Playwright)
- `npm run enrich:omdb` — Rotten Tomatoes % via OMDb

Scraper previews: `node scripts/preview-*.mjs` or the dev-only HTTP routes `GET /api/preview/{pcc,castle}`. Scrapers use Playwright Chromium — run `npx playwright install` once locally.

## Architecture

**Two data sources, one loader.** The app prefers Postgres when `DATABASE_URL` is set, else falls back to `data/listings.json`. All reads go through `lib/listings.ts::loadAllListingsCached` (wrapped in `unstable_cache`, TTL `LISTINGS_CACHE_SECONDS`, default 300s). `app/page.tsx` and `app/api/listings/route.ts` both call this same helper and then apply filters in-process — the page does **not** self-HTTP its own API.

**Node runtime is mandatory for the API route.** `app/api/listings/route.ts` declares `runtime = 'nodejs'` because `pg` can't run on Edge. Keep it that way.

**Type flow.** `types.ts` defines `Screening` and `CinemaKey` used across scrapers, DB mapping (`lib/db.ts`), filters (`lib/filters.ts`), and UI. `lib/db.ts` converts snake_case columns (see `scripts/db-seed.mjs` for the schema) to camelCase and coerces `timestamptz` → ISO string, `text[]`/delimited-string → `string[]` for genres. SSL auto-enables for Supabase/Neon/Vercel hosts.

**Scraper conventions.** Each `scripts/cinemas/<key>.mjs` exports a `fetch<Key>()` returning `Screening[]`. All times are parsed in `Europe/London`; IDs must be stable (typically derived from film page slug + start time) so seeds upsert cleanly. Detail pages are visited to capture `websiteYear` and a candidate `director` used by TMDb matching.

**Orchestrator is fail-soft.** `scripts/aggregate-all-db.mjs` runs each cinema script in a subprocess and continues on failure:
- If **all** scrapers fail, DB seed/prune is skipped (preserves existing rows rather than wiping to empty).
- If **some** scrapers fail, seed runs but the unscoped prune is skipped — stale rows for failed cinemas persist rather than vanishing from the UI.
- `db-prune.mjs` has its own safety guards (mtime and max-delete-%) that can abort with non-zero exit; the orchestrator treats that as non-fatal.

**Per-cinema DB updates use `CINEMA_SCOPE`.** `db-seed.mjs` and `db-prune.mjs` read this env var to restrict upserts/deletes to one cinema — this is how `aggregate:<key>:db` scripts avoid touching other cinemas' rows.

**Enrichment is a separate stage.** Scrapers emit minimal `Screening` objects; `scripts/enrich.mjs` fills TMDb fields (matched by normalized title + year/director), optional OMDb (Rotten Tomatoes), and optional Letterboxd rating (cached in `data/letterboxd-cache.json`). During `aggregate:all:db`, Letterboxd is disabled per-scrape (`LETTERBOXD_ENABLE=false`) and then applied to the DB in bulk via the HTTP enricher.

**Filtering semantics** (see `lib/listings.ts`, `lib/filters.ts`):
- Time windows exclude past items; `week` is default, `month` = rolling 30 days
- `decades` prefers `websiteYear`, falls back to `releaseDate` year
- `minLb` compares 1dp half-up rounded value; unrated = 0
- Non-film events (panels/workshops/quiz/live) are filtered heuristically in both aggregation and API
- `q` matches film title **or** director

## CI/CD

`.github/workflows/aggregate-all-db.yml` runs daily at 10:00 UTC and on `workflow_dispatch`. It installs Playwright browsers, then runs `npm run aggregate:all:db`. Required secrets: `DATABASE_URL`, `TMDB_API_KEY`, `OMDB_API_KEY`. The manual dispatch has a `force_prune` input that sets `PRUNE_FORCE=1` to bypass `db-prune.mjs` safety guards for that run.

**BFI Southbank is live and part of the daily cron** — `aggregate-bfi-only.mjs` is the first step in `aggregate-all-db.mjs`'s orchestration list. The `HIDE_BFI` / `NEXT_PUBLIC_HIDE_BFI` env flags still exist as a UI/API kill switch but default to off; the old behaviour of stripping BFI items from JSON before DB sync has been removed.

## Adding a cinema

1. `scripts/cinemas/<key>.mjs` exporting `fetch<Key>(): Promise<Screening[]>` (stable IDs, Europe/London times)
2. `scripts/aggregate-<key>-only.mjs` following the pattern of existing per-cinema scripts
3. Add the key to `CinemaKey` in `types.ts` and the `CINEMAS` list in `components/Filters.tsx`
4. Add `aggregate:<key>` / `aggregate:<key>:db` entries to `package.json`
5. Append the new step to the `steps` array in `scripts/aggregate-all-db.mjs` so it joins the daily cron
