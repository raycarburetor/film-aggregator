import { chromium as pwChromium } from 'playwright'

// Scrape BFI Southbank daily listings across a short horizon using Playwright
// Listing URL template provided by user; release year extracted from film detail pages.
export async function fetchBFI() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  function dayUrl(d) {
    // The endpoint accepts unpadded month/day: YYYY-M-D
    const yyyy = d.getFullYear()
    const m = d.getMonth() + 1
    const dd = d.getDate()
    const base = 'https://whatson.bfi.org.uk/Online/default.asp'
    const qs = new URLSearchParams({
      "BOset::WScontent::SearchCriteria::venue_filter": '',
      "BOset::WScontent::SearchCriteria::city_filter": '',
      "BOset::WScontent::SearchCriteria::month_filter": '',
      "BOset::WScontent::SearchCriteria::object_type_filter": '',
      "BOset::WScontent::SearchCriteria::category_filter": '',
      "BOset::WScontent::SearchCriteria::search_from": '',
      "BOset::WScontent::SearchCriteria::search_to": '',
      "doWork::WScontent::search": '1',
      "BOparam::WScontent::search::article_search_id": '25E7EA2E-291F-44F9-8EBC-E560154FDAEB',
      "BOset::WScontent::SearchCriteria::search_criteria": '',
      "BOset::WScontent::SearchCriteria::search_from": `${yyyy}-${m}-${dd}`,
      "BOset::WScontent::SearchCriteria::search_to": `${yyyy}-${m}-${dd}`,
    })
    // Important: keep parameter names encoded exactly as AudienceView expects
    const u = `${base}?${qs.toString()}`
    return u
  }

  const horizonDays = Number(process.env.BFI_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
  const start = new Date()
  const screenings = []

  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const url = dayUrl(d)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      // Allow Cloudflare managed challenge to complete
      await page.waitForTimeout(4000)
      // Nudge page network
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
      // Wait for some content indicative of results
      await page.waitForSelector('a[href*="article_id"], a[href*="loadArticle"], a[href*="/Online/default.asp"], .ws-whatson, .Result', { timeout: 12000 }).catch(()=>{})

      const rows = await page.evaluate((isoDay) => {
        const out = []
        const day = new Date(isoDay)
        function clean(href) { try { const u = new URL(href, location.origin); u.hash=''; return u.toString() } catch { return href } }
        function timePairsAround(el, baseDate) {
          const res = []
          if (!el) return res
          // search for time tokens near element: HH:MM with optional am/pm
          const scope = el.closest('tr, li, .WScontent, .Container, .ws-whatson, .Event, .article') || el.parentElement
          const textNodes = (scope?.innerText || '').split(/\n+/)
          const seen = new Set()
          for (const line of textNodes) {
            const re = /(\b\d{1,2}):(\d{2})\s*(am|pm)?\b/ig
            let m
            while ((m = re.exec(line))) {
              let hh = Number(m[1]); const mm = Number(m[2]); const ap = (m[3]||'').toLowerCase()
              if (ap === 'pm' && hh < 12) hh += 12
              if (ap === 'am' && hh === 12) hh = 0
              const when = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hh, mm)
              const iso = when.toISOString()
              if (!seen.has(iso)) { seen.add(iso); res.push({ when }) }
            }
          }
          return res
        }

        const anchors = Array.from(document.querySelectorAll('a[href*="article_id="]'))
        for (const a of anchors) {
          const href = a.getAttribute('href') || ''
          const filmUrl = clean(href)
          const title = (a.textContent || '').replace(/\s+/g, ' ').trim()
          if (!title) continue
          const times = timePairsAround(a, day)
          if (times.length === 0) {
            // Fallback: still push a placeholder, detail page may give times (rare)
            out.push({ title, filmUrl, start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0).toISOString(), placeholder: true })
          } else {
            for (const t of times) out.push({ title, filmUrl, start: t.when.toISOString() })
          }
        }
        return out
      }, new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString())

      for (const r of rows) {
        if (!r || !r.title || !r.start) continue
        screenings.push({
          id: `bfi-${r.title}-${r.start}`.replace(/\W+/g, ''),
          filmTitle: r.title,
          cinema: 'bfi',
          screeningStart: r.start,
          bookingUrl: r.filmUrl,
          filmUrl: r.filmUrl,
        })
      }
    } catch {}
  }

  // Fetch detail pages for release year (YYYY)
  try {
    const dpage = await ctx.newPage()
    const maxDetails = Number(process.env.BFI_MAX_DETAIL_PAGES || 40)
    const unique = Array.from(new Set(screenings.map(s => s.filmUrl).filter(Boolean))).slice(0, maxDetails)
    const yMap = new Map()
    for (const url of unique) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await dpage.waitForTimeout(1500)
        const y = await dpage.evaluate(() => {
          function valid(n){ const Y=new Date().getFullYear()+1; return n>=1895 && n<=Y }
          // Try to locate the info blocks; look for label/value pairs
          const labels = Array.from(document.querySelectorAll('p.Film-info__information__value, p.Film-info__information__label, .Film-info__information__value, .Film-info__information__label'))
          let year
          for (const el of labels) {
            const tx = (el.textContent || '').trim()
            const m = tx.match(/\b(19|20)\d{2}\b/)
            if (m && valid(Number(m[0]))) { year = Number(m[0]); break }
          }
          if (!year) {
            // fallback: anywhere in main content
            const m = (document.body.textContent || '').match(/\b(19|20)\d{2}\b/)
            if (m && valid(Number(m[0]))) year = Number(m[0])
          }
          return year
        })
        if (y) yMap.set(url, y)
      } catch {}
    }
    if (yMap.size) {
      for (const s of screenings) {
        const y = yMap.get(s.filmUrl)
        if (y) {
          const sy = new Date(s.screeningStart).getFullYear()
          const safe = (y >= 1895 && y <= sy + 1) ? y : undefined
          if (safe) s.websiteYear = safe
        }
      }
    }
  } catch {}

  await browser.close()
  console.log('[BFI] screenings collected:', screenings.length)
  return screenings
}
