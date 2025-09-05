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

// Fetch new PCC items and enrich
let pcc = await fetchPrinceCharles()
await enrichWithTMDb(pcc, region)

const merged = [...existing, ...pcc]
await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), 'utf8')
console.log('Updated PCC listings in', dataPath, 'PCC items:', pcc.length, 'Total:', merged.length)
