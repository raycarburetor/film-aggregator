// Prune Postgres listings to match data/listings.json exactly (by id)
// Usage: node scripts/db-prune.mjs
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

  // Match db-seed SSL behavior: enable SSL when requested/hosted and
  // relax cert verification to avoid SELF_SIGNED_CERT_IN_CHAIN locally.
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

  const file = path.join(root, 'data', 'listings.json')
  const stat = await fs.stat(file)
  const txt = await fs.readFile(file, 'utf8')
  const json = JSON.parse(txt)
  if (!Array.isArray(json)) throw new Error('data/listings.json is not an array')

  // Optional scope: only prune within one cinema. Paired with CINEMA_SCOPE
  // in db-seed so a per-cinema run cannot delete rows for other cinemas.
  const scope = (process.env.CINEMA_SCOPE || '').trim().toLowerCase() || null
  const scoped = scope ? json.filter((i) => String(i?.cinema || '').toLowerCase() === scope) : json
  const ids = Array.from(new Set(scoped.map((i) => String(i.id)).filter(Boolean)))
  if (ids.length === 0) {
    console.warn(`[db-prune] No ids in data/listings.json${scope ? ` for cinema=${scope}` : ''}; refusing to prune to avoid deleting everything`)
    return
  }

  // Safety: force flag to override both guards below.
  const force = process.argv.includes('--force') || /^(1|true|yes)$/i.test(String(process.env.PRUNE_FORCE || ''))

  // Safety 1: refuse to prune with a stale listings.json. Guards against the
  // "local scraper hasn't been run in weeks" case that previously wiped prod.
  const maxAgeHours = Number(process.env.PRUNE_MAX_AGE_HOURS ?? 6)
  const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000
  if (!force && Number.isFinite(maxAgeHours) && maxAgeHours > 0 && ageHours > maxAgeHours) {
    console.error(`[db-prune] Refusing to prune: data/listings.json is ${ageHours.toFixed(1)}h old (> PRUNE_MAX_AGE_HOURS=${maxAgeHours}). Re-run the scraper, or pass --force.`)
    process.exitCode = 1
    return
  }

  const client = await pool.connect()
  try {
    const before = await client.query(`select count(*)::int as n from ${table}${scope ? ` where cinema = $1` : ''}`, scope ? [scope] : [])
    const nBefore = before.rows[0]?.n ?? 0

    // Safety 2: dry-run the delete count first. Refuse if it exceeds threshold.
    const maxPct = Number(process.env.PRUNE_MAX_DELETE_PCT ?? 50)
    const dryCountSql = scope
      ? `select count(*)::int as n from ${table} where cinema = $2 and not (id = any($1))`
      : `select count(*)::int as n from ${table} where not (id = any($1))`
    const dryArgs = scope ? [ids, scope] : [ids]
    const dry = await client.query(dryCountSql, dryArgs)
    const nWouldDelete = dry.rows[0]?.n ?? 0
    const pct = nBefore > 0 ? (nWouldDelete / nBefore) * 100 : 0
    if (!force && Number.isFinite(maxPct) && maxPct > 0 && pct > maxPct) {
      console.error(`[db-prune] Refusing to prune: would delete ${nWouldDelete}/${nBefore} rows (${pct.toFixed(1)}% > PRUNE_MAX_DELETE_PCT=${maxPct}).${scope ? ` scope=${scope}` : ''} Pass --force to override.`)
      process.exitCode = 1
      return
    }

    const deleteSql = scope
      ? `delete from ${table} where cinema = $2 and not (id = any($1))`
      : `delete from ${table} where not (id = any($1))`
    const deleteArgs = scope ? [ids, scope] : [ids]
    const res = await client.query(deleteSql, deleteArgs)
    const nDeleted = res.rowCount || 0
    const after = await client.query(`select count(*)::int as n from ${table}${scope ? ` where cinema = $1` : ''}`, scope ? [scope] : [])
    const nAfter = after.rows[0]?.n ?? 0
    console.log(`[db-prune]${scope ? ` cinema=${scope}:` : ''} Deleted ${nDeleted} rows; ${nBefore} -> ${nAfter}`)
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[db-prune] failed:', e)
  process.exitCode = 1
})
