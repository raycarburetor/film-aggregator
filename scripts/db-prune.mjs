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

  const pool = new pg.Pool({
    connectionString: cs,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })

  const file = path.join(root, 'data', 'listings.json')
  const txt = await fs.readFile(file, 'utf8')
  const json = JSON.parse(txt)
  if (!Array.isArray(json)) throw new Error('data/listings.json is not an array')
  const ids = Array.from(new Set(json.map((i) => String(i.id)).filter(Boolean)))
  if (ids.length === 0) {
    console.warn('[db-prune] No ids in data/listings.json; refusing to prune to avoid deleting everything')
    return
  }

  const client = await pool.connect()
  try {
    const before = await client.query(`select count(*)::int as n from ${table}`)
    const nBefore = before.rows[0]?.n ?? 0
    const res = await client.query(`delete from ${table} where not (id = any($1))`, [ids])
    const nDeleted = res.rowCount || 0
    const after = await client.query(`select count(*)::int as n from ${table}`)
    const nAfter = after.rows[0]?.n ?? 0
    console.log(`[db-prune] Deleted ${nDeleted} rows; ${nBefore} -> ${nAfter}`)
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[db-prune] failed:', e)
  process.exitCode = 1
})

