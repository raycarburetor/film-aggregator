import './load-env.mjs'
import { fetchICA } from './cinemas/ica.mjs'

const TZ = 'Europe/London'
const fmtDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ })

const items = await fetchICA()
console.log('Found', items.length, 'screenings (ICA)')
console.log('Showing first 10 with times in', TZ)
for (const i of items.slice(0, 10)) {
  const local = fmtDate.format(new Date(i.screeningStart))
  console.log('-', i.filmTitle, '—', local, '—', i.bookingUrl)
}
