// scripts/cinemas/genesis.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape Genesis Cinema listings from the full programme page.
 * Source: https://www.genesiscinema.co.uk/whatson/all
 * - Extracts title, showtimes, booking URLs
 * - Visits film detail pages to read website-stated Release Date year
 */
export async function fetchGenesis() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const START_URL = 'https://www.genesiscinema.co.uk/whatson/all'

  let screenings = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    // Give the page a moment to settle and trigger any lazy content
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
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
    } catch {}

    // Minimal wait for content
    try {
      await page.waitForSelector('h1 a[href*="/event/"]', { timeout: 20000 })
    } catch {}

    // Attempt to close any cookie manager overlay if interactive (best effort)
    try {
      const btn = await page.$('button:has-text("Accept")')
      if (btn) await btn.click({ delay: 50 })
    } catch {}

    // Extract listings
    screenings = await page.evaluate(() => {
      const base = location.origin

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

      function parseDateParts(s) {
        // Expect forms like "Saturday 06 September 2025"
        if (!s) return null
        const re = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/i
        const m = s.trim().match(re)
        if (!m) return null
        const day = Number(m[2])
        const monName = m[3].toLowerCase()
        const mon = monthMap[monName] ?? monthMap[monName.slice(0,3)]
        const year = Number(m[4])
        if (isNaN(day) || mon == null || isNaN(year)) return null
        return { y: year, m: mon, d: day }
      }

      function extractTimesAndLinks(gridEl, baseParts) {
        const out = []
        if (!gridEl || !baseParts) return out
        const anchors = Array.from(gridEl.querySelectorAll('a[href], a'))
        for (const a of anchors) {
          const tx = (a.textContent || '').replace(/\s+/g, ' ').trim()
          const mm = tx.match(/\b(\d{1,2}):(\d{2})\b/)
          if (!mm) continue
          let hour = Number(mm[1])
          const minute = Number(mm[2])
          if (isNaN(hour) || isNaN(minute)) continue
          const when = new Date(baseParts.y, baseParts.m, baseParts.d, hour, minute)
          if (isNaN(when)) continue
          const href = a.getAttribute('href') || ''
          out.push({ when, href: cleanUrl(href) })
        }
        return out
      }

      const results = []
      const titleLinks = Array.from(document.querySelectorAll('h1 a[href*="/event/"]'))
      for (const tl of titleLinks) {
        const title = (tl.textContent || '').replace(/\s+/g, ' ').trim()
        const filmUrl = cleanUrl(tl.getAttribute('href') || '')
        const root = tl.closest('h1')?.parentElement || tl.parentElement
        if (!root || !title || !filmUrl) continue

        // For each grid of showtimes under the film block, get the date from parent text and times from anchors
        const grids = Array.from(root.querySelectorAll('div.grid'))
        for (const g of grids) {
          const dayContainer = g.parentElement
          if (!dayContainer) continue
          let headText = ''
          try { headText = (dayContainer.childNodes?.[0]?.textContent || dayContainer.childNodes?.[0]?.nodeValue || '').trim() } catch {}
          if (!headText) {
            // fallback: try the container's text minus the grid text
            const gridText = (g.textContent || '').trim()
            const all = (dayContainer.textContent || '').trim()
            headText = all.replace(gridText, '').trim()
          }
          const parts = parseDateParts(headText)
          if (!parts) continue
          const pairs = extractTimesAndLinks(g, parts)
          for (const { when, href } of pairs) {
            const iso = when.toISOString()
            const bookingUrl = href || filmUrl
            results.push({
              id: `genesis-${title}-${iso}`.replace(/\W+/g, ''),
              filmTitle: title,
              cinema: 'genesis',
              screeningStart: iso,
              bookingUrl,
              filmUrl,
            })
          }
        }
      }

      // Deduplicate by title + start time
      const seen = new Set()
      return results.filter((i) => {
        const k = i.filmTitle + '|' + i.screeningStart
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    })

    // Filter to horizon (default 30 days)
    const now = Date.now()
    const horizonDays = Number(process.env.GENESIS_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = (screenings || []).filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })

    // Fetch film detail pages to extract website "Release Date:" year and director
    try {
      const maxDetails = Number(process.env.GENESIS_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER)
      const detailMap = new Map()
      const dirMap = new Map()
      const filmUrls = Array.from(new Set((screenings || []).map(s => s.filmUrl).filter(Boolean))).slice(0, maxDetails)
      const dpage = await ctx.newPage()
      for (const url of filmUrls) {
        try {
          await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const info = await dpage.evaluate(() => {
            function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return n >= 1895 && n <= Y }
            function cleanName(name, title) {
              try { let s=String(name||'').replace(/\s{2,}/g,' ').trim(); if(!s) return null; const norm=(x)=>String(x||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').toLowerCase(); if(title){ const nt=norm(title).split(/\s+/).filter(Boolean); let toks=s.split(/\s+/).filter(Boolean); let i=0; while(i<nt.length && toks[0] && norm(toks[0])===nt[i]){ toks.shift(); i++ } s=toks.join(' ').trim()||s } const stops=new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in']); let toks=s.split(/\s+/); while(toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift(); s=toks.join(' ').trim(); s=s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim(); s=s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim(); s=s.replace(/^(?:and|with)\s+/i,'').trim(); return s||null } catch { return null } }
            function nameFromInlineStats(text, title) { const re=/([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/; const m=String(text||'').match(re); return m?cleanName(m[1], title):null }
            function getDirector() {
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
              const nodes = Array.from(document.querySelectorAll('p, li, div, span, dt, dd, section, article'))
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
              if (m && m[1]) return cleanName(m[1].trim(), document.querySelector('h1, .title, .film-title')?.textContent)
              const t = document.querySelector('h1, .title, .film-title')?.textContent || ''
              return nameFromInlineStats(body, t)
            }
            // Find elements that mention "Release Date:" and pull a year
            const nodes = Array.from(document.querySelectorAll('p, li, div, span, dt, dd, section, article'))
            for (const el of nodes) {
              const tx = (el.textContent || '').trim()
              if (!/release\s*date\s*:/.test(tx.toLowerCase())) continue
              // Prefer DD/MM/YYYY or YYYY
              let m = tx.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
              if (m && valid(Number(m[3]))) return Number(m[3])
              m = tx.match(/\b(19|20)\d{2}\b/)
              if (m && valid(Number(m[0]))) return Number(m[0])
            }
            // Fallback: annotation year in title
            const tEl = document.querySelector('h1, .title, .film-title')
            const t = tEl?.textContent?.trim() || ''
            let mm = t.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/) || t.match(/[-–—]\s*((?:19|20)\d{2})\s*$/) || t.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
            if (mm) { const y = Number(mm[1] || mm[0]); if (valid(y)) return y }
            const year = undefined
            let director = getDirector()
            director = cleanName(director, t)
            return { year, director }
          })
          if (typeof info === 'number') { detailMap.set(url, info) }
          else {
            if (info?.year) detailMap.set(url, info.year)
            if (info?.director) dirMap.set(url, info.director)
          }
        } catch {}
      }
      if (detailMap.size) {
        for (const s of screenings) {
          const y = detailMap.get(s.filmUrl)
          if (y) {
            const sy = new Date(s.screeningStart).getFullYear()
            const safe = (y >= 1895 && y <= sy) ? y : undefined
            if (safe && (!s.websiteYear || safe < s.websiteYear)) s.websiteYear = safe
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

    if (!screenings.length) {
      try {
        const html = await page.content()
        // eslint-disable-next-line no-undef
        const fs = await import('node:fs/promises')
        await fs.writeFile('./tmp-genesis.html', html, 'utf8')
      } catch {}
    }
  } catch (e) {
    try {
      const html = await page.content()
      // eslint-disable-next-line no-undef
      const fs = await import('node:fs/promises')
      await fs.writeFile('./tmp-genesis-error.html', html, 'utf8')
    } catch {}
  }

  await browser.close()
  console.log('[GENESIS] screenings collected:', screenings.length)
  return screenings
}
