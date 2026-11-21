// Scrape-only check for the Cloudflare-fronted cinemas (BFI, Close-Up).
// No enrichment, no listings.json write, no DB. Exits 1 if any scraper
// returns zero future screenings, so CI shows red when Cloudflare wins.
//   node scripts/probe-cf-scrapers.mjs [bfi] [closeup]
import { fetchBFI } from './cinemas/bfi.mjs'
import { fetchCloseUp } from './cinemas/closeup.mjs'

const all = { bfi: fetchBFI, closeup: fetchCloseUp }
const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(all)
const fmt = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/London',
})

let failed = false
for (const key of keys) {
  const fn = all[key]
  if (!fn) throw new Error(`unknown scraper: ${key}`)
  const t0 = Date.now()
  const rows = await fn()
  const secs = ((Date.now() - t0) / 1000).toFixed(0)
  const ids = new Set(rows.map((r) => r.id))
  console.log(`[PROBE] ${key}: ${rows.length} screenings (${ids.size} unique ids) in ${secs}s`)
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${fmt.format(new Date(r.screeningStart))}  ${r.filmTitle}`)
  }
  if (!rows.length) failed = true
}
process.exit(failed ? 1 : 0)
