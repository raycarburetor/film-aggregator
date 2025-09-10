'use client'
import React, { useState } from 'react'

type Item = {
  id: string
  filmTitle: string
  cinema: string
  screeningStart: string
  bookingUrl?: string
  releaseDate?: string
  websiteYear?: number
  director?: string
  synopsis?: string
  genres?: string[]
  rottenTomatoesPct?: number | null
  letterboxdRating?: number | null
}

const CINEMA_LABELS: Record<string, string> = {
  bfi: 'BFI Southbank',
  princecharles: 'Prince Charles Cinema',
  ica: 'ICA',
  castle: 'The Castle Cinema',
  garden: 'The Garden Cinema',
  genesis: 'Genesis Cinema',
  closeup: 'Close-Up',
  barbican: 'Barbican',
  rio: 'Rio Cinema',
  cinelumiere: 'Ciné Lumière',
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  // Deterministic formatting to avoid SSR/CSR mismatches
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Europe/London',
  })
  const parts = dateFmt.formatToParts(d)
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
  const day = parts.find(p => p.type === 'day')?.value ?? ''
  const month = parts.find(p => p.type === 'month')?.value ?? ''
  // Explicit comma to ensure consistent punctuation across environments
  const date = `${weekday}, ${day} ${month}`

  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
  const time = timeFmt.format(d)
  return { date, time }
}

function fallbackYearFromTitle(title: string): string | undefined {
  if (!title) return undefined
  // Only treat as a release-year annotation if in parentheses/brackets or trailing after a dash
  const s = String(title)
  let m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
  if (m) return m[1]
  m = s.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
  if (m) return m[1]
  m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
  if (m) return m[1]
  return undefined
}

function displayTitle(title: string): string {
  if (!title) return title
  const original = String(title)

  // Detect format hints (35mm/70mm) anywhere in the original title
  const fmt = (() => {
    const t = original.toLowerCase()
    if (/(^|[^\d])35\s*mm\b/.test(t) || /\bpresented\s+in\s+35\s*mm\b/.test(t) || /\b(?:on|in)\s+35\s*mm\b/.test(t)) return '35mm'
    if (/(^|[^\d])70\s*mm\b/.test(t) || /\bpresented\s+in\s+70\s*mm\b/.test(t) || /\b(?:on|in)\s+70\s*mm\b/.test(t)) return '70mm'
    return undefined
  })()
  // Detect 4K restoration anywhere in the original title
  const has4k = (() => {
    const t = original.toLowerCase()
    return /(\b4\s*k\b\s*restoration\b|\brestoration\b\s*(?:in\s*)?\b4\s*k\b|\b4\s*k\b\s*restored\b)/i.test(t)
  })()

  let s = original
  // Remove leading marketing prefixes (keep core film title)
  s = s.replace(/^\s*(?:preview|relaxed\s+screening|members'?\s*screening|parent\s*&\s*baby\s*screening)\s*[:\-–—]\s*/i, '')
  // Also strip series/section prefixes like "Parent and Baby:" or "Family Film Club:"
  s = s.replace(/^\s*(?:parent\s*(?:and|&)?\s*baby|family\s*film\s*club)\s*[:\-–—]\s*/i, '')
  // Generic: strip any "* Screening:" prefix at start
  s = s.replace(/^\s*[^:]{0,80}\bscreening\s*[:\-–—]\s*/i, '')
  // Drop trailing parenthetical year e.g. "(1972)"
  s = s.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, '')
  // Drop trailing (Uncut)
  s = s.replace(/\s*\(uncut\)\s*$/i, '')
  // Drop trailing + Q&A / + QA / + Q and A and variants
  s = s.replace(/\s*\+\s*(?:post[- ]?screening\s+)?(?:q\s*&\s*a|q\s*and\s*a|qa)(?:[^)]*)?\s*$/i, '')
  // Drop trailing "with ... Q&A" segments, with or without preceding punctuation
  s = s.replace(/\s*(?:[-:])?\s*with\s+[^)]*(?:q\s*&\s*a|q\s*and\s*a|qa)\s*$/i, '')
  // Drop trailing age ratings (UK/US common): handle parenthesized and standalone tokens safely.
  // 1) Parenthesized rating at the end: e.g., "(PG-13)" or "(12A*)"
  s = s.replace(/\s*\((?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\)\s*$/i, '')
  // 2) Standalone rating preceded by whitespace: e.g., "Title PG-13" or "Title 12A*"
  s = s.replace(/\s+\b(?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\b\s*$/i, '')
  // Drop trailing bracketed marketing qualifiers (includes 35/70mm; we'll re-append standardized suffix)
  s = s.replace(/\s*[\[(][^)\]]*(?:anniversary|restoration|remastered|director'?s\s+cut|theatrical\s+cut|preview|q&a|qa|uncut(?:\s+version)?|(?:35|70)\s*mm|[24]k|imax|extended|special\s+edition|double\s+bill|presented\s+in\s+(?:35|70)\s*mm)[^)\]]*[\])]\s*$/i, '')
  // Drop common marketing suffixes after a hyphen/colon that often include format/series info
  s = s.replace(/\s*[:\-–—]\s*(?:classics\s+presented.*|presented\s+by.*|halloween\s+at.*|at\s+genesis.*|soft\s+limit\s+cinema.*|cult\s+classic\s+collective.*|studio\s+screening.*|double\s+bill.*|film\s+festival.*|in\s+(?:35|70)\s*mm.*|on\s+(?:35|70)\s*mm.*)\s*$/i, '')
  // If a plain "4K restoration" phrase trails, drop it from base (we'll append standardized suffix)
  s = s.replace(/\s*\b4\s*k\s*restoration\b\s*$/i, '')
  // Drop trailing standalone 'Uncut'
  s = s.replace(/\s+uncut\s*$/i, '')
  // Clean extra whitespace
  s = s.replace(/\s{2,}/g, ' ').trim()

  // Append standardized format flag
  if (fmt && !new RegExp(`\\(${fmt}\\)$`, 'i').test(s)) s += ` (${fmt})`
  if (has4k && !/\(4\s*K\s*Restoration\)$/i.test(s)) s += ' (4K Restoration)'
  return s
}

export default function ListingsTable({ items }: { items: Item[] }) {
  // Track a single open row at a time
  const [openId, setOpenId] = useState<string | null>(null)
  const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' })
  let prevDayKey: string | undefined
  return (
    <div className="overflow-x-auto">
      <div className="overflow-visible">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead className="bg-black text-white border-b border-white">
          <tr>
            <th className="px-2 md:px-3 py-2 w-[37%] md:w-[33%]">Film</th>
            <th className="px-2 md:px-3 py-2 hidden md:table-cell md:w-[12%]">Release</th>
            <th className="px-2 md:px-3 py-2 w-[28%] md:w-[16%]">Cinema</th>
            <th className="px-2 md:px-3 py-2 w-[20%] md:w-[14%]">Date</th>
            {/* On mobile, make widths add up to 100% exactly to prevent a right-side gap */}
            <th className="px-1 md:px-3 py-2 w-[15%] md:w-[9%] whitespace-nowrap">Time</th>
            <th className="px-2 md:px-3 py-2 hidden md:table-cell md:w-[16%]">Letterboxd</th>
          </tr>
          </thead>
          <tbody>
          {items.map((i, idx) => {
            const { date, time } = formatDateTime(i.screeningStart)
            const isOpen = openId === i.id
            const dayKey = dayKeyFmt.format(new Date(i.screeningStart))
            const isNewDay = idx === 0 ? false : dayKey !== prevDayKey
            prevDayKey = dayKey
            const relYear = i.releaseDate?.slice(0,4) ?? (typeof i.websiteYear === 'number' ? String(i.websiteYear) : undefined) ?? fallbackYearFromTitle(i.filmTitle)
            const lbRating = typeof i.letterboxdRating === 'number' ? (Math.round(i.letterboxdRating * 10) / 10).toFixed(1) : '—'
            return (
              // Use a keyed fragment so React can reconcile reliably
              <React.Fragment key={i.id}>
                {isNewDay && (
                  <tr aria-hidden="true">
                    <td colSpan={6} className="border-t border-white p-0 h-0" />
                  </tr>
                )}
                <tr className={`peer group ${isOpen ? 'selected-row' : ''}`}>
                  <td className="px-2 md:px-3 py-3 md:py-2 text-left break-words min-w-0 md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white" align="left">
                    <button onClick={()=>setOpenId(prev => prev === i.id ? null : i.id)} className="no-focus-outline block text-left font-normal underline-offset-2 md:hover:underline md:focus-visible:underline md:active:underline">
                      {displayTitle(i.filmTitle)}
                    </button>
                  </td>
                  <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white hidden md:table-cell">{i.releaseDate?.slice(0,4) ?? i.websiteYear ?? fallbackYearFromTitle(i.filmTitle) ?? '—'}</td>
                  <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{CINEMA_LABELS[i.cinema] ?? i.cinema}</td>
                  <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{date}</td>
                  <td className="px-1 md:px-3 py-3 md:py-2 min-w-0 whitespace-nowrap md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{time}</td>
                  <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white hidden md:table-cell">{typeof i.letterboxdRating === 'number' ? (Math.round(i.letterboxdRating * 10) / 10).toFixed(1) : '—'}</td>
                </tr>
                {isOpen && (
                  <tr className="details-row">
                    <td colSpan={6} className="px-3 py-3 text-left max-w-full" align="left">
                      <div className="grid gap-3 md:grid-cols-3 text-left">
                        <div>
                          <div className="text-xs text-gray-500">Director</div>
                          <div>{i.director || 'Unknown'}</div>
                          {/* Mobile-only extra details under Director */}
                          <div className="mt-2 md:hidden space-y-2">
                            <div>
                              <div className="text-xs text-gray-500">Release Year</div>
                              <div>{relYear ?? '—'}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Letterboxd Rating</div>
                              <div>{lbRating}</div>
                            </div>
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-xs text-gray-500">Synopsis</div>
                          <div className="break-words whitespace-normal">{i.synopsis || 'No synopsis available.'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Genres</div>
                          <div>{(i.genres || []).join(', ') || '—'}</div>
                        </div>
                        {i.bookingUrl ? (
                          <div>
                            <a href={i.bookingUrl} target="_blank" className="underline">Book tickets</a>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
