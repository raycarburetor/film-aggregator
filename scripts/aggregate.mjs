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
import { fetchGarden } from './cinemas/garden.mjs'
import { enrichWithTMDb } from './enrich.mjs'

function isNonFilmEvent(title) {
  if (!title) return false
  const s = String(title)
  // Very conservative filters for obvious non-film events
  const patterns = [
    /\bfilm\s+quiz\b/i,
    /\bquiz\b/i,
    /\bmystery\s+movie\b/i,
    /\bmarathon\b/i,
    /\bsolve[- ]along\b/i,
    /with\s+[^,]+\s+live\s+on\s+stage/i,
    /\blive\s+on\s+stage\b/i,
    /\bindustry\s+panel\b/i,
    /\bnetworking\b/i,
    /\bpanel\s+discussion\b/i,
    /^panel\b/i,
    /\bmasterclass\b/i,
    /\bworkshop\b/i,
    /\bbook\s+(?:talk|launch|reading)\b/i,
    /\bwftv\b/i,
  ]
  return patterns.some((re) => re.test(s))
}

const region = process.env.DEFAULT_REGION || 'GB'

let items = [
  ...(await fetchBFI()),
  ...(await fetchPrinceCharles()),
  ...(await fetchICA()),
  ...(await fetchCastle()),
  ...(await fetchGarden()),
]

// Drop obvious non-film events
items = items.filter((it) => !isNonFilmEvent(it.filmTitle))

await enrichWithTMDb(items, region)

const out = path.join(__dirname, '..', 'data', 'listings.json')
await fs.writeFile(out, JSON.stringify(items, null, 2), 'utf8')
console.log('Wrote', out, 'items:', items.length)
