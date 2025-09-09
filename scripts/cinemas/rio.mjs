// scripts/cinemas/rio.mjs
// Source: https://riocinema.org.uk/Rio.dll/WhatsOn
// Strategy: Read embedded JSON (contains Events + Performances) and map to screenings.
import { chromium as pwChromium } from 'playwright'

export async function fetchRio() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const START_URL = 'https://riocinema.org.uk/Rio.dll/WhatsOn'
  let screenings = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}

    screenings = await page.evaluate(() => {
      const base = location.origin

      function parseEmbeddedJSON() {
        // The page contains a large JSON object like {"Events":[ ... ]} inside a <script> tag
        const html = document.documentElement.innerHTML
        const i = html.indexOf('{"Events"')
        if (i < 0) return null
        const j = html.indexOf('</script>', i)
        if (j < 0) return null
        const chunk = html.slice(i, j)
        try { return JSON.parse(chunk) } catch { return null }
      }

      function toISO(dateStr, hhmm) {
        try {
          const [y, m, d] = (dateStr || '').split('-').map(Number)
          const h = Math.floor(Number(hhmm || 0) / 100)
          const min = Number(hhmm || 0) % 100
          const dt = new Date(y, (m || 1) - 1, d || 1, h, min)
          return isNaN(dt) ? null : dt.toISOString()
        } catch { return null }
      }

      function cleanUrl(href, baseHref) {
        try { return new URL(href, baseHref || base).toString() } catch { return href }
      }

      const data = parseEmbeddedJSON()
      if (!data || !Array.isArray(data.Events)) return []

      const out = []
      for (const ev of data.Events) {
        try {
          const title = String(ev?.Title || '').replace(/\s+/g, ' ').trim()
          const filmUrl = cleanUrl(String(ev?.URL || ''), base)
          if (!title || !filmUrl) continue
          const perfs = Array.isArray(ev?.Performances) ? ev.Performances : []
          for (const p of perfs) {
            const iso = toISO(p?.StartDate, p?.StartTime)
            if (!iso) continue
            const bookingUrl = cleanUrl(String(p?.URL || ''), filmUrl)
            out.push({
              id: `rio-${p?.ID || ''}-${iso}`.replace(/\W+/g, ''),
              filmTitle: title,
              cinema: 'rio',
              screeningStart: iso,
              bookingUrl,
              filmUrl,
              // websiteYear intentionally omitted for now; fine-tune later.
            })
          }
        } catch {}
      }
      // de-dup same film/time pairs
      const seen = new Set()
      return out.filter((i) => {
        const k = i.filmTitle + '|' + i.screeningStart
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    })

    // Filter to horizon (default 30 days)
    const now = Date.now()
    const horizonDays = Number(process.env.RIO_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = (screenings || []).filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })
  } catch (e) {
    console.warn('[RIO] Failed to scrape:', e?.message || e)
  }

  await browser.close()
  console.log('[RIO] screenings collected:', screenings.length)
  return screenings
}

// Backward compatibility alias (consistency with other scrapers pattern)
export const fetchRioCinema = fetchRio

