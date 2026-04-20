// One-shot backfill: replace film_title with TMDb's canonical title for every
// row that has a tmdb_id. Mirrors backfill-posters.mjs.
//
// Usage:
//   node scripts/backfill-titles.mjs [--limit=N] [--cinema=key]
//   Env: DATABASE_URL (required), TMDB_API_KEY (required), LISTINGS_TABLE (optional)
import './load-env.mjs'
import pg from 'pg'

function sanitizeTableName(name) {
  if (!name) return 'listings'
  return /^[A-Za-z0-9_]+$/.test(name) ? name : 'listings'
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
  if (!cs) throw new Error('DATABASE_URL is not set')
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) throw new Error('TMDB_API_KEY is not set')
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)
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
    let sql = `select distinct tmdb_id from ${table} where tmdb_id is not null`
    const params = []
    if (cinema) { sql += ` and cinema = $1`; params.push(cinema) }
    const { rows } = await client.query(sql, params)
    let ids = rows.map(r => Number(r.tmdb_id)).filter(n => Number.isFinite(n))
    if (typeof limit === 'number' && limit > 0) ids = ids.slice(0, limit)
    if (!ids.length) { console.log('[TITLES] Nothing to backfill.'); return }

    console.log(`[TITLES] ${ids.length} unique tmdb_id(s) to process`)
    let fetched = 0
    let updatedRows = 0
    let unchanged = 0
    let missingTitle = 0
    let failed = 0

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      try {
        const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}&language=en-GB`
        const res = await fetch(url)
        if (!res.ok) { failed++; console.warn(`[TITLES] HTTP ${res.status} for tmdb_id=${id}`); await sleep(250); continue }
        const det = await res.json()
        fetched++
        const tmdbTitle = (det?.title || det?.original_title || '').trim()
        if (!tmdbTitle) { missingTitle++; await sleep(150); continue }
        const upd = await client.query(
          `update ${table} set film_title = $1 where tmdb_id = $2 and film_title is distinct from $1`,
          [tmdbTitle, id]
        )
        if (upd.rowCount && upd.rowCount > 0) updatedRows += upd.rowCount
        else unchanged++
        if ((i + 1) % 25 === 0) console.log(`[TITLES] ${i + 1}/${ids.length} processed (rows updated so far: ${updatedRows})`)
      } catch (e) {
        failed++
        console.warn(`[TITLES] error for tmdb_id=${id}: ${e?.message || e}`)
      }
      await sleep(150)
    }

    console.log(`[TITLES] done. fetched=${fetched} updatedRows=${updatedRows} unchangedTmdb=${unchanged} missingTitle=${missingTitle} failed=${failed}`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
