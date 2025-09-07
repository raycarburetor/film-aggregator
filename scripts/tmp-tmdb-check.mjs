import './load-env.mjs'

const k = process.env.TMDB_API_KEY
if (!k) { console.error('No TMDB_API_KEY'); process.exit(1) }

const fetchFn = globalThis.fetch

async function run(qStr, year) {
  const q = encodeURIComponent(qStr)
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${k}&language=en-GB&query=${q}&include_adult=false` + (year ? `&year=${year}` : '')
  const res = await fetchFn(url)
  const json = await res.json()
  return (json.results || []).map(r => ({ id: r.id, title: r.title, release_date: r.release_date }))
}

const withYear = await run('Killer of Sheep', 1977)
const noYear = await run('Killer of Sheep')
console.log('with year=1977:', withYear)
console.log('without year:', noYear.slice(0, 10))

