import Filters from '@/components/Filters'
import ListingsTable from '@/components/ListingsTable'
import TimeTabs from '@/components/TimeTabs'
import { applyFilters, filterParamsFromSearchParams, getAllGenres, loadAllListingsCached } from '@/lib/listings'

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
      <div className="grid gap-4 md:grid-cols-[1fr,280px]">
        <ListingsTable items={items} />
        <Filters genres={allGenres} />
      </div>
    </div>
  )
}
