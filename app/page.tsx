import Filters from '@/components/Filters'
import ListingsTable from '@/components/ListingsTable'
import TimeTabs from '@/components/TimeTabs'
import { applyFilters, filterParamsFromSearchParams, getAllGenres, loadAllListingsCached } from '@/lib/listings'
import MobileSearch from '@/components/MobileSearch'

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
      {/* Mobile-only controls: search + collapsible filters */}
      <div className="md:hidden space-y-2">
        <MobileSearch />
        <details className="border">
          <summary className="cursor-pointer select-none px-3 py-2">Filters</summary>
          <div className="border-t">
            <Filters genres={allGenres} hideSearch />
          </div>
        </details>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr,280px]">
        <ListingsTable items={items} />
        <div className="hidden md:block">
          <Filters genres={allGenres} />
        </div>
      </div>
    </div>
  )
}
