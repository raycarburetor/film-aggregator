import { NextResponse } from 'next/server'
// Import the scraper directly for a live preview
// Note: this uses Playwright and is intended for local development.
// Relative path from app/api/preview/castle/route.ts to scripts/cinemas/castle.mjs
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – importing ESM .mjs module from TS route
import { fetchCastle } from '../../../../scripts/cinemas/castle.mjs'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await fetchCastle()
    // Keep payload concise while still useful
    const slim = items.map((i) => ({
      id: i.id,
      filmTitle: i.filmTitle,
      cinema: i.cinema,
      screeningStart: i.screeningStart,
      bookingUrl: i.bookingUrl,
    }))
    return NextResponse.json({ count: slim.length, items: slim })
  } catch (err) {
    console.error('[API] /api/preview/castle failed:', err)
    return NextResponse.json({ error: 'Failed to fetch Castle listings' }, { status: 500 })
  }
}

