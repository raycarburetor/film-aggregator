'use client'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
// (Date picker moved to TimeTabs)

export const CINEMAS = [
  { key: 'bfi', label: 'BFI Southbank' },
  { key: 'princecharles', label: 'Prince Charles Cinema' },
  { key: 'ica', label: 'ICA' },
  { key: 'castle', label: 'The Castle Cinema' },
  { key: 'garden', label: 'The Garden Cinema' },
  { key: 'genesis', label: 'Genesis Cinema' },
  { key: 'closeup', label: 'Close-Up' },
  { key: 'barbican', label: 'Barbican' },
  { key: 'rio', label: 'Rio Cinema' },
  { key: 'cinelumiere', label: 'Ciné Lumière' },
  { key: 'nickel', label: 'The Nickel' },
] as const

export type FiltersHandle = {
  apply: () => void
  clearFilters: () => void
  isDirty: () => boolean
  hasAnySelected: () => boolean
}

export default forwardRef<FiltersHandle, { genres: string[]; hideSearch?: boolean; deferApply?: boolean; onDirtyChange?: (dirty: boolean) => void; onAnySelectedChange?: (hasAny: boolean) => void }>(function Filters({ genres, hideSearch = false, deferApply = false, onDirtyChange, onAnySelectedChange }, ref) {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [selectedCinemas, setSelectedCinemas] = useState<string[]>((sp.get('cinemas') || '').split(',').filter(Boolean))
  const initialGenre = (sp.get('genres') || '').split(',').filter(Boolean)[0] || ''
  const [selectedGenre, setSelectedGenre] = useState<string>(initialGenre)
  // Decades: multi-select, newest → oldest chips
  const initialDecades = (sp.get('decades') || '').split(',').filter(Boolean)
  const [selectedDecades, setSelectedDecades] = useState<string[]>(initialDecades)
  // Minimum Letterboxd rating (0–5 in 0.5 steps); null = no minimum
  const initialMinLb = useMemo(() => {
    const s = sp.get('minLb')
    if (s == null) return null as number | null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }, [sp])
  const [minLb, setMinLb] = useState<number | null>(initialMinLb)
  // Letterboxd username (client-only watchlist filter)
  const [lbUser, setLbUser] = useState<string>((sp.get('lbUser') || '').trim())
  // Start Time slider (minutes since midnight, Europe/London)
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
  const initialStartTimeMin = parseHHMM(sp.get('startTime')) ?? DEFAULT_START_MIN
  const initialStartTimeMax = parseHHMM(sp.get('endTime')) ?? DEFAULT_END_MIN
  const [startTimeMin, setStartTimeMin] = useState<number>(initialStartTimeMin)
  const [startTimeMax, setStartTimeMax] = useState<number>(initialStartTimeMax)
  const initialRef = useRef({
    q: sp.get('q') ?? '',
    cinemas: (sp.get('cinemas') || '').split(',').filter(Boolean),
    genre: initialGenre,
    decades: initialDecades,
    minLb: initialMinLb,
    lbUser: (sp.get('lbUser') || '').trim(),
    startTimeMin: initialStartTimeMin,
    startTimeMax: initialStartTimeMax,
  })

  function apply() {
    // Start from existing params so we preserve the time window selected in TimeTabs
    const params = new URLSearchParams(sp.toString())
    if (q.trim()) params.set('q', q.trim()); else params.delete('q')
    if (selectedCinemas.length) params.set('cinemas', selectedCinemas.join(',')); else params.delete('cinemas')
    if (selectedGenre) params.set('genres', selectedGenre); else params.delete('genres')
    if (selectedDecades.length) params.set('decades', selectedDecades.join(',')); else params.delete('decades')
    if (minLb != null) params.set('minLb', String(minLb)); else params.delete('minLb')
    // Letterboxd username filter
    if (lbUser.trim()) params.set('lbUser', lbUser.trim().toLowerCase()); else params.delete('lbUser')
    // Start time range (encode only when deviating from defaults)
    const toHHMM = (mins: number) => {
      const h = Math.floor(mins / 60)
      const m = mins % 60
      const pad = (n: number) => n < 10 ? `0${n}` : String(n)
      return `${pad(h)}:${pad(m)}`
    }
    if (startTimeMin !== DEFAULT_START_MIN || startTimeMax !== DEFAULT_END_MIN) {
      params.set('startTime', toHHMM(startTimeMin))
      params.set('endTime', toHHMM(startTimeMax))
    } else {
      params.delete('startTime'); params.delete('endTime')
    }
    // Also clear legacy year params if present
    params.delete('minYear'); params.delete('maxYear')
    router.push(`/?${params.toString()}`)
  }
  // Auto-apply on desktop (non-deferred)
  useEffect(() => {
    if (deferApply) return
    const t = setTimeout(apply, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selectedCinemas, selectedGenre, selectedDecades, minLb, deferApply])

  // Dirty/selected indicators on mobile (deferred), including Letterboxd username changes
  useEffect(() => {
    if (!deferApply) return
    const dirty = isDirty()
    const anySel = hasAnySelected()
    onDirtyChange && onDirtyChange(dirty)
    onAnySelectedChange && onAnySelectedChange(anySel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selectedCinemas, selectedGenre, selectedDecades, minLb, lbUser, startTimeMin, startTimeMax, deferApply])

  // When using deferred mode, sync internal state to URL after navigation (e.g., after Save/Clear)
  useEffect(() => {
    if (!deferApply) return
    const nextQ = sp.get('q') ?? ''
    // Date range now controlled by TimeTabs; ignore here
    const nextCinemas = (sp.get('cinemas') || '').split(',').filter(Boolean)
    const nextGenre = (sp.get('genres') || '').split(',').filter(Boolean)[0] || ''
    const nextDecades = (sp.get('decades') || '').split(',').filter(Boolean)
    const nextMinLbStr = sp.get('minLb')
    const nextMinLb = nextMinLbStr != null && nextMinLbStr !== '' ? Number(nextMinLbStr) : null
    const nextLbUser = (sp.get('lbUser') || '').trim()
    const nextStartTimeMin = parseHHMM(sp.get('startTime')) ?? DEFAULT_START_MIN
    const nextStartTimeMax = parseHHMM(sp.get('endTime')) ?? DEFAULT_END_MIN

    setQ(nextQ)
    setSelectedCinemas(nextCinemas)
    setSelectedGenre(nextGenre)
    setSelectedDecades(nextDecades)
    setMinLb(Number.isFinite(nextMinLb as any) ? (nextMinLb as number) : null)
    setLbUser(nextLbUser)
    setStartTimeMin(nextStartTimeMin)
    setStartTimeMax(nextStartTimeMax)

    initialRef.current = { q: nextQ, cinemas: nextCinemas, genre: nextGenre, decades: nextDecades, minLb: (Number.isFinite(nextMinLb as any) ? (nextMinLb as number) : null), lbUser: nextLbUser, startTimeMin: nextStartTimeMin, startTimeMax: nextStartTimeMax }
    onDirtyChange && onDirtyChange(false)
    const nextAny = !!((nextCinemas.length > 0) || !!nextGenre || (nextDecades.length > 0) || (nextMinLb != null) || (!!nextLbUser) || (nextStartTimeMin !== DEFAULT_START_MIN) || (nextStartTimeMax !== DEFAULT_END_MIN))
    onAnySelectedChange && onAnySelectedChange(nextAny)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, deferApply])

  function hasAnySelected(): boolean {
    // Filters only (exclude q)
    return (
      (selectedCinemas.length > 0) ||
      (!!selectedGenre) ||
      (selectedDecades.length > 0) ||
      (minLb != null) ||
      (!!lbUser.trim()) ||
      (startTimeMin !== DEFAULT_START_MIN) ||
      (startTimeMax !== DEFAULT_END_MIN)
    )
  }

  function isDirty(): boolean {
    const init = initialRef.current
    // Dirty should reflect FILTERS only (exclude q)
    const same =
      (selectedGenre === init.genre) &&
      (minLb === init.minLb) &&
      (selectedDecades.join(',') === init.decades.join(',')) &&
      (selectedCinemas.join(',') === init.cinemas.join(',')) &&
      (lbUser.trim() === (init.lbUser || '').trim()) &&
      (startTimeMin === init.startTimeMin) &&
      (startTimeMax === init.startTimeMax)
    return !same
  }

  function clearFilters() {
    // Clear all filters AND search query; preserve time window
    const params = new URLSearchParams(sp.toString())
    params.delete('q')
    const u = (params.get('lbUser') || '').toLowerCase()
    if (u) {
      try { sessionStorage.removeItem(`lb_watchlist_${u}`) } catch {}
    }
    params.delete('lbUser')
    params.delete('cinemas'); params.delete('genres'); params.delete('decades'); params.delete('minLb'); params.delete('minYear'); params.delete('maxYear'); params.delete('startTime'); params.delete('endTime')
    router.push(`/?${params.toString()}`)
  }

  useImperativeHandle(ref, () => ({ apply, clearFilters, isDirty, hasAnySelected }))

  function Star({ filledFrac = 0, size = 22 }: { filledFrac?: number; size?: number }) {
    // Clamp 0..1
    const f = Math.max(0, Math.min(1, filledFrac))
    const px = `${size}px`
    return (
      <span className="relative inline-block align-middle" style={{ width: px, height: px }}>
        {/* Base star outline (white stroke) */}
        <svg viewBox="0 0 24 24" width={size} height={size} className="absolute top-0 left-0">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="none" stroke="white" strokeWidth="1.5" />
        </svg>
        {/* Filled portion: red fill + red stroke, clipped to fraction */}
        <span className="absolute top-0 left-0 overflow-hidden" style={{ width: `${f * 100}%`, height: px }}>
          <svg viewBox="0 0 24 24" width={size} height={size}>
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="#dc2626" />
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" fill="none" stroke="#dc2626" strokeWidth="1.5" />
          </svg>
        </span>
      </span>
    )
  }

  function StarPicker() {
    const [hover, setHover] = useState<number | null>(null)
    const display = hover != null ? hover : (minLb ?? 0)
    // Compute per-star fill fraction based on display value
    const fills = [1,2,3,4,5].map(i => Math.max(0, Math.min(1, display - (i-1))))
    function setVal(v: number | null) { setMinLb(v) }
    return (
      <div onMouseLeave={() => setHover(null)} className="flex items-center gap-1 select-none">
        {fills.map((frac, idx) => {
          const starIndex = idx + 1
          return (
            <span key={starIndex} className="relative" style={{ lineHeight: 0 }}>
              <Star filledFrac={frac} />
              {/* Left half */}
              <button
                type="button"
                aria-label={`${starIndex - 0.5} stars minimum`}
                className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
                onMouseEnter={() => setHover(starIndex - 0.5)}
                onFocus={() => setHover(starIndex - 0.5)}
                onClick={() => setVal(starIndex - 0.5)}
              />
              {/* Right half */}
              <button
                type="button"
                aria-label={`${starIndex} stars minimum`}
                className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
                onMouseEnter={() => setHover(starIndex)}
                onFocus={() => setHover(starIndex)}
                onClick={() => setVal(starIndex)}
              />
            </span>
          )
        })}
      </div>
    )
  }

  function toggle(list: string[], value: string, setter: (v: string[])=>void) {
    setter(list.includes(value) ? list.filter(x => x !== value) : [...list, value])
  }

  return (
    <aside className="md:pl-4">
      <div className="p-3 md:p-4 space-y-4">
        {!hideSearch && (
          <input
            type="search"
            value={q}
            onChange={e=>setQ(e.target.value)}
            placeholder="Search by film or director"
            className="w-full rounded-lg border px-3 py-2"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
          />
        )}
        

        {/* Date picker moved into TimeTabs calendar icon */}
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Letterboxd Watchlist</span>
            {(lbUser.trim() || (sp.get('lbUser') || '').trim()) ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => { setLbUser(''); /* apply immediately to remove */ const p = new URLSearchParams(sp.toString()); p.delete('lbUser'); try { sessionStorage.removeItem(`lb_watchlist_${(sp.get('lbUser')||'').toLowerCase()}`) } catch {}; router.push(`/?${p.toString()}`) }}
              >clear</button>
            ) : null}
          </div>
          <div className="relative">
            <input
              type="text"
              value={lbUser}
              onChange={e=>setLbUser(e.target.value)}
              onKeyDown={e=>{ if (e.key === 'Enter') { if (!deferApply) apply(); else e.preventDefault(); } }}
              placeholder="Enter username"
              className="w-full rounded-lg border pl-3 pr-10 py-2"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
            />
            <button
              type="button"
              aria-label="Apply Letterboxd watchlist filter"
              className="hidden md:inline-flex items-center justify-center text-white absolute right-2 top-1/2 -translate-y-1/2"
              onClick={apply}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
            </button>
          </div>
        </div>
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Cinemas</span>
            {(selectedCinemas.length > 0 || (sp.get('cinemas')||'').trim()) ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => {
                  setSelectedCinemas([])
                  const params = new URLSearchParams(sp.toString())
                  params.delete('cinemas')
                  router.push(`/?${params.toString()}`)
                }}
              >clear</button>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            {CINEMAS
              .filter(c => !((process.env.NEXT_PUBLIC_HIDE_BFI ?? 'true') === 'true' && c.key === 'bfi'))
              .slice()
              .sort((a,b) => {
                const norm = (s: string) => s.replace(/^\s*the\s+/i, '').toLowerCase()
                return norm(a.label).localeCompare(norm(b.label))
              })
              .map(c=> (
              <div key={c.key} className="inline-flex items-center gap-2">
                <input
                  id={`cin-${c.key}`}
                  type="checkbox"
                  className="cinema-checkbox"
                  checked={selectedCinemas.includes(c.key)}
                  onChange={()=>toggle(selectedCinemas,c.key,setSelectedCinemas)}
                />
                <span className="select-none">{c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Minimum Letterboxd Rating</span>
            {(minLb != null || (sp.get('minLb')||'').trim()) ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => {
                  setMinLb(null)
                  const params = new URLSearchParams(sp.toString())
                  params.delete('minLb')
                  router.push(`/?${params.toString()}`)
                }}
              >clear</button>
            ) : null}
          </div>
          <StarPicker />
        </div>
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Decades</span>
            {(selectedDecades.length > 0 || (sp.get('decades')||'').trim()) ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={()=> {
                  setSelectedDecades([])
                  const params = new URLSearchParams(sp.toString())
                  params.delete('decades')
                  router.push(`/?${params.toString()}`)
                }}
              >clear</button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {(() => {
              const now = new Date()
              const currentDecade = Math.floor(now.getFullYear() / 10) * 10
              const list: string[] = []
              for (let y = currentDecade; y >= 1900; y -= 10) list.push(`${y}s`)
              return list
            })().map(d => (
              <button
                key={d}
                onClick={() => setSelectedDecades(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                aria-pressed={selectedDecades.includes(d)}
                className={`chip-btn tappable px-3 py-1 text-sm ${selectedDecades.includes(d) ? 'bg-[rgb(var(--hover))] text-white is-selected':''}`}
              >{d}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Genres</span>
            {(!!selectedGenre || (sp.get('genres')||'').trim()) ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={()=> {
                  setSelectedGenre('')
                  const params = new URLSearchParams(sp.toString())
                  params.delete('genres')
                  router.push(`/?${params.toString()}`)
                }}
              >clear</button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {genres.map(g => {
              const isSel = selectedGenre === g
              return (
                <button
                  key={g}
                  onClick={()=> setSelectedGenre(isSel ? '' : g)}
                  aria-pressed={isSel}
                  className={`chip-btn tappable px-3 py-1 text-sm ${isSel ? 'bg-[rgb(var(--hover))] text-white is-selected':''}`}
                >{g}</button>
              )
            })}
          </div>
        </div>
        {/* Letterboxd rating filter removed */}
      </div>
    </aside>
  )
})
