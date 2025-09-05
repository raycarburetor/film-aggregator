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
