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

        function cleanUrl(href) {
          try {
            const u = new URL(href, base)
            u.hash = ''
            return u.toString()
          } catch { return href }
        }

        function extractFilmUrl(block) {
          const a = block.querySelector('a[href*="/film/"], a[href*="/films/"]')
          if (a) return cleanUrl(a.getAttribute('href') || '')
          // Fallback: sometimes title is a link inside .poster_name or similar
          const b = block.querySelector('.poster_name a[href]')
          if (b) return cleanUrl(b.getAttribute('href') || '')
          return ''
        }

        function extractYearFromTitle(title) {
          const s = String(title || '')
          // Prefer explicit annotations like "(1979)" or "- 1979" at the end
          let m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
          if (m) return Number(m[1])
          m = s.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
          if (m) return Number(m[1])
          // Also accept bracketed year anywhere in title as annotation
          m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
          if (m) return Number(m[1])
          return undefined
        }

        for (const b of blocks) {
          const title = (b.querySelector('.liveeventtitle')?.textContent || '').trim()
          if (!title) continue
          const filmUrl = extractFilmUrl(b)

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
                filmUrl,
                websiteYear: (() => { const y = extractYearFromTitle(title); return (y && y >= 1895 && y <= when.getFullYear()) ? y : undefined })(),
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

  // Limit future horizon (default 60 days)
  try {
    const now = Date.now()
    const horizonDays = Number(process.env.PCC_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = screenings.filter(s => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })
  } catch {}

  // Visit film detail pages to capture website-stated release years and director
  try {
    const maxDetails = Number(process.env.PCC_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER)
    const detailMap = new Map()
    const dirMap = new Map()
    // Use film detail pages only (explicit request)
    const filmUrls = screenings.map(s => s.filmUrl).filter(Boolean)
    const uniqueUrls = Array.from(new Set(filmUrls)).slice(0, maxDetails)

    const dpage = await ctx.newPage()

    for (const url of uniqueUrls) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        // Wait for film detail info list to appear
        try {
          await dpage.waitForSelector('ul.movie-info li:first-child', { timeout: 8000 })
        } catch {}
        const year = await dpage.evaluate(() => {
          function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return n >= 1895 && n <= Y }
          function pickAnnoYearFromTitle(s) {
            const str = String(s||'')
            let m = str.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
            if (m) return Number(m[1])
            m = str.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
            if (m) return Number(m[1])
            m = str.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
            if (m) return Number(m[1])
          }
          // STRICT: extract the first YYYY from the film detail UL
          const ul = document.querySelector('ul.movie-info')
          if (ul) {
            const first = ul.querySelector('li:first-child')
            const raw = (first?.textContent || '').trim()
            const m = raw.match(/\b(19|20)\d{2}\b/)
            if (m && valid(Number(m[0]))) return Number(m[0])
          }
          // Fallbacks only if UL missing
          const titleEl = document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')
          const titleText = titleEl?.textContent?.trim() || ''
          const y1 = pickAnnoYearFromTitle(titleText)
          if (valid(y1)) return y1
          const labelSelectors = ['.meta', '.details', '.film-info', '.film_meta', 'dl', 'ul', 'section']
          let best
          for (const sel of labelSelectors) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const tx = el.textContent || ''
              if (/\b(year|release year|released)\b/i.test(tx)) {
                const yrs = Array.from(tx.matchAll(/\b(19|20)\d{2}\b/g)).map(m => Number(m[0])).filter(valid)
                if (yrs.length) best = Math.min(best ?? Infinity, Math.min(...yrs))
              }
            }
          }
          return best
        })
        if (year) detailMap.set(url, year)
        // Director
        const director = await dpage.evaluate(() => {
          function cleanName(name, title) { try { let s=String(name||'').replace(/\s{2,}/g,' ').trim(); if(!s) return null; const norm=(x)=>String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase(); if(title){ const nt=norm(title).split(/\s+/).filter(Boolean); let toks=s.split(/\s+/).filter(Boolean); let i=0; while(i<nt.length && toks[0] && norm(toks[0])===nt[i]){ toks.shift(); i++ } s=toks.join(' ').trim()||s } const stops=new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in']); let toks=s.split(/\s+/); while(toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift(); s=toks.join(' ').trim(); s=s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?[\s\S]*$/i,'').trim(); s=s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim(); s=s.replace(/^(?:and|with)\s+/i,'').trim(); return s||null } catch { return null } }
          function nameFromInlineStats(text, title) { const re=/([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/; const m=String(text||'').match(re); return m?cleanName(m[1], document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')?.textContent):null }
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
                    const name = d?.name || ''
                    if (name) return name
                  }
                }
              }
            } catch {}
            return undefined
          }
          function fromLabels() {
            const nodes = Array.from(document.querySelectorAll('.meta, .details, dl, ul, section, p, li, dt, dd, ul.movie-info, ul.movie-info li'))
            for (const el of nodes) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                const sib = el.nextElementSibling
                if (sib) {
                  const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                  if (v) return cleanName(v, document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')?.textContent)
                }
                const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')?.textContent)
              }
            }
            const body = (document.body.textContent || '').replace(/\s+/g, ' ')
            const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
            if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')?.textContent)
            const t = document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')?.textContent || ''
            return nameFromInlineStats(body, t)
          }
          const t = document.querySelector('h1, .film-title, .liveeventtitle, .poster_name, .poster-name, .title')?.textContent || ''
          let d = fromJSONLD() || fromLabels()
          d = cleanName(d, t)
          return d
        })
        if (director) dirMap.set(url, director)
      } catch {}
    }

    // Apply discovered years back onto items when helpful
    if (detailMap.size) {
      for (const s of screenings) {
        // Map strictly by filmUrl to avoid mismatches with booking pages
        const key = s.filmUrl
        const y = detailMap.get(key)
        if (y) {
          const sy = new Date(s.screeningStart).getFullYear()
          const safe = (y >= 1895 && y <= sy) ? y : undefined
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
  console.log('[PCC] screenings collected:', screenings.length)
  return screenings
}

// Backward-compat exported alias in case other files used the old name
export const fetchPrincecharles = fetchPrinceCharles
