'use client' 
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Ctx = {
  min: number
  max: number
  setRange: (min: number, max: number) => void
  reset: () => void
  defaults: { min: number; max: number }
}

// Full day by default (no filtering)
const DEFAULT_MIN = 0
const DEFAULT_MAX = 23 * 60 + 59

const StartTimeContext = createContext<Ctx | null>(null)

export function StartTimeProvider({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams()
  const [min, setMin] = useState<number>(DEFAULT_MIN)
  const [max, setMax] = useState<number>(DEFAULT_MAX)

  // One-time init from URL if present (for deep-link compatibility)
  useEffect(() => {
    const parseHHMM = (s: string | null): number | null => {
      const v = (s || '').trim()
      if (!/^\d{2}:\d{2}$/.test(v)) return null
      const [hh, mm] = v.split(':').map(Number)
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
      return hh * 60 + mm
    }
    try {
      const sm = parseHHMM(sp.get('startTime'))
      const sx = parseHHMM(sp.get('endTime'))
      if (sm != null || sx != null) {
        setMin(sm != null ? sm : DEFAULT_MIN)
        setMax(sx != null ? sx : DEFAULT_MAX)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<Ctx>(() => ({
    min,
    max,
    setRange: (a: number, b: number) => { setMin(a); setMax(b) },
    reset: () => { setMin(DEFAULT_MIN); setMax(DEFAULT_MAX) },
    defaults: { min: DEFAULT_MIN, max: DEFAULT_MAX },
  }), [min, max])

  return (
    <StartTimeContext.Provider value={value}>{children}</StartTimeContext.Provider>
  )
}

export function useStartTimeFilter(): Ctx {
  const ctx = useContext(StartTimeContext)
  if (!ctx) throw new Error('useStartTimeFilter must be used within StartTimeProvider')
  return ctx
}
