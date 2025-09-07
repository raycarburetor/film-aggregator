import { NextRequest, NextResponse } from 'next/server'
import { Screening, CinemaKey } from '@/types'
import { filterByTimeWindow, parseNum, isClearlyNonFilm } from '@/lib/filters'
import data from '@/data/listings.json'
import { getAllListings } from '@/lib/db'

// Ensure Node.js runtime so the 'pg' driver works
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').toLowerCase().trim()
    const window = (searchParams.get('window') || 'week') as 'today'|'week'|'month'|'all'
    const cinemas = (searchParams.get('cinemas') || '').split(',').filter(Boolean) as CinemaKey[]
    const genres = (searchParams.get('genres') || '').split(',').filter(Boolean)
    const minYear = parseNum(searchParams.get('minYear'))
    const maxYear = parseNum(searchParams.get('maxYear'))
    const decades = (searchParams.get('decades') || '').split(',').filter(Boolean)
    // Min Letterboxd rating (0–5)
    const minLb = parseNum(searchParams.get('minLb'))
    const debug = (searchParams.get('debug') || '').toLowerCase() === '1'

    // Prefer Postgres if configured; otherwise fall back to local JSON
    let items: Screening[] = []
    let source: 'db' | 'json' = 'json'
    try {
      const dbItems = await getAllListings()
      if (dbItems && Array.isArray(dbItems) && dbItems.length) {
        items = dbItems
        source = 'db'
      }
    } catch (e) {
      console.warn('[API] getAllListings failed; falling back to listings.json')
    }
    if (!items.length) items = Array.isArray(data) ? (data as any) : []
    // Drop any malformed entries lacking a valid start time or title
    items = items.filter(i => i && typeof i.filmTitle === 'string' && typeof i.screeningStart === 'string' && !isNaN(new Date(i.screeningStart).getTime()))

    // Remove obvious non-film events
    items = items.filter(i => !isClearlyNonFilm(i.filmTitle))
    // Hide BFI from frontend (feature-flagged) — default is now visible
    const hideBFI = String(process.env.HIDE_BFI ?? process.env.NEXT_PUBLIC_HIDE_BFI ?? 'false').toLowerCase() === 'true'
    if (hideBFI) items = items.filter(i => i.cinema !== 'bfi')
    items = filterByTimeWindow(items, window)

    if (q) items = items.filter(i => i.filmTitle.toLowerCase().includes(q))
    if (cinemas.length) items = items.filter(i => cinemas.includes(i.cinema))
    if (genres.length) items = items.filter(i => (i.genres || []).some(g => genres.includes(g)))
    if (minYear || maxYear) items = items.filter(i => {
      const y = i.releaseDate ? Number(i.releaseDate.slice(0,4)) : undefined
      if (!y) return false
      if (minYear && y < minYear) return false
      if (maxYear && y > maxYear) return false
      return true
    })
    if (decades.length) {
      const intoRange = (d: string): [number, number] | null => {
        const m = d.match(/^(\d{4})s$/)
        if (!m) return null
        const start = Number(m[1])
        if (!Number.isFinite(start)) return null
        return [start, start + 9]
      }
      const ranges = decades.map(intoRange).filter(Boolean) as [number, number][]
      if (ranges.length) {
        items = items.filter(i => {
          // Prefer the website-stated year for decade filtering when available and plausible,
          // otherwise fall back to enriched releaseDate year.
          const wy = typeof i.websiteYear === 'number' ? i.websiteYear : undefined
          const rd = i.releaseDate ? Number(i.releaseDate.slice(0,4)) : undefined
          const y = wy ?? rd
          if (!y) return false
          return ranges.some(([a,b]) => y >= a && y <= b)
        })
      }
    }
    if (typeof minLb === 'number') {
      // Apply minimum Letterboxd rating using the same 1dp rounding-up as the UI.
      // Unrated counts as 0 for filtering.
      const roundUp1dp = (n: number) => Math.min(5, Math.ceil(n * 10) / 10)
      items = items.filter(i => {
        const raw = (i as any).letterboxdRating
        const eff = (typeof raw === 'number' && Number.isFinite(raw)) ? roundUp1dp(raw) : 0
        return eff >= minLb
      })
    }

    items = items.slice().sort((a,b) => a.screeningStart.localeCompare(b.screeningStart))
    if (debug) return NextResponse.json({ items, source })
    return NextResponse.json({ items })
  } catch (err) {
    console.error('GET /api/listings failed:', err)
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 })
  }
}
