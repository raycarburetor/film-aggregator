import './load-env.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  enrichWithTMDb,
  enrichWithLetterboxd,
  propagateByDirectorYear,
} from './enrich.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataPath = path.join(__dirname, '..', 'data', 'listings.json')
const region = process.env.DEFAULT_REGION || 'GB'

const raw = await fs.readFile(dataPath, 'utf8')
const all = JSON.parse(raw)
if (!Array.isArray(all)) throw new Error('listings.json is not an array')

const other = all.filter((i) => i?.cinema !== 'bfi')
let bfi = all.filter((i) => i?.cinema === 'bfi')
console.log('[enrich-bfi] BFI items before:', bfi.length)

await enrichWithTMDb(bfi, region)
{
  const mergedTmp = [...other, ...bfi]
  propagateByDirectorYear(mergedTmp)
  bfi = mergedTmp.filter((i) => i.cinema === 'bfi')
}
await enrichWithLetterboxd(bfi)

const merged = [...other, ...bfi]
await fs.writeFile(dataPath, JSON.stringify(merged, null, 2), 'utf8')
console.log(
  '[enrich-bfi] wrote',
  merged.length,
  'total items (BFI:',
  bfi.length,
  ')'
)
