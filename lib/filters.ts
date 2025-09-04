import { Screening } from '@/types'

export function startOfDayISO(d = new Date()) {
  const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString()
}
export function addDaysISO(d: Date, days: number) {
  const x = new Date(d); x.setDate(x.getDate()+days); return x.toISOString()
}
export function addMonthsISO(d: Date, months: number) {
  const x = new Date(d); x.setMonth(x.getMonth()+months); return x.toISOString()
}
export function filterByTimeWindow(items: Screening[], window: 'today'|'week'|'month'|'all') {
  // Always exclude past screenings relative to now; "all" means all upcoming
  const now = new Date()
  const start = now
  if (window==='all') return items.filter(i => new Date(i.screeningStart) >= start)
  let end: Date
  if (window==='today') {
    const sod = new Date(startOfDayISO(now))
    end = new Date(addDaysISO(sod, 1))
  } else if (window==='week') {
    const sod = new Date(startOfDayISO(now))
    end = new Date(addDaysISO(sod, 7))
  } else {
    const sod = new Date(startOfDayISO(now))
    end = new Date(addMonthsISO(sod, 1))
  }
  return items.filter(i => {
    const t = new Date(i.screeningStart)
    if (isNaN(t.getTime())) return false
    return t >= start && t < end
  })
}
export function parseNum(s: string | null) {
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}
