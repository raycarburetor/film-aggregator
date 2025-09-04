import Filters from '@/components/Filters'
import ListingsTable from '@/components/ListingsTable'
import TimeTabs from '@/components/TimeTabs'
import { headers } from 'next/headers'

async function fetchListings(searchParams: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams()
  Object.entries(searchParams).forEach(([k,v]) => {
    if (typeof v === 'string') params.set(k, v)
  })
  const qs = params.toString()
  // Build absolute URL using incoming request headers (works in dev and prod)
  const h = headers()
  const host = h.get('host') || 'localhost:3000'
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const url = `${proto}://${host}/api/listings${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { cache: 'no-store' })
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
