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
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' })
  let prevDayKey: string | undefined
  return (
    <div className="overflow-x-auto">
      <div className="overflow-hidden">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-black text-white border-b border-white">
          <tr>
            <th className="px-3 py-2 w-[36%]">Film</th>
            <th className="px-3 py-2 w-[10%]">Release</th>
            <th className="px-3 py-2 w-[20%]">Cinema</th>
            <th className="px-3 py-2 w-[17%]">Date</th>
            <th className="px-3 py-2 w-[17%]">Time</th>
          </tr>
          </thead>
          <tbody>
          {items.map((i, idx) => {
            const { date, time } = formatDateTime(i.screeningStart)
            const isOpen = !!open[i.id]
            const dayKey = dayKeyFmt.format(new Date(i.screeningStart))
            const isNewDay = idx === 0 ? false : dayKey !== prevDayKey
            prevDayKey = dayKey
            return (
              // Use a keyed fragment so React can reconcile reliably
              <React.Fragment key={i.id}>
                {isNewDay && (
                  <tr aria-hidden="true">
                    <td colSpan={5} className="border-t border-white p-0 h-0" />
                  </tr>
                )}
                <tr className={`peer group ${isOpen ? 'selected-row' : 'hover:bg-gray-50'}`}>
                  <td className="px-3 py-2 text-left break-words min-w-0 group-hover:bg-[rgb(var(--hover))] group-hover:text-white" align="left">
                    <button onClick={()=>setOpen(o=>({...o,[i.id]:!o[i.id]}))} className="block text-left font-normal underline-offset-2 hover:underline">
                      {displayTitle(i.filmTitle)}
                    </button>
                  </td>
                  <td className="px-3 py-2 min-w-0 group-hover:bg-[rgb(var(--hover))] group-hover:text-white">{i.websiteYear ?? i.releaseDate?.slice(0,4) ?? fallbackYearFromTitle(i.filmTitle) ?? '—'}</td>
                  <td className="px-3 py-2 min-w-0 group-hover:bg-[rgb(var(--hover))] group-hover:text-white">{CINEMA_LABELS[i.cinema] ?? i.cinema}</td>
                  <td className="px-3 py-2 min-w-0 group-hover:bg-[rgb(var(--hover))] group-hover:text-white">{date}</td>
                  <td className="px-3 py-2 min-w-0 group-hover:bg-[rgb(var(--hover))] group-hover:text-white">{time}</td>
                </tr>
                {isOpen && (
                  <tr className="details-row">
                    <td colSpan={5} className="px-3 py-3 text-left max-w-full" align="left">
                      <div className="grid gap-3 md:grid-cols-3 text-left">
                        <div>
                          <div className="text-xs text-gray-500">Director</div>
                          <div>{i.director || 'Unknown'}</div>
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
