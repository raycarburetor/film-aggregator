import { NextRequest, NextResponse } from 'next/server'
import lbCache from '@/data/letterboxd-cache.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Simple in-memory cache (per server instance). TTL in seconds.
const TTL_SECONDS = (() => {
  const s = process.env.LETTERBOXD_WATCHLIST_TTL
  const n = s ? Number(s) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60 * 60 * 12 // 12h
})()

type CacheEntry = { ids: number[]; expiresAt: number }
const cache = new Map<string, CacheEntry>()

function userAgent() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': userAgent(),
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-GB,en;q=0.9',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch {
    return { ok: false, status: 0 }
  }
}

function extractFilmSlugsFromWatchlist(html: string): string[] {
  // Capture bare film slugs that look like /film/<slug>/ from various attributes
  const slugs = new Set<string>()
  const sources = [
    /href\s*=\s*"(\/film\/[a-z0-9-]+\/)"/ig,
    /data-film-link\s*=\s*"(\/film\/[a-z0-9-]+\/)"/ig,
    /data-target-link\s*=\s*"(\/film\/[a-z0-9-]+\/)"/ig,
    /(\/film\/[a-z0-9-]+\/)(?![a-z0-9-])/ig, // generic fallback in content
  ]
  for (const re of sources) {
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      const url = m[1]
      if (/^\/film\/[a-z0-9-]+\/$/i.test(url)) slugs.add(url)
    }
  }
  return Array.from(slugs)
}

function extractTmdbIdFromFilmPage(html: string): number | null {
  // Prefer explicit TMDb movie link if present
  let m = html.match(/https?:\/\/(?:www\.)?themoviedb\.org\/movie\/(\d+)/i)
  if (m) {
    const id = Number(m[1])
    if (Number.isFinite(id)) return id
  }
  // Common data attributes occasionally contain TMDb ids
  m = html.match(/data-(?:tmdb|tmdb-id|tmdbid)\s*=\s*"(\d{3,9})"/i)
  if (m) {
    const id = Number(m[1])
    if (Number.isFinite(id)) return id
  }
  // Fallback: search for patterns mentioning tmdb followed by digits
  m = html.match(/tmdb\D{0,10}(\d{3,9})/i)
  if (m) {
    const id = Number(m[1])
    if (Number.isFinite(id)) return id
  }
  return null
}

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function fetchAllWatchlistSlugs(username: string): Promise<string[]> {
  const base = `https://letterboxd.com/${encodeURIComponent(username)}/watchlist/`
  const out = new Set<string>()
  let page = 1
  while (true) {
    const url = page === 1 ? base : `${base}page/${page}/`
    const res = await fetchText(url)
    if (!res.ok) break
    const html = res.text || ''
    const slugs = extractFilmSlugsFromWatchlist(html)
    slugs.forEach(s => out.add(s))
    // Heuristic: stop when fewer than ~20 items were found on a page, or no film links present
    if (slugs.length === 0) break
    // Cap pages to avoid excessive scraping
    if (page >= 25) break
    page += 1
    // No delay between pages for faster discovery
    // await delay(0)
  }
  return Array.from(out)
}

// Build a quick slug->tmdbId map from local Letterboxd cache (if present)
function invertLetterboxdCache(): Map<string, number> {
  const map = new Map<string, number>()
  try {
    const obj = lbCache as Record<string, { url?: string }>
    for (const [tmdbStr, val] of Object.entries(obj)) {
      const url = (val as any)?.url
      if (typeof url !== 'string') continue
      const m = url.match(/\/film\/([^/]+)\//)
      if (!m) continue
      const slug = m[1].toLowerCase()
      const id = Number(tmdbStr)
      if (Number.isFinite(id)) map.set(slug, id)
    }
  } catch {}
  return map
}

function splitByCache(slugs: string[]): { cached: number[]; remaining: string[] } {
  const map = invertLetterboxdCache()
  const cachedIds = new Set<number>()
  const remaining: string[] = []
  for (const s of slugs) {
    const m = s.match(/\/film\/([^/]+)\//i)
    const slug = m ? m[1].toLowerCase() : null
    const id = slug ? map.get(slug) : undefined
    if (typeof id === 'number') cachedIds.add(id)
    else remaining.push(s)
  }
  return { cached: Array.from(cachedIds), remaining }
}

async function fetchTmdbIdsForSlugs(slugs: string[], concurrency = 12): Promise<number[]> {
  const host = 'https://letterboxd.com'
  const ids = new Set<number>()
  let i = 0
  async function work() {
    while (i < slugs.length) {
      const idx = i++
      const slug = slugs[idx]
      const url = `${host}${slug}`
      const res = await fetchText(url)
      if (res.ok && res.text) {
        const id = extractTmdbIdFromFilmPage(res.text)
        if (id != null) ids.add(id)
      }
      // Minimal inter-request delay per worker
      await delay(10)
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, slugs.length)) }, work)
  await Promise.all(workers)
  return Array.from(ids)
}

function validUsername(u: string): boolean {
  // Letterboxd usernames are typically alnum + hyphen/underscore; keep conservative
  return /^[A-Za-z0-9_-]{1,30}$/.test(u)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const usernameRaw = (searchParams.get('username') || '').trim()
  if (!usernameRaw) return NextResponse.json({ error: 'Missing username' }, { status: 400 })
  const username = usernameRaw.toLowerCase()
  if (!validUsername(username)) return NextResponse.json({ error: 'Invalid username' }, { status: 400 })

  // Serve from cache if fresh
  const now = Date.now()
  const entry = cache.get(username)
  if (entry && entry.expiresAt > now) {
    return NextResponse.json({ ids: entry.ids })
  }

  // Fetch watchlist slugs
  const slugs = await fetchAllWatchlistSlugs(username)
  if (slugs.length === 0) {
    // Could be empty or private/nonexistent
    // Try hitting the base page to decide
    const baseRes = await fetchText(`https://letterboxd.com/${encodeURIComponent(username)}/watchlist/`)
    if (!baseRes.ok) {
      // Treat 404/403 as not found/private
      return NextResponse.json({ error: 'Watchlist not found or is private' }, { status: 404 })
    }
    // Empty
    return NextResponse.json({ ids: [] })
  }

  // Fast path: map via local Letterboxd cache, then fetch remaining
  const { cached, remaining } = splitByCache(slugs)
  const concurrency = (() => {
    const s = process.env.LETTERBOXD_FETCH_CONCURRENCY
    const n = s ? Number(s) : NaN
    return Number.isFinite(n) && n > 0 ? Math.min(32, Math.max(1, Math.floor(n))) : 16
  })()
  const fetched = remaining.length ? await fetchTmdbIdsForSlugs(remaining, concurrency) : []
  const ids = Array.from(new Set<number>([...cached, ...fetched]))
  cache.set(username, { ids, expiresAt: now + TTL_SECONDS * 1000 })
  return NextResponse.json({ ids })
}
