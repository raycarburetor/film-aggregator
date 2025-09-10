'use client'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

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
  const initialRef = useRef({
    q: sp.get('q') ?? '',
    cinemas: (sp.get('cinemas') || '').split(',').filter(Boolean),
    genre: initialGenre,
    decades: initialDecades,
    minLb: initialMinLb,
  })

  function apply() {
    // Start from existing params so we preserve the time window selected in TimeTabs
    const params = new URLSearchParams(sp.toString())
    if (q.trim()) params.set('q', q.trim()); else params.delete('q')
    if (selectedCinemas.length) params.set('cinemas', selectedCinemas.join(',')); else params.delete('cinemas')
    if (selectedGenre) params.set('genres', selectedGenre); else params.delete('genres')
    if (selectedDecades.length) params.set('decades', selectedDecades.join(',')); else params.delete('decades')
    if (minLb != null) params.set('minLb', String(minLb)); else params.delete('minLb')
    // Also clear legacy year params if present
    params.delete('minYear'); params.delete('maxYear')
    router.push(`/?${params.toString()}`)
  }
  useEffect(() => {
    if (deferApply) {
      const dirty = isDirty()
      const anySel = hasAnySelected()
      onDirtyChange && onDirtyChange(dirty)
      onAnySelectedChange && onAnySelectedChange(anySel)
      return
    }
    const t = setTimeout(apply, 200); return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selectedCinemas, selectedGenre, selectedDecades, minLb, deferApply])

  // When using deferred mode, sync internal state to URL after navigation (e.g., after Save/Clear)
  useEffect(() => {
    if (!deferApply) return
    const nextQ = sp.get('q') ?? ''
    const nextCinemas = (sp.get('cinemas') || '').split(',').filter(Boolean)
    const nextGenre = (sp.get('genres') || '').split(',').filter(Boolean)[0] || ''
    const nextDecades = (sp.get('decades') || '').split(',').filter(Boolean)
    const nextMinLbStr = sp.get('minLb')
    const nextMinLb = nextMinLbStr != null && nextMinLbStr !== '' ? Number(nextMinLbStr) : null

    setQ(nextQ)
    setSelectedCinemas(nextCinemas)
    setSelectedGenre(nextGenre)
    setSelectedDecades(nextDecades)
    setMinLb(Number.isFinite(nextMinLb as any) ? (nextMinLb as number) : null)

    initialRef.current = { q: nextQ, cinemas: nextCinemas, genre: nextGenre, decades: nextDecades, minLb: (Number.isFinite(nextMinLb as any) ? (nextMinLb as number) : null) }
    onDirtyChange && onDirtyChange(false)
    const nextAny = (nextCinemas.length > 0) || !!nextGenre || (nextDecades.length > 0) || (nextMinLb != null)
    onAnySelectedChange && onAnySelectedChange(nextAny)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, deferApply])

  function hasAnySelected(): boolean {
    // Filters only (exclude q)
    return (
      (selectedCinemas.length > 0) ||
      (!!selectedGenre) ||
      (selectedDecades.length > 0) ||
      (minLb != null)
    )
  }

  function isDirty(): boolean {
    const init = initialRef.current
    // Dirty should reflect FILTERS only (exclude q)
    const same =
      (selectedGenre === init.genre) &&
      (minLb === init.minLb) &&
      (selectedDecades.join(',') === init.decades.join(',')) &&
      (selectedCinemas.join(',') === init.cinemas.join(','))
    return !same
  }

  function clearFilters() {
    // Clear all filters AND search query; preserve time window
    const params = new URLSearchParams(sp.toString())
    params.delete('q')
    params.delete('cinemas'); params.delete('genres'); params.delete('decades'); params.delete('minLb'); params.delete('minYear'); params.delete('maxYear')
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
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Cinemas</span>
            {selectedCinemas.length > 0 ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => setSelectedCinemas([])}
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
            {minLb != null ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => setMinLb(null)}
              >clear</button>
            ) : null}
          </div>
          <StarPicker />
        </div>
        <div>
          <div className="text-sm font-normal mb-2 flex items-center justify-between">
            <span>Decades</span>
            {selectedDecades.length > 0 ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={()=> setSelectedDecades([])}
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
            {selectedGenre ? (
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={()=> setSelectedGenre('')}
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
