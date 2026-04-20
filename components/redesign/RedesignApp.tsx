'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { CinemaKey, Screening } from '@/types'

const CINEMAS: { key: CinemaKey; label: string }[] = [
  { key: 'bfi', label: 'BFI Southbank' },
  { key: 'princecharles', label: 'Prince Charles Cinema' },
  { key: 'ica', label: 'ICA' },
  { key: 'castle', label: 'The Castle Cinema' },
  { key: 'garden', label: 'The Garden Cinema' },
  { key: 'genesis', label: 'Genesis Cinema' },
  { key: 'closeup', label: 'Close-Up' },
  { key: 'barbican', label: 'Barbican' },
  { key: 'rio', label: 'Rio Cinema' },
  { key: 'cinelumiere', label: 'Ciné Lumière' },
  { key: 'nickel', label: 'The Nickel' },
  { key: 'regentstreet', label: 'Regent Street Cinema' },
]
const CINEMA_LABEL: Record<string, string> = Object.fromEntries(CINEMAS.map(c => [c.key, c.label]))

const TZ = 'Europe/London'
const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const fmtDayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ })
const fmtDayShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ })

function formatTime(iso: string) { return fmtTime.format(new Date(iso)) }
function dayKeyOf(iso: string) { return fmtDayKey.format(new Date(iso)) }
function formatDayShort(k: string) {
  const [y, m, d] = k.split('-').map(Number)
  return fmtDayShort.format(new Date(Date.UTC(y, m - 1, d, 12)))
}
function todayKey() {
  return fmtDayKey.format(new Date())
}
function addDaysKey(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return fmtDayKey.format(d)
}

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

function displayTitle(title: string) {
  if (!title) return title
  let s = String(title)
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
  s = s.replace(/\s*\b4\s*k\s*restoration\b\s*$/i, '')
  s = s.replace(/\s+uncut\s*$/i, '')
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s
}

function detectFormats(title: string): string[] {
  const t = String(title || '').toLowerCase()
  const out: string[] = []
  if (/\b35\s*mm\b/.test(t)) out.push('35mm')
  if (/\b70\s*mm\b/.test(t)) out.push('70mm')
  if (/\b4\s*k\b/.test(t) && /restor/i.test(t)) out.push('4K')
  if (/q\s*&\s*a|q\s*and\s*a\b/.test(t)) out.push('Q&A')
  return out
}

function yearFromItem(i: Screening): number | null {
  if (i.releaseDate) {
    const y = Number(i.releaseDate.slice(0, 4))
    if (Number.isFinite(y)) return y
  }
  if (typeof i.websiteYear === 'number') return i.websiteYear
  return null
}

type Filters = {
  q: string
  window: 'today' | 'week' | 'month'
  customDay: string | null
  cinemas: CinemaKey[]
  genre: string
  decades: string[]
  minLb: number | null
  watchlist: string
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  window: 'week',
  customDay: null,
  cinemas: [],
  genre: '',
  decades: [],
  minLb: null,
  watchlist: '',
}

function applyFilters(items: Screening[], f: Filters): Screening[] {
  const today = todayKey()
  let lo: string = today
  let hi: string | null = null
  if (f.customDay) { lo = f.customDay; hi = f.customDay }
  else if (f.window === 'today') { hi = today }
  else if (f.window === 'week') { hi = addDaysKey(6) }
  else if (f.window === 'month') { hi = addDaysKey(30) }

  const q = (f.q || '').trim().toLowerCase()
  const cinemaSet = new Set(f.cinemas)
  const decadeSet = new Set(f.decades.map(d => Number(d.replace(/\D/g, ''))))

  return items.filter(i => {
    const dk = dayKeyOf(i.screeningStart)
    if (lo && dk < lo) return false
    if (hi && dk > hi) return false
    if (cinemaSet.size > 0 && !cinemaSet.has(i.cinema)) return false
    if (f.genre && !(i.genres || []).includes(f.genre)) return false
    if (f.minLb != null) {
      const r = i.letterboxdRating
      if (r == null || r < f.minLb) return false
    }
    if (decadeSet.size > 0) {
      const y = yearFromItem(i)
      if (y == null) return false
      const dec = Math.floor(y / 10) * 10
      if (!decadeSet.has(dec)) return false
    }
    if (q) {
      const hay = `${i.filmTitle} ${i.director || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/* ----- Small utils ----- */
function useClickOutside(ref: React.RefObject<HTMLElement>, handler: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: MouseEvent) => {
      const el = ref.current
      if (!el) return
      if (!el.contains(e.target as Node)) handler()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handler() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, handler, ref])
}

/* ----- Stars / Rating ----- */
function Stars({ rating, size = 13 }: { rating: number | null; size?: number }) {
  if (rating == null) return <span className="ic-rating ic-rating--empty">— —</span>
  const fills = [1, 2, 3, 4, 5].map(i => Math.max(0, Math.min(1, rating - (i - 1))))
  return (
    <span className="ic-rating">
      <span className="ic-rating__stars" aria-label={`${rating.toFixed(1)} out of 5`}>
        {fills.map((frac, i) => (
          <span key={i} className="ic-rating__star">
            <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
              <path d="M12 2 L14.9 8.63 L22 9.24 L16.54 13.97 L18.18 21 L12 17.27 L5.82 21 L7.46 13.97 L2 9.24 L9.1 8.63 Z" fill="none" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            <span className="ic-rating__fill" style={{ width: `${frac * 100}%` }}>
              <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
                <path d="M12 2 L14.9 8.63 L22 9.24 L16.54 13.97 L18.18 21 L12 17.27 L5.82 21 L7.46 13.97 L2 9.24 L9.1 8.63 Z" fill="var(--ic-accent)" stroke="var(--ic-accent)" strokeWidth="1.2"/>
              </svg>
            </span>
          </span>
        ))}
      </span>
      <span className="ic-rating__num">{rating.toFixed(1)}</span>
    </span>
  )
}

/* ----- Filter chip + popover ----- */
function FilterChip({
  label, value, active, onClick, children, innerRef,
}: {
  label: string
  value: string | null
  active: boolean
  onClick: () => void
  children?: React.ReactNode
  innerRef: React.RefObject<HTMLDivElement>
}) {
  return (
    <div ref={innerRef} style={{ position: 'relative' }}>
      <button type="button" onClick={onClick} className={cx('ic-chip', active && 'ic-chip--active')}>
        <span className="ic-chip__label">{label}</span>
        {value && <span className="ic-chip__value">{value}</span>}
        <svg className="ic-chip__caret" width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true">
          <path d="M0 0L4 5L8 0" stroke="currentColor" strokeWidth="1"/>
        </svg>
      </button>
      {children}
    </div>
  )
}

function Popover({ children, width = 280 }: { children: React.ReactNode; width?: number }) {
  return <div className="ic-popover" style={{ width }}>{children}</div>
}

/* Filter body components — rendered inside both desktop popovers and the mobile sheet. */

type CinemaBodyProps = { value: CinemaKey[]; onChange: (v: CinemaKey[]) => void; availableCounts: Record<string, number> }
function CinemaFilterBody({ value, onChange, availableCounts }: CinemaBodyProps) {
  const sorted = useMemo(
    () => CINEMAS.slice().sort((a, b) => a.label.replace(/^The\s+/i, '').localeCompare(b.label.replace(/^The\s+/i, ''))),
    []
  )
  function toggle(k: CinemaKey) {
    onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k])
  }
  return (
    <>
      <div className="ic-popover__head">
        <span>Cinemas</span>
        {value.length > 0 && <button className="ic-linkbtn" onClick={() => onChange([])}>Clear</button>}
      </div>
      <ul className="ic-checklist">
        {sorted.map(c => {
          const checked = value.includes(c.key)
          const count = availableCounts[c.key] || 0
          return (
            <li key={c.key}>
              <label className="ic-checkrow">
                <input type="checkbox" checked={checked} onChange={() => toggle(c.key)} />
                <span className="ic-check-box" aria-hidden="true" />
                <span className="ic-checkrow__label">{c.label}</span>
                <span className="ic-checkrow__count">{count}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function CinemaFilter(props: CinemaBodyProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const valueLabel =
    props.value.length === 0 ? null :
    props.value.length === 1 ? CINEMA_LABEL[props.value[0]] :
    `${props.value.length} selected`
  return (
    <FilterChip label="Cinema" value={valueLabel} active={props.value.length > 0} onClick={() => setOpen(v => !v)} innerRef={ref}>
      {open && <Popover width={320}><CinemaFilterBody {...props} /></Popover>}
    </FilterChip>
  )
}

type DecadeBodyProps = { value: string[]; onChange: (v: string[]) => void }
function DecadeFilterBody({ value, onChange }: DecadeBodyProps) {
  const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10
  const decades: string[] = []
  for (let y = currentDecade; y >= 1920; y -= 10) decades.push(`${y}s`)
  function toggle(d: string) {
    onChange(value.includes(d) ? value.filter(x => x !== d) : [...value, d])
  }
  return (
    <>
      <div className="ic-popover__head">
        <span>Decade</span>
        {value.length > 0 && <button className="ic-linkbtn" onClick={() => onChange([])}>Clear</button>}
      </div>
      <div className="ic-chipgrid">
        {decades.map(d => (
          <button key={d} onClick={() => toggle(d)} className={cx('ic-sqchip', value.includes(d) && 'is-active')}>{d}</button>
        ))}
      </div>
    </>
  )
}

function DecadeFilter(props: DecadeBodyProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const valueLabel =
    props.value.length === 0 ? null :
    props.value.length <= 2 ? props.value.join(', ') :
    `${props.value.length} selected`
  return (
    <FilterChip label="Decade" value={valueLabel} active={props.value.length > 0} onClick={() => setOpen(v => !v)} innerRef={ref}>
      {open && <Popover width={300}><DecadeFilterBody {...props} /></Popover>}
    </FilterChip>
  )
}

type GenreBodyProps = { value: string; onChange: (v: string) => void; genres: string[] }
function GenreFilterBody({ value, onChange, genres }: GenreBodyProps) {
  return (
    <>
      <div className="ic-popover__head">
        <span>Genre</span>
        {value && <button className="ic-linkbtn" onClick={() => onChange('')}>Clear</button>}
      </div>
      <div className="ic-chipgrid">
        {genres.map(g => (
          <button key={g} onClick={() => onChange(value === g ? '' : g)} className={cx('ic-sqchip', value === g && 'is-active')}>{g}</button>
        ))}
      </div>
    </>
  )
}

function GenreFilter(props: GenreBodyProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  return (
    <FilterChip label="Genre" value={props.value || null} active={!!props.value} onClick={() => setOpen(v => !v)} innerRef={ref}>
      {open && <Popover width={360}><GenreFilterBody {...props} /></Popover>}
    </FilterChip>
  )
}

type RatingBodyProps = { value: number | null; onChange: (v: number | null) => void }
function RatingFilterBody({ value, onChange }: RatingBodyProps) {
  const [hover, setHover] = useState<number | null>(null)
  const display = hover != null ? hover : (value ?? 0)
  const fills = [1, 2, 3, 4, 5].map(i => Math.max(0, Math.min(1, display - (i - 1))))
  return (
    <>
      <div className="ic-popover__head">
        <span>Min. Letterboxd rating</span>
        {value != null && <button className="ic-linkbtn" onClick={() => onChange(null)}>Clear</button>}
      </div>
      <div className="ic-stars" onMouseLeave={() => setHover(null)}>
        {fills.map((frac, idx) => {
          const si = idx + 1
          return (
            <span key={si} className="ic-star">
              <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                <path d="M12 2 L14.9 8.63 L22 9.24 L16.54 13.97 L18.18 21 L12 17.27 L5.82 21 L7.46 13.97 L2 9.24 L9.1 8.63 Z" fill="none" stroke="currentColor" strokeWidth="1"/>
              </svg>
              <span className="ic-star__fill" style={{ width: `${frac * 100}%` }}>
                <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
                  <path d="M12 2 L14.9 8.63 L22 9.24 L16.54 13.97 L18.18 21 L12 17.27 L5.82 21 L7.46 13.97 L2 9.24 L9.1 8.63 Z" fill="var(--ic-accent)" stroke="var(--ic-accent)" strokeWidth="1"/>
                </svg>
              </span>
              <button className="ic-star__hit ic-star__hit--l" aria-label={`${si - 0.5} stars minimum`}
                onMouseEnter={() => setHover(si - 0.5)} onClick={() => onChange(si - 0.5)} />
              <button className="ic-star__hit ic-star__hit--r" aria-label={`${si} stars minimum`}
                onMouseEnter={() => setHover(si)} onClick={() => onChange(si)} />
            </span>
          )
        })}
        <span className="ic-stars__value">{display.toFixed(1)}</span>
      </div>
    </>
  )
}

function RatingFilter(props: RatingBodyProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  return (
    <FilterChip
      label="Rating"
      value={props.value != null ? `${props.value.toFixed(1)}+` : null}
      active={props.value != null}
      onClick={() => setOpen(v => !v)}
      innerRef={ref}
    >
      {open && <Popover width={280}><RatingFilterBody {...props} /></Popover>}
    </FilterChip>
  )
}

type WatchlistBodyProps = { value: string; onChange: (v: string) => void; loading: boolean; error: string | null; onSubmitted?: () => void; autoFocus?: boolean }
function WatchlistFilterBody({ value, onChange, loading, error, onSubmitted, autoFocus }: WatchlistBodyProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  function submit() {
    onChange(draft.trim().toLowerCase())
    onSubmitted?.()
  }
  return (
    <>
      <div className="ic-popover__head">
        <span>Letterboxd watchlist</span>
        {value && <button className="ic-linkbtn" onClick={() => { onChange(''); setDraft('') }}>Clear</button>}
      </div>
      <p className="ic-note">Show only films on a Letterboxd user&apos;s watchlist.</p>
      <div className={cx('ic-input-group', loading && 'is-loading')}>
        <input
          type="text"
          placeholder="username"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={loading}
        />
        <button className="ic-btn" onClick={submit} disabled={loading}>
          {loading ? (
            <>
              <span className="ic-spinner" aria-hidden="true" />
              <span>Loading</span>
            </>
          ) : 'Apply'}
        </button>
      </div>
      {value && loading && (
        <p className="ic-note ic-note--loading" style={{ marginTop: 12, marginBottom: 0 }}>
          <span className="ic-spinner" aria-hidden="true" />
          Loading {value}&apos;s watchlist…
        </p>
      )}
      {value && error && <p className="ic-note" style={{ marginTop: 12, marginBottom: 0, color: 'var(--ic-accent-bright)' }}>{error}</p>}
    </>
  )
}

function WatchlistFilter(props: Omit<WatchlistBodyProps, 'onSubmitted' | 'autoFocus'>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false), open)
  const chipValue = props.value ? (props.loading ? `${props.value} …` : props.error ? `${props.value} (error)` : props.value) : null
  return (
    <FilterChip label="Watchlist" value={chipValue} active={!!props.value} onClick={() => setOpen(v => !v)} innerRef={ref}>
      {open && (
        <Popover width={300}>
          <WatchlistFilterBody {...props} autoFocus onSubmitted={() => setOpen(false)} />
        </Popover>
      )}
    </FilterChip>
  )
}

/* ----- Mobile filter sheet (hidden on desktop via CSS) ----- */
function MobileFilterSheet({
  open, onClose, filters, setFilters,
  availableCounts, genres, watchlistLoading, watchlistError,
}: {
  open: boolean
  onClose: () => void
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>
  availableCounts: Record<string, number>
  genres: string[]
  watchlistLoading: boolean
  watchlistError: string | null
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startT: number; lastY: number; lastT: number; dy: number; active: boolean }>({
    startY: 0, startT: 0, lastY: 0, lastT: 0, dy: 0, active: false,
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const activeCount =
    (filters.cinemas.length ? 1 : 0) +
    (filters.genre ? 1 : 0) +
    (filters.decades.length ? 1 : 0) +
    (filters.minLb != null ? 1 : 0) +
    (filters.watchlist ? 1 : 0)

  function clearAll() {
    setFilters(prev => ({ ...prev, cinemas: [], genre: '', decades: [], minLb: null, watchlist: '' }))
  }

  function onDragStart(e: React.TouchEvent) {
    const t = e.touches[0]
    const now = performance.now()
    dragRef.current = { startY: t.clientY, startT: now, lastY: t.clientY, lastT: now, dy: 0, active: true }
    const panel = panelRef.current
    if (panel) panel.style.transition = 'none'
  }
  function onDragMove(e: React.TouchEvent) {
    if (!dragRef.current.active) return
    const t = e.touches[0]
    const dy = Math.max(0, t.clientY - dragRef.current.startY)
    dragRef.current.dy = dy
    dragRef.current.lastY = t.clientY
    dragRef.current.lastT = performance.now()
    const panel = panelRef.current
    const backdrop = backdropRef.current
    if (panel) panel.style.transform = `translateY(${dy}px)`
    if (backdrop) backdrop.style.opacity = String(Math.max(0.2, 1 - dy / 400))
  }
  function onDragEnd() {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    const panel = panelRef.current
    const backdrop = backdropRef.current
    const { dy, lastT, startT, startY, lastY } = dragRef.current
    const dt = Math.max(1, lastT - startT)
    const velocity = (lastY - startY) / dt
    const shouldClose = dy > 120 || velocity > 0.6
    if (panel) panel.style.transition = 'transform 200ms ease'
    if (backdrop) backdrop.style.transition = 'opacity 200ms ease'
    if (shouldClose) {
      if (panel) panel.style.transform = 'translateY(100%)'
      if (backdrop) backdrop.style.opacity = '0'
      setTimeout(onClose, 200)
    } else {
      if (panel) panel.style.transform = ''
      if (backdrop) backdrop.style.opacity = ''
    }
  }

  return (
    <div className="ic-mobilesheet" role="dialog" aria-modal="true" aria-label="Filters">
      <div ref={backdropRef} className="ic-mobilesheet__backdrop" onClick={onClose} />
      <div ref={panelRef} className="ic-mobilesheet__panel">
        <header
          className="ic-mobilesheet__head"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
        >
          <span className="ic-mobilesheet__grabber" aria-hidden="true" />
          <div className="ic-mobilesheet__head-left">
            <h2 className="ic-mobilesheet__title">Filters</h2>
            {activeCount > 0 && <button className="ic-linkbtn" onClick={clearAll}>Clear all</button>}
          </div>
          <button
            className={cx('ic-mobilesheet__close', activeCount > 0 && 'ic-mobilesheet__close--apply')}
            onClick={onClose}
            aria-label={activeCount > 0 ? 'Apply filters' : 'Close filters'}
          >
            {activeCount > 0 ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="5 12 10 17 19 7" />
              </svg>
            ) : '×'}
          </button>
        </header>
        <div className="ic-mobilesheet__body">
          <section className="ic-mobilesheet__section">
            <WatchlistFilterBody
              value={filters.watchlist}
              onChange={(v) => setFilters(prev => ({ ...prev, watchlist: v }))}
              loading={watchlistLoading}
              error={watchlistError}
            />
          </section>
          <section className="ic-mobilesheet__section">
            <CinemaFilterBody
              value={filters.cinemas}
              onChange={(v) => setFilters(prev => ({ ...prev, cinemas: v }))}
              availableCounts={availableCounts}
            />
          </section>
          <section className="ic-mobilesheet__section">
            <RatingFilterBody
              value={filters.minLb}
              onChange={(v) => setFilters(prev => ({ ...prev, minLb: v }))}
            />
          </section>
          <section className="ic-mobilesheet__section">
            <GenreFilterBody
              value={filters.genre}
              onChange={(v) => setFilters(prev => ({ ...prev, genre: v }))}
              genres={genres}
            />
          </section>
          <section className="ic-mobilesheet__section">
            <DecadeFilterBody
              value={filters.decades}
              onChange={(v) => setFilters(prev => ({ ...prev, decades: v }))}
            />
          </section>
        </div>
      </div>
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ic-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder="Search film or director"
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
      />
      {value && <button className="ic-search__clear" aria-label="Clear search" onClick={() => onChange('')}>×</button>}
    </div>
  )
}

function MiniCalendar({ selected, onPick, onClear, onClose }: { selected: string | null; onPick: (d: string) => void; onClear: () => void; onClose?: () => void }) {
  const today = new Date()
  const [month, setMonth] = useState(selected ? new Date(selected + 'T12:00:00Z') : today)
  const y = month.getFullYear()
  const m = month.getMonth()
  const first = new Date(y, m, 1)
  const lead = (first.getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const tKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const maxKey = (() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 60)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startT: number; lastY: number; lastT: number; dy: number; active: boolean }>({
    startY: 0, startT: 0, lastY: 0, lastT: 0, dy: 0, active: false,
  })
  function onDragStart(e: React.TouchEvent) {
    if (!onClose) return
    const t = e.touches[0]
    const now = performance.now()
    dragRef.current = { startY: t.clientY, startT: now, lastY: t.clientY, lastT: now, dy: 0, active: true }
    const el = rootRef.current
    if (el) el.style.transition = 'none'
  }
  function onDragMove(e: React.TouchEvent) {
    if (!dragRef.current.active) return
    const t = e.touches[0]
    const dy = Math.max(0, t.clientY - dragRef.current.startY)
    dragRef.current.dy = dy
    dragRef.current.lastY = t.clientY
    dragRef.current.lastT = performance.now()
    const el = rootRef.current
    if (el) el.style.transform = `translateY(${dy}px)`
  }
  function onDragEnd() {
    if (!dragRef.current.active) return
    dragRef.current.active = false
    const el = rootRef.current
    const { dy, lastT, startT, startY, lastY } = dragRef.current
    const dt = Math.max(1, lastT - startT)
    const velocity = (lastY - startY) / dt
    const shouldClose = dy > 100 || velocity > 0.6
    if (el) el.style.transition = 'transform 200ms ease'
    if (shouldClose) {
      if (el) el.style.transform = 'translateY(100%)'
      setTimeout(() => onClose?.(), 200)
    } else {
      if (el) el.style.transform = ''
    }
  }

  function cell(d: number) {
    const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const disabled = ymd < tKey || ymd > maxKey
    const isSel = ymd === selected
    const isToday = ymd === tKey
    return (
      <button
        key={ymd}
        disabled={disabled}
        onClick={() => onPick(ymd)}
        className={cx('ic-cal__day', isSel && 'is-selected', isToday && !isSel && 'is-today')}
      >{d}</button>
    )
  }

  return (
    <div ref={rootRef} className="ic-popover ic-cal">
      <div
        className="ic-cal__swipe"
        onTouchStart={onDragStart}
        onTouchMove={onDragMove}
        onTouchEnd={onDragEnd}
        onTouchCancel={onDragEnd}
        aria-hidden="true"
      >
        <span className="ic-cal__grabber" />
      </div>
      <div className="ic-cal__head">
        <button className="ic-cal__nav" onClick={() => setMonth(new Date(y, m - 1, 1))} aria-label="Previous month">‹</button>
        <div className="ic-cal__title">{month.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}</div>
        <button className="ic-cal__nav" onClick={() => setMonth(new Date(y, m + 1, 1))} aria-label="Next month">›</button>
      </div>
      <div className="ic-cal__dow">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="ic-cal__grid">
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => cell(i + 1))}
      </div>
      {selected && (
        <div className="ic-cal__foot">
          <button className="ic-linkbtn" onClick={onClear}>Clear date</button>
        </div>
      )}
    </div>
  )
}

function TimeTabs({ value, onChange, customDay, onPickDay, onClearDay }: {
  value: 'today' | 'week' | 'month'
  onChange: (w: 'today' | 'week' | 'month') => void
  customDay: string | null
  onPickDay: (d: string) => void
  onClearDay: () => void
}) {
  const tabs: { key: 'today' | 'week' | 'month'; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: '7 Days' },
    { key: 'month', label: '30 Days' },
  ]
  const [showCal, setShowCal] = useState(false)
  const calRef = useRef<HTMLDivElement>(null)
  useClickOutside(calRef, () => setShowCal(false), showCal)

  return (
    <div className="ic-tabs">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          aria-selected={!customDay && value === t.key}
          className={cx('ic-tab', (!customDay && value === t.key) && 'is-active')}
        >{t.label}</button>
      ))}
      <div ref={calRef} className="ic-tabs__date">
        <button
          onClick={() => setShowCal(v => !v)}
          aria-selected={!!customDay}
          className={cx('ic-tab', (!!customDay || showCal) && 'is-active')}
          aria-label="Pick a date"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="16" y1="2" x2="16" y2="6" />
          </svg>
          {customDay && <span className="ic-tab__date">{formatDayShort(customDay)}</span>}
        </button>
        {showCal && (
          <MiniCalendar
            selected={customDay}
            onPick={(d) => { onPickDay(d); setShowCal(false) }}
            onClear={() => { onClearDay(); setShowCal(false) }}
            onClose={() => setShowCal(false)}
          />
        )}
      </div>
    </div>
  )
}

/* ----- Film list ----- */
type Group = {
  key: string
  title: string
  year: number | null
  director?: string
  synopsis?: string
  genres: string[]
  letterboxd: number | null
  formats: string[]
  posterPath?: string
  items: Screening[]
}

function FormatBadge({ label }: { label: string }) {
  return <span className={cx('ic-badge', `ic-badge--${label.toLowerCase().replace(/[^a-z0-9]/g, '')}`)}>{label}</span>
}

function FilmRow({ group, isOpen, onToggle }: { group: Group; isOpen: boolean; onToggle: () => void }) {
  const earliestTs = group.items.reduce((m, x) => Math.min(m, Date.parse(x.screeningStart)), Infinity)
  const firstTime = formatTime(new Date(earliestTs).toISOString())
  const cinemaKeys = Array.from(new Set(group.items.map(i => i.cinema)))
  const totalScreenings = group.items.length

  const byCinema = new Map<string, Screening[]>()
  for (const s of group.items) {
    const arr = byCinema.get(s.cinema) || []
    arr.push(s)
    byCinema.set(s.cinema, arr)
  }
  for (const arr of byCinema.values()) arr.sort((a, b) => a.screeningStart.localeCompare(b.screeningStart))
  const cinemaEntries = Array.from(byCinema.entries())

  const posterUrl = group.posterPath ? `https://image.tmdb.org/t/p/w185${group.posterPath}` : null
  const tmdbId = group.items.find(i => typeof i.tmdbId === 'number')?.tmdbId
  const filmUrl = tmdbId ? `https://letterboxd.com/tmdb/${tmdbId}/` : null

  return (
    <article className={cx('ic-film', isOpen && 'is-open')}>
      <button className="ic-film__head" onClick={onToggle} aria-expanded={isOpen}>
        <div
          className="ic-film__poster"
          aria-hidden="true"
          style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
        >
          {!posterUrl && <span className="ic-film__poster-ini">{group.title.charAt(0) || '?'}</span>}
        </div>
        <div className="ic-film__main">
          <div className="ic-film__title-row">
            <h3 className="ic-film__title">
              {group.title}
              {group.year && <span className="ic-film__year">{group.year}</span>}
            </h3>
            {group.formats.length > 0 && (
              <div className="ic-film__badges">
                {group.formats.map(f => <FormatBadge key={f} label={f} />)}
              </div>
            )}
          </div>
          <div className="ic-film__meta">
            {group.director ? (
              <a
                href={`https://letterboxd.com/director/${group.director.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="ic-film__director"
                onClick={(e) => e.stopPropagation()}
              >{group.director}</a>
            ) : (
              <span className="ic-film__director">Unknown director</span>
            )}
            {group.genres.length > 0 && (
              <span className="ic-film__genres">{group.genres.slice(0, 3).join(' · ')}</span>
            )}
          </div>
        </div>
        <div className="ic-film__right">
          {filmUrl ? (
            <a
              href={filmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ic-film__ratinglink"
              onClick={(e) => e.stopPropagation()}
              title="View on Letterboxd"
            >
              <Stars rating={group.letterboxd ?? null} />
            </a>
          ) : (
            <Stars rating={group.letterboxd ?? null} />
          )}
          <div className="ic-film__screenings">
            <span className="ic-film__firsttime">from {firstTime}</span>
            <span className="ic-film__count">
              {totalScreenings} {totalScreenings === 1 ? 'screening' : 'screenings'}
              {' · '}
              {cinemaKeys.length} {cinemaKeys.length === 1 ? 'cinema' : 'cinemas'}
            </span>
          </div>
          <span className="ic-film__chev" aria-hidden="true">
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path d="M0 0L5 6L10 0" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </span>
        </div>
      </button>
      {isOpen && (
        <div className="ic-film__drawer">
          <div className="ic-film__drawer-inner">
            {group.genres.length > 0 && (
              <div className="ic-film__genres-section">
                <div className="ic-label">Genres</div>
                <p>{group.genres.join(' · ')}</p>
              </div>
            )}
            <div className="ic-film__synopsis">
              <div className="ic-label">Synopsis</div>
              <p>{group.synopsis || 'No synopsis available.'}</p>
            </div>
            <div className="ic-film__showtimes">
              <div className="ic-label">Screenings</div>
              <ul className="ic-showlist">
                {cinemaEntries.map(([cinemaKey, arr]) => (
                  <li key={cinemaKey} className="ic-showlist__row">
                    <span className="ic-showlist__cinema">{CINEMA_LABEL[cinemaKey] ?? cinemaKey}</span>
                    <span className="ic-showlist__times">
                      {arr.map(s => (
                        s.bookingUrl ? (
                          <a key={s.id} href={s.bookingUrl} target="_blank" rel="noopener noreferrer" className="ic-time-link">
                            {formatTime(s.screeningStart)}
                          </a>
                        ) : (
                          <span key={s.id} className="ic-time-link is-unavailable">{formatTime(s.screeningStart)}</span>
                        )
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

function groupByDay(items: Screening[]): [string, Group[]][] {
  const sorted = [...items].sort((a, b) => a.screeningStart.localeCompare(b.screeningStart))
  const tempPerDay = new Map<string, Map<string, Group>>()
  for (const i of sorted) {
    const dk = dayKeyOf(i.screeningStart)
    const year = yearFromItem(i)
    const title = displayTitle(i.filmTitle)
    const dirKey = (i.director || '').trim().toLowerCase()
    const key = typeof i.tmdbId === 'number'
      ? `tmdb:${i.tmdbId}`
      : dirKey
        ? `d:${dirKey}|t:${title.toLowerCase()}`
        : `t:${title.toLowerCase()}`
    let perDay = tempPerDay.get(dk)
    if (!perDay) { perDay = new Map(); tempPerDay.set(dk, perDay) }
    let g = perDay.get(key)
    if (!g) {
      g = {
        key: `${dk}|${key}`,
        title,
        year,
        director: i.director,
        synopsis: i.synopsis,
        genres: i.genres || [],
        letterboxd: i.letterboxdRating ?? null,
        formats: detectFormats(i.filmTitle),
        posterPath: i.posterPath,
        items: [],
      }
      perDay.set(key, g)
    } else {
      if (!g.synopsis && i.synopsis) g.synopsis = i.synopsis
      if (!g.director && i.director) g.director = i.director
      if (year != null && (g.year == null || year < g.year)) g.year = year
      if (g.genres.length === 0 && i.genres && i.genres.length) g.genres = i.genres
      if (g.letterboxd == null && i.letterboxdRating != null) g.letterboxd = i.letterboxdRating
      if (!g.posterPath && i.posterPath) g.posterPath = i.posterPath
      for (const f of detectFormats(i.filmTitle)) if (!g.formats.includes(f)) g.formats.push(f)
      const nt = displayTitle(i.filmTitle)
      if (nt.length < g.title.length) g.title = nt
    }
    g.items.push(i)
  }
  const out: [string, Group[]][] = []
  for (const [dk, perDay] of tempPerDay) {
    const groups = Array.from(perDay.values())
    groups.sort((a, b) => {
      const at = a.items.reduce((m, x) => Math.min(m, Date.parse(x.screeningStart)), Infinity)
      const bt = b.items.reduce((m, x) => Math.min(m, Date.parse(x.screeningStart)), Infinity)
      if (at !== bt) return at - bt
      return a.title.localeCompare(b.title)
    })
    out.push([dk, groups])
  }
  out.sort(([a], [b]) => a.localeCompare(b))
  return out
}

function DaySection({ dayKey: dk, groups, openKey, onToggle }: {
  dayKey: string
  groups: Group[]
  openKey: string | null
  onToggle: (k: string) => void
}) {
  const isToday = dk === todayKey()
  const totalScreenings = groups.reduce((a, g) => a + g.items.length, 0)

  const [y, m, d] = dk.split('-').map(Number)
  const dObj = new Date(Date.UTC(y, m - 1, d, 12))
  const weekday = dObj.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
  const monthStr = dObj.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

  return (
    <section className="ic-day">
      <header className="ic-day__head">
        <div className="ic-day__marker">
          <span className="ic-day__date">{String(d).padStart(2, '0')} {monthStr}</span>
          <span className="ic-day__weekday">{isToday ? 'Today' : weekday}</span>
        </div>
        <div />
        <div className="ic-day__stats">
          <span>{groups.length} {groups.length === 1 ? 'film' : 'films'}</span>
          <span className="ic-day__dot">·</span>
          <span>{totalScreenings} {totalScreenings === 1 ? 'screening' : 'screenings'}</span>
        </div>
      </header>
      <div className="ic-day__list">
        {groups.map(g => (
          <FilmRow key={g.key} group={g} isOpen={openKey === g.key} onToggle={() => onToggle(g.key)} />
        ))}
      </div>
    </section>
  )
}

function FilmList({ items }: { items: Screening[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const days = useMemo(() => groupByDay(items), [items])

  if (items.length === 0) {
    return (
      <div className="ic-empty">
        <div className="ic-empty__title">No screenings match your filters.</div>
        <div className="ic-empty__sub">Try widening the time window or clearing a filter.</div>
      </div>
    )
  }

  return (
    <div className="ic-list">
      {days.map(([dk, groups]) => (
        <DaySection
          key={dk}
          dayKey={dk}
          groups={groups}
          openKey={openKey}
          onToggle={(k) => setOpenKey(prev => prev === k ? null : k)}
        />
      ))}
    </div>
  )
}

/* ----- Root App ----- */
export default function RedesignApp({ items }: { items: Screening[] }) {
  const genres = useMemo(() => {
    const s = new Set<string>()
    items.forEach(i => (i.genres || []).forEach(g => s.add(g)))
    return Array.from(s).sort()
  }, [items])

  const [f, setF] = useState<Filters>(DEFAULT_FILTERS)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ic-filters-v1') || '{}')
      setF(prev => ({
        ...prev,
        q: saved.q || '',
        window: saved.window || 'week',
        customDay: saved.customDay || null,
        cinemas: saved.cinemas || [],
        genre: saved.genre || '',
        decades: saved.decades || [],
        minLb: saved.minLb ?? null,
        watchlist: saved.watchlist || '',
      }))
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('ic-filters-v1', JSON.stringify(f)) } catch {}
  }, [f])

  const [watchlistIds, setWatchlistIds] = useState<Set<number> | null>(null)
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  const [watchlistError, setWatchlistError] = useState<string | null>(null)

  useEffect(() => {
    const u = f.watchlist.trim().toLowerCase()
    setWatchlistError(null)
    if (!u) { setWatchlistIds(null); return }
    const storageKey = `lb_watchlist_${u}`
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.ids)) {
          setWatchlistIds(new Set(parsed.ids))
          return
        }
      }
    } catch {}
    setWatchlistLoading(true)
    let cancel = false
    fetch(`/api/letterboxd/watchlist?username=${encodeURIComponent(u)}`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text.slice(0, 200) || `Request failed (${res.status})`)
        }
        return res.json()
      })
      .then((data: any) => {
        if (cancel) return
        const ids: number[] = Array.isArray(data?.ids) ? data.ids : []
        setWatchlistIds(new Set(ids))
        try {
          sessionStorage.setItem(storageKey, JSON.stringify({ username: u, ids, fetchedAt: Date.now() }))
        } catch {}
      })
      .catch((err: any) => {
        if (cancel) return
        setWatchlistError(err?.message || 'Failed to load watchlist')
        setWatchlistIds(null)
      })
      .finally(() => { if (!cancel) setWatchlistLoading(false) })
    return () => { cancel = true }
  }, [f.watchlist])

  const filtered = useMemo(() => {
    let base = applyFilters(items, f)
    if (f.watchlist && watchlistIds) {
      base = base.filter(i => typeof i.tmdbId === 'number' && watchlistIds.has(i.tmdbId as number))
    }
    return base
  }, [items, f, watchlistIds])

  const cinemaCounts = useMemo(() => {
    const base = applyFilters(items, { ...f, cinemas: [] })
    const m: Record<string, number> = {}
    for (const c of CINEMAS) m[c.key] = 0
    for (const i of base) m[i.cinema] = (m[i.cinema] || 0) + 1
    return m
  }, [items, f])

  const hasAnyFilter = !!(f.q || f.cinemas.length || f.genre || f.decades.length || f.minLb != null || f.watchlist)

  const mobileActiveCount =
    (f.cinemas.length ? 1 : 0) +
    (f.genre ? 1 : 0) +
    (f.decades.length ? 1 : 0) +
    (f.minLb != null ? 1 : 0) +
    (f.watchlist ? 1 : 0)

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  function clearAll() {
    setF(prev => ({ ...prev, q: '', cinemas: [], genre: '', decades: [], minLb: null, watchlist: '' }))
  }

  return (
    <div className="ic-app">
      <header className="ic-header">
        <div className="ic-header__inner">
          <a href="/" className="ic-wordmark">
            <span className="ic-wordmark__title">Indie Cinemas London</span>
          </a>
          <nav className="ic-nav">
            <a
              href="mailto:hello@indiecinemas.london"
              className="ic-nav__contact"
              aria-label="Email hello@indiecinemas.london"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </a>
          </nav>
        </div>
      </header>

      <section className="ic-controlbar">
        <div className="ic-controlbar__inner">
          <TimeTabs
            value={f.window}
            onChange={(w) => setF(prev => ({ ...prev, window: w, customDay: null }))}
            customDay={f.customDay}
            onPickDay={(d) => setF(prev => ({ ...prev, customDay: d }))}
            onClearDay={() => setF(prev => ({ ...prev, customDay: null }))}
          />
          <div className="ic-controlbar__spacer" />
          <SearchBox value={f.q} onChange={(q) => setF(prev => ({ ...prev, q }))} />
        </div>
      </section>

      <section className="ic-filterbar">
        <div className="ic-filterbar__inner">
          <div className="ic-filterbar__label">Filter</div>
          <div className="ic-filterbar__chips">
            <CinemaFilter
              value={f.cinemas}
              onChange={(v) => setF(prev => ({ ...prev, cinemas: v }))}
              availableCounts={cinemaCounts}
            />
            <GenreFilter
              value={f.genre}
              onChange={(v) => setF(prev => ({ ...prev, genre: v }))}
              genres={genres}
            />
            <DecadeFilter
              value={f.decades}
              onChange={(v) => setF(prev => ({ ...prev, decades: v }))}
            />
            <RatingFilter
              value={f.minLb}
              onChange={(v) => setF(prev => ({ ...prev, minLb: v }))}
            />
            <WatchlistFilter
              value={f.watchlist}
              onChange={(v) => setF(prev => ({ ...prev, watchlist: v }))}
              loading={watchlistLoading}
              error={watchlistError}
            />
          </div>
          <div className="ic-filterbar__end">
            {hasAnyFilter && (
              <button className="ic-linkbtn ic-filterbar__clear" onClick={clearAll}>Clear filters</button>
            )}
          </div>
        </div>
      </section>

      <MobileFilterSheet
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        filters={f}
        setFilters={setF}
        availableCounts={cinemaCounts}
        genres={genres}
        watchlistLoading={watchlistLoading}
        watchlistError={watchlistError}
      />

      <main className="ic-main">
        <FilmList items={filtered} />
      </main>

      <button
        type="button"
        className={cx('ic-mobilefilter-fab', mobileActiveCount > 0 && 'is-active')}
        onClick={() => setMobileFiltersOpen(true)}
        aria-label={mobileActiveCount > 0 ? 'Open filters (active)' : 'Open filters'}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <line x1="4" y1="6" x2="20" y2="6" />
          <circle cx="15" cy="6" r="2.2" fill="var(--_fab-bg)" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <circle cx="9" cy="12" r="2.2" fill="var(--_fab-bg)" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="17" cy="18" r="2.2" fill="var(--_fab-bg)" />
        </svg>
      </button>

      <footer className="ic-footer">
        <div className="ic-footer__inner">
          <div>Indie Cinemas London — independent listings, updated daily.</div>
          <div className="ic-footer__cinemas">
            {CINEMAS.map(c => <span key={c.key}>{c.label}</span>)}
          </div>
        </div>
      </footer>
    </div>
  )
}
