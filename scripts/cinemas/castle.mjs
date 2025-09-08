// scripts/cinemas/castle.mjs
import { chromium as pwChromium } from 'playwright'
import fs from 'node:fs/promises'

/**
 * Scrape The Castle Cinema listings from calendar view.
 * Source: https://thecastlecinema.com/calendar/film/
 */
export async function fetchCastle() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const START_URL = 'https://thecastlecinema.com/calendar/film/'

  let screenings = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    // Some content loads dynamically; try to wait for typical selectors
    try {
      await page.waitForSelector(
        '.event, .event-list, .calendar, .grid, .day, .showtime, a[href*="/film/"]',
        { timeout: 20000 }
      )
    } catch {}

    // Trigger lazy loading / infinite list if present
    try {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let last = 0
          let stableTicks = 0
          const maxTicks = 40
          const step = 800
          const timer = setInterval(() => {
            window.scrollBy(0, step)
            const h = document.body.scrollHeight
            if (h === last) {
              stableTicks += 1
            } else {
              stableTicks = 0
              last = h
            }
            if (stableTicks >= 3 || window.scrollY + window.innerHeight >= h || stableTicks + (step ? 0 : 0) > maxTicks) {
              clearInterval(timer)
              resolve(undefined)
            }
          }, 200)
        })
      })
      await page.waitForTimeout(600)
    } catch {}

    // Attempt 1: Castle calendar appears to render a grid of days with showtimes
    screenings = await page.evaluate(() => {
      const base = location.origin
      const out = []

      function normaliseUrl(href) {
        try {
          const u = new URL(href, base)
          u.hash = ''
          return u.toString()
        } catch {
          return href
        }
      }

      function extractYearFromTitle(title) {
        const s = String(title || '')
        let m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
        if (m) return Number(m[1])
        m = s.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
        if (m) return Number(m[1])
        m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
        if (m) return Number(m[1])
        return undefined
      }

      function findFilmUrl(scopeEl) {
        try {
          const a = scopeEl?.querySelector?.('a[href*="/film/"]') || scopeEl?.closest?.('.programme-tile')?.querySelector?.('a[href*="/film/"]')
          const href = a?.getAttribute?.('href') || ''
          return href ? normaliseUrl(href) : ''
        } catch { return '' }
      }

      function pushItem(title, href, when, filmUrl) {
        if (!title || !href || !when) return
        const iso = when.toISOString()
        const candidateYear = extractYearFromTitle(title)
        const safeYear = (candidateYear && candidateYear >= 1895 && candidateYear <= when.getFullYear()) ? candidateYear : undefined
        out.push({
          id: `castle-${title}-${iso}`.replace(/\W+/g, ''),
          filmTitle: title,
          cinema: 'castle',
          screeningStart: iso,
          bookingUrl: normaliseUrl(href),
          filmUrl: filmUrl || '',
          websiteYear: safeYear,
        })
      }

      // Strategy A: generic calendar-day with links containing time text
      const dayNodes = Array.from(document.querySelectorAll('[class*="day"], .calendar-day, .date'))
      if (dayNodes.length) {
        for (const dn of dayNodes) {
          // Find a date context on the day cell
          let dateStr = dn.getAttribute('data-date') || dn.getAttribute('aria-label') || dn.querySelector('[data-date], time[datetime]')?.getAttribute('datetime') || ''
          if (!dateStr) {
            const label = dn.querySelector('.date, .label, .day-label, header, h3, time')?.textContent || ''
            const m = label.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/)
            if (m) dateStr = `${m[1]} ${m[2]} ${m[3]}`
          }

          // Collect potential show blocks within the day
          const shows = dn.querySelectorAll('a[href], .showtime, .time, .event, li, .screening')
          for (const s of Array.from(shows)) {
            const a = s.matches('a[href]') ? s : s.querySelector('a[href]')
            const href = a?.getAttribute('href') || ''
            // Title could be near the link or higher up
            const titleEl = s.querySelector('[class*="title"], .film-title, .event-title') || dn.querySelector('[class*="title"], .film-title, .event-title')
            const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim()
            const timeText = (s.textContent || '').match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)?.[0]
            if (!title || !timeText) continue
            const filmUrl = findFilmUrl(s) || findFilmUrl(dn)

            // Parse base date with current year fallback
            let baseDate
            if (dateStr) {
              baseDate = new Date(dateStr)
              if (isNaN(baseDate)) {
                // Try formats like 2025-09-04
                const ymdd = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
                if (ymdd) baseDate = new Date(Number(ymdd[1]), Number(ymdd[2]) - 1, Number(ymdd[3]))
              }
            }
            if (!baseDate || isNaN(baseDate)) {
              const now = new Date()
              baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            }

            const tm = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
            if (!tm) continue
            let hour = parseInt(tm[1], 10)
            const minute = parseInt(tm[2], 10)
            const ap = tm[3]?.toLowerCase()
            if (ap === 'pm' && hour < 12) hour += 12
            if (ap === 'am' && hour === 12) hour = 0
            const when = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute)
            if (isNaN(when)) continue
            pushItem(title, href, when, filmUrl)
          }
        }
      }

      // Strategy B: list view fallback where each event row has a date and times
      const rows = Array.from(document.querySelectorAll('.event, .event-row, .listing, .programme-item'))
      for (const row of rows) {
        const a = row.querySelector('a[href]')
        const href = a?.getAttribute('href') || ''
        const title = (row.querySelector('.title, .film-title, h3, h2, .name')?.textContent || '').replace(/\s+/g, ' ').trim()
        const dateCtx = (row.querySelector('time[datetime]')?.getAttribute('datetime') || row.getAttribute('data-date') || row.querySelector('.date')?.textContent || '').trim()
        let baseDate = dateCtx ? new Date(dateCtx) : null
        if (baseDate && isNaN(baseDate)) baseDate = null
        const timePieces = (row.textContent || '').match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi) || []
        const filmUrl = findFilmUrl(row)
        for (const t of timePieces) {
          const m = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
          if (!m) continue
          let hour = parseInt(m[1], 10)
          const minute = parseInt(m[2], 10)
          const ap = m[3]?.toLowerCase()
          if (ap === 'pm' && hour < 12) hour += 12
          if (ap === 'am' && hour === 12) hour = 0
          const now = new Date()
          const d = baseDate || new Date(now.getFullYear(), now.getMonth(), now.getDate())
          const when = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute)
          if (!title || !href || isNaN(when)) continue
          pushItem(title, href, when, filmUrl)
        }
      }

      // Strategy C: explicit Castle structure — date headers followed by programme tiles
      const monthMap = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11,
      }

      function parseDateHeader(s) {
        if (!s) return null
        // e.g., "Fri, 5 Sep"
        const m = s.trim().match(/^[A-Za-z]{3,}\s*,\s*(\d{1,2})\s+([A-Za-z]{3,})/)
        if (!m) return null
        const day = parseInt(m[1], 10)
        const monName = m[2].toLowerCase()
        const mon = monthMap[monName] ?? monthMap[monName.slice(0, 3)]
        if (mon == null) return null
        const now = new Date()
        let year = now.getFullYear()
        if (mon < now.getMonth() - 6) year += 1
        const d = new Date(year, mon, day)
        return isNaN(d) ? null : d
      }

      const headers = Array.from(document.querySelectorAll('h3.date'))
      for (const h of headers) {
        const baseDate = parseDateHeader(h.textContent || '')
        if (!baseDate) continue
        let el = h.nextElementSibling
        while (el && !(el.tagName === 'H3' && el.classList.contains('date'))) {
          if (el.classList?.contains('programme-tile')) {
            const title = (el.querySelector('.tile-name h1, .tile-name, .film-title, h2, h3')?.textContent || '').replace(/\s+/g, ' ').trim()
            const times = Array.from(el.querySelectorAll('.film-times a.performance-button')).map(a => (a.textContent || '').trim())
            const hrefs = Array.from(el.querySelectorAll('.film-times a.performance-button')).map(a => a.getAttribute('href') || '')
            const filmUrl = findFilmUrl(el)
            for (let i = 0; i < times.length; i++) {
              const timeText = times[i]
              const href = hrefs[i] || ''
              const m = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
              if (!m) continue
              let hour = parseInt(m[1], 10)
              const minute = parseInt(m[2], 10)
              const ap = m[3]?.toLowerCase()
              if (ap === 'pm' && hour < 12) hour += 12
              if (ap === 'am' && hour === 12) hour = 0
              const when = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute)
              if (!title || !href || isNaN(when)) continue
              pushItem(title, href, when, filmUrl)
            }
          }
          el = el.nextElementSibling
        }
      }

      // Deduplicate by title + start time
      const seen = new Set()
      return out.filter((i) => {
        const k = i.filmTitle + '|' + i.screeningStart
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    })

    // Filter out past screenings and limit future horizon (default 60 days)
    const now = Date.now()
    const horizonDays = Number(process.env.CASTLE_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = screenings.filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })

    // If nothing found, save raw HTML for debugging
    if (screenings.length === 0) {
      try {
        const html = await page.content()
        await fs.writeFile('./tmp-castle.html', html, 'utf8')
        console.log('[CASTLE] Saved raw HTML to ./tmp-castle.html')
      } catch {}
    }
  } catch (e) {
    // On errors, best effort save
    try {
      const html = await page.content()
      await fs.writeFile('./tmp-castle-error.html', html, 'utf8')
    } catch {}
  }

  // Visit film detail pages to capture release year and director as stated on the site
  try {
    const maxDetails = Number(process.env.CASTLE_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER)
    const detailMap = new Map()
    const dirMap = new Map()
    // Use film detail pages only for year extraction
    const uniqueUrls = Array.from(new Set(
      screenings.map(s => s.filmUrl).filter(Boolean)
    )).slice(0, maxDetails)

    const dpage = await ctx.newPage()
    for (const url of uniqueUrls) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const year = await dpage.evaluate(() => {
          function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return n >= 1895 && n <= Y }
          function pickAnnoYearFromTitle(s) {
            const str = String(s||'')
            let m = str.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
            if (m) return Number(m[1])
            m = str.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
            if (m) return Number(m[1])
            m = str.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
            if (m) return Number(m[1])
          }
          // Prefer explicit film-year element
          const fy = document.querySelector('div.film-year')
          if (fy) {
            const m = (fy.textContent || '').match(/\b(19|20)\d{2}\b/)
            if (m && valid(Number(m[0]))) return Number(m[0])
          }
          const titleEl = document.querySelector('h1, .film-title, .title, .tile-name, .poster_name')
          const titleText = titleEl?.textContent?.trim() || ''
          const y1 = pickAnnoYearFromTitle(titleText)
          if (valid(y1)) return y1
          const labelSelectors = ['.meta', '.details', '.film-info', '.film_meta', 'dl', 'ul', 'section']
          let best
          for (const sel of labelSelectors) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const tx = el.textContent || ''
              if (/\b(year|release year|released)\b/i.test(tx)) {
                const yrs = Array.from(tx.matchAll(/\b(19|20)\d{2}\b/g)).map(m => Number(m[0])).filter(valid)
                if (yrs.length) best = Math.min(best ?? Infinity, Math.min(...yrs))
              }
            }
          }
          return best
        })
        if (year) detailMap.set(url, year)
        // Director
        const director = await dpage.evaluate(() => {
          function cleanName(name, title) {
            try { let s=String(name||'').replace(/\s{2,}/g,' ').trim(); if(!s) return null; const norm=(x)=>String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase(); if(title){ const nt=norm(title).split(/\s+/).filter(Boolean); let toks=s.split(/\s+/).filter(Boolean); let i=0; while(i<nt.length && toks[0] && norm(toks[0])===nt[i]){ toks.shift(); i++ } s=toks.join(' ').trim()||s } const stops=new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in']); let toks=s.split(/\s+/); while(toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift(); s=toks.join(' ').trim(); s=s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim(); s=s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim(); s=s.replace(/^(?:and|with)\s+/i,'').trim(); return s||null } catch { return null } }
          function nameFromInlineStats(text, title) { const re=/([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/; const m=String(text||'').match(re); return m?cleanName(m[1], title):null }
          function fromJSONLD() {
            try {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              for (const s of scripts) {
                const data = JSON.parse(s.textContent || 'null')
                const arr = Array.isArray(data) ? data : [data]
                for (const obj of arr) {
                  const d = obj?.director
                  if (!d) continue
                  if (typeof d === 'string') return d
                  if (Array.isArray(d)) {
                    const name = d.map(x => x?.name || '').filter(Boolean).join(', ')
                    if (name) return name
                  } else if (typeof d === 'object') {
                    const name = d?.name || ''
                    if (name) return name
                  }
                }
              }
            } catch {}
            return undefined
          }
          function fromLabels() {
            const nodes = Array.from(document.querySelectorAll('.meta, .details, dl, ul, section, p, li, dt, dd'))
            for (const el of nodes) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                const sib = el.nextElementSibling
                if (sib) {
                  const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                  if (v) return cleanName(v, document.querySelector('h1, .film-title, .title, .tile-name, .poster_name')?.textContent)
                }
                const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .film-title, .title, .tile-name, .poster_name')?.textContent)
              }
            }
            const body = (document.body.textContent || '').replace(/\s+/g, ' ')
            const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
            if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .film-title, .title, .tile-name, .poster_name')?.textContent)
            const t = document.querySelector('h1, .film-title, .title, .tile-name, .poster_name')?.textContent || ''
            return nameFromInlineStats(body, t)
          }
          const t = document.querySelector('h1, .film-title, .title, .tile-name, .poster_name')?.textContent || ''
          let d = fromJSONLD() || fromLabels()
          d = cleanName(d, t)
          return d
        })
        if (director) dirMap.set(url, director)
      } catch {}
    }
    if (detailMap.size) {
      for (const s of screenings) {
        const key = s.filmUrl
        const y = detailMap.get(key)
        if (y) {
          const sy = new Date(s.screeningStart).getFullYear()
          const safe = (y >= 1895 && y <= sy) ? y : undefined
          if (safe && (!s.websiteYear || safe < s.websiteYear)) s.websiteYear = safe
        }
      }
    }
    if (dirMap.size) {
      for (const s of screenings) {
        const d = dirMap.get(s.filmUrl)
        if (d) s.director = d
      }
    }
  } catch {}

  await browser.close()
  console.log('[CASTLE] screenings collected:', screenings.length)
  return screenings
}
