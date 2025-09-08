import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { fetchGarden } from './cinemas/garden.mjs'
import { enrichWithTMDb, enrichWithLetterboxd, propagateByDirectorYear } from './enrich.mjs'

const region = process.env.DEFAULT_REGION || 'GB'

// Load existing listings if present
const dataPath = path.join(__dirname, '..', 'data', 'listings.json')
let existing = []
try {
  const raw = await fs.readFile(dataPath, 'utf8')
  existing = JSON.parse(raw)
} catch {}

// Remove current Garden items
existing = Array.isArray(existing) ? existing.filter(i => i?.cinema !== 'garden') : []

function isNonFilmEvent(title) {
  if (!title) return false
  const s = String(title)
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
    /\bwrestling\b/i,
    /\bpro\s*wrestling\b/i,
    /emporium\s+pro\s+wrestling/i,
  ]
  return patterns.some((re) => re.test(s))
}

// Fetch new Garden items and enrich
let garden = await fetchGarden()
garden = garden.filter(i => !isNonFilmEvent(i.filmTitle))
await enrichWithTMDb(garden, region)
{
  const mergedTmp = [...existing, ...garden]
  propagateByDirectorYear(mergedTmp)
  garden = mergedTmp.filter(i => i.cinema === 'garden')
}
await enrichWithLetterboxd(garden)

const merged = [...existing, ...garden]
await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), 'utf8')
console.log('Updated Garden listings in', dataPath, 'Garden items:', garden.length, 'Total:', merged.length)
