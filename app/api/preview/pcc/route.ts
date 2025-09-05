import { NextResponse } from 'next/server'
// Import the scraper directly for a live preview
// Note: this uses Playwright and is intended for local development.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – importing ESM .mjs module from TS route
import { fetchPrinceCharles } from '../../../../scripts/cinemas/princecharles.mjs'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await fetchPrinceCharles()
    const slim = items.map((i) => ({
      id: i.id,
      filmTitle: i.filmTitle,
      cinema: i.cinema,
      screeningStart: i.screeningStart,
      bookingUrl: i.bookingUrl,
      websiteYear: (i as any).websiteYear,
    }))
    return NextResponse.json({ count: slim.length, items: slim })
  } catch (err) {
    console.error('[API] /api/preview/pcc failed:', err)
    return NextResponse.json({ error: 'Failed to fetch PCC listings' }, { status: 500 })
  }
}
