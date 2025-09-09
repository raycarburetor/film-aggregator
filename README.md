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
  - `app/page.tsx`: server component builds an absolute URL to `/api/listings` using request headers; fetches filtered items (no cache) and a separate “all upcoming” set for a stable genre list.
  - UI components: `components/ListingsTable.tsx` (expandable rows, deterministic Europe/London formatting, cleaned titles with standardized 35mm/70mm/4K suffixes), `components/Filters.tsx` (debounced router updates; cinemas, decades, genre, min Letterboxd), `components/TimeTabs.tsx` (Today/Week/Month).
  - Styling: Tailwind + dark theme in `app/globals.css` with custom hover/selection.
- API (Next.js Route Handler)
  - `app/api/listings/route.ts` (runtime: Node.js so `pg` works). Prefers Postgres when `DATABASE_URL` is set; falls back to local JSON. Drops malformed entries and obvious non‑film events, applies time window + filters, sorts by start, returns `{ items }`.

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
- `bfi` (BFI Southbank), `princecharles` (Prince Charles Cinema), `ica` (ICA), `castle` (The Castle Cinema), `garden` (The Garden Cinema), `genesis` (Genesis Cinema), `closeup` (Close‑Up), `barbican` (Barbican), `rio` (Rio Cinema)
