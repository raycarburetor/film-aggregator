import { fetchCineLumiere } from './cinemas/cinelumiere.mjs'

const items = await fetchCineLumiere()
for (const it of items) {
  console.log(`${it.screeningStart} | ${it.filmTitle} | ${it.filmUrl || ''} | ${it.bookingUrl || ''} | ${it.director || ''} | ${it.websiteYear || ''}`)
}
console.log('Total:', items.length)

