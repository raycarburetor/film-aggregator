import { fetchGarden } from './cinemas/garden.mjs'

const items = await fetchGarden()
for (const it of items) {
  console.log(`${it.screeningStart} | ${it.filmTitle} | ${it.bookingUrl}`)
}
console.log('Total:', items.length)

