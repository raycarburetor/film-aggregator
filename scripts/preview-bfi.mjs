import { fetchBFI } from './cinemas/bfi.mjs'

const items = await fetchBFI()
console.log('Found', items.length, 'screenings')
console.log(items.slice(0, 10))
