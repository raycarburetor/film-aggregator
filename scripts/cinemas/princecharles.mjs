// scripts/cinemas/princecharles.mjs
import { chromium as pwChromium } from 'playwright'
import fs from 'node:fs/promises'

export async function fetchPrinceCharles() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London'
  })
  const page = await ctx.newPage()

  const CANDIDATE_URLS = [
    'https://princecharlescinema.com/whats-on/',
    'https://www.princecharlescinema.com/whats-on/',
    'https://princecharlescinema.com/films/',
    'https://princecharlescinema.com/',
  ]

  let activeUrl = ''
  let screenings = []

  for (const [idx, url] of CANDIDATE_URLS.entries()) {
    try {
      activeUrl = url
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      // Wait for dynamic listings to render (jacro plugin)
      try {
        await page.waitForSelector(
          '.film-title, .film_single, .poster_name, .film_showtime, .btn.date_time_btn',
          { timeout: 20000 }
        )
      } catch {}

      // Dismiss common cookie banners if present
      try {
        const cookieBtn = await page.$(
          '#onetrust-accept-btn-handler, button:has-text("Accept"), button:has-text("I Agree"), .ot-sdk-button, .fc-cta-consent'
        )
        if (cookieBtn) await cookieBtn.click({ delay: 50 })
      } catch {}

      // Small scroll to trigger lazy content
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let total = 0
          const step = 400
          const timer = setInterval(() => {
            window.scrollBy(0, step)
            total += step
            if (total >= document.body.scrollHeight) {
              clearInterval(timer)
              resolve()
            }
          }, 120)
        })
      })
      await page.waitForTimeout(600)

      // First pass: tailored extraction for PCC (jacro plugin)
      screenings = await page.$$eval('.jacro-event.movie-tabs', (blocks) => {
        const base = location.origin
        const items = []

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

        function parseDate(dateStr, timeStr) {
          if (!dateStr || !timeStr) return null
          const ds = dateStr.toLowerCase().replace(/\b(mon|tue|wed|thu|fri|sat|sun)\.?\b/gi, '').trim()
          const dm = ds.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i)
          const tm = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i)
          if (!dm || !tm) return null
          const day = parseInt(dm[1], 10)
          const monName = dm[2].toLowerCase()
          const mon = monthMap[monName] ?? monthMap[monName.slice(0, 3)]
          if (mon == null) return null
          const now = new Date()
          let year = now.getFullYear()
          // If month already passed significantly, allow year roll-over heuristic
          if (mon < now.getMonth() - 6) year += 1
          let hour = parseInt(tm[1], 10)
          const minute = parseInt(tm[2], 10)
          const ap = tm[3]?.toLowerCase()
          if (ap === 'pm' && hour < 12) hour += 12
          if (ap === 'am' && hour === 12) hour = 0
          // Interpret parsed time in Europe/London (Playwright context TZ)
          // so DST is handled correctly; toISOString will convert to UTC.
          const d = new Date(year, mon, day, hour, minute)
          return isNaN(d) ? null : d
        }

        for (const b of blocks) {
          const title = (b.querySelector('.liveeventtitle')?.textContent || '').trim()
          if (!title) continue

          const lists = b.querySelectorAll('ul.performance-list-items')
          for (const ul of lists) {
            let currentDate = ''
            for (const el of Array.from(ul.children)) {
              if (el.matches('.heading')) {
                currentDate = (el.textContent || '').replace(/\s+/g, ' ').trim()
                continue
              }
              if (!el.matches('li')) continue
              const timeText = (el.querySelector('.time')?.textContent || '').trim()
              const a = el.querySelector('a[href]')
              const href = a?.getAttribute('href') || ''
              if (!currentDate || !timeText) continue
              const when = parseDate(currentDate, timeText)
              if (!when) continue
              const bookingUrl = href ? (href.startsWith('http') ? href : new URL(href, base).toString()) : base
              // Use a stable, collision-free id. The prior 28-char slice caused
              // many duplicate keys in the UI (React) and rows disappeared.
              items.push({
                id: `pcc-${title}-${when.toISOString()}`.replace(/\W+/g, ''),
                filmTitle: title,
                cinema: 'princecharles',
                screeningStart: when.toISOString(),
                bookingUrl,
              })
            }
          }
        }

        // de-dup
        const seen = new Set()
        return items.filter((i) => {
          const k = i.filmTitle + '|' + i.screeningStart
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
      })

      if (screenings.length > 0) break

      // Save HTML for this attempt to aid debugging
      try {
        const html = await page.content()
        await fs.writeFile(`./tmp-pcc-attempt-${idx}.html`, html, 'utf8')
        console.log('[PCC] Saved attempt', idx, 'HTML for', url)
      } catch {}
    } catch (e) {
      // try next candidate url
      continue
    }
  }

  // Debug save if nothing found
  if (screenings.length === 0) {
    try {
      const html = await page.content()
      await fs.writeFile('./tmp-pcc.html', html, 'utf8')
      console.log('[PCC] Saved raw HTML to ./tmp-pcc.html from', activeUrl)
    } catch {}
  }

  await browser.close()
  console.log('[PCC] screenings collected:', screenings.length)
  return screenings
}

// Backward-compat exported alias in case other files used the old name
export const fetchPrincecharles = fetchPrinceCharles
