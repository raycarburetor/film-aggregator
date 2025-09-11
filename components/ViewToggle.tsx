'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export default function ViewToggle() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view = ((sp.get('view') || 'screenings').trim().toLowerCase() === 'films') ? 'films' : 'screenings'

  function setView(next: 'screenings' | 'films') {
    const params = new URLSearchParams(sp.toString())
    if (next === 'screenings') params.delete('view')
    else params.set('view', 'films')
    router.replace(`${pathname}?${params.toString()}` as any)
  }

  return (
    <div className="flex gap-0" role="tablist" aria-label="View">
      <button
        type="button"
        role="tab"
        aria-selected={view === 'films'}
        className={`tab-btn tappable hit-44 px-3 py-2 text-base ${view === 'films' ? 'bg-[rgb(var(--hover))] text-white' : ''}`}
        onClick={() => setView('films')}
      >
        Films
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'screenings'}
        className={`tab-btn tappable hit-44 px-3 py-2 text-base ${view === 'screenings' ? 'bg-[rgb(var(--hover))] text-white' : ''}`}
        onClick={() => setView('screenings')}
      >
        Screenings
      </button>
    </div>
  )
}
