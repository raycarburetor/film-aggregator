// One-shot backfill: fill poster_path for rows that have a tmdb_id but no poster.
// Fetches /3/movie/{tmdb_id} once per unique id and writes the same poster_path
// to every row sharing that id.
//
// Usage:
//   node scripts/backfill-posters.mjs [--force] [--limit=N] [--cinema=key]
//   Env: DATABASE_URL (required), TMDB_API_KEY (required), LISTINGS_TABLE (optional)
//
// --force re-fetches even rows that already have a poster_path.
import './load-env.mjs'
import pg from 'pg'

function sanitizeTableName(name) {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}
function argHas(flag) { return process.argv.slice(2).some(a => a === flag) }
function argNum(name, def) {
  const m = process.argv.slice(2).find(a => a.startsWith(`${name}=`))
  if (!m) return def
  const v = Number(m.split('=')[1])
  return Number.isFinite(v) ? v : def
}
function argVal(name) {
  const m = process.argv.slice(2).find(a => a.startsWith(`${name}=`))
  return m ? m.slice(name.length + 1) || undefined : undefined
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL is not set in environment')
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) throw new Error('TMDB_API_KEY is not set in environment')
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)
  const force = argHas('--force')
  const limit = argNum('--limit', undefined)
  const cinema = argVal('--cinema')

  const needsSsl = /sslmode=require/i.test(cs) || /[?&]ssl=true/i.test(cs) || /(supabase|neon|vercel)/i.test(cs)
  let connectionString = cs
  try {
    const u = new URL(cs)
    if (u.searchParams.get('ssl') === 'true') { u.searchParams.delete('ssl'); connectionString = u.toString() }
  } catch {}
  const pool = new pg.Pool({
    connectionString,
    ssl: needsSsl || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
  const client = await pool.connect()
  try {
    let sql = `
      select distinct tmdb_id
      from ${table}
      where tmdb_id is not null
      ${force ? '' : 'and (poster_path is null or poster_path = \'\')'}
    `
    const params = []
    if (cinema) { sql += ` and cinema = $1`; params.push(cinema) }
    const { rows } = await client.query(sql, params)
    let ids = rows.map(r => Number(r.tmdb_id)).filter(n => Number.isFinite(n))
    if (typeof limit === 'number' && limit > 0) ids = ids.slice(0, limit)
    if (!ids.length) { console.log(`[POSTERS] Nothing to backfill (force=${force}).`); return }

    console.log(`[POSTERS] ${ids.length} unique tmdb_id(s) to process`)
    let updatedRows = 0
    let fetched = 0
    let missingPoster = 0
    let failed = 0

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      try {
        const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}&language=en-GB`
        const res = await fetch(url)
        if (!res.ok) { failed++; console.warn(`[POSTERS] HTTP ${res.status} for tmdb_id=${id}`); await sleep(250); continue }
        const det = await res.json()
        fetched++
        const poster = det?.poster_path
        if (!poster) { missingPoster++; await sleep(150); continue }
        const upd = await client.query(
          `update ${table} set poster_path = $1 where tmdb_id = $2 ${force ? '' : 'and (poster_path is null or poster_path = \'\')'}`,
          [poster, id]
        )
        updatedRows += upd.rowCount || 0
        if ((i + 1) % 25 === 0) console.log(`[POSTERS] ${i + 1}/${ids.length} processed (rows updated so far: ${updatedRows})`)
      } catch (e) {
        failed++
        console.warn(`[POSTERS] error for tmdb_id=${id}: ${e?.message || e}`)
      }
      // gentle pacing — TMDb allows ~50 req/sec, this is well under
      await sleep(150)
    }

    console.log(`[POSTERS] done. fetched=${fetched} updatedRows=${updatedRows} missingPoster=${missingPoster} failed=${failed}`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
