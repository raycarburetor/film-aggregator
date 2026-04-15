// Nickel scraper.
//
// The Nickel's site is a server-rendered Next.js app. Every listing on the
// homepage is already present in the RSC payload embedded in the HTML, so we
// fetch the page, extract the `initialScreenings` array from the
// `self.__next_f.push(...)` chunks, and map each entry to a Screening. No
// headless browser required.
//
// Time source: Nickel's `screeningDate` field is unreliable — for some
// listings it contains the doors/schedule time rather than the film start.
// The site always displays `filmTime` (e.g. "Film 6pm"), so we combine the
// **date** portion of `screeningDate` with the **time** parsed from
// `filmTime`. That keeps us in lockstep with what users see when they book.

const HOMEPAGE = 'https://thenickel.co.uk/'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export async function fetchNickel() {
  let screenings = []
  try {
    const res = await fetch(HOMEPAGE, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()

    const raw = extractInitialScreenings(html)
    if (!Array.isArray(raw)) throw new Error('initialScreenings not found in page')

    screenings = raw.map(mapScreening).filter(Boolean)

    const seen = new Set()
    screenings = screenings.filter((s) => {
      const key = `${s.filmTitle}|${s.screeningStart}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const now = Date.now()
    const horizonDays = Number(process.env.NICKEL_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = screenings.filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return Number.isFinite(t) && t >= now && t <= maxTs
    })
  } catch (err) {
    console.warn('[NICKEL] scrape failed', err?.message || err)
  }

  console.log('[NICKEL] screenings collected:', screenings.length)
  return screenings
}

export const fetchTheNickel = fetchNickel

// --- RSC payload extraction ---

// Walk every `self.__next_f.push([1, "..."])` chunk, decode its string
// argument, and look for `"initialScreenings":[ ... ]`. When found, return
// the parsed array.
function extractInitialScreenings(html) {
  const re = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g
  let m
  while ((m = re.exec(html)) !== null) {
    let chunk
    try {
      chunk = JSON.parse(m[1])
    } catch {
      continue
    }
    if (typeof chunk !== 'string' || !chunk.includes('initialScreenings')) continue

    const key = '"initialScreenings":['
    const keyAt = chunk.indexOf(key)
    if (keyAt === -1) continue
    const arrStart = keyAt + key.length - 1 // position of '['

    const sliced = sliceBalancedArray(chunk, arrStart)
    if (!sliced) continue
    try {
      return JSON.parse(sliced)
    } catch {
      return null
    }
  }
  return null
}

// Given a string and the index of an opening '[', return the substring from
// '[' up to and including its matching ']', respecting JSON string escapes.
function sliceBalancedArray(text, startIdx) {
  if (text[startIdx] !== '[') return null
  let depth = 0
  let inString = false
  let esc = false
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\') {
        esc = true
        continue
      }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return text.slice(startIdx, i + 1)
    }
  }
  return null
}

// --- mapping ---

function mapScreening(row) {
  if (!row || typeof row !== 'object') return null
  const film = row.film || {}
  const rawTitle = typeof film.title === 'string' ? film.title.trim() : ''
  if (!rawTitle) return null
  const filmTitle = normaliseCasing(rawTitle)

  const iso = resolveScreeningIso(row)
  if (!iso) return null

  const bookingUrl = row.id ? `https://thenickel.co.uk/screening/${row.id}` : undefined

  const thisYear = new Date(iso).getFullYear()
  const year =
    typeof film.year === 'number' && film.year >= 1895 && film.year <= thisYear + 1 ? film.year : undefined

  const rawDirector = typeof film.director === 'string' ? film.director.trim() : ''
  const director = rawDirector ? normaliseCasing(rawDirector) : undefined

  const idBase = `nickel-${filmTitle}-${iso}`.replace(/\W+/g, '')
  return {
    id: idBase,
    filmTitle,
    cinema: 'nickel',
    screeningStart: iso,
    bookingUrl,
    filmUrl: bookingUrl,
    websiteYear: year,
    director,
  }
}

// Combine the date portion of `screeningDate` with the hour/minute parsed
// from `filmTime` (since that's what the site displays). Falls back to
// `screeningDate` as-is if `filmTime` can't be parsed.
function resolveScreeningIso(row) {
  const sd = typeof row.screeningDate === 'string' ? row.screeningDate : ''
  const dm = sd.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!dm) return null
  const y = Number(dm[1])
  const mo = Number(dm[2])
  const d = Number(dm[3])

  const ft = parseFilmTime(row.filmTime)
  if (ft) return londonWallToIso(y, mo, d, ft.hour, ft.minute)

  // No parsable filmTime — fall back to the raw screeningDate time.
  const tm = sd.match(/T(\d{2}):(\d{2})/)
  if (!tm) return null
  return londonWallToIso(y, mo, d, Number(tm[1]), Number(tm[2]))
}

// Parse e.g. "6pm", "5:30pm", "10am", "8.45pm" → { hour, minute }.
function parseFilmTime(s) {
  if (typeof s !== 'string') return null
  const cleaned = s.toLowerCase().replace(/\s+/g, '')
  const m = cleaned.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/)
  if (!m) return null
  let hour = Number(m[1])
  const minute = Number(m[2] || 0)
  const suffix = m[3]
  if (suffix === 'pm' && hour !== 12) hour += 12
  if (suffix === 'am' && hour === 12) hour = 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

// Convert a London wall-clock time to a real UTC ISO string.
function londonWallToIso(y, mo, d, h, mi) {
  const baseMs = Date.UTC(y, mo - 1, d, h, mi)
  const offsetMin = londonOffsetMinutes(new Date(baseMs))
  return new Date(baseMs - offsetMin * 60 * 1000).toISOString()
}

function londonOffsetMinutes(date) {
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

// --- title / name casing ---

// Small words that stay lowercase in Title Case — unless they are the first
// word, last word, or follow a sentence-like break (colon, em-dash, etc).
const SMALL_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'yet',
  'so',
  'as',
  'at',
  'by',
  'in',
  'of',
  'off',
  'on',
  'per',
  'to',
  'up',
  'via',
  'vs',
  'from',
  'into',
  'onto',
  'with',
])

// Whole-word acronyms that should always be uppercased.
const ACRONYMS = new Set([
  'vhs',
  'dvd',
  'uk',
  'usa',
  'us',
  'uss',
  'tv',
  'bbc',
  'cia',
  'fbi',
  'nasa',
  'nyc',
  'la',
  'dna',
])

// Normalise an ALL-CAPS string to Title Case. Leaves mixed-case inputs
// untouched so upstream enrichment (TMDb/OMDb) that already returns canonical
// casing is preserved. Handles:
//   - small words lowercased mid-phrase
//   - acronyms uppercased (VHS, Q&A)
//   - possessive/contraction suffixes (Wang's, don't, we're…)
//   - sentence restarts after `:` or em-dash
function normaliseCasing(input) {
  if (typeof input !== 'string' || !input) return input
  if (/[a-z]/.test(input)) return input

  const lower = input.toLowerCase()
  // Split into alternating letter-runs and non-letter-runs.
  const tokens = lower.match(/(\p{L}+|[^\p{L}]+)/gu) || []

  // Count total letter tokens so we can identify the last word.
  const wordIndices = []
  tokens.forEach((t, i) => {
    if (/\p{L}/u.test(t)) wordIndices.push(i)
  })
  const firstWordIdx = wordIndices[0]
  const lastWordIdx = wordIndices[wordIndices.length - 1]

  const out = tokens.map((tok, i) => {
    if (!/\p{L}/u.test(tok)) return tok

    if (ACRONYMS.has(tok)) return tok.toUpperCase()

    const isFirst = i === firstWordIdx
    const isLast = i === lastWordIdx
    const prev = i > 0 ? tokens[i - 1] : ''
    const afterSentenceBreak = /[:!?—–]/.test(prev) || /\.\s*$/.test(prev)

    if (!isFirst && !isLast && !afterSentenceBreak && SMALL_WORDS.has(tok)) {
      return tok
    }
    return tok[0].toUpperCase() + tok.slice(1)
  })

  let result = out.join('')

  // Possessive / contraction suffixes: lowercase the letter(s) after an
  // in-word apostrophe. Covers 's, 't, 're, 'll, 've, 'd, 'm, 'n'.
  result = result.replace(/(\p{L})['\u2019](S|T|Re|Ll|Ve|D|M|N)\b/gu, (_, lead, tail) =>
    lead + "'" + tail.toLowerCase(),
  )

  // Ampersand acronyms: Q&A, R&D, B&B — uppercase the single letters on
  // either side.
  result = result.replace(/\b(\p{L})&(\p{L})\b/gu, (_, a, b) => a.toUpperCase() + '&' + b.toUpperCase())

  return result
}
