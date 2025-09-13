'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { londonDayKey, addDaysISO } from '@/lib/filters'

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
] as const

export default function TimeTabs() {
  const router = useRouter()
  const sp = useSearchParams()
  const dateInputRef = useRef<HTMLInputElement | null>(null)
  const [isHover, setIsHover] = useState(false)
  const start = (sp.get('start') || '').trim()
  const hasCustomDate = !!start
  const current = (sp.get('window') || 'week') as 'today'|'week'|'month'
  const today = useMemo(() => londonDayKey(new Date().toISOString()), [])
  const maxDate = useMemo(() => londonDayKey(addDaysISO(new Date(), 30)), [])
  const inputValue = useMemo(() => (start && start >= today && start <= maxDate) ? start : '', [start, today, maxDate])

  function setWindowTab(tab: string) {
    const params = new URLSearchParams(sp.toString())
    // 'week' is the default; omit the param when selecting it
    if (tab === 'week') params.delete('window')
    else params.set('window', tab)
    // Selecting a time tab should clear custom date range
    params.delete('start'); params.delete('end')
    router.push(`/?${params.toString()}`)
  }

  function setDate(nextStart: string) {
    const params = new URLSearchParams(sp.toString())
    if (nextStart) params.set('start', nextStart); else params.delete('start')
    params.delete('end')
    params.delete('window')
    router.push(`/?${params.toString()}`)
  }

  function openDatePicker() {
    const el = dateInputRef.current as any
    if (!el) return
    try {
      if (typeof el.showPicker === 'function') el.showPicker()
      else {
        dateInputRef.current?.focus()
        dateInputRef.current?.click()
      }
    } catch {
      dateInputRef.current?.focus()
      dateInputRef.current?.click()
    }
  }

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
        {/* Invisible overlay input to trigger the native date picker */}
        <input
          type="date"
          ref={dateInputRef}
          value={inputValue}
          min={today}
          max={maxDate}
          onChange={(e)=> {
            let v = (e.target.value || '').trim()
            if (v && v < today) v = today
            if (v && v > maxDate) v = maxDate
            setDate(v)
          }}
          className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-pointer"
          aria-hidden="true"
          onClick={openDatePicker}
          onFocus={()=> setIsHover(true)}
          onBlur={()=> setIsHover(false)}
          onMouseEnter={()=> setIsHover(true)}
          onMouseLeave={()=> setIsHover(false)}
          onTouchStart={()=> setIsHover(true)}
          onTouchEnd={()=> setIsHover(false)}
        />
        <button
          type="button"
          aria-label="Pick date"
          onClick={openDatePicker}
          aria-selected={hasCustomDate}
          className={`tab-btn tappable hit-44 px-3 py-2 text-base ${hasCustomDate || isHover ? 'bg-[rgb(var(--hover))] text-white':''}`}
        >
          {/* Calendar icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="0" ry="0"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
        </button>
      </div>
    </div>
  )
}
