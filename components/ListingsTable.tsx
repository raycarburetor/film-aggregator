'use client'
import React, { useState } from 'react'

type Item = {
  id: string
  filmTitle: string
  cinema: string
  screeningStart: string
  bookingUrl?: string
  releaseDate?: string
  director?: string
  synopsis?: string
  genres?: string[]
  rottenTomatoesPct?: number | null
}

const CINEMA_LABELS: Record<string, string> = {
  bfi: 'BFI Southbank',
  princecharles: 'Prince Charles',
  ica: 'ICA',
  castle: 'The Castle',
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

export default function ListingsTable({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2">Film</th>
            <th className="px-3 py-2">Release</th>
            <th className="px-3 py-2">Cinema</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Rotten Tomatoes</th>
          </tr>
        </thead>
        <tbody>
          {items.map(i => {
            const { date, time } = formatDateTime(i.screeningStart)
            const isOpen = !!open[i.id]
            return (
              // Use a keyed fragment so React can reconcile reliably
              <React.Fragment key={i.id}>
                <tr className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <button onClick={()=>setOpen(o=>({...o,[i.id]:!o[i.id]}))} className="font-medium underline-offset-2 hover:underline">
                      {i.filmTitle}
                    </button>
                  </td>
                  <td className="px-3 py-2">{i.releaseDate?.slice(0,4) ?? '—'}</td>
                  <td className="px-3 py-2">{CINEMA_LABELS[i.cinema] ?? i.cinema}</td>
                  <td className="px-3 py-2">{date}</td>
                  <td className="px-3 py-2">{time}</td>
                  <td className="px-3 py-2">{typeof i.rottenTomatoesPct==='number' ? `${i.rottenTomatoesPct}%` : '—'}</td>
                </tr>
                {isOpen && (
                  <tr className="border-t bg-gray-50/60">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <div className="text-xs text-gray-500">Director</div>
                          <div>{i.director || 'Unknown'}</div>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-xs text-gray-500">Synopsis</div>
                          <div>{i.synopsis || 'No synopsis available.'}</div>
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
  )
}
