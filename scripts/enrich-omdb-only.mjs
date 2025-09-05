// Lightweight OMDb-only enrichment for existing listings.json
// Skips scraping; only updates Rotten Tomatoes via OMDb
import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { enrichWithOMDb } from './enrich.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const omdbKey = process.env.OMDB_API_KEY
  if (!omdbKey) {
    console.error('OMDB_API_KEY not set. Add it to .env.local or export it in your shell.')
    process.exit(1)
  }
  const file = path.join(__dirname, '..', 'data', 'listings.json')
  const raw = await fs.readFile(file, 'utf8')
  const items = JSON.parse(raw)
  const targets = items.filter((it) => typeof it.rottenTomatoesPct !== 'number')
  console.log('Items total:', items.length, '| Missing RT%:', targets.length)
  if (targets.length === 0) {
    console.log('Nothing to update; quitting.')
    return
  }
  await enrichWithOMDb(targets, omdbKey)
  await fs.writeFile(file, JSON.stringify(items, null, 2), 'utf8')
  console.log('Updated Rotten Tomatoes for', targets.length, 'items')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

