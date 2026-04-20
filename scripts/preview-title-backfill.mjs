// Dry-run preview: shows which film_title values would change if we replaced
// them with TMDb's canonical title. Read-only — does NOT touch the database.
//
// Usage:
//   node scripts/preview-title-backfill.mjs [--limit=N] [--cinema=key] [--all]
//   --all     also list rows where the title already matches TMDb (default: only show diffs)
//   --limit=N cap the number of unique tmdb_ids to inspect
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
  const limit = argNum('--limit', 50)
  const cinema = argVal('--cinema')
  const showAll = argHas('--all')

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
      select tmdb_id,
             array_agg(distinct film_title order by film_title) as titles,
             array_agg(distinct cinema order by cinema) as cinemas,
             count(*)::int as rows
      from ${table}
      where tmdb_id is not null
    `
    const params = []
    if (cinema) { sql += ` and cinema = $1`; params.push(cinema) }
    sql += ` group by tmdb_id order by rows desc`
    const { rows } = await client.query(sql, params)
    const sampled = rows.slice(0, limit)
    if (!sampled.length) { console.log('Nothing to inspect.'); return }

    console.log(`Inspecting ${sampled.length} unique tmdb_id(s) (of ${rows.length} total). Fetching TMDb titles…\n`)

    let changed = 0
    let same = 0
    let failed = 0
    const diffs = []

    for (const r of sampled) {
      const id = Number(r.tmdb_id)
      try {
        const url = `https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}&language=en-GB`
        const res = await fetch(url)
        if (!res.ok) { failed++; continue }
        const det = await res.json()
        const tmdbTitle = (det?.title || det?.original_title || '').trim()
        if (!tmdbTitle) { failed++; continue }
        const dbTitles = r.titles || []
        const allMatch = dbTitles.every(t => t === tmdbTitle)
        if (allMatch) {
          same++
          if (showAll) diffs.push({ id, kind: 'same', tmdbTitle, dbTitles, cinemas: r.cinemas, rows: r.rows })
        } else {
          changed++
          diffs.push({ id, kind: 'diff', tmdbTitle, dbTitles, cinemas: r.cinemas, rows: r.rows })
        }
      } catch {
        failed++
      }
      await sleep(120)
    }

    console.log(`\n=== Summary ===`)
    console.log(`would change : ${changed}`)
    console.log(`already match: ${same}`)
    console.log(`fetch failed : ${failed}`)
    console.log(`(of ${sampled.length} sampled; ${rows.length} total in DB)\n`)

    const display = showAll ? diffs : diffs.filter(d => d.kind === 'diff')
    for (const d of display) {
      console.log(`tmdb_id=${d.id}  rows=${d.rows}  cinemas=${(d.cinemas || []).join(',')}`)
      console.log(`  TMDb : ${d.tmdbTitle}`)
      for (const t of d.dbTitles) {
        const marker = t === d.tmdbTitle ? '   ' : '!=='
        console.log(`  DB  ${marker} ${t}`)
      }
      console.log('')
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
