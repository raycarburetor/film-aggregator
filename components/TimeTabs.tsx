'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { londonDayKey } from '@/lib/filters'

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
] as const

export default function TimeTabs() {
  const router = useRouter()
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const start = (sp.get('start') || '').trim()
  const end = (sp.get('end') || '').trim()
  const hasCustomDate = !!(start || end)
  const current = (sp.get('window') || 'week') as 'today'|'week'|'month'
  const today = useMemo(() => londonDayKey(new Date().toISOString()), [])

  function setWindowTab(tab: string) {
    const params = new URLSearchParams(sp.toString())
    // 'week' is the default; omit the param when selecting it
    if (tab === 'week') params.delete('window')
    else params.set('window', tab)
    // Selecting a time tab should clear custom date range
    params.delete('start'); params.delete('end')
    router.push(`/?${params.toString()}`)
    setOpen(false)
  }

  function setDateRange(nextStart: string, nextEnd: string) {
    const params = new URLSearchParams(sp.toString())
    if (nextStart) params.set('start', nextStart); else params.delete('start')
    if (nextEnd) params.set('end', nextEnd); else params.delete('end')
    params.delete('window')
    router.push(`/?${params.toString()}`)
  }

  // Close popover on outside click
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (open && popRef.current && !popRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  return (
    <div className="flex gap-0 items-start">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setWindowTab(key)}
          aria-selected={!hasCustomDate && current===key}
          className={`tab-btn tappable hit-44 px-3 py-2 text-base ${(!hasCustomDate && current===key) ? 'bg-[rgb(var(--hover))] text-white':''}`}
        >
          {label}
        </button>
      ))}
      <div className="relative">
        <button
          ref={btnRef}
          type="button"
          aria-label="Pick dates"
          onClick={() => setOpen(o => !o)}
          aria-selected={hasCustomDate}
          className={`tab-btn tappable hit-44 px-3 py-2 text-base ${hasCustomDate ? 'bg-[rgb(var(--hover))] text-white':''}`}
        >
          {/* Calendar icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="0" ry="0"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </button>
        {open && (
          <div ref={popRef} className="absolute z-50 mt-2 border bg-black/20 backdrop-blur px-3 py-2" style={{ minWidth: '260px' }}>
            <div className="flex items-center gap-2 w-full">
              <input
                type="date"
                value={start}
                min={today}
                onChange={(e)=> setDateRange(e.target.value && e.target.value < today ? today : e.target.value, end)}
                className="flex-1 min-w-0 rounded-lg border px-3 py-2 bg-transparent"
              />
              <span className="text-gray-400">—</span>
              <input
                type="date"
                value={end}
                min={today}
                onChange={(e)=> setDateRange(start, (e.target.value && e.target.value < today ? today : e.target.value))}
                className="flex-1 min-w-0 rounded-lg border px-3 py-2 bg-transparent"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
