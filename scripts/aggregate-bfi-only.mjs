import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { fetchBFI } from './cinemas/bfi.mjs'
import { enrichWithTMDb, enrichWithLetterboxd, propagateByDirectorYear } from './enrich.mjs'

const region = process.env.DEFAULT_REGION || 'GB'

// Load existing listings if present
const dataPath = path.join(__dirname, '..', 'data', 'listings.json')
let existing = []
try {
  const raw = await fs.readFile(dataPath, 'utf8')
  existing = JSON.parse(raw)
} catch {}

// Remove current BFI items
existing = Array.isArray(existing) ? existing.filter(i => i?.cinema !== 'bfi') : []

function isNonFilmEvent(title, venue) {
  // No venue extracted → almost always a standalone talk/panel at BFI.
  if (!venue) return true
  // Blue Room is a function/event room, not a cinema screen.
  if (venue === 'Blue Room') return true
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
    // Talks, conversations and curated events hosted in cinema screens
    /\bin conversation\b/i,
    /\bsip and paint\b/i,
    /\bmeet the projectionists\b/i,
    /\blive in 3D\b/i,
    /\btowards counter-cinema\b/i,
    /\bin the scene:\b/i,
    /\bnew writings\b/i,
    /\bcreative minds\b/i,
    /\bwords, songs and screens\b/i,
    /\bfuture forward\b/i,
    /\ban introduction to\b/i,
  ]
  return patterns.some((re) => re.test(s))
}

let bfi = await fetchBFI()
bfi = bfi.filter(i => !isNonFilmEvent(i.filmTitle, i.venue))
await enrichWithTMDb(bfi, region)
{
  const mergedTmp = [...existing, ...bfi]
  propagateByDirectorYear(mergedTmp)
  bfi = mergedTmp.filter(i => i.cinema === 'bfi')
}
await enrichWithLetterboxd(bfi)

const merged = [...existing, ...bfi]
await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), 'utf8')
console.log('Updated BFI listings in', dataPath, 'BFI items:', bfi.length, 'Total:', merged.length)
