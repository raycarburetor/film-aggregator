'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
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

  // Start Time slider state (Europe/London minutes since midnight)
  const DEFAULT_START_MIN = 9 * 60
  const DEFAULT_END_MIN = 23 * 60
  const parseHHMM = (s: string | null): number | null => {
    const v = (s || '').trim()
    if (!/^\d{2}:\d{2}$/.test(v)) return null
    const [hh, mm] = v.split(':').map(Number)
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
    return hh * 60 + mm
  }
  const initialMin = parseHHMM(sp.get('startTime')) ?? DEFAULT_START_MIN
  const initialMax = parseHHMM(sp.get('endTime')) ?? DEFAULT_END_MIN
  const [startTimeMin, setStartTimeMin] = useState<number>(initialMin)
  const [startTimeMax, setStartTimeMax] = useState<number>(initialMax)
  // Sync when URL changes
  useEffect(() => {
    const nextMin = parseHHMM(sp.get('startTime')) ?? DEFAULT_START_MIN
    const nextMax = parseHHMM(sp.get('endTime')) ?? DEFAULT_END_MIN
    setStartTimeMin(nextMin)
    setStartTimeMax(nextMax)
  }, [sp])
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef<null | 'min' | 'max'>(null)
  const [dragging, setDragging] = useState<null | 'min' | 'max'>(null)
  const [hoverMin, setHoverMin] = useState(false)
  const [hoverMax, setHoverMax] = useState(false)
  const RANGE_MIN = DEFAULT_START_MIN
  const RANGE_MAX = DEFAULT_END_MIN
  const STEP = 15
  const clamp = (n: number) => Math.max(RANGE_MIN, Math.min(RANGE_MAX, n))
  const snap = (n: number) => {
    const rel = n - RANGE_MIN
    const snapped = Math.round(rel / STEP) * STEP + RANGE_MIN
    return clamp(snapped)
  }
  const ratio = (v: number) => (clamp(v) - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)
  const pct = (v: number) => `${ratio(v) * 100}%`
  const fmt = (v: number) => {
    const h = Math.floor(v / 60)
    const m = v % 60
    const pad = (x: number) => x < 10 ? `0${x}` : String(x)
    return `${pad(h)}:${pad(m)}`
  }
  function pushTimeRange(minVal: number, maxVal: number) {
    const params = new URLSearchParams(sp.toString())
    const toHHMM = (mins: number) => {
      const h = Math.floor(mins / 60)
      const m = mins % 60
      const pad = (n: number) => n < 10 ? `0${n}` : String(n)
      return `${pad(h)}:${pad(m)}`
    }
    if (minVal !== DEFAULT_START_MIN || maxVal !== DEFAULT_END_MIN) {
      params.set('startTime', toHHMM(minVal))
      params.set('endTime', toHHMM(maxVal))
    } else {
      params.delete('startTime'); params.delete('endTime')
    }
    router.push(`/?${params.toString()}`)
  }
  function beginDrag(which: 'min'|'max', clientX: number) {
    setDragging(which)
    draggingRef.current = which
    moveTo(clientX, which)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag, { once: true })
  }
  function onMove(e: PointerEvent) {
    moveTo(e.clientX, draggingRef.current)
  }
  function endDrag() {
    setDragging(null)
    const which = draggingRef.current
    draggingRef.current = null
    window.removeEventListener('pointermove', onMove)
    // Apply on release
    pushTimeRange(startTimeMin, startTimeMax)
  }
  function moveTo(clientX: number, which: 'min'|'max'|null) {
    if (!which) return
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(rect.left, Math.min(rect.right, clientX))
    const rel = (x - rect.left) / rect.width
    let val = RANGE_MIN + rel * (RANGE_MAX - RANGE_MIN)
    val = snap(val)
    if (which === 'min') {
      val = Math.min(val, startTimeMax - STEP)
      setStartTimeMin(clamp(val))
    } else {
      val = Math.max(val, startTimeMin + STEP)
      setStartTimeMax(clamp(val))
    }
  }
  function onTrackPointerDown(e: React.PointerEvent) {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const midMin = ratio(startTimeMin) * rect.width
    const midMax = ratio(startTimeMax) * rect.width
    const pos = e.clientX - rect.left
    const which = Math.abs(pos - midMin) <= Math.abs(pos - midMax) ? 'min' : 'max'
    beginDrag(which, e.clientX)
  }
  const handleKey = (which: 'min'|'max') => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (which === 'min') ? clamp(startTimeMin - STEP) : clamp(startTimeMax - STEP)
      if (which === 'min') setStartTimeMin(Math.min(next, startTimeMax - STEP))
      else setStartTimeMax(Math.max(next, startTimeMin + STEP))
      pushTimeRange(which === 'min' ? Math.min(next, startTimeMax - STEP) : startTimeMin,
                    which === 'min' ? startTimeMax : Math.max(next, startTimeMin + STEP))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (which === 'min') ? clamp(startTimeMin + STEP) : clamp(startTimeMax + STEP)
      if (which === 'min') setStartTimeMin(Math.min(next, startTimeMax - STEP))
      else setStartTimeMax(Math.max(next, startTimeMin + STEP))
      pushTimeRange(which === 'min' ? Math.min(next, startTimeMax - STEP) : startTimeMin,
                    which === 'min' ? startTimeMax : Math.max(next, startTimeMin + STEP))
    }
  }

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
    <div className="inline-block">
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
      {/* Start Time slider beneath tabs (no header) */}
      <div className="mt-2">
        <div>
          <div
            ref={trackRef}
            className="relative h-8 select-none"
            onPointerDown={onTrackPointerDown}
          >
            {/* Full track 09:00 → 23:00 */}
            <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-white/20 rounded" />
            {/* Selected range */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-1 bg-[rgb(var(--hover))] rounded"
              style={{ left: pct(startTimeMin), right: `calc(100% - ${pct(startTimeMax)})` }}
            />
            {/* Left handle */}
            <button
              type="button"
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border shadow cursor-pointer ${hoverMin || dragging==='min' ? 'bg-[rgb(var(--hover))] border-[rgb(var(--hover))]' : 'bg-white border-black/50'}`}
              style={{ left: pct(startTimeMin) }}
              onPointerDown={(e)=> { e.preventDefault(); e.stopPropagation(); (e.currentTarget as any).setPointerCapture?.(e.pointerId); beginDrag('min', e.clientX) }}
              onMouseEnter={()=> setHoverMin(true)}
              onMouseLeave={()=> setHoverMin(false)}
              onPointerEnter={()=> setHoverMin(true)}
              onPointerLeave={()=> setHoverMin(false)}
              onKeyDown={handleKey('min')}
              role="slider"
              aria-label="Earliest start time"
              aria-valuemin={RANGE_MIN}
              aria-valuemax={RANGE_MAX}
              aria-valuenow={startTimeMin}
            />
            {/* Right handle */}
            <button
              type="button"
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border shadow cursor-pointer ${hoverMax || dragging==='max' ? 'bg-[rgb(var(--hover))] border-[rgb(var(--hover))]' : 'bg-white border-black/50'}`}
              style={{ left: pct(startTimeMax) }}
              onPointerDown={(e)=> { e.preventDefault(); e.stopPropagation(); (e.currentTarget as any).setPointerCapture?.(e.pointerId); beginDrag('max', e.clientX) }}
              onMouseEnter={()=> setHoverMax(true)}
              onMouseLeave={()=> setHoverMax(false)}
              onPointerEnter={()=> setHoverMax(true)}
              onPointerLeave={()=> setHoverMax(false)}
              onKeyDown={handleKey('max')}
              role="slider"
              aria-label="Latest start time"
              aria-valuemin={RANGE_MIN}
              aria-valuemax={RANGE_MAX}
              aria-valuenow={startTimeMax}
            />
          </div>
          <div className="mt-1 text-sm text-gray-300">{fmt(startTimeMin)} — {fmt(startTimeMax)}</div>
        </div>
      </div>
    </div>
  )
}
