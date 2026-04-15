import { Screening } from '@/types'

export function addDaysISO(d: Date, days: number) {
  const x = new Date(d); x.setDate(x.getDate()+days); return x.toISOString()
}

// Midnight in Europe/London for a specific calendar day, returned as a Date.
// `daysFromToday` shifts the target day forward by that many London days.
// Handles BST/GMT transitions because we compute the offset at the target
// instant, not at `now`.
function londonMidnight(now: Date, daysFromToday: number): Date {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = key.split('-').map(Number)
  const guessUtc = Date.UTC(y, m - 1, d + daysFromToday, 0, 0, 0)
  const offsetMin = londonOffsetMinutes(new Date(guessUtc))
  return new Date(guessUtc - offsetMin * 60_000)
}

function londonOffsetMinutes(date: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      timeZoneName: 'shortOffset',
    })
    const parts = fmt.formatToParts(date)
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    const m = tz.match(/([+-])(\d{1,2})(?::?(\d{2}))?/)
    if (m) {
      const sign = m[1] === '-' ? -1 : 1
      return sign * (Number(m[2] || 0) * 60 + Number(m[3] || 0))
    }
  } catch {}
  return 0
}

export function filterByTimeWindow(items: Screening[], window: 'today'|'week'|'month'|'all') {
  // Always exclude past screenings relative to now; "all" means all upcoming.
  // Day boundaries are computed in Europe/London so the filter behaves the
  // same on Vercel (UTC runtime) as it does locally.
  const now = new Date()
  const start = now
  if (window==='all') return items.filter(i => new Date(i.screeningStart) >= start)
  let end: Date
  if (window==='today') {
    end = londonMidnight(now, 1)
  } else if (window==='week') {
    end = londonMidnight(now, 7)
  } else {
    // Treat "This Month" as a 30-day rolling horizon from today.
    // Exclusive upper bound at London midnight + 31 days so that the
    // 30th day is included (t < end).
    end = londonMidnight(now, 31)
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

// Get the Europe/London calendar day key (YYYY-MM-DD) for a given ISO datetime
export function londonDayKey(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' })
  const d = new Date(iso)
  return fmt.format(d)
}

// Get minutes since midnight in Europe/London for a given ISO datetime
export function londonMinutesOfDay(iso: string): number {
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' })
  const parts = fmt.formatToParts(d)
  const h = Number(parts.find(p => p.type === 'hour')?.value || '0')
  const m = Number(parts.find(p => p.type === 'minute')?.value || '0')
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// Heuristic filter for non-film events across cinemas
export function isClearlyNonFilm(title: string): boolean {
  if (!title) return false
  const s = String(title).toLowerCase()
  const hasPlusSuffix = /\s\+\s*\S/.test(s)
  const patterns: RegExp[] = [
    /\bindustry\s+panel\b/,
    /\bnetworking\b/,
    /\bpanel\s+discussion\b/,
    /^panel\b/,
    /\bmasterclass\b/,
    /\bworkshop\b/,
    // Only treat book events as non-film when not a film + extras ("Title + ...")
    ...(hasPlusSuffix ? [] : [/\bbook\s+(?:talk|launch|reading)\b/]),
    /\bquiz\b/, // film quiz etc.
    /\bkaraoke\b/,
    /\bstand[- ]?up\b/,
    /\bcomedy\b/,
    /\blive\s+(?:event|on\s+stage|music)\b/,
    /\bmystery\s+movie\b/,
    /\bmarathon\b/,
    /\bsolve[- ]along\b/,
    /\bwftv\b/, // Women in Film & TV networking nights etc.
    /\bwrestling\b/, // pro wrestling events
    /\bpro\s*wrestling\b/,
    /emporium\s+pro\s+wrestling/,
  ]
  return patterns.some((re) => re.test(s))
}
