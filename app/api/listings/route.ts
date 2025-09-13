import { NextRequest, NextResponse } from 'next/server'
import { Screening } from '@/types'
import { applyFilters, filterParamsFromSearchParams, loadAllListings } from '@/lib/listings'

// Ensure Node.js runtime so the 'pg' driver works
export const runtime = 'nodejs'
// This route parses `request.url`; mark dynamic to avoid static render attempts
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const params = filterParamsFromSearchParams({
      q: searchParams.get('q') || undefined,
      window: searchParams.get('window') || undefined,
      cinemas: searchParams.get('cinemas') || undefined,
      genres: searchParams.get('genres') || undefined,
      minYear: searchParams.get('minYear') || undefined,
      maxYear: searchParams.get('maxYear') || undefined,
      decades: searchParams.get('decades') || undefined,
      minLb: searchParams.get('minLb') || undefined,
      start: searchParams.get('start') || undefined,
      end: searchParams.get('end') || undefined,
      startTime: searchParams.get('startTime') || undefined,
      endTime: searchParams.get('endTime') || undefined,
    })
    const debug = (searchParams.get('debug') || '').toLowerCase() === '1'

    // Load everything once; filter in-process
    const all = await loadAllListings()
    const items: Screening[] = applyFilters(all, params)
    if (debug) return NextResponse.json({ items, source: 'auto' })
    return NextResponse.json({ items })
  } catch (err) {
    console.error('GET /api/listings failed:', err)
    return NextResponse.json({ error: 'Failed to load listings' }, { status: 500 })
  }
}
