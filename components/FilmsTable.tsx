'use client'
import React, { useMemo, useState } from 'react'
import type { Screening } from '@/types'

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

function formatTime(iso: string) {
  const d = new Date(iso)
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
  return timeFmt.format(d)
}

function formatDayLabelFromKey(dayKey: string) {
  // dayKey is in YYYY-MM-DD (Europe/London day) from dayKeyFmt
  const d = new Date(dayKey)
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
  return `${weekday}, ${day} ${month}`
}

function displayTitle(title: string): string {
  if (!title) return title
  const original = String(title)
  const fmt = (() => {
    const t = original.toLowerCase()
    if (/(^|[^\d])35\s*mm\b/.test(t) || /\bpresented\s+in\s+35\s*mm\b/.test(t) || /\b(?:on|in)\s+35\s*mm\b/.test(t)) return '35mm'
    if (/(^|[^\d])70\s*mm\b/.test(t) || /\bpresented\s+in\s+70\s*mm\b/.test(t) || /\b(?:on|in)\s+70\s*mm\b/.test(t)) return '70mm'
    return undefined
  })()
  const has4k = (() => {
    const t = original.toLowerCase()
    return /(\b4\s*k\b\s*restoration\b|\brestoration\b\s*(?:in\s*)?\b4\s*k\b|\b4\s*k\b\s*restored\b)/i.test(t)
  })()
  let s = original
  s = s.replace(/^\s*(?:preview|relaxed\s+screening|members'?\s*screening|parent\s*&\s*baby\s*screening)\s*[:\-–—]\s*/i, '')
  s = s.replace(/^\s*(?:parent\s*(?:and|&)?\s*baby|family\s*film\s*club)\s*[:\-–—]\s*/i, '')
  s = s.replace(/^\s*[^:]{0,80}\bscreening\s*[:\-–—]\s*/i, '')
  s = s.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, '')
  s = s.replace(/\s*\(uncut\)\s*$/i, '')
  s = s.replace(/\s*\+\s*(?:post[- ]?screening\s+)?(?:q\s*&\s*a|q\s*and\s*a|qa)(?:[^)]*)?\s*$/i, '')
  s = s.replace(/\s*(?:[-:])?\s*with\s+[^)]*(?:q\s*&\s*a|q\s*and\s*a|qa)\s*$/i, '')
  s = s.replace(/\s*\((?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\)\s*$/i, '')
  s = s.replace(/\s+\b(?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\b\s*$/i, '')
  s = s.replace(/\s*[\[(][^)\]]*(?:anniversary|restoration|remastered|director'?s\s+cut|theatrical\s+cut|preview|q&a|qa|uncut(?:\s+version)?|(?:35|70)\s*mm|[24]k|imax|extended|special\s+edition|double\s+bill|presented\s+in\s+(?:35|70)\s*mm)[^)\]]*[\])]\s*$/i, '')
  s = s.replace(/\s*[:\-–—]\s*(?:classics\s+presented.*|presented\s+by.*|halloween\s+at.*|at\s+genesis.*|soft\s+limit\s+cinema.*|cult\s+classic\s+collective.*|studio\s+screening.*|double\s+bill.*|film\s+festival.*|in\s+(?:35|70)\s*mm.*|on\s+(?:35|70)\s*mm.*)\s*$/i, '')
  s = s.replace(/\s*\b4\s*k\s*restoration\b\s*$/i, '')
  s = s.replace(/\s+uncut\s*$/i, '')
  s = s.replace(/\s{2,}/g, ' ').trim()
  if (fmt && !new RegExp(`\\(${fmt}\\)$`, 'i').test(s)) s += ` (${fmt})`
  if (has4k && !/\(4\s*K\s*Restoration\)$/i.test(s)) s += ' (4K Restoration)'
  return s
}

function fallbackYearFromTitle(title: string): string | undefined {
  if (!title) return undefined
  const s = String(title)
  let m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
  if (m) return m[1]
  m = s.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
  if (m) return m[1]
  m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
  if (m) return m[1]
  return undefined
}

type Group = {
  key: string
  title: string
  year?: string
  director?: string
  synopsis?: string
  genres: string[]
  letterboxd?: number | null
  items: Screening[]
}

export default function FilmsTable({ items }: { items: Screening[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/London' })

  const byDay = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.screeningStart.localeCompare(b.screeningStart))
    const map = new Map<string, Group[]>()
    const temp = new Map<string, Map<string, Group>>()
    for (const i of sorted) {
      const dayKey = dayKeyFmt.format(new Date(i.screeningStart))
      const year = i.releaseDate?.slice(0, 4) || (typeof i.websiteYear === 'number' ? String(i.websiteYear) : undefined) || fallbackYearFromTitle(i.filmTitle)
      const dirKey = (i.director || '').trim().toLowerCase()
      const titleKey = displayTitle(i.filmTitle).toLowerCase()
      const key = dirKey && year ? `d:${dirKey}|y:${year}` : `t:${titleKey}|y:${year || ''}`
      let perDay = temp.get(dayKey)
      if (!perDay) { perDay = new Map(); temp.set(dayKey, perDay) }
      let g = perDay.get(key)
      if (!g) {
        g = {
          key: `${dayKey}|${key}`,
          title: displayTitle(i.filmTitle),
          year,
          director: i.director,
          synopsis: i.synopsis,
          genres: i.genres || [],
          letterboxd: i.letterboxdRating ?? null,
          items: [],
        }
        perDay.set(key, g)
      } else {
        // Prefer richer metadata if available
        if (!g.synopsis && i.synopsis) g.synopsis = i.synopsis
        if (!g.director && i.director) g.director = i.director
        if ((!g.year || g.year === '—') && year) g.year = year
        if (g.genres.length === 0 && i.genres && i.genres.length) g.genres = i.genres
        if ((g.letterboxd == null) && (i.letterboxdRating != null)) g.letterboxd = i.letterboxdRating
        // If titles differ, prefer the longer one (often includes standardized flags)
        const newTitle = displayTitle(i.filmTitle)
        if (newTitle.length > g.title.length) g.title = newTitle
      }
      g.items.push(i)
    }
    for (const [dayKey, perDay] of temp) {
      const groups = Array.from(perDay.values())
      groups.sort((a, b) => {
        // Sort by earliest screening time within group
        const at = a.items.reduce((min, x) => Math.min(min, Date.parse(x.screeningStart)), Number.POSITIVE_INFINITY)
        const bt = b.items.reduce((min, x) => Math.min(min, Date.parse(x.screeningStart)), Number.POSITIVE_INFINITY)
        if (at !== bt) return at - bt
        return a.title.localeCompare(b.title)
      })
      map.set(dayKey, groups)
    }
    // Sort days ascending
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [items])

  return (
    <div className="overflow-x-auto">
      <div className="overflow-visible">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead className="bg-black text-white border-b border-white">
            <tr>
              <th className="px-2 md:px-3 py-2 w-[60%] md:w-[33%]">Film</th>
              <th className="px-2 md:px-3 py-2 hidden md:table-cell md:w-[12%]">Release</th>
              <th className="px-2 md:px-3 py-2 hidden md:table-cell md:w-[20%]">Director</th>
              <th className="px-2 md:px-3 py-2 w-[40%] md:w-[19%] whitespace-nowrap">First&nbsp;Screening</th>
              <th className="px-2 md:px-3 py-2 hidden md:table-cell md:w-[16%]">Letterboxd</th>
            </tr>
          </thead>
          <tbody>
          {byDay.map(([dayKey, groups], dayIdx) => (
            <React.Fragment key={dayKey}>
              <tr>
                <td
                  colSpan={5}
                  className={`px-2 md:px-3 py-[6px] text-center font-normal tracking-wide leading-tight bg-[rgb(var(--hover))] text-white border-t border-white`}
                >
                  {formatDayLabelFromKey(dayKey)}
                </td>
              </tr>
              {groups.map((g) => {
                const earliest = g.items.reduce((min, x) => Math.min(min, Date.parse(x.screeningStart)), Number.POSITIVE_INFINITY)
                const earliestIso = new Date(earliest).toISOString()
                const firstTime = formatTime(earliestIso)
                const isOpen = openKey === g.key
                const lb = typeof g.letterboxd === 'number' ? (Math.round(g.letterboxd * 10) / 10).toFixed(1) : '—'
                // Build cinema -> times map
                const byCinema = new Map<string, Screening[]>()
                for (const it of g.items) {
                  const label = CINEMA_LABELS[it.cinema] ?? it.cinema
                  const arr = byCinema.get(label) || []
                  arr.push(it)
                  byCinema.set(label, arr)
                }
                const cinemaRows = Array.from(byCinema.entries()).map(([label, arr]) => {
                  arr.sort((a, b) => a.screeningStart.localeCompare(b.screeningStart))
                  return { label, arr }
                })
                return (
                  <React.Fragment key={g.key}>
                    <tr className={`peer group ${isOpen ? 'selected-row' : ''}`}>
                      <td className="px-2 md:px-3 py-3 md:py-2 text-left break-words min-w-0 md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">
                        <button onClick={() => setOpenKey(prev => prev === g.key ? null : g.key)} className="no-focus-outline block text-left font-normal underline-offset-2 md:hover:underline md:focus-visible:underline md:active:underline">
                          {g.title}
                        </button>
                      </td>
                      <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 hidden md:table-cell md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{g.year ?? '—'}</td>
                      <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 hidden md:table-cell md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{g.director || 'Unknown'}</td>
                      <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 whitespace-nowrap md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{firstTime}</td>
                      <td className="px-2 md:px-3 py-3 md:py-2 min-w-0 hidden md:table-cell md:group-hover:bg-[rgb(var(--hover))] md:group-hover:text-white">{lb}</td>
                    </tr>
                    {isOpen && (
                      <tr className="details-row">
                        <td colSpan={5} className="px-3 py-3 text-left max-w-full" align="left">
                          <div className="grid gap-3 md:grid-cols-2 text-left">
                            <div>
                              <div className="text-xs text-gray-500">Synopsis</div>
                              <div className="break-words whitespace-normal">{g.synopsis || 'No synopsis available.'}</div>
                              <div className="mt-3">
                                <div className="text-xs text-gray-500 mb-1">Screenings</div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left text-sm">
                                    <tbody>
                                      {cinemaRows.map(({ label, arr }) => (
                                        <tr key={label}>
                                          <td className="py-1 pr-2 align-top whitespace-nowrap">{label}</td>
                                          <td className="py-1">
                                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                                              {arr.map(s => (
                                                s.bookingUrl ? (
                                                  <a key={s.id} href={s.bookingUrl} target="_blank" rel="noopener noreferrer" className="underline">
                                                    {formatTime(s.screeningStart)}
                                                  </a>
                                                ) : (
                                                  <span key={s.id}>{formatTime(s.screeningStart)}</span>
                                                )
                                              ))}
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Genres</div>
                              <div>{(g.genres || []).join(', ') || '—'}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                 </React.Fragment>
               )
             })}
           </React.Fragment>
         ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
