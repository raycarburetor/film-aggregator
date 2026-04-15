import Filters from '@/components/Filters'
import WatchlistFilterClient from '@/components/WatchlistFilterClient'
import TimeTabs from '@/components/TimeTabs'
import { applyFilters, filterParamsFromSearchParams, getAllGenres, loadAllListings, loadAllListingsCached } from '@/lib/listings'
import MobileSearch from '@/components/MobileSearch'
import MobileFiltersPanel from '@/components/MobileFiltersPanel'
import type { Screening } from '@/types'

// Force per-request rendering. Without this, Next.js's Full Route Cache can
// cache the rendered RSC payload under the pathname alone (query string
// ignored), causing whichever filtered variant lands in the cache first to
// be served to every user visiting `/`. All API routes set this; the page
// must too.
export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  // Load all listings once. Prefer the cached path; fall back to a direct
  // load if the cached loader throws (e.g. when it refused to cache an empty
  // snapshot after a cold-start transient).
  let all: Screening[]
  try {
    all = await loadAllListingsCached()
  } catch {
    all = await loadAllListings()
  }
  const params = filterParamsFromSearchParams(searchParams)
  const items = applyFilters(all, params)
  // Genres should be a stable list based on all upcoming
  const allGenres = getAllGenres(applyFilters(all, { window: 'all' }))

  return (
    <div className="space-y-4">
      {/* Top controls aligned to left column width */}
      <div className="grid gap-4 md:grid-cols-[1fr,280px] items-start">
        <div className="flex items-center justify-between gap-3">
          <TimeTabs />
          {/* View toggle disabled */}
        </div>
        <div className="hidden md:block" />
        {/* View toggle disabled on mobile */}
      </div>
      {/* Mobile-only controls: search + deferred filters with sticky action */}
      <div className="md:hidden space-y-2">
        <MobileSearch />
        <MobileFiltersPanel genres={allGenres} />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr,280px]">
        <WatchlistFilterClient items={items} />
        <div className="hidden md:block">
          <Filters genres={allGenres} />
        </div>
      </div>
    </div>
  )
}
