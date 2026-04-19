// Delete listings whose screening_start is before "today" in Europe/London.
// Usage:
//   node scripts/db-purge-past.mjs              # dry-run, prints counts only
//   node scripts/db-purge-past.mjs --apply      # actually delete
//   DAY=2026-04-19 node scripts/db-purge-past.mjs --apply   # override cutoff
import './load-env.mjs'
import pg from 'pg'

function sanitizeTableName(name) {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}

function londonToday() {
  // YYYY-MM-DD in Europe/London
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(new Date())
}

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL is not set in environment')
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)
  const day = (process.env.DAY || '').trim() || londonToday()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid DAY=${day}; expected YYYY-MM-DD`)
  const apply = process.argv.includes('--apply')

  const needsSsl = /sslmode=require/i.test(cs) || /[?&]ssl=true/i.test(cs) || /(supabase|neon|vercel)/i.test(cs)
  let connectionString = cs
  try {
    const u = new URL(cs)
    if (u.searchParams.get('ssl') === 'true') {
      u.searchParams.delete('ssl')
      connectionString = u.toString()
    }
  } catch {}
  const pool = new pg.Pool({
    connectionString,
    ssl: needsSsl || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })

  // Compare as timestamptz against the start of `day` in Europe/London.
  const cutoffSql = `(($1::date) AT TIME ZONE 'Europe/London')`

  const client = await pool.connect()
  try {
    const total = await client.query(`select count(*)::int as n from ${table}`)
    const nTotal = total.rows[0]?.n ?? 0
    const past = await client.query(
      `select count(*)::int as n from ${table} where screening_start < ${cutoffSql}`,
      [day]
    )
    const nPast = past.rows[0]?.n ?? 0
    const pct = nTotal > 0 ? (nPast / nTotal) * 100 : 0
    console.log(`[db-purge-past] cutoff=${day} London; total=${nTotal}, past=${nPast} (${pct.toFixed(1)}%)`)

    if (!apply) {
      console.log('[db-purge-past] dry-run only. Re-run with --apply to delete.')
      return
    }

    const res = await client.query(
      `delete from ${table} where screening_start < ${cutoffSql}`,
      [day]
    )
    const nDeleted = res.rowCount || 0
    const after = await client.query(`select count(*)::int as n from ${table}`)
    const nAfter = after.rows[0]?.n ?? 0
    console.log(`[db-purge-past] Deleted ${nDeleted} rows; ${nTotal} -> ${nAfter}`)
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => { console.error('[db-purge-past] failed:', e); process.exitCode = 1 })
