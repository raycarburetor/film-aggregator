// scripts/cinemas/rio.mjs
// Source: https://riocinema.org.uk/Rio.dll/WhatsOn
// Strategy: Read embedded JSON (contains Events + Performances) and map to screenings.
import { chromium as pwChromium } from 'playwright'

export async function fetchRio() {
  const browser = await pwChromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  })
  const page = await ctx.newPage()

  const START_URL = 'https://riocinema.org.uk/Rio.dll/WhatsOn'
  let screenings = []
  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}

    screenings = await page.evaluate(() => {
      const base = location.origin

      function parseEmbeddedJSON() {
        // The page contains a large JSON object like {"Events":[ ... ]} inside a <script> tag
        const html = document.documentElement.innerHTML
        const i = html.indexOf('{"Events"')
        if (i < 0) return null
        const j = html.indexOf('</script>', i)
        if (j < 0) return null
        const chunk = html.slice(i, j)
        try { return JSON.parse(chunk) } catch { return null }
      }

      function toISO(dateStr, hhmm) {
        try {
          const [y, m, d] = (dateStr || '').split('-').map(Number)
          const h = Math.floor(Number(hhmm || 0) / 100)
          const min = Number(hhmm || 0) % 100
          const dt = new Date(y, (m || 1) - 1, d || 1, h, min)
          return isNaN(dt) ? null : dt.toISOString()
        } catch { return null }
      }

      function cleanUrl(href, baseHref) {
        try { return new URL(href, baseHref || base).toString() } catch { return href }
      }

      function decodeHtml(s) {
        try { const ta = document.createElement('textarea'); ta.innerHTML = String(s || ''); return ta.value } catch { return String(s || '') }
      }

      function cleanPrefix(t) {
        let s = String(t || '')
        // Normalize HTML entities first so patterns match
        s = decodeHtml(s)
        // Remove known series/label prefixes at start
        const prefixAlternation = [
          'Pitchblack\\s+Pictures',
          'Japanese\\s+Film\\s+Club',
          'Doc\\s*\'?\\s*n\\s*\'?\\s*Roll',
          'Carers\\s*&(?:amp;)?\\s*Babies\\s*Club',
          'Classic\\s+Matinee',
          'Girls\\s+in\\s+Film',
          'Pink\\s+Palace',
          'MASSIVE\\s+preview',
          'HKFFUK',
          'Sailors\\s+Are\\s+Gay',
          'Hong\\s+K(?:o|i)ng\\s+Film\\s+Festival\\s+UK',
          'Never\\s+Watching\\s+Movies(?:\\s+presents)?',
        ].join('|')
        const prefixRe = new RegExp('^(?:\\s*(?:' + prefixAlternation + ')\\s*:?\\s*)+', 'i')
        s = s.replace(prefixRe, '')
        return s.trim()
      }

      function isAllCaps(s) {
        const letters = (s || '').match(/[A-Za-z]/g)
        if (!letters || letters.length === 0) return false
        return letters.join('') === letters.join('').toUpperCase()
      }

      function toTitleCaseIfAllCaps(s) {
        let str = String(s || '')
        if (!isAllCaps(str)) return str
        const small = new Set(['a','an','the','and','but','or','nor','for','on','at','to','from','by','of','in','with','as'])
        return str
          .toLowerCase()
          .split(/(\s+|[-–—]|:)/)
          .map((tok, idx, arr) => {
            if (/^\s+$/.test(tok) || /^[-–—:]$/.test(tok)) return tok
            if (/^(?:[ivx]+)$/i.test(tok)) return tok.toUpperCase()
            const isFirst = idx === 0
            const nextIsSep = idx + 1 < arr.length && /^\s+$|^[-–—:]$/.test(arr[idx+1] || '')
            const isLastWord = (() => {
              // check if this is the last non-sep token
              for (let j = idx + 1; j < arr.length; j++) { if (!/^\s+$|^[-–—:]$/.test(arr[j])) return false }
              return true
            })()
            const w = tok
            if (!isFirst && !isLastWord && small.has(w)) return w
            return w.charAt(0).toUpperCase() + w.slice(1)
          })
          .join('')
          .replace(/\s{2,}/g, ' ')
          .trim()
      }

      const data = parseEmbeddedJSON()
      if (!data || !Array.isArray(data.Events)) return []

      const out = []
      for (const ev of data.Events) {
        try {
          const titleRaw = String(ev?.Title || '').replace(/\s+/g, ' ').trim()
          const titleClean = toTitleCaseIfAllCaps(cleanPrefix(titleRaw))
          const filmUrl = cleanUrl(String(ev?.URL || ''), base)
          if (!titleClean || !filmUrl) continue
          const perfs = Array.isArray(ev?.Performances) ? ev.Performances : []
          for (const p of perfs) {
            const iso = toISO(p?.StartDate, p?.StartTime)
            if (!iso) continue
            const bookingUrl = cleanUrl(String(p?.URL || ''), filmUrl)
            out.push({
              id: `rio-${p?.ID || ''}-${iso}`.replace(/\W+/g, ''),
              filmTitle: titleClean,
              cinema: 'rio',
              screeningStart: iso,
              bookingUrl,
              filmUrl,
              // websiteYear intentionally omitted for now; fine-tune later.
            })
          }
        } catch {}
      }
      // de-dup same film/time pairs
      const seen = new Set()
      return out.filter((i) => {
        const k = i.filmTitle + '|' + i.screeningStart
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    })

    // Filter to horizon (default 30 days)
    const now = Date.now()
    const horizonDays = Number(process.env.RIO_HORIZON_DAYS || process.env.DEFAULT_HORIZON_DAYS || 30)
    const maxTs = now + horizonDays * 24 * 60 * 60 * 1000
    screenings = (screenings || []).filter((s) => {
      const t = new Date(s.screeningStart).getTime()
      return t >= now && t <= maxTs
    })

    // Visit film detail pages to extract website-stated release year (e.g., "Year: 2024")
    // and Director name (e.g., "Director: Darren Aronofsky")
    try {
      const detailMap = new Map()
      const dirMap = new Map()
      const dpage = await ctx.newPage()
      const urls = Array.from(new Set((screenings || []).map(s => s.filmUrl).filter(Boolean)))
      for (const url of urls) {
        try {
          await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          try { await dpage.waitForSelector('ul.info li, .programme-info-content, .tile .title', { timeout: 8000 }) } catch {}
          const { year, director } = await dpage.evaluate(() => {
            function valid(y) { const n = Number(y); const Y = new Date().getFullYear() + 1; return Number.isFinite(n) && n >= 1895 && n <= Y }
            // Prefer explicit LI entries like "Year: 2024" in the details list
            const lists = Array.from(document.querySelectorAll('ul.info li, ul li'))
            let director
            for (const li of lists) {
              const tx = (li.textContent || '').replace(/\s+/g, ' ').trim()
              const m = tx.match(/\byear\s*:\s*(\d{4})\b/i) || tx.match(/\b(19|20)\d{2}\b/)
              if (!year && m) { const y = Number(m[1] || m[0]); if (valid(y)) { var year = y } }
              if (!director && /^director[s]?\s*:\s*/i.test(tx)) {
                director = tx.replace(/^director[s]?\s*:\s*/i, '').trim()
              }
            }
            // Fallback: scan other text blocks near programme info
            const blocks = Array.from(document.querySelectorAll('.programme-info-content, section, article, p, li, .content'))
            for (const el of blocks) {
              const tx = (el.textContent || '').replace(/\s+/g, ' ').trim()
              const m = tx.match(/\byear\s*:\s*(\d{4})\b/i) || tx.match(/\b(19|20)\d{2}\b/)
              if (!year && m) { const y = Number(m[1] || m[0]); if (valid(y)) { var year = y } }
              if (!director && /^director[s]?\b/i.test(tx)) {
                const mm = tx.match(/director[s]?\s*:\s*([^\n;|]+)(?:[;|\n]|$)/i)
                if (mm && mm[1]) director = mm[1].trim()
              }
            }
            return { year, director }
          })
          if (year) detailMap.set(url, year)
          if (director) dirMap.set(url, director)
        } catch {}
      }
      if (detailMap.size) {
        for (const s of screenings) {
          const y = detailMap.get(s.filmUrl)
          if (y) {
            const sy = new Date(s.screeningStart).getFullYear()
            const safe = (y >= 1895 && y <= sy + 1) ? y : undefined
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
  } catch (e) {
    console.warn('[RIO] Failed to scrape:', e?.message || e)
  }

  await browser.close()
  console.log('[RIO] screenings collected:', screenings.length)
  return screenings
}

// Backward compatibility alias (consistency with other scrapers pattern)
export const fetchRioCinema = fetchRio
