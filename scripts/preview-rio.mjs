import { fetchRio } from './cinemas/rio.mjs'

const items = await fetchRio()
for (const it of items) {
  console.log(`${it.screeningStart} | ${it.filmTitle} | ${it.bookingUrl}`)
}
console.log('Total:', items.length)

