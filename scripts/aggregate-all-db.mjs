// Orchestrate full aggregation across all cinemas, seed/prune DB, then Letterboxd HTTP enrichment in chunks
// Usage: node scripts/aggregate-all-db.mjs [--chunk=100] [--force]
import './load-env.mjs'
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function argHas(flag) {
  return process.argv.slice(2).some(a => a === flag)
}
function argNum(name, def) {
  const m = process.argv.slice(2).find(a => a.startsWith(`${name}=`))
  if (!m) return def
  const v = Number(m.split('=')[1])
  return Number.isFinite(v) ? v : def
}

function ts() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2,'0')
  const mm = String(d.getMinutes()).padStart(2,'0')
  const ss = String(d.getSeconds()).padStart(2,'0')
  return `${hh}:${mm}:${ss}`
}

function runNode(scriptRel, extraEnv = {}, tag = '') {
  const scriptPath = path.join(__dirname, scriptRel)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv } })
    const name = tag || scriptRel.replace(/^aggregate-|\.mjs$/g,'')
    const rlOut = readline.createInterface({ input: child.stdout })
    rlOut.on('line', (line) => console.log(`[${ts()}][${name}] ${line}`))
    const rlErr = readline.createInterface({ input: child.stderr })
    rlErr.on('line', (line) => console.error(`[${ts()}][${name}][ERR] ${line}`))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined)
      else reject(new Error(`${scriptRel} exited with code ${code}`))
    })
  })
}

async function main() {
  // During scraping, skip Letterboxd enrichment for speed; we’ll update ratings from DB afterwards
  const scrapeEnv = { LETTERBOXD_ENABLE: 'false' }
  const steps = [
    // 'aggregate-bfi-only.mjs', // temporarily disabled per request
    'aggregate-barbican-only.mjs',
    'aggregate-castle-only.mjs',
    'aggregate-closeup-only.mjs',
    'aggregate-garden-only.mjs',
    'aggregate-genesis-only.mjs',
    'aggregate-ica-only.mjs',
    'aggregate-pcc-only.mjs',
    'aggregate-rio-only.mjs',
    'aggregate-cinelumiere-only.mjs',
  ]
  for (const s of steps) {
    console.log(`[ALL] Running ${s} (LB disabled during scrape) ...`)
    const tag = s.split('-')[1]?.toUpperCase() || s
    await runNode(s, scrapeEnv, tag)
  }

  // Strip any lingering BFI items from data/listings.json before seeding
  try {
    const fs = await import('node:fs/promises')
    const listingsPath = path.join(__dirname, '..', 'data', 'listings.json')
    const raw = await fs.readFile(listingsPath, 'utf8').catch(()=> '[]')
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) {
      const before = arr.length
      const filtered = arr.filter(i => (i && i.cinema !== 'bfi'))
      if (filtered.length !== before) {
        await fs.writeFile(listingsPath, JSON.stringify(filtered, null, 2), 'utf8')
        console.log(`[ALL] Removed ${before - filtered.length} BFI items from listings.json before DB sync`)
      } else {
        console.log('[ALL] No BFI items to remove from listings.json')
      }
    }
  } catch (e) {
    console.warn('[ALL] Failed to strip BFI from listings.json:', e?.message || e)
  }

  console.log('[ALL] Seeding DB ...')
  await runNode('db-seed.mjs', {}, 'DB-SEED')
  console.log('[ALL] Pruning DB ...')
  await runNode('db-prune.mjs', {}, 'DB-PRUNE')

  // Letterboxd HTTP enrichment (chunked)
  const chunk = argNum('--chunk', 100)
  const force = argHas('--force')
  const args = ['enrich-letterboxd-db-http.mjs']
  if (typeof chunk === 'number') args.push(`--chunk=${chunk}`)
  if (force) args.push('--force')
  console.log(`[ALL] Letterboxd HTTP enrichment: chunk=${chunk} force=${force} ...`)
  await runNode('enrich-letterboxd-db-http.mjs', {}, 'LB')

  console.log('[ALL] Done.')
}

main().catch((e) => { console.error('[ALL] failed:', e); process.exitCode = 1 })
