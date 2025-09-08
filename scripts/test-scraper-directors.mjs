// Test each scraper and print every result's director field
// Usage: node scripts/test-scraper-directors.mjs [--only=barbican,pcc] [--match=Christy]
import './load-env.mjs'

// Keep runs fast
process.env.DEFAULT_HORIZON_DAYS ||= '2'
process.env.BFI_HORIZON_DAYS ||= '2'
process.env.PCC_HORIZON_DAYS ||= '2'
process.env.ICA_HORIZON_DAYS ||= '2'
process.env.CASTLE_HORIZON_DAYS ||= '2'
process.env.GARDEN_HORIZON_DAYS ||= '2'
process.env.GENESIS_HORIZON_DAYS ||= '2'
process.env.CLOSEUP_HORIZON_DAYS ||= '2'
process.env.BARBICAN_HORIZON_DAYS ||= '2'

// Limit detail page passes for speed
process.env.BFI_MAX_DETAIL_PAGES ||= '2'
process.env.PCC_MAX_DETAIL_PAGES ||= '2'
process.env.ICA_MAX_DETAIL_PAGES ||= '2'
process.env.CASTLE_MAX_DETAIL_PAGES ||= '2'
process.env.GARDEN_MAX_DETAIL_PAGES ||= '2'
process.env.GENESIS_MAX_DETAIL_PAGES ||= '2'
process.env.BARBICAN_MAX_DETAIL_PAGES ||= '2'

import { fetchBFI } from './cinemas/bfi.mjs'
import { fetchPrinceCharles } from './cinemas/princecharles.mjs'
import { fetchICA } from './cinemas/ica.mjs'
import { fetchCastle } from './cinemas/castle.mjs'
import { fetchGarden } from './cinemas/garden.mjs'
import { fetchGenesis } from './cinemas/genesis.mjs'
import { fetchCloseUp } from './cinemas/closeup.mjs'
import { fetchBarbican } from './cinemas/barbican.mjs'

const MATCH = (process.argv.find(a => a.startsWith('--match='))?.slice('--match='.length) || '').toLowerCase()

async function runOne(name, fn) {
  try {
    const items = await fn()
    const pool = Array.isArray(items) ? items.slice() : []
    const filtered = MATCH ? pool.filter(i => (i?.filmTitle || '').toLowerCase().includes(MATCH)) : pool
    if (!filtered.length) {
      console.log(`${name}: no items found${MATCH ? ` (match=${MATCH})` : ''}`)
      return
    }
    // Sort by time ascending
    filtered.sort((a,b) => String(a.screeningStart).localeCompare(String(b.screeningStart)))
    console.log(`[${name}] items=${filtered.length}${MATCH ? ` (filtered by ${MATCH})` : ''}`)
    for (const [idx, it] of filtered.entries()) {
      const dir = typeof it.director === 'string' && it.director.trim() ? it.director : '—'
      const yr = typeof it.websiteYear === 'number' ? it.websiteYear : (it.releaseDate?.slice?.(0,4) || '—')
      const when = it.screeningStart
      console.log(`- #${idx+1}`)
      console.log(`  Title     : ${it.filmTitle}`)
      console.log(`  Director  : ${dir}`)
      console.log(`  Year      : ${yr}`)
      console.log(`  Start     : ${when}`)
      if (it.filmUrl) console.log(`  Film URL  : ${it.filmUrl}`)
      if (it.bookingUrl) console.log(`  Booking   : ${it.bookingUrl}`)
    }
  } catch (e) {
    console.log(`${name}: ERROR ${e?.message || e}`)
  }
}

const which = new Set(
  (process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length) || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
)

function want(name) {
  if (!which.size) return true
  const key = name.toLowerCase()
  return which.has(key)
}

if (want('bfi')) await runOne('BFI', fetchBFI)
if (want('prince charles') || want('pcc') || want('princecharles')) await runOne('Prince Charles', fetchPrinceCharles)
if (want('ica')) await runOne('ICA', fetchICA)
if (want('castle')) await runOne('Castle', fetchCastle)
if (want('garden')) await runOne('Garden', fetchGarden)
if (want('genesis')) await runOne('Genesis', fetchGenesis)
if (want('close-up') || want('closeup')) await runOne('Close-Up', fetchCloseUp)
if (want('barbican')) await runOne('Barbican', fetchBarbican)
