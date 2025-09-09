// scripts/cinemas/cinelumiere.mjs
// Source: https://www.institut-francais.org.uk/whats-on/?type=72&period=day&location=onsite&date=YYYY-MM-DD#/
// Strategy: Iterate daily listings, extract film cards, showtimes + booking links,
// then visit each film detail page to read Director and Year from ul.metadata.
import { chromium as pwChromium } from 'playwright'

export async function fetchCineLumiere() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const base = 'https://www.institut-francais.org.uk/whats-on/'
  const start = new Date()
  const horizonDays = Number(process.env.CINELUMIERE_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
  const dayUrls = []
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    dayUrls.push(`${base}?type=72&period=day&location=onsite&date=${yyyy}-${mm}-${dd}#/`)
  }

  let screenings = []

  for (const url of dayUrls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
      // Cookie consent sometimes blocks interactions; accept if visible
      try {
        const sel = await page.$('text=ACCEPT ALL')
        if (sel) await sel.click({ timeout: 1000 }).catch(()=>{})
      } catch {}
      // Wait for at least one film card, but don’t fail hard if none (some days may be empty)
      try { await page.waitForSelector('article.card--film', { timeout: 8000 }) } catch {}

      const dayRows = await page.evaluate(() => {
        const out = []
        const search = location.search || ''
        const m = search.match(/(?:\?|&)date=(\d{4})-(\d{2})-(\d{2})(?:&|$)/)
        if (!m) return out
        const Y = Number(m[1]), M = Number(m[2]), D = Number(m[3])

        function toISO(hhmm) {
          const tm = String(hhmm || '').match(/(\d{1,2}):(\d{2})/)
          if (!tm) return null
          let h = Number(tm[1]); const min = Number(tm[2])
          if (!Number.isFinite(h) || !Number.isFinite(min)) return null
          const d = new Date(Y, (M || 1) - 1, D || 1, h, min)
          return isNaN(d) ? null : d.toISOString()
        }

        function cleanHref(href) {
          try { const u = new URL(href, location.origin); u.hash=''; return u.toString() } catch { return href }
        }

        const cards = Array.from(document.querySelectorAll('article.card--film'))
        for (const art of cards) {
          try {
            const titleEl = art.querySelector('h3.card__title') || art.querySelector('.card__title')
            const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim()
            const filmAnchor = art.querySelector('a[href*="/cinema/"]') || art.querySelector('a[href^="https://www.institut-francais.org.uk/cinema/"]')
            const filmUrl = filmAnchor ? cleanHref(filmAnchor.getAttribute('href') || '') : ''
            const bookingAnchors = Array.from(art.querySelectorAll('div.times a[href]'))
            for (const a of bookingAnchors) {
              const timeText = (a.textContent || '').replace(/\s+/g, ' ').trim()
              const iso = toISO(timeText)
              if (!iso) continue
              const bookingUrl = cleanHref(a.getAttribute('href') || '')
              out.push({ title, filmUrl, bookingUrl, start: iso })
            }
          } catch {}
        }
        return out
      })

      for (const r of dayRows) {
        if (!r?.title || !r?.start) continue
        // Ignore past showtimes just in case the page still lists earlier times in the day
        const t = new Date(r.start).getTime()
        if (!Number.isFinite(t) || t < Date.now()) continue
        screenings.push({
          id: `cinelumiere-${r.title}-${r.start}`.replace(/\W+/g, ''),
          filmTitle: r.title,
          cinema: 'cinelumiere',
          screeningStart: r.start,
          bookingUrl: r.bookingUrl || undefined,
          filmUrl: r.filmUrl || undefined,
        })
      }
    } catch (e) {
      console.warn('[CINE LUMIERE] Failed day', url, e?.message || e)
      continue
    }
  }

  // De-dup by film + time
  const seen = new Set()
  screenings = screenings.filter((s) => {
    const k = s.filmTitle + '|' + s.screeningStart
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  // Detail pass: visit each film URL to extract Director + Year from ul.metadata
  try {
    const urls = Array.from(new Set(screenings.map(s => s.filmUrl).filter(Boolean)))
    const dpage = await ctx.newPage()
    const yearMap = new Map()
    const dirMap = new Map()
    for (const url of urls) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        try { await dpage.waitForSelector('ul.metadata li', { timeout: 8000 }) } catch {}
        const { year, director } = await dpage.evaluate(() => {
          function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return Number.isFinite(n) && n >= 1895 && n <= Y }
          let year
          let director
          const ul = document.querySelector('ul.metadata')
          const lis = Array.from(ul?.querySelectorAll('li') || [])
          for (const li of lis) {
            const tx = (li.textContent || '').replace(/\s+/g, ' ').trim()
            if (!director && /^director\(s\)?:/i.test(tx)) {
              director = tx.replace(/^director\(s\)?:/i, '').trim()
            }
            if (!year) {
              const ym = tx.match(/\b(19|20)\d{2}\b/)
              if (ym) {
                const y = Number(ym[0])
                if (valid(y)) year = y
              }
            }
          }
          return { year, director }
        })
        if (year) yearMap.set(url, year)
        if (director) dirMap.set(url, director)
      } catch {}
    }
    if (yearMap.size) {
      for (const s of screenings) {
        const y = yearMap.get(s.filmUrl)
        if (y) {
          const sy = new Date(s.screeningStart).getFullYear()
          const safe = y >= 1895 && y <= sy + 1 ? y : undefined
          if (safe) s.websiteYear = safe
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
  console.log('[CINE LUMIERE] screenings collected:', screenings.length)
  return screenings
}

// Alias for naming consistency if needed elsewhere
export const fetchInstitutFrancais = fetchCineLumiere

