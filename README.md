# Film Aggregator

Cinema listings aggregator for London indie cinemas, built with Next.js 14 + TypeScript. Scrapes multiple cinema sites, enriches with TMDb (and optionally OMDb + Letterboxd), serves a filterable table UI, and can read data from Postgres or local JSON.

## Quick Start
- Copy env and add your keys: `cp .env.example .env.local`
- Install deps: `npm install`
- Aggregate locally (JSON only): `npm run aggregate`
- Run the app: `npm run dev` → open http://localhost:3000

## Features
- Table: Film • Release • Cinema • Date • Time • Letterboxd
- Expand a film row → Director, Synopsis, Genres, Booking link
- Filters: search (film/cinema), time tabs (Today/This Week/This Month), sidebar (cinemas, decades, genres, min Letterboxd)
- API: `/api/listings` returns filtered JSON (from Postgres if configured, else `data/listings.json`)
- Scrapers for BFI, Prince Charles, ICA, Castle, Garden, Genesis, Close-Up, Barbican, Rio; metadata enrichment via TMDb; optional OMDb for Rotten Tomatoes; optional Letterboxd average rating

## How It Works
- Frontend (Next.js App Router)
  - `app/page.tsx`: server component loads all listings directly via a cached data helper (no self-HTTP); filters in-process based on `searchParams`, and derives a stable, alphabetical genre list from the full upcoming set. The underlying data load is cached (default `revalidate: 300s`, configurable via `LISTINGS_CACHE_SECONDS`) to avoid DB cold starts on Vercel.
  - UI components: `components/ListingsTable.tsx` (expandable rows, deterministic Europe/London formatting, cleaned titles with standardized 35mm/70mm/4K suffixes), `components/Filters.tsx` (debounced router updates; cinemas, decades, genre, min Letterboxd), `components/TimeTabs.tsx` (Today/Week/Month).
  - Styling: Tailwind + dark theme in `app/globals.css` with custom hover/selection.
- API (Next.js Route Handler)
  - `app/api/listings/route.ts` (runtime: Node.js so `pg` works). Uses the same shared data + filter helpers as the page; prefers Postgres when `DATABASE_URL` is set, else local JSON. Drops malformed entries and obvious non‑film events, applies time window + filters, sorts by start, returns `{ items }`.

### API Query Params
- `window=today|week|month|all` (default week): rolling horizon; “all” = all upcoming.
- `q=...`: substring match on `filmTitle`.
- `cinemas=bfi,princecharles,...`: filter by cinema keys.
- `genres=Genre`: intersects item genres.
- `decades=1970s,1980s`: prefers `websiteYear`, else TMDb `releaseDate` year.
- `minLb=0..5` (0.5 steps): minimum Letterboxd average; compared with 1dp half-up rounding to match UI (e.g., 3.44 → 3.4, 3.45 → 3.5).
- `debug=1`: include `{ source: 'db'|'json' }` in response.

Examples:
```bash
curl 'http://localhost:3000/api/listings?window=week&cinemas=barbican,castle&minLb=3.5'
curl 'http://localhost:3000/api/listings?decades=1970s,1980s&genres=Horror&debug=1'
```

## Data Pipeline
- Scrapers (Playwright): `scripts/cinemas/*.mjs`
  - Sites: BFI Southbank, Prince Charles, ICA, The Castle, The Garden, Genesis, Close‑Up, Barbican.
  - Parse titles/times in Europe/London, stabilize IDs, capture `bookingUrl`/`filmUrl`, and extract `websiteYear` and (for matching only) a candidate `director` from detail pages.
  - Detail pages: visit all unique film pages to read sidebar info (year + director).
- Enrichment: `scripts/enrich.mjs`
  - TMDb: normalized title + year/director matching; fills `releaseDate`, `genres`, `synopsis`, `director`, `imdbId`.
  - OMDb (optional): adds Rotten Tomatoes % (`rottenTomatoesPct`).
  - Letterboxd (optional): maps TMDb→Letterboxd URL, parses JSON‑LD `aggregateRating.ratingValue`; caches in `data/letterboxd-cache.json`.
- Orchestration
  - All‑in‑one JSON: `npm run aggregate` → writes `data/listings.json`.
  - Per‑cinema update: `scripts/aggregate-*-only.mjs` replaces that cinema’s slice in JSON.

## Database (Optional)
- If `DATABASE_URL` is set, the API reads from Postgres (table default `listings`, configurable via `LISTINGS_TABLE`).
- Seed and prune from JSON:
  - `npm run db:seed` (creates table/indexes if missing; upserts all fields)
  - `npm run db:prune` (deletes rows whose `id` is not in JSON)
- Full flow (recommended): `npm run aggregate:all:db` scrapes all (Letterboxd disabled during scraping for speed), seeds + prunes DB, then runs HTTP Letterboxd enrichment in chunks.

## Environment
Add to `.env.local` (see `.env.example` for the full list and defaults):
- `TMDB_API_KEY` (required)
- `OMDB_API_KEY` (optional)
- `DEFAULT_REGION=GB`
- `HIDE_BFI=true` and/or `NEXT_PUBLIC_HIDE_BFI=true` to hide BFI in API/UI
- `LETTERBOXD_ENABLE=false|true` (default off), `LETTERBOXD_USE_PLAYWRIGHT=false|true`, `LETTERBOXD_STEALTH=false|true`
- `DATABASE_URL=postgres://user:pass@host:5432/db` and optional `LISTINGS_TABLE`
- `LISTINGS_CACHE_SECONDS=300` to control in-app cache TTL for loading all listings


## Scripts
- App: `npm run dev`, `npm run build`, `npm run start`
- Aggregate JSON: `npm run aggregate`
- Aggregate + DB: `npm run aggregate:db` (JSON → seed → prune)
- All cinemas to DB (with Letterboxd HTTP enrichment): `npm run aggregate:all:db`
- Per‑cinema: `npm run aggregate:barbican|castle|garden|genesis|ica|pcc|closeup|rio|bfi`
- DB utilities: `npm run db:seed`, `npm run db:prune`, `npm run db:drop`
- Letterboxd: `npm run enrich:letterboxd` (JSON), `npm run enrich:letterboxd:db:http` (DB)
- OMDb (Rotten Tomatoes): `npm run enrich:omdb`
- Scraper previews: `node scripts/preview-*.mjs` (e.g. `preview:pcc`, `preview:garden`)

## Development Tips
- Timezone: scrapers and UI use Europe/London for deterministic display and matching.
- Non‑film filter: obvious non‑film events (panels/workshops/quiz/live events) are excluded in aggregation and API.
- Preview routes for local dev (use Playwright):
  - `GET /api/preview/pcc` → runs `scripts/cinemas/princecharles.mjs`
  - `GET /api/preview/castle` → runs `scripts/cinemas/castle.mjs`

## Cinema Keys
- `bfi` (BFI Southbank), `princecharles` (Prince Charles Cinema), `ica` (ICA), `castle` (The Castle Cinema), `garden` (The Garden Cinema), `genesis` (Genesis Cinema), `closeup` (Close‑Up), `barbican` (Barbican), `rio` (Rio Cinema), `cinelumiere` (Ciné Lumière), `nickel` (The Nickel)

## Requirements
- Node: 20+ (uses global `fetch`, Next 14, and modern Intl APIs)
- Playwright browsers: install once with `npx playwright install` (scrapers launch Chromium)
- Postgres: optional, required only if using the DB-backed API
- API keys: `TMDB_API_KEY` (required), `OMDB_API_KEY` (optional)

## Project Structure
- `app/`: App Router pages and API routes
  - `app/page.tsx`: loads all listings (cached) then filters in-process
  - `app/api/listings/route.ts`: Node runtime, returns filtered listings JSON
  - `app/api/preview/*/route.ts`: dev-only preview routes that run scrapers
- `components/`: UI components (table, filters, tabs, mobile variants)
- `lib/`: shared server utilities
  - `lib/listings.ts`: load/cache/filter helpers + genre derivation
  - `lib/db.ts`: Postgres pool + row→`Screening` mapping
  - `lib/filters.ts`: time-window and non‑film heuristics
- `scripts/`: scrapers, enrichment, DB utilities
  - `scripts/cinemas/*.mjs`: Playwright scrapers per cinema
  - `scripts/enrich*.mjs`: TMDb, OMDb, Letterboxd enrichment
  - `scripts/db-*.mjs`: seed/prune/drop DB; `scripts/smoke-db.ts` quick DB check
- `data/`: JSON outputs and caches (`listings.json`, `letterboxd-cache.json`)
- Config: `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`

## Data Model
- `types.ts` defines `Screening` and `CinemaKey` used across the app
- `Screening` fields:
  - `id`, `filmTitle`, `cinema`, `screeningStart`, optional `screeningEnd`
  - Optional enrichment: `bookingUrl`, `releaseDate` (ISO), `websiteYear`, `director`, `synopsis`, `genres[]`, `posterPath`, `tmdbId`, `imdbId`, `rottenTomatoesPct`, `letterboxdRating`
- Filtering behaviour (`lib/listings.ts`):
  - Time window excludes past; `week` is default; `month` = rolling 30 days
  - `q` matches title or director
  - `decades` prefers `websiteYear`, then `releaseDate` year
  - `minLb` compares 1dp half‑up rounded value; unrated counts as 0
  - Optional hide BFI via `HIDE_BFI`/`NEXT_PUBLIC_HIDE_BFI`

## Database Schema & Mapping
- Table name: `LISTINGS_TABLE` (default `listings`)
- Schema created by `scripts/db-seed.mjs`:
  - Columns (snake_case): `id text primary key`, `film_title text`, `cinema text`, `screening_start timestamptz`, `screening_end timestamptz`, `booking_url text`, `release_date date`, `website_year integer`, `director text`, `synopsis text`, `genres text[]`, `poster_path text`, `tmdb_id integer`, `imdb_id text`, `rotten_tomatoes_pct integer`, `letterboxd_rating double precision`
  - Indexes: `screening_start`, `cinema`
- Mapping to app types (`lib/db.ts`):
  - Converts snake_case keys to camelCase
  - Coerces dates to ISO strings; numbers to `number`; `genres` accepts `text[]` or delimited string
  - SSL: auto‑enables for Supabase/Neon/Vercel or when `ssl=true`; uses `rejectUnauthorized: false` in production (avoid self‑signed issues)

## Caching & Performance
- Listings cache: `loadAllListingsCached` uses `unstable_cache` keyed as `['all_listings']`
  - TTL via `LISTINGS_CACHE_SECONDS` (default 300s)
  - Applies when loading through the page as well as the API handler
- Deterministic formatting: UI formats dates/times in `Europe/London` to avoid SSR/CSR mismatches
- API runtime: `app/api/listings/route.ts` sets `runtime='nodejs'` so `pg` works on Vercel

## Preview & Scraper Debugging
- Dev‑only API routes:
  - `GET /api/preview/pcc` → `scripts/cinemas/princecharles.mjs`
  - `GET /api/preview/castle` → `scripts/cinemas/castle.mjs`
- Node previews: `npm run preview:pcc`, `npm run preview:rio`, etc.
- Playwright requirement: preview and scrapers launch Chromium — ensure `npx playwright install` has been run locally/CI

## CI/CD
- GitHub Actions: `.github/workflows/aggregate-all-db.yml` runs daily and on‑demand
  - Expects secrets: `DATABASE_URL`, `TMDB_API_KEY`, `OMDB_API_KEY`
  - Recommended: add a step before aggregation to install browsers
    - `- run: npx playwright install --with-deps`
- Deployment: set `NEXT_PUBLIC_BASE_URL` for correct OpenGraph URLs; set caching and feature flags via env

## Adding A New Cinema
- Create `scripts/cinemas/<key>.mjs` exporting `fetch<Key>()` that returns `Screening[]`
  - Use stable `id` construction (e.g., based on film page slug and start time)
  - Parse times in `Europe/London`; normalize URLs; capture `websiteYear` and `director` when available
- Wire it up:
  - Add to `scripts/aggregate.mjs` and/or create `scripts/aggregate-<key>-only.mjs`
  - Update `components/Filters.tsx` `CINEMAS` list and `types.ts` `CinemaKey`
  - Optionally add `app/api/preview/<key>/route.ts`

## Gotchas & Tips
- Playwright browsers: required for scrapers; without installing, scripts will fail to launch Chromium
- Timezone: always build dates in `Europe/London`; UI assumes that for rendering
- BFI feature flag: `aggregate-all-db.mjs` strips BFI items from JSON before DB sync; control visibility with `HIDE_BFI`/`NEXT_PUBLIC_HIDE_BFI`
- Letterboxd enrichment:
  - Two modes: HTTP (default, no Playwright) or Playwright (`LETTERBOXD_USE_PLAYWRIGHT=true`)
  - Results cached in `data/letterboxd-cache.json`; `--force` in DB HTTP mode refreshes all
  - Chunked DB updates via `--chunk`; be polite with rate limits
- DB smoke test: `npm run db:test` prints a small sample and ensures env/SSL mapping is correct
- Metadata base URL: set `NEXT_PUBLIC_BASE_URL` to avoid absolute URL issues in OG meta
