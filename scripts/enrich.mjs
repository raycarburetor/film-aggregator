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
    // remove leading marketing prefixes like "Preview:", "Relaxed Screening:", "Members' Screening:", "Parent & Baby Screening:" and any generic "* Screening:" or series labels like "Parent and Baby:", "Family Film Club:"
    .replace(/^\s*(?:preview|relaxed\s+screening|members'?\s*screening|parent\s*&\s*baby\s*screening)\s*[:\-–—]\s*/i, '')
    .replace(/^\s*(?:parent\s*(?:and|&)?\s*baby|family\s*film\s*club)\s*[:\-–—]\s*/i, '')
    .replace(/^\s*[^:]{0,80}\bscreening\s*[:\-–—]\s*/i, '')
    // remove any parenthetical/trailing bracketed notes e.g. (1972), (Q&A), (4K), [35mm]
    .replace(/\s*[\[(][^\])]*[\])]/g, ' ')
    // remove hyphenated marketing suffixes e.g. "- 25th Anniversary", "- 4K Restoration", "- Director's Cut"
    .replace(/\s*[-–—]\s*(\d+\w*\s+anniversary|\d+k\s+restoration|restored|director'?s\s+cut|theatrical\s+cut|remastered|preview|qa|q&a|uncut(?:\s+version)?)\s*$/i, '')
    // remove trailing segments with series/format/venue/promotional info (after colon or hyphen)
    .replace(/\s*[:\-–—]\s*(classics\s+presented.*|presented\s+by.*|halloween\s+at.*|at\s+genesis.*|soft\s+limit\s+cinema.*|cult\s+classic\s+collective.*|studio\s+screening.*|double\s+bill.*|film\s+festival.*|in\s+(?:35|70)\s*mm.*|on\s+(?:35|70)\s*mm.*)\s*$/i, '')
    // remove trailing UK/US rating tokens (parenthesized or standalone), allow optional *
    .replace(/\s*\((?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\)\s*$/i, '')
    .replace(/\s+\b(?:U|PG|12A?|15|18|R|NR|PG-13|PG13|NC-17)\*?\b\s*$/i, '')
    // remove trailing + Q&A / + QA / + Q and A
    .replace(/\s*\+\s*(?:post[- ]?screening\s+)?(?:q\s*&\s*a|q\s*and\s*a|qa)(?:[^)]*)?\s*$/i, '')
    // remove trailing "with ... Q&A" segments
    .replace(/\s*(?:[-:])?\s*with\s+[^)]*(?:q\s*&\s*a|q\s*and\s*a|qa)\s*$/i, '')
    // remove trailing 4K restoration phrase and standalone format hints so search uses bare title
    .replace(/\s*\b4\s*k\s*restoration\b\s*$/i, '')
    .replace(/\s*\b(?:in|on)\s+(?:35|70)\s*mm\b\s*$/i, '')
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
  const t = annotationYearFromTitle(title)
  if (t) return t
  if (existingReleaseDate && /^\d{4}/.test(existingReleaseDate)) return Number(existingReleaseDate.slice(0, 4))
  // Use websiteYear as a hint if it looks like a plausible film year (allow current/upcoming year)
  const Y = new Date().getFullYear()
  if (typeof websiteYear === 'number' && Number.isFinite(websiteYear)) {
    if (websiteYear >= 1895 && websiteYear <= Y + 1) return websiteYear
  }
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
      async function searchTmdb(withYear) {
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=en-GB&query=${q}&include_adult=false${(withYear && yearHint) ? `&year=${yearHint}` : ''}`
        const res = await fetchFn(url)
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data.results) ? data.results : []
      }
      let results = await searchTmdb(true)
      // If year-filtered search yields nothing, fall back to unfiltered to avoid missing "Killer of Sheep"-style year discrepancies
      if (!results.length) results = await searchTmdb(false)

      function yearFrom(s) { return (s && /^\d{4}-/.test(s)) ? Number(s.slice(0,4)) : undefined }

      // Helper: normalize a person's name for loose matching
      const norm = (s) => String(s || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}+/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()

      // Try to match by director when we have one from the website
      async function findByDirector(candidates, directorName) {
        if (!directorName || !candidates?.length) return null
        const want = norm(directorName)
        if (!want) return null
        const top = candidates.slice(0, 6)
        const scored = []
        for (const r of top) {
          try {
            const detRes = await fetchFn(`https://api.themoviedb.org/3/movie/${r.id}?api_key=${apiKey}&append_to_response=credits`)
            if (!detRes.ok) continue
            const det = await detRes.json()
            const dirs = (det?.credits?.crew || []).filter(c => c?.job === 'Director')
            const hit = dirs.find(d => {
              const have = norm(d?.name)
              return have && (have === want || have.includes(want) || want.includes(have))
            })
            if (hit) {
              // Prefer exact title match among director hits later
              scored.push({ r, det, score: (Number(r.vote_count)||0)*2 + (Number(r.popularity)||0) })
            }
          } catch {}
        }
        if (!scored.length) return null
        // If multiple, prefer exact (normalized) title match; else highest score
        const exactNormTitle = qTitle.toLowerCase()
        const exacts = scored.filter(x => {
          const t = normalizeTitleForSearch(x.r.title || '').toLowerCase()
          const ot = normalizeTitleForSearch(x.r.original_title || '').toLowerCase()
          return t === exactNormTitle || ot === exactNormTitle
        })
        const pool = exacts.length ? exacts : scored
        pool.sort((a,b) => b.score - a.score)
        return pool[0].r
      }

      let m = results[0]
      if (results.length) {
        const sigWords = qTitle.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3)
        const sharesWord = (t) => {
          const nt = normalizeTitleForSearch(t || '').toLowerCase()
          return sigWords.length === 0 || sigWords.some(w => nt.includes(w))
        }
        // If we have a director from the website, try to match candidates by director first
        if (it.director) {
          const byDir = await findByDirector(results, it.director)
          if (byDir) m = byDir
        }
        // Prefer exact year match if we have a hint (as a soft preference only)
        if (!it.director && yearHint) {
          const byYear = results.find(r => yearFrom(r.release_date) === yearHint)
          if (byYear) m = byYear
        }
        // Prefer exact title match (case-insensitive). If multiple, prefer highest popularity/vote_count.
        const score = (r) => (Number(r.vote_count)||0)*2 + (Number(r.popularity)||0)
        const exacts = results.filter(r => {
          const t = (r.title || '').trim().toLowerCase()
          const ot = (r.original_title || '').trim().toLowerCase()
          const ql = qTitle.trim().toLowerCase()
          return t === ql || ot === ql
        })
        if (exacts.length) {
          m = exacts.slice().sort((a,b) => score(b) - score(a))[0]
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
            m = nExacts.slice().sort((a,b) => score(b) - score(a))[0]
          } else {
            // Fallback: pick by popularity among candidates sharing a significant word
            const cands = results.filter(r => sharesWord(r.title) || sharesWord(r.original_title))
            const pool = cands.length ? cands : results
            m = pool.slice().sort((a,b) => score(b) - score(a))[0]
          }
        }
        // Do not bail out on year mismatches from website; we will trust TMDb
      }
      // As an additional fallback: if still no match, try unfiltered search (if not already tried) one more time and apply loose title match
      if (!m) {
        const alt = await searchTmdb(false)
        if (alt.length) {
          const ql = qTitle.toLowerCase()
          const score = (r) => (Number(r.vote_count)||0)*2 + (Number(r.popularity)||0)
          const nExacts = alt.filter(r => {
            const t = normalizeTitleForSearch(r.title || '').toLowerCase()
            const ot = normalizeTitleForSearch(r.original_title || '').toLowerCase()
            return t === ql || ot === ql
          })
          if (nExacts.length) m = nExacts.slice().sort((a,b) => score(b) - score(a))[0]
          else m = alt.slice().sort((a,b) => score(b) - score(a))[0]
        }
      }
      if (!m) continue
      const detRes = await fetchFn(`https://api.themoviedb.org/3/movie/${m.id}?api_key=${apiKey}&append_to_response=credits,external_ids`)
      if (!detRes.ok) continue
      const det = await detRes.json()
      // If we have a site director, ensure the chosen TMDb movie's director matches; otherwise skip to avoid wrong enrichment.
      const siteDir = typeof it.director === 'string' ? it.director : undefined
      const tmdbDirs = (det?.credits?.crew || []).filter(c => c?.job === 'Director').map(c => c?.name).filter(Boolean)
      const hasMatch = !siteDir || tmdbDirs.some(nm => {
        const a = norm(nm)
        const b = norm(siteDir)
        return a === b || a.includes(b) || b.includes(a)
      })
      if (!hasMatch && siteDir) {
        // Do not enrich this item to avoid overwriting with a mismatched film
        continue
      }
      // Safe to apply enrichment
      it.tmdbId = m.id
      it.releaseDate = det.release_date || m.release_date || it.releaseDate
      it.synopsis = det.overview || it.synopsis
      it.genres = (det.genres || []).map(g => g.name)
      const dir = tmdbDirs[0]
      // Only override director if not already present or if it matches the site value
      if (dir) {
        if (!siteDir) it.director = dir
        else if (norm(dir) === norm(siteDir) || norm(dir).includes(norm(siteDir)) || norm(siteDir).includes(norm(dir))) {
          it.director = dir
        }
      }
      it.imdbId = det.external_ids?.imdb_id || it.imdbId
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
    const usePlaywright = String(process.env.LETTERBOXD_USE_PLAYWRIGHT ?? 'false').toLowerCase() === 'true'

    // Shared cache helpers
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const cachePath = path.join(__dirname, '..', 'data', 'letterboxd-cache.json')
    async function loadCache() { try { const txt = await fs.readFile(cachePath, 'utf8'); return JSON.parse(txt) || {} } catch { return {} } }
    async function saveCache(obj) { try { await fs.writeFile(cachePath, JSON.stringify(obj, null, 2), 'utf8') } catch {} }
    const cache = await loadCache()

    // Respect robots.txt best-effort
    try {
      const res = await fetch('https://letterboxd.com/robots.txt')
      if (res.ok) {
        const txt = await res.text()
        if (/User-agent:\s*\*[^]*?Disallow:\s*\/$/mi.test(txt)) {
          console.warn('[LB] robots.txt disallows crawling; skipping Letterboxd enrichment')
          return
        }
      }
    } catch {}

    const tmdbSet = new Set(items.map(i => i.tmdbId).filter(Boolean))
    if (!tmdbSet.size) { console.warn('[LB] No TMDb IDs on items; skipping Letterboxd enrichment'); return }

    // HTTP-based default path (no Playwright)
    if (!usePlaywright) {
      const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      async function fetchText(url) {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' } })
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
        return await res.text()
      }
      function pageHasTmdbId(html, tmdbId) {
        const id = String(tmdbId)
        return new RegExp(`themoviedb\\.org\\/movie\\/${id}(?:[^\\d]|$)`).test(html) || new RegExp(`themoviedb\\.org[^>]*${id}`).test(html)
      }
      function extractLdRating(html) {
        const blocks = []
        const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
        let m
        while ((m = re.exec(html))) blocks.push(m[1])
        for (let raw of blocks) {
          try {
            raw = raw.replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/i, '').replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/i, '').trim()
            if (!/^\s*[\[{]/.test(raw)) { const s = raw.indexOf('{'); const e = raw.lastIndexOf('}'); if (s >= 0 && e > s) raw = raw.slice(s, e + 1) }
            const data = JSON.parse(raw)
            const pile = Array.isArray(data) ? data : [data]
            for (const obj of pile) {
              const ar = obj?.aggregateRating
              if (ar && typeof ar.ratingValue !== 'undefined') {
                const n = Number(ar.ratingValue)
                if (Number.isFinite(n)) return n
              }
            }
          } catch {}
        }
        return undefined
      }
      function slugify(s) {
        if (!s) return ''
        s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/["'`’]/g, '')
        s = s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        s = s.replace(/-{2,}/g, '-')
        return s.toLowerCase()
      }
      async function searchLetterboxdCandidates(q) {
        const url = `https://letterboxd.com/search/films/${encodeURIComponent(q)}/`
        try {
          const html = await fetchText(url)
          const hrefs = []
          const re = /href=["'](\/film\/[^"'#?]+\/?)["']/g
          let m
          while ((m = re.exec(html))) hrefs.push(m[1])
          return Array.from(new Set(hrefs)).slice(0, 10).map(h => new URL(h, 'https://letterboxd.com').toString())
        } catch { return [] }
      }
      async function resolveLetterboxdUrlFor(tmdbId, title, releaseDate, websiteYear) {
        const key = String(tmdbId)
        const cached = cache[key]
        if (cached && cached.url) return cached.url
        const yearHint = extractYearHint(title, releaseDate, websiteYear)
        const normTitle = normalizeTitleForSearch(title)
        const base = slugify(normTitle)
        const slugCandidates = [base]
        if (yearHint) slugCandidates.push(`${base}-${yearHint}`)
        for (const slug of slugCandidates) {
          if (!slug) continue
          const url = `https://letterboxd.com/film/${slug}/`
          try {
            const html = await fetchText(url)
            if (pageHasTmdbId(html, tmdbId)) { cache[key] = { url, updatedAt: new Date().toISOString() }; await saveCache(cache); return url }
          } catch {}
        }
        const q = [normTitle, yearHint].filter(Boolean).join(' ')
        const cands = await searchLetterboxdCandidates(q)
        for (const u of cands.slice(0,5)) {
          try { const html = await fetchText(u); if (pageHasTmdbId(html, tmdbId)) { cache[key] = { url: u, updatedAt: new Date().toISOString() }; await saveCache(cache); return u } } catch {}
        }
        if (cands[0]) { const u = cands[0]; cache[key] = { url: u, updatedAt: new Date().toISOString() }; await saveCache(cache); return u }
        return undefined
      }
      // Process per unique TMDb id
      for (const tmdbId of tmdbSet) {
        try {
          const sample = items.find(i => i.tmdbId === tmdbId)
          const url = await resolveLetterboxdUrlFor(tmdbId, sample?.filmTitle, sample?.releaseDate, sample?.websiteYear)
          if (!url) continue
          const html = await fetchText(url)
          const rating = extractLdRating(html)
          if (typeof rating === 'number') {
            for (const it of items) if (it.tmdbId === tmdbId) it.letterboxdRating = rating
          }
          await new Promise(r => setTimeout(r, 400))
        } catch {}
      }
      await saveCache(cache)
      return
    }

    // Playwright fallback (opt-in)
    const useStealth = String(process.env.LETTERBOXD_STEALTH ?? 'false').toLowerCase() === 'true'
    let chromiumLib
    if (useStealth) {
      try {
        const px = await import('playwright-extra')
        chromiumLib = px.chromium
        try { const StealthPlugin = (await import('playwright-extra-plugin-stealth')).default; const stealth = StealthPlugin(); if (typeof chromiumLib.use === 'function') chromiumLib.use(stealth) } catch (e) { console.warn('[LB] Stealth plugin not available; continuing without it:', e?.message || e) }
      } catch (e) { console.warn('[LB] playwright-extra unavailable; using vanilla playwright:', e?.message || e); const p = await import('playwright'); chromiumLib = p.chromium }
    } else { const p = await import('playwright'); chromiumLib = p.chromium }

    const browser = await chromiumLib.launch({ headless: true })
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', locale: 'en-GB', timezoneId: 'Europe/London' })
    const page = await ctx.newPage()

    async function findLetterboxdUrlFor(tmdbId, title, year) {
      const key = String(tmdbId)
      const cached = cache[key]
      if (cached && cached.url) return cached.url
      const q = encodeURIComponent(`${title || ''} ${year || ''}`.trim())
      const searchURL = `https://letterboxd.com/search/films/${q}/`
      try {
        await page.goto(searchURL, { waitUntil: 'domcontentloaded', timeout: 45000 })
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }) } catch {}
        const candidates = await page.evaluate(() => {
          const out = []
          const as = Array.from(document.querySelectorAll('a[href^="/film/"]'))
          for (const a of as) {
            const href = a.getAttribute('href') || ''
            if (/^\/film\//.test(href)) { try { out.push(new URL(href, location.origin).toString()) } catch {} }
          }
          return Array.from(new Set(out))
        })
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
      } catch {}
      return undefined
    }

    for (const tmdbId of tmdbSet) {
      try {
        const sample = items.find(i => i.tmdbId === tmdbId)
        const title = sample?.filmTitle
        const year = sample?.releaseDate?.slice(0,4)
        const url = await findLetterboxdUrlFor(tmdbId, title, year)
        if (!url) continue
        const rating = await extractAverageRating(url)
        for (const it of items) {
          if (it.tmdbId === tmdbId && typeof rating === 'number') it.letterboxdRating = rating
        }
        await new Promise(r => setTimeout(r, 500))
      } catch {}
    }
    await saveCache(cache)
  } catch (e) {
    console.warn('[LB] Letterboxd enrichment failed:', e?.message || e)
  }
}
