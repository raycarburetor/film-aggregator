import { fetchPrinceCharles } from './cinemas/princecharles.mjs'

const TZ = 'Europe/London'
const fmtDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })

const items = await fetchPrinceCharles()
console.log('Found', items.length, 'screenings (PCC)')
console.log('Showing first 10 with times in', TZ)
for (const i of items.slice(0, 10)) {
  const local = fmtDate.format(new Date(i.screeningStart))
  const yr = typeof i.websiteYear === 'number' ? i.websiteYear : '—'
  console.log('-', `${i.filmTitle} [${yr}]`, '—', local, '—', i.bookingUrl)
}
