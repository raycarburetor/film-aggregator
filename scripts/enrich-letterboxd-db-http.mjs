// Enrich Postgres listings with Letterboxd average ratings via direct HTTP fetch
// Approach: for each unique tmdb_id, resolve a Letterboxd film URL (cache → search),
// then fetch the film page and parse JSON-LD aggregateRating.ratingValue.
// Usage:
//   node scripts/enrich-letterboxd-db-http.mjs [--force] [--limit=N]
//   Env: DATABASE_URL (required), LISTINGS_TABLE (optional, defaults to 'listings').
// Notes:
//   - By default only rows with NULL letterboxd_rating are updated; use --force to refresh all.
//   - Writes the same rating to all rows sharing tmdb_id.
//   - Stores URL resolutions in data/letterboxd-cache.json
import './load-env.mjs'
import pg from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const cachePath = path.join(root, 'data', 'letterboxd-cache.json')

function sanitizeTableName(name) {
  const fallback = 'listings'
  if (!name) return fallback
  return /^[A-Za-z0-9_]+$/.test(name) ? name : fallback
}

function argHas(flag) {
  return process.argv.slice(2).some(a => a === flag)
}
function argNum(name, def) {
  const m = process.argv.slice(2).find(a => a.startsWith(`${name}=`))
  if (!m) return def
  const v = Number(m.split('=')[1])
  return Number.isFinite(v) ? v : def
}
function argVal(name) {
  const m = process.argv.slice(2).find(a => a.startsWith(`${name}=`))
  if (!m) return undefined
  const v = m.slice(name.length + 1)
  return v || undefined
}

async function loadCache() {
  try { const t = await fs.readFile(cachePath, 'utf8'); return JSON.parse(t) || {} } catch { return {} }
}
async function saveCache(obj) {
  try { await fs.writeFile(cachePath, JSON.stringify(obj, null, 2), 'utf8') } catch {}
}

function normalizeTitleForSearch(title) {
  if (!title) return title
  let s = String(title)
  const presentsIdx = s.toLowerCase().indexOf('presents:')
  if (presentsIdx !== -1) s = s.slice(presentsIdx + 'presents:'.length)
  s = s
    .replace(/^\s*(?:preview|relaxed\s+screening|members'?\s*screening|parent\s*&\s*baby\s*screening)\s*[:\-–—]\s*/i, '')
    .replace(/^\s*(?:parent\s*(?:and|&)?\s*baby|family\s*film\s*club)\s*[:\-–—]\s*/i, '')
    .replace(/^\s*[^:]{0,80}\bscreening\s*[:\-–—]\s*/i, '')
    .replace(/\s*[\[(][^\])]*[\])]/g, ' ')
    .replace(/\s*[-–—]\s*(\d+\w*\s+anniversary|\d+k\s+restoration|restored|director'?s\s+cut|theatrical\s+cut|remastered|preview|qa|q&a|uncut(?:\s+version)?)\s*$/i, '')
    .replace(/\s*[:\-–—]\s*(classics\s+presented.*|presented\s+by.*|halloween\s+at.*|at\s+genesis.*|soft\s+limit\s+cinema.*|cult\s+classic\s+collective.*|studio\s+screening.*|double\s+bill.*|film\s+festival.*|in\s+(?:35|70)\s*mm.*|on\s+(?:35|70)\s*mm.*)\s*$/i, '')
    .replace(/\s*\((?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\)\s*$/i, '')
    .replace(/\s+\b(?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\b\s*$/i, '')
    .replace(/\s*\+\s*(?:post[- ]?screening\s+)?(?:q\s*&\s*a|q\s*and\s*a|qa)(?:[^)]*)?\s*$/i, '')
    .replace(/\s*(?:[-:])?\s*with\s+[^)]*(?:q\s*&\s*a|q\s*and\s*a|qa)\s*$/i, '')
    .replace(/\s*\b4\s*k\s*restoration\b\s*$/i, '')
    .replace(/\s*\b(?:in|on)\s+(?:35|70)\s*mm\b\s*$/i, '')
    .replace(/\s+uncut\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  s = s.replace(/\s+(19|20)\d{2}$/g, '').trim()
  return s
}

function extractYearHint(title, releaseDate, websiteYear) {
  function annotationYearFromTitle(t) {
    const s = String(t || '')
    let m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
    if (m) return Number(m[1])
    m = s.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
    if (m) return Number(m[1])
    m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
    if (m) return Number(m[1])
    return undefined
  }
  const t = annotationYearFromTitle(title)
  if (t) return t
  if (releaseDate && /^\d{4}/.test(releaseDate)) return Number(releaseDate.slice(0,4))
  const Y = new Date().getFullYear()
  if (typeof websiteYear === 'number' && Number.isFinite(websiteYear)) {
    if (websiteYear >= 1895 && websiteYear <= Y + 1) return websiteYear
  }
  return undefined
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function unique(hrefs) {
  return Array.from(new Set(hrefs))
}

function extractLdRating(html) {
  // Try to locate JSON-LD blocks and parse aggregateRating.ratingValue
  const blocks = []
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    const raw = m[1]
    blocks.push(raw)
  }
  for (let raw of blocks) {
    try {
      // Strip common CDATA comment wrappers used around JSON-LD
      raw = raw
        .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/i, '')
        .replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/i, '')
        .trim()
      // As a fallback, clip to the first { ... } block
      if (!/^\s*[\[{]/.test(raw)) {
        const start = raw.indexOf('{')
        const end = raw.lastIndexOf('}')
        if (start !== -1 && end !== -1 && end > start) raw = raw.slice(start, end + 1)
      }
      const data = JSON.parse(raw)
      const arr = Array.isArray(data) ? data : [data]
      for (const obj of arr) {
        const ar = obj && obj.aggregateRating
        if (ar && typeof ar.ratingValue !== 'undefined') {
          const n = Number(ar.ratingValue)
          if (Number.isFinite(n)) return n
        }
      }
    } catch {}
  }
  return undefined
}

function extractMetaRating(html) {
  try {
    const m = html.match(/name=["']twitter:data2["'][^>]*content=["']\s*([0-9]+(?:\.[0-9]+)?)\s*out\s*of\s*5["']/i)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n)) return n
    }
  } catch {}
  return undefined
}

function pageHasTmdbId(html, tmdbId) {
  const id = String(tmdbId)
  return new RegExp(`themoviedb\\.org\\/movie\\/${id}(?:[^\\d]|$)`).test(html) || new RegExp(`themoviedb\\.org[^>]*${id}`).test(html)
}

async function searchLetterboxdCandidates(q) {
  const url = `https://letterboxd.com/search/films/${encodeURIComponent(q)}/`
  try {
    const html = await fetchText(url)
    const hrefs = []
    const re = /href=["'](\/film\/[^"'#?]+\/?)["']/g
    let m
    while ((m = re.exec(html))) hrefs.push(m[1])
    return unique(hrefs).slice(0, 10).map(h => new URL(h, 'https://letterboxd.com').toString())
  } catch {
    return []
  }
}

async function resolveLetterboxdUrlFor(cache, tmdbId, title, releaseDate, websiteYear) {
  const key = String(tmdbId)
  const cached = cache[key]
  if (cached && cached.url) return cached.url

  const normTitle = normalizeTitleForSearch(title)
  const yearHint = extractYearHint(title, releaseDate, websiteYear)
  const q = [normTitle, yearHint].filter(Boolean).join(' ')

  // 1) Try deterministic slug guesses first for common cases (faster and more reliable than search)
  function slugify(s) {
    if (!s) return ''
    // Normalize diacritics
    s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    // Common symbol replacements
    s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ')
    // Remove quotes
    s = s.replace(/["'`’]/g, '')
    // Non-alphanumeric → hyphen
    s = s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    // Collapse multiple hyphens
    s = s.replace(/-{2,}/g, '-')
    return s.toLowerCase()
  }
  const base = slugify(normTitle)
  const slugCandidates = []
  const push = (x) => { if (x && !slugCandidates.includes(x)) slugCandidates.push(x) }
  push(base)
  if (yearHint) push(`${base}-${yearHint}`)
  if (/[&]/.test(normTitle)) {
    const noAmp = slugify(normTitle.replace(/&/g, ''))
    push(noAmp)
    if (yearHint) push(`${noAmp}-${yearHint}`)
    const noAndWord = slugify(normTitle.replace(/\b(?:&|and)\b/gi, ' '))
    push(noAndWord)
    if (yearHint) push(`${noAndWord}-${yearHint}`)
  }
  for (const slug of slugCandidates) {
    if (!slug) continue
    const url = `https://letterboxd.com/film/${slug}/`
    try {
      const html = await fetchText(url)
      if (pageHasTmdbId(html, tmdbId)) {
        cache[key] = { url, updatedAt: new Date().toISOString() }
        await saveCache(cache)
        return url
      }
    } catch {}
  }

  // 2) Fall back to search and verify
  const candidates = await searchLetterboxdCandidates(q)
  for (const url of candidates.slice(0, 5)) {
    try {
      const html = await fetchText(url)
      if (pageHasTmdbId(html, tmdbId)) {
        cache[key] = { url, updatedAt: new Date().toISOString() }
        await saveCache(cache)
        return url
      }
    } catch {}
  }
  if (candidates[0]) {
    const url = candidates[0]
    cache[key] = { url, updatedAt: new Date().toISOString() }
    await saveCache(cache)
    return url
  }
  return undefined
}

async function extractAverageRating(url) {
  try {
    const html = await fetchText(url)
    return extractLdRating(html) ?? extractMetaRating(html)
  } catch {
    return undefined
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const cs = process.env.DATABASE_URL
  if (!cs) throw new Error('DATABASE_URL is not set in environment')
  const table = sanitizeTableName(process.env.LISTINGS_TABLE)
  const force = argHas('--force')
  const limit = argNum('--limit', undefined)

  // Detect SSL need and relax verification for common hosted DBs with self-signed chains
  const needsSsl = /sslmode=require/i.test(cs) || /[?&]ssl=true/i.test(cs) || /(supabase|neon|vercel)/i.test(cs)
  let connectionString = cs
  try {
    const u = new URL(cs)
    if (u.searchParams.get('ssl') === 'true') {
      u.searchParams.delete('ssl')
      connectionString = u.toString()
    }
  } catch {}
  const pool = new pg.Pool({
    connectionString,
    ssl: needsSsl || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  })
  const client = await pool.connect()
  try {
    const baseSql = `
      select id, film_title, tmdb_id, release_date, website_year, letterboxd_rating
      from ${table}
      where tmdb_id is not null
      ${force ? '' : 'and letterboxd_rating is null'}
    `
    // Optional cinema filter: --cinema=genesis (uses DB values)
    const cinema = argVal('--cinema')
    let sql = baseSql
    const params = []
    if (cinema) {
      sql += ` and cinema = $1`
      params.push(cinema)
    }
    const { rows } = await client.query(sql, params)
    if (!rows.length) { console.log(`[LB][HTTP] Nothing to enrich (force=${force}).`); return }

    // Consolidate by tmdb_id
    const byTmdb = new Map()
    for (const r of rows) {
      const k = Number(r.tmdb_id)
      if (!k || !Number.isFinite(k)) continue
      if (!byTmdb.has(k)) byTmdb.set(k, r)
    }
    let entries = Array.from(byTmdb.entries())
    if (typeof limit === 'number' && limit > 0) entries = entries.slice(0, limit)

    const cache = await loadCache()
    const chunkSize = argNum('--chunk', 100)
    const total = entries.length
    let processed = 0
    let seq = 0

    while (processed < total) {
      const batch = entries.slice(processed, Math.min(total, processed + chunkSize))
      const updates = new Map()
      for (const [tmdbId, sample] of batch) {
        seq++
        const title = sample.film_title
        const releaseDate = sample.release_date ? new Date(sample.release_date).toISOString() : undefined
        const websiteYear = typeof sample.website_year === 'number' ? sample.website_year : undefined
        try {
          const url = await resolveLetterboxdUrlFor(cache, tmdbId, title, releaseDate, websiteYear)
          if (!url) { console.log(`[${seq}/${total}] tmdb=${tmdbId} no URL`); await sleep(600); continue }
          const rating = await extractAverageRating(url)
          if (typeof rating === 'number' && rating >= 0 && rating <= 5) {
            updates.set(tmdbId, rating)
            console.log(`[${seq}/${total}] tmdb=${tmdbId} rating=${rating.toFixed(2)} url=${url}`)
          } else {
            console.log(`[${seq}/${total}] tmdb=${tmdbId} no rating url=${url}`)
          }
        } catch (e) {
          console.log(`[${seq}/${total}] tmdb=${tmdbId} error:`, e?.message || e)
        }
        await sleep(800 + Math.random()*500)
      }

      if (updates.size) {
        await client.query('begin')
        try {
          let changed = 0
          for (const [tmdbId, rating] of updates) {
            const res = await client.query(
              `update ${table} set letterboxd_rating = $1 where tmdb_id = $2`,
              [rating, tmdbId]
            )
            changed += res.rowCount || 0
          }
          await client.query('commit')
          console.log(`[LB][HTTP] Chunk updated: ${changed} rows across ${updates.size} tmdb_id(s). Progress: ${processed + batch.length}/${total}`)
        } catch (e) {
          await client.query('rollback')
          throw e
        }
        await saveCache(cache)
      } else {
        console.log('[LB][HTTP] No ratings found in this chunk.')
      }
      processed += batch.length
      // short breather between chunks
      await sleep(1000)
    }
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('[LB][HTTP] failed:', e)
  process.exitCode = 1
})
