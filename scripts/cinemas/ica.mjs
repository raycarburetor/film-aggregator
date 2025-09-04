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

  const URLS = [
    'https://ica.art/films/next-7-days',
    'https://ica.art/films/today',
    'https://ica.art/films',
  ]

  const screenings = []
  for (const url of URLS) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('#docket .item.films a', { timeout: 15000 })

      const rows = await page.evaluate(() => {
        const parseDateHeader = (s) => {
          const now = new Date()
          const withYear = `${s} ${now.getFullYear()}`
          const d = new Date(withYear)
          return isNaN(d) ? null : d
        }

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
            const titleEls = el.querySelectorAll('.title-container .title')
            let title = (titleEls[titleEls.length - 1]?.innerText || '').replace(/\s+/g, ' ').trim()
            // Normalise title by removing leading qualifiers (premieres, series labels)
            title = title.replace(/^(?:UK|EU|WORLD)\s+PREMIERE\s*[:\-–]?\s*/i, '')
            title = title.replace(/^Preview\s*[:\-–]?\s*/i, '')
            title = title.replace(/^Off-Circuit\s*/i, '')
            const slots = Array.from(el.querySelectorAll('.time-container .time-slot')).map(s => (s.textContent || '').trim()).filter(Boolean)
            for (const slot of slots) {
              if (!currentDate) continue
              const dstr = `${currentDate.toDateString()} ${slot}`
              const when = new Date(dstr)
              if (isNaN(when)) continue
              out.push({ url: new URL(href, location.origin).toString(), title, start: when.toISOString() })
            }
          }
        }
        return out
      })

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
    const k = i.filmTitle + '|' + i.screeningStart
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  console.log('[ICA] screenings collected:', deduped.length)
  return deduped
}
