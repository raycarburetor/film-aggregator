import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { fetchPrinceCharles } from './cinemas/princecharles.mjs'
import { enrichWithTMDb } from './enrich.mjs'

const region = process.env.DEFAULT_REGION || 'GB'

// Load existing listings if present
const dataPath = path.join(__dirname, '..', 'data', 'listings.json')
let existing = []
try {
  const raw = await fs.readFile(dataPath, 'utf8')
  existing = JSON.parse(raw)
} catch {}

// Remove current PCC items
existing = Array.isArray(existing) ? existing.filter(i => i?.cinema !== 'princecharles') : []

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

// Fetch new PCC items and enrich
let pcc = await fetchPrinceCharles()
pcc = pcc.filter(i => !isNonFilmEvent(i.filmTitle))
await enrichWithTMDb(pcc, region)

const merged = [...existing, ...pcc]
await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), 'utf8')
console.log('Updated PCC listings in', dataPath, 'PCC items:', pcc.length, 'Total:', merged.length)
