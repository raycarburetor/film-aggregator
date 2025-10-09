import { chromium as pwChromium } from 'playwright'

export async function fetchNickel() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const START_URL = 'https://thenickel.co.uk/Main-Listings-RYAN'

  let screenings = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.waitForLoadState('networkidle', { timeout: 12000 }) } catch {}
    try { await page.waitForSelector('div.page_content div[grid-row]', { timeout: 20000 }) } catch {}

    const rows = await page.evaluate(() => {
      const results = []
      const now = new Date()
      const dayMs = 24 * 60 * 60 * 1000
      function cleanUrl(href) {
        try {
          const u = new URL(href, location.origin)
          u.hash = ''
          return u.toString()
        } catch {
          return href
        }
      }
      function parseTime(str) {
        if (!str) return null
        const cleaned = str.toLowerCase().replace(/[^0-9apm:.]/g, '')
        const m = cleaned.match(/(\d{1,2})(?:[:.](\d{2}))?(am|pm)?/)
        if (!m) return null
        let hour = Number(m[1])
        const minute = Number(m[2] ?? '0')
        const suffix = m[3]
        if (suffix === 'pm' && hour < 12) hour += 12
        if (suffix === 'am' && hour === 12) hour = 0
        if (!suffix && hour === 24) hour = 0
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
        return { hour, minute }
      }
      function londonOffsetMinutes(dateUtc) {
        try {
          const fmt = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/London',
            timeZoneName: 'shortOffset',
          })
          const parts = fmt.formatToParts(dateUtc)
          const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || ''
          const m = tzPart.match(/([+-])(\d{1,2})(?::?(\d{2}))?/)
          if (m) {
            const sign = m[1] === '-' ? -1 : 1
            const hours = Number(m[2] || '0')
            const mins = Number(m[3] || '0')
            if (Number.isFinite(hours) && Number.isFinite(mins)) {
              return sign * (hours * 60 + mins)
            }
          }
        } catch {}
        return 0
      }

      function makeLondonDate(year, month, day, hour, minute) {
        const baseMs = Date.UTC(year, month - 1, day, hour, minute)
        const offsetMinutes = londonOffsetMinutes(new Date(baseMs))
        return new Date(baseMs - offsetMinutes * 60 * 1000)
      }

      const rows = Array.from(document.querySelectorAll('div.page_content div[grid-row]'))
      for (const row of rows) {
        const cols = Array.from(row.querySelectorAll('div[grid-col]'))
        if (cols.length < 2) continue
        const detailCol = cols[1] || cols[0]
        const infoCol = cols[cols.length - 1]
        const detailText = (detailCol.innerText || '').trim()
        if (!/Doors/i.test(detailText)) continue
        const titleEl = detailCol.querySelector('b')
        const rawTitle = (titleEl?.innerText || '').replace(/\s+/g, ' ').trim()
        if (!rawTitle) continue
        const annotation = (detailCol.querySelector('i')?.innerText || '').trim()
        const yearMatch = annotation.match(/(19|20)\d{2}/)
        const websiteYear = yearMatch ? Number(yearMatch[0]) : undefined
        let director
        if (annotation) {
          const cleaned = annotation.replace(/[()]/g, '')
          const parts = cleaned.split(',').map(s => s.trim()).filter(Boolean)
          if (parts.length) director = parts[parts.length - 1]
        }
        const doorMatches = []
        const doorRegex = /Doors?\s*:?\s*([^\n]+)/gi
        let dm
        while ((dm = doorRegex.exec(detailText))) {
          const parsed = parseTime(dm[1])
          if (parsed) doorMatches.push(parsed)
        }
        if (!doorMatches.length) continue
        const infoLines = (infoCol.innerText || '')
          .split(/\n+/)
          .map(s => s.trim())
          .filter(Boolean)
        const dayRegex = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
        const dateRegex = /(\d{1,2})(?:[.\/-])(\d{1,2})/
        let rawDate = infoLines.find(line => dateRegex.test(line))
        if (!rawDate) {
          const dayLine = infoLines.find(line => dayRegex.test(line))
          if (dayLine) {
            const idx = infoLines.indexOf(dayLine)
            if (idx >= 0 && idx + 1 < infoLines.length && dateRegex.test(infoLines[idx + 1])) {
              rawDate = infoLines[idx + 1]
            }
          }
        }
        if (!rawDate) continue
        const dateMatch = rawDate.match(dateRegex)
        if (!dateMatch) continue
        const dayNum = Number(dateMatch[1])
        const monthNum = Number(dateMatch[2])
        if (!Number.isFinite(dayNum) || !Number.isFinite(monthNum)) continue
        const anchors = Array.from(infoCol.querySelectorAll('a[href]'))
        const loopCount = Math.max(doorMatches.length, anchors.length || 1)
        for (let idx = 0; idx < loopCount; idx++) {
          const doorTime = doorMatches[idx] || doorMatches[doorMatches.length - 1]
          if (!doorTime) continue
          const anchor = anchors[idx] || anchors[anchors.length - 1]
          const bookingUrl = anchor ? cleanUrl(anchor.getAttribute('href') || '') : ''
          const makeCandidate = (yr) => makeLondonDate(yr, monthNum, dayNum, doorTime.hour, doorTime.minute)
          let year = now.getFullYear()
          let candidate = makeCandidate(year)
          if (isNaN(candidate.getTime())) continue
          if (candidate.getTime() < now.getTime() - 14 * dayMs) {
            candidate = makeCandidate(year + 1)
          }
          if (candidate.getTime() - now.getTime() > 380 * dayMs) {
            candidate = makeCandidate(year - 1)
            if (candidate.getTime() < now.getTime() - 14 * dayMs) continue
          }
          results.push({
            title: rawTitle,
            start: candidate.toISOString(),
            bookingUrl,
            websiteYear,
            director,
          })
        }
      }
      return results
    })

    screenings = rows.filter(Boolean).map((row) => {
      const safeTitle = row.title
      const iso = row.start
      return {
        id: `nickel-${safeTitle}-${iso}`.replace(/\W+/g, ''),
        filmTitle: safeTitle,
        cinema: 'nickel',
        screeningStart: iso,
        bookingUrl: row.bookingUrl || undefined,
        filmUrl: row.bookingUrl || undefined,
        websiteYear:
          typeof row.websiteYear === 'number' && row.websiteYear >= 1895 && row.websiteYear <= new Date(iso).getFullYear() + 1
            ? row.websiteYear
            : undefined,
        director: row.director || undefined,
      }
    })

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

  await browser.close()
  console.log('[NICKEL] screenings collected:', screenings.length)
  return screenings
}

export const fetchTheNickel = fetchNickel
