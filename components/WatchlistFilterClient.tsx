'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import ListingsTable from '@/components/ListingsTable'
import type { Screening } from '@/types'

type CacheEntry = { username: string; ids: number[]; fetchedAt: number }

function storageKey(username: string) { return `lb_watchlist_${username.toLowerCase()}` }

export default function WatchlistFilterClient({ items }: { items: Screening[] }) {
  const sp = useSearchParams()
  const lbUser = (sp.get('lbUser') || '').trim().toLowerCase()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ids, setIds] = useState<number[] | null>(() => {
    if (typeof window === 'undefined') return null
    const u = lbUser
    if (!u) return null
    try {
      const raw = window.sessionStorage.getItem(storageKey(u))
      if (raw) {
        const parsed: CacheEntry = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.ids)) return parsed.ids
      }
    } catch {}
    return null
  })

  useEffect(() => {
    let ignore = false
    async function run() {
      setError(null)
      if (!lbUser) { setIds(null); return }
      // Try sessionStorage first
      try {
        const raw = sessionStorage.getItem(storageKey(lbUser))
        if (raw) {
          const parsed: CacheEntry = JSON.parse(raw)
          if (parsed && Array.isArray(parsed.ids)) {
            setIds(parsed.ids)
            return
          }
        }
      } catch {}

      setLoading(true)
      try {
        const res = await fetch(`/api/letterboxd/watchlist?username=${encodeURIComponent(lbUser)}`, { cache: 'no-store' })
        if (!res.ok) {
          const msg = await safeMessage(res)
          throw new Error(msg || `Request failed (${res.status})`)
        }
        const data = await res.json()
        const got = Array.isArray(data?.ids) ? (data.ids as number[]) : []
        if (!ignore) {
          setIds(got)
          try {
            // Cache once we confirm there is at least one match across ALL upcoming screenings
            // so we don't need to refetch on window toggles.
            const allRes = await fetch('/api/listings?window=all', { cache: 'no-store' })
            const allJson = await allRes.json()
            const allow = new Set(got)
            const allItems: any[] = Array.isArray(allJson?.items) ? allJson.items : []
            const hasAnyAcrossAll = allItems.some(i => typeof i?.tmdbId === 'number' && allow.has(i.tmdbId))
            if (hasAnyAcrossAll) {
              const entry: CacheEntry = { username: lbUser, ids: got, fetchedAt: Date.now() }
              sessionStorage.setItem(storageKey(lbUser), JSON.stringify(entry))
            }
          } catch {}
        }
      } catch (e: any) {
        if (!ignore) setError(e?.message || 'Failed to load watchlist')
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    run()
    return () => { ignore = true }
  }, [lbUser])

  // No need to refetch on time window toggles; filtering recomputes via `filtered` below.

  const filtered = useMemo(() => {
    if (!lbUser || !ids) return items
    const allow = new Set(ids)
    return items.filter(i => typeof i.tmdbId === 'number' && allow.has(i.tmdbId as number))
  }, [items, ids, lbUser])

  // No explicit clear button here; users can clear via Filters

  return (
    <div className="space-y-2">
      {lbUser && (
        <div className="flex items-center border rounded px-3 py-2 bg-black/20">
          <div className="text-sm">
            {loading ? (
              <span>
                Loading watchlist for {lbUser}
                <AnimatedEllipsis />
              </span>
            ) : error ? (
              <span className="text-white">{error}</span>
            ) : ids ? (
              (() => {
                const win = (sp.get('window') || 'week').toLowerCase()
                const suffix = win === 'today' ? 'today' : (win === 'month' ? 'this month' : 'this week')
                return (
                  <span>
                    Filtering by {lbUser}'s watchlist: <span className="text-red-600 font-normal">{filtered.length}</span> screenings {suffix}.
                  </span>
                )
              })()
            ) : (
              <span>Filtering by {lbUser}'s watchlist…</span>
            )}
          </div>
        </div>
      )}
      <ListingsTable items={filtered} />
      {lbUser && !loading && !error && ids && filtered.length === 0 && (() => {
        const win = (sp.get('window') || 'week').toLowerCase()
        let msg = 'No films on your watchlist are showing this week.'
        if (win === 'today') msg = 'No films on your watchlist are showing today.'
        else if (win === 'month') msg = 'No films on your watchlist are showing this month.'
        return <div className="text-sm text-gray-400">{msg}</div>
      })()}
    </div>
  )
}

function AnimatedEllipsis({ interval = 300 }: { interval?: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN(prev => (prev + 1) % 4), interval)
    return () => clearInterval(t)
  }, [interval])
  const dots = '.'.repeat(n)
  return (
    <span aria-hidden="true" className="inline-block align-baseline" style={{ minWidth: '1.2em' }}>{dots}</span>
  )
}

async function safeMessage(res: Response): Promise<string | null> {
  try {
    const t = await res.text()
    try {
      const j = JSON.parse(t)
      if (j && typeof j.error === 'string') return j.error
    } catch {}
    return t.slice(0, 200)
  } catch {
    return null
  }
}
