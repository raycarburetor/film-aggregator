import type { Screening, CinemaKey } from '@/types'
import { filterByTimeWindow, parseNum, isClearlyNonFilm } from '@/lib/filters'
import { getAllListings } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import data from '@/data/listings.json'

export type FilterParams = {
  q?: string
  window?: 'today'|'week'|'month'|'all'
  cinemas?: CinemaKey[]
  genres?: string[]
  minYear?: number
  maxYear?: number
  decades?: string[]
  minLb?: number
}

export function filterParamsFromSearchParams(sp: Record<string, string | undefined>): FilterParams {
  const q = (sp.q || '').toLowerCase().trim() || undefined
  const window = (sp.window || 'week') as 'today'|'week'|'month'|'all'
  const cinemas = (sp.cinemas || '').split(',').filter(Boolean) as CinemaKey[]
  const genres = (sp.genres || '').split(',').filter(Boolean)
  const minYear = parseNum(sp.minYear || null)
  const maxYear = parseNum(sp.maxYear || null)
  const decades = (sp.decades || '').split(',').filter(Boolean)
  const minLb = parseNum(sp.minLb || null)
  return { q, window, cinemas, genres, minYear, maxYear, decades, minLb }
}

export async function loadAllListings(): Promise<Screening[]> {
  // Prefer Postgres if configured; fall back to local JSON
  try {
    const dbItems = await getAllListings()
    if (dbItems && Array.isArray(dbItems) && dbItems.length) {
      return normalizeAndSanitize(dbItems)
    }
  } catch (e) {
    // swallow; fall back to JSON
    console.warn('[listings] getAllListings failed; using listings.json')
  }
  const items = Array.isArray(data) ? (data as any as Screening[]) : []
  return normalizeAndSanitize(items)
}

function normalizeAndSanitize(items: Screening[]): Screening[] {
  // Drop any malformed entries lacking a valid start time or title
  let out = items.filter(i => i && typeof i.filmTitle === 'string' && typeof i.screeningStart === 'string' && !isNaN(new Date(i.screeningStart).getTime()))
  // Remove obvious non-film events
  out = out.filter(i => !isClearlyNonFilm(i.filmTitle))
  return out
}

// Cache TTL (seconds). Override via LISTINGS_CACHE_SECONDS; defaults to 300s
const CACHE_SECONDS = (() => {
  const s = process.env.LISTINGS_CACHE_SECONDS
  const n = s ? Number(s) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300
})()

export const loadAllListingsCached = unstable_cache(
  async () => await loadAllListings(),
  ['all_listings'],
  { revalidate: CACHE_SECONDS }
)

export function applyFilters(items: Screening[], params: FilterParams): Screening[] {
  const hideBFI = String(process.env.HIDE_BFI ?? process.env.NEXT_PUBLIC_HIDE_BFI ?? 'false').toLowerCase() === 'true'

  let out = items.slice()

  // Time window (and exclude past screenings)
  out = filterByTimeWindow(out, params.window || 'week')

  // Hide BFI if feature-flagged
  if (hideBFI) out = out.filter(i => i.cinema !== 'bfi')

  // Text search (title or director)
  if (params.q) {
    const q = params.q
    out = out.filter(i => {
      const byTitle = i.filmTitle.toLowerCase().includes(q)
      const dir = (i as any).director
      const byDirector = typeof dir === 'string' ? dir.toLowerCase().includes(q) : false
      return byTitle || byDirector
    })
  }

  // Specific cinemas
  if (params.cinemas && params.cinemas.length) out = out.filter(i => params.cinemas!.includes(i.cinema))

  // Genre intersection
  if (params.genres && params.genres.length) out = out.filter(i => (i.genres || []).some(g => params.genres!.includes(g)))

  // Year range
  if (params.minYear || params.maxYear) {
    const { minYear, maxYear } = params
    out = out.filter(i => {
      const y = i.releaseDate ? Number(i.releaseDate.slice(0,4)) : undefined
      if (!y) return false
      if (minYear && y < minYear) return false
      if (maxYear && y > maxYear) return false
      return true
    })
  }

  // Decades like 1970s,1980s; prefer websiteYear, else releaseDate
  if (params.decades && params.decades.length) {
    const intoRange = (d: string): [number, number] | null => {
      const m = d.match(/^(\d{4})s$/)
      if (!m) return null
      const start = Number(m[1])
      if (!Number.isFinite(start)) return null
      return [start, start + 9]
    }
    const ranges = params.decades.map(intoRange).filter(Boolean) as [number, number][]
    if (ranges.length) {
      out = out.filter(i => {
        const wy = typeof i.websiteYear === 'number' ? i.websiteYear : undefined
        const rd = i.releaseDate ? Number(i.releaseDate.slice(0,4)) : undefined
        const y = wy ?? rd
        if (!y) return false
        return ranges.some(([a,b]) => y >= a && y <= b)
      })
    }
  }

  // Minimum Letterboxd rating with 1dp half-up rounding (unrated counts as 0)
  if (typeof params.minLb === 'number') {
    const round1dp = (n: number) => Math.max(0, Math.min(5, Math.round(n * 10) / 10))
    out = out.filter(i => {
      const raw = (i as any).letterboxdRating
      const eff = (typeof raw === 'number' && Number.isFinite(raw)) ? round1dp(raw) : 0
      return eff >= (params.minLb as number)
    })
  }

  // Sort by start time
  out.sort((a,b) => a.screeningStart.localeCompare(b.screeningStart))
  return out
}

export function getAllGenres(items: Screening[]): string[] {
  return Array.from(new Set(items.flatMap(i => i.genres || []))).sort()
}
