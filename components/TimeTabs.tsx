'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { flushSync } from 'react-dom'
import { useStartTimeFilter } from '@/components/StartTimeContext'
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
  const [showDate, setShowDate] = useState(false)
  const dateWrapRef = useRef<HTMLDivElement | null>(null)
  const [isHoverStart, setIsHoverStart] = useState(false)
  const [showStartTimeModal, setShowStartTimeModal] = useState(false)
  const startBtnWrapRef = useRef<HTMLDivElement | null>(null)
  const SHOW_START_TIME_FILTER = false
  const start = (sp.get('start') || '').trim()
  const hasCustomDate = !!start
  const current = (sp.get('window') || 'week') as 'today'|'week'|'month'
  const today = useMemo(() => londonDayKey(new Date().toISOString()), [])
  const maxDate = useMemo(() => londonDayKey(addDaysISO(new Date(), 30)), [])
  const inputValue = useMemo(() => (start && start >= today && start <= maxDate) ? start : '', [start, today, maxDate])
  const baseYMD = inputValue || today
  const [displayYear, setDisplayYear] = useState<number>(() => Number(baseYMD.slice(0,4)))
  const [displayMonth, setDisplayMonth] = useState<number>(() => Number(baseYMD.slice(5,7)) - 1) // 0..11
  useEffect(() => {
    if (!showDate) {
      setDisplayYear(Number(baseYMD.slice(0,4)))
      setDisplayMonth(Number(baseYMD.slice(5,7)) - 1)
    }
  }, [baseYMD, showDate])

  // Start Time slider state (Europe/London minutes since midnight)
  const { min: startTimeMin, max: startTimeMax, setRange, defaults } = useStartTimeFilter()
  const DEFAULT_START_MIN = defaults.min
  const DEFAULT_END_MIN = defaults.max
  const isStartTimeActive = (startTimeMin !== DEFAULT_START_MIN) || (startTimeMax !== DEFAULT_END_MIN)
  // Local UI state for smoother dragging
  const [uiMin, setUiMin] = useState<number>(startTimeMin)
  const [uiMax, setUiMax] = useState<number>(startTimeMax)
  useEffect(() => {
    if (draggingRef.current) return
    setUiMin(startTimeMin)
    setUiMax(startTimeMax)
  }, [startTimeMin, startTimeMax])
  // No URL syncing for start time; context holds source of truth
  const trackRef = useRef<HTMLDivElement | null>(null)
  const minHandleRef = useRef<HTMLButtonElement | null>(null)
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
  // No URL writes for start time; update context only (commit on release)
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
    // Commit final values on release (synchronously to avoid snap-back)
    try { flushSync(() => setRange(uiMin, uiMax)) } catch { setRange(uiMin, uiMax) }
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
      val = Math.min(val, (draggingRef.current ? uiMax : startTimeMax) - STEP)
      const next = clamp(val)
      if (next !== uiMin) setUiMin(next)
    } else {
      val = Math.max(val, (draggingRef.current ? uiMin : startTimeMin) + STEP)
      const next = clamp(val)
      if (next !== uiMax) setUiMax(next)
    }
  }
  function onTrackPointerDown(e: React.PointerEvent) {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const midMin = ratio(uiMin) * rect.width
    const midMax = ratio(uiMax) * rect.width
    const pos = e.clientX - rect.left
    const which = Math.abs(pos - midMin) <= Math.abs(pos - midMax) ? 'min' : 'max'
    beginDrag(which, e.clientX)
  }
  const handleKey = (which: 'min'|'max') => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (which === 'min') ? clamp(uiMin - STEP) : clamp(uiMax - STEP)
      if (which === 'min') { const v = Math.min(next, uiMax - STEP); setUiMin(v) }
      else { const v = Math.max(next, uiMin + STEP); setUiMax(v) }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (which === 'min') ? clamp(uiMin + STEP) : clamp(uiMax + STEP)
      if (which === 'min') { const v = Math.min(next, uiMax - STEP); setUiMin(v) }
      else { const v = Math.max(next, uiMin + STEP); setUiMax(v) }
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

  function openDatePicker() { setShowDate(v => !v) }
  useEffect(() => {
    if (!showDate) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowDate(false) }
    const onDown = (e: MouseEvent) => { if (!dateWrapRef.current) return; if (!dateWrapRef.current.contains(e.target as Node)) setShowDate(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [showDate])

  function ymToLabel(y: number, m0: number) {
    const d = new Date(Date.UTC(y, m0, 1))
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  }
  function daysInMonth(y: number, m0: number) { return new Date(y, m0+1, 0).getDate() }
  function toYMD(y: number, m0: number, d: number) {
    const mm = String(m0+1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    return `${y}-${mm}-${dd}`
  }
  const disableBefore = today
  const disableAfter = maxDate

  function openStartTime() {
    setShowStartTimeModal(v => !v)
  }
  useEffect(() => {
    if (!showStartTimeModal) return
    const t = setTimeout(() => { try { minHandleRef.current?.focus() } catch {} }, 0)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowStartTimeModal(false) }
    const onDown = (e: MouseEvent) => {
      const wrap = startBtnWrapRef.current
      if (!wrap) return
      if (!wrap.contains(e.target as Node)) setShowStartTimeModal(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [showStartTimeModal])

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
        <div className="relative" ref={dateWrapRef}>
          <button
            type="button"
            aria-label="Pick date"
            onClick={openDatePicker}
            aria-selected={hasCustomDate}
            onMouseEnter={()=> setIsHover(true)}
            onMouseLeave={()=> setIsHover(false)}
            onFocus={()=> setIsHover(true)}
            onBlur={()=> setIsHover(false)}
            className={`tab-btn tappable hit-44 px-3 py-2 text-base ${hasCustomDate || isHover || showDate ? 'bg-[rgb(var(--hover))] text-white':''}`}
            >
            {/* Calendar icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="0" ry="0"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </button>
          {showDate && (
            <>
              {/* Desktop/Tablet popover */}
              <div className="hidden md:block absolute left-0 top-full mt-2 z-50 w-[min(92vw,320px)] rounded-lg border bg-black p-3 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <button type="button" aria-label="Previous month" className="tappable px-2 py-1" onClick={() => { let y = displayYear, m = displayMonth - 1; if (m < 0) { m = 11; y -= 1 }; setDisplayYear(y); setDisplayMonth(m) }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
                  </button>
                  <div className="text-sm">{ymToLabel(displayYear, displayMonth)}</div>
                  <button type="button" aria-label="Next month" className="tappable px-2 py-1" onClick={() => { let y = displayYear, m = displayMonth + 1; if (m > 11) { m = 0; y += 1 }; setDisplayYear(y); setDisplayMonth(m) }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">{['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => <div key={d}>{d}</div>)}</div>
                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const first = new Date(displayYear, displayMonth, 1)
                    const lead = (first.getDay() + 6) % 7
                    const days = daysInMonth(displayYear, displayMonth)
                    const cells: JSX.Element[] = []
                    for (let i=0; i<lead; i++) cells.push(<div key={`l${i}`} className="h-7" />)
                    for (let d=1; d<=days; d++) {
                      const ymd = toYMD(displayYear, displayMonth, d)
                      const disabled = (ymd < disableBefore) || (ymd > disableAfter)
                      const selected = inputValue && ymd === inputValue
                      cells.push(
                        <button key={ymd} type="button" disabled={disabled} onClick={() => { setDate(ymd); setShowDate(false) }} className={`h-7 w-9 mx-auto rounded text-sm ${disabled ? 'text-gray-500' : 'hover:bg-[rgb(var(--hover))] hover:text-white'} ${selected ? 'bg-[rgb(var(--hover))] text-white' : ''}`}>{d}</button>
                      )
                    }
                    return cells
                  })()}
                </div>
              </div>
              {/* Mobile modal */}
              <div className="md:hidden fixed inset-0 z-[60] flex items-center justify-center">
                <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={() => setShowDate(false)} />
                <div className="relative z-[61] w-[min(92vw,320px)] rounded-lg border bg-black p-3 shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <button type="button" aria-label="Previous month" className="tappable px-2 py-1" onClick={() => { let y = displayYear, m = displayMonth - 1; if (m < 0) { m = 11; y -= 1 }; setDisplayYear(y); setDisplayMonth(m) }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <div className="text-sm">{ymToLabel(displayYear, displayMonth)}</div>
                    <button type="button" aria-label="Next month" className="tappable px-2 py-1" onClick={() => { let y = displayYear, m = displayMonth + 1; if (m > 11) { m = 0; y += 1 }; setDisplayYear(y); setDisplayMonth(m) }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">{['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => <div key={d}>{d}</div>)}</div>
                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const first = new Date(displayYear, displayMonth, 1)
                      const lead = (first.getDay() + 6) % 7
                      const days = daysInMonth(displayYear, displayMonth)
                      const cells: JSX.Element[] = []
                      for (let i=0; i<lead; i++) cells.push(<div key={`l${i}`} className="h-7" />)
                      for (let d=1; d<=days; d++) {
                        const ymd = toYMD(displayYear, displayMonth, d)
                        const disabled = (ymd < disableBefore) || (ymd > disableAfter)
                        const selected = inputValue && ymd === inputValue
                        cells.push(
                          <button key={ymd} type="button" disabled={disabled} onClick={() => { setDate(ymd); setShowDate(false) }} className={`h-7 w-9 mx-auto rounded text-sm ${disabled ? 'text-gray-500' : 'hover:bg-[rgb(var(--hover))] hover:text-white'} ${selected ? 'bg-[rgb(var(--hover))] text-white' : ''}`}>{d}</button>
                        )
                      }
                      return cells
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}
          <div className="sr-only" aria-live="polite">{inputValue ? `Selected ${inputValue}` : 'No date selected'}</div>
        </div>
        {/* Start Time filter toggle (independent of time window tabs) */}
        {SHOW_START_TIME_FILTER && (
        <div className="relative" ref={startBtnWrapRef}>
          <button
            type="button"
            aria-label="Start time filter"
            onClick={openStartTime}
            onFocus={()=> setIsHoverStart(true)}
            onBlur={()=> setIsHoverStart(false)}
            onMouseEnter={()=> setIsHoverStart(true)}
            onMouseLeave={()=> setIsHoverStart(false)}
            onTouchStart={()=> setIsHoverStart(true)}
            onTouchEnd={()=> setIsHoverStart(false)}
            aria-selected={isStartTimeActive || showStartTimeModal}
            className={`tab-btn tappable hit-44 px-3 py-2 text-base ${isStartTimeActive || isHoverStart || showStartTimeModal ? 'bg-[rgb(var(--hover))] text-white':''}`}
          >
            {/* Clock icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <line x1="12" y1="12" x2="12" y2="7"></line>
              <line x1="12" y1="12" x2="16" y2="12"></line>
            </svg>
          </button>
          {showStartTimeModal && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Start time filter"
              className="absolute left-0 top-full mt-2 z-50 w-[min(92vw,560px)] rounded-lg border bg-black p-4 shadow-lg"
            >
              <div className="relative h-8 select-none" ref={trackRef} onPointerDown={onTrackPointerDown}>
                {/* Full track 09:00 → 23:00 */}
                <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 bg-white/20 rounded" />
                {/* Selected range */}
                <div className="absolute top-1/2 -translate-y-1/2 h-1 bg-[rgb(var(--hover))] rounded" style={{ left: pct(uiMin), right: `calc(100% - ${pct(uiMax)})` }} />
                {/* Left handle */}
                <button
                  type="button"
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border shadow cursor-pointer ${hoverMin || dragging==='min' ? 'bg-[rgb(var(--hover))] border-[rgb(var(--hover))]' : 'bg-white border-black/50'}`}
                  style={{ left: pct(uiMin) }}
                  ref={minHandleRef}
                  onPointerDown={(e)=> { e.preventDefault(); e.stopPropagation(); (e.currentTarget as any).setPointerCapture?.(e.pointerId); beginDrag('min', e.clientX) }}
                  onMouseEnter={()=> setHoverMin(true)}
                  onMouseLeave={()=> setHoverMin(false)}
                  onPointerEnter={()=> setHoverMin(true)}
              onPointerLeave={()=> setHoverMin(false)}
              onKeyDown={handleKey('min')}
              onKeyUp={()=> { try { flushSync(() => setRange(uiMin, uiMax)) } catch { setRange(uiMin, uiMax) } }}
              role="slider"
                  aria-label="Earliest start time"
                  aria-valuemin={RANGE_MIN}
                  aria-valuemax={RANGE_MAX}
                  aria-valuenow={uiMin}
                />
                {/* Right handle */}
                <button
                  type="button"
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border shadow cursor-pointer ${hoverMax || dragging==='max' ? 'bg-[rgb(var(--hover))] border-[rgb(var(--hover))]' : 'bg-white border-black/50'}`}
                  style={{ left: pct(uiMax) }}
                  onPointerDown={(e)=> { e.preventDefault(); e.stopPropagation(); (e.currentTarget as any).setPointerCapture?.(e.pointerId); beginDrag('max', e.clientX) }}
                  onMouseEnter={()=> setHoverMax(true)}
                  onMouseLeave={()=> setHoverMax(false)}
                  onPointerEnter={()=> setHoverMax(true)}
              onPointerLeave={()=> setHoverMax(false)}
              onKeyDown={handleKey('max')}
              onKeyUp={()=> { try { flushSync(() => setRange(uiMin, uiMax)) } catch { setRange(uiMin, uiMax) } }}
              role="slider"
                  aria-label="Latest start time"
                  aria-valuemin={RANGE_MIN}
                  aria-valuemax={RANGE_MAX}
                  aria-valuenow={uiMax}
                />
              </div>
              <div className="mt-2 text-sm text-gray-300 text-center">{fmt(uiMin)} — {fmt(uiMax)}</div>
            </div>
          )}
        </div>
        )}
      </div>
      {/* (Popover rendered next to the clock tab above) */}
    </div>
  )
}
