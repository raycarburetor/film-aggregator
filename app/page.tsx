import Filters from '@/components/Filters'
import ListingsTable from '@/components/ListingsTable'
import WatchlistFilterClient from '@/components/WatchlistFilterClient'
import TimeTabs from '@/components/TimeTabs'
import { applyFilters, filterParamsFromSearchParams, getAllGenres, loadAllListingsCached } from '@/lib/listings'
import MobileSearch from '@/components/MobileSearch'
import MobileFiltersPanel from '@/components/MobileFiltersPanel'

export default async function Page({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  // Load all listings once (cached), then filter in-process
  const all = await loadAllListingsCached()
  const params = filterParamsFromSearchParams(searchParams)
  const items = applyFilters(all, params)
  // Genres should be a stable list based on all upcoming
  const allGenres = getAllGenres(applyFilters(all, { window: 'all' }))

  return (
    <div className="space-y-4">
      <TimeTabs />
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
