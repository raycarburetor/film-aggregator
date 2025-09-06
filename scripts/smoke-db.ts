// Smoke test for lib/db.ts
// Usage: npm run db:test
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAllListings, closePool } from '../lib/db'

async function loadEnv() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const root = path.join(__dirname, '..')
  async function loadFile(file: string) {
    try {
      const txt = await fs.readFile(file, 'utf8')
      for (const rawLine of txt.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq === -1) continue
        const key = line.slice(0, eq).trim()
        let val = line.slice(eq + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        if (!(key in process.env)) process.env[key] = val
      }
    } catch {}
  }
  await loadFile(path.join(root, '.env'))
  await loadFile(path.join(root, '.env.local'))
}

async function main() {
  await loadEnv()
  const items = await getAllListings()
  if (!items) {
    console.log('[smoke-db] Pool not created (missing DATABASE_URL?).')
    return
  }
  console.log(`[smoke-db] rows=${items.length}`)
  const sample = items.slice(0, 5).map((i) => ({
    id: i.id,
    filmTitle: i.filmTitle,
    cinema: i.cinema,
    screeningStart: i.screeningStart,
    releaseDate: i.releaseDate,
    tmdbId: i.tmdbId,
    letterboxdRating: i.letterboxdRating,
  }))
  console.log('[smoke-db] sample:')
  console.log(JSON.stringify(sample, null, 2))
}

main()
  .catch((e) => {
    console.error('[smoke-db] error:', e)
    process.exitCode = 1
  })
  .finally(() => closePool())
