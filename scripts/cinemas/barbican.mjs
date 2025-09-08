// scripts/cinemas/barbican.mjs
import { chromium as pwChromium } from 'playwright'

/**
 * Scrape Barbican Cinema day listings across a horizon window.
 * Example day URL: https://www.barbican.org.uk/whats-on/cinema?day=YYYY-MM-DD
 * Extracts title, showtimes, booking/detail URL, release year and (list-level)
 * director from div._film-metadata on each day page. A later detail-pass may
 * fill missing directors, but list-level values are preferred.
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
        function extractDirector(scope) {
          try {
            const meta = scope.querySelector('div._film-metadata')
            if (!meta) return undefined
            const text = (meta.textContent || '').replace(/\s+/g, ' ').trim()
            const rejectRuntime = (s) => /\b(runtime|\d+\s*(?:h|hr|hrs|hour|hours)\b|\b\d+\s*(?:m|min|mins|minutes)\b)/i.test(String(s))
            // 1) Prefer labeled dt/dd pairs
            const dts = Array.from(meta.querySelectorAll('dt'))
            for (const dt of dts) {
              const label = (dt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
              if (/^director(?:s)?\b/.test(label)) {
                const dd = dt.nextElementSibling
                const val = (dd?.textContent || '').replace(/\s+/g, ' ').trim()
                if (val && !rejectRuntime(val)) return val
              }
            }
            // 2) Look for "Directed by NAME"
            let m = text.match(/Directed by\s*([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
            // 3) Look for "Director: NAME"
            m = text.match(/Director(?:s)?\s*:\s*([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
            // 4) Look for "Dir. NAME" or "Dir: NAME"
            m = text.match(/\bDir(?:ector)?s?\.?\s*:\s*([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
            m = text.match(/\bDir(?:ector)?s?\.?\s+([^|•·\n]+?)(?:\s*(?:\||•|·|$))/i)
            if (m && m[1] && !rejectRuntime(m[1])) return m[1].trim()
          } catch {}
          return undefined
        }
        for (const a of articles) {
          const titleEl = a.querySelector('h2._title a[href]')
          const title = (titleEl?.textContent || '').replace(/\s+/g, ' ').trim()
          const filmUrl = titleEl ? cleanHref(titleEl.getAttribute('href') || '') : ''
          const websiteYear = extractYear(a)
          const director = extractDirector(a)
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
              director,
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
          director: r.director || undefined,
        })
      }
    } catch {}
  }

  // Detail pass: fetch director names from film pages
  try {
    const dpage = await ctx.newPage()
    const maxDetails = Number(process.env.BARBICAN_MAX_DETAIL_PAGES ?? Number.MAX_SAFE_INTEGER)
    const urls = Array.from(new Set(screenings.map(s => s.filmUrl).filter(Boolean))).slice(0, maxDetails)
    const dMap = new Map()
    for (const url of urls) {
      try {
        await dpage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        try { await dpage.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
        try { await dpage.waitForSelector('.label-value-list, .label-value-list__label, div.sidebar-item', { timeout: 12000 }) } catch {}
        // Wait specifically for a Director label if it will appear dynamically
        try {
          await dpage.waitForFunction(() => {
            const labs = Array.from(document.querySelectorAll('.label-value-list__label'))
            return labs.some(el => /director/i.test((el.textContent||'').trim()))
          }, { timeout: 12000 })
        } catch {}
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
              // Drop obvious runtime strings
              if (/^\s*runtime\b/i.test(s)) return null
              s = s.replace(/\b(?:runtime)\b/ig, '')
              s = s.replace(/\b\d+\s*(?:h|hr|hrs|hour|hours)\b(?:\s*\d+\s*(?:m|min|mins|minutes)\b)?/ig, '')
              s = s.replace(/\b\d+\s*(?:m|min|mins|minutes)\b/ig, '')
              const stops = new Set(['demonstration','conversation','talk','introduction','intro','performance','screentalk','screen','lecture','panel','qa','q&a','with','presented','presentedby','hosted','hostedby','in'])
              let toks = s.split(/\s+/)
              while (toks.length && stops.has(norm(toks[0]).replace(/\s+/g,''))) toks.shift()
              s = toks.join(' ').trim()
              s = s.replace(/\s*,\s*(?:19|20)\d{2}\s*,\s*\d{1,3}\s*min[\s\S]*$/i,'').trim()
              s = s.replace(/\s*[,–—-]\s*(?:UK|USA|US|France|Italy|Iran|India|Canada)(?:\s*[,–—-].*)?$/i,'').trim()
              s = s.replace(/^(?:and|with)\s+/i,'').trim()
              // If what's left still looks like runtime fluff, reject
              if (/\b(min|mins|minutes|hour|hours|hr|hrs)\b/i.test(s)) return null
              return s || null
            } catch { return null }
          }
          function nameFromInlineStats(text, title) {
            const re = /([A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+(?:\s+and\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+(?:\s+[A-Z][A-Za-zÀ-ÿ.'’\-]+)+)?)\s*,\s*(?:[A-Za-z\s]+,\s*)?(?:19|20)\d{2}\s*,\s*\d{1,3}\s*m(?:in)?\b/
            const m = String(text||'').match(re)
            return m ? cleanName(m[1], title) : null
          }
          function fromSidebarList() {
            try {
              const scopes = Array.from(document.querySelectorAll('div.sidebar-item .label-value-list, .sidebar-item .label-value-list, .label-value-list'))
              const getValueText = (el) => {
                if (!el) return ''
                const anchors = Array.from(el.querySelectorAll('a')).map(a => (a.textContent || '').trim()).filter(Boolean)
                if (anchors.length) return anchors.join(', ')
                return (el.textContent || '').replace(/\s+/g, ' ').trim()
              }
              for (const scope of scopes) {
                // First try strict dt/dd pairing if present
                const dts = Array.from(scope.querySelectorAll('.label-value-list__label'))
                const vls = Array.from(scope.querySelectorAll('.label-value-list__value'))
                // Pair by nextElementSibling when possible
                for (const dt of dts) {
                  const label = (dt.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
                  if (!/^director(?:s|\(s\))?\b/.test(label)) continue
                  // Prefer within the same row container
                  let row = dt.closest('.label-value-list__row') || dt.parentElement
                  let dd = row ? row.querySelector('.label-value-list__value') : null
                  if (!dd) dd = dt.nextElementSibling
                  // Walk forward until we find a matching value element or another label
                  while (dd && !(dd.classList?.contains('label-value-list__value'))) {
                    if (dd.classList?.contains('label-value-list__label')) break
                    dd = dd.nextElementSibling
                  }
                  const raw = getValueText(dd)
                  if (raw) return raw
                }
                // Fallback: index-based pairing
                const minLen = Math.min(dts.length, vls.length)
                for (let i = 0; i < minLen; i++) {
                  const label = (dts[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
                  if (!/^director(?:s|\(s\))?\b/.test(label)) continue
                  const raw = getValueText(vls[i])
                  if (raw) return raw
                }
                // Last resort: any row containing a label with 'Director' and a sibling value
                const rows = Array.from(scope.querySelectorAll('.label-value-list__row, .label-value-list > *'))
                for (const r of rows) {
                  const lab = r.querySelector('.label-value-list__label')
                  const val = r.querySelector('.label-value-list__value')
                  const ltxt = (lab?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
                  if (lab && val && /^director(?:s|\(s\))?\b/.test(ltxt)) {
                    const raw = getValueText(val)
                    if (raw) return raw
                  }
                }
              }
            } catch {}
            return undefined
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
          // Priority: sidebar label-value list, then JSON-LD, then generic labels
          let d = fromSidebarList() || fromJSONLD() || fromLabels()
          d = cleanName(d, t)
          return d
        })
        if (dir) dMap.set(url, dir)
      } catch {}
    }
    if (dMap.size) {
      for (const s of screenings) {
        const d = dMap.get(s.filmUrl)
        // Prefer list-level metadata director; only fill if missing
        if (d && !s.director) s.director = d
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
