'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export const CINEMAS = [
  { key: 'bfi', label: 'BFI Southbank' },
  { key: 'princecharles', label: 'Prince Charles Cinema' },
  { key: 'ica', label: 'ICA' },
  { key: 'castle', label: 'The Castle Cinema' },
  { key: 'garden', label: 'The Garden Cinema' },
] as const

export default function Filters({ genres }: { genres: string[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [selectedCinemas, setSelectedCinemas] = useState<string[]>((sp.get('cinemas') || '').split(',').filter(Boolean))
  const [selectedGenres, setSelectedGenres] = useState<string[]>((sp.get('genres') || '').split(',').filter(Boolean))
  // Leave year filters empty by default so they are opt-in
  const [minYear, setMinYear] = useState(sp.get('minYear') ?? '')
  const [maxYear, setMaxYear] = useState(sp.get('maxYear') ?? '')
  // Removed Letterboxd filter from UI

  function apply() {
    // Start from existing params so we preserve the time window selected in TimeTabs
    const params = new URLSearchParams(sp.toString())
    if (q.trim()) params.set('q', q.trim()); else params.delete('q')
    if (selectedCinemas.length) params.set('cinemas', selectedCinemas.join(',')); else params.delete('cinemas')
    if (selectedGenres.length) params.set('genres', selectedGenres.join(',')); else params.delete('genres')
    if (minYear) params.set('minYear', minYear); else params.delete('minYear')
    if (maxYear) params.set('maxYear', maxYear); else params.delete('maxYear')
    // Letterboxd filter removed; ensure any legacy param is cleared
    params.delete('minLb')
    router.push(`/?${params.toString()}`)
  }
  useEffect(() => {
    const t = setTimeout(apply, 200); return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selectedCinemas, selectedGenres, minYear, maxYear])

  function toggle(list: string[], value: string, setter: (v: string[])=>void) {
    setter(list.includes(value) ? list.filter(x => x !== value) : [...list, value])
  }

  return (
    <aside className="md:pl-4">
      <div className="p-3 md:p-4 space-y-4">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search film or cinema…" className="w-full rounded-lg border px-3 py-2" />
        <div>
          <div className="text-sm font-normal mb-2">Cinemas</div>
          <div className="flex flex-col gap-2">
            {CINEMAS.filter(c => !((process.env.NEXT_PUBLIC_HIDE_BFI ?? 'true') === 'true' && c.key === 'bfi')).map(c=> (
              <label key={c.key} className="inline-flex items-center gap-2">
                <input type="checkbox" className="cinema-checkbox" checked={selectedCinemas.includes(c.key)} onChange={()=>toggle(selectedCinemas,c.key,setSelectedCinemas)} />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-normal mb-2">Genres</div>
          <div className="flex flex-wrap gap-2">
            {genres.map(g => (
              <button
                key={g}
                onClick={()=>toggle(selectedGenres,g,setSelectedGenres)}
                aria-pressed={selectedGenres.includes(g)}
                className={`chip-btn px-3 py-1 text-sm ${selectedGenres.includes(g) ? 'bg-[rgb(var(--hover))] text-white is-selected':''}`}
              >{g}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-normal">Release year</div>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="number"
              placeholder="From"
              className="w-24 rounded border px-2 py-1"
              value={minYear}
              onChange={e=>setMinYear(e.target.value)}
            />
            <span>to</span>
            <input
              type="number"
              placeholder="To"
              className="w-24 rounded border px-2 py-1"
              value={maxYear}
              onChange={e=>setMaxYear(e.target.value)}
            />
          </div>
        </div>
        {/* Letterboxd rating filter removed */}
      </div>
    </aside>
  )
}
