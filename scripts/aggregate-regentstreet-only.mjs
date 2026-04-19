import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { fetchRegentStreet } from './cinemas/regentstreet.mjs'
import { enrichWithTMDb, enrichWithLetterboxd, propagateByDirectorYear } from './enrich.mjs'

const region = process.env.DEFAULT_REGION || 'GB'

const dataPath = path.join(__dirname, '..', 'data', 'listings.json')
let existing = []
try {
  const raw = await fs.readFile(dataPath, 'utf8')
  existing = JSON.parse(raw)
} catch {}

existing = Array.isArray(existing) ? existing.filter(i => i?.cinema !== 'regentstreet') : []

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
  ]
  return patterns.some((re) => re.test(s))
}

let rsc = await fetchRegentStreet()
rsc = rsc.filter(i => !isNonFilmEvent(i.filmTitle))
await enrichWithTMDb(rsc, region)
{
  const mergedTmp = [...existing, ...rsc]
  propagateByDirectorYear(mergedTmp)
  rsc = mergedTmp.filter(i => i.cinema === 'regentstreet')
}
await enrichWithLetterboxd(rsc)

const merged = [...existing, ...rsc]
await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), 'utf8')
console.log('Updated Regent Street listings in', dataPath, 'RSC items:', rsc.length, 'Total:', merged.length)
