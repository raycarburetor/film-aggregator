// Enrich Postgres listings with Letterboxd average ratings
// Usage:
//   LETTERBOXD_ENABLE=true node scripts/enrich-letterboxd-db.mjs [--force]
// Notes:
// - By default, only rows with NULL letterboxd_rating are updated.
// - Use --force to refresh all rows with a tmdb_id.
// - Respects LISTINGS_TABLE (defaults to 'listings').
import './load-env.mjs'
import pg from 'pg'
import { enrichWithLetterboxd } from './enrich.mjs'

function sanitizeTableName(name) {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}

function argHas(flag) {
  return process.argv.slice(2).some(a => a === flag)
}

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL is not set in environment')
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)
  const force = argHas('--force')

  const pool = new pg.Pool({
    connectionString: cs,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
  const client = await pool.connect()
  try {
    // Fetch required fields. If not forced, only include rows with NULL letterboxd_rating.
    const baseSql = `
      select id, film_title, tmdb_id, release_date, website_year, letterboxd_rating
      from ${table}
      where tmdb_id is not null
      ${force ? '' : 'and letterboxd_rating is null'}
    `
    const { rows } = await client.query(baseSql)
    if (!rows.length) {
      console.log(`[LB][DB] Nothing to enrich (force=${force}).`)
      return
    }

    // Build items array in the shape enrichWithLetterboxd expects
    const items = rows.map(r => ({
      id: String(r.id),
      filmTitle: String(r.film_title || ''),
      tmdbId: r.tmdb_id == null ? null : Number(r.tmdb_id),
      releaseDate: r.release_date ? new Date(r.release_date).toISOString() : undefined,
      websiteYear: (typeof r.website_year === 'number' ? r.website_year : undefined),
      letterboxdRating: r.letterboxd_rating == null ? null : Number(r.letterboxd_rating),
    }))

    // Enrich to populate letterboxdRating on items
    await enrichWithLetterboxd(items)

    // Consolidate updates by tmdbId to avoid duplicate updates per screening
    const updates = new Map()
    for (const it of items) {
      if (!it || !it.tmdbId) continue
      if (typeof it.letterboxdRating === 'number' && Number.isFinite(it.letterboxdRating)) {
        updates.set(it.tmdbId, it.letterboxdRating)
      }
    }

    if (!updates.size) {
      console.log('[LB][DB] No ratings extracted; nothing to update.')
      return
    }

    // Apply updates in a transaction
    await client.query('begin')
    try {
      let changed = 0
      for (const [tmdbId, rating] of updates) {
        const res = await client.query(
          `update ${table} set letterboxd_rating = $1 where tmdb_id = $2`,
          [rating, tmdbId]
        )
        changed += res.rowCount || 0
      }
      await client.query('commit')
      console.log(`[LB][DB] Updated letterboxd_rating on ${changed} rows across ${updates.size} tmdb_id(s).`)
    } catch (e) {
      await client.query('rollback')
      throw e
    }
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[LB][DB] failed:', e)
  process.exitCode = 1
})

