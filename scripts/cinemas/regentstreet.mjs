// Regent Street Cinema scraper.
//
// The site is a Quasar/Vue SPA on the INDY Systems platform. The rendered
// `/now-playing` HTML contains no listings — the client issues GraphQL calls
// to `https://www.regentstreetcinema.com/graphql` to hydrate them. A single
// `showingsForDate(date: null, siteIds: [85])` call returns every upcoming
// showing for the venue, so no browser automation is required.
//
// The GraphQL endpoint 403s unless we send the same platform headers the
// browser sends (`site-id`, `circuit-id`, `client-type`, `is-electron-mode`).
// These are static values for RSC and don't depend on cookies.

const GRAPHQL_URL = 'https://www.regentstreetcinema.com/graphql'
const SITE_ID = '85'
const CIRCUIT_ID = '19'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const QUERY = `query ($date: String, $siteIds: [ID]) {
  showingsForDate(date: $date, siteIds: $siteIds) {
    data {
      id
      time
      movie {
        id
        name
        urlSlug
        directedBy
        releaseDate
        duration
        allGenres
        synopsis
        posterImage
      }
    }
  }
}`

export async function fetchRegentStreet() {
  let screenings = []
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'site-id': SITE_ID,
        'circuit-id': CIRCUIT_ID,
        'client-type': 'consumer',
        'is-electron-mode': 'false',
        'user-agent': USER_AGENT,
        'accept-language': 'en-GB',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { date: null, siteIds: [Number(SITE_ID)] },
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json?.errors?.length) throw new Error(`graphql: ${json.errors[0]?.message || 'error'}`)
    const rows = json?.data?.showingsForDate?.data
    if (!Array.isArray(rows)) throw new Error('showingsForDate.data missing')

    screenings = rows.map(mapScreening).filter(Boolean)

    const seen = new Set()
    screenings = screenings.filter((s) => {
      const key = `${s.filmTitle}|${s.screeningStart}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const now = Date.now()
    const horizonDays = Number(
      process.env.REGENTSTREET_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30,
    )
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = screenings.filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return Number.isFinite(t) && t >= now && t <= maxTs
    })
  } catch (err) {
    console.warn('[REGENTSTREET] scrape failed', err?.message || err)
  }

  console.log('[REGENTSTREET] screenings collected:', screenings.length)
  return screenings
}

function mapScreening(row) {
  if (!row || typeof row !== 'object') return null
  const movie = row.movie || {}
  const rawTitle = typeof movie.name === 'string' ? movie.name.trim() : ''
  if (!rawTitle) return null

  const iso = normaliseIso(row.time)
  if (!iso) return null

  const slug = typeof movie.urlSlug === 'string' ? movie.urlSlug.trim() : ''
  const bookingUrl = slug ? `https://www.regentstreetcinema.com/movie/${slug}` : undefined

  const rawDirector = typeof movie.directedBy === 'string' ? movie.directedBy.trim() : ''
  const director = rawDirector || undefined

  const releaseDate = typeof movie.releaseDate === 'string' && movie.releaseDate
    ? movie.releaseDate
    : undefined

  const nowYear = new Date().getFullYear()
  let websiteYear
  const ym = releaseDate && releaseDate.match(/^(\d{4})/)
  if (ym) {
    const y = Number(ym[1])
    if (y >= 1895 && y <= nowYear + 1) websiteYear = y
  }

  const genres = typeof movie.allGenres === 'string'
    ? movie.allGenres.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined

  const synopsis = typeof movie.synopsis === 'string' && movie.synopsis.trim()
    ? movie.synopsis.trim()
    : undefined

  // Prefer the showing id (stable per screening) for uniqueness. Fall back to
  // title+time if it's somehow missing.
  const idBase = row.id
    ? `regentstreet-${row.id}`
    : `regentstreet-${rawTitle}-${iso}`.replace(/\W+/g, '')

  return {
    id: idBase,
    filmTitle: rawTitle,
    cinema: 'regentstreet',
    screeningStart: iso,
    bookingUrl,
    filmUrl: bookingUrl,
    releaseDate,
    websiteYear,
    director,
    synopsis,
    genres,
  }
}

// The API returns times already in UTC (`2026-04-20T12:00:00Z`). Parse and
// re-emit as a canonical ISO string so downstream code gets a consistent
// format even if the platform ever drifts.
function normaliseIso(s) {
  if (typeof s !== 'string' || !s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}
