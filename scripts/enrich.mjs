// Use global fetch (Node 18+)
const fetchFn = globalThis.fetch

export async function enrichWithTMDb(items, region='GB') {
  const apiKey = process.env.TMDB_API_KEY
  if (!apiKey) { console.warn('No TMDB_API_KEY set; skipping TMDb enrichment'); return }
  for (const it of items) {
    try {
      const q = encodeURIComponent(it.filmTitle)
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=en-GB&query=${q}&include_adult=false`
      const res = await fetchFn(url)
      if (!res.ok) continue
      const data = await res.json()
      const m = data.results?.[0]
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
        : `https://www.omdbapi.com/?apikey=${omdbKey}&t=${encodeURIComponent(it.filmTitle)}&tomatoes=true`
      const res = await fetchFn(url)
      if (!res.ok) continue
      const data = await res.json()
      const ratings = data.Ratings || []
      const rt = ratings.find(r => r.Source === 'Rotten Tomatoes')?.Value
      if (rt && rt.endsWith('%')) it.rottenTomatoesPct = Number(rt.replace('%',''))
    } catch {}
  }
}
