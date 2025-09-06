// scripts/cinemas/closeup.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape Close-Up Film Centre programme.
 * Listing page exposes a JS var `shows` containing JSON describing upcoming shows.
 * For each item, visit the detail page and extract a release year (YYYY) from
 * div#film_program_support.inner_block_2_l. If a valid year is not found, skip the item.
 */
export async function fetchCloseUp() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const START_URL = 'https://www.closeupfilmcentre.com/film_programmes/'
  let items = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}

    const raw = await page.evaluate(() => {
      // Find the script content that defines `shows = '...json...'`
      const scripts = Array.from(document.querySelectorAll('script'))
      for (const s of scripts) {
        const txt = s.textContent || ''
        if (/var\s+shows\s*=/.test(txt)) return txt
      }
      return ''
    })
    let shows = []
    try {
      // Extract JSON string from: var shows = '...';
      const m = raw.match(/var\s+shows\s*=\s*'([\s\S]*?)'\s*;/)
      if (m) {
        const jsonStr = m[1]
        shows = JSON.parse(jsonStr)
      }
    } catch {}

    // Detail pass: fetch release year for each unique film_url
    const dpage = await ctx.newPage()
    const detailYear = new Map()
    const detailTitle = new Map()
    const uniqueUrls = Array.from(new Set((shows || []).map(s => s.film_url).filter(Boolean)))
    for (const rel of uniqueUrls) {
      const url = new URL(rel, START_URL).toString()
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        const yearAndTitle = await dpage.evaluate(() => {
          function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return n >= 1895 && n <= Y }
          const scope = document.querySelector('div#film_program_support.inner_block_2_l, #film_program_support') || document
          let years = []
          let scheduleYear
          try {
            const h1 = scope.querySelector('h1')
            if (h1) {
              const mh = (h1.textContent || '').match(/\b(19|20)\d{2}\b/)
              if (mh) scheduleYear = Number(mh[0])
            }
          } catch {}
          let year
          if (scope) {
            const paras = Array.from(scope.querySelectorAll('p, div'))
            // Heuristic A: a paragraph containing "YYYY ... N min"
            for (const el of paras) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              const m = tx.match(/\b(19|20)\d{2}\b[\s\S]{0,80}?\b\d{1,3}\s*min\b/i)
              if (m) {
                const y = Number((m[0].match(/\b(19|20)\d{2}\b/) || [])[0])
                if (valid(y)) { year = y; break }
              }
            }
            // Heuristic B: a paragraph containing ", YYYY" pattern (director, year)
            if (!year) {
              for (const el of paras) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                const m = tx.match(/,\s*((?:19|20)\d{2})\b/)
                if (m && valid(Number(m[1]))) { year = Number(m[1]); break }
              }
            }
            // Heuristic C: any year in scope excluding the header schedule year; prefer earliest
            if (!year) {
              const txt = (scope.textContent || '').replace(/\s+/g, ' ').trim()
              years = Array.from(txt.matchAll(/\b(19|20)\d{2}\b/g)).map(m => Number(m[0])).filter(valid)
              if (years.length) {
                const sorted = years.slice().sort((a,b) => a - b)
                const cap = typeof scheduleYear === 'number' ? scheduleYear : new Date().getFullYear()
                year = sorted.find(y => y !== scheduleYear && y <= cap)
              }
            }
          }
          const ttl = document.querySelector('h1, title')?.textContent?.trim() || ''
          return { year, title: ttl }
        })
        if (yearAndTitle?.year) detailYear.set(url, yearAndTitle.year)
        if (yearAndTitle?.title) detailTitle.set(url, yearAndTitle.title)
      } catch {}
    }

    const parsed = []
    for (const s of shows || []) {
      try {
        const filmUrl = new URL(s.film_url, START_URL).toString()
        const y = detailYear.get(filmUrl)
        if (!y) continue // skip non-film items (no release year found)
        // Parse "YYYY-MM-DD HH:MM:SS" as local Europe/London wall time
        const m = String(s.show_time || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/)
        if (!m) continue
        const when = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]||'0'))
        if (isNaN(when.getTime())) continue
        const iso = when.toISOString()
        // Prefer detail page title (cleaner encoding), then fallback to list title
        let rawTitle = (detailTitle.get(filmUrl) || '')
        if (!rawTitle) rawTitle = s.title || ''
        // Clean prefixes like "Date: Title" and site prefix "CLOSE-UP | "
        let title = rawTitle.replace(/^[^:]+:\s*/, '')
        title = title.replace(/^CLOSE[-\s]*UP\s*\|\s*/i, '')
        parsed.push({
          id: `closeup-${(title || 'film')}-${iso}`.replace(/\W+/g, ''),
          filmTitle: title,
          cinema: 'closeup',
          screeningStart: iso,
          bookingUrl: s.blink ? String(s.blink) : filmUrl,
          filmUrl,
          websiteYear: y,
          releaseDate: `${y}-01-01`,
        })
      } catch {}
    }

    // Apply horizon filter
    const now = Date.now()
    const horizonDays = Number(process.env.CLOSEUP_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    items = parsed.filter(s => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })
  } catch (e) {
    try {
      const html = await page.content()
      const fs = await import('node:fs/promises')
      await fs.writeFile('./tmp-closeup.html', html, 'utf8')
    } catch {}
  }

  await browser.close()
  console.log('[CLOSEUP] screenings collected:', items.length)
  return items
}
