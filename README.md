# Film Aggregator (Spec Build)

Cinema listings aggregator for London (BFI Southbank, Prince Charles, ICA, The Castle).

## Run
```bash
cp .env.example .env.local  # add your keys
npm install
npm run dev
```

## Features
- Table: Film • Release • Cinema • Date • Time • Rotten Tomatoes
- Expand a film row → Director, Synopsis, Genres, Booking link
- Filters: search (film/cinema), tabs (Today/This Week/This Month/All), sidebar (cinema, genres, release year, min RT %)
- `/api/listings` returns filtered JSON from `data/listings.json`
- `scripts/` stubs for scraping and enrichment (TMDb + optional OMDb for RT)

## Aggregation
```
export TMDB_API_KEY=...
export OMDB_API_KEY=... # optional
node scripts/aggregate.mjs
```
