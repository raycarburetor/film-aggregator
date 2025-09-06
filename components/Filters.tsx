'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export const CINEMAS = [
  { key: 'bfi', label: 'BFI Southbank' },
  { key: 'princecharles', label: 'Prince Charles Cinema' },
  { key: 'ica', label: 'ICA' },
  { key: 'castle', label: 'The Castle Cinema' },
  { key: 'garden', label: 'The Garden Cinema' },
  { key: 'genesis', label: 'Genesis Cinema' },
] as const

export default function Filters({ genres }: { genres: string[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [selectedCinemas, setSelectedCinemas] = useState<string[]>((sp.get('cinemas') || '').split(',').filter(Boolean))
  const initialGenre = (sp.get('genres') || '').split(',').filter(Boolean)[0] || ''
  const [selectedGenre, setSelectedGenre] = useState<string>(initialGenre)
  // Decades: multi-select, newest → oldest chips
  const initialDecades = (sp.get('decades') || '').split(',').filter(Boolean)
  const [selectedDecades, setSelectedDecades] = useState<string[]>(initialDecades)
  // Removed Letterboxd filter from UI

  function apply() {
    // Start from existing params so we preserve the time window selected in TimeTabs
    const params = new URLSearchParams(sp.toString())
    if (q.trim()) params.set('q', q.trim()); else params.delete('q')
    if (selectedCinemas.length) params.set('cinemas', selectedCinemas.join(',')); else params.delete('cinemas')
    if (selectedGenre) params.set('genres', selectedGenre); else params.delete('genres')
    if (selectedDecades.length) params.set('decades', selectedDecades.join(',')); else params.delete('decades')
    // Letterboxd filter removed; ensure any legacy param is cleared
    params.delete('minLb')
    // Also clear legacy year params if present
    params.delete('minYear'); params.delete('maxYear')
    router.push(`/?${params.toString()}`)
  }
  useEffect(() => {
    const t = setTimeout(apply, 200); return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, selectedCinemas, selectedGenre, selectedDecades])

  function toggle(list: string[], value: string, setter: (v: string[])=>void) {
    setter(list.includes(value) ? list.filter(x => x !== value) : [...list, value])
  }

  return (
    <aside className="md:pl-4">
      <div className="p-3 md:p-4 space-y-4">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search for a film..." className="w-full rounded-lg border px-3 py-2" />
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
              <label key={c.key} className="inline-flex items-center gap-2">
                <input type="checkbox" className="cinema-checkbox" checked={selectedCinemas.includes(c.key)} onChange={()=>toggle(selectedCinemas,c.key,setSelectedCinemas)} />
                {c.label}
              </label>
            ))}
          </div>
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
                className={`chip-btn px-3 py-1 text-sm ${selectedDecades.includes(d) ? 'bg-[rgb(var(--hover))] text-white is-selected':''}`}
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
                  className={`chip-btn px-3 py-1 text-sm ${isSel ? 'bg-[rgb(var(--hover))] text-white is-selected':''}`}
                >{g}</button>
              )
            })}
          </div>
        </div>
        {/* Letterboxd rating filter removed */}
      </div>
    </aside>
  )
}
