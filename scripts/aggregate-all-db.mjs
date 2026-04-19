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
    'aggregate-bfi-only.mjs',
    'aggregate-barbican-only.mjs',
    'aggregate-castle-only.mjs',
    'aggregate-closeup-only.mjs',
    'aggregate-garden-only.mjs',
    'aggregate-genesis-only.mjs',
    'aggregate-ica-only.mjs',
    'aggregate-nickel-only.mjs',
    'aggregate-pcc-only.mjs',
    'aggregate-rio-only.mjs',
    'aggregate-cinelumiere-only.mjs',
  ]
  // Run each scraper independently: one failing cinema must not prevent the
  // rest of the pipeline. Previously a single crash aborted the whole job,
  // leaving the DB unchanged and the UI serving stale rows for days.
  const failed = []
  for (const s of steps) {
    console.log(`[ALL] Running ${s} (LB disabled during scrape) ...`)
    const tag = s.split('-')[1]?.toUpperCase() || s
    try {
      await runNode(s, scrapeEnv, tag)
    } catch (e) {
      failed.push({ script: s, error: e?.message || String(e) })
      console.error(`[ALL] ${s} FAILED — continuing with remaining scrapers. Error: ${e?.message || e}`)
    }
  }

  if (failed.length === steps.length) {
    // If literally nothing scraped, don't touch the DB — the existing rows
    // are a better answer than wiping to empty.
    console.error('[ALL] All scrapers failed; skipping DB seed/prune to preserve existing rows.')
    process.exitCode = 1
    return
  }

  console.log('[ALL] Seeding DB ...')
  await runNode('db-seed.mjs', {}, 'DB-SEED')

  if (failed.length) {
    // Skip the unscoped prune on partial failure. Otherwise we would delete
    // rows for every cinema whose scraper crashed (their ids are absent
    // from listings.json), wiping them from the UI until the next clean run.
    // Upsert-only: stale rows for failed cinemas persist, which is the
    // lesser evil compared to showing nothing.
    console.warn(`[ALL] Skipping DB prune because ${failed.length} scraper(s) failed; stale rows for failed cinemas preserved.`)
  } else {
    console.log('[ALL] Pruning DB ...')
    await runNode('db-prune.mjs', {}, 'DB-PRUNE')
  }

  // Letterboxd HTTP enrichment (chunked)
  const chunk = argNum('--chunk', 100)
  const force = argHas('--force')
  const args = ['enrich-letterboxd-db-http.mjs']
  if (typeof chunk === 'number') args.push(`--chunk=${chunk}`)
  if (force) args.push('--force')
  console.log(`[ALL] Letterboxd HTTP enrichment: chunk=${chunk} force=${force} ...`)
  await runNode('enrich-letterboxd-db-http.mjs', {}, 'LB')

  if (failed.length) {
    console.error(`[ALL] Done with ${failed.length} scraper failure(s):`)
    for (const f of failed) console.error(`  - ${f.script}: ${f.error}`)
    process.exitCode = 1
  } else {
    console.log('[ALL] Done.')
  }
}

main().catch((e) => { console.error('[ALL] failed:', e); process.exitCode = 1 })
