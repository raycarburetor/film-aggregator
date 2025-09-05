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
    // Treat "This Month" as a 30-day rolling horizon from today.
    // Use an exclusive upper bound at start-of-day + 31 so that the
    // 30th day is included (t < end).
    const sod = new Date(startOfDayISO(now))
    end = new Date(addDaysISO(sod, 31))
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

// Heuristic filter for non-film events across cinemas
export function isClearlyNonFilm(title: string): boolean {
  if (!title) return false
  const s = String(title).toLowerCase()
  const patterns: RegExp[] = [
    /\bindustry\s+panel\b/,
    /\bnetworking\b/,
    /\bpanel\s+discussion\b/,
    /^panel\b/,
    /\bmasterclass\b/,
    /\bworkshop\b/,
    /\bbook\s+(?:talk|launch|reading)\b/,
    /\bquiz\b/, // film quiz etc.
    /\bkaraoke\b/,
    /\bstand[- ]?up\b/,
    /\bcomedy\b/,
    /\blive\s+(?:event|on\s+stage|music)\b/,
    /\bmystery\s+movie\b/,
    /\bmarathon\b/,
    /\bsolve[- ]along\b/,
    /\bwftv\b/, // Women in Film & TV networking nights etc.
  ]
  return patterns.some((re) => re.test(s))
}
