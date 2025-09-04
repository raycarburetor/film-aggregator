import { chromium as pwChromium } from 'playwright'

/**
 * Scrape ICA listings from https://ica.art/films
 * Returns Screening[] with minimal fields; enrichment adds metadata later.
 */
export async function fetchICA() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  // Start with helpful views, then crawl daily pages for a larger future window
  const URLS = [
    'https://ica.art/films/next-7-days',
    'https://ica.art/films/today',
    'https://ica.art/films',
  ]

  // Expand to all upcoming by iterating daily pages for a configurable horizon
  const horizonDays = Number(process.env.ICA_HORIZON_DAYS || 120)
  const now = new Date()
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    // ICA day URLs appear unpadded (e.g., /2025-09-4)
    const dd = String(d.getDate())
    URLS.push(`https://ica.art/${yyyy}-${mm}-${dd}`)
  }

  const screenings = []
  for (const url of URLS) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('#docket', { timeout: 15000 })

      const rows = await page.evaluate((pageUrl) => {
        const parseDateHeader = (s) => {
          const now = new Date()
          const withYear = `${s} ${now.getFullYear()}`
          const d = new Date(withYear)
          return isNaN(d) ? null : d
        }

        const urlDateMatch = pageUrl.match(/\/(\d{4})-(\d{2})-(\d{1,2})(?:\b|$)/)
        const urlDate = urlDateMatch ? new Date(Number(urlDateMatch[1]), Number(urlDateMatch[2]) - 1, Number(urlDateMatch[3])) : null

        const container = document.querySelector('#docket')
        const out = []
        if (!container) return out
        let currentDate = null
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT)
        let node
        while ((node = walker.nextNode())) {
          const el = node
          if (el.classList?.contains('subtitle')) {
            const header = el.querySelector('.docket-date')
            const dateText = header?.textContent?.trim()
            if (dateText) currentDate = parseDateHeader(dateText)
          }
          if (el.classList?.contains('item') && el.classList?.contains('films')) {
            const a = el.querySelector('a[href]')
            const href = a?.getAttribute('href') || ''
            const titleEls = Array.from(el.querySelectorAll('.title-container .title'))
            // Prefer a non-season title if present
            const mainTitleEl = titleEls.reverse().find(t => !t.classList.contains('season-item')) || titleEls[0]
            let title = (mainTitleEl?.innerText || '').replace(/\s+/g, ' ').trim()
            // Normalise title by removing leading qualifiers (premieres, series labels)
            title = title.replace(/^(?:UK|EU|WORLD)\s+PREMIERE\s*[:\-–]?\s*/i, '')
            title = title.replace(/^Preview\s*[:\-–]?\s*/i, '')
            title = title.replace(/^Off-Circuit\s*/i, '')
            const slotText = Array.from(el.querySelectorAll('.time-container .time-slot')).map(s => (s.textContent || '')).join(' ')
            const times = []
            const re = /(\d{1,2}:\d{2})\s*(AM|PM)/gi
            let m
            while ((m = re.exec(slotText)) !== null) {
              times.push(`${m[1]} ${m[2].toUpperCase()}`)
            }
            const baseDate = currentDate || urlDate || new Date()
            for (const t of times) {
              const dstr = `${baseDate.toDateString()} ${t}`
              const when = new Date(dstr)
              if (isNaN(when)) continue
              out.push({ url: new URL(href, location.origin).toString(), title, start: when.toISOString() })
            }
          }
        }
        return out
      }, page.url())

      for (const r of rows) {
        const when = new Date(r.start)
        if (isNaN(when)) continue
        if (when.getTime() < Date.now()) continue
        const slug = r.url.split('/').filter(Boolean).pop() || 'film'
        screenings.push({
          id: `ica-${slug}-${when.toISOString()}`.replace(/\W+/g, ''),
          filmTitle: r.title,
          cinema: 'ica',
          screeningStart: when.toISOString(),
          bookingUrl: r.url,
        })
      }
    } catch (e) {
      continue
    }
  }

  await browser.close()
  const seen = new Set()
  const deduped = screenings.filter((i) => {
    const k = (i.bookingUrl || i.filmTitle) + '|' + i.screeningStart
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  console.log('[ICA] screenings collected:', deduped.length)
  return deduped
}
