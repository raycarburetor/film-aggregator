import RedesignApp from '@/components/redesign/RedesignApp'
import { applyFilters, loadAllListings, loadAllListingsCached } from '@/lib/listings'
import type { Screening } from '@/types'

export const dynamic = 'force-dynamic'

export default async function Page() {
  let all: Screening[]
  try {
    all = await loadAllListingsCached()
  } catch {
    all = await loadAllListings()
  }
  // Pass all upcoming screenings to the client; client does window + filter logic.
  const upcoming = applyFilters(all, { window: 'all' })
  return <RedesignApp items={upcoming} />
}
