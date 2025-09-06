import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import { enrichWithLetterboxd } from './enrich.mjs'

const dataPath = path.join(__dirname, '..', 'data', 'listings.json')
let items = []
try { items = JSON.parse(await fs.readFile(dataPath, 'utf8')) } catch { items = [] }

await enrichWithLetterboxd(items)

await fs.writeFile(dataPath, JSON.stringify(items, null, 2), 'utf8')
console.log('[LB] Updated Letterboxd ratings for', items.length, 'items')

