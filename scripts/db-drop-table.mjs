// Drops a Postgres table, defaulting to LISTINGS_TABLE or 'listings'
// Usage: node scripts/db-drop-table.mjs [table]
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import './load-env.mjs'

function sanitizeTableName(name) {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL is not set in environment')
  const table = sanitizeTableName(process.argv[2] || process.env.LISTINGS_TABLE)
  const pool = new pg.Pool({
    connectionString: cs,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
  const client = await pool.connect()
  try {
    console.log(`[db-drop] Dropping table ${table} ...`)
    await client.query(`drop table if exists ${table} cascade;`)
    console.log(`[db-drop] Dropped ${table}`)
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[db-drop] failed:', e)
  process.exitCode = 1
})

