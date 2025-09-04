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

      function pushItem(title, href, when) {
        if (!title || !href || !when) return
        const iso = when.toISOString()
        out.push({
          id: `castle-${title}-${iso}`.replace(/\W+/g, ''),
          filmTitle: title,
          cinema: 'castle',
          screeningStart: iso,
          bookingUrl: normaliseUrl(href),
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
            pushItem(title, href, when)
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
          pushItem(title, href, when)
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
              pushItem(title, href, when)
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

    // Filter out past screenings
    const now = Date.now()
    screenings = screenings.filter((s) => new Date(s.screeningStart).getTime() >= now)

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

  await browser.close()
  console.log('[CASTLE] screenings collected:', screenings.length)
  return screenings
}
