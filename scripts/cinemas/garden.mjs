// scripts/cinemas/garden.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape The Garden Cinema listings from the homepage calendar view.
 * Source: https://www.thegardencinema.co.uk/
 * Returns Screening[] with minimal fields; enrichment adds metadata later.
 */
export async function fetchGarden() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const CANDIDATE_URLS = [
    'https://www.thegardencinema.co.uk/',
    'https://thegardencinema.co.uk/',
    'https://www.thegardencinema.co.uk/whats-on/',
    'https://www.thegardencinema.co.uk/whats-on',
  ]

  let screenings = []
  let activeUrl = ''
  try {
    for (const [idx, URL] of CANDIDATE_URLS.entries()) {
      activeUrl = URL
      try {
        await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      } catch { continue }

      // Dismiss cookie banners if present
      try {
        const cookieBtn = await page.$(
          '#onetrust-accept-btn-handler, button:has-text("Accept"), button:has-text("I Agree"), .ot-sdk-button, .fc-cta-consent'
        )
        if (cookieBtn) await cookieBtn.click({ delay: 50 })
      } catch {}

      // Wait for the exact Garden daily listing classes to render
      try {
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(()=>{})
        await page.waitForSelector('.films-list__by-date__film__title, .films-list__by-date__film__screeningtimes', { timeout: 25000 })
      } catch {}

      // Trigger lazy loading if needed by scrolling
      try {
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let last = 0
            let stable = 0
            const step = 800
            const timer = setInterval(() => {
              window.scrollBy(0, step)
              const h = document.body.scrollHeight
              if (h === last) stable += 1; else { stable = 0; last = h }
              if (stable >= 3 || window.scrollY + window.innerHeight >= h) {
                clearInterval(timer)
                resolve(undefined)
              }
            }, 200)
          })
        })
        await page.waitForTimeout(500)
      } catch {}

      screenings = await page.evaluate(() => {
        const base = location.origin
        const out = []

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

      function cleanUrl(href) {
        try {
          const u = new URL(href, base)
          u.hash = ''
          return u.toString()
        } catch { return href }
      }

      function parseDateHeader(s) {
        if (!s) return null
        const str = s.trim()
        // Likely formats: "Thu 5 Sep", "Thursday 5 September", or ISO-like
        let m = str.match(/(\d{1,2})\s+([A-Za-z]{3,})/) // day + month name
        if (m) {
          const day = parseInt(m[1], 10)
          const monName = m[2].toLowerCase()
          const mon = monthMap[monName] ?? monthMap[monName.slice(0,3)]
          if (mon != null) {
            const now = new Date()
            let year = now.getFullYear()
            if (mon < now.getMonth() - 6) year += 1
            const d = new Date(year, mon, day)
            return isNaN(d) ? null : d
          }
        }
        // Try ISO yyyy-mm-dd in data attributes embedded in text
        m = str.match(/(\d{4})-(\d{2})-(\d{2})/)
        if (m) {
          const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
          return isNaN(d) ? null : d
        }
        return null
      }

      function extractYearFromStats(el) {
        const tx = (el?.textContent || '').trim()
        const m = tx.match(/\b(19|20)\d{2}\b/)
        return m ? Number(m[0]) : undefined
      }

      function extractTimesAndLinks(scope, baseDate) {
        const pairs = []
        const anchors = Array.from(scope.querySelectorAll('a[href]'))
        for (const a of anchors) {
          const txt = (a.textContent || '').trim()
          // Match 24h or 12h with am/pm
          const m = txt.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)
          if (!m) continue
          let hour = parseInt(m[1], 10)
          const minute = parseInt(m[2], 10)
          const ap = (m[3] || '').toLowerCase()
          if (ap === 'pm' && hour < 12) hour += 12
          if (ap === 'am' && hour === 12) hour = 0
          const when = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute)
          if (isNaN(when)) continue
          pairs.push({ when, href: cleanUrl(a.getAttribute('href') || '') })
        }
        return pairs
      }

      // Strategy A: Title/Stats/Screeningtimes blocks (as described)
      const titleNodes = Array.from(document.querySelectorAll('h1.films-list__by-date__film__title'))
      for (const t of titleNodes) {
        const title = (t.textContent || '').replace(/\s+/g, ' ').trim()
        const titleLink = t.querySelector('a[href]')
        const filmUrl = titleLink ? cleanUrl(titleLink.getAttribute('href') || '') : ''
        const root = t.closest('.films-list__by-date__film') || t.parentElement || document
        const statsEl = root.querySelector('div.films-list__by-date__film__stats')
        const websiteYear = extractYearFromStats(statsEl)
        const timesRoot = root.querySelector('div.films-list__by-date__film__screeningtimes') || root

        const collected = []

        // Strategy A1: Structured screening panels with sibling date title + time links
        const panels = Array.from(timesRoot.querySelectorAll('.screening-panel'))
        if (panels.length) {
          const monthMap = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11}
          for (const p of panels) {
            const db = p.closest('.date-block')
            const baseAttr = db?.getAttribute?.('data-date') || '' // YYYY-MM-DD
            let baseYear, baseMonth, baseDay
            if (/^(\d{4})-(\d{2})-(\d{2})$/.test(baseAttr)) {
              const m = baseAttr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
              baseYear = Number(m[1]); baseMonth = Number(m[2]) - 1; baseDay = Number(m[3])
            }
            const dTitle = (p.querySelector('.screening-panel__date-title')?.textContent || '').trim()
            if ((!baseYear || !baseMonth || !baseDay) && dTitle) {
              const m = dTitle.match(/(\d{1,2})\s+([A-Za-z]{3,9})/)
              if (m) {
                baseDay = Number(m[1])
                baseMonth = monthMap[m[2].toLowerCase()] ?? monthMap[m[2].toLowerCase().slice(0,3)]
                if (baseMonth == null) continue
                const now = new Date(); baseYear = now.getFullYear(); if (baseMonth < now.getMonth() - 6) baseYear += 1
              }
            }
            if (baseYear == null || baseMonth == null || baseDay == null) continue
            const timeLinks = Array.from(p.querySelectorAll('.screening-time a[href]'))
            for (const a of timeLinks) {
              const tx = (a.textContent || '').trim()
              const tm = tx.match(/^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i)
              if (!tm) continue
              let hour = Number(tm[1]); const minute = Number(tm[2]); const ap = (tm[3]||'').toLowerCase()
              if (ap === 'pm' && hour < 12) hour += 12
              if (ap === 'am' && hour === 12) hour = 0
              const when = new Date(baseYear, baseMonth, baseDay, hour, minute)
              if (isNaN(when)) continue
              collected.push({ when, href: a.getAttribute('href') || filmUrl })
            }
          }
        }

        // Strategy A2: time[datetime] fallback anywhere within timesRoot
        if (!collected.length) {
          const timeEls = Array.from(timesRoot.querySelectorAll('time[datetime]'))
          for (const te of timeEls) {
            const dt = te.getAttribute('datetime') || ''
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dt)) continue
            const when = new Date(dt)
            if (isNaN(when)) continue
            const a = te.closest('a[href]') || te.querySelector('a[href]') || timesRoot.querySelector('a[href]')
            const href = a?.getAttribute('href') || filmUrl
            collected.push({ when, href })
          }
        }

        // Strategy A3: parse combined date+time strings in any links/buttons as last resort
        if (!collected.length) {
          const monthMap = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11}
          const links = Array.from(timesRoot.querySelectorAll('a[href], button'))
          for (const a of links) {
            const tx = (a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
            const m = tx.match(/(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})/i)
            if (!m) continue
            const day = parseInt(m[1], 10)
            const mon = monthMap[m[2]] ?? monthMap[m[2].slice(0,3)]
            let year = m[3] ? parseInt(m[3],10) : undefined
            let hour = parseInt(m[4], 10)
            const minute = parseInt(m[5], 10)
            if (mon == null || isNaN(day) || isNaN(hour) || isNaN(minute)) continue
            if (!year) { const now = new Date(); year = now.getFullYear(); if (mon < now.getMonth() - 6) year += 1 }
            const when = new Date(year, mon, day, hour, minute)
            if (isNaN(when)) continue
            const href = a.getAttribute('href') || filmUrl
            collected.push({ when, href })
          }
        }

        for (const { when, href } of collected) {
          if (!title || !when) continue
          const y = websiteYear
          const safeYear = (typeof y === 'number' && y >= 1895 && y <= when.getFullYear()) ? y : undefined
          out.push({
            id: `garden-${title}-${when.toISOString()}`.replace(/\W+/g, ''),
            filmTitle: title,
            cinema: 'garden',
            screeningStart: when.toISOString(),
            bookingUrl: cleanUrl(href || filmUrl),
            filmUrl,
            websiteYear: safeYear,
          })
        }
      }

      // Strategy B: By-event blocks (no times here; we will fetch detail pages later)
      // Capture title + filmUrl + a coarse date string for later filtering.
      const eventBlocks = Array.from(document.querySelectorAll('.films-list__by-event__event'))
      for (const ev of eventBlocks) {
        const title = (ev.querySelector('.films-list__by-event__event__title, h2 a, h2')?.textContent || '').replace(/\s+/g, ' ').trim()
        let filmUrl = ''
        const a = ev.querySelector('.films-list__by-event__event__title a[href], h2 a[href]')
        if (a) {
          try { const u = new URL(a.getAttribute('href') || '', base); u.hash=''; filmUrl = u.toString() } catch {}
        }
        const dateText = (ev.querySelector('.films-list__by-event__event__date')?.textContent || '').trim()
        if (title && filmUrl) {
          out.push({ id: `garden-seed-${title}-${filmUrl}`.replace(/\W+/g,''), filmTitle: title, cinema: 'garden', filmUrl, seedDateText: dateText })
        }
      }

      // Deduplicate by title + start time
      const seen = new Set()
      return out.filter((i) => {
        const k = i.filmTitle + '|' + (i.screeningStart || i.filmUrl)
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      })

      if (screenings.length > 0) break

      // Save HTML for debugging attempts
      try {
        const html = await page.content()
        // eslint-disable-next-line no-undef
        const fs = await import('node:fs/promises')
        await fs.writeFile(`./tmp-garden-attempt-${idx}.html`, html, 'utf8')
      } catch {}
    }

    // If Strategy A returned screenings, proceed; else use Strategy B seeds to fetch detail pages and extract showtimes
    const seeds = Array.isArray(screenings) ? screenings.filter(s => !s.screeningStart && s.filmUrl) : []
    if (seeds.length) {
      const dpage = await ctx.newPage()
      const items = []
      const unique = Array.from(new Set(seeds.map(s => s.filmUrl)))
      for (const url of unique) {
        try {
          await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
          try {
            await dpage.waitForSelector('script[type="application/ld+json"], time[datetime], a[href], .showtimes, .times, .tickets', { timeout: 8000 })
          } catch {}
          const rows = await dpage.evaluate(() => {
            const base = location.origin
            const res = { showtimes: [], year: undefined, director: undefined }

            function validYear(y){ const n=Number(y); const Y=new Date().getFullYear()+1; return n>=1895 && n<=Y }
            function normUrl(href){ try { const u = new URL(href, base); u.hash=''; return u.toString() } catch { return href } }

            // Extract year from stats or title
            try {
              const stats = document.querySelector('div.films-list__by-date__film__stats, .film-year, .details, .meta')
              if (stats) {
                const m = (stats.textContent || '').match(/\b(19|20)\d{2}\b/)
                if (m && validYear(Number(m[0]))) res.year = Number(m[0])
              }
            } catch {}
            if (!res.year) {
              const t = document.querySelector('h1, .film-title, .title')?.textContent || ''
              let m = t.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/) || t.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
              if (m && validYear(Number(m[1]||m[0]))) res.year = Number(m[1]||m[0])
            }

            // Director from JSON-LD or labels
            function cleanName(name, title) {
              try { let s=String(name||'').replace(/\s{2,}/g,' ').trim(); if(!s) return null; const norm=(x)=>String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase(); if(title){ const nt=norm(title).split(/\s+/).filter(Boolean); let toks=s.split(/\s+/).filter(Boolean); let i=0; while(i<nt.length && toks[0] && norm(toks[0])===nt[i]){ toks.shift(); i++ } s=toks.join(' ').trim()||s } const stops=new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in']); let toks=s.split(/\s+/); while(toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift(); s=toks.join(' ').trim(); s=s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim(); s=s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim(); s=s.replace(/^(?:and|with)\s+/i,'').trim(); return s||null } catch { return null } }
            function nameFromInlineStats(text, title) {
              // Match patterns like "Name, 2024, 119m" and "Name, Country, 2024, 119 min"
              const re = /([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/
              const m = String(text||'').match(re)
              return m ? cleanName(m[1], document.querySelector('h1, .film-title, .title')?.textContent) : null
            }
            try {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              for (const s of scripts) {
                const data = JSON.parse(s.textContent || 'null')
                const arr = Array.isArray(data) ? data : [data]
                for (const obj of arr) {
                  const d = obj?.director
                  if (d) {
                    if (typeof d === 'string') res.director = d
                    else if (Array.isArray(d)) {
                      const name = d.map(x => x?.name || '').filter(Boolean).join(', ')
                      if (name) res.director = name
                    } else if (typeof d === 'object' && d?.name) {
                      res.director = d.name
                    }
                  }
                }
              }
            } catch {}
            if (!res.director) {
              const nodes = Array.from(document.querySelectorAll('.film-year, .details, .meta, p, li, dt, dd, section, article'))
              for (const el of nodes) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                  const sib = el.nextElementSibling
                  if (sib) {
                    const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                    if (v) { res.director = cleanName(v, document.querySelector('h1, .film-title, .title')?.textContent); break }
                  }
                  const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                  if (m && m[1]) { res.director = cleanName(m[1].trim(), document.querySelector('h1, .film-title, .title')?.textContent); break }
                }
                // Capture "with director NAME" or "director NAME" in event text
                if (!res.director) {
                  const m2 = tx.match(/(?:with\s+)?director\s+([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)/i)
                  if (m2 && m2[1]) { res.director = cleanName(m2[1], document.querySelector('h1, .film-title, .title')?.textContent); break }
                }
              }
              if (!res.director) {
                const body = (document.body.textContent || '').replace(/\s+/g, ' ')
                const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
                if (m && m[1]) res.director = cleanName(m[1].trim(), document.querySelector('h1, .film-title, .title')?.textContent)
                if (!res.director) {
                  const m2 = body.match(/(?:with\s+)?director\s+([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)/i)
                  if (m2 && m2[1]) res.director = cleanName(m2[1], document.querySelector('h1, .film-title, .title')?.textContent)
                }
                if (!res.director) res.director = nameFromInlineStats(body)
              }
            }

            // Prefer JSON-LD Events
            try {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              for (const s of scripts) {
                let txt = s.textContent || ''
                try {
                  const data = JSON.parse(txt)
                  const pile = Array.isArray(data) ? data : [data]
                  const collect = (obj) => {
                    if (!obj || typeof obj !== 'object') return
                    const t = obj['@type']
                    if ((t === 'Event') || (Array.isArray(t) && t.includes('Event'))) {
                      const sd = obj.startDate || obj.start || obj.start_time
                      if (sd) res.showtimes.push({ start: String(sd), href: normUrl(obj.url || obj.offers?.url || '') })
                    }
                    for (const v of Object.values(obj)) {
                      if (v && typeof v === 'object') collect(v)
                    }
                  }
                  for (const obj of pile) collect(obj)
                } catch {}
              }
            } catch {}

            // Fallback: time[datetime]
            try {
              const times = Array.from(document.querySelectorAll('time[datetime]'))
              for (const t of times) {
                const dt = t.getAttribute('datetime') || ''
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dt)) {
                  const a = t.closest('a[href]') || t.querySelector('a[href]')
                  res.showtimes.push({ start: dt, href: normUrl(a?.getAttribute('href') || '') })
                }
              }
            } catch {}

            // Fallback: scan buttons/links with HH:MM and nearby date context in data-*
            try {
              const anchors = Array.from(document.querySelectorAll('a[href], button'))
              for (const a of anchors) {
                const tx = (a.textContent || '').trim()
                const m = tx.match(/\b(\d{1,2}):(\d{2})\b/)
                if (m) {
                  // Look for data-date or datetime on parent
                  const host = a.closest('[data-date], [data-datetime]') || a
                  const dstr = host.getAttribute?.('data-datetime') || host.getAttribute?.('data-date') || ''
                  if (/^\d{4}-\d{2}-\d{2}/.test(dstr)) {
                    let hh = parseInt(m[1],10), mm = parseInt(m[2],10)
                    const base = new Date(dstr)
                    const when = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm)
                    res.showtimes.push({ start: when.toISOString(), href: normUrl(a.getAttribute('href') || '') })
                  }
                }
              }
            } catch {}

            return res
          })

          // Map into screening items
          if (rows && Array.isArray(rows.showtimes)) {
            for (const s of rows.showtimes) {
              try {
                const d = new Date(s.start)
                if (isNaN(d)) continue
                const iso = d.toISOString()
                items.push({
                  id: `garden-${url}-${iso}`.replace(/\W+/g, ''),
                  filmTitle: seeds.find(x => x.filmUrl === url)?.filmTitle || '',
                  cinema: 'garden',
                  screeningStart: iso,
                  bookingUrl: s.href || url,
                  filmUrl: url,
                  websiteYear: rows.year,
                  director: rows.director,
                })
              } catch {}
            }
          }
        } catch {}
      }
      if (items.length) screenings = items
    }

    // Filter to default horizon (30 days by default)
    const now = Date.now()
    const horizonDays = Number(process.env.GARDEN_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = (screenings || []).filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })
    // Detail pass for director on any remaining items missing one
    try {
      const dpage = await ctx.newPage()
      const maxDetails = Number(process.env.GARDEN_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER)
      const urls = Array.from(new Set((screenings || []).filter(s => !s.director && s.filmUrl).map(s => s.filmUrl))).slice(0, maxDetails)
      const dMap = new Map()
      for (const url of urls) {
        try {
          await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const dir = await dpage.evaluate(() => {
            function cleanName(name, title) { try { let s=String(name||'').replace(/\s{2,}/g,' ').trim(); if(!s) return null; const norm=(x)=>String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase(); if(title){ const nt=norm(title).split(/\s+/).filter(Boolean); let toks=s.split(/\s+/).filter(Boolean); let i=0; while(i<nt.length && toks[0] && norm(toks[0])===nt[i]){ toks.shift(); i++ } s=toks.join(' ').trim()||s } const stops=new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in']); let toks=s.split(/\s+/); while(toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift(); s=toks.join(' ').trim(); s=s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim(); s=s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim(); s=s.replace(/^(?:and|with)\s+/i,'').trim(); return s||null } catch { return null } }
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
              const nodes = Array.from(document.querySelectorAll('.meta, .details, dl, ul, section, p, li, dt, dd'))
              for (const el of nodes) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                  const sib = el.nextElementSibling
                  if (sib) {
                    const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                    if (v) return cleanName(v, document.querySelector('h1, .film-title, .title')?.textContent)
                  }
                  const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                  if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .film-title, .title')?.textContent)
                }
                // Also capture "with director NAME" or bare "director NAME" in event copy
                const m2 = tx.match(/(?:with\s+)?director\s+([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)/i)
                if (m2 && m2[1]) return cleanName(m2[1], document.querySelector('h1, .film-title, .title')?.textContent)
              }
              const body = (document.body.textContent || '').replace(/\s+/g, ' ')
              const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
              if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .film-title, .title')?.textContent)
              const m2 = body.match(/(?:with\s+)?director\s+([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)/i)
              if (m2 && m2[1]) return cleanName(m2[1], document.querySelector('h1, .film-title, .title')?.textContent)
              return undefined
            }
            const t = document.querySelector('h1, .film-title, .title')?.textContent || ''
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
  } catch (e) {
    try {
      const html = await page.content()
      // eslint-disable-next-line no-undef
      const fs = await import('node:fs/promises')
      await fs.writeFile('./tmp-garden.html', html, 'utf8')
    } catch {}
  }

  await browser.close()
  console.log('[GARDEN] screenings collected:', screenings.length)
  return screenings
}
