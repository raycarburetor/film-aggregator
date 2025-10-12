// scripts/cinemas/barbican.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape Barbican Cinema day listings across a horizon window.
 * Example day URL: https://www.barbican.org.uk/whats-on/cinema?day=YYYY-MM-DD
 * Extracts title, showtimes, booking/detail URL, release year and (list-level)
 * director from div._film-metadata on each day page. A later detail-pass may
 * fill missing directors, but list-level values are preferred.
 */
export async function fetchBarbican() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const base = 'https://www.barbican.org.uk'
  const start = new Date()
  const horizonDays = Number(process.env.BARBICAN_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
  const dayUrls = []
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    dayUrls.push(`${base}/whats-on/cinema?day=${yyyy}-${mm}-${dd}`)
  }

  const screenings = []
  for (const url of dayUrls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
      // Wait for article items if present
      try { await page.waitForSelector('article._cinema-listing h2._title a, div._film-instances time[datetime]', { timeout: 8000 }) } catch {}

      const rows = await page.evaluate(() => {
        const out = []
        const cards = Array.from(document.querySelectorAll('.cinema-listing-card'))
        if (!cards.length) return out

        function cleanHref(href) {
          try {
            const u = new URL(href, location.origin)
            u.hash = ''
            return u.toString()
          } catch {
            return href
          }
        }
        function fallbackDay() {
          const url = new URL(location.href)
          const explicit = url.searchParams.get('day')
          if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit
          const today = new Date()
          const yyyy = today.getFullYear()
          const mm = String(today.getMonth() + 1).padStart(2, '0')
          const dd = String(today.getDate()).padStart(2, '0')
          return `${yyyy}-${mm}-${dd}`
        }
        const fallback = fallbackDay()
        const fallbackMatch = fallback.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        const fallbackParts = fallbackMatch
          ? { year: Number(fallbackMatch[1]), month: Number(fallbackMatch[2]), day: Number(fallbackMatch[3]) }
          : { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() }
        const monthMap = {
          jan: 1,
          january: 1,
          feb: 2,
          february: 2,
          mar: 3,
          march: 3,
          apr: 4,
          april: 4,
          may: 5,
          jun: 6,
          june: 6,
          jul: 7,
          july: 7,
          aug: 8,
          august: 8,
          sep: 9,
          sept: 9,
          september: 9,
          oct: 10,
          october: 10,
          nov: 11,
          november: 11,
          dec: 12,
          december: 12,
        }
        function resolveDateFromHeading(text) {
          if (!text) return null
          const match = text.match(/(\d{1,2})\s+([A-Za-z]+)/)
          if (!match) return null
          const day = Number(match[1])
          const month = monthMap[match[2].toLowerCase()]
          if (!day || !month) return null
          let year = fallbackParts.year
          const candidate = new Date(year, month - 1, day)
          const fallbackDate = new Date(fallbackParts.year, fallbackParts.month - 1, fallbackParts.day)
          const diff = candidate.getTime() - fallbackDate.getTime()
          const msInDay = 24 * 3600 * 1000
          if (diff > 200 * msInDay) {
            year -= 1
          } else if (diff < -200 * msInDay) {
            year += 1
          }
          return { year, month, day }
        }
        function parseTime(text) {
          if (!text) return null
          const cleaned = text.replace(/\s+/g, ' ').trim().toLowerCase()
          if (!cleaned) return null
          if (cleaned.includes('midnight')) return { hour: 0, minute: 0 }
          if (cleaned.includes('midday') || cleaned.includes('noon')) return { hour: 12, minute: 0 }
          const normalized = cleaned.replace(/(\d)[.\u00B7](\d)/g, '$1:$2')
          const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
          if (!match) return null
          let hour = Number(match[1])
          const minute = match[2] ? Number(match[2]) : 0
          const suffix = match[3]
          if (Number.isNaN(hour) || Number.isNaN(minute)) return null
          if (suffix === 'am') {
            if (hour === 12) hour = 0
          } else if (suffix === 'pm') {
            if (hour !== 12) hour += 12
          }
          if (hour > 23 || minute > 59) return null
          return { hour, minute }
        }
        function makeISO(dateParts, timeParts) {
          if (!dateParts || !timeParts) return null
          const { year, month, day } = dateParts
          const { hour, minute } = timeParts
          const dt = new Date(year, month - 1, day, hour, minute, 0, 0)
          if (Number.isNaN(dt.getTime())) return null
          return dt.toISOString()
        }
        function extractYear(scope) {
          try {
            const text = (scope?.textContent || '').replace(/\s+/g, ' ')
            const matches = text.match(/\b(19|20)\d{2}\b/g)
            if (!matches || !matches.length) return undefined
            for (const val of matches) {
              const year = Number(val)
              if (!Number.isNaN(year) && year >= 1895 && year <= fallbackParts.year + 1) return year
            }
          } catch {}
          return undefined
        }
        function extractDirector(scope) {
          try {
            const text = (scope?.textContent || '').replace(/\s+/g, ' ').trim()
            if (!text) return undefined
            const rejectRuntime = (s) =>
              /\b(runtime|\d+\s*(?:h|hr|hrs|hour|hours)\b|\b\d+\s*(?:m|min|mins|minutes)\b)/i.test(String(s))
            let m = text.match(/Directed by\s*([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
            m = text.match(/Director(?:s)?\s*:\s*([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
            m = text.match(/\bDir(?:ector)?s?\.?\s*:\s*([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
            m = text.match(/\bDir(?:ector)?s?\b\.?\s+([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
          } catch {}
          return undefined
        }

        for (const card of cards) {
          const titleEl = card.querySelector('.cinema-listing-card__title a[href]')
          const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim()
          const filmUrl = titleEl ? cleanHref(titleEl.getAttribute('href') || '') : ''
          const content = card.querySelector('.cinema-listing-card__content') || card
          const websiteYear = extractYear(content)
          const director = extractDirector(content)
          const instLists = Array.from(card.querySelectorAll('.cinema-instance-list'))
          for (const inst of instLists) {
            const headingText = (inst.querySelector('.cinema-instance-list__title')?.textContent || '').trim()
            const dateParts = resolveDateFromHeading(headingText) || fallbackParts
            const instances = Array.from(inst.querySelectorAll('.cinema-instance-list__instance'))
            for (const instance of instances) {
              const anchor = instance.querySelector('a[href]')
              const bookingHref = anchor ? cleanHref(anchor.getAttribute('href') || '') : ''
              const rawText = (anchor?.textContent || instance.textContent || '').replace(/\s+/g, ' ').trim()
              const timeParts = parseTime(rawText)
              const iso = makeISO(dateParts, timeParts)
              if (!iso) continue
              out.push({
                title,
                filmUrl,
                bookingUrl: bookingHref,
                start: iso,
                websiteYear,
                director,
              })
            }
          }
        }
        return out
      })
      for (const r of rows) {
        if (!r.title || !r.start) continue
        const filmHref = r.filmUrl
          ? (r.filmUrl.startsWith('http') ? r.filmUrl : new URL(r.filmUrl, base).toString())
          : undefined
        const bookingHref = r.bookingUrl
          ? (r.bookingUrl.startsWith('http') ? r.bookingUrl : new URL(r.bookingUrl, base).toString())
          : undefined
        const normalizedYear =
          typeof r.websiteYear === 'number' &&
          r.websiteYear >= 1895 &&
          r.websiteYear <= new Date(r.start).getFullYear() + 1
            ? r.websiteYear
            : undefined
        screenings.push({
          id: `barbican-${r.title}-${r.start}`.replace(/\W+/g, ''),
          filmTitle: r.title,
          cinema: 'barbican',
          screeningStart: r.start,
          bookingUrl: bookingHref || filmHref || base,
          filmUrl: filmHref,
          websiteYear: normalizedYear,
          director: r.director || undefined,
        })
      }
    } catch {}
  }

  // Detail pass: fetch director names from film pages
  try {
    const dpage = await ctx.newPage()
    const maxDetails = Number(process.env.BARBICAN_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER)
    const urls = Array.from(new Set(screenings.map(s => s.filmUrl).filter(Boolean))).slice(0, maxDetails)
    const dMap = new Map()
    for (const url of urls) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        try { await dpage.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
        try { await dpage.waitForSelector('.label-value-list, .label-value-list__label, div.sidebar-item', { timeout: 12000 }) } catch {}
        // Wait specifically for a Director label if it will appear dynamically
        try {
          await dpage.waitForFunction(() => {
            const labs = Array.from(document.querySelectorAll('.label-value-list__label'))
            return labs.some(el => /director/i.test((el.textContent||'').trim()))
          }, { timeout: 12000 })
        } catch {}
        const detail = await dpage.evaluate(() => {
          function cleanName(name, title) {
            try {
              let s = String(name || '').replace(/\s{2,}/g, ' ').trim()
              if (!s) return null
              const norm = (x) => String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase()
              if (title) {
                const nt = norm(title).split(/\s+/).filter(Boolean)
                let toks = s.split(/\s+/).filter(Boolean)
                let i=0
                while (i<nt.length && toks[0] && norm(toks[0])===nt[i]) { toks.shift(); i++ }
                s = toks.join(' ').trim() || s
              }
              // Drop obvious runtime strings
              if (/^\s*runtime\b/i.test(s)) return null
              s = s.replace(/\b(?:runtime)\b/ig, '')
              s = s.replace(/\b\d+\s*(?:h|hr|hrs|hour|hours)\b(?:\s*\d+\s*(?:m|min|mins|minutes)\b)?/ig, '')
              s = s.replace(/\b\d+\s*(?:m|min|mins|minutes)\b/ig, '')
              const stops = new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in'])
              let toks = s.split(/\s+/)
              while (toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift()
              s = toks.join(' ').trim()
              s = s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim()
              s = s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim()
              s = s.replace(/^(?:and|with)\s+/i,'').trim()
              // If what's left still looks like runtime fluff, reject
              if (/\b(min|mins|minutes|hour|hours|hr|hrs)\b/i.test(s)) return null
              return s || null
            } catch { return null }
          }
          function nameFromInlineStats(text, title) {
            const re = /([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/
            const m = String(text||'').match(re)
            return m ? cleanName(m[1], title) : null
          }
          function getValueText(el) {
            if (!el) return ''
            const anchors = Array.from(el.querySelectorAll('a')).map(a => (a.textContent || '').trim()).filter(Boolean)
            if (anchors.length) return anchors.join(', ')
            return (el.textContent || '').replace(/\s+/g, ' ').trim()
          }
          function collectEntries() {
            const entries = []
            const scopes = Array.from(document.querySelectorAll('div.sidebar-item .label-value-list, .sidebar-item .label-value-list, .label-value-list'))
            for (const scope of scopes) {
              const rows = Array.from(scope.querySelectorAll('.label-value-list__row'))
              if (rows.length) {
                for (const r of rows) {
                  const lab = (r.querySelector('.label-value-list__label')?.textContent || '').replace(/\s+/g, ' ').trim()
                  const val = getValueText(r.querySelector('.label-value-list__value'))
                  if (lab || val) entries.push({ label: lab, value: val })
                }
              } else {
                const labs = Array.from(scope.querySelectorAll('.label-value-list__label'))
                for (const labEl of labs) {
                  const lab = (labEl.textContent || '').replace(/\s+/g, ' ').trim()
                  let valEl = labEl.nextElementSibling
                  while (valEl && !(valEl.classList?.contains('label-value-list__value'))) {
                    if (valEl.classList?.contains('label-value-list__label')) break
                    valEl = valEl.nextElementSibling
                  }
                  const val = getValueText(valEl)
                  if (lab || val) entries.push({ label: lab, value: val })
                }
              }
            }
            return entries
          }
          function extractYearValue(value) {
            if (!value) return null
            const match = String(value).match(/\b(19|20)\d{2}\b/)
            if (!match) return null
            const year = Number(match[0])
            const now = new Date()
            if (!Number.isNaN(year) && year >= 1895 && year <= now.getFullYear() + 1) return year
            return null
          }
          function extractFromJSONLD() {
            try {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              for (const s of scripts) {
                const data = JSON.parse(s.textContent || 'null')
                const arr = Array.isArray(data) ? data : [data]
                for (const obj of arr) {
                  if (!obj || typeof obj !== 'object') continue
                  let director
                  const dNode = obj.director
                  if (typeof dNode === 'string') director = dNode
                  else if (Array.isArray(dNode)) {
                    const name = dNode.map(x => x?.name || '').filter(Boolean).join(', ')
                    if (name) director = name
                  } else if (dNode && typeof dNode === 'object' && dNode.name) {
                    director = dNode.name
                  }
                  let releaseYear = null
                  const dateFields = [obj.datePublished, obj.dateCreated, obj.startDate, obj.endDate]
                  for (const val of dateFields) {
                    if (typeof val !== 'string') continue
                    const year = extractYearValue(val)
                    if (year) { releaseYear = year; break }
                  }
                  if (!releaseYear && typeof obj?.year === 'number') {
                    releaseYear = extractYearValue(String(obj.year))
                  }
                  if (director || releaseYear) return { director, releaseYear }
                }
              }
            } catch {}
            return { director: null, releaseYear: null }
          }
          function fromLabels() {
            const scope = document
            const nodes = Array.from(scope.querySelectorAll('dt, dd, p, li, .meta, .details, .film-info, .Film-info__information__label, .Film-info__information__value'))
            for (const el of nodes) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                const sib = el.nextElementSibling
                if (sib) {
                  const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                  if (v) return cleanName(v, document.querySelector('h1, .title, .film-title')?.textContent)
                }
                const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .title, .film-title')?.textContent)
              }
            }
            const body = (document.body.textContent || '').replace(/\s+/g, ' ')
            const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
            if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .title, .film-title')?.textContent)
            const t = document.querySelector('h1, .title, .film-title')?.textContent || ''
            return nameFromInlineStats(body, t)
          }
          const t = document.querySelector('h1, .title, .film-title')?.textContent || ''
          const entries = collectEntries()
          const jsonLd = extractFromJSONLD()
          const lowerEntries = entries.map(({ label, value }) => ({
            label,
            labelLower: (label || '').toLowerCase(),
            value,
          }))
          const sidebarDirector = lowerEntries.find(e => /^director(?:s|\(s\))?\b/.test(e.labelLower))
          let director = sidebarDirector ? sidebarDirector.value : null
          if (!director) {
            const jsonDirector = jsonLd.director
            director = jsonDirector || fromLabels()
          }
          director = cleanName(director, t)

          let releaseYear = null
          const sidebarYear = lowerEntries.find(
            e => /\brelease\s*year\b/.test(e.labelLower) || e.labelLower === 'year'
          )
          if (sidebarYear) releaseYear = extractYearValue(sidebarYear.value)
          if (!releaseYear) {
            if (jsonLd.releaseYear) releaseYear = jsonLd.releaseYear
          }
          if (!releaseYear) {
            const body = (document.body.textContent || '').replace(/\s+/g, ' ')
            releaseYear = extractYearValue(body)
          }
          return { director, releaseYear: releaseYear ?? null }
        })
        if (detail && (detail.director || detail.releaseYear)) dMap.set(url, detail)
      } catch {}
    }
    if (dMap.size) {
      for (const s of screenings) {
        const detail = dMap.get(s.filmUrl)
        if (!detail) continue
        if (detail.director && !s.director) s.director = detail.director
        if (
          typeof detail.releaseYear === 'number' &&
          (typeof s.websiteYear !== 'number' || Math.abs(s.websiteYear - detail.releaseYear) >= 1)
        ) {
          s.websiteYear = detail.releaseYear
        }
      }
    }
  } catch {}

  // Deduplicate
  const seen = new Set()
  const deduped = screenings.filter((i) => {
    const k = i.filmTitle + '|' + i.screeningStart
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  await browser.close()
  console.log('[BARBICAN] screenings collected:', deduped.length)
  return deduped
}
