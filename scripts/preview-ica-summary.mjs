import './load-env.mjs'
import { fetchICA } from './cinemas/ica.mjs'

const items = await fetchICA()
const uniqueDays = new Set(items.map(i => new Date(i.screeningStart).toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })))
const sorted = items.slice().sort((a,b)=>a.screeningStart.localeCompare(b.screeningStart))
console.log('Screenings:', items.length)
console.log('Unique days:', uniqueDays.size)
if (sorted.length) {
  const TZ = 'Europe/London'
  const fmtDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })
  console.log('First:', fmtDate.format(new Date(sorted[0].screeningStart)), sorted[0].filmTitle)
  console.log('Last:', fmtDate.format(new Date(sorted[sorted.length-1].screeningStart)), sorted[sorted.length-1].filmTitle)
}
