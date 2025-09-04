// Aggregate stubs → data/listings.json
import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { fetchBFI } from './cinemas/bfi.mjs'
import { fetchPrinceCharles } from './cinemas/princecharles.mjs'
import { fetchICA } from './cinemas/ica.mjs'
import { fetchCastle } from './cinemas/castle.mjs'
import { enrichWithTMDb, enrichWithOMDb } from './enrich.mjs'

const region = process.env.DEFAULT_REGION || 'GB'
const useOMDb = !!process.env.OMDB_API_KEY

const items = [
  ...(await fetchBFI()),
  ...(await fetchPrinceCharles()),
  ...(await fetchICA()),
  ...(await fetchCastle()),
]

await enrichWithTMDb(items, region)
if (useOMDb) await enrichWithOMDb(items, process.env.OMDB_API_KEY)

const out = path.join(__dirname, '..', 'data', 'listings.json')
await fs.writeFile(out, JSON.stringify(items, null, 2), 'utf8')
console.log('Wrote', out, 'items:', items.length)
