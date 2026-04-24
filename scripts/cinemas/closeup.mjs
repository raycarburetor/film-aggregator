// scripts/cinemas/closeup.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape Close-Up Film Centre programme.
 * Drive the crawl off the programme HTML (not the `var shows` blob, which only
 * exposes currently-bookable screenings and occasionally emits wrong slugs such
 * as `/histoire-s-du-cinema/`). We enumerate every `/film_programmes/YYYY/<prog>/<film>/`
 * link from the listing page and each programme hub, then parse the Calendar
 * table on each film detail page for screening dates + booking URLs.
 */
export async function fetchCloseUp() {
  const browser = await pwChromium.launch({ headless: process.env.CLOSEUP_HEADED ? false : true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const BASE = 'https://www.closeupfilmcentre.com'
  const START_URL = `${BASE}/film_programmes/`

  async function waitReady(p) {
    try { await p.waitForLoadState('networkidle', { timeout: 15000 }) } catch {}
    try { await p.waitForFunction(() => !/just a moment/i.test(document.title), null, { timeout: 60000 }) } catch {}
    try { await p.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
  }

  // Normalize a `/film_programmes/...` href: drop trailing slash and rewrite
  // the broken `histoire-s-du-cinema` slug that `shows.film_url` sometimes emits.
  function normalize(href) {
    return String(href)
      .replace(/\/$/, '')
      .replace('/histoire-s-du-cinema/', '/histoires-du-cinema/')
      .replace(/\/histoire-s-du-cinema$/, '/histoires-du-cinema')
  }

  const items = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await waitReady(page)

    const listingLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href^="/film_programmes/"]'))
        .map(a => a.getAttribute('href'))
        .filter(Boolean)
    )

    const filmRe = /^\/film_programmes\/\d{4}\/[^/]+\/[^/]+\/?$/
    const progRe = /^\/film_programmes\/\d{4}\/[^/]+\/?$/

    const filmPaths = new Set()
    const progPaths = new Set()
    for (const href of listingLinks) {
      if (filmRe.test(href)) filmPaths.add(normalize(href))
      else if (progRe.test(href)) progPaths.add(normalize(href))
    }

    // Visit each programme hub to discover any films not linked from the front page.
    const hub = await ctx.newPage()
    for (const progPath of progPaths) {
      const url = `${BASE}${progPath}/`
      try {
        await hub.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await waitReady(hub)
        const hubLinks = await hub.evaluate(() =>
          Array.from(document.querySelectorAll('a[href^="/film_programmes/"]'))
            .map(a => a.getAttribute('href'))
            .filter(Boolean)
        )
        for (const href of hubLinks) {
          if (filmRe.test(href)) filmPaths.add(normalize(href))
        }
      } catch {}
    }
    await hub.close()

    const dpage = await ctx.newPage()
    for (const filmPath of filmPaths) {
      const url = `${BASE}${filmPath}/`
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await waitReady(dpage)

        const data = await dpage.evaluate(() => {
          function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return n >= 1895 && n <= Y }
          function cleanName(name, title) {
            try {
              let s = String(name || '').replace(/\s{2,}/g, ' ').trim()
              if (!s) return null
              const norm = (x) => String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase()
              if (title) {
                const esc = String(title||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                s = s.replace(new RegExp('^\\s*' + esc + '(?:\\s*)', 'i'), '').trim()
                const nt = norm(title).split(/\s+/).filter(Boolean)
                let tokens = s.split(/\s+/).filter(Boolean)
                let i=0
                while (i<nt.length && tokens[0] && norm(tokens[0])===nt[i]) { tokens.shift(); i++ }
                s = tokens.join(' ').trim() || s
              }
              const stops = new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in'])
              let toks = s.split(/\s+/)
              while (toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift()
              s = toks.join(' ').trim()
              s = s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim()
              s = s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim()
              s = s.replace(/^(?:and|with)\s+/i,'').trim()
              s = s.replace(/\s{2,}/g,' ')
              return s || null
            } catch { return null }
          }
          function nameFromInlineStats(text, title) {
            const re = /([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/
            const m = String(text||'').match(re)
            return m ? cleanName(m[1], title) : null
          }
          function pickDirector() {
            try {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
              for (const s of scripts) {
                const dj = JSON.parse(s.textContent || 'null')
                const arr = Array.isArray(dj) ? dj : [dj]
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
            const scope = document.querySelector('div#film_program_support.inner_block_2_l, #film_program_support') || document
            try {
              const blocks = Array.from(scope.querySelectorAll('p, div'))
              const rawTitle = (document.querySelector('h1, title')?.textContent || '')
              const pageTitle = rawTitle.replace(/^CLOSE[-\s]*UP\s*\|\s*/i, '').trim()
              function directorFromStats(tx) {
                if (!tx) return undefined
                const s = String(tx).replace(/\s+/g,' ').trim()
                const ym = s.match(/\b(19|20)\d{2}\b/)
                if (!ym || ym.index == null) return undefined
                let head = s.slice(0, ym.index)
                if (pageTitle) {
                  const esc = pageTitle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
                  head = head.replace(new RegExp('^\\s*'+esc+'\\s*','i'),'').trim()
                }
                head = head.replace(/[“”"']/g,'').replace(/[\s,:;\-–—]*$/,'').trim()
                const parts = head.split(',').map(p=>p.trim()).filter(Boolean)
                const nameRe = /[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+/
                const names = parts.filter(p => nameRe.test(p))
                if (names.length) return names.join(', ')
                return undefined
              }
              for (const el of blocks) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                if (!/\b(19|20)\d{2}\b/.test(tx)) continue
                const name = directorFromStats(tx)
                if (name) return name
              }
            } catch {}
            const scope2 = document.querySelector('div#film_program_support.inner_block_2_l, #film_program_support') || document
            const nodes = Array.from(scope2.querySelectorAll('p, div, li, dt, dd, .meta, .details'))
            for (const el of nodes) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              if (/^director[s]?\b/i.test(tx) || /directed\s+by/i.test(tx)) {
                const sib = el.nextElementSibling
                if (sib) {
                  const v = (sib.textContent || '').replace(/\s+/g, ' ').trim()
                  if (v) return v
                }
                const m = tx.match(/(?:director[s]?\s*:|directed\s+by)\s*([^;|\n]+)(?:[;|\n]|$)/i)
                if (m && m[1]) return m[1].trim()
              }
            }
            const body = (document.body.textContent || '').replace(/\s+/g, ' ')
            const m = body.match(/directed\s+by\s*([^.;|\n]+)(?:[.;|\n]|$)/i)
            return m ? m[1].trim() : undefined
          }

          const scope = document.querySelector('div#film_program_support.inner_block_2_l, #film_program_support') || document
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
            try {
              const blocks = Array.from(scope.querySelectorAll('p, div'))
              for (const el of blocks) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                const m = tx.match(/\b(19|20)\d{2}\b\s*,\s*\d{1,3}\s*m(?:in)?\b/i)
                if (m) { const y = Number(m[0].match(/\b(19|20)\d{2}\b/)[0]); if (valid(y)) { year = y; break } }
              }
            } catch {}
            const paras = Array.from(scope.querySelectorAll('p, div'))
            if (!year) {
              for (const el of paras) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                const m = tx.match(/\b(19|20)\d{2}\b[\s\S]{0,80}?\b\d{1,3}\s*min\b/i)
                if (m) {
                  const y = Number((m[0].match(/\b(19|20)\d{2}\b/) || [])[0])
                  if (valid(y)) { year = y; break }
                }
              }
            }
            if (!year) {
              for (const el of paras) {
                const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
                const m = tx.match(/,\s*((?:19|20)\d{2})\b/)
                if (m && valid(Number(m[1]))) { year = Number(m[1]); break }
              }
            }
            if (!year) {
              const txt = (scope.textContent || '').replace(/\s+/g, ' ').trim()
              const years = Array.from(txt.matchAll(/\b(19|20)\d{2}\b/g)).map(m => Number(m[0])).filter(valid)
              if (years.length) {
                const sorted = years.slice().sort((a,b) => a - b)
                const cap = typeof scheduleYear === 'number' ? scheduleYear : new Date().getFullYear()
                year = sorted.find(y => y !== scheduleYear && y <= cap)
              }
            }
          }

          const rawTitle = document.querySelector('h1, title')?.textContent?.trim() || ''
          const ttl = rawTitle.replace(/^CLOSE[-\s]*UP\s*\|\s*/i, '').trim()
          let director = pickDirector()
          if (!director) {
            const plain = (scope?.textContent || document.body.textContent || '').replace(/\s+/g,' ').trim()
            director = nameFromInlineStats(plain, ttl)
          }
          director = cleanName(director, ttl)

          // Calendar table: find a <table> whose header row contains Date + Time.
          const screenings = []
          const tables = Array.from(document.querySelectorAll('table'))
          for (const t of tables) {
            const rows = Array.from(t.querySelectorAll('tr'))
            if (!rows.length) continue
            const headers = Array.from(rows[0].querySelectorAll('th, td'))
              .map(c => (c.textContent || '').trim().toLowerCase())
            if (!headers.includes('date') || !headers.includes('time')) continue
            const titleIdx = headers.indexOf('title')
            const dateIdx = headers.indexOf('date')
            const timeIdx = headers.indexOf('time')
            const bookIdx = headers.indexOf('book')
            for (let i = 1; i < rows.length; i++) {
              const cells = Array.from(rows[i].querySelectorAll('th, td'))
              if (!cells.length) continue
              const rowTitle = titleIdx >= 0 ? (cells[titleIdx]?.textContent || '').replace(/\s+/g,' ').trim() : ''
              const date = dateIdx >= 0 ? (cells[dateIdx]?.textContent || '').replace(/\s+/g,' ').trim() : ''
              const time = timeIdx >= 0 ? (cells[timeIdx]?.textContent || '').replace(/\s+/g,' ').trim() : ''
              const anchor = bookIdx >= 0 ? cells[bookIdx]?.querySelector('a[href]') : rows[i].querySelector('a[href*="ticketsource"]')
              const bookUrl = anchor?.getAttribute('href') || ''
              if (date && time) screenings.push({ rowTitle, date, time, bookUrl })
            }
            break
          }

          return { title: ttl, year, director, screenings }
        })

        const ttl = data?.title || ''
        const year = data?.year
        const director = data?.director
        for (const sc of data?.screenings || []) {
          const dm = sc.date.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
          const tm = sc.time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
          if (!dm || !tm) continue
          const d = Number(dm[1])
          const mo = Number(dm[2])
          const yrRaw = Number(dm[3])
          const yr = yrRaw < 100 ? 2000 + yrRaw : yrRaw
          let h = Number(tm[1])
          const min = Number(tm[2])
          const mer = (tm[3] || '').toLowerCase()
          if (mer === 'pm' && h < 12) h += 12
          if (mer === 'am' && h === 12) h = 0
          const when = new Date(yr, mo - 1, d, h, min)
          if (isNaN(when.getTime())) continue
          const iso = when.toISOString()
          const filmTitle = ttl || sc.rowTitle
          if (!filmTitle) continue
          const bookingUrl = sc.bookUrl ? new URL(sc.bookUrl, url).toString() : url
          items.push({
            id: `closeup-${filmTitle}-${iso}`.replace(/\W+/g, ''),
            filmTitle,
            cinema: 'closeup',
            screeningStart: iso,
            bookingUrl,
            filmUrl: url,
            websiteYear: typeof year === 'number' ? year : undefined,
            releaseDate: typeof year === 'number' ? `${year}-01-01` : undefined,
            director: director || undefined,
          })
        }
      } catch {}
    }
    await dpage.close()
  } catch (e) {
    try {
      const html = await page.content()
      const fs = await import('node:fs/promises')
      await fs.writeFile('./tmp-closeup.html', html, 'utf8')
    } catch {}
  }

  // Horizon filter: drop past + beyond-horizon screenings.
  const now = Date.now()
  const horizonDays = Number(process.env.CLOSEUP_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
  const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
  const filtered = items.filter(s => {
    const t = new Date(s.screeningStart).getTime()
    return t >= now && t <= maxTs
  })

  await browser.close()
  console.log('[CLOSEUP] screenings collected:', filtered.length, '(from', items.length, 'raw)')
  return filtered
}
