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

  // Detail pass: fetch director names from film pages
  try {
    const dpage = await ctx.newPage()
    const maxDetails = Number(process.env.BARBICAN_MAX_DETAIL_PAGES || 40)
    const urls = Array.from(new Set(screenings.map(s => s.filmUrl).filter(Boolean))).slice(0, maxDetails)
    const dMap = new Map()
    for (const url of urls) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const dir = await dpage.evaluate(() => {
          function cleanName(name, title) {
            try {
              let s = String(name || '').replace(/\s{2,}/g, ' ').trim()
              if (!s) return null
              const norm = (x) => String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase()
              if (title) {
                const nt = norm(title).split(/\s+/).filter(Boolean)
                let toks = s.split(/\s+/).filter(Boolean)
                let i=0
                while (i<nt.length && toks[0] && norm(toks[0])===nt[i]) { toks.shift(); i++ }
                s = toks.join(' ').trim() || s
              }
              const stops = new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in'])
              let toks = s.split(/\s+/)
              while (toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift()
              s = toks.join(' ').trim()
              s = s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim()
              s = s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim()
              s = s.replace(/^(?:and|with)\s+/i,'').trim()
              return s || null
            } catch { return null }
          }
          function nameFromInlineStats(text, title) {
            const re = /([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/
            const m = String(text||'').match(re)
            return m ? cleanName(m[1], title) : null
          }
          function fromJSONLD() {
            try {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              for (const s of scripts) {
                const data = JSON.parse(s.textContent || 'null')
                const arr = Array.isArray(data) ? data : [data]
                for (const obj of arr) {
                  const d = obj?.director
                  if (!d) continue
                  if (typeof d === 'string') return d
                  if (Array.isArray(d)) {
                    const name = d.map(x => x?.name || '').filter(Boolean).join(', ')
                    if (name) return name
                  } else if (typeof d === 'object') {
                    if (d?.name) return d.name
                  }
                }
              }
            } catch {}
            return undefined
          }
          function fromLabels() {
            const scope = document
            const nodes = Array.from(scope.querySelectorAll('dt, dd, p, li, .meta, .details, .film-info, .Film-info__information__label, .Film-info__information__value'))
            for (const el of nodes) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                const sib = el.nextElementSibling
                if (sib) {
                  const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                  if (v) return cleanName(v, document.querySelector('h1, .title, .film-title')?.textContent)
                }
                const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .title, .film-title')?.textContent)
              }
            }
            const body = (document.body.textContent || '').replace(/\s+/g, ' ')
            const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
            if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .title, .film-title')?.textContent)
            const t = document.querySelector('h1, .title, .film-title')?.textContent || ''
            return nameFromInlineStats(body, t)
          }
          const t = document.querySelector('h1, .title, .film-title')?.textContent || ''
          let d = fromJSONLD() || fromLabels()
          d = cleanName(d, t)
          return d
        })
        if (dir) dMap.set(url, dir)
      } catch {}
    }
    if (dMap.size) {
      for (const s of screenings) {
        const d = dMap.get(s.filmUrl)
        if (d) s.director = d
      }
    }
  } catch {}

  // Deduplicate
  const seen = new Set()
  const deduped = screenings.filter((i) => {
    const k = i.filmTitle + '|' + i.screeningStart
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  await browser.close()
  console.log('[BARBICAN] screenings collected:', deduped.length)
  return deduped
}
