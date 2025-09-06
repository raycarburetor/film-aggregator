// scripts/cinemas/barbican.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape Barbican Cinema day listings across a horizon window.
 * Example day URL: https://www.barbican.org.uk/whats-on/cinema?day=YYYY-MM-DD
 * Extracts title, showtimes, booking/detail URL, and release year from div._film-metadata.
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
        const articles = Array.from(document.querySelectorAll('article._cinema-listing'))
        function cleanHref(href) { try { const u = new URL(href, location.origin); u.hash=''; return u.toString() } catch { return href } }
        function extractYear(scope) {
          try {
            const em = scope.querySelector('div._film-metadata em')
            const tx = (em?.textContent || '').trim()
            const m = tx.match(/\b(19|20)\d{2}\b/)
            return m ? Number(m[0]) : undefined
          } catch { return undefined }
        }
        for (const a of articles) {
          const titleEl = a.querySelector('h2._title a[href]')
          const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim()
          const filmUrl = titleEl ? cleanHref(titleEl.getAttribute('href') || '') : ''
          const websiteYear = extractYear(a)
          const instRoot = a.querySelector('div._film-instances')
          // Only collect actual screening times, not the header's date time element
          const times = Array.from(instRoot?.querySelectorAll('.instance-listing__button time[datetime]') || [])
          for (const t of times) {
            const dt = t.getAttribute('datetime') || ''
            const d = new Date(dt)
            if (isNaN(d.getTime())) continue
            out.push({
              title,
              filmUrl,
              start: d.toISOString(),
              websiteYear,
            })
          }
        }
        return out
      })
      for (const r of rows) {
        if (!r.title || !r.start) continue
        screenings.push({
          id: `barbican-${r.title}-${r.start}`.replace(/\W+/g, ''),
          filmTitle: r.title,
          cinema: 'barbican',
          screeningStart: r.start,
          bookingUrl: r.filmUrl ? (r.filmUrl.startsWith('http') ? r.filmUrl : new URL(r.filmUrl, base).toString()) : base,
          filmUrl: r.filmUrl ? (r.filmUrl.startsWith('http') ? r.filmUrl : new URL(r.filmUrl, base).toString()) : undefined,
          websiteYear: (typeof r.websiteYear === 'number' && r.websiteYear >= 1895 && r.websiteYear <= new Date(r.start).getFullYear()) ? r.websiteYear : undefined,
        })
      }
    } catch {}
  }

  await browser.close()
  // Deduplicate
  const seen = new Set()
  const deduped = screenings.filter((i) => {
    const k = i.filmTitle + '|' + i.screeningStart
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  console.log('[BARBICAN] screenings collected:', deduped.length)
  return deduped
}
