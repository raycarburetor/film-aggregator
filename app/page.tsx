import Filters from '@/components/Filters'
import ListingsTable from '@/components/ListingsTable'
import TimeTabs from '@/components/TimeTabs'

async function fetchListings(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  Object.entries(searchParams).forEach(([k,v]) => {
    if (typeof v === 'string') params.set(k, v)
  })
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/listings?` + params.toString(), { cache: 'no-store' })
  const data = await res.json()
  return data.items as any[]
}

export default async function Page({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const items = await fetchListings(searchParams)
  const allGenres = Array.from(new Set(items.flatMap((i: any) => i.genres || []))).sort()

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
