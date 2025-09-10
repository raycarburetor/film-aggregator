'use client'

import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Filters, { FiltersHandle } from '@/components/Filters'

function hasAnyAppliedFilters(sp: { get(name: string): string | null }): boolean {
  return [
    'cinemas', 'genres', 'decades', 'minLb', 'minYear', 'maxYear', 'lbUser'
  ].some(k => (sp.get(k) || '').trim().length > 0)
}

export default function MobileFiltersPanel({ genres }: { genres: string[] }) {
  const sp = useSearchParams()
  const [dirty, setDirty] = useState(false)
  const [anySelected, setAnySelected] = useState(false)
  // Recompute on every navigation; use the string signature to avoid stale memoization
  const appliedAny = useMemo(() => hasAnyAppliedFilters(sp), [sp.toString()])
  const filtersRef = useRef<FiltersHandle>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  // Show bar when there are unsaved changes (Apply),
  // otherwise show Clear only when filters are applied and nothing is dirty.
  const showSave = dirty
  const showClear = appliedAny && !dirty
  const showBar = showSave || showClear

  function onSave() {
    filtersRef.current?.apply()
    // collapse drawer after save
    if (detailsRef.current) detailsRef.current.open = false
  }

  function onClear() {
    filtersRef.current?.clearFilters()
    if (detailsRef.current) detailsRef.current.open = false
  }

  return (
    <div className="md:hidden space-y-2">
      <details ref={detailsRef} className={`border ${appliedAny ? 'filters-details--applied' : ''}`}>
        <summary
          className={`filters-summary tappable hit-44 cursor-pointer select-none px-3 py-2 flex items-center gap-2`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={`filters-arrow shrink-0`}
               fill="currentColor" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 10l5 5 5-5z" />
          </svg>
          <span>Filters</span>
        </summary>
        <div className="border-t">
          <Filters
            ref={filtersRef}
            genres={genres}
            hideSearch
            deferApply
            onDirtyChange={setDirty}
            onAnySelectedChange={setAnySelected}
          />
        </div>
      </details>
      {showBar && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
        >
          <button
            type="button"
            onClick={showSave ? onSave : onClear}
            className="tappable hit-44 px-4 py-2 bg-[rgb(var(--hover))] text-white shadow-md"
            aria-label={showSave ? 'Apply Filters' : 'Clear Filters'}
          >
            {showSave ? 'Apply Filters' : 'Clear Filters'}
          </button>
        </div>
      )}
    </div>
  )
}
