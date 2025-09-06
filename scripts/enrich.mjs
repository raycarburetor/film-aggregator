// Use global fetch (Node 18+)
const fetchFn = globalThis.fetch

function normalizeTitleForSearch(title) {
  if (!title) return title
  let s = String(title)
  // If of the form "X presents: Y" or similar, take the part after the colon
  const presentsIdx = s.toLowerCase().indexOf('presents:')
  if (presentsIdx !== -1) {
    s = s.slice(presentsIdx + 'presents:'.length)
  }
  // Drop common suffix adornments that hurt search matching
  s = s
    // remove any parenthetical/trailing bracketed notes e.g. (1972), (Q&A), (4K), [35mm]
    .replace(/\s*[\[(][^\])]*[\])]/g, ' ')
    // remove hyphenated marketing suffixes e.g. "- 25th Anniversary", "- 4K Restoration", "- Director's Cut"
    .replace(/\s*[-–—]\s*(\d+\w*\s+anniversary|\d+k\s+restoration|restored|director'?s\s+cut|theatrical\s+cut|remastered|preview|qa|q&a|uncut(?:\s+version)?)\s*$/i, '')
    // remove a trailing standalone 'uncut' if present
    .replace(/\s+uncut\s*$/i, '')
    // collapse extra spaces
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Final cleanup: if a trailing year remains (e.g. "Title 1972"), drop it
  s = s.replace(/\s+(19|20)\d{2}$/g, '').trim()
  return s
}

function annotationYearFromTitle(title) {
  const s = String(title || '')
  let m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]\s*$/)
  if (m) return Number(m[1])
  m = s.match(/[-–—]\s*((?:19|20)\d{2})\s*$/)
  if (m) return Number(m[1])
  m = s.match(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/)
  if (m) return Number(m[1])
  return undefined
}

function extractYearHint(title, existingReleaseDate, websiteYear) {
  if (typeof websiteYear === 'number' && Number.isFinite(websiteYear)) return websiteYear
  const t = annotationYearFromTitle(title)
  if (t) return t
  if (existingReleaseDate && /^\d{4}/.test(existingReleaseDate)) return Number(existingReleaseDate.slice(0, 4))
  return undefined
}

export async function enrichWithTMDb(items, region='GB') {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) { console.warn('No TMDB_API_KEY set; skipping TMDb enrichment'); return }
  for (const it of items) {
    try {
      const qTitle = normalizeTitleForSearch(it.filmTitle)
      const q = encodeURIComponent(qTitle)
      const yearHint = extractYearHint(it.filmTitle, it.releaseDate, it.websiteYear)
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=en-GB&query=${q}&include_adult=false${yearHint ? `&year=${yearHint}` : ''}`
      const res = await fetchFn(url)
      if (!res.ok) continue
      const data = await res.json()
      const results = Array.isArray(data.results) ? data.results : []

      function yearFrom(s) { return (s && /^\d{4}-/.test(s)) ? Number(s.slice(0,4)) : undefined }

      let m = results[0]
      if (results.length) {
        // Prefer exact year match if we have a hint (websiteYear takes precedence)
        if (yearHint) {
          const byYear = results.find(r => yearFrom(r.release_date) === yearHint)
          if (byYear) m = byYear
        }
        // Prefer exact title match (case-insensitive), and if multiple, choose earliest year
        const exacts = results.filter(r => {
          const t = (r.title || '').trim().toLowerCase()
          const ot = (r.original_title || '').trim().toLowerCase()
          const ql = qTitle.trim().toLowerCase()
          return t === ql || ot === ql
        })
        if (exacts.length) {
          m = exacts.slice().sort((a,b) => (yearFrom(a.release_date) || 9999) - (yearFrom(b.release_date) || 9999))[0]
        }
        // Fallback: prefer normalized-title match using same cleanup, then earliest
        if (!exacts.length) {
          const nExacts = results.filter(r => {
            const t = normalizeTitleForSearch(r.title || '').toLowerCase()
            const ot = normalizeTitleForSearch(r.original_title || '').toLowerCase()
            const ql = qTitle.toLowerCase()
            return t === ql || ot === ql
          })
          if (nExacts.length) {
            m = nExacts.slice().sort((a,b) => (yearFrom(a.release_date) || 9999) - (yearFrom(b.release_date) || 9999))[0]
          } else {
            // Absolute fallback: earliest year overall
            m = results.slice().sort((a,b) => (yearFrom(a.release_date) || 9999) - (yearFrom(b.release_date) || 9999))[0]
          }
        }
      }
      if (!m) continue
      it.tmdbId = m.id
      it.releaseDate = m.release_date || it.releaseDate
      const detRes = await fetchFn(`https://api.themoviedb.org/3/movie/${m.id}?api_key=${apiKey}&append_to_response=credits,external_ids`)
      if (detRes.ok) {
        const det = await detRes.json()
        it.synopsis = det.overview || it.synopsis
        it.genres = (det.genres || []).map(g => g.name)
        const dir = det.credits?.crew?.find(c => c.job === 'Director')
        if (dir) it.director = dir.name
        it.imdbId = det.external_ids?.imdb_id || it.imdbId
      }
    } catch {}
  }
}

export async function enrichWithOMDb(items, omdbKey) {
  if (!omdbKey) return
  for (const it of items) {
    try {
      const id = it.imdbId
      const url = id
        ? `https://www.omdbapi.com/?apikey=${omdbKey}&i=${id}&tomatoes=true`
        : `https://www.omdbapi.com/?apikey=${omdbKey}&t=${encodeURIComponent(normalizeTitleForSearch(it.filmTitle))}&tomatoes=true`
      const res = await fetchFn(url)
      if (!res.ok) continue
      const data = await res.json()
      if (data && data.Response !== 'False') {
        // If TMDb failed to populate a release date, use OMDb's where reliable
        const existingYear = it.releaseDate && /^\d{4}/.test(it.releaseDate) ? Number(it.releaseDate.slice(0,4)) : undefined
        let omdbYear
        if (typeof data.Year === 'string') {
          const ym = data.Year.match(/\b(19|20)\d{2}\b/)
          if (ym) omdbYear = Number(ym[0])
        }
        if (!existingYear && omdbYear) {
          // Construct a YYYY-MM-DD if a precise Released is present; else YYYY-01-01
          let iso = `${omdbYear}-01-01`
          if (typeof data.Released === 'string' && /\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(data.Released)) {
            const d = new Date(data.Released)
            if (!isNaN(d.getTime())) iso = d.toISOString().slice(0,10)
          }
          it.releaseDate = iso
        }
      }
      const ratings = data.Ratings || []
      const rt = ratings.find(r => r.Source === 'Rotten Tomatoes')?.Value
      if (rt && rt.endsWith('%')) it.rottenTomatoesPct = Number(rt.replace('%',''))
    } catch {}
  }
}

// Letterboxd enrichment: map TMDb → Letterboxd URL and extract average rating (0–5)
export async function enrichWithLetterboxd(items, options = {}) {
  try {
    const enabled = String(process.env.LETTERBOXD_ENABLE ?? 'false').toLowerCase() === 'true'
    if (!enabled) { console.warn('[LB] LETTERBOXD_ENABLE not true; skipping Letterboxd enrichment'); return }

    // Choose runtime: stealth on opt-in; otherwise vanilla Playwright
    let chromiumLib
    const useStealth = String(process.env.LETTERBOXD_STEALTH ?? 'false').toLowerCase() === 'true'
    if (useStealth) {
      try {
        const px = await import('playwright-extra')
        chromiumLib = px.chromium
        try {
          const StealthPlugin = (await import('playwright-extra-plugin-stealth')).default
          const stealth = StealthPlugin()
          if (typeof chromiumLib.use === 'function') chromiumLib.use(stealth)
        } catch (e) {
          console.warn('[LB] Stealth plugin not available; continuing without it:', e?.message || e)
        }
      } catch (e) {
        console.warn('[LB] playwright-extra unavailable; using vanilla playwright:', e?.message || e)
        const p = await import('playwright')
        chromiumLib = p.chromium
      }
    } else {
      const p = await import('playwright')
      chromiumLib = p.chromium
    }

    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const cachePath = path.join(__dirname, '..', 'data', 'letterboxd-cache.json')

    async function loadCache() {
      try { const txt = await fs.readFile(cachePath, 'utf8'); return JSON.parse(txt) || {} } catch { return {} }
    }
    async function saveCache(obj) {
      try { await fs.writeFile(cachePath, JSON.stringify(obj, null, 2), 'utf8') } catch {}
    }

    const cache = await loadCache()

    // Optional: check robots.txt and bail out if disallowed
    try {
      const res = await fetch('https://letterboxd.com/robots.txt')
      if (res.ok) {
        const txt = await res.text()
        // Heuristic: if global disallow everything
        if (/User-agent:\s*\*[^]*?Disallow:\s*\/$/mi.test(txt)) {
          console.warn('[LB] robots.txt disallows crawling; skipping Letterboxd enrichment')
          return
        }
      }
    } catch {}

    // Unique TMDb IDs only
    const tmdbSet = new Set(items.map(i => i.tmdbId).filter(Boolean))
    if (!tmdbSet.size) { console.warn('[LB] No TMDb IDs on items; skipping Letterboxd enrichment'); return }

    const browser = await chromiumLib.launch({ headless: true })
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    })
    const page = await ctx.newPage()

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

    async function findLetterboxdUrlFor(tmdbId, title, year) {
      const key = String(tmdbId)
      const cached = cache[key]
      if (cached && cached.url) return cached.url
      const q = encodeURIComponent(`${title || ''} ${year || ''}`.trim())
      const searchURL = `https://letterboxd.com/search/films/${q}/`
      try {
        await page.goto(searchURL, { waitUntil: 'domcontentloaded', timeout: 45000 })
        // Coax client-side rendering
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
        const candidates = await page.evaluate(() => {
          const out = []
          const as = Array.from(document.querySelectorAll('a[href^="/film/"]'))
          for (const a of as) {
            const href = a.getAttribute('href') || ''
            if (/^\/film\//.test(href)) {
              try { out.push(new URL(href, location.origin).toString()) } catch {}
            }
          }
          return Array.from(new Set(out))
        })
        // Optionally, verify by opening the first few and checking for TMDb link
        for (const url of candidates.slice(0, 3)) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
            try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
            const match = await page.evaluate((id) => {
              const links = Array.from(document.querySelectorAll('a[href*="themoviedb.org"]'))
              return links.some(a => new RegExp(String(id)).test(a.getAttribute('href') || ''))
            }, tmdbId)
            if (match) { cache[key] = { url, updatedAt: new Date().toISOString() }; await saveCache(cache); return url }
          } catch {}
        }
        if (candidates[0]) { cache[key] = { url: candidates[0], updatedAt: new Date().toISOString() }; await saveCache(cache); return candidates[0] }
      } catch {}
      return undefined
    }

    async function extractAverageRating(url) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
        // Prefer JSON-LD AggregateRating
        const fromLd = await page.evaluate(() => {
          const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          for (const s of scripts) {
            try {
              const data = JSON.parse(s.textContent || 'null')
              const arr = Array.isArray(data) ? data : [data]
              for (const obj of arr) {
                const ar = obj?.aggregateRating
                if (ar && typeof ar.ratingValue !== 'undefined') {
                  const n = Number(ar.ratingValue)
                  if (Number.isFinite(n)) return n
                }
              }
            } catch {}
          }
          return undefined
        })
        if (typeof fromLd === 'number' && Number.isFinite(fromLd)) return fromLd

        // Fallback: search visible text near "Average rating"
        const fromText = await page.evaluate(() => {
          function findNodesByText(pattern) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
            const out = []
            let node
            while ((node = walker.nextNode())) {
              const el = node
              const tx = el.textContent || ''
              if (pattern.test(tx)) out.push(el)
            }
            return out
          }
          const anchors = findNodesByText(/average\s+rating/i)
          for (const el of anchors) {
            const tx = (el.textContent || '').replace(/\s+/g, ' ')
            let m = tx.match(/average\s+rating[^\d]*([0-5](?:\.\d)?)/i)
            if (m) return Number(m[1])
            // try siblings
            const sibs = [el.nextElementSibling, el.parentElement, el.closest('section, div, li')]
            for (const s of sibs) {
              if (!s) continue
              const st = (s.textContent || '').replace(/\s+/g, ' ')
              m = st.match(/([0-5](?:\.\d)?)/)
              if (m) return Number(m[1])
            }
          }
          return undefined
        })
        if (typeof fromText === 'number' && Number.isFinite(fromText)) return fromText
      } catch {}
      return undefined
    }

    // Process each unique TMDb id sequentially to be polite
    for (const tmdbId of tmdbSet) {
      try {
        const sample = items.find(i => i.tmdbId === tmdbId)
        const title = sample?.filmTitle
        const year = sample?.releaseDate?.slice(0,4)
        const url = await findLetterboxdUrlFor(tmdbId, title, year)
        if (!url) { await sleep(1200 + Math.random()*400); continue }
        const rating = await extractAverageRating(url)
        // Store rating on all items with this TMDb ID
        for (const it of items) {
          if (it.tmdbId === tmdbId) it.letterboxdRating = (typeof rating === 'number' && rating >= 0 && rating <= 5) ? rating : it.letterboxdRating
        }
        await sleep(1200 + Math.random()*600)
      } catch {}
    }

    await browser.close()
    await saveCache(cache)
  } catch (e) {
    console.warn('[LB] Letterboxd enrichment failed:', e?.message || e)
  }
}
