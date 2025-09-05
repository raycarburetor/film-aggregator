import { NextRequest, NextResponse } from 'next/server'
import { Screening, CinemaKey } from '@/types'
import { filterByTimeWindow, parseNum } from '@/lib/filters'
import data from '@/data/listings.json'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').toLowerCase().trim()
    const window = (searchParams.get('window') || 'week') as 'today'|'week'|'month'|'all'
    const cinemas = (searchParams.get('cinemas') || '').split(',').filter(Boolean) as CinemaKey[]
    const genres = (searchParams.get('genres') || '').split(',').filter(Boolean)
    const minYear = parseNum(searchParams.get('minYear'))
    const maxYear = parseNum(searchParams.get('maxYear'))
    const minTomato = parseNum(searchParams.get('minTomato'))

    let items: Screening[] = Array.isArray(data) ? (data as any) : []
    // Drop any malformed entries lacking a valid start time or title
    items = items.filter(i => i && typeof i.filmTitle === 'string' && typeof i.screeningStart === 'string' && !isNaN(new Date(i.screeningStart).getTime()))

    items = filterByTimeWindow(items, window)

    if (q) items = items.filter(i => i.filmTitle.toLowerCase().includes(q) || i.cinema.toLowerCase().includes(q))
    if (cinemas.length) items = items.filter(i => cinemas.includes(i.cinema))
    if (genres.length) items = items.filter(i => (i.genres || []).some(g => genres.includes(g)))
    if (minYear || maxYear) items = items.filter(i => {
      const y = i.releaseDate ? Number(i.releaseDate.slice(0,4)) : undefined
      if (!y) return false
      if (minYear && y < minYear) return false
      if (maxYear && y > maxYear) return false
      return true
    })
    if (typeof minTomato === 'number') items = items.filter(i => (i.rottenTomatoesPct ?? 0) >= minTomato)

    items = items.slice().sort((a,b) => a.screeningStart.localeCompare(b.screeningStart))
    return NextResponse.json({ items })
  } catch (err) {
    console.error('GET /api/listings failed:', err)
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 })
  }
}
