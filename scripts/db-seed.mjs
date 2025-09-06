// Seed Postgres from data/listings.json with upserts
// Usage: node scripts/db-seed.mjs
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import pg from 'pg'
import './load-env.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function sanitizeTableName(name) {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL is not set in environment')
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)

  const pool = new pg.Pool({
    connectionString: cs,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })

  const client = await pool.connect()
  try {
    // Ensure table exists (best-effort schema)
    const createSql = `
      create table if not exists ${table} (
        id text primary key,
        film_title text not null,
        cinema text not null,
        screening_start timestamptz not null,
        screening_end timestamptz null,
        booking_url text null,
        release_date date null,
        website_year integer null,
        director text null,
        synopsis text null,
        genres text[] null,
        poster_path text null,
        tmdb_id integer null,
        imdb_id text null,
        rotten_tomatoes_pct integer null,
        letterboxd_rating double precision null
      );
      create index if not exists ${table}_screening_start_idx on ${table}(screening_start);
      create index if not exists ${table}_cinema_idx on ${table}(cinema);
    `
    await client.query(createSql)

    const file = path.join(root, 'data', 'listings.json')
    const txt = await fs.readFile(file, 'utf8')
    const json = JSON.parse(txt)
    if (!Array.isArray(json)) throw new Error('data/listings.json is not an array')

    const insertSql = `
      insert into ${table} (
        id, film_title, cinema, screening_start, screening_end, booking_url, release_date, website_year, director, synopsis, genres, poster_path, tmdb_id, imdb_id, rotten_tomatoes_pct, letterboxd_rating
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      on conflict (id) do update set
        film_title = excluded.film_title,
        cinema = excluded.cinema,
        screening_start = excluded.screening_start,
        screening_end = excluded.screening_end,
        booking_url = excluded.booking_url,
        release_date = excluded.release_date,
        website_year = excluded.website_year,
        director = excluded.director,
        synopsis = excluded.synopsis,
        genres = excluded.genres,
        poster_path = excluded.poster_path,
        tmdb_id = excluded.tmdb_id,
        imdb_id = excluded.imdb_id,
        rotten_tomatoes_pct = excluded.rotten_tomatoes_pct,
        letterboxd_rating = excluded.letterboxd_rating
    `

    // Batch in chunks to avoid huge single transaction
    const chunkSize = 500
    let total = 0
    for (let i = 0; i < json.length; i += chunkSize) {
      const chunk = json.slice(i, i + chunkSize)
      const tx = await client.query('begin')
      try {
        for (const it of chunk) {
          // Normalize
          const genres = Array.isArray(it.genres) ? it.genres.map(String) : null
          const releaseDate = it.releaseDate ? it.releaseDate : null
          const screeningStart = it.screeningStart ? new Date(it.screeningStart) : null
          const screeningEnd = it.screeningEnd ? new Date(it.screeningEnd) : null
          await client.query(insertSql, [
            String(it.id),
            String(it.filmTitle ?? ''),
            String(it.cinema ?? ''),
            screeningStart,
            screeningEnd,
            it.bookingUrl ?? null,
            releaseDate,
            it.websiteYear ?? null,
            it.director ?? null,
            it.synopsis ?? null,
            genres,
            it.posterPath ?? null,
            it.tmdbId ?? null,
            it.imdbId ?? null,
            it.rottenTomatoesPct ?? null,
            it.letterboxdRating ?? null,
          ])
        }
        await client.query('commit')
        total += chunk.length
        console.log(`Upserted ${total}/${json.length} rows...`)
      } catch (e) {
        await client.query('rollback')
        throw e
      }
    }
    console.log('Done. Upserted', total, 'rows into', table)
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[db-seed] failed:', e)
  process.exitCode = 1
})

